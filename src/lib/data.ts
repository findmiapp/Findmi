import { getSupabase } from "./supabase";
import { formatAppearanceDateRange, getDiscoveryWindowBounds, getExactDateBounds, type DiscoveryWindow } from "./format";
import type {
  Appearance,
  Business,
  BusinessSummary,
  BusinessWithCategories,
  Category,
  EventOccurrence,
  EventWithCategories,
  FindmiEvent,
  FindmiLocation,
  FulfillmentMethod,
  Market,
  MembershipPlan,
  Person,
  PersonWithRole,
  Product,
} from "./types";

// All helpers fail soft (return empty arrays / null) when Supabase isn't
// configured yet, so the app renders cleanly before env vars are set.

// Production regression fix (Sept 1) — every public/anon-client read in
// this file used to select("*"). Security Pass 1
// (supabase/migrations/20260831000000_restrict_internal_commerce_columns.sql)
// revoked anon/authenticated's table-level SELECT on businesses/products
// and replaced it with an explicit column-level grant — so a bare
// select("*") now expands to every column, including the ones that
// migration deliberately excludes, and Postgres rejects the WHOLE query
// (not just the missing columns) with "permission denied for table ...".
// Every getSupabase()-backed (anon) read of businesses/products — direct
// or embedded via another table's select() — must use one of these two
// constants instead of "*", kept in exact sync with that migration's
// grant lists. getAdminSupabase() (service-role) reads are unaffected by
// any of this and are intentionally left alone.
export const PUBLIC_BUSINESS_COLUMNS =
  "id, slug, name, short_description, description, logo_url, cover_image_url, " +
  "website_url, instagram_url, facebook_url, tiktok_url, email, phone, city, " +
  "state, country, service_radius_miles, verified, founding_member, " +
  "membership_status, created_at, updated_at, is_demo, commerce_enabled, " +
  "publication_status, is_featured, inquiry_cta_label, inquiry_cta_url, " +
  "cta_1_label, cta_1_url, cta_1_enabled, cta_2_label, cta_2_url, " +
  "cta_2_enabled, cta_3_label, cta_3_url, cta_3_enabled, bulletin_enabled, " +
  "bulletin_heading, bulletin_body, bulletin_label, bulletin_url";
// Intentionally excluded (matches the migration exactly — never add these
// back here without also widening the grant): lead_status,
// marketplace_fee_percent, processing_fee_payer, payout_method,
// stripe_account_id, stripe_connect_status.

export const PUBLIC_PRODUCT_COLUMNS =
  "id, business_id, name, slug, description, image_url, price, price_label, " +
  "product_type, external_purchase_url, is_featured, is_active, purchasable, " +
  "inventory_status, home_sort_order, profile_sort_order";
// Intentionally excluded: marketplace_fee_override_percent,
// processing_fee_payer_override.

/** Logs a Supabase query failure server-side with enough context to
 * diagnose it, without ever putting the raw database error in front of a
 * browser — every affected public helper below calls this instead of
 * silently treating `error` the same as a legitimate empty result. */
function logPublicQueryError(context: string, error: { message: string; code?: string } | null): void {
  if (!error) return;
  console.error(`[public-data] ${context} failed`, { message: error.message, code: error.code });
}

function withCategories(
  businesses: Business[],
  categoryRows: { business_id: string; categories: Category | Category[] }[]
): BusinessWithCategories[] {
  const byBusiness = new Map<string, Category[]>();
  for (const row of categoryRows) {
    const cats = Array.isArray(row.categories)
      ? row.categories
      : row.categories
        ? [row.categories]
        : [];
    const existing = byBusiness.get(row.business_id) ?? [];
    byBusiness.set(row.business_id, [...existing, ...cats]);
  }
  return businesses.map((b) => ({
    ...b,
    categories: byBusiness.get(b.id) ?? [],
  }));
}

async function attachCategories(businesses: Business[]): Promise<BusinessWithCategories[]> {
  const supabase = getSupabase();
  if (!supabase || businesses.length === 0) {
    return businesses.map((b) => ({ ...b, categories: [] }));
  }
  const ids = businesses.map((b) => b.id);
  // .eq("categories.kind", "business") — defense in depth: business_categories
  // should only ever point at business-kind rows (the admin checklist is
  // kind-scoped), but categories is still one shared table, so this is
  // explicit rather than assumed. Requires !inner so the filter actually
  // applies to the embedded resource instead of being ignored.
  const { data } = await supabase
    .from("business_categories")
    .select("business_id, categories!inner(id, name, slug)")
    .eq("categories.kind", "business")
    .in("business_id", ids);

  return withCategories(businesses, (data as never) ?? []);
}

/** One category name per business_id — the first linked category, same
 * "good enough for a compact card" precedent as
 * BusinessWithCategories.categories[0] used elsewhere (e.g. CompactCard's
 * meta line). Used where only a single taxonomy label is needed, not the
 * full category list attachCategories() builds. */
async function getPrimaryCategoryByBusiness(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  businessIds: string[]
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("business_categories")
    .select("business_id, categories!inner(name)")
    .eq("categories.kind", "business")
    .in("business_id", businessIds);
  const map = new Map<string, string>();
  for (const row of (data ?? []) as { business_id: string; categories: { name: string } | { name: string }[] }[]) {
    if (map.has(row.business_id)) continue;
    const cat = Array.isArray(row.categories) ? row.categories[0] : row.categories;
    if (cat?.name) map.set(row.business_id, cat.name);
  }
  return map;
}

/** One category name per product_id — the product's own first-class
 * category (product_categories), taking priority over the seller's
 * business category wherever a product actually has one. Same "good
 * enough for a compact card" shape as getPrimaryCategoryByBusiness above;
 * callers fall back to that business category only when a product has no
 * product-category assignment of its own yet. */
async function getPrimaryCategoryByProduct(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  productIds: string[]
): Promise<Map<string, string>> {
  if (productIds.length === 0) return new Map();
  const { data } = await supabase
    .from("product_categories")
    .select("product_id, categories!inner(name)")
    .eq("categories.kind", "product")
    .in("product_id", productIds);
  const map = new Map<string, string>();
  for (const row of (data ?? []) as { product_id: string; categories: { name: string } | { name: string }[] }[]) {
    if (map.has(row.product_id)) continue;
    const cat = Array.isArray(row.categories) ? row.categories[0] : row.categories;
    if (cat?.name) map.set(row.product_id, cat.name);
  }
  return map;
}

export interface HomeStats {
  businessCount: number;
  upcomingCount: number;
  cityCount: number;
}

/**
 * Real, live counts — never fabricated. Currently unused on the homepage
 * (too few real listings yet for a stats strip to read as credible rather
 * than sparse); kept here so it's a one-line re-add once there's enough
 * production data.
 */
export async function getHomeStats(): Promise<HomeStats> {
  const supabase = getSupabase();
  if (!supabase) return { businessCount: 0, upcomingCount: 0, cityCount: 0 };

  const { data: realBusinesses } = await supabase
    .from("businesses")
    .select("id, city")
    .eq("is_demo", false);
  const realIds = (realBusinesses ?? []).map((b) => b.id);

  const { count: upcomingCount } = realIds.length
    ? await supabase
        .from("appearances")
        .select("id", { count: "exact", head: true })
        .in("business_id", realIds)
        .neq("status", "canceled")
        .gte("start_at", new Date().toISOString())
    : { count: 0 };

  const cityCount = new Set((realBusinesses ?? []).map((r) => r.city).filter(Boolean)).size;

  return {
    businessCount: realIds.length,
    upcomingCount: upcomingCount ?? 0,
    cityCount,
  };
}

/** Business-kind categories — used by the public business filter
 * (/businesses, /discover, /find). Categories are now split by kind
 * (business/event/product — see the taxonomy migration); this must never
 * return event- or product-kind rows even though they share one table. */
export async function getCategories(): Promise<Category[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase.from("categories").select("*").eq("kind", "business").order("name");
  const categories = data ?? [];
  // Alphabetical (already the query's own order), except "Other" always
  // sorts last regardless of where it falls alphabetically.
  return [...categories.filter((c) => c.name !== "Other"), ...categories.filter((c) => c.name === "Other")];
}

/** Founder-controlled subset/order for the homepage category strip (see
 * /admin/categories) — separate from getCategories() because every other
 * caller (business forms, the /businesses filter) still needs the full
 * list regardless of homepage visibility. Business-kind only, same
 * reasoning as getCategories() above. */
export async function getHomeCategories(): Promise<Category[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("categories")
    .select("*")
    .eq("kind", "business")
    .eq("show_on_home", true)
    .order("home_sort_order", { ascending: true, nullsFirst: false })
    .order("name");
  return data ?? [];
}

/** Categories actually tagged on at least one REAL, still-upcoming event,
 * via event_categories — NOT business categories (see getHomeCategories
 * above, which is business-scoped and must never be reused here — live
 * QA correction, 2026 nav pass, Part B6/B9). event_categories can have
 * zero rows in production, so this honestly returns [] until the founder
 * tags a real event — callers must hide the event-category filter
 * entirely in that case rather than falling back to an unrelated
 * taxonomy.
 *
 * The is_demo/upcoming scoping (live-QA fix pass, root cause below) is
 * not optional: without it, a category tagged only on a demo event or a
 * past event still renders as a selectable chip that can never return a
 * result in any time window — a "chip exists, always empty" bug that
 * reads as broken filtering when the filter logic itself is fine. The
 * concrete proof for this exact failure mode is on the business side
 * (see getCategoriesForDynamicBusinessRow's own note) — this applies the
 * same fix proactively to events before it's independently observed
 * there too. */
