// Journal V1 — the reusable Findmi experience-memory layer. A Journal
// Entry belongs to the USER (profiles.id === auth.users.id, the same
// canonical identity every account_saved_*/account_followed_* table
// already uses — see 20260901010000_account_foundation.sql and
// 20260901020000_account_saved_and_followed.sql), never to any Business/
// Location/Product/Event it's connected to. Connected objects do not gain
// any permission over the entry by being connected (see
// journal_entry_connections' own migration comment).
//
// Security model (two layers, see the foundation migration's own
// checkpoint note for the full reasoning):
//   1. journal_entries/journal_entry_media/journal_entry_connections RLS —
//      an owner sees everything of their own (draft or published, private
//      or public); anyone else (including anonymous) sees only a
//      published, public row. Every read helper below uses the
//      session-scoped client (getServerSupabase()) so RLS resolves
//      correctly for whoever is actually asking.
//   2. journal-media Storage — a private bucket, no public URL. A signed
//      URL is only ever generated (via the service-role client, which is
//      the only client capable of signing) for a storage_path that
//      already passed through a layer-1-gated row read. A client can never
//      reach a private object merely by knowing its path.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "./supabase/server";
import { getAdminSupabase } from "./admin/supabase-admin";
import { validateImageFile } from "./imageUploadValidation";

export const JOURNAL_MEDIA_BUCKET = "journal-media";
// Long enough that a page render's signed URLs stay valid through normal
// viewing/scrolling; short enough that a leaked link doesn't stay useful
// for long. Re-signed fresh on every render — never cached across requests.
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type JournalVisibility = "private" | "public";
export type JournalStatus = "draft" | "published";

export interface JournalEntryRow {
  id: string;
  user_id: string;
  title: string;
  entry_date: string;
  entry_time: string | null;
  notes: string | null;
  location_id: string | null;
  // Journal V1.1 — manual (non-canonical) location, for a place that
  // doesn't exist as a FindMi Location yet. Always null when location_id
  // is set (the Create/Edit flows only ever populate one or the other —
  // see JournalLocationPicker.tsx); never promoted into public.locations
  // by any part of this app.
  manual_location_name: string | null;
  manual_location_address: string | null;
  manual_location_city: string | null;
  manual_location_state: string | null;
  manual_location_zip: string | null;
  manual_location_suggested: boolean;
  visibility: JournalVisibility;
  status: JournalStatus;
  created_at: string;
  updated_at: string;
  // Journal Pass 1 — nullable author attribution ("By Findmi"). See the
  // migration's own comment for why this is a single plain column rather
  // than any author/publisher/organization architecture.
  author_label: string | null;
}

export interface JournalEntryMediaRow {
  id: string;
  journal_entry_id: string;
  storage_path: string;
  display_order: number;
  is_cover: boolean;
  caption: string | null;
  created_at: string;
}

export interface JournalMediaWithUrl extends JournalEntryMediaRow {
  url: string | null;
}

export interface JournalConnectionRow {
  id: string;
  journal_entry_id: string;
  business_id: string | null;
  product_id: string | null;
  event_id: string | null;
  // Journal V2 Pass 2 — which specific Event Occurrence this experience
  // relates to, independent of (and additional to) the parent event_id
  // connection above — see the journal_event_occurrence_connection
  // migration's own header note on why these are two separate rows rather
  // than one column changing meaning.
  event_occurrence_id: string | null;
}

export interface JournalLocationRef {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  state: string | null;
  address: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
}

export interface JournalBusinessRef {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
}

export interface JournalProductRef {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  business: { name: string; slug: string } | null;
}

export interface JournalEventRef {
  id: string;
  name: string;
  slug: string;
  cover_image_url: string | null;
  start_at: string;
  city: string | null;
  state: string | null;
}

/** Journal V2 Pass 2 — canonical Event Occurrence data for an
 * occurrence-backed Journal entry: just enough (id, parent event_id,
 * start_at/end_at, location_id) for a future Experience Context UI to
 * describe "A Cup of Love, Thu Oct 1, Hudson Yards" without that UI
 * needing a second round trip to events/locations — this pass only
 * resolves the data, it does not render it anywhere new. */
