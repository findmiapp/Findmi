import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

/** Signed-in Follow writes (account_followed_businesses / _events /
 * _locations) — shared by the three /api/account/follow* POST routes.
 *
 * A request may carry `following: boolean` — the DESIRED state:
 *   true  → ensure this account follows the entity (an existing row, or a
 *           unique-violation race, is success — never a second row);
 *   false → ensure it doesn't (deleting nothing is success).
 * Both are idempotent: a double tap, a second tab or a stale page can
 * never flip the state the wrong way. Without the field the legacy toggle
 * still applies (temporary backward compatibility). Identity always comes
 * from the session; the session client keeps every read/write under the
 * tables' own-row RLS policies. A genuine write failure is an error
 * response — never a reported state that didn't happen. */

export interface AccountFollowStore {
  isFollowing(): Promise<boolean>;
  /** "duplicate" = the row already exists (unique (user_id, entity)). */
  insert(): Promise<"ok" | "duplicate" | "error">;
  remove(): Promise<"ok" | "error">;
}

export type AccountFollowResult = { ok: true; following: boolean } | { ok: false };

/** Pure decision + writes over an injected store (exported for tests). */
export async function applyAccountFollow(store: AccountFollowStore, desired: boolean | undefined): Promise<AccountFollowResult> {
  try {
    const target = desired ?? !(await store.isFollowing());
    if (target) {
      const r = await store.insert();
      return r === "error" ? { ok: false } : { ok: true, following: true };
    }
    return (await store.remove()) === "ok" ? { ok: true, following: false } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** The optional desired state: a real boolean, or absent (legacy toggle).
 * Anything else is an invalid request. */
export function parseFollowingField(body: unknown): { ok: true; desired: boolean | undefined } | { ok: false } {
  const value = body && typeof body === "object" ? (body as Record<string, unknown>).following : undefined;
  if (value === undefined) return { ok: true, desired: undefined };
  return typeof value === "boolean" ? { ok: true, desired: value } : { ok: false };
}

export interface AccountFollowTarget {
  /** Entity table resolved by slug through the session client (RLS). */
  entityTable: "businesses" | "events" | "locations";
  followTable: "account_followed_businesses" | "account_followed_events" | "account_followed_locations";
  column: "business_id" | "event_id" | "location_id";
}

export async function accountFollowPost(request: NextRequest, target: AccountFollowTarget) {
  const body = await request.json().catch(() => null);
  const slug = typeof body?.slug === "string" ? body.slug : null;
  const intent = parseFollowingField(body);
  if (!slug || !intent.ok) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: entity } = await supabase.from(target.entityTable).select("id").eq("slug", slug).maybeSingle();
  const entityId = (entity as { id: string } | null)?.id ?? null;
  if (!entityId) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const own = () => supabase.from(target.followTable);
  const store: AccountFollowStore = {
    async isFollowing() {
      const { data, error } = await own().select("id").eq("user_id", user.id).eq(target.column, entityId).limit(1);
      if (error) throw new Error("follow_read_failed");
      return (data ?? []).length > 0;
    },
    async insert() {
      const { error } = await own().insert({ user_id: user.id, [target.column]: entityId });
      if (!error) return "ok";
      return (error as { code?: string }).code === "23505" ? "duplicate" : "error";
    },
    async remove() {
      // By (user, entity) — never by a row id read earlier — so it is
      // idempotent and removes this account's follow whatever its id.
      const { error } = await own().delete().eq("user_id", user.id).eq(target.column, entityId);
      return error ? "error" : "ok";
    },
  };

  const result = await applyAccountFollow(store, intent.desired);
  if (!result.ok) return NextResponse.json({ error: "Couldn't update follow. Please try again." }, { status: 500 });
  return NextResponse.json({ following: result.following });
}