export async function getEventCategories(): Promise<Category[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  // "Real" here means still discoverable — hasn't ended yet, not merely
  // "hasn't started yet" (see the active-event visibility bug fix; an
  // event's end_at is required now, so this is a plain comparison, no
  // fallback needed).
  const { data: realEvents } = await supabase
    .from("events")
    .select("id")
    .eq("is_demo", false)
    .gt("end_at", new Date().toISOString());
  const realEventIds = new Set((realEvents ?? []).map((e) => e.id));
  if (realEventIds.size === 0) return [];

  const { data } = await supabase
    .from("event_categories")
    .select("event_id, categories!inner(id, name, slug)")
    .eq("categories.kind", "event");
  const seen = new Map<string, Category>();
  for (const row of (data ?? []) as { event_id: string; categories: Category | Category[] | null }[]) {
    if (!realEventIds.has(row.event_id)) continue;
    const cats = Array.isArray(row.categories) ? row.categories : row.categories ? [row.categories] : [];
    for (const c of cats) if (!seen.has(c.id)) seen.set(c.id, c);
  }
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Founder-curated Featured Brands (businesses.is_featured — decoupled
 * from founding_member, backfilled from it at launch). */
export async function getFeaturedBusinesses(limit = 8): Promise<BusinessWithCategories[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("businesses")
    .select(PUBLIC_BUSINESS_COLUMNS)
    .eq("is_featured", true)
    .eq("is_demo", false)
    .eq("publication_status", "live")
    .order("created_at", { ascending: false })
    .limit(limit);
  logPublicQueryError("getFeaturedBusinesses", error);
  return attachCategories((data as unknown as Business[]) ?? []);
}

export interface HomepageRowBusinessParams {
  categorySlug?: string;
  featuredOnly?: boolean;
  limit?: number;
}

/** Dynamic-mode businesses feed for a founder-configured homepage row
 * (see lib/homepage-rows.ts) — same category/is_featured/is_demo/
 * publication_status shape as every other business query, just with both
 * filters optional and combinable, since a row's filters are chosen at
 * edit time rather than hardcoded per caller. */
export async function getHomepageRowBusinesses(params: HomepageRowBusinessParams = {}): Promise<BusinessWithCategories[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  let categoryBusinessIds: string[] | null = null;
  if (params.categorySlug) {
    const { data: cat } = await supabase
      .from("categories")
      .select("id")
      .eq("slug", params.categorySlug)
      .eq("kind", "business")
      .maybeSingle();
    if (!cat) return [];
    const { data: links } = await supabase.from("business_categories").select("business_id").eq("category_id", cat.id);
    categoryBusinessIds = (links ?? []).map((l) => l.business_id);
    if (categoryBusinessIds.length === 0) return [];
  }

  let query = supabase.from("businesses").select(PUBLIC_BUSINESS_COLUMNS).eq("is_demo", false).eq("publication_status", "live");
  if (categoryBusinessIds) query = query.in("id", categoryBusinessIds);
  if (params.featuredOnly) query = query.eq("is_featured", true);

  const { data, error } = await query
    .order("is_featured", { ascending: false })
    .order("founding_member", { ascending: false })
    .order("name")
    .limit(params.limit ?? 8);
  logPublicQueryError("getHomepageRowBusinesses", error);
  return attachCategories((data as unknown as Business[]) ?? []);
}

/** Categories that can actually return a business from a specific
 * DYNAMIC "businesses" homepage row — the live-QA fix pass's proven
 * root cause for "I select a category and get nothing, even though a
 * business is assigned to it": Brands We Love's category chips were
 * sourced from getHomeCategories() (every show_on_home category,
 * homepage-wide), not scoped to this row's own featured_only/is_demo/
 * publication_status rules. Concrete example: "Markets & Pop-Ups" IS
 * attached to a real business_categories row (Wildflower Market Co.),
 * so the chip correctly appeared — but that business has is_demo=true,
 * which every public business query (rightly) excludes, so selecting
 * that chip could only ever return zero results. This scopes the chip
 * list itself to categories with at least one business that would
 * actually survive this row's own filters, so a shown chip is never a
 * dead end. */
export async function getCategoriesForDynamicBusinessRow(featuredOnly: boolean): Promise<Category[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  let query = supabase.from("businesses").select("id").eq("is_demo", false).eq("publication_status", "live");
  if (featuredOnly) query = query.eq("is_featured", true);
  const { data: eligible } = await query;
  const eligibleIds = new Set((eligible ?? []).map((b) => b.id));
  if (eligibleIds.size === 0) return [];

  const { data } = await supabase
    .from("business_categories")
    .select("business_id, categories!inner(id, name, slug)")
    .eq("categories.kind", "business");
  const seen = new Map<string, Category>();
  for (const row of (data ?? []) as { business_id: string; categories: Category | Category[] | null }[]) {
    if (!eligibleIds.has(row.business_id)) continue;
    const cats = Array.isArray(row.categories) ? row.categories : row.categories ? [row.categories] : [];
    for (const c of cats) if (!seen.has(c.id)) seen.set(c.id, c);
  }
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Curated-mode fetch for any of the three homepage-row content types —
 * .in("id", ids) doesn't preserve order, so each reorders its result to
 * match the founder's chosen curated_ids sequence. Rows for ids that no
 * longer exist/aren't publicly visible are silently dropped rather than
 * erroring — a deleted/unpublished record just drops out of the row. */
export async function getBusinessesByIds(ids: string[]): Promise<BusinessWithCategories[]> {
  const supabase = getSupabase();
  if (!supabase || ids.length === 0) return [];
  const { data, error } = await supabase
    .from("businesses")
    .select(PUBLIC_BUSINESS_COLUMNS)
    .in("id", ids)
    .eq("is_demo", false)
    .eq("publication_status", "live");
  logPublicQueryError("getBusinessesByIds", error);
  const withCats = await attachCategories((data as unknown as Business[]) ?? []);
  return reorderByIds(withCats, ids);
}

export async function getEventsByIds(ids: string[]): Promise<FindmiEvent[]> {
  const supabase = getSupabase();
  if (!supabase || ids.length === 0) return [];
  const { data } = await supabase.from("events").select("*").in("id", ids).eq("is_demo", false);
  return reorderByIds((data as FindmiEvent[]) ?? [], ids);
}

export async function getProductsByIds(ids: string[]): Promise<FeaturedProduct[]> {
  const supabase = getSupabase();
  if (!supabase || ids.length === 0) return [];
  const { data, error } = await supabase
    .from("products")
    .select(`${PUBLIC_PRODUCT_COLUMNS}, business:businesses(id, name, slug, logo_url, commerce_enabled, is_demo, publication_status)`)
    .in("id", ids)
    .eq("is_active", true);
  logPublicQueryError("getProductsByIds", error);

  type JoinedBusiness = Omit<FeaturedProduct["business"], "categoryName"> & {
    is_demo: boolean;
    publication_status: string;
  };
  const rows = ((data ?? []) as never[])
    .map((row: unknown) => {
      const r = row as Product & { business: JoinedBusiness | JoinedBusiness[] };
      const business = Array.isArray(r.business) ? r.business[0] : r.business;
      return { ...r, business };
    })
    .filter((item) => item.business && !item.business.is_demo && item.business.publication_status === "live");

  const businessIds = Array.from(new Set(rows.map((r) => r.business.id)));
  const productIds = rows.map((r) => r.id);
  const [categoryByBusiness, categoryByProduct] = await Promise.all([
    businessIds.length ? getPrimaryCategoryByBusiness(supabase, businessIds) : new Map<string, string>(),
    getPrimaryCategoryByProduct(supabase, productIds),
  ]);
  const withCategory = rows.map(({ business: { is_demo: _isDemo, publication_status: _pubStatus, ...business }, ...rest }) => ({
    ...rest,
    business: { ...business, categoryName: categoryByProduct.get(rest.id) ?? categoryByBusiness.get(business.id) ?? null },
  }));
  return reorderByIds(withCategory, ids);
}

function reorderByIds<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.map((id) => byId.get(id)).filter((item): item is T => Boolean(item));
}

export type BusinessSort = "recommended" | "newest" | "az";

export interface SearchBusinessesParams {
  q?: string;
  categorySlug?: string;
  /** Free-text match against city OR state — the only location data the
   * schema actually has (no structured place/geo table for businesses).
   * Discovery + Archive V2 Part 5/6. */
  location?: string;
  /** @deprecated use `location` — kept so existing callers (homepage
   * search, marketplace) that still pass `city` keep working unchanged. */
  city?: string;
  featuredOnly?: boolean;
  foundingMemberOnly?: boolean;
  /** "recommended" (default) = is_featured desc, founding_member desc,
   * newest first — a transparent, deterministic ordering built entirely
   * from real founder-set/timestamp fields, never a fabricated popularity
   * score. "newest" = created_at desc. "az" = name asc. */
  sort?: BusinessSort;
  limit?: number;
  offset?: number;
}

/** Real total isn't computed via a separate COUNT query (avoids doubling
 * every archive request) — callers that need "is there more to load"
 * fetch `limit + 1` and slice, the same pattern getEventsDiscovery's
 * caller below uses. */
export async function searchBusinesses(params: SearchBusinessesParams = {}): Promise<BusinessWithCategories[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  let categoryBusinessIds: string[] | null = null;
  if (params.categorySlug) {
    const { data: cat } = await supabase
      .from("categories")
      .select("id")
      .eq("slug", params.categorySlug)
      .eq("kind", "business")
      .maybeSingle();
    if (cat) {
      const { data: links } = await supabase
        .from("business_categories")
        .select("business_id")
        .eq("category_id", cat.id);
      categoryBusinessIds = (links ?? []).map((l) => l.business_id);
      if (categoryBusinessIds.length === 0) return [];
    } else {
      return [];
    }
  }

  let query = supabase
    .from("businesses")
    .select(PUBLIC_BUSINESS_COLUMNS)
    .eq("is_demo", false)
    .eq("publication_status", "live");

  if (params.q) {
    const term = params.q.trim();
    query = query.or(
      `name.ilike.%${term}%,short_description.ilike.%${term}%,city.ilike.%${term}%`
    );
  }
  const location = params.location ?? params.city;
  if (location) {
    const term = location.trim();
    query = query.or(`city.ilike.%${term}%,state.ilike.%${term}%`);
  }
  if (params.featuredOnly) query = query.eq("is_featured", true);
  if (params.foundingMemberOnly) query = query.eq("founding_member", true);
  if (categoryBusinessIds) {
    query = query.in("id", categoryBusinessIds);
  }

  if (params.sort === "newest") {
    query = query.order("created_at", { ascending: false }).order("name");
  } else if (params.sort === "az") {
    query = query.order("name", { ascending: true });
  } else {
    query = query
      .order("is_featured", { ascending: false })
      .order("founding_member", { ascending: false })
      .order("created_at", { ascending: false })
      .order("name");
  }

  if (params.offset) query = query.range(params.offset, params.offset + (params.limit ?? 24) - 1);
  else if (params.limit) query = query.limit(params.limit);

  const { data, error } = await query;
  logPublicQueryError("searchBusinesses", error);
  return attachCategories((data as unknown as Business[]) ?? []);
}

export async function getBusinessBySlug(slug: string): Promise<BusinessWithCategories | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("businesses")
    .select(PUBLIC_BUSINESS_COLUMNS)
    .eq("slug", slug)
    .eq("is_demo", false)
    .eq("publication_status", "live")
    .maybeSingle();
  logPublicQueryError("getBusinessBySlug", error);
  if (!data) return null;
  const [withCats] = await attachCategories([data as unknown as Business]);
  return withCats;
}

