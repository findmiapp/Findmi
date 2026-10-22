import { NO_MOMENT_DISPLAY, getEntityMomentDisplay } from "./entity-moment-display";
import { getAdminSupabase } from "./admin/supabase-admin";
import { hasMomentAuthorship, resolveMomentAuthors, authorColumn } from "./moment-authorship";
import { resolveSignedUrls } from "./journal";

/** The Business Manager's Moments — MOMENTS CONNECTED TO THIS BUSINESS, not
 * only Moments it authored. A Moment keeps its canonical author (a Person,
 * Findmi, or a Business — journal_entries.user_id / author_business_id /
 * author_label); this only READS, through the same structural connections the
 * public pages use, and never changes who owns a Moment:
 *
 *   us        author_business_id = this Business (every status — it's theirs)
 *   tagged    journal_entry_connections.business_id = this Business — exactly
 *             what the public Business page's Moments section shows
 *   event     connected (event_id, or one of its dates) to an Event this
 *             Business is approved for or hosts
 *   location  journal_entries.location_id is one of this Business's Our
 *             Locations (exact place, same rule the public Location page uses)
 *
 * Visibility: another author's Moment appears ONLY once it is public and
 * published (RLS-equivalent, restated here because this read uses the
 * service role); the viewer's own Moments and the Business's own Moments
 * appear in any status. The caller must already have authorized the viewer
 * for this Business (requireBusinessMember on the page). Read-only. */

export type MomentRelation = "us" | "tagged" | "event" | "location";
export type MomentFilter = "all" | "us" | "connected" | "events" | "locations";
export const MOMENT_FILTERS: readonly MomentFilter[] = ["all", "us", "connected", "events", "locations"];
export const MOMENT_FILTER_LABELS: Record<MomentFilter, string> = {
  all: "All",
  us: "By Us",
  connected: "Connected",
  events: "Events",
  locations: "Locations",
};
export const isMomentFilter = (v: unknown): v is MomentFilter => typeof v === "string" && (MOMENT_FILTERS as readonly string[]).includes(v);

export interface BusinessMoment {
  id: string;
  title: string;
  entryDate: string;
  status: string;
  visibility: string;
  coverUrl: string | null;
  photoCount: number;
  locationName: string | null;
  /** Who the Moment belongs to (canonical author), when it can be shown. */
  author: { kind: "person" | "business"; name: string } | null;
  relations: MomentRelation[];
  /** Authored by this Business. */
  byUs: boolean;
  /** Written by the signed-in viewer personally. */
  mine: boolean;
  /** Appears in the Moments section of this Business's PUBLIC profile. */
  onProfile: boolean;
  /** Could appear there: tagged to this Business, public and published. Only
   * such a Moment has a profile display choice to make. */
  profileEligible: boolean;
  /** This Business has chosen to hide it from its profile (a display
   * preference — see lib/entity-moment-display.ts; the Moment is untouched). */
  profileHidden: boolean;
  /** This Business shows it first on its profile (at most one). */
  profileFeatured: boolean;
}

