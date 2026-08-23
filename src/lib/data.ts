import { getSupabase } from "./supabase";
import type {
  Appearance,
  Business,
  BusinessWithCategories,
  Category,
  FindmiEvent,
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

export async function getCategories(): Promise<Category[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase.from("categories").select("*").order("name");
  return data ?? [];
}

export async function getFeaturedBusinesses(limit = 8): Promise<BusinessWithCategories[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("businesses")
    .select(BUSINESS_COLUMNS)
    .eq("founding_member", true)
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

  let query = supabase.from("businesses").select(BUSINESS_COLUMNS);

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

export async function getUpcomingAppearancesForBusiness(
  businessId: string,
  limit = 20
): Promise<Appearance[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("appearances")
    .select("*")
    .eq("business_id", businessId)
    .neq("status", "canceled")
    .gte("start_at", new Date().toISOString())
    .order("start_at", { ascending: true })
    .limit(limit);
  return data ?? [];
}

export async function getUpcomingEvents(limit = 20): Promise<FindmiEvent[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("events")
    .select("*")
    .gte("start_at", new Date().toISOString())
    .order("start_at", { ascending: true })
    .limit(limit);
  return data ?? [];
}

export async function getFeaturedEvents(limit = 6): Promise<FindmiEvent[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("events")
    .select("*")
    .gte("start_at", new Date().toISOString())
    .order("is_featured", { ascending: false })
    .order("start_at", { ascending: true })
    .limit(limit);
  return data ?? [];
}

export async function getEventBySlug(slug: string): Promise<FindmiEvent | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("events").select("*").eq("slug", slug).maybeSingle();
  return data ?? null;
}

export async function getBusinessesForEvent(eventId: string): Promise<BusinessWithCategories[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("event_businesses")
    .select("businesses(*)")
    .eq("event_id", eventId);

  const businesses = (data ?? [])
    .map((row: { businesses: Business | Business[] | null }) =>
      Array.isArray(row.businesses) ? row.businesses[0] : row.businesses
    )
    .filter(Boolean) as Business[];

  return attachCategories(businesses);
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
  business: { id: string; name: string; slug: string; logo_url: string | null };
}

/** Upcoming appearances across all businesses, newest-first by date — powers
 * the homepage "Find Them Next" feed. */
export async function getUpcomingAppearancesFeed(limit = 8): Promise<AppearanceFeedItem[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("appearances")
    .select("*, business:businesses(id, name, slug, logo_url)")
    .neq("status", "canceled")
    .gte("start_at", new Date().toISOString())
    .order("start_at", { ascending: true })
    .limit(limit);

  return ((data ?? []) as never[]).map((row: unknown) => {
    const r = row as Appearance & { business: AppearanceFeedItem["business"] | AppearanceFeedItem["business"][] };
    const business = Array.isArray(r.business) ? r.business[0] : r.business;
    return { ...r, business };
  });
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
    .select("*, business:businesses(id, name, slug)")
    .eq("is_featured", true)
    .eq("is_active", true)
    .limit(limit);

  return ((data ?? []) as never[]).map((row: unknown) => {
    const r = row as Product & { business: FeaturedProduct["business"] | FeaturedProduct["business"][] };
    const business = Array.isArray(r.business) ? r.business[0] : r.business;
    return { ...r, business };
  });
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

  const { data } = await supabase.from("businesses").select(BUSINESS_COLUMNS).in("id", ids);
  return attachCategories((data as Business[]) ?? []);
}