export interface JournalOccurrenceRef {
  id: string;
  event_id: string;
  start_at: string;
  end_at: string;
  location_id: string | null;
  // Journal V2 Pass 2B — the occurrence's own IANA timezone (every
  // event_occurrences row carries one), needed to render its date/time
  // correctly rather than assuming a fixed zone — see
  // JournalConnectionsPicker's own formatOccurrenceDate/Time.
  timezone: string;
}

export interface JournalEntryWithRelations {
  entry: JournalEntryRow;
  media: JournalMediaWithUrl[];
  location: JournalLocationRef | null;
  businesses: JournalBusinessRef[];
  products: JournalProductRef[];
  events: JournalEventRef[];
  // Zero or more — the schema allows more than one occurrence connection
  // per entry (same "one row per connected object" shape as businesses/
  // products/events), though every current creation path attaches at
  // most one.
  occurrences: JournalOccurrenceRef[];
  isOwner: boolean;
}

/** The current signed-in user's id, or null — reads the real session via
 * the request-scoped client, never trusts a client-supplied id. */
export async function getCurrentUserId(): Promise<string | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Batched signed-URL resolution — ONE storage call for however many paths
 * are passed (createSignedUrls), never one call per photo. Returns null
 * for any path that failed to sign (a deleted/missing object) rather than
 * throwing, so one bad row never breaks an entire gallery. */
export async function resolveSignedUrls(paths: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (paths.length === 0) return result;
  const admin = getAdminSupabase();
  if (!admin) return result;
  const { data } = await admin.storage.from(JOURNAL_MEDIA_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) result.set(row.path, row.signedUrl);
  }
  return result;
}

async function attachSignedUrls(media: JournalEntryMediaRow[]): Promise<JournalMediaWithUrl[]> {
  const urls = await resolveSignedUrls(media.map((m) => m.storage_path));
  return media.map((m) => ({ ...m, url: urls.get(m.storage_path) ?? null }));
}

/** One Journal Entry plus everything its Detail page needs, resolved
 * through the session-scoped client so RLS alone decides visibility — the
 * owner sees their own entry regardless of visibility/status; anyone else
 * sees it only if it's published and public. Returns null for a
 * nonexistent entry OR one this caller isn't allowed to see (RLS makes the
 * two indistinguishable, which is the correct, non-leaking behavior — a
 * private entry's existence is never confirmed to a non-owner). */
