import { getSupabase } from "./supabase";
import { getDiscoveryWindowBounds, type DiscoveryWindow } from "./format";
import type {
  Appearance,
  Business,
  BusinessWithCategories,
  Category,
  FindmiEvent,
  FindmiLocation,
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

export async function getFeaturedBusinesses(limit = 8): Promise<BusinessWithCategories[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("businesses")
    .select(BUSINESS_COLUMNS)
    .eq("founding_member", true)
    .eq("is_demo", false)
    .order("created_at", { ascending: false })
    .limit(limit);
  return attachCategories((data as Business[]) ?? []);
}

export async function searchBusinesses(params: {
  q?: string;
  categorySlug?: string;
  city?: string;
}): Promise<BusinessWithCategories[]> {
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

  let query = supabase.from("businesses").select(BUSINESS_COLUMNS).eq("is_demo", false);

  if (params.q) {
    const term = params.q.trim();
    query = query.or(
      `name.ilike.%${term}%,short_description.ilike.%${term}%,city.ilike.%${term}%`
    );
  }
  if (params.city) {
    query = query.ilike("city", `%${params.city}%`);
  }
  if (categoryBusinessIds) {
    query = query.in("id", categoryBusinessIds);
  }

  const { data } = await query.order("founding_member", { ascending: false }).order("name");
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

export async function getFeaturedEvents(limit = 6): Promise<FindmiEvent[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("events")
    .select("*")
    .eq("is_demo", false)
    .gte("start_at", new Date().toISOString())
    .order("is_featured", { ascending: false })
    .order("start_at", { ascending: true })
    .limit(limit);
  return data ?? [];
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
}

/** Only "approved" participants are public — "invited"/"applied"/"pending"/
 * "declined" exist for the organizer's own workflow (see /admin) and never
 * reach this query. featured=true businesses are still included in the
 * full list (not a separate pool) — the event page decides how to
 * highlight them; this just carries the flag along. */
export async function getBusinessesForEvent(eventId: string): Promise<EventBusinessListing[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("event_businesses")
    .select("featured, businesses(*)")
    .eq("event_id", eventId)
    .eq("status", "approved");

  type Row = { featured: boolean; businesses: Business | Business[] | null };
  const rows = ((data ?? []) as Row[])
    .map((row) => {
      const business = Array.isArray(row.businesses) ? row.businesses[0] : row.businesses;
      return business && !(business as Business & { is_demo?: boolean }).is_demo
        ? { business, featured: row.featured }
        : null;
    })
    .filter((r): r is { business: Business; featured: boolean } => Boolean(r));

  const withCategories = await attachCategories(rows.map((r) => r.business));
  return withCategories.map((b, i) => ({ ...b, featured: rows[i].featured }));
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
    .select("*, business:businesses(id, name, slug, logo_url, is_demo)")
    .neq("status", "canceled")
    .gte("start_at", new Date().toISOString())
    .order("start_at", { ascending: true })
    .limit(limit * 2); // over-fetch since some may be filtered out as demo

  type JoinedBusiness = AppearanceFeedItem["business"] & { is_demo: boolean };
  return ((data ?? []) as never[])
    .map((row: unknown) => {
      const r = row as Appearance & { business: JoinedBusiness | JoinedBusiness[] };
      const business = Array.isArray(r.business) ? r.business[0] : r.business;
      return { ...r, business };
    })
    .filter((item) => item.business && !item.business.is_demo)
    .slice(0, limit)
    .map(({ business: { is_demo: _isDemo, ...business }, ...rest }) => ({ ...rest, business }));
}

export type FindWindow = "live" | "today" | "weekend" | "anytime";

/** The FindMi Here discovery feed — real appearances across every business,
 * filtered to one of the four temporal tabs. "live" means genuinely HERE
 * NOW (start_at <= now <= end_at), not a guess. */
export async function getFindMiHereFeed(
  when: FindWindow,
  limit = 30
): Promise<AppearanceFeedItem[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const nowIso = new Date().toISOString();

  let query = supabase
    .from("appearances")
    .select("*, business:businesses(id, name, slug, logo_url, cover_image_url, is_demo)")
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

  const { data } = await query
    .order("start_at", { ascending: true })
    .limit(limit * 2); // over-fetch since some may be filtered out as demo

  type JoinedBusiness = AppearanceFeedItem["business"] & { is_demo: boolean };
  return ((data ?? []) as never[])
    .map((row: unknown) => {
      const r = row as Appearance & { business: JoinedBusiness | JoinedBusiness[] };
      const business = Array.isArray(r.business) ? r.business[0] : r.business;
      return { ...r, business };
    })
    .filter((item) => item.business && !item.business.is_demo)
    .slice(0, limit)
    .map(({ business: { is_demo: _isDemo, ...business }, ...rest }) => ({ ...rest, business }));
}

/** Businesses that travel to customers rather than operate from a single
 * fixed address — powers the homepage "Brands On The Move" row. */
export async function getMobileBusinesses(limit = 8): Promise<BusinessWithCategories[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("businesses")
    .select(BUSINESS_COLUMNS)
    .not("service_radius_miles", "is", null)
    .eq("is_demo", false)
    .order("founding_member", { ascending: false })
    .limit(limit);
  return attachCategories((data as Business[]) ?? []);
}

export interface FeaturedProduct extends Product {
  business: { id: string; name: string; slug: string };
}

export async function getFeaturedProducts(limit = 8): Promise<FeaturedProduct[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("products")
    .select("*, business:businesses(id, name, slug, is_demo)")
    .eq("is_featured", true)
    .eq("is_active", true)
    .limit(limit * 2); // over-fetch since some may be filtered out as demo

  type JoinedBusiness = FeaturedProduct["business"] & { is_demo: boolean };
  return ((data ?? []) as never[])
    .map((row: unknown) => {
      const r = row as Product & { business: JoinedBusiness | JoinedBusiness[] };
      const business = Array.isArray(r.business) ? r.business[0] : r.business;
      return { ...r, business };
    })
    .filter((item) => item.business && !item.business.is_demo)
    .slice(0, limit)
    .map(({ business: { is_demo: _isDemo, ...business }, ...rest }) => ({ ...rest, business }));
}

export interface ProductWithBusiness extends Product {
  business: { id: string; name: string; slug: string; logo_url: string | null; cover_image_url: string | null };
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
    .select("*, business:businesses(id, name, slug, logo_url, cover_image_url, is_demo)")
    .eq("slug", slug)
    .eq("is_active", true);

  type JoinedBusiness = ProductWithBusiness["business"] & { is_demo: boolean };
  const match = ((data ?? []) as never[])
    .map((row: unknown) => {
      const r = row as Product & { business: JoinedBusiness | JoinedBusiness[] };
      const business = Array.isArray(r.business) ? r.business[0] : r.business;
      return { ...r, business };
    })
    .find((item) => item.business && !item.business.is_demo);

  if (!match) return null;
  const { business, ...rest } = match;
  const { is_demo: _isDemo, ...cleanBusiness } = business;
  return { ...rest, business: cleanBusiness };
}

/** Other founding-member businesses sharing at least one category — used to
 * suggest alternatives when a consumer's first-choice business is booked. */
export async function getAlternativeBusinesses(
  business: BusinessWithCategories,
  limit = 4
): Promise<BusinessWithCategories[]> {
  const supabase = getSupabase();
  if (!supabase || business.categories.length === 0) return [];

  const categoryIds = business.categories.map((c) => c.id);
  const { data: links } = await supabase
    .from("business_categories")
    .select("business_id")
    .in("category_id", categoryIds)
    .neq("business_id", business.id);

  const ids = Array.from(new Set((links ?? []).map((l) => l.business_id))).slice(0, limit);
  if (ids.length === 0) return [];

  const { data } = await supabase
    .from("businesses")
    .select(BUSINESS_COLUMNS)
    .in("id", ids)
    .eq("is_demo", false);
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
        "id, title, start_at, end_at, business:businesses(slug, name, cover_image_url, is_demo)"
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
      if (!b || b.is_demo) return null;
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
