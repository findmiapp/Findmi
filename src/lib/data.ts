import { getSupabase } from "./supabase";
import { formatDateRange, getDiscoveryWindowBounds, getExactDateBounds, type DiscoveryWindow } from "./format";
import type {
  Appearance,
  Business,
  BusinessSummary,
  BusinessWithCategories,
  Category,
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

const BUSINESS_COLUMNS = "*";

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
  const { data } = await supabase
    .from("business_categories")
    .select("business_id, categories(id, name, slug)")
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
    .select("business_id, categories(name)")
    .in("business_id", businessIds);
  const map = new Map<string, string>();
  for (const row of (data ?? []) as { business_id: string; categories: { name: string } | { name: string }[] }[]) {
    if (map.has(row.business_id)) continue;
    const cat = Array.isArray(row.categories) ? row.categories[0] : row.categories;
    if (cat?.name) map.set(row.business_id, cat.name);
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

export async function getCategories(): Promise<Category[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase.from("categories").select("*").order("name");
  return data ?? [];
}

/** Founder-controlled subset/order for the homepage category strip (see
 * /admin/categories) — separate from getCategories() because every other
 * caller (business forms, the /businesses filter) still needs the full
 * list regardless of homepage visibility. */
export async function getHomeCategories(): Promise<Category[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("categories")
    .select("*")
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

  const { data: realEvents } = await supabase
    .from("events")
    .select("id")
    .eq("is_demo", false)
    .gte("start_at", new Date().toISOString());
  const realEventIds = new Set((realEvents ?? []).map((e) => e.id));
  if (realEventIds.size === 0) return [];

  const { data } = await supabase.from("event_categories").select("event_id, categories(id, name, slug)");
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
  const { data } = await supabase
    .from("businesses")
    .select(BUSINESS_COLUMNS)
    .eq("is_featured", true)
    .eq("is_demo", false)
    .eq("publication_status", "live")
    .order("created_at", { ascending: false })
    .limit(limit);
  return attachCategories((data as Business[]) ?? []);
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
    const { data: cat } = await supabase.from("categories").select("id").eq("slug", params.categorySlug).maybeSingle();
    if (!cat) return [];
    const { data: links } = await supabase.from("business_categories").select("business_id").eq("category_id", cat.id);
    categoryBusinessIds = (links ?? []).map((l) => l.business_id);
    if (categoryBusinessIds.length === 0) return [];
  }

  let query = supabase.from("businesses").select(BUSINESS_COLUMNS).eq("is_demo", false).eq("publication_status", "live");
  if (categoryBusinessIds) query = query.in("id", categoryBusinessIds);
  if (params.featuredOnly) query = query.eq("is_featured", true);

  const { data } = await query
    .order("is_featured", { ascending: false })
    .order("founding_member", { ascending: false })
    .order("name")
    .limit(params.limit ?? 8);
  return attachCategories((data as Business[]) ?? []);
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

  const { data } = await supabase.from("business_categories").select("business_id, categories(id, name, slug)");
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
  const { data } = await supabase
    .from("businesses")
    .select(BUSINESS_COLUMNS)
    .in("id", ids)
    .eq("is_demo", false)
    .eq("publication_status", "live");
  const withCats = await attachCategories((data as Business[]) ?? []);
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
  const { data } = await supabase
    .from("products")
    .select("*, business:businesses(id, name, slug, logo_url, commerce_enabled, is_demo, publication_status)")
    .in("id", ids)
    .eq("is_active", true);

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
  const categoryByBusiness = businessIds.length ? await getPrimaryCategoryByBusiness(supabase, businessIds) : new Map();
  const withCategory = rows.map(({ business: { is_demo: _isDemo, publication_status: _pubStatus, ...business }, ...rest }) => ({
    ...rest,
    business: { ...business, categoryName: categoryByBusiness.get(business.id) ?? null },
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
    .select(BUSINESS_COLUMNS)
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

  const { data } = await query;
  return attachCategories((data as Business[]) ?? []);
}

export async function getBusinessBySlug(slug: string): Promise<BusinessWithCategories | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("businesses")
    .select(BUSINESS_COLUMNS)
    .eq("slug", slug)
    .eq("is_demo", false)
    .eq("publication_status", "live")
    .maybeSingle();
  if (!data) return null;
  const [withCats] = await attachCategories([data as Business]);
  return withCats;
}

export async function getProductsForBusiness(businessId: string): Promise<Product[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("is_featured", { ascending: false })
    .order("name");
  return data ?? [];
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
  const { data } = await supabase
    .from("appearances")
    .select("*, event:events(slug)")
    .eq("business_id", businessId)
    .neq("status", "canceled")
    .gte("start_at", new Date().toISOString())
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

export async function getUpcomingEvents(
  limit = 20,
  when: DiscoveryWindow = "anytime"
): Promise<FindmiEvent[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const bounds = getDiscoveryWindowBounds(when);
  let query = supabase
    .from("events")
    .select("*")
    .eq("is_demo", false)
    .gte("start_at", (bounds?.start ?? new Date()).toISOString());
  if (bounds) {
    query = query.lt("start_at", bounds.end.toISOString());
  }
  const { data } = await query.order("start_at", { ascending: true }).limit(limit);
  return data ?? [];
}

/** Editorial top-of-page Featured Events — is_featured first (ordered by
 * the founder's own featured_sort_order, nulls last), then legitimate
 * upcoming events as fallback. Never fabricated. */
export async function getFeaturedEvents(limit = 6): Promise<FindmiEvent[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("events")
    .select("*")
    .eq("is_demo", false)
    .gte("start_at", new Date().toISOString())
    .order("is_featured", { ascending: false })
    .order("featured_sort_order", { ascending: true, nullsFirst: false })
    .order("start_at", { ascending: true })
    .limit(limit);
  return data ?? [];
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
 * duplication" — one query helper, not five bespoke ones. */
export async function getEventsDiscovery(params: EventDiscoveryParams = {}): Promise<FindmiEvent[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  let categoryEventIds: string[] | null = null;
  if (params.categorySlug) {
    const { data: cat } = await supabase
      .from("categories")
      .select("id")
      .eq("slug", params.categorySlug)
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
  let query = supabase
    .from("events")
    .select("*")
    .eq("is_demo", false)
    .gte("start_at", (bounds?.start ?? new Date()).toISOString());
  if (bounds) query = query.lt("start_at", bounds.end.toISOString());
  if (params.q) {
    const term = `%${params.q.trim()}%`;
    query = query.or(`name.ilike.${term},description.ilike.${term},venue_name.ilike.${term}`);
  }
  if (params.city) query = query.ilike("city", `%${params.city}%`);
  const location = params.location;
  if (location) {
    const term = location.trim();
    query = query.or(`city.ilike.%${term}%,state.ilike.%${term}%`);
  }
  if (categoryEventIds) query = query.in("id", categoryEventIds);

  query = query.order("start_at", { ascending: true });
  if (params.offset) query = query.range(params.offset, params.offset + (params.limit ?? 50) - 1);
  else query = query.limit(params.limit ?? 50);

  const { data } = await query;
  return data ?? [];
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
    .select("event_id, categories(id, name, slug)")
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
  const { data } = await supabase
    .from("event_businesses")
    .select("featured, offering_text, display_order, businesses(*)")
    .eq("event_id", eventId)
    .eq("status", "approved")
    .order("display_order", { ascending: true, nullsFirst: false });

  type Row = {
    featured: boolean;
    offering_text: string | null;
    display_order: number | null;
    businesses: Business | Business[] | null;
  };
  const rows = ((data ?? []) as Row[])
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
 * the homepage "Find Them Next" feed. */
export async function getUpcomingAppearancesFeed(limit = 8): Promise<AppearanceFeedItem[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("appearances")
    .select("*, business:businesses(id, name, slug, logo_url, is_demo, publication_status)")
    .neq("status", "canceled")
    .gte("start_at", new Date().toISOString())
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
 * NOW (start_at <= now <= end_at), not a guess. Optional categorySlug/city
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
    const { data: cat } = await supabase.from("categories").select("id").eq("slug", extra.categorySlug).maybeSingle();
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
  } else {
    query = query.gte("start_at", nowIso);
    if (when !== "anytime") {
      const bounds = getDiscoveryWindowBounds(when === "today" ? "now" : "weekend");
      if (bounds) query = query.lt("start_at", bounds.end.toISOString());
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
  const { data } = await supabase
    .from("businesses")
    .select(BUSINESS_COLUMNS)
    .not("service_radius_miles", "is", null)
    .eq("is_demo", false)
    .eq("publication_status", "live")
    .order("service_radius_miles", { ascending: false })
    .limit(limit);
  return attachCategories((data as Business[]) ?? []);
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
    /** Business's own primary category — products have no category/
     * taxonomy field of their own in the schema today, so this is the
     * closest real, non-fabricated classification available for a
     * product card's eyebrow. Null when the business has no category set. */
    categoryName: string | null;
  };
}

/** Founder-curated homepage/marketplace Featured Products
 * (products.is_featured + home_sort_order — the founder decides both
 * which products appear and their order). */
export async function getFeaturedProducts(limit = 8): Promise<FeaturedProduct[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("products")
    .select("*, business:businesses(id, name, slug, logo_url, commerce_enabled, is_demo, publication_status)")
    .eq("is_featured", true)
    .eq("is_active", true)
    .order("home_sort_order", { ascending: true, nullsFirst: false })
    .order("name")
    .limit(limit * 2); // over-fetch since some may be filtered out as demo

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
  const categoryByBusiness = businessIds.length ? await getPrimaryCategoryByBusiness(supabase, businessIds) : new Map();

  return rows.map(({ business: { is_demo: _isDemo, publication_status: _pubStatus, ...business }, ...rest }) => ({
    ...rest,
    business: { ...business, categoryName: categoryByBusiness.get(business.id) ?? null },
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
  const { data } = await supabase
    .from("products")
    .select(
      "*, business:businesses(id, name, slug, logo_url, cover_image_url, commerce_enabled, city, state, is_demo, publication_status)"
    )
    .eq("slug", slug)
    .eq("is_active", true);

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
  const categoryMap = await getPrimaryCategoryByBusiness(supabase, [business.id]);
  return { ...rest, business: { ...cleanBusiness, categoryName: categoryMap.get(business.id) ?? null } };
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
    .select("method, price, appearance_id, appearances(venue_name, title, start_at, end_at)")
    .eq("product_id", productId)
    .eq("enabled", true);

  type Row = {
    method: FulfillmentMethod;
    price: number;
    appearance_id: string | null;
    appearances: { venue_name: string | null; title: string; start_at: string; end_at: string | null } | { venue_name: string | null; title: string; start_at: string; end_at: string | null }[] | null;
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
      const label =
        row.method === "event_pickup" && appearance
          ? `Pickup at ${appearance.venue_name ?? appearance.title} — ${formatDateRange(appearance.start_at, appearance.end_at)}`
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
  const { data } = await supabase
    .from("appearances")
    .select(
      "*, business:businesses(id, name, slug, logo_url, cover_image_url, is_demo, publication_status), event:events(slug)"
    )
    .eq("show_on_home", true)
    .neq("status", "canceled")
    .gte("start_at", new Date().toISOString())
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
  const { data } = await supabase
    .from("appearances")
    .select("business_id, venue_name, title, start_at, event:events(slug, is_demo)")
    .in("business_id", businessIds)
    .neq("status", "canceled")
    .gte("start_at", new Date().toISOString())
    .order("start_at", { ascending: true });
  for (const row of (data ?? []) as never[]) {
    const r = row as {
      business_id: string;
      venue_name: string | null;
      title: string;
      start_at: string;
      event: { slug: string; is_demo: boolean } | { slug: string; is_demo: boolean }[] | null;
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
    hints.set(r.business_id, {
      venue: r.venue_name ?? r.title,
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
 * SELLING BUSINESS's category, since products don't carry their own. */
export async function getMarketplaceProducts(params: MarketplaceProductParams = {}): Promise<MarketplaceProduct[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  let categoryBusinessIds: string[] | null = null;
  if (params.categorySlug) {
    const { data: cat } = await supabase.from("categories").select("id").eq("slug", params.categorySlug).maybeSingle();
    if (!cat) return [];
    const { data: links } = await supabase.from("business_categories").select("business_id").eq("category_id", cat.id);
    categoryBusinessIds = (links ?? []).map((l) => l.business_id);
    if (categoryBusinessIds.length === 0) return [];
  }

  const limit = params.limit ?? 40;
  let query = supabase
    .from("products")
    .select("*, business:businesses(id, name, slug, logo_url, commerce_enabled, is_demo, publication_status)")
    .eq("is_active", true);
  if (params.q) {
    const term = `%${params.q.trim()}%`;
    query = query.or(`name.ilike.${term},description.ilike.${term}`);
  }
  if (categoryBusinessIds) query = query.in("business_id", categoryBusinessIds);
  if (params.featuredOnly) query = query.eq("is_featured", true);

  const { data } = await query
    .order("is_featured", { ascending: false })
    .order("home_sort_order", { ascending: true, nullsFirst: false })
    .order("name")
    .limit(limit * 2); // over-fetch since some may be filtered out as demo

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
    const { data: cat } = await supabase.from("categories").select("id").eq("slug", params.categorySlug).maybeSingle();
    if (!cat) return [];
    const { data: links } = await supabase.from("business_categories").select("business_id").eq("category_id", cat.id);
    categoryBusinessIds = (links ?? []).map((l) => l.business_id);
    if (categoryBusinessIds.length === 0) return [];
  }

  const limit = params.limit ?? 8;
  let query = supabase
    .from("products")
    .select("*, business:businesses(id, name, slug, logo_url, commerce_enabled, is_demo, publication_status)")
    .eq("is_active", true);
  if (params.q) {
    const term = `%${params.q.trim()}%`;
    query = query.or(`name.ilike.${term},description.ilike.${term}`);
  }
  if (categoryBusinessIds) query = query.in("business_id", categoryBusinessIds);
  if (params.featuredOnly) query = query.eq("is_featured", true);

  const { data } = await query
    .order("is_featured", { ascending: false })
    .order("home_sort_order", { ascending: true, nullsFirst: false })
    .order("name")
    .limit(limit * 2); // over-fetch since some may be filtered out as demo

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
  const categoryByBusiness = businessIds.length ? await getPrimaryCategoryByBusiness(supabase, businessIds) : new Map();

  return rows.map(({ business: { is_demo: _isDemo, publication_status: _pubStatus, ...business }, ...rest }) => ({
    ...rest,
    business: { ...business, categoryName: categoryByBusiness.get(business.id) ?? null },
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

  const { data } = await supabase
    .from("businesses")
    .select(BUSINESS_COLUMNS)
    .in("id", ids)
    .eq("is_demo", false)
    .eq("publication_status", "live")
    .eq("state", business.state)
    .limit(limit);
  return attachCategories((data as Business[]) ?? []);
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

  const [{ data: events }, { data: appearances }] = await Promise.all([
    supabase
      .from("events")
      .select("id, slug, name, cover_image_url, start_at, end_at, organizer_name")
      .ilike("venue_name", locationName)
      .eq("is_demo", false)
      .gte("start_at", nowIso)
      .order("start_at", { ascending: true })
      .limit(limit),
    supabase
      .from("appearances")
      .select(
        "id, title, start_at, end_at, business:businesses(slug, name, cover_image_url, is_demo, publication_status)"
      )
      .ilike("venue_name", locationName)
      .is("event_id", null)
      .neq("status", "canceled")
      .gte("start_at", nowIso)
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
