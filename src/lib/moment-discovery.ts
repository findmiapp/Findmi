import "server-only";
import { getSupabase } from "./supabase";
import { getAdminSupabase } from "./admin/supabase-admin";
import { resolveSignedUrls } from "./journal";
import { journalByline } from "./journal-author";
import { MAX_COLLAGE_REGIONS, orderPreviewMedia } from "./moment-collage";
import { momentCategoryTags, type MomentFilterKey, type MomentFollowKeys } from "./moment-filters";

// Findmi Moments discovery feed — the public, cross-entity Moment feed for
// the homepage carousel and /moments. Same visibility contract as
// journal-distribution.ts: reads use the ANON client, so RLS decides (only
// visibility='public' AND status='published' rows are readable) and the
// filters below restate that, never widen it. Media stay in the private
// journal-media bucket; at most MAX_COLLAGE_REGIONS preview photos per
// Moment are signed (never full galleries), in ONE batched call.
//
// Order is deterministic: entry_date desc, then id desc ("For You" is the
// newest experiences first — no personalization is claimed). Keyset
// pagination with the same "<entry_date>_<id>" cursor as the entity
// collections.

export interface MomentFeedCard {
  id: string;
  title: string;
  href: string;
  entryDate: string;
  /** Where/what it was: Location, else Event, else Business name. */
  contextLabel: string | null;
  media: { kind: "image"; url: string }[];
  photoCount: number;
  author: { name: string; avatarUrl: string | null } | null;
  /** Category filters this Moment belongs to (real relationships only). */
  tags: MomentFilterKey[];
  /** Public keys for the "Following" filter (matched on this device). */
  follow: MomentFollowKeys;
}

export interface MomentFeedPage {
  cards: MomentFeedCard[];
  nextCursor: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY: MomentFeedPage = { cards: [], nextCursor: null };

function parseCursor(cursor: string | null | undefined): { date: string; id: string } | null {
  if (!cursor) return null;
  const [date, id] = cursor.split("_");
  if (!date || !id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !UUID_RE.test(id)) return null;
  return { date, id };
}

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const safeName = (n: string | null | undefined) => {
  const t = n?.trim();
  return t && !t.includes("@") ? t : null;
};

type EntryRow = {
  id: string;
  user_id: string;
  title: string;
  entry_date: string;
  author_label: string | null;
  location: { id: string; name: string; category: { slug: string } | { slug: string }[] | null } | { id: string; name: string; category: unknown }[] | null;
  journal_entry_connections: { business_id: string | null; event_id: string | null; event_occurrence_id: string | null }[] | null;
};

/** One page of the public Moment feed. */
export async function getMomentFeed({ limit = 12, cursor }: { limit?: number; cursor?: string | null } = {}): Promise<MomentFeedPage> {
  const supabase = getSupabase();
  if (!supabase) return EMPTY;
  const pageSize = Math.max(1, Math.min(limit, 48));

  let query = supabase
    .from("journal_entries")
    .select(
      "id, user_id, title, entry_date, author_label, location:locations(id, name, category:categories(slug)), journal_entry_connections(business_id, event_id, event_occurrence_id)"
    )
    .eq("visibility", "public")
    .eq("status", "published");
  const after = parseCursor(cursor);
  if (after) query = query.or(`entry_date.lt.${after.date},and(entry_date.eq.${after.date},id.lt.${after.id})`);
  const { data, error } = await query.order("entry_date", { ascending: false }).order("id", { ascending: false }).limit(pageSize + 1);
  if (error || !data) return EMPTY;

  const rows = data as unknown as EntryRow[];
  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize);
  if (page.length === 0) return EMPTY;
  const ids = page.map((r) => r.id);

  // Connected Businesses / Events (an Event date resolves to its Event).
  const conns = page.flatMap((r) => r.journal_entry_connections ?? []);
  const businessIds = [...new Set(conns.map((c) => c.business_id).filter((v): v is string => Boolean(v)))];
  const occurrenceIds = [...new Set(conns.map((c) => c.event_occurrence_id).filter((v): v is string => Boolean(v)))];

  const [{ data: mediaRows }, { data: occRows }, { data: bizRows }] = await Promise.all([
    supabase.from("journal_entry_media").select("id, journal_entry_id, storage_path, is_cover, display_order").in("journal_entry_id", ids),
    occurrenceIds.length ? supabase.from("event_occurrences").select("id, event_id").in("id", occurrenceIds) : Promise.resolve({ data: [] }),
    businessIds.length
      ? supabase.from("businesses").select("id, slug, name, business_categories(category:categories(slug))").in("id", businessIds)
      : Promise.resolve({ data: [] }),
  ]);
  const eventOfOccurrence = new Map(((occRows ?? []) as { id: string; event_id: string }[]).map((o) => [o.id, o.event_id]));
  const eventIds = [
    ...new Set(
      conns
        .map((c) => c.event_id ?? (c.event_occurrence_id ? eventOfOccurrence.get(c.event_occurrence_id) : null))
        .filter((v): v is string => Boolean(v))
    ),
  ];
  const { data: eventRows } = eventIds.length
    ? await supabase.from("events").select("id, slug, name, event_categories(category:categories(slug))").in("id", eventIds)
    : { data: [] };