export async function getJournalEntryWithRelations(entryId: string): Promise<JournalEntryWithRelations | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: entry } = await supabase.from("journal_entries").select("*").eq("id", entryId).maybeSingle();
  if (!entry) return null;

  const [{ data: mediaRows }, { data: connectionRows }, locationResult] = await Promise.all([
    supabase.from("journal_entry_media").select("*").eq("journal_entry_id", entryId).order("display_order", { ascending: true }),
    supabase.from("journal_entry_connections").select("*").eq("journal_entry_id", entryId),
    entry.location_id
      ? supabase
          .from("locations")
          .select("id, name, slug, city, state, address, logo_url, cover_image_url")
          .eq("id", entry.location_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const media = await attachSignedUrls((mediaRows ?? []) as JournalEntryMediaRow[]);
  const connections = (connectionRows ?? []) as JournalConnectionRow[];
  const { businesses, products, events, occurrences } = await resolveConnectedObjects(connections, supabase);

  return {
    entry: entry as JournalEntryRow,
    media,
    location: (locationResult.data as JournalLocationRef | null) ?? null,
    businesses,
    products,
    events,
    occurrences,
    isOwner: Boolean(user && user.id === entry.user_id),
  };
}

/** Journal Pass 1 — admin-only variant of getJournalEntryWithRelations,
 * read entirely through the service-role client instead of the session-
 * scoped one, so it works regardless of the caller's own Supabase auth
 * state (an admin-password session carries no Supabase user at all) and
 * regardless of the entry's owner/visibility/status — including an
 * unpublished draft, which the public/owner RLS paths would never return
 * to anyone but the real owner. Callers MUST already have verified admin
 * authorization before calling this (see /admin/journal/[id]/page.tsx) —
 * it performs no authorization itself, exactly like every other
 * getAdminSupabase() consumer in this codebase. `isOwner` is always true
 * here: the one call site (the admin editor) never reads it, since the
 * JournalEditForm UI itself has no owner-vs-admin branch. */
export async function getJournalEntryWithRelationsForAdmin(entryId: string): Promise<JournalEntryWithRelations | null> {
  const admin = getAdminSupabase();
  if (!admin) return null;

  const { data: entry } = await admin.from("journal_entries").select("*").eq("id", entryId).maybeSingle();
  if (!entry) return null;

  const [{ data: mediaRows }, { data: connectionRows }, locationResult] = await Promise.all([
    admin.from("journal_entry_media").select("*").eq("journal_entry_id", entryId).order("display_order", { ascending: true }),
    admin.from("journal_entry_connections").select("*").eq("journal_entry_id", entryId),
    entry.location_id
      ? admin
          .from("locations")
          .select("id, name, slug, city, state, address, logo_url, cover_image_url")
          .eq("id", entry.location_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const media = await attachSignedUrls((mediaRows ?? []) as JournalEntryMediaRow[]);
  const connections = (connectionRows ?? []) as JournalConnectionRow[];
  const { businesses, products, events, occurrences } = await resolveConnectedObjects(connections, admin);

  return {
    entry: entry as JournalEntryRow,
    media,
    location: (locationResult.data as JournalLocationRef | null) ?? null,
    businesses,
    products,
    events,
    occurrences,
    isOwner: true,
  };
}

/** Batched lookup of the real Business/Product/Event rows a set of
 * connections point to — one query per object type total, never one
 * query per connection row (avoids N+1 on a Detail page with many
 * connections). Accepts either the session-scoped or the service-role
 * client (same SupabaseClient-parameter pattern already used elsewhere in
 * this codebase — see lib/handles.ts, lib/admin/categoryForm.ts) so the
 * admin-only variant above can reuse this exact lookup instead of
 * duplicating it. */
async function resolveConnectedObjects(
  connections: JournalConnectionRow[],
  supabase: SupabaseClient
): Promise<{ businesses: JournalBusinessRef[]; products: JournalProductRef[]; events: JournalEventRef[]; occurrences: JournalOccurrenceRef[] }> {
  const businessIds = connections.map((c) => c.business_id).filter((id): id is string => Boolean(id));
  const productIds = connections.map((c) => c.product_id).filter((id): id is string => Boolean(id));
  const eventIds = connections.map((c) => c.event_id).filter((id): id is string => Boolean(id));
  const occurrenceIds = connections.map((c) => c.event_occurrence_id).filter((id): id is string => Boolean(id));
  if (businessIds.length === 0 && productIds.length === 0 && eventIds.length === 0 && occurrenceIds.length === 0) {
    return { businesses: [], products: [], events: [], occurrences: [] };
  }

  const [{ data: businesses }, { data: products }, { data: events }, { data: occurrences }] = await Promise.all([
    businessIds.length
      ? supabase.from("businesses").select("id, name, slug, logo_url").in("id", businessIds)
      : Promise.resolve({ data: [] }),
    productIds.length
      ? supabase.from("products").select("id, name, slug, image_url, business:businesses(name, slug)").in("id", productIds)
      : Promise.resolve({ data: [] }),
    eventIds.length
      ? supabase.from("events").select("id, name, slug, cover_image_url, start_at, city, state").in("id", eventIds)
      : Promise.resolve({ data: [] }),
    occurrenceIds.length
      ? supabase.from("event_occurrences").select("id, event_id, start_at, end_at, location_id, timezone").in("id", occurrenceIds)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    businesses: (businesses ?? []) as JournalBusinessRef[],
    products: ((products ?? []) as (Omit<JournalProductRef, "business"> & { business: JournalProductRef["business"] | JournalProductRef["business"][] | null })[]).map(
      (p) => ({ ...p, business: Array.isArray(p.business) ? (p.business[0] ?? null) : p.business })
    ),
    events: (events ?? []) as JournalEventRef[],
    occurrences: (occurrences ?? []) as JournalOccurrenceRef[],
  };
}

export interface JournalIndexEntry {
  id: string;
  title: string;
  entry_date: string;
  entry_time: string | null;
  visibility: JournalVisibility;
  // Journal V2 Pass 1 — the real database status, returned alongside
  // visibility rather than inferred from it. STATUS (draft/published) and
  // VISIBILITY (private/public) are independent concepts — see this
  // file's own header note on the account model — and My World needs the
  // real value to render an honest Draft treatment and to word a
  // draft+public entry correctly ("Public when published", never bare
  // "Public" before it's actually anonymously resolvable).
  status: JournalStatus;
  coverUrl: string | null;
  photoCount: number;
  location: { name: string } | null;
  hasBusiness: boolean;
  hasProduct: boolean;
  hasEvent: boolean;
}

export type JournalArchiveFilter = "all" | "places" | "brands" | "products" | "events";

/** Journal V2 Pass 1 — the signed-in owner's own full Journal archive: EVERY
 * entry they own, draft or published, unfiltered by time OR object type.
 * This is strictly an OWNER-scoped query (the sole call site is My World,
 * always passed the authenticated session's own user.id — see that page's
 * own comment) — it is never a general/public Journal listing, so
 * returning drafts here does not expose anything: the owner is always
 * allowed to see their own draft/private entries (same RLS/ownership rule
 * the Detail page's own getJournalEntryWithRelations already relies on),
 * and nothing about the PUBLIC resolver changes. A draft must never
 * disappear from the owner's own Journal just because it hasn't been
 * published yet (see this pass's own locked state model) — previously
 * `.eq("status", "published")` here did exactly that.
 *
 * The archive page applies BOTH the Day/Week/Month/Year time-window
 * slicing AND the "All experiences/Places/Brands/Products/Events"
 * object-type filter over this one already-fetched array in plain JS (see
 * lib/journalArchive.ts's filterByObjectType and entriesFor*), rather than
 * re-querying per view/period/filter — still exactly the same fixed number
 * of batched queries (entries once, media once, connections once, signed
 * URLs once) no matter how many periods a visitor pages through in one
 * request, and still zero N+1 regardless of how many entries exist. */
export async function getJournalArchiveEntries(userId: string, options?: { limit?: number }): Promise<JournalIndexEntry[]> {
  const supabase = await getServerSupabase();
  let query = supabase
    .from("journal_entries")
    .select(
      "id, title, entry_date, entry_time, visibility, status, location_id, manual_location_name, manual_location_city, location:locations(name)"
    )
    .eq("user_id", userId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  // Personal Home V2 — optional bound (Home shows the 3 most recent), so
  // media/connections/cover signing only run for the entries shown. No
  // limit (every existing caller) is the unchanged full archive.
  if (options?.limit) query = query.limit(options.limit);
  const { data: entries } = await query;
  if (!entries || entries.length === 0) return [];

  const entryIds = entries.map((e) => e.id);
  const [{ data: mediaRows }, { data: connectionRows }] = await Promise.all([
    supabase.from("journal_entry_media").select("journal_entry_id, storage_path, is_cover, display_order").in("journal_entry_id", entryIds),
    supabase.from("journal_entry_connections").select("journal_entry_id, business_id, product_id, event_id").in("journal_entry_id", entryIds),
  ]);

  const mediaByEntry = new Map<string, { storage_path: string; is_cover: boolean; display_order: number }[]>();
  for (const row of mediaRows ?? []) {
    const list = mediaByEntry.get(row.journal_entry_id) ?? [];
    list.push(row);
    mediaByEntry.set(row.journal_entry_id, list);
  }
  const connectionsByEntry = new Map<string, { business: boolean; product: boolean; event: boolean }>();
  for (const row of connectionRows ?? []) {
    const existing = connectionsByEntry.get(row.journal_entry_id) ?? { business: false, product: false, event: false };
    if (row.business_id) existing.business = true;
    if (row.product_id) existing.product = true;
    if (row.event_id) existing.event = true;
    connectionsByEntry.set(row.journal_entry_id, existing);
  }

  const coverPaths: string[] = [];
  for (const [, list] of mediaByEntry) {
    const cover = list.find((m) => m.is_cover) ?? [...list].sort((a, b) => a.display_order - b.display_order)[0];
    if (cover) coverPaths.push(cover.storage_path);
  }
  const signedUrls = await resolveSignedUrls(coverPaths);

  return entries.map((e) => {
    const list = mediaByEntry.get(e.id) ?? [];
    const cover = list.find((m) => m.is_cover) ?? [...list].sort((a, b) => a.display_order - b.display_order)[0];
    const connections = connectionsByEntry.get(e.id);
    const canonicalLocation = Array.isArray(e.location) ? (e.location[0] ?? null) : e.location;
    const locationName = canonicalLocation?.name ?? e.manual_location_name ?? e.manual_location_city ?? null;
    return {
      id: e.id,
      title: e.title,
      entry_date: e.entry_date,
      entry_time: e.entry_time,
      visibility: e.visibility as JournalVisibility,
      status: e.status as JournalStatus,
      coverUrl: cover ? (signedUrls.get(cover.storage_path) ?? null) : null,
      photoCount: list.length,
      location: locationName ? { name: locationName } : null,
      hasBusiness: Boolean(connections?.business),
      hasProduct: Boolean(connections?.product),
      hasEvent: Boolean(connections?.event),
    };
  });
}

/** Ownership-verified single entry for the Create/Edit flows (always the
 * full row regardless of status, since an owner editing their own draft or
 * published entry needs to see everything). Returns null if the entry
 * doesn't exist or isn't owned by this user — RLS already enforces this at
 * the database level; this is the same check surfaced as a plain boolean
 * for callers that need to redirect/error rather than silently returning
 * an empty page. */
export async function getOwnJournalEntryOrNull(entryId: string, userId: string): Promise<JournalEntryWithRelations | null> {
  const result = await getJournalEntryWithRelations(entryId);
  if (!result || result.entry.user_id !== userId) return null;
  return result;
}

/** Validates that a supplied Location/Business/Product/Event id is real
 * and genuinely publicly visible before it's ever written into a Journal
 * connection — a consumer can connect their entry to any legitimate
 * Findmi object, but never to an invented or non-public one. Mirrors the
 * same is_demo/publication_status liveness gate every public page already
 * applies. */
export async function validateConnectableObject(
  kind: "location" | "business" | "product" | "event",
  id: string
): Promise<boolean> {
  const supabase = await getServerSupabase();
  if (kind === "location") {
    const { data } = await supabase.from("locations").select("id").eq("id", id).eq("is_demo", false).maybeSingle();
    return Boolean(data);
  }
  if (kind === "business") {
    const { data } = await supabase.from("businesses").select("id").eq("id", id).eq("is_demo", false).eq("publication_status", "live").maybeSingle();
    return Boolean(data);
  }
  if (kind === "product") {
    const { data } = await supabase
      .from("products")
      .select("id, business:businesses(is_demo, publication_status)")
      .eq("id", id)
      .eq("is_active", true)
      .maybeSingle();
    if (!data) return false;
    const business = Array.isArray(data.business) ? (data.business[0] ?? null) : data.business;
    return Boolean(business && !business.is_demo && business.publication_status === "live");
  }
  const { data } = await supabase.from("events").select("id").eq("id", id).eq("is_demo", false).maybeSingle();
  return Boolean(data);
}

/** Public distribution of Journal entries onto Business/Event/Location/
 * Product pages lives in lib/journal-distribution.ts
 * (getPublicJournalCollection) — it replaced the never-wired
 * getPublicJournalEntriesForObject, which pre-limited connection rows
 * before filtering for public/published, missed occurrence -> Event
 * rollup, and couldn't paginate. */

export { validateImageFile };