/** BEFORE this pass: order was is_featured desc, then name — no manual
 * control at all, and no explicit tiebreak beyond that (never
 * database-return order, but also nothing a business could adjust).
 * AFTER: profile_sort_order (nulls last) takes priority — a business/
 * founder can now pin an explicit order — falling back to the same
 * is_featured/name behavior for anything left unordered, so the sort stays
 * fully deterministic either way (final refinement pass, item 5). */
/** Business Profile V2 — the business-level gallery (business_images),
 * same normalized-child-rows pattern as event_images. Ordered, public,
 * read-only. */
export async function getBusinessGalleryImages(businessId: string): Promise<string[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("business_images")
    .select("url")
    .eq("business_id", businessId)
    .order("display_order", { ascending: true, nullsFirst: false });
  return (data ?? []).map((row) => row.url);
}

export async function getProductsForBusiness(businessId: string): Promise<Product[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("products")
    .select(PUBLIC_PRODUCT_COLUMNS)
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("profile_sort_order", { ascending: true, nullsFirst: false })
    .order("is_featured", { ascending: false })
    .order("name");
  logPublicQueryError("getProductsForBusiness", error);
  return (data as unknown as Product[]) ?? [];
}

export interface AppearanceWithEventSlug extends Appearance {
  event: { slug: string } | null;
}

export async function getUpcomingAppearancesForBusiness(
  businessId: string,
  limit = 20
): Promise<AppearanceWithEventSlug[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  // Same active-duration principle as events: end_at, not start_at,
  // decides eligibility. end_at is now required on new/edited appearances
  // (admin validation), so this is a plain comparison — a null end_at is
  // NOT treated as open-ended (a handful of legacy rows still have one;
  // they're excluded here until backfilled — see this pass's report).
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from("appearances")
    .select("*, event:events(slug)")
    .eq("business_id", businessId)
    .neq("status", "canceled")
    .gt("end_at", nowIso)
    .order("start_at", { ascending: true })
    .limit(limit);

  return ((data ?? []) as never[]).map((row: unknown) => {
    const r = row as Appearance & { event: { slug: string } | { slug: string }[] | null };
    const event = Array.isArray(r.event) ? (r.event[0] ?? null) : r.event;
    return { ...r, event };
  });
}

/** The one real FindMi business the homepage's "Have a business or
 * brand?" showcase demonstrates with (live-QA correction, 2026 nav pass,
 * Part 14) — was previously an entirely illustrative/static mockup. A
 * single named constant, not scattered literals, so swapping the demo
 * business later is a one-line change. */
export const SHOWCASE_BUSINESS_SLUG = "the-native-rose";

export interface ShowcaseBusinessData {
  business: BusinessWithCategories;
  products: Product[];
  appearances: AppearanceWithEventSlug[];
}

/** Resolves the showcase's real business + a couple of its real products/
 * upcoming appearances, using the exact same query functions its own
 * public profile page and homepage rows already use — no parallel data
 * path. Returns null (not throw) if the business is missing, unpublished,
 * or Supabase is unreachable, so BusinessShowcaseCarousel can fail back
 * to its illustrative markup instead of ever rendering broken/partial
 * real data. */
export async function getShowcaseBusiness(): Promise<ShowcaseBusinessData | null> {
  const business = await getBusinessBySlug(SHOWCASE_BUSINESS_SLUG);
  if (!business) return null;
  const [products, appearances] = await Promise.all([
    getProductsForBusiness(business.id),
    getUpcomingAppearancesForBusiness(business.id, 3),
  ]);
  return { business, products, appearances };
}

// ----------------------------------------------------------------------------
// Event Occurrences — discovery/featured helper.
//
// events stays identity/content; event_occurrences (when present) is the
// source of truth for WHEN an event is actually happening. This helper
// resolves "is this event upcoming, and for what date/location" for every
// event in one pass, branching per event:
//   - an event with ANY event_occurrences rows is judged purely by its
//     occurrences (cancelled rows never count; a row's own end_at decides
//     "hasn't ended yet").
//   - an event with ZERO event_occurrences rows falls back to its own
//     start_at/end_at exactly as before this feature existed — legacy
//     events are completely unaffected.
// Because occurrence eligibility is resolved into a Map keyed by event_id
// (keeping only the nearest qualifying occurrence per event), this
// naturally returns at most one row per event no matter how many
// occurrences it has — the mechanism that satisfies both "Today/Weekend/
// date-window filtering should match occurrences" and "a recurring event
// must not appear N times just because it has N featured occurrences".
// ----------------------------------------------------------------------------

export interface EffectiveEventRow {
  event: FindmiEvent;
  effectiveStart: string;
  effectiveEnd: string;
  /** The occurrence this row's date/location came from — null for a
   * legacy event with no event_occurrences rows (using the event's own
   * start_at/end_at directly). */
  occurrence: EventOccurrence | null;
  occurrenceLocation: FindmiLocation | null;
}

interface EffectiveUpcomingEventsOptions {
  /** Restrict to this set of parent event ids (e.g. a category's tagged
   * events) — applied to both the occurrence-driven branch and the
   * legacy-fallback branch. Omit/null for "all events". */
  eventIds?: string[] | null;
  /** When an event has more than one qualifying occurrence, prefer its
   * earliest FEATURED, still-scheduled occurrence for date/location
   * display over its plain earliest occurrence — falls back to the
   * earliest qualifying occurrence when the event has no featured one.
   * Used by getFeaturedEvents so a recurring event shows its next
   * *featured* date rather than just its chronologically-next one. */
  preferFeaturedOccurrence?: boolean;
  /** Same free-text/city/location filters getEventsDiscovery already
   * supports — applied server-side against the parent `events` table in
   * both branches, so text search stays a SQL ilike, not a JS scan. */
  q?: string;
  city?: string;
  location?: string;
}

function applyEventTextFilters<
  Q extends { or: (f: string) => Q; ilike: (col: string, v: string) => Q },
>(query: Q, opts: EffectiveUpcomingEventsOptions): Q {
  let q = query;
  if (opts.q) {
    const term = `%${opts.q.trim()}%`;
    q = q.or(`name.ilike.${term},description.ilike.${term},venue_name.ilike.${term}`);
  }
  if (opts.city) q = q.ilike("city", `%${opts.city}%`);
  if (opts.location) {
    const term = opts.location.trim();
    q = q.or(`city.ilike.%${term}%,state.ilike.%${term}%`);
  }
  return q;
}

/** Overrides an event's own start_at/end_at (and, when the occurrence has
 * a location on file, its venue/address/city/state/coordinates) with an
 * occurrence's — so every existing display component that already reads
 * plain FindmiEvent fields shows the right concrete date/place for a
 * recurring event without needing its own occurrence-aware rewrite. A
 * shallow clone; the underlying event row/id/slug are untouched. */
function applyOccurrenceOverride(
  event: FindmiEvent,
  occurrence: EventOccurrence | null,
  location: FindmiLocation | null
): FindmiEvent {
  if (!occurrence) return event;
  return {
    ...event,
    start_at: occurrence.start_at,
    end_at: occurrence.end_at,
    ...(location
      ? {
          venue_name: location.name,
          address: location.address,
          city: location.city,
          state: location.state,
          latitude: location.latitude,
          longitude: location.longitude,
        }
      : {}),
  };
}

