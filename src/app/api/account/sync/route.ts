import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Defensive cap — a device's local saved/followed lists are never
// expected to be anywhere near this large; this just bounds the size of
// one import request rather than reflecting a real product limit.
const MAX_SLUGS = 200;

async function importEntity(
  supabase: SupabaseClient,
  userId: string,
  slugs: unknown,
  entityTable: string,
  accountTable: string,
  column: string
): Promise<void> {
  if (!Array.isArray(slugs)) return;
  const trimmed = Array.from(new Set(slugs.filter((s): s is string => typeof s === "string" && s.length > 0))).slice(
    0,
    MAX_SLUGS
  );
  if (trimmed.length === 0) return;

  // Missing/stale slugs (a business/event/product that no longer exists,
  // or was never real) simply don't resolve to a row here and are
  // silently dropped — never an error, per this pass's explicit
  // requirement.
  const { data: rows } = await supabase.from(entityTable).select("id").in("slug", trimmed);
  const ids = ((rows ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return;

  // upsert + ignoreDuplicates on the (user_id, <column>) unique
  // constraint makes this safe to call more than once for the same
  // user/device — re-importing never creates duplicate rows.
  await supabase.from(accountTable).upsert(
    ids.map((id) => ({ user_id: userId, [column]: id })),
    { onConflict: `user_id,${column}`, ignoreDuplicates: true }
  );
}

/** One-time-per-device import of the existing localStorage saved/followed
 * slug lists (lib/saved.ts, lib/followed.ts — see lib/accountSync.ts for
 * the client-side trigger) into the signed-in user's account-backed
 * tables. Idempotent by construction (unique constraint +
 * ignoreDuplicates), so this endpoint doesn't depend on the client's
 * "already synced" flag for correctness — calling it any number of times
 * for the same user is always safe. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  await Promise.all([
    importEntity(supabase, user.id, body.businessSlugs, "businesses", "account_saved_businesses", "business_id"),
    importEntity(supabase, user.id, body.eventSlugs, "events", "account_saved_events", "event_id"),
    importEntity(supabase, user.id, body.productSlugs, "products", "account_saved_products", "product_id"),
    importEntity(
      supabase,
      user.id,
      body.followedBusinessSlugs,
      "businesses",
      "account_followed_businesses",
      "business_id"
    ),
  ]);

  return NextResponse.json({ ok: true });
}
