import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import { ownMomentsScope, resolveSignedUrls, scopeToOwnMoments } from "./journal";
import { authorColumn, resolveMomentAuthors } from "./moment-authorship";
import { MAX_COLLAGE_REGIONS, orderPreviewMedia } from "./moment-collage";
import { momentCategoryTags, type MomentFilterKey, type MomentFollowKeys } from "./moment-filters";

// Findmi Moments discovery feed — the public, cross-entity Moment feed for
// the homepage carousel and /moments (and, owner-scoped, /moments → My
// Moments: same cards, the viewer's own Moments). Same visibility contract as
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
  /** The PUBLIC author (lib/moment-authorship resolveMomentAuthors): a
   * Person (avatar) or a Business (logo). */
  author: { name: string; avatarUrl: string | null; kind: "person" | "business" } | null;
  /** Category filters this Moment belongs to (real relationships only). */
  tags: MomentFilterKey[];
  /** Public keys for the "Following" filter (matched on this device). */
  follow: MomentFollowKeys;
  /** Where it happened on a map — ONLY from a real relationship: the
   * Moment's own Location, else a connected Event date's Location (never a
   * hidden-location Event, never a Business, never geocoded text). */
  geo: MomentGeo | null;
  /** Owner feed only (My Moments): not visible to others yet. */
  ownerBadge?: "Draft" | "Private" | null;
}

export interface MomentGeo {
  lat: number;
  lng: number;
  locationId: string;
  place: string;
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

type EntryLocation = { id: string; name: string; latitude: number | null; longitude: number | null; is_demo: boolean | null; category: unknown };
type EntryRow = {
  id: string;
  user_id: string;
  title: string;
  entry_date: string;
  author_label: string | null;
  author_business_id?: string | null;
  visibility?: string;
  status?: string;
  location: EntryLocation | EntryLocation[] | null;
  journal_entry_connections: { business_id: string | null; event_id: string | null; event_occurrence_id: string | null }[] | null;
};

/** A usable map point for a Location row (listed, real coordinates). */
function locationGeo(l: EntryLocation | null | undefined): MomentGeo | null {
  if (!l || l.is_demo || typeof l.latitude !== "number" || typeof l.longitude !== "number") return null;
  if (!Number.isFinite(l.latitude) || !Number.isFinite(l.longitude)) return null;
  return { lat: l.latitude, lng: l.longitude, locationId: l.id, place: l.name };
}

/** One page of the Moment feed. Default: the PUBLIC network feed (anon
 * client, RLS + public/published filters). `owner`: the signed-in person's
 * OWN Moments (My Moments) — read with their session client under the same
 * ownership rule as the Journal archive (lib/journal scopeToOwnMoments),
 * drafts and private Moments included, photos signed for the owner. Same
 * card shape, ordering and cursor either way. */
export async function getMomentFeed({
  limit = 12,
  cursor,
  owner,
}: { limit?: number; cursor?: string | null; owner?: { client: SupabaseClient; userId: string } } = {}): Promise<MomentFeedPage> {
  const supabase = owner?.client ?? getSupabase();
  if (!supabase) return EMPTY;
  const pageSize = Math.max(1, Math.min(limit, 48));

  let query = supabase
    .from("journal_entries")
    .select(
      "id, user_id, title, entry_date, author_label, visibility, status" +
        (await authorColumn()) +
        ", location:locations(id, name, latitude, longitude, is_demo, category:categories(slug)), journal_entry_connections(business_id, event_id, event_occurrence_id)"
    );
  if (owner) {
    const scope = await ownMomentsScope(owner.client, owner.userId);
    query = scopeToOwnMoments(query, owner.userId, scope.authorship, scope.managedIds);
  } else {
    query = query.eq("visibility", "public").eq("status", "published");
  }
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
    occurrenceIds.length
      ? supabase
          .from("event_occurrences")
          .select("id, event_id, location:locations(id, name, latitude, longitude, is_demo, category:categories(slug)), event:events(location_visibility)")
          .in("id", occurrenceIds)
      : Promise.resolve({ data: [] }),
    businessIds.length
      ? supabase.from("businesses").select("id, slug, name, business_categories(category:categories(slug))").in("id", businessIds)
      : Promise.resolve({ data: [] }),
  ]);
  type OccRow = { id: string; event_id: string; location: EntryLocation | EntryLocation[] | null; event: { location_visibility: string | null } | { location_visibility: string | null }[] | null };
  const occList = (occRows ?? []) as OccRow[];
  const eventOfOccurrence = new Map(occList.map((o) => [o.id, o.event_id]));
  // An Event date's Location is a map point unless the Event hides its
  // location (lib/event-location-privacy — only 'hidden' withholds a place).
  const geoOfOccurrence = new Map(
    occList.map((o) => [o.id, one(o.event)?.location_visibility === "hidden" ? null : locationGeo(one(o.location))] as const)
  );
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

  const [signed, authors] = await Promise.all([resolveSignedUrls([...previewPaths.values()].flat(), "card", { publicView: !owner }), resolveMomentAuthors(page)]);

  const cards: MomentFeedCard[] = page.map((r) => {
    const location = one(r.location);
    const locationCat = location ? one(location.category as { slug: string } | { slug: string }[] | null)?.slug : null;
    const rConns = r.journal_entry_connections ?? [];
    const rBiz = rConns.map((c) => (c.business_id ? businesses.get(c.business_id) : null)).filter((b): b is NonNullable<typeof b> => Boolean(b));
    const rEventIds = [
      ...new Set(rConns.map((c) => c.event_id ?? (c.event_occurrence_id ? eventOfOccurrence.get(c.event_occurrence_id) : null)).filter((v): v is string => Boolean(v))),
    ];
    const rEvents = rEventIds.map((id) => events.get(id)).filter((e): e is NonNullable<typeof e> => Boolean(e));
    const cats = [...rBiz.flatMap((b) => b.cats), ...rEvents.flatMap((e) => e.cats), ...(locationCat ? [locationCat] : [])];
    const author = authors.get(r.id);
    const geo =
      locationGeo(location) ??
      rConns.map((c) => (c.event_occurrence_id ? (geoOfOccurrence.get(c.event_occurrence_id) ?? null) : null)).find((g): g is MomentGeo => Boolean(g)) ??
      null;
    return {
      id: r.id,
      title: r.title,
      href: `/journal/${r.id}`,
      entryDate: r.entry_date,
      contextLabel: location?.name ?? rEvents[0]?.name ?? rBiz[0]?.name ?? null,
      media: (previewPaths.get(r.id) ?? []).map((p) => signed.get(p)).filter((u): u is string => Boolean(u)).map((url) => ({ kind: "image" as const, url })),
      photoCount: mediaByEntry.get(r.id)?.length ?? 0,
      author: author ? { name: author.name, avatarUrl: author.imageUrl, kind: author.kind } : null,
      tags: momentCategoryTags(cats),
      follow: {
        businessSlugs: rBiz.map((b) => b.slug),
        eventIds: rEventIds,
        locationIds: location ? [location.id] : [],
        // Connected Businesses and the Business that published it.
        businessIds: [...new Set([...rConns.map((c) => c.business_id), r.author_business_id ?? null].filter((v): v is string => Boolean(v)))],
      },
      geo,
      ownerBadge: owner ? (r.status === "draft" ? "Draft" : r.visibility === "private" ? "Private" : null) : undefined,
    };
  });

  const last = page[page.length - 1];
  return { cards, nextCursor: hasMore ? `${last.entry_date}_${last.id}` : null };
}