export async function getEffectiveUpcomingEvents(
  bounds: { start: Date; end: Date } | null,
  options: EffectiveUpcomingEventsOptions = {}
): Promise<EffectiveEventRow[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  // Which events have ANY occurrence rows at all (any status) — these are
  // judged purely by their occurrences; everything else falls back to its
  // own start_at/end_at.
  const { data: occEventRows } = await supabase.from("event_occurrences").select("event_id");
  const eventsWithOccurrences = new Set((occEventRows ?? []).map((r) => r.event_id as string));

  // Qualifying occurrence rows for this window: never cancelled, and
  // either overlapping the given window or (bounds === null, "anytime")
  // simply not yet ended — same duration-overlap semantics as the
  // legacy events query below. Filtered as status = 'scheduled' rather
  // than != 'cancelled' — logically equivalent given the status CHECK
  // constraint only allows those two values, but Postgres's partial-index
  // predicate proof doesn't consult CHECK constraints, so only the "="
  // form can actually match event_occurrences_upcoming_idx/
  // event_occurrences_featured_idx (both defined `where status =
  // 'scheduled'`) — see the migration review. getUpcomingOccurrencesForEvent
  // (the public carousel) intentionally does NOT filter on status at all —
  // it still needs to return cancelled-but-not-yet-past occurrences so the
  // page can badge them, and is untouched by this change.
  let occQuery = supabase.from("event_occurrences").select("*").eq("status", "scheduled");
  occQuery = bounds
    ? occQuery.lt("start_at", bounds.end.toISOString()).gt("end_at", bounds.start.toISOString())
    : occQuery.gt("end_at", new Date().toISOString());
  const { data: occRows } = await occQuery.order("start_at", { ascending: true });

  // Keep only the nearest (and, separately, nearest-featured) qualifying
  // occurrence per event — rows already arrive start_at-ascending, so the
  // first one seen per event_id is the nearest.
  const nearestByEvent = new Map<string, EventOccurrence>();
  const nearestFeaturedByEvent = new Map<string, EventOccurrence>();
  for (const row of (occRows ?? []) as EventOccurrence[]) {
    if (!nearestByEvent.has(row.event_id)) nearestByEvent.set(row.event_id, row);
    if (row.featured && !nearestFeaturedByEvent.has(row.event_id)) nearestFeaturedByEvent.set(row.event_id, row);
  }

  let occurrenceEventIds = Array.from(nearestByEvent.keys());
  if (options.eventIds) {
    const allowed = new Set(options.eventIds);
    occurrenceEventIds = occurrenceEventIds.filter((id) => allowed.has(id));
  }

  let occurrenceEvents: FindmiEvent[] = [];
  if (occurrenceEventIds.length > 0) {
    let evQuery = supabase.from("events").select("*").eq("is_demo", false).in("id", occurrenceEventIds);
    evQuery = applyEventTextFilters(evQuery, options);
    const { data } = await evQuery;
    occurrenceEvents = data ?? [];
  }

  // Legacy branch — events with zero event_occurrences rows, matched by
  // their own start_at/end_at exactly as before this feature existed.
  let legacyQuery = supabase.from("events").select("*").eq("is_demo", false);
  if (options.eventIds) legacyQuery = legacyQuery.in("id", options.eventIds);
  legacyQuery = bounds
    ? legacyQuery.lt("start_at", bounds.end.toISOString()).gt("end_at", bounds.start.toISOString())
    : legacyQuery.gt("end_at", new Date().toISOString());
  legacyQuery = applyEventTextFilters(legacyQuery, options);
  const { data: legacyRows } = await legacyQuery;
  const legacyEvents = ((legacyRows ?? []) as FindmiEvent[]).filter((e) => !eventsWithOccurrences.has(e.id));

  // Locations for the chosen occurrences' display.
  const chosenOccurrences = occurrenceEvents
    .map((e) => (options.preferFeaturedOccurrence ? (nearestFeaturedByEvent.get(e.id) ?? nearestByEvent.get(e.id)) : nearestByEvent.get(e.id)))
    .filter((o): o is EventOccurrence => !!o);
  const locationIds = Array.from(
    new Set(chosenOccurrences.map((o) => o.location_id).filter((id): id is string => !!id))
  );
  const locationsById = new Map<string, FindmiLocation>();
  if (locationIds.length > 0) {
    const { data: locs } = await supabase.from("locations").select("*").in("id", locationIds);
    for (const l of (locs ?? []) as FindmiLocation[]) locationsById.set(l.id, l);
  }

  const rows: EffectiveEventRow[] = [];
  for (const event of occurrenceEvents) {
    const occ = options.preferFeaturedOccurrence
      ? (nearestFeaturedByEvent.get(event.id) ?? nearestByEvent.get(event.id))
      : nearestByEvent.get(event.id);
    if (!occ) continue;
    rows.push({
      event,
      effectiveStart: occ.start_at,
      effectiveEnd: occ.end_at,
      occurrence: occ,
      occurrenceLocation: occ.location_id ? (locationsById.get(occ.location_id) ?? null) : null,
    });
  }
  for (const event of legacyEvents) {
    rows.push({
      event,
      effectiveStart: event.start_at,
      effectiveEnd: event.end_at ?? event.start_at,
      occurrence: null,
      occurrenceLocation: null,
    });
  }

  rows.sort((a, b) => new Date(a.effectiveStart).getTime() - new Date(b.effectiveStart).getTime());
  return rows;
}

export async function getUpcomingEvents(
  limit = 20,
  when: DiscoveryWindow = "anytime"
): Promise<FindmiEvent[]> {
  const bounds = getDiscoveryWindowBounds(when);
  const rows = await getEffectiveUpcomingEvents(bounds);
  return rows.slice(0, limit).map((r) => applyOccurrenceOverride(r.event, r.occurrence, r.occurrenceLocation));
}

/** Editorial top-of-page Featured Events — is_featured first (ordered by
 * the founder's own featured_sort_order, nulls last), then legitimate
 * upcoming events as fallback. Never fabricated. "Upcoming" here means
 * "hasn't ended yet" (end_at > now), not "hasn't started yet" — see the
 * active-event visibility bug fix. A recurring event with several
 * featured occurrences still contributes exactly one row here (see
 * getEffectiveUpcomingEvents), shown with its nearest featured (or, if
 * none, nearest upcoming) occurrence's date/location. */
export async function getFeaturedEvents(limit = 6): Promise<FindmiEvent[]> {
  const rows = await getEffectiveUpcomingEvents(null, { preferFeaturedOccurrence: true });
  rows.sort((a, b) => {
    const aFeatured = a.event.is_featured ? 0 : 1;
    const bFeatured = b.event.is_featured ? 0 : 1;
    if (aFeatured !== bFeatured) return aFeatured - bFeatured;
    const aOrder = a.event.featured_sort_order ?? Number.POSITIVE_INFINITY;
    const bOrder = b.event.featured_sort_order ?? Number.POSITIVE_INFINITY;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return new Date(a.effectiveStart).getTime() - new Date(b.effectiveStart).getTime();
  });
  return rows.slice(0, limit).map((r) => applyOccurrenceOverride(r.event, r.occurrence, r.occurrenceLocation));
}

export interface EventDiscoveryParams {
  q?: string;
  when?: DiscoveryWindow;
  /** YYYY-MM-DD — overrides `when` when present (the exact-date picker). */
  date?: string;
  categorySlug?: string;
  /** Free-text match against city OR state — same real-data-only
   * location filter as searchBusinesses (Discovery + Archive V2 Part
   * 10). `city` alone is kept for existing callers. */
  city?: string;
  location?: string;
  limit?: number;
  offset?: number;
}

/** Shared events query — backs /events' "All Events" browse state and
 * every curated row on that page (This Weekend, category rows, etc.), per
 * CLAUDE.md's "reuse architecture only where it meaningfully prevents
 * duplication" — one query helper, not five bespoke ones.
 *
 * Date/window eligibility is occurrence-aware (see
 * getEffectiveUpcomingEvents): an event with event_occurrences rows is
 * matched by them; a legacy event with none falls back to its own
 * start_at/end_at exactly as before. q/city/location/categorySlug are
 * unchanged — still applied against the parent events table. Because
 * eligible events can come from either branch, final ordering (by
 * effective date) and limit/offset paging happen after both branches are
 * combined, in JS rather than a single SQL ORDER BY/LIMIT — the
 * trade-off that lets one query surface both occurrence-driven and
 * legacy events without a database-side recurrence join. */
export async function getEventsDiscovery(params: EventDiscoveryParams = {}): Promise<FindmiEvent[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  let categoryEventIds: string[] | null = null;
  if (params.categorySlug) {
    const { data: cat } = await supabase
      .from("categories")
      .select("id")
      .eq("slug", params.categorySlug)
      .eq("kind", "event")
      .maybeSingle();
    if (!cat) return [];
    const { data: links } = await supabase
      .from("event_categories")
      .select("event_id")
      .eq("category_id", cat.id);
    categoryEventIds = (links ?? []).map((l) => l.event_id);
    if (categoryEventIds.length === 0) return [];
  }

  const bounds = params.date ? getExactDateBounds(params.date) : getDiscoveryWindowBounds(params.when ?? "anytime");
  const rows = await getEffectiveUpcomingEvents(bounds, {
    eventIds: categoryEventIds,
    q: params.q,
    city: params.city,
    location: params.location,
  });

  const offset = params.offset ?? 0;
  const limit = params.limit ?? 50;
  return rows
    .slice(offset, offset + limit)
    .map((r) => applyOccurrenceOverride(r.event, r.occurrence, r.occurrenceLocation));
}

/** Attaches each event's tagged categories (event_categories) — mirrors
 * attachCategories' shape/pattern for businesses. Used where category
 * badges/grouping are needed; plain getUpcomingEvents/getEventsDiscovery
 * callers that don't need categories skip this extra query. */
export async function attachEventCategories(events: FindmiEvent[]): Promise<EventWithCategories[]> {
  const supabase = getSupabase();
  if (!supabase || events.length === 0) return events.map((e) => ({ ...e, categories: [] }));
  const ids = events.map((e) => e.id);
  const { data } = await supabase
    .from("event_categories")
    .select("event_id, categories!inner(id, name, slug)")
    .eq("categories.kind", "event")
    .in("event_id", ids);

  const byEvent = new Map<string, Category[]>();
  for (const row of (data ?? []) as { event_id: string; categories: Category | Category[] | null }[]) {
    const cats = Array.isArray(row.categories) ? row.categories : row.categories ? [row.categories] : [];
    byEvent.set(row.event_id, [...(byEvent.get(row.event_id) ?? []), ...cats]);
  }
  return events.map((e) => ({ ...e, categories: byEvent.get(e.id) ?? [] }));
}

export async function getEventBySlug(slug: string): Promise<FindmiEvent | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("events")
    .select("*")
    .eq("slug", slug)
    .eq("is_demo", false)
    .maybeSingle();
  return data ?? null;
}

export interface EventOccurrenceWithLocation extends EventOccurrence {
  location: FindmiLocation | null;
}

/** For the public event page's "Upcoming Dates" carousel — every
 * still-upcoming occurrence for one event, INCLUDING cancelled ones (so
 * the carousel can show a "Cancelled" badge on a date rather than have it
 * silently vanish), ordered soonest first. A legacy event with zero
 * event_occurrences rows simply returns []; the page falls back to its
 * own single start_at/end_at display as before. */
export async function getUpcomingOccurrencesForEvent(
  eventId: string,
  limit = 12
): Promise<EventOccurrenceWithLocation[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("event_occurrences")
    .select("*")
    .eq("event_id", eventId)
    .gt("end_at", new Date().toISOString())
    .order("start_at", { ascending: true })
    .limit(limit);
  const occurrences = (data ?? []) as EventOccurrence[];
  if (occurrences.length === 0) return [];

  const locationIds = Array.from(new Set(occurrences.map((o) => o.location_id).filter((id): id is string => !!id)));
  const locationsById = new Map<string, FindmiLocation>();
  if (locationIds.length > 0) {
    const { data: locs } = await supabase.from("locations").select("*").in("id", locationIds);
    for (const l of (locs ?? []) as FindmiLocation[]) locationsById.set(l.id, l);
  }

  return occurrences.map((o) => ({ ...o, location: o.location_id ? (locationsById.get(o.location_id) ?? null) : null }));
}

