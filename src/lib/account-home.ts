// Account Home — personalized launchpad rails. Every rail is built from
// REAL Findmi records and the viewer's own explicit relationships
// (follows, saves, classifications); nothing is inferred, invented or
// "trending". A rail that doesn't have enough real content is omitted.
// Pure helpers first (unit-tested); the two small product reads after.

import type { SupabaseClient } from "@supabase/supabase-js";
import { matchesWhen, type DiscoveryItem, type RankedItem } from "./discovery/engine";
import type { MomentFeedCard } from "./moment-discovery";
import { PUBLIC_PRODUCT_COLUMNS } from "./data";

/** A "You Might Like" rail renders only with at least this many records —
 * one lonely tile isn't a recommendation. */
export const MIGHT_LIKE_MIN = 2;
export const MIGHT_LIKE_LIMIT = 8;
export const FROM_BRANDS_LIMIT = 8;
/** Products You Might Like: at most this many from one Brand in the
 * visible set while other Brands can fill it. */
export const MAX_PER_BRAND = 2;

/** Deterministic Brand diversity — keeps the existing order, but while
 * alternatives exist no Brand takes more than `maxPerBrand` of the first
 * `limit` slots; only when they run out does a Brand get more. */
export function diversifyByBrand<T extends { business_id: string }>(items: readonly T[], limit: number, maxPerBrand = MAX_PER_BRAND): T[] {
  const picked: T[] = [];
  const overflow: T[] = [];
  const perBrand = new Map<string, number>();
  for (const item of items) {
    const n = perBrand.get(item.business_id) ?? 0;
    if (n < maxPerBrand && picked.length < limit) {
      picked.push(item);
      perBrand.set(item.business_id, n + 1);
    } else overflow.push(item);
  }
  for (const item of overflow) {
    if (picked.length >= limit) break;
    picked.push(item);
  }
  return picked;
}

/** One tile on a mixed Account Home rail (Products, Moments, Events,
 * Brands, Places side by side — and later other content types) — the
 * same small union Saved/Following tiles already use. */
export interface HomeTile {
  key: string;
  kind: "business" | "product" | "event" | "location" | "moment";
  name: string;
  imageUrl: string | null;
  href: string;
  /** Sort key — newest first. */
  relatedAt: string;
  /** Optional context line (the Brand a Product/Moment is from). */
  meta?: string | null;
}

/** "You Might Like" for one kind: the engine's own personal ranking, minus
 * anything the viewer already follows / saved / sees in Upcoming, and
 * (Events) only what is still upcoming. Empty below MIGHT_LIKE_MIN. */
export function pickYouMightLike(
  ranked: readonly RankedItem[],
  kind: DiscoveryItem["kind"],
  exclude: ReadonlySet<string>,
  now: Date = new Date(),
  limit = MIGHT_LIKE_LIMIT
): DiscoveryItem[] {
  const out: DiscoveryItem[] = [];
  for (const { item } of ranked) {
    if (item.kind !== kind || exclude.has(item.id)) continue;
    if (kind === "event" && !matchesWhen(item, "upcoming", now)) continue;
    out.push(item);
    if (out.length >= limit) break;
  }
  return out.length >= MIGHT_LIKE_MIN ? out : [];
}

/** Moments connected to, or published by, a Brand the viewer follows. */
export function momentsFromBrands(cards: readonly MomentFeedCard[], followedBusinessIds: ReadonlySet<string>): MomentFeedCard[] {
  return cards.filter((c) => (c.follow.businessIds ?? []).some((id) => followedBusinessIds.has(id)));
}

/** A truthfully-available Event "from a Brand you follow" — reuses
 * whatever the caller already fetched (getPersonalUpcoming's own
 * per-item relatedTo labels), never a second Event query. */
export interface FollowedBrandEvent {
  id: string;
  title: string;
  href: string;
  imageUrl: string | null;
  date: string;
}

/** A Location connected to a Brand you follow (business_locations). */
export interface FollowedBrandLocation {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
}

