// Identity, Authorship & Entity Access V1 — server reads around Moment
// authorship. Server-only (service role for profile/business display
// fields; the session client for the viewer's own memberships).
//
// Deploy-order safety: until the 20261020000000 migration reaches a
// database, journal_entries has no author_business_id. hasMomentAuthorship()
// probes once (cached) so every read keeps working without the column —
// all Moments are then Person-authored, exactly today's behavior — and a
// Business author simply can't be chosen yet.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "./admin/supabase-admin";
import { getAccountContexts } from "./accountContext";
import type { MomentPostedByInitial } from "./moment-composer";
import {
  canPostAsBusinessRole,
  defaultAuthorBusinessId,
  momentAuthorFrom,
  postedByOptions,
  safeAuthorName,
  type PostedByOption,
  type AuthorBusiness,
  type AuthorPerson,
  type ManagedBusinessOption,
  type PublicMomentAuthor,
} from "./moment-author";

let authorshipReady: boolean | null = null;
let checkedAt = 0;
const RECHECK_MS = 60_000;

export async function hasMomentAuthorship(): Promise<boolean> {
  if (authorshipReady) return true;
  if (authorshipReady === false && Date.now() - checkedAt < RECHECK_MS) return false;
  const admin = getAdminSupabase();
  if (!admin) return false;
  const { error } = await admin.from("journal_entries").select("author_business_id").limit(1);
  authorshipReady = !error;
  checkedAt = Date.now();
  return authorshipReady;
}

/** ", author_business_id" when the column exists, else "" — for selects. */
export async function authorColumn(): Promise<string> {
  return (await hasMomentAuthorship()) ? ", author_business_id" : "";
}

/** The viewer's REAL memberships (RLS-scoped session read): roles for every
 * Business, and the Businesses they may post as (owner/manager only). */
export async function getViewerAuthorContext(
  supabase: SupabaseClient,
  userId: string
): Promise<{ roles: Map<string, string>; managed: ManagedBusinessOption[] }> {
  const contexts = await getAccountContexts(supabase, userId);
  return {
    roles: new Map(contexts.map((c) => [c.id, c.role])),
    managed: contexts.filter((c) => canPostAsBusinessRole(c.role)).map((c) => ({ id: c.id, name: c.name, logoUrl: c.logoUrl })),
  };
}

export type AuthorRow = { id: string; user_id: string; author_business_id?: string | null; author_label?: string | null };

/** THE shared public author resolver: one batched profiles read for Person
 * authors and one businesses read for Business authors. Only display
 * fields leave this function — never a user id or email. */
export async function resolveMomentAuthors(
  rows: AuthorRow[],
  personHref: (row: AuthorRow) => string | null = () => null
): Promise<Map<string, PublicMomentAuthor>> {
  const out = new Map<string, PublicMomentAuthor>();
  const admin = getAdminSupabase();
  if (!admin || rows.length === 0) return out;
  const personIds = [...new Set(rows.filter((r) => !r.author_business_id).map((r) => r.user_id))];
  const businessIds = [...new Set(rows.map((r) => r.author_business_id).filter((v): v is string => Boolean(v)))];
  const [{ data: people }, { data: businesses }] = await Promise.all([
    personIds.length ? admin.from("profiles").select("id, display_name, avatar_url").in("id", personIds) : Promise.resolve({ data: [] }),
    businessIds.length
      ? admin.from("businesses").select("id, name, slug, logo_url, publication_status, archived_at, trashed_at").in("id", businessIds)
      : Promise.resolve({ data: [] }),
  ]);
  const personById = new Map(((people ?? []) as (AuthorPerson & { id: string })[]).map((p) => [p.id, p]));
  const businessById = new Map(((businesses ?? []) as (AuthorBusiness & { id: string })[]).map((b) => [b.id, b]));
  for (const row of rows) {
    const author = momentAuthorFrom(
      row,
      personById.get(row.user_id),
      row.author_business_id ? businessById.get(row.author_business_id) : null,
      row.author_business_id ? null : personHref(row)
    );
    if (author) out.set(row.id, author);
  }
  return out;
}

/** The Posted By control for a signed-in person (create or edit), or null
 * when there's nothing to choose. Built from REAL memberships only — an
 * Admin session never widens a normal user's choices. */
export async function buildPostedBy(
  supabase: SupabaseClient,
  viewerUserId: string,
  opts: { entry?: { user_id: string; author_business_id?: string | null } | null; fromBusinessId?: string | null }
): Promise<MomentPostedByInitial | null> {
  if (!(await hasMomentAuthorship())) return null;
  const { roles, managed } = await getViewerAuthorContext(supabase, viewerUserId);
  const entry = opts.entry ?? null;
  const currentId = entry?.author_business_id ?? null;
  const current = currentId ? (managed.find((b) => b.id === currentId) ?? (await businessOption(currentId))) : null;
  const options = postedByOptions({
    viewerUserId,
    entryUserId: entry ? entry.user_id : null,
    personalLabel: await personLabel(entry ? entry.user_id : viewerUserId),
    managed,
    roles,
    current,
  });
  if (options.length <= 1) return null;
  const value = entry ? currentId : defaultAuthorBusinessId(opts.fromBusinessId, roles);
  return { value, options, adminSearch: false };
}

/** Admin's Posted By: the creator's Personal identity, the current
 * Business, and a search over any Business (Admin authority — never a
 * membership). */
export async function buildAdminPostedBy(entry: { user_id: string; author_business_id?: string | null }): Promise<MomentPostedByInitial | null> {
  if (!(await hasMomentAuthorship())) return null;
  const currentId = entry.author_business_id ?? null;
  const current = currentId ? await businessOption(currentId) : null;
  const options: PostedByOption[] = [{ value: null, label: await personLabel(entry.user_id), imageUrl: null, kind: "person" }];
  if (current) options.push({ value: current.id, label: current.name, imageUrl: current.logoUrl, kind: "business" });
  return { value: currentId, options, adminSearch: true };
}

async function businessOption(id: string): Promise<ManagedBusinessOption | null> {
  const admin = getAdminSupabase();
  if (!admin) return null;
  const { data } = await admin.from("businesses").select("id, name, logo_url").eq("id", id).maybeSingle();
  return data ? { id: data.id as string, name: data.name as string, logoUrl: (data.logo_url as string | null) ?? null } : null;
}

async function personLabel(userId: string): Promise<string> {
  const admin = getAdminSupabase();
  if (!admin) return "Personal";
  const { data } = await admin.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  return safeAuthorName((data as { display_name: string | null } | null)?.display_name) ?? "Personal";
}