/** Whether an event has ANY event_occurrences row at all — any status,
 * any time, past included. Recurring Events V2's public page needs this
 * distinct from getUpcomingOccurrencesForEvent's result: an empty
 * upcoming-occurrences list is ambiguous between "legacy one-time event,
 * zero occurrence rows ever" (fall back to the event's own start_at/
 * end_at, exactly as before) and "recurring event, occurrence rows exist
 * but none are currently announced as upcoming" ("No upcoming dates
 * announced" — never fall back to stale parent scheduling). A cheap
 * existence check, not a second fetch of the rows themselves. */
export async function eventHasAnyOccurrences(eventId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { count } = await supabase
    .from("event_occurrences")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);
  return (count ?? 0) > 0;
}

export interface EventBusinessListing extends BusinessWithCategories {
  featured: boolean;
  /** Event-specific "what they'll have here" text (see /admin's Event
   * editor) — falls back to the business's own short_description when not
   * set for this event. */
  offering_text: string | null;
}

/** Only "approved" participants are public — "invited"/"applied"/"pending"/
 * "declined" exist for the organizer's own workflow (see /admin) and never
 * reach this query. featured=true businesses are still included in the
 * full list (not a separate pool) — the event page decides how to
 * highlight them; this just carries the flag along. Ordered by the
 * founder-set display_order, nulls last, then name. */
export async function getBusinessesForEvent(eventId: string): Promise<EventBusinessListing[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("event_businesses")
    .select(`featured, offering_text, display_order, businesses(${PUBLIC_BUSINESS_COLUMNS})`)
    .eq("event_id", eventId)
    .eq("status", "approved")
    .order("display_order", { ascending: true, nullsFirst: false });
  logPublicQueryError("getBusinessesForEvent", error);

  type Row = {
    featured: boolean;
    offering_text: string | null;
    display_order: number | null;
    businesses: Business | Business[] | null;
  };
  const rows = ((data ?? []) as unknown as Row[])
    .map((row) => {
      const business = Array.isArray(row.businesses) ? row.businesses[0] : row.businesses;
      const b = business as (Business & { is_demo?: boolean }) | null;
      return b && !b.is_demo && b.publication_status === "live"
        ? { business: b, featured: row.featured, offering_text: row.offering_text }
        : null;
    })
    .filter((r): r is { business: Business; featured: boolean; offering_text: string | null } => Boolean(r));

  const withCategories = await attachCategories(rows.map((r) => r.business));
  return withCategories.map((b, i) => ({
    ...b,
    featured: rows[i].featured,
    offering_text: rows[i].offering_text,
  }));
}

/** Occurrence-specific public vendor rosters (Recurring Events V2) — for
 * events WITH occurrence rows, event_occurrence_businesses is
 * authoritative for a given date's lineup, never event_businesses (see
 * getBusinessesForEvent above, which stays exactly as-is for legacy
 * one-time events). One query for every occurrence's roster at once
 * (not one per occurrence) to avoid N+1 — the public event page fetches
 * this once for all of an event's upcoming occurrences and looks up the
 * currently selected one client-side, so switching Upcoming Dates cards
 * never refetches. Only `status = 'approved'` rows are ever returned;
 * ordered featured-first, then by business name (event_occurrence_
 * businesses has no manual display_order — see the migration report),
 * so the result is already in a sensible, stable order without further
 * client-side sorting. Same is_demo/publication_status filtering as
 * getBusinessesForEvent, for the same reason. */
export async function getOccurrenceBusinessRosters(
  occurrenceIds: string[]
): Promise<Record<string, EventBusinessListing[]>> {
  const byOccurrence: Record<string, EventBusinessListing[]> = {};
  if (occurrenceIds.length === 0) return byOccurrence;
  const supabase = getSupabase();
  if (!supabase) return byOccurrence;

  const { data, error } = await supabase
    .from("event_occurrence_businesses")
    .select(`occurrence_id, featured, businesses(${PUBLIC_BUSINESS_COLUMNS})`)
    .in("occurrence_id", occurrenceIds)
    .eq("status", "approved")
    .order("featured", { ascending: false })
    .order("name", { foreignTable: "businesses", ascending: true });
  logPublicQueryError("getOccurrenceBusinessRosters", error);

  type Row = { occurrence_id: string; featured: boolean; businesses: Business | Business[] | null };
  const rows = ((data ?? []) as unknown as Row[])
    .map((row) => {
      const business = Array.isArray(row.businesses) ? row.businesses[0] : row.businesses;
      const b = business as (Business & { is_demo?: boolean }) | null;
      return b && !b.is_demo && b.publication_status === "live"
        ? { occurrence_id: row.occurrence_id, business: b, featured: row.featured }
        : null;
    })
    .filter((r): r is { occurrence_id: string; business: Business; featured: boolean } => Boolean(r));
  if (rows.length === 0) return byOccurrence;

  const withCategories = await attachCategories(rows.map((r) => r.business));
  withCategories.forEach((b, i) => {
    const listing: EventBusinessListing = { ...b, featured: rows[i].featured, offering_text: null };
    const occId = rows[i].occurrence_id;
    (byOccurrence[occId] ??= []).push(listing);
  });
  return byOccurrence;
}

export async function getUpcomingAppearancesForEvent(eventId: string): Promise<Appearance[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("appearances")
    .select("*")
    .eq("event_id", eventId)
    .order("start_at", { ascending: true });
  return data ?? [];
}

export interface AppearanceFeedItem extends Appearance {
  business: {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    cover_image_url?: string | null;
  };
}

/** Upcoming appearances across all businesses, newest-first by date — powers
 * the homepage "Find Them Next" feed. Eligibility is end_at-based (still
 * active or in the future), same active-duration principle as events.
 * end_at is required on new/edited appearances now, so a null end_at is
 * NOT treated as open-ended — a handful of legacy rows still have one and
 * are excluded here until backfilled (see this pass's report). */
export async function getUpcomingAppearancesFeed(limit = 8): Promise<AppearanceFeedItem[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from("appearances")
    .select("*, business:businesses(id, name, slug, logo_url, is_demo, publication_status)")
    .neq("status", "canceled")
    .gt("end_at", nowIso)
    .order("start_at", { ascending: true })
    .limit(limit * 2); // over-fetch since some may be filtered out as demo

  type JoinedBusiness = AppearanceFeedItem["business"] & { is_demo: boolean; publication_status: string };
  return ((data ?? []) as never[])
    .map((row: unknown) => {
      const r = row as Appearance & { business: JoinedBusiness | JoinedBusiness[] };
      const business = Array.isArray(r.business) ? r.business[0] : r.business;
      return { ...r, business };
    })
    .filter((item) => item.business && !item.business.is_demo && item.business.publication_status === "live")
    .slice(0, limit)
    .map(({ business: { is_demo: _isDemo, publication_status: _pubStatus, ...business }, ...rest }) => ({ ...rest, business }));
}

export type FindWindow = "live" | "today" | "weekend" | "anytime";

/** The FindMi Here discovery feed — real appearances across every business,
 * filtered to one of the four temporal tabs. "live" means genuinely HERE
 * NOW (start_at <= now <= end_at), not a guess. The other tabs use the
 * same active-duration/overlap principle as events (end_at-based, not
 * start_at-only). end_at is required on new/edited appearances now, so
 * every tab here treats a null end_at the same way: NOT open-ended — a
 * handful of legacy rows still have one and are excluded across every tab
 * until backfilled (see this pass's report). Optional categorySlug/city
 * back /find's WHAT/WHERE filters — same category-then-filter-ids pattern
 * used by searchBusinesses, applied here via business_id. */
export async function getFindMiHereFeed(
  when: FindWindow,
  limit = 30,
  extra: { categorySlug?: string; city?: string } = {}
): Promise<AppearanceFeedItem[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const nowIso = new Date().toISOString();

  let categoryBusinessIds: string[] | null = null;
  if (extra.categorySlug) {
    const { data: cat } = await supabase
      .from("categories")
      .select("id")
      .eq("slug", extra.categorySlug)
      .eq("kind", "business")
      .maybeSingle();
    if (!cat) return [];
    const { data: links } = await supabase.from("business_categories").select("business_id").eq("category_id", cat.id);
    categoryBusinessIds = (links ?? []).map((l) => l.business_id);
    if (categoryBusinessIds.length === 0) return [];
  }

  let query = supabase
    .from("appearances")
    .select("*, business:businesses(id, name, slug, logo_url, cover_image_url, is_demo, publication_status)")
    .neq("status", "canceled");

  if (when === "live") {
    query = query.lte("start_at", nowIso).gte("end_at", nowIso);
  } else if (when === "anytime") {
    query = query.gt("end_at", nowIso);
  } else {
    const bounds = getDiscoveryWindowBounds(when === "today" ? "now" : "weekend");
    if (bounds) {
      // Duration overlap, same as the events fix: starts before the
      // window ends, and ends after the window starts.
      query = query.lt("start_at", bounds.end.toISOString()).gt("end_at", bounds.start.toISOString());
    } else {
      query = query.gt("end_at", nowIso);
    }
  }
  if (categoryBusinessIds) query = query.in("business_id", categoryBusinessIds);
  if (extra.city) query = query.ilike("city", `%${extra.city}%`);

  // Featured appearances (see event_businesses.featured / appearances'
  // own is_featured — an admin-set editorial flag) sort first within
  // whichever time window applies, ahead of plain chronological order.
  // This is what lets the homepage hero legitimately favor a founder-
  // curated appearance over whatever merely happens to start soonest —
  // no name/business-based special-casing.
  const { data } = await query
    .order("is_featured", { ascending: false })
    .order("start_at", { ascending: true })
    .limit(limit * 2); // over-fetch since some may be filtered out as demo

  type JoinedBusiness = AppearanceFeedItem["business"] & { is_demo: boolean; publication_status: string };
  return ((data ?? []) as never[])
    .map((row: unknown) => {
      const r = row as Appearance & { business: JoinedBusiness | JoinedBusiness[] };
      const business = Array.isArray(r.business) ? r.business[0] : r.business;
      return { ...r, business };
    })
    .filter((item) => item.business && !item.business.is_demo && item.business.publication_status === "live")
    .slice(0, limit)
    .map(({ business: { is_demo: _isDemo, publication_status: _pubStatus, ...business }, ...rest }) => ({ ...rest, business }));
}

