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

/** "From Brands You Follow": their Products and Moments, newest first. */
export function fromBrandsTiles(
  products: readonly HomeProduct[],
  moments: readonly MomentFeedCard[],
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
  ];
  return tiles.sort((a, b) => (a.relatedAt < b.relatedAt ? 1 : a.relatedAt > b.relatedAt ? -1 : 0)).slice(0, limit);
}

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