/** "From Brands You Follow": every real, truthful content type the
 * current data model can produce — Products, Moments, and (when passed)
 * Events and Places connected to a followed Brand. Only ever includes a
 * kind the caller actually has data for; nothing is fabricated to fill a
 * slot. Newest-first where a real date exists; undated kinds (Products,
 * Places) sort after dated ones. */
export function fromBrandsTiles(
  products: readonly HomeProduct[],
  moments: readonly MomentFeedCard[],
  events: readonly FollowedBrandEvent[] = [],
  locations: readonly FollowedBrandLocation[] = [],
  limit = FROM_BRANDS_LIMIT
): HomeTile[] {
  const tiles: HomeTile[] = [
    ...products.map((p) => ({
      key: `product:${p.id}`,
      kind: "product" as const,
      name: p.name,
      imageUrl: p.image_url,
      href: `/product/${p.slug}`,
      // Products carry no timestamp: they follow the dated Moments.
      relatedAt: "",
      meta: p.businessName,
    })),
    ...moments.map((m) => ({
      key: `moment:${m.id}`,
      kind: "moment" as const,
      name: m.title,
      imageUrl: m.media[0]?.url ?? null,
      href: m.href,
      relatedAt: m.entryDate,
      meta: m.contextLabel,
    })),
    ...events.map((e) => ({
      key: `event:${e.id}`,
      kind: "event" as const,
      name: e.title,
      imageUrl: e.imageUrl,
      href: e.href,
      relatedAt: e.date,
      meta: null,
    })),
    ...locations.map((l) => ({
      key: `location:${l.id}`,
      kind: "location" as const,
      name: l.name,
      imageUrl: l.imageUrl,
      href: `/location/${l.slug}`,
      // Places carry no timestamp either — same reasoning as Products.
      relatedAt: "",
      meta: null,
    })),
  ];
  return tiles.sort((a, b) => (a.relatedAt < b.relatedAt ? 1 : a.relatedAt > b.relatedAt ? -1 : 0)).slice(0, limit);
}

// ------------------------------------------------------------ intent rail

export type IntentRelation = "want" | "must_do" | "have_been";

export interface IntentSeed {
  relation: IntentRelation;
  /** Entity ids tagged with this relation — event/location only, the two
   * kinds the discovery engine's own ranked items can be `related` to;
   * a Product-only intent signal has nothing for this mechanism to seed
   * from, and correctly yields no seed. */
  seedIds: ReadonlySet<string>;
}

/** Deterministically picks ONE intent relation to seed a recommendation
 * rail from — Want, then Must Do, then Have/Been, in that priority — never
 * a blend, never random. Returns null when there's no qualifying signal
 * at all; the caller must omit the section rather than fabricate one. */
export function pickIntentSeed(relationRows: readonly { entity_type: string; entity_id: string; relation: string }[]): IntentSeed | null {
  const qualifying = relationRows.filter((r) => r.entity_type === "event" || r.entity_type === "location");
  const idsFor = (relation: string) => new Set(qualifying.filter((r) => r.relation === relation).map((r) => r.entity_id));
  const want = idsFor("want");
  if (want.size > 0) return { relation: "want", seedIds: want };
  const mustDo = idsFor("must_do");
  if (mustDo.size > 0) return { relation: "must_do", seedIds: mustDo };
  const haveBeen = new Set([...idsFor("have"), ...idsFor("been")]);
  if (haveBeen.size > 0) return { relation: "have_been", seedIds: haveBeen };
  return null;
}

/** Consumer-readable, truthful section titles — never database terms. */
export const INTENT_SECTION_TITLE: Record<IntentRelation, string> = {
  want: "More Like Things You Want",
  must_do: "Based On Your Must Dos",
  have_been: "More Like What You've Experienced",
};

// ------------------------------------------------------------ reads

export interface HomeProduct {
  id: string;
  slug: string;
  name: string;
  image_url: string | null;
  business_id: string;
  businessName: string | null;
}

type ProductRow = { id: string; slug: string; name: string; image_url: string | null; business_id: string; business: { name: string } | { name: string }[] | null };
const toHomeProduct = (r: ProductRow): HomeProduct => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  image_url: r.image_url,
  business_id: r.business_id,
  businessName: (Array.isArray(r.business) ? r.business[0] : r.business)?.name ?? null,
});