/** Businesses that travel to customers rather than operate from a single
 * fixed address — powers the homepage "Brands On The Move" row. */
export async function getMobileBusinesses(limit = 8): Promise<BusinessWithCategories[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  // Ordered by service radius (not founding_member, like most other
  // homepage rows) so this row reads as its own curated take — "who
  // travels farthest" — rather than mechanically repeating the same
  // founding-member-first order every other section already showed.
  const { data, error } = await supabase
    .from("businesses")
    .select(PUBLIC_BUSINESS_COLUMNS)
    .not("service_radius_miles", "is", null)
    .eq("is_demo", false)
    .eq("publication_status", "live")
    .order("service_radius_miles", { ascending: false })
    .limit(limit);
  logPublicQueryError("getMobileBusinesses", error);
  return attachCategories((data as unknown as Business[]) ?? []);
}

export interface FeaturedProduct extends Product {
  business: {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    /** Master commerce switch (see businesses.commerce_enabled) — needed
     * here so ProductCard's CTA label can use the same purchase-
     * eligibility rule as the product detail page, instead of guessing
     * from `purchasable` alone (commerce-audit fix). */
    commerce_enabled: boolean;
    /** The product's own first-class category (product_categories) when
     * it has one; otherwise the selling business's primary category as a
     * fallback (see getPrimaryCategoryByProduct/getPrimaryCategoryByBusiness).
     * Null only when neither exists. */
    categoryName: string | null;
  };
}

/** Founder-curated homepage/marketplace Featured Products
 * (products.is_featured + home_sort_order — the founder decides both
 * which products appear and their order). */
export async function getFeaturedProducts(limit = 8): Promise<FeaturedProduct[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("products")
    .select(`${PUBLIC_PRODUCT_COLUMNS}, business:businesses(id, name, slug, logo_url, commerce_enabled, is_demo, publication_status)`)
    .eq("is_featured", true)
    .eq("is_active", true)
    .order("home_sort_order", { ascending: true, nullsFirst: false })
    .order("name")
    .limit(limit * 2); // over-fetch since some may be filtered out as demo
  logPublicQueryError("getFeaturedProducts", error);

  type JoinedBusiness = Omit<FeaturedProduct["business"], "categoryName"> & {
    is_demo: boolean;
    publication_status: string;
  };
  const rows = ((data ?? []) as never[])
    .map((row: unknown) => {
      const r = row as Product & { business: JoinedBusiness | JoinedBusiness[] };
      const business = Array.isArray(r.business) ? r.business[0] : r.business;
      return { ...r, business };
    })
    .filter((item) => item.business && !item.business.is_demo && item.business.publication_status === "live")
    .slice(0, limit);

  const businessIds = Array.from(new Set(rows.map((r) => r.business.id)));
  const productIds = rows.map((r) => r.id);
  const [categoryByBusiness, categoryByProduct] = await Promise.all([
    businessIds.length ? getPrimaryCategoryByBusiness(supabase, businessIds) : new Map<string, string>(),
    getPrimaryCategoryByProduct(supabase, productIds),
  ]);

  return rows.map(({ business: { is_demo: _isDemo, publication_status: _pubStatus, ...business }, ...rest }) => ({
    ...rest,
    business: { ...business, categoryName: categoryByProduct.get(rest.id) ?? categoryByBusiness.get(business.id) ?? null },
  }));
}

export interface ProductWithBusiness extends Product {
  business: {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    cover_image_url: string | null;
    commerce_enabled: boolean;
    city: string | null;
    state: string | null;
    /** Seller's real primary category (business_categories), attached the
     * same way getFeaturedProducts/getMarketplaceProducts already do —
     * products have no taxonomy of their own. This is SELLER identity
     * data (shown next to the seller's name/location on the product
     * page), never presented as a product category — see Product Detail
     * V2's report for why the two are kept explicitly distinct. */
    categoryName: string | null;
  };
}

/** product.slug is unique per business, not globally (schema:
 * unique(business_id, slug)) — with today's small catalog that's not a
 * practical collision risk, but a route keyed on slug alone will need a
 * business-scoped path (or a global uniqueness constraint) once enough
 * businesses are onboarded that two of them plausibly share a slug. */
export async function getProductBySlug(slug: string): Promise<ProductWithBusiness | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("products")
    .select(
      `${PUBLIC_PRODUCT_COLUMNS}, business:businesses(id, name, slug, logo_url, cover_image_url, commerce_enabled, city, state, is_demo, publication_status)`
    )
    .eq("slug", slug)
    .eq("is_active", true);
  logPublicQueryError("getProductBySlug", error);

  type JoinedBusiness = Omit<ProductWithBusiness["business"], "categoryName"> & {
    is_demo: boolean;
    publication_status: string;
  };
  const match = ((data ?? []) as never[])
    .map((row: unknown) => {
      const r = row as Product & { business: JoinedBusiness | JoinedBusiness[] };
      const business = Array.isArray(r.business) ? r.business[0] : r.business;
      return { ...r, business };
    })
    .find((item) => item.business && !item.business.is_demo && item.business.publication_status === "live");

  if (!match) return null;
  const { business, ...rest } = match;
  const { is_demo: _isDemo, publication_status: _pubStatus, ...cleanBusiness } = business;
  const [categoryMap, productCategoryMap] = await Promise.all([
    getPrimaryCategoryByBusiness(supabase, [business.id]),
    getPrimaryCategoryByProduct(supabase, [rest.id]),
  ]);
  return {
    ...rest,
    business: {
      ...cleanBusiness,
      categoryName: productCategoryMap.get(rest.id) ?? categoryMap.get(business.id) ?? null,
    },
  };
}

export interface FulfillmentOptionDisplay {
  method: FulfillmentMethod;
  price: number;
  label: string;
  appearanceId: string | null;
}

/** Enabled fulfillment choices for one purchasable product, with an
 * event-pickup option's label resolved from its appearance (venue + date)
 * — feeds the product page's Add to Cart fulfillment picker. Only
 * upcoming, non-canceled appearances are eligible (the appearances table's
 * own RLS already excludes canceled ones); a past appearance configured
 * for pickup quietly stops being offered rather than needing manual
 * cleanup. */
export async function getFulfillmentOptionsForProduct(
  productId: string
): Promise<FulfillmentOptionDisplay[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("product_fulfillment_options")
    .select("method, price, appearance_id, appearances(venue_name, title, start_at, end_at, description)")
    .eq("product_id", productId)
    .eq("enabled", true);

  type Row = {
    method: FulfillmentMethod;
    price: number;
    appearance_id: string | null;
    appearances:
      | { venue_name: string | null; title: string; start_at: string; end_at: string | null; description: string | null }
      | { venue_name: string | null; title: string; start_at: string; end_at: string | null; description: string | null }[]
      | null;
  };
  const METHOD_LABELS: Record<FulfillmentMethod, string> = {
    shipping: "Shipping",
    local_delivery: "Local Delivery",
    pickup: "Pickup",
    event_pickup: "Event Pickup",
  };

  return ((data ?? []) as Row[])
    .map((row) => {
      const appearance = Array.isArray(row.appearances) ? row.appearances[0] : row.appearances;
      if (row.method === "event_pickup" && !appearance) return null; // stale/removed appearance
      // formatAppearanceDateRange shows "Time TBD" instead of a formatted
      // time when this appearance's real time is genuinely unknown (see
      // lib/format.ts) — a checkout-facing pickup label must never claim
      // a confirmed pickup time that was actually just a placeholder.
      const label =
        row.method === "event_pickup" && appearance
          ? `Pickup at ${appearance.venue_name ?? appearance.title} — ${formatAppearanceDateRange(appearance.start_at, appearance.end_at, appearance.description)}`
          : METHOD_LABELS[row.method];
      return { method: row.method, price: row.price, label, appearanceId: row.appearance_id };
    })
    .filter((o): o is FulfillmentOptionDisplay => Boolean(o));
}

export interface HomeBulletin {
  id: string;
  bulletinText: string;
  startAt: string;
  endAt: string | null;
  business: { id: string; name: string; slug: string; logo_url: string | null; cover_image_url: string | null };
  href: string;
}

/** Brand bulletins (Part 3F) — ONLY appearances the founder explicitly
 * marked show_on_home=true surface here, ordered by home_sort_order. This
 * is deliberately not "every upcoming appearance" — the homepage FindMi
 * Here row is now a curated bulletin feed, not an automatic dump. Falls
 * back to a plain, honest "{title} — {venue}" line when bulletin_text
 * wasn't set, rather than skipping a founder-enabled appearance outright. */
export async function getHomeAppearanceBulletins(limit = 6): Promise<HomeBulletin[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  // Same active-duration principle as events (end_at-based, not
  // start_at-only). end_at is required on new/edited appearances now, so
  // a null end_at is NOT treated as open-ended — a handful of legacy rows
  // still have one and are excluded here until backfilled (see this
  // pass's report).
  const { data } = await supabase
    .from("appearances")
    .select(
      "*, business:businesses(id, name, slug, logo_url, cover_image_url, is_demo, publication_status), event:events(slug)"
    )
    .eq("show_on_home", true)
    .neq("status", "canceled")
    .gt("end_at", new Date().toISOString())
    .order("home_sort_order", { ascending: true, nullsFirst: false })
    .order("start_at", { ascending: true })
    .limit(limit * 2);

  type JoinedBusiness = HomeBulletin["business"] & { is_demo: boolean; publication_status: string };
  type Row = Appearance & {
    business: JoinedBusiness | JoinedBusiness[] | null;
    event: { slug: string } | { slug: string }[] | null;
  };
  return ((data ?? []) as Row[])
    .map((row) => {
      const business = Array.isArray(row.business) ? row.business[0] : row.business;
      const event = Array.isArray(row.event) ? row.event[0] : row.event;
      if (!business || business.is_demo || business.publication_status !== "live") return null;
      const { is_demo: _isDemo, publication_status: _pubStatus, ...cleanBusiness } = business;
      return {
        id: row.id,
        bulletinText: row.bulletin_text?.trim() || `${row.title} at ${row.venue_name ?? "a FindMi location"}`,
        startAt: row.start_at,
        endAt: row.end_at,
        business: cleanBusiness,
        href: event ? `/event/${event.slug}` : `/business/${cleanBusiness.slug}`,
      };
    })
    .filter((b): b is HomeBulletin => Boolean(b))
    .slice(0, limit);
}

