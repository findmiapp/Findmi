// Journal Distribution V1 — AUTHOR PUBLISHES, FINDMI DISTRIBUTES.
//
// A Journal entry that its author made public + published is eligible to
// surface on every public FindMi object it is structurally connected to —
// no approval from the connected Business/Event/Location/Product. This
// module is the ONE read path for those public collections.
//
// Connection semantics (unchanged, read-only here):
//   business / product / event  -> journal_entry_connections.{business,product,event}_id
//   event (rollup)              -> ALSO journal_entry_connections.event_occurrence_id
//                                  for any occurrence of that event (resolved at read
//                                  time — never a duplicated connection row)
//   location                    -> journal_entries.location_id, EXACT place only
//                                  (no manual-location text matching, no descendants)
//
// Security: reads use the anon client, so RLS alone decides visibility
// (only visibility='public' AND status='published' rows are readable by
// anon) — the explicit filters below restate that, they never widen it.
// Using the anon client (not the cookie-bound session client) also keeps
// the 60s-ISR entity pages cacheable and guarantees an owner never sees
// their own private/draft entry distributed onto a public page. Media stay
// in the private journal-media bucket: exactly ONE cover per card is
// signed, server-side, via the existing batched resolveSignedUrls.
import { getSupabase } from "./supabase";
import { resolveSignedUrls } from "./journal";
import { journalByline, resolveJournalAuthorNames } from "./journal-author";

export type JournalSubjectType = "business" | "event" | "location" | "product";

export interface PublicJournalCard {
  id: string;
  title: string;
  entryDate: string;
  entryTime: string | null;
  excerpt: string | null;
  authorLabel: string | null;
  coverUrl: string | null;
  photoCount: number;
  locationName: string | null;
}