export interface BusinessMomentsResult {
  moments: BusinessMoment[];
  counts: Record<MomentFilter, number>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuids = (ids: Iterable<string | null | undefined>) => [...new Set([...ids].filter((v): v is string => typeof v === "string" && UUID_RE.test(v)))];
const chunk = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const POOL = 400;

type EntryRow = {
  id: string;
  user_id: string;
  title: string;
  entry_date: string;
  status: string;
  visibility: string;
  author_label: string | null;
  author_business_id?: string | null;
  manual_location_name: string | null;
  manual_location_city: string | null;
  location: { name: string } | { name: string }[] | null;
};

export function countMoments(moments: Pick<BusinessMoment, "byUs" | "relations">[]): Record<MomentFilter, number> {
  return {
    all: moments.length,
    us: moments.filter((m) => m.byUs).length,
    connected: moments.filter((m) => !m.byUs).length,
    events: moments.filter((m) => m.relations.includes("event")).length,
    locations: moments.filter((m) => m.relations.includes("location")).length,
  };
}

export function filterMoments<T extends Pick<BusinessMoment, "byUs" | "relations">>(moments: T[], filter: MomentFilter): T[] {
  if (filter === "us") return moments.filter((m) => m.byUs);
  if (filter === "connected") return moments.filter((m) => !m.byUs);
  if (filter === "events") return moments.filter((m) => m.relations.includes("event"));
  if (filter === "locations") return moments.filter((m) => m.relations.includes("location"));
  return moments;
}

export async function getBusinessMoments(
  businessId: string,
  options?: { limit?: number; viewerUserId?: string | null; /** Also read this Business's profile display preferences (the Moments view). */ withDisplay?: boolean }
): Promise<BusinessMomentsResult> {
  const empty: BusinessMomentsResult = { moments: [], counts: countMoments([]) };
  const admin = getAdminSupabase();
  if (!admin || !UUID_RE.test(businessId)) return empty;
  // Both are cached schema probes (one read per server instance), so they only
  // cost anything on the first call — and then side by side.
  const [authorship, authorCol] = await Promise.all([hasMomentAuthorship(), authorColumn()]);
  const viewer = options?.viewerUserId && UUID_RE.test(options.viewerUserId) ? options.viewerUserId : null;
  const cols = "id, user_id, title, entry_date, status, visibility, author_label, manual_location_name, manual_location_city, location:locations(name)" + authorCol;

  // ── which entries relate to this Business, and how ──
  const relations = new Map<string, Set<MomentRelation>>();
  const add = (id: string, r: MomentRelation) => relations.set(id, (relations.get(id) ?? new Set()).add(r));

  // Round trip 1 — everything that depends on nothing but the Business. Its own
  // entries ride along here: they need no relation lookup, so there is no
  // reason to read them after the others.
  const noRows = Promise.resolve({ data: null });
  const [taggedRes, approvedEvents, hostedEvents, ourLocations, ownRes, momentDisplay] = await Promise.all([
    admin.from("journal_entry_connections").select("journal_entry_id").eq("business_id", businessId).limit(POOL),
    admin.from("event_businesses").select("event_id").eq("business_id", businessId).eq("status", "approved").limit(200),
    admin.from("events").select("id").eq("host_business_id", businessId).limit(100),
    admin.from("business_locations").select("location_id").eq("business_id", businessId).limit(100),
    authorship ? admin.from("journal_entries").select(cols).eq("author_business_id", businessId).order("entry_date", { ascending: false }).limit(POOL) : noRows,
    options?.withDisplay ? getEntityMomentDisplay(admin, "business", businessId) : Promise.resolve(NO_MOMENT_DISPLAY),
  ]);
  const hidden = new Set(momentDisplay.hidden);
  for (const r of (taggedRes.data ?? []) as { journal_entry_id: string }[]) add(r.journal_entry_id, "tagged");

  const eventIds = uuids([...((approvedEvents.data ?? []) as { event_id: string }[]).map((r) => r.event_id), ...((hostedEvents.data ?? []) as { id: string }[]).map((r) => r.id)]);
  const locationIds = uuids(((ourLocations.data ?? []) as { location_id: string }[]).map((r) => r.location_id));

  // Round trip 2 — entries connected to those Events (to the Event itself, or
  // to any of its dates through an inner join, so no separate "which dates?"
  // lookup is needed first), and public entries at the Business's own
  // Locations. All three are independent.
  const [eventConns, occurrenceConns, atPlace] = await Promise.all([
    eventIds.length > 0 ? admin.from("journal_entry_connections").select("journal_entry_id").in("event_id", eventIds).limit(POOL) : noRows,
    eventIds.length > 0
      ? admin.from("journal_entry_connections").select("journal_entry_id, event_occurrences!inner(event_id)").in("event_occurrences.event_id", eventIds).limit(POOL)
      : noRows,
    locationIds.length > 0
      ? admin.from("journal_entries").select("id").in("location_id", locationIds).eq("visibility", "public").eq("status", "published").limit(POOL)
      : noRows,
  ]);
  for (const r of [...((eventConns.data ?? []) as { journal_entry_id: string }[]), ...((occurrenceConns.data ?? []) as { journal_entry_id: string }[])]) add(r.journal_entry_id, "event");
  for (const r of (atPlace.data ?? []) as { id: string }[]) add(r.id, "location");

  // ── load the entries themselves (visibility enforced here) ──
  const rows = new Map<string, EntryRow>();
  const visible = (r: EntryRow) =>
    (r.visibility === "public" && r.status === "published") || (viewer !== null && r.user_id === viewer) || (authorship && r.author_business_id === businessId);
  for (const r of (ownRes.data ?? []) as unknown as EntryRow[]) {
    rows.set(r.id, r);
    add(r.id, "us");
  }
  const related = uuids(relations.keys()).filter((id) => !rows.has(id));
  const relatedPages = await Promise.all(chunk(related, 150).map((ids) => admin.from("journal_entries").select(cols).in("id", ids)));
  for (const { data } of relatedPages) for (const r of (data ?? []) as unknown as EntryRow[]) if (visible(r)) rows.set(r.id, r);

  const entries = [...rows.values()].filter(visible).sort((a, b) => (a.entry_date === b.entry_date ? (a.id < b.id ? 1 : -1) : a.entry_date < b.entry_date ? 1 : -1));
  const limited = options?.limit ? entries.slice(0, options.limit) : entries;
  if (limited.length === 0) return empty;

  // ── covers + authors (batched, and independent of each other) ──
  const ids = limited.map((r) => r.id);
  const [{ data: mediaRows }, authors] = await Promise.all([
    admin.from("journal_entry_media").select("journal_entry_id, storage_path, is_cover, display_order").in("journal_entry_id", ids),
    resolveMomentAuthors(limited.map((r) => ({ id: r.id, user_id: r.user_id, author_business_id: r.author_business_id ?? null, author_label: r.author_label }))),
  ]);
  const byEntry = new Map<string, { storage_path: string; is_cover: boolean; display_order: number }[]>();
  for (const m of mediaRows ?? []) byEntry.set(m.journal_entry_id, [...(byEntry.get(m.journal_entry_id) ?? []), m]);
  const coverOf = (id: string) => {
    const list = byEntry.get(id) ?? [];
    return list.find((m) => m.is_cover) ?? [...list].sort((a, b) => a.display_order - b.display_order)[0];
  };
  const signed = await resolveSignedUrls(
    ids.flatMap((id) => {
      const c = coverOf(id);
      return c ? [c.storage_path] : [];
    }),
    "card"
  );

  const moments: BusinessMoment[] = limited.map((r) => {
    const cover = coverOf(r.id);
    const loc = Array.isArray(r.location) ? (r.location[0] ?? null) : r.location;
    const rel = [...(relations.get(r.id) ?? [])];
    const author = authors.get(r.id);
    return {
      id: r.id,
      title: r.title,
      entryDate: r.entry_date,
      status: r.status,
      visibility: r.visibility,
      coverUrl: cover ? (signed.get(cover.storage_path) ?? null) : null,
      photoCount: byEntry.get(r.id)?.length ?? 0,
      locationName: loc?.name ?? r.manual_location_name ?? r.manual_location_city ?? null,
      author: author ? { kind: author.kind, name: author.name } : r.author_label ? { kind: "person", name: r.author_label } : null,
      relations: rel,
      byUs: rel.includes("us"),
      mine: viewer !== null && r.user_id === viewer,
      // Exactly the public Business page's rule: a connection to this
      // Business, public and published — unless this Business hid it.
      onProfile: rel.includes("tagged") && r.visibility === "public" && r.status === "published" && !hidden.has(r.id),
      profileEligible: rel.includes("tagged") && r.visibility === "public" && r.status === "published",
      profileHidden: hidden.has(r.id),
      profileFeatured: momentDisplay.featured === r.id,
    };
  });
  return { moments, counts: countMoments(moments) };
}

/** Where a Moment opens: a published one → its public page; a draft the
 * viewer can edit → the editor. Another author's draft never reaches here. */
export function momentHref(m: Pick<BusinessMoment, "id" | "status">): string {
  return m.status === "published" ? `/journal/${m.id}` : `/my-world/journal/${m.id}/edit`;
}

export function newMomentHref(businessId: string): string {
  const id = encodeURIComponent(businessId);
  return `/my-world/journal/new?business=${id}&postAs=${id}`;
}