export interface NextAppearanceHint {
  /** Quick UI fix — Next Up appearance title: despite the field name
   * (kept as-is to minimize the change's surface), this is the
   * appearance's own title, falling back to its related event's name
   * when the title is blank — never the venue/location name. */
  venue: string;
  startAt: string;
  /** Canonical link for this appearance — the real FindMi event page when
   * it belongs to one, null otherwise (there's no public /appearance/[id]
   * route, so a standalone appearance has no canonical destination of its
   * own to link to — never fabricated). Added for BusinessLogoCard's
   * "NEXT UP" module (visual polish pass, item 2); existing callers that
   * only destructure {venue, startAt} are unaffected. */
  href: string | null;
}

/** Bulk "next real appearance" per business — powers business cards'
 * compact "At X Saturday" signal (Part 5D) and the NEXT UP module. Only
 * genuine upcoming, non-canceled appearances; a business with nothing
 * scheduled contributes no entry, so cards never fabricate activity. */
export async function getNextAppearanceHints(businessIds: string[]): Promise<Map<string, NextAppearanceHint>> {
  const hints = new Map<string, NextAppearanceHint>();
  const supabase = getSupabase();
  if (!supabase || businessIds.length === 0) return hints;
  // Same active-duration principle as events — see getHomeAppearanceBulletins.
  const { data } = await supabase
    .from("appearances")
    .select("business_id, title, start_at, event:events(slug, is_demo, name)")
    .in("business_id", businessIds)
    .neq("status", "canceled")
    .gt("end_at", new Date().toISOString())
    .order("start_at", { ascending: true });
  for (const row of (data ?? []) as never[]) {
    const r = row as {
      business_id: string;
      title: string;
      start_at: string;
      event: { slug: string; is_demo: boolean; name: string } | { slug: string; is_demo: boolean; name: string }[] | null;
    };
    if (hints.has(r.business_id)) continue;
    const event = Array.isArray(r.event) ? (r.event[0] ?? null) : r.event;
    // Launch-polish pass item 6 — the actual 404 root cause: this was the
    // only appearances→events join in the file with no is_demo filter
    // (every other event/business query in this file excludes is_demo —
    // see getEventBySlug etc.), so a NEXT UP hint could point to a demo
    // event's slug, which getEventBySlug then correctly refuses to
    // resolve (its own is_demo=false filter), producing a 404. The
    // appearance itself is still real, so the hint isn't dropped
    // entirely — only its href is nulled, which is exactly what makes
    // BusinessLogoCard render it as static (non-clickable) text instead
    // of a dead link.
    //
    // Quick UI fix — Next Up appearance title: this used to show
    // venue_name (falling back to title only when venue_name was blank).
    // The appearance's own title is the field meant to identify it — the
    // "field" property below is still named venue for now (kept as the
    // smallest possible change; nothing about its consuming components'
    // styling/layout changed), but its value is the appearance title,
    // falling back to the related event's name when the appearance title
    // itself is blank.
    hints.set(r.business_id, {
      venue: r.title || event?.name || "",
      startAt: r.start_at,
      href: event && !event.is_demo ? `/event/${event.slug}` : null,
    });
  }
  return hints;
}

export interface MarketplaceProduct extends Product {
  business: { id: string; name: string; slug: string; logo_url: string | null; commerce_enabled: boolean };
}

export interface MarketplaceProductParams {
  q?: string;
  categorySlug?: string;
  featuredOnly?: boolean;
  limit?: number;
}

/** The public product marketplace's shared query (/marketplace and the
 * homepage's Shop FindMi row both read real purchasable/inquiry-ready
 * catalog data through here — see getFeaturedProducts for the curated
 * subset, this is the full active catalog). categorySlug filters by the
 * SELLING BUSINESS's category — this filter/grouping system stays
 * business-category-based even now that products have their own
 * first-class taxonomy (product_categories); switching the marketplace's
 * own filter/grouping to real product categories is a bigger change left
 * for a future pass. Only the product-card/detail LABEL prefers a real
 * product category when one exists — see getPrimaryCategoryByProduct. */
export async function getMarketplaceProducts(params: MarketplaceProductParams = {}): Promise<MarketplaceProduct[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  let categoryBusinessIds: string[] | null = null;
  if (params.categorySlug) {
    const { data: cat } = await supabase
      .from("categories")
      .select("id")
      .eq("slug", params.categorySlug)
      .eq("kind", "business")
      .maybeSingle();
    if (!cat) return [];
    const { data: links } = await supabase.from("business_categories").select("business_id").eq("category_id", cat.id);
    categoryBusinessIds = (links ?? []).map((l) => l.business_id);
    if (categoryBusinessIds.length === 0) return [];
  }

  const limit = params.limit ?? 40;
  let query = supabase
    .from("products")
    .select(`${PUBLIC_PRODUCT_COLUMNS}, business:businesses(id, name, slug, logo_url, commerce_enabled, is_demo, publication_status)`)
    .eq("is_active", true);
  if (params.q) {
    const term = `%${params.q.trim()}%`;
    query = query.or(`name.ilike.${term},description.ilike.${term}`);
  }
  if (categoryBusinessIds) query = query.in("business_id", categoryBusinessIds);
  if (params.featuredOnly) query = query.eq("is_featured", true);

  const { data, error } = await query
    .order("is_featured", { ascending: false })
    .order("home_sort_order", { ascending: true, nullsFirst: false })
    .order("name")
    .limit(limit * 2); // over-fetch since some may be filtered out as demo
  logPublicQueryError("getMarketplaceProducts", error);

  type JoinedBusiness = MarketplaceProduct["business"] & { is_demo: boolean; publication_status: string };
  return ((data ?? []) as never[])
    .map((row: unknown) => {
      const r = row as Product & { business: JoinedBusiness | JoinedBusiness[] };
      const business = Array.isArray(r.business) ? r.business[0] : r.business;
      return { ...r, business };
    })
    .filter((item) => item.business && !item.business.is_demo && item.business.publication_status === "live")
    .slice(0, limit)
    .map(({ business: { is_demo: _isDemo, publication_status: _pubStatus, ...business }, ...rest }) => ({
      ...rest,
      business,
    }));
}

/** Final refinement pass, items 9/10 — real event gallery + venue gallery
 * images (event_images, kind-partitioned). One query, split client-side
 * by kind rather than two round trips, since both are always needed
 * together on the event page. */
export async function getEventImages(eventId: string): Promise<{ gallery: string[]; venue: string[] }> {
  const supabase = getSupabase();
  if (!supabase) return { gallery: [], venue: [] };
  const { data } = await supabase
    .from("event_images")
    .select("url, kind")
    .eq("event_id", eventId)
    .order("display_order", { ascending: true, nullsFirst: false });
  const gallery: string[] = [];
  const venue: string[] = [];
  for (const row of (data ?? []) as { url: string; kind: "event" | "venue" }[]) {
    (row.kind === "venue" ? venue : gallery).push(row.url);
  }
  return { gallery, venue };
}

/** Event Detail V2 polish pass, item 15 — the small, founder-picked set of
 * EXISTING products manually associated with one event (event_products),
 * for the "Featured at This Event" carousel. Same two-step shape/filters
 * as getMarketplaceProducts (is_active, real/live selling business) —
 * never automatic vendor merchandising, and a product hidden from public
 * display (is_active=false) never leaks through here even if still linked. */
export async function getEventProducts(eventId: string): Promise<MarketplaceProduct[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("event_products")
    .select(
      `display_order, product:products(${PUBLIC_PRODUCT_COLUMNS}, business:businesses(id, name, slug, logo_url, commerce_enabled, is_demo, publication_status))`
    )
    .eq("event_id", eventId)
    .order("display_order", { ascending: true, nullsFirst: false });
  logPublicQueryError("getEventProducts", error);

  type JoinedBusiness = MarketplaceProduct["business"] & { is_demo: boolean; publication_status: string };
  type Row = { product: (Product & { business: JoinedBusiness | JoinedBusiness[] }) | null };

  return ((data ?? []) as unknown as Row[])
    .map((row) => {
      if (!row.product) return null;
      const business = Array.isArray(row.product.business) ? row.product.business[0] : row.product.business;
      return { ...row.product, business };
    })
    .filter(
      (item): item is Product & { business: JoinedBusiness } =>
        Boolean(item) && item!.is_active && Boolean(item!.business) && !item!.business.is_demo && item!.business.publication_status === "live"
    )
    .map(({ business: { is_demo: _isDemo, publication_status: _pubStatus, ...business }, ...rest }) => ({
      ...rest,
      business,
    }));
}

/** Dynamic-mode products feed for a founder-configured homepage row (see
 * lib/homepage-rows.ts) — same shape/columns as getMarketplaceProducts,
 * but also attaches each selling business's primary category (like
 * getFeaturedProducts) so a row's cards can show a real category badge
 * instead of nothing, when one exists. */