export interface PublicJournalPage {
  entries: PublicJournalCard[];
  /** Opaque keyset cursor for the next (older) page, or null at the end. */
  nextCursor: string | null;
  /** Exact eligible total — only computed when `withCount` was requested
   * (first page), else null. */
  total: number | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY: PublicJournalPage = { entries: [], nextCursor: null, total: null };

/** cursor = "<entry_date>_<id>" of the last row shown. Strictly validated
 * because both parts are interpolated into a PostgREST or() filter. */
function parseCursor(cursor: string | null | undefined): { date: string; id: string } | null {
  if (!cursor) return null;
  const [date, id] = cursor.split("_");
  if (!date || !id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !UUID_RE.test(id)) return null;
  return { date, id };
}

function toExcerpt(notes: string | null): string | null {
  const text = notes?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > 140 ? `${text.slice(0, 137).trimEnd()}…` : text;
}

/** Public, published Journal entries connected to one public object,
 * newest experience first (entry_date desc, then id desc — deterministic),
 * with keyset pagination. Eligibility is filtered IN the query (an inner
 * join on the connection), never by fetching a few connection rows and
 * filtering afterwards, so a page is always full when enough eligible
 * entries exist. Each entry appears once even when it reaches the subject
 * through several connections (e.g. an Event AND one of its dates):
 * PostgREST returns parent rows once per inner join, and ids are also
 * de-duplicated defensively. */
export async function getPublicJournalCollection({
  subjectType,
  subjectId,
  limit = 6,
  cursor,
  withCount = false,
}: {
  /** "author": subjectId is the author's user id (server-resolved from a
   * public entry — see resolvePublicJournalAuthor; never from the URL). */
  subjectType: JournalSubjectType | "author";
  subjectId: string;
  limit?: number;
  cursor?: string | null;
  withCount?: boolean;
}): Promise<PublicJournalPage> {
  const supabase = getSupabase();
  if (!supabase || !UUID_RE.test(subjectId)) return EMPTY;
  const pageSize = Math.max(1, Math.min(limit, 48));

  // Event rollup: the event's own dates, so an entry tagged to a single
  // occurrence also belongs to its parent Event's collection.
  let occurrenceIds: string[] = [];
  if (subjectType === "event") {
    const { data: occ } = await supabase.from("event_occurrences").select("id").eq("event_id", subjectId);
    occurrenceIds = (occ ?? []).map((o) => o.id as string).filter((id) => UUID_RE.test(id));
  }

  const viaConnection = subjectType !== "location" && subjectType !== "author";
  const columns =
    "id, user_id, title, entry_date, entry_time, notes, author_label, location:locations(name)" +
    (viaConnection ? ", journal_entry_connections!inner(id)" : "");

  let query = supabase
    .from("journal_entries")
    .select(columns, withCount ? { count: "exact" } : undefined)
    .eq("visibility", "public")
    .eq("status", "published");

  if (subjectType === "author") {
    query = query.eq("user_id", subjectId);
  } else if (subjectType === "location") {
    query = query.eq("location_id", subjectId);
  } else if (subjectType === "event" && occurrenceIds.length > 0) {
    query = query.or(`event_id.eq.${subjectId},event_occurrence_id.in.(${occurrenceIds.join(",")})`, {
      referencedTable: "journal_entry_connections",
    });
  } else {
    query = query.eq(`journal_entry_connections.${subjectType}_id`, subjectId);
  }

  const after = parseCursor(cursor);
  if (after) {
    query = query.or(`entry_date.lt.${after.date},and(entry_date.eq.${after.date},id.lt.${after.id})`);
  }

  const { data, count, error } = await query
    .order("entry_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1);
  if (error || !data) return EMPTY;

  type Row = {
    id: string;
    user_id: string;
    title: string;
    entry_date: string;
    entry_time: string | null;
    notes: string | null;
    author_label: string | null;
    location: { name: string } | { name: string }[] | null;
  };
  const seen = new Set<string>();
  const rows = (data as unknown as Row[]).filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  const hasMore = rows.length > pageSize;
  const pageRows = rows.slice(0, pageSize);
  if (pageRows.length === 0) return { entries: [], nextCursor: null, total: withCount ? (count ?? 0) : null };

  // Cover + photo count: one metadata query for the page, then sign ONLY
  // one cover per entry (never full galleries) in one batched call.
  const { data: mediaRows } = await supabase
    .from("journal_entry_media")
    .select("journal_entry_id, storage_path, is_cover, display_order")
    .in(
      "journal_entry_id",
      pageRows.map((r) => r.id)
    );
  const mediaByEntry = new Map<string, { storage_path: string; is_cover: boolean; display_order: number }[]>();
  for (const m of mediaRows ?? []) {
    const list = mediaByEntry.get(m.journal_entry_id) ?? [];
    list.push(m);
    mediaByEntry.set(m.journal_entry_id, list);
  }
  const coverPathByEntry = new Map<string, string>();
  for (const [entryId, list] of mediaByEntry) {
    const cover = list.find((m) => m.is_cover) ?? [...list].sort((a, b) => a.display_order - b.display_order)[0];
    if (cover) coverPathByEntry.set(entryId, cover.storage_path);
  }
  const [signed, authorNames] = await Promise.all([
    resolveSignedUrls([...coverPathByEntry.values()]),
    resolveJournalAuthorNames(pageRows.map((r) => r.user_id)),
  ]);

  const entries: PublicJournalCard[] = pageRows.map((r) => {
    const location = Array.isArray(r.location) ? (r.location[0] ?? null) : r.location;
    const coverPath = coverPathByEntry.get(r.id);
    return {
      id: r.id,
      title: r.title,
      entryDate: r.entry_date,
      entryTime: r.entry_time,
      excerpt: toExcerpt(r.notes),
      authorLabel: journalByline(authorNames.get(r.user_id), r.author_label),
      coverUrl: coverPath ? (signed.get(coverPath) ?? null) : null,
      photoCount: mediaByEntry.get(r.id)?.length ?? 0,
      locationName: location?.name ?? null,
    };
  });

  const last = pageRows[pageRows.length - 1];
  return {
    entries,
    nextCursor: hasMore ? `${last.entry_date}_${last.id}` : null,
    total: withCount ? (count ?? null) : null,
  };
}

/** Public distribution copy: Journal entries surface as "Moments" on
 * Businesses, Events, Locations and Products (Journal stays the creation
 * system's name). Presentation only. */
export function momentsHeading(subjectType: JournalSubjectType, name: string): string {
  if (subjectType === "event") return `Moments from ${name}`;
  if (subjectType === "location") return `Moments at ${name}`;
  return `Moments with ${name}`;
}

/** /journal?{subject}=<slug> — the "See all" destination for each surface. */
export function journalCollectionHref(subjectType: JournalSubjectType, slug: string): string {
  return `/journal?${subjectType}=${encodeURIComponent(slug)}`;
}
