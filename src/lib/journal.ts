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

export interface JournalEntryWithRelations {
  entry: JournalEntryRow;
  media: JournalMediaWithUrl[];
  location: JournalLocationRef | null;
  businesses: JournalBusinessRef[];
  products: JournalProductRef[];
  events: JournalEventRef[];
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
async function resolveSignedUrls(paths: string[]): Promise<Map<string, string>> {
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
  const { businesses, products, events } = await resolveConnectedObjects(connections);

  return {
    entry: entry as JournalEntryRow,
    media,
    location: (locationResult.data as JournalLocationRef | null) ?? null,
    businesses,
    products,
    events,
    isOwner: Boolean(user && user.id === entry.user_id),
  };
}

/** Batched lookup of the real Business/Product/Event rows a set of
 * connections point to — one query per object type total, never one
 * query per connection row (avoids N+1 on a Detail page with many
 * connections). */
async function resolveConnectedObjects(
  connections: JournalConnectionRow[]
): Promise<{ businesses: JournalBusinessRef[]; products: JournalProductRef[]; events: JournalEventRef[] }> {
  const businessIds = connections.map((c) => c.business_id).filter((id): id is string => Boolean(id));
  const productIds = connections.map((c) => c.product_id).filter((id): id is string => Boolean(id));
  const eventIds = connections.map((c) => c.event_id).filter((id): id is string => Boolean(id));
  if (businessIds.length === 0 && productIds.length === 0 && eventIds.length === 0) {
    return { businesses: [], products: [], events: [] };
  }

  const supabase = await getServerSupabase();
  const [{ data: businesses }, { data: products }, { data: events }] = await Promise.all([
    businessIds.length
      ? supabase.from("businesses").select("id, name, slug, logo_url").in("id", businessIds)
      : Promise.resolve({ data: [] }),
    productIds.length
      ? supabase.from("products").select("id, name, slug, image_url, business:businesses(name, slug)").in("id", productIds)
      : Promise.resolve({ data: [] }),
    eventIds.length
      ? supabase.from("events").select("id, name, slug, cover_image_url, start_at, city, state").in("id", eventIds)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    businesses: (businesses ?? []) as JournalBusinessRef[],
    products: ((products ?? []) as (Omit<JournalProductRef, "business"> & { business: JournalProductRef["business"] | JournalProductRef["business"][] | null })[]).map(
      (p) => ({ ...p, business: Array.isArray(p.business) ? (p.business[0] ?? null) : p.business })
    ),
    events: (events ?? []) as JournalEventRef[],
  };
}

export interface JournalIndexEntry {
  id: string;
  title: string;
  entry_date: string;
  entry_time: string | null;
  visibility: JournalVisibility;
  coverUrl: string | null;
  photoCount: number;
  location: { name: string } | null;
  hasBusiness: boolean;
  hasProduct: boolean;
  hasEvent: boolean;
}

export type JournalArchiveFilter = "all" | "places" | "brands" | "products" | "events";

/** Journal V1.1 — the signed-in owner's own full Journal archive: EVERY
 * published entry (a draft is still-in-progress, never listed — see the
 * Create flow's own note on resuming later), unfiltered by time OR
 * object type. The archive page applies BOTH the Day/Week/Month/Year
 * time-window slicing AND the "All experiences/Places/Brands/Products/
 * Events" object-type filter over this one already-fetched array in
 * plain JS (see lib/journalArchive.ts's filterByObjectType and
 * entriesFor*), rather than re-querying per view/period/filter — still
 * exactly the same fixed number of batched queries (entries once, media
 * once, connections once, signed URLs once) no matter how many periods a
 * visitor pages through in one request, and still zero N+1 regardless of
 * how many entries exist. Returning the type filter unapplied here (unlike
 * the old getJournalIndexForUser this replaces) is what lets the archive
 * page tell "nothing in this Journal at all" apart from "nothing matches
 * this filter" without a second query. */
export async function getJournalArchiveEntries(userId: string): Promise<JournalIndexEntry[]> {
  const supabase = await getServerSupabase();
  const { data: entries } = await supabase
    .from("journal_entries")
    .select(
      "id, title, entry_date, entry_time, visibility, location_id, manual_location_name, manual_location_city, location:locations(name)"
    )
    .eq("user_id", userId)
    .eq("status", "published")
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
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

/** Future surfacing — the reusable query helper future Business/Product/
 * Location/Event pages will call to show "Experiences" (real public
 * Journal Entries connected to this object). Built now, per this pass's
 * own architecture requirement, but not rendered anywhere yet. */
export async function getPublicJournalEntriesForObject(
  kind: "location" | "business" | "product" | "event",
  objectId: string,
  limit = 12
): Promise<JournalIndexEntry[]> {
  const supabase = await getServerSupabase();
  const column = kind === "location" ? "location_id" : `${kind}_id`;

  let entryIds: string[];
  if (kind === "location") {
    const { data } = await supabase.from("journal_entries").select("id").eq("location_id", objectId).eq("visibility", "public").eq("status", "published").limit(limit);
    entryIds = (data ?? []).map((r) => r.id);
  } else {
    const { data } = await supabase.from("journal_entry_connections").select("journal_entry_id").eq(column, objectId).limit(limit);
    entryIds = (data ?? []).map((r) => r.journal_entry_id);
  }
  if (entryIds.length === 0) return [];

  const { data: entries } = await supabase
    .from("journal_entries")
    .select("id, title, entry_date, entry_time, visibility, location_id, location:locations(name)")
    .in("id", entryIds)
    .eq("visibility", "public")
    .eq("status", "published")
    .order("entry_date", { ascending: false })
    .limit(limit);
  if (!entries || entries.length === 0) return [];

  const { data: mediaRows } = await supabase
    .from("journal_entry_media")
    .select("journal_entry_id, storage_path, is_cover, display_order")
    .in(
      "journal_entry_id",
      entries.map((e) => e.id)
    );
  const mediaByEntry = new Map<string, { storage_path: string; is_cover: boolean; display_order: number }[]>();
  for (const row of mediaRows ?? []) {
    const list = mediaByEntry.get(row.journal_entry_id) ?? [];
    list.push(row);
    mediaByEntry.set(row.journal_entry_id, list);
  }
  const coverPaths = [...mediaByEntry.values()].map((list) => (list.find((m) => m.is_cover) ?? [...list].sort((a, b) => a.display_order - b.display_order)[0])?.storage_path).filter((p): p is string => Boolean(p));
  const signedUrls = await resolveSignedUrls(coverPaths);

  return entries.map((e) => {
    const list = mediaByEntry.get(e.id) ?? [];
    const cover = list.find((m) => m.is_cover) ?? [...list].sort((a, b) => a.display_order - b.display_order)[0];
    const location = Array.isArray(e.location) ? (e.location[0] ?? null) : e.location;
    return {
      id: e.id,
      title: e.title,
      entry_date: e.entry_date,
      entry_time: e.entry_time,
      visibility: e.visibility as JournalVisibility,
      coverUrl: cover ? (signedUrls.get(cover.storage_path) ?? null) : null,
      photoCount: list.length,
      location: location ? { name: location.name } : null,
      hasBusiness: false,
      hasProduct: false,
      hasEvent: false,
    };
  });
}

export { validateImageFile };