export async function getHomepageRowProducts(params: MarketplaceProductParams = {}): Promise<FeaturedProduct[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  let categoryBusinessIds: string[] | null = null;
  if (params.categorySlug) {
    const { data: cat } = await supabase
      .from("categories")
      .select("id")
      .eq("slug", params.categorySlug)
      .eq("kind", "business")
      .maybeSingle();
    if (!cat) return [];
    const { data: links } = await supabase.from("business_categories").select("business_id").eq("category_id", cat.id);
    categoryBusinessIds = (links ?? []).map((l) => l.business_id);
    if (categoryBusinessIds.length === 0) return [];
  }

  const limit = params.limit ?? 8;
  let query = supabase
    .from("products")
    .select(`${PUBLIC_PRODUCT_COLUMNS}, business:businesses(id, name, slug, logo_url, commerce_enabled, is_demo, publication_status)`)
    .eq("is_active", true);
  if (params.q) {
    const term = `%${params.q.trim()}%`;
    query = query.or(`name.ilike.${term},description.ilike.${term}`);
  }
  if (categoryBusinessIds) query = query.in("business_id", categoryBusinessIds);
  if (params.featuredOnly) query = query.eq("is_featured", true);

  const { data, error } = await query
    .order("is_featured", { ascending: false })
    .order("home_sort_order", { ascending: true, nullsFirst: false })
    .order("name")
    .limit(limit * 2); // over-fetch since some may be filtered out as demo
  logPublicQueryError("getHomepageRowProducts", error);

  type JoinedBusiness = Omit<FeaturedProduct["business"], "categoryName"> & {
    is_demo: boolean;
    publication_status: string;
  };
  const rows = ((data ?? []) as never[])
    .map((row: unknown) => {
      const r = row as Product & { business: JoinedBusiness | JoinedBusiness[] };
      const business = Array.isArray(r.business) ? r.business[0] : r.business;
      return { ...r, business };
    })
    .filter((item) => item.business && !item.business.is_demo && item.business.publication_status === "live")
    .slice(0, limit);

  const businessIds = Array.from(new Set(rows.map((r) => r.business.id)));
  const productIds = rows.map((r) => r.id);
  const [categoryByBusiness, categoryByProduct] = await Promise.all([
    businessIds.length ? getPrimaryCategoryByBusiness(supabase, businessIds) : new Map<string, string>(),
    getPrimaryCategoryByProduct(supabase, productIds),
  ]);

  return rows.map(({ business: { is_demo: _isDemo, publication_status: _pubStatus, ...business }, ...rest }) => ({
    ...rest,
    business: { ...business, categoryName: categoryByProduct.get(rest.id) ?? categoryByBusiness.get(business.id) ?? null },
  }));
}

/** Other founding-member businesses sharing at least one category — used to
 * suggest alternatives when a consumer's first-choice business is booked. */
/** Same-category alternatives, filtered to the same state — a shared
 * category on its own isn't "similar" if the result is a thousand miles
 * away and outside any real service area. If nothing qualifies once
 * geography is applied, this returns empty rather than surfacing an
 * irrelevant business just to fill the row (the caller already hides the
 * section entirely when empty). */
export async function getAlternativeBusinesses(
  business: BusinessWithCategories,
  limit = 4
): Promise<BusinessWithCategories[]> {
  const supabase = getSupabase();
  if (!supabase || business.categories.length === 0 || !business.state) return [];

  const categoryIds = business.categories.map((c) => c.id);
  const { data: links } = await supabase
    .from("business_categories")
    .select("business_id")
    .in("category_id", categoryIds)
    .neq("business_id", business.id);

  const ids = Array.from(new Set((links ?? []).map((l) => l.business_id)));
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("businesses")
    .select(PUBLIC_BUSINESS_COLUMNS)
    .in("id", ids)
    .eq("is_demo", false)
    .eq("publication_status", "live")
    .eq("state", business.state)
    .limit(limit);
  logPublicQueryError("getAlternativeBusinesses", error);
  return attachCategories((data as unknown as Business[]) ?? []);
}

// ----------------------------------------------------------------------------
// Locations
// The schema doesn't (yet) have a foreign key from events/appearances to
// locations — venues are stored as free text on each row. Until that FK
// exists, "what's happening here" is a best-effort match on venue name.
// ----------------------------------------------------------------------------

export async function getLocations(limit = 20): Promise<FindmiLocation[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("locations")
    .select("*")
    .eq("is_demo", false)
    .order("name")
    .limit(limit);
  return data ?? [];
}

export async function getLocationBySlug(slug: string): Promise<FindmiLocation | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("locations")
    .select("*")
    .eq("slug", slug)
    .eq("is_demo", false)
    .maybeSingle();
  return data ?? null;
}

export interface LocationHappening {
  id: string;
  title: string;
  subtitle: string | null;
  start_at: string;
  end_at: string | null;
  href: string;
  imageUrl: string | null;
  /** Always null for an event (no such placeholder-time concept there);
   * a real appearance's own description, read by formatAppearanceTime/
   * formatAppearanceDateRange to detect an imported "time TBD" row. */
  description: string | null;
}

/** Upcoming events and standalone appearances at a location, merged into one
 * chronological feed for that location's page. */
export async function getUpcomingAtLocation(
  locationName: string,
  limit = 12
): Promise<LocationHappening[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const nowIso = new Date().toISOString();

  // Same active-duration principle as the rest of this pass: eligibility
  // is end_at-based (still active or in the future), not start_at-only.
  // end_at is required on new/edited events and appearances now, so both
  // are plain comparisons — a null end_at is NOT treated as open-ended (a
  // handful of legacy appearances still have one and are excluded here
  // until backfilled — see this pass's report).
  const [{ data: events }, { data: appearances }] = await Promise.all([
    supabase
      .from("events")
      .select("id, slug, name, cover_image_url, start_at, end_at, organizer_name")
      .ilike("venue_name", locationName)
      .eq("is_demo", false)
      .gt("end_at", nowIso)
      .order("start_at", { ascending: true })
      .limit(limit),
    supabase
      .from("appearances")
      .select(
        "id, title, start_at, end_at, description, business:businesses(slug, name, cover_image_url, is_demo, publication_status)"
      )
      .ilike("venue_name", locationName)
      .is("event_id", null)
      .neq("status", "canceled")
      .gt("end_at", nowIso)
      .order("start_at", { ascending: true })
      .limit(limit),
  ]);

  const fromEvents: LocationHappening[] = (events ?? []).map((e) => ({
    id: `event-${e.id}`,
    title: e.name,
    subtitle: e.organizer_name,
    start_at: e.start_at,
    end_at: e.end_at,
    href: `/event/${e.slug}`,
    imageUrl: e.cover_image_url,
    description: null,
  }));

  const fromAppearances: LocationHappening[] = (appearances ?? [])
    .map((a) => {
      const b = Array.isArray(a.business) ? a.business[0] : a.business;
      if (!b || b.is_demo || b.publication_status !== "live") return null;
      return {
        id: `appearance-${a.id}`,
        title: a.title,
        subtitle: b.name,
        start_at: a.start_at,
        end_at: a.end_at,
        href: `/business/${b.slug}`,
        imageUrl: b.cover_image_url,
        description: a.description,
      };
    })
    .filter((x): x is LocationHappening => x !== null);

  return [...fromEvents, ...fromAppearances]
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .slice(0, limit);
}

// ----------------------------------------------------------------------------
// Membership plans & markets — public read (see /join). Editable by the
// founder in /admin/plans; not hardcoded into the page itself.
// ----------------------------------------------------------------------------

export async function getPublicMembershipPlans(): Promise<MembershipPlan[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("membership_plans")
    .select("*")
    .eq("active", true)
    .eq("publicly_available", true)
    .order("sort_order");
  return data ?? [];
}

export async function getActiveMarkets(): Promise<Market[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("markets")
    .select("*")
    .eq("active", true)
    .order("sort_order");
  return data ?? [];
}

// ----------------------------------------------------------------------------
// People (Part 10) — founders, owners, makers, chefs, creators, operators.
// Independent entity, many-to-many with businesses via business_people.
// Public reads are already gated by RLS (people.is_public=true), so these
// helpers don't need an extra is_public check beyond what's noted below.
// ----------------------------------------------------------------------------

/** People shown on one business profile — only rows the founder marked
 * show_on_business=true, ordered by display_order. Public/private is
 * already enforced by RLS on the people table itself. */
export async function getPeopleForBusiness(businessId: string): Promise<PersonWithRole[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("business_people")
    .select("role, featured, display_order, people(*)")
    .eq("business_id", businessId)
    .eq("show_on_business", true)
    .order("display_order", { ascending: true, nullsFirst: false });

  type Row = { role: string | null; featured: boolean; people: Person | Person[] | null };
  return ((data ?? []) as Row[])
    .map((row) => {
      const person = Array.isArray(row.people) ? row.people[0] : row.people;
      return person ? { ...person, role: row.role, featured: row.featured } : null;
    })
    .filter((p): p is PersonWithRole => Boolean(p));
}

export async function getPersonBySlug(slug: string): Promise<Person | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("people").select("*").eq("slug", slug).eq("is_public", true).maybeSingle();
  return data ?? null;
}

/** All PUBLIC, live businesses associated with a person — the BRANDS
 * section of their public profile. A person can legitimately span many
 * brands, so no limit here beyond what's real. */
export async function getBusinessesForPerson(personId: string): Promise<BusinessSummary[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("business_people")
    .select("businesses(id, slug, name, logo_url, cover_image_url, is_demo, publication_status)")
    .eq("person_id", personId);

  type JoinedBusiness = BusinessSummary & { is_demo: boolean; publication_status: string };
  type Row = { businesses: JoinedBusiness | JoinedBusiness[] | null };
  return ((data ?? []) as Row[])
    .map((row) => (Array.isArray(row.businesses) ? row.businesses[0] : row.businesses))
    .filter((b): b is JoinedBusiness => Boolean(b) && !b!.is_demo && b!.publication_status === "live")
    .map(({ is_demo: _isDemo, publication_status: _pubStatus, ...b }) => b);
}

export async function getFeaturedPeople(limit = 8): Promise<Person[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("people")
    .select("*")
    .eq("is_public", true)
    .eq("is_featured", true)
    .order("name")
    .limit(limit);
  return data ?? [];
}

/** /people's full directory + basic search — small dataset by nature
 * (people, not businesses), so a plain filtered list is enough; no
 * pagination/search-picker infrastructure needed yet. */
export async function getPublicPeople(q?: string): Promise<Person[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  let query = supabase.from("people").select("*").eq("is_public", true);
  if (q) {
    const term = `%${q.trim()}%`;
    query = query.or(`name.ilike.${term},short_bio.ilike.${term},location.ilike.${term}`);
  }
  const { data } = await query.order("is_featured", { ascending: false }).order("name");
  return data ?? [];
}