  type CatJoin = { category: { slug: string } | { slug: string }[] | null }[] | null;
  const slugsOf = (joins: CatJoin) => (joins ?? []).map((j) => one(j.category)?.slug).filter((s): s is string => Boolean(s));
  const businesses = new Map(
    ((bizRows ?? []) as { id: string; slug: string; name: string; business_categories: CatJoin }[]).map((b) => [b.id, { slug: b.slug, name: b.name, cats: slugsOf(b.business_categories) }])
  );
  const events = new Map(
    ((eventRows ?? []) as { id: string; slug: string; name: string; event_categories: CatJoin }[]).map((e) => [e.id, { name: e.name, cats: slugsOf(e.event_categories) }])
  );

  // Preview media: cover first, then display order — at most 5 per Moment.
  type MediaRow = { id: string; journal_entry_id: string; storage_path: string; is_cover: boolean; display_order: number };
  const mediaByEntry = new Map<string, MediaRow[]>();
  for (const m of (mediaRows ?? []) as MediaRow[]) mediaByEntry.set(m.journal_entry_id, [...(mediaByEntry.get(m.journal_entry_id) ?? []), m]);
  const previewPaths = new Map<string, string[]>();
  for (const [entryId, list] of mediaByEntry) previewPaths.set(entryId, orderPreviewMedia(list).slice(0, MAX_COLLAGE_REGIONS).map((m) => m.storage_path));

  const [signed, authors] = await Promise.all([resolveSignedUrls([...previewPaths.values()].flat()), resolveAuthors(page.map((r) => r.user_id))]);

  const cards: MomentFeedCard[] = page.map((r) => {
    const location = one(r.location as EntryRow["location"]) as { id: string; name: string; category: unknown } | null;
    const locationCat = location ? one(location.category as { slug: string } | { slug: string }[] | null)?.slug : null;
    const rConns = r.journal_entry_connections ?? [];
    const rBiz = rConns.map((c) => (c.business_id ? businesses.get(c.business_id) : null)).filter((b): b is NonNullable<typeof b> => Boolean(b));
    const rEventIds = [
      ...new Set(rConns.map((c) => c.event_id ?? (c.event_occurrence_id ? eventOfOccurrence.get(c.event_occurrence_id) : null)).filter((v): v is string => Boolean(v))),
    ];
    const rEvents = rEventIds.map((id) => events.get(id)).filter((e): e is NonNullable<typeof e> => Boolean(e));
    const cats = [...rBiz.flatMap((b) => b.cats), ...rEvents.flatMap((e) => e.cats), ...(locationCat ? [locationCat] : [])];
    const author = authors.get(r.user_id);
    const name = journalByline(author?.name, r.author_label);
    return {
      id: r.id,
      title: r.title,
      href: `/journal/${r.id}`,
      entryDate: r.entry_date,
      contextLabel: location?.name ?? rEvents[0]?.name ?? rBiz[0]?.name ?? null,
      media: (previewPaths.get(r.id) ?? []).map((p) => signed.get(p)).filter((u): u is string => Boolean(u)).map((url) => ({ kind: "image" as const, url })),
      photoCount: mediaByEntry.get(r.id)?.length ?? 0,
      author: name ? { name, avatarUrl: author?.avatarUrl ?? null } : null,
      tags: momentCategoryTags(cats),
      follow: { businessSlugs: rBiz.map((b) => b.slug), eventIds: rEventIds, locationIds: location ? [location.id] : [] },
    };
  });

  const last = page[page.length - 1];
  return { cards, nextCursor: hasMore ? `${last.entry_date}_${last.id}` : null };
}

/** Author display name + public avatar (profiles has no anon read; only
 * the public display fields leave this function — never ids or emails). */
async function resolveAuthors(userIds: string[]): Promise<Map<string, { name: string | null; avatarUrl: string | null }>> {
  const map = new Map<string, { name: string | null; avatarUrl: string | null }>();
  const admin = getAdminSupabase();
  const unique = [...new Set(userIds)];
  if (!admin || unique.length === 0) return map;
  const { data } = await admin.from("profiles").select("id, display_name, avatar_url").in("id", unique);
  for (const p of (data ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]) {
    map.set(p.id, { name: safeName(p.display_name), avatarUrl: p.avatar_url && /^https?:\/\//.test(p.avatar_url) ? p.avatar_url : null });
  }
  return map;
}