/** Active Products of Brands the viewer follows (featured first, then each
 * Brand's own home order). */
export async function getFollowedBrandProducts(supabase: SupabaseClient, followedBusinessIds: readonly string[], limit = FROM_BRANDS_LIMIT): Promise<HomeProduct[]> {
  if (followedBusinessIds.length === 0) return [];
  const { data } = await supabase
    .from("products")
    .select(`${PUBLIC_PRODUCT_COLUMNS}, business:businesses(name)`)
    .in("business_id", [...followedBusinessIds])
    .eq("is_active", true)
    .order("is_featured", { ascending: false })
    .order("home_sort_order", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true })
    .limit(limit);
  return ((data ?? []) as unknown as ProductRow[]).map(toHomeProduct);
}

type FollowedLocationRow = { business_id: string; locations: { id: string; slug: string; name: string; logo_url: string | null; cover_image_url: string | null } | null };

/** Real, public Locations connected to Brands the viewer follows
 * (business_locations) — same relationship Account Home's "Pages I
 * Manage" / the Business workspace's own Locations tab already read,
 * never a new one. Only published, non-demo Locations (same visibility
 * rule every other public Account Home rail already uses). */
export async function getFollowedBrandLocations(supabase: SupabaseClient, followedBusinessIds: readonly string[], limit = FROM_BRANDS_LIMIT): Promise<FollowedBrandLocation[]> {
  if (followedBusinessIds.length === 0) return [];
  const { data } = await supabase
    .from("business_locations")
    .select("business_id, locations!inner(id, slug, name, logo_url, cover_image_url, is_demo)")
    .in("business_id", [...followedBusinessIds])
    .eq("locations.is_demo", false)
    .limit(limit);
  const rows = (data ?? []) as unknown as FollowedLocationRow[];
  const seen = new Set<string>();
  const out: FollowedBrandLocation[] = [];
  for (const row of rows) {
    const l = row.locations;
    if (!l || seen.has(l.id)) continue;
    seen.add(l.id);
    out.push({ id: l.id, slug: l.slug, name: l.name, imageUrl: l.logo_url ?? l.cover_image_url });
  }
  return out.slice(0, limit);
}

/** Products You Might Like — deterministic category affinity: active
 * Products of OTHER Brands that share a Category with a Brand the viewer
 * follows or saved. Never their own followed Brands' Products (those are
 * "From Brands You Follow") and never a Product they already saved. */
export async function getProductsYouMightLike(
  supabase: SupabaseClient,
  affinityBusinessIds: readonly string[],
  excludeProductIds: ReadonlySet<string>,
  limit = MIGHT_LIKE_LIMIT
): Promise<HomeProduct[]> {
  if (affinityBusinessIds.length === 0) return [];
  const { data: cats } = await supabase.from("business_categories").select("category_id").in("business_id", [...affinityBusinessIds]);
  const categoryIds = [...new Set(((cats ?? []) as { category_id: string }[]).map((c) => c.category_id))];
  if (categoryIds.length === 0) return [];
  const { data: peers } = await supabase.from("business_categories").select("business_id").in("category_id", categoryIds).limit(200);
  const own = new Set(affinityBusinessIds);
  const peerIds = [...new Set(((peers ?? []) as { business_id: string }[]).map((p) => p.business_id))].filter((id) => !own.has(id));
  if (peerIds.length === 0) return [];
  const { data } = await supabase
    .from("products")
    .select(`${PUBLIC_PRODUCT_COLUMNS}, business:businesses!inner(name, is_demo)`)
    .in("business_id", peerIds.slice(0, 100))
    .eq("is_active", true)
    .eq("business.is_demo", false)
    .order("is_featured", { ascending: false })
    .order("home_sort_order", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true })
    .limit(limit * 3 + excludeProductIds.size);
  const ranked = ((data ?? []) as unknown as ProductRow[]).map(toHomeProduct).filter((p) => !excludeProductIds.has(p.id));
  const out = diversifyByBrand(ranked, limit);
  return out.length >= MIGHT_LIKE_MIN ? out : [];
}
