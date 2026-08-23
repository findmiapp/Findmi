import { getAdminSupabase } from "./supabase-admin";
import type {
  Appearance,
  Business,
  Category,
  EventParticipationStatus,
  FindmiEvent,
  FindmiLocation,
  Product,
} from "@/lib/types";

// Admin-only row shapes: the public types.ts interfaces don't carry
// is_demo (public code never needs to see it directly — it just filters
// by it). Extending here rather than editing types.ts keeps that file
// untouched for the rest of the app.
export type AdminBusiness = Business & { is_demo: boolean };
export type AdminEvent = FindmiEvent & { is_demo: boolean };
export type AdminLocation = FindmiLocation & { is_demo: boolean };
export type AdminAppearance = Appearance;
export type AdminProduct = Product;

export interface SelectOption {
  value: string;
  label: string;
  sublabel?: string;
}

export async function getDashboardCounts() {
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const [businesses, events, locations, appearances, products, categories, orders] = await Promise.all([
    supabase.from("businesses").select("id, is_demo", { count: "exact", head: true }),
    supabase.from("events").select("id", { count: "exact", head: true }),
    supabase.from("locations").select("id", { count: "exact", head: true }),
    supabase.from("appearances").select("id", { count: "exact", head: true }),
    supabase.from("products").select("id", { count: "exact", head: true }),
    supabase.from("categories").select("id", { count: "exact", head: true }),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("payment_status", "paid"),
  ]);
  const [businessesPublic] = await Promise.all([
    supabase.from("businesses").select("id", { count: "exact", head: true }).eq("is_demo", false),
  ]);
  return {
    businesses: businesses.count ?? 0,
    businessesPublic: businessesPublic.count ?? 0,
    events: events.count ?? 0,
    locations: locations.count ?? 0,
    appearances: appearances.count ?? 0,
    products: products.count ?? 0,
    categories: categories.count ?? 0,
    orders: orders.count ?? 0,
  };
}

// ---------------------------------------------------------------------
// Businesses
// ---------------------------------------------------------------------

export interface BusinessListFilters {
  q?: string;
  categoryId?: string;
  published?: "public" | "demo";
}

export async function getAdminBusinesses(filters: BusinessListFilters = {}): Promise<AdminBusiness[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];

  // The category filter needs an inner-join embed to filter server-side
  // rather than fetching every business and checking in JS — kept as a
  // separate query branch (not a ternary select string) so each branch's
  // select() literal stays statically typeable.
  if (filters.categoryId) {
    let query = supabase
      .from("businesses")
      .select("*, business_categories!inner(category_id)")
      .eq("business_categories.category_id", filters.categoryId)
      .order("name");
    if (filters.q) {
      const term = `%${filters.q}%`;
      query = query.or(`name.ilike.${term},slug.ilike.${term},city.ilike.${term}`);
    }
    if (filters.published === "public") query = query.eq("is_demo", false);
    if (filters.published === "demo") query = query.eq("is_demo", true);
    const { data } = await query;
    return ((data ?? []) as unknown as AdminBusiness[]) ?? [];
  }

  let query = supabase.from("businesses").select("*").order("name");
  if (filters.q) {
    const term = `%${filters.q}%`;
    query = query.or(`name.ilike.${term},slug.ilike.${term},city.ilike.${term}`);
  }
  if (filters.published === "public") query = query.eq("is_demo", false);
  if (filters.published === "demo") query = query.eq("is_demo", true);
  const { data } = await query;
  return (data as AdminBusiness[]) ?? [];
}

export async function getAdminBusinessById(
  id: string
): Promise<{ business: AdminBusiness; categoryIds: string[] } | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const [{ data: business }, { data: cats }] = await Promise.all([
    supabase.from("businesses").select("*").eq("id", id).maybeSingle(),
    supabase.from("business_categories").select("category_id").eq("business_id", id),
  ]);
  if (!business) return null;
  return {
    business: business as AdminBusiness,
    categoryIds: (cats ?? []).map((c: { category_id: string }) => c.category_id),
  };
}

export async function getAllCategories(): Promise<Category[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase.from("categories").select("*").order("name");
  return data ?? [];
}

/** Looks up just the one business a form already has selected, for seeding a
 * RelationField's initial value on an edit page — never the whole table
 * (see the /admin/api/search route for the actual picker). */
export async function getBusinessOptionById(id: string | null): Promise<SelectOption | null> {
  if (!id) return null;
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("businesses")
    .select("id, name, city, state, is_demo")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    value: data.id,
    label: data.name,
    sublabel:
      [data.is_demo ? "Demo" : null, [data.city, data.state].filter(Boolean).join(", ") || null]
        .filter(Boolean)
        .join(" · ") || undefined,
  };
}

// ---------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------

export interface EventListFilters {
  q?: string;
  when?: "upcoming" | "past";
  vendorAppsOpen?: boolean;
  pendingApplications?: boolean;
}

export async function getAdminEvents(filters: EventListFilters = {}): Promise<AdminEvent[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const nowIso = new Date().toISOString();

  // Kept as a separate query branch (not a ternary select string) so each
  // branch's select() literal stays statically typeable.
  if (filters.pendingApplications) {
    let query = supabase
      .from("events")
      .select("*, event_businesses!inner(status)")
      .in("event_businesses.status", ["applied", "pending"]);
    if (filters.q) {
      const term = `%${filters.q}%`;
      query = query.or(`name.ilike.${term},slug.ilike.${term},venue_name.ilike.${term}`);
    }
    if (filters.when === "upcoming") query = query.gte("start_at", nowIso);
    if (filters.when === "past") query = query.lt("start_at", nowIso);
    if (filters.vendorAppsOpen) query = query.eq("vendor_applications_enabled", true);
    const { data } = await query.order("start_at", { ascending: false });
    return ((data ?? []) as unknown as AdminEvent[]) ?? [];
  }

  let query = supabase.from("events").select("*");
  if (filters.q) {
    const term = `%${filters.q}%`;
    query = query.or(`name.ilike.${term},slug.ilike.${term},venue_name.ilike.${term}`);
  }
  if (filters.when === "upcoming") query = query.gte("start_at", nowIso);
  if (filters.when === "past") query = query.lt("start_at", nowIso);
  if (filters.vendorAppsOpen) query = query.eq("vendor_applications_enabled", true);
  const { data } = await query.order("start_at", { ascending: false });
  return (data as AdminEvent[]) ?? [];
}

export interface EventParticipant {
  business_id: string;
  business_name: string;
  logo_url: string | null;
  category_name: string | null;
  status: EventParticipationStatus;
  featured: boolean;
  offering_text: string | null;
  display_order: number | null;
}

export async function getAdminEventById(
  id: string
): Promise<{ event: AdminEvent; participants: EventParticipant[] } | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const [{ data: event }, { data: links }] = await Promise.all([
    supabase.from("events").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("event_businesses")
      .select("business_id, status, featured, offering_text, display_order, businesses(name, logo_url)")
      .eq("event_id", id)
      .order("display_order", { ascending: true, nullsFirst: false }),
  ]);
  if (!event) return null;

  type LinkRow = {
    business_id: string;
    status: EventParticipationStatus;
    featured: boolean;
    offering_text: string | null;
    display_order: number | null;
    businesses: { name: string; logo_url: string | null } | { name: string; logo_url: string | null }[] | null;
  };
  const rows = (links ?? []) as LinkRow[];

  // One extra bounded query for the primary category of just these
  // businesses (a handful per event), not a full-table scan.
  const businessIds = rows.map((l) => l.business_id);
  const { data: catLinks } = businessIds.length
    ? await supabase.from("business_categories").select("business_id, categories(name)").in("business_id", businessIds)
    : { data: [] as never[] };
  const categoryByBusiness = new Map<string, string>();
  for (const row of (catLinks ?? []) as {
    business_id: string;
    categories: { name: string } | { name: string }[] | null;
  }[]) {
    if (categoryByBusiness.has(row.business_id)) continue;
    const cat = Array.isArray(row.categories) ? row.categories[0] : row.categories;
    if (cat) categoryByBusiness.set(row.business_id, cat.name);
  }

  const participants = rows.map((l) => {
    const business = Array.isArray(l.businesses) ? l.businesses[0] : l.businesses;
    return {
      business_id: l.business_id,
      business_name: business?.name ?? "Unknown business",
      logo_url: business?.logo_url ?? null,
      category_name: categoryByBusiness.get(l.business_id) ?? null,
      status: l.status,
      featured: l.featured,
      offering_text: l.offering_text,
      display_order: l.display_order,
    };
  });

  return { event: event as AdminEvent, participants };
}

/** Looks up just the one event a form already has selected (Appearance's
 * optional event link), for seeding a RelationField's initial value. */
export async function getEventOptionById(id: string | null): Promise<SelectOption | null> {
  if (!id) return null;
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("events")
    .select("id, name, venue_name, is_demo")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    value: data.id,
    label: data.name,
    sublabel: [data.is_demo ? "Demo" : null, data.venue_name].filter(Boolean).join(" · ") || undefined,
  };
}

// ---------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------

export async function getAdminLocations(q?: string): Promise<AdminLocation[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  let query = supabase.from("locations").select("*").order("name");
  if (q) {
    const term = `%${q}%`;
    query = query.or(`name.ilike.${term},city.ilike.${term},address.ilike.${term}`);
  }
  const { data } = await query;
  return (data as AdminLocation[]) ?? [];
}

export async function getAdminLocationById(id: string): Promise<AdminLocation | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("locations").select("*").eq("id", id).maybeSingle();
  return (data as AdminLocation) ?? null;
}

// ---------------------------------------------------------------------
// Appearances
// ---------------------------------------------------------------------

export interface AdminAppearanceRow extends AdminAppearance {
  business: { id: string; name: string } | null;
  event: { id: string; name: string } | null;
}

export interface AppearanceListFilters {
  q?: string;
  when?: "upcoming" | "past";
  businessId?: string;
  linkage?: "event" | "standalone";
}

export async function getAdminAppearances(filters: AppearanceListFilters = {}): Promise<AdminAppearanceRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  let query = supabase
    .from("appearances")
    .select("*, business:businesses(id, name), event:events(id, name)");
  if (filters.q) {
    const term = `%${filters.q}%`;
    query = query.or(`title.ilike.${term},venue_name.ilike.${term},city.ilike.${term}`);
  }
  if (filters.businessId) query = query.eq("business_id", filters.businessId);
  if (filters.linkage === "event") query = query.not("event_id", "is", null);
  if (filters.linkage === "standalone") query = query.is("event_id", null);
  const nowIso = new Date().toISOString();
  if (filters.when === "upcoming") query = query.gte("start_at", nowIso);
  if (filters.when === "past") query = query.lt("start_at", nowIso);
  const { data } = await query.order("start_at", { ascending: false });
  return ((data ?? []) as never[]).map((row: unknown) => {
    const r = row as AdminAppearanceRow & {
      business: AdminAppearanceRow["business"] | AdminAppearanceRow["business"][];
      event: AdminAppearanceRow["event"] | AdminAppearanceRow["event"][];
    };
    return {
      ...r,
      business: Array.isArray(r.business) ? (r.business[0] ?? null) : r.business,
      event: Array.isArray(r.event) ? (r.event[0] ?? null) : r.event,
    };
  });
}

export async function getAdminAppearanceById(id: string): Promise<AdminAppearance | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("appearances").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

// ---------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------

export interface AdminProductRow extends AdminProduct {
  business: { id: string; name: string } | null;
}

export interface ProductListFilters {
  q?: string;
  businessId?: string;
}

export async function getAdminProducts(filters: ProductListFilters = {}): Promise<AdminProductRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  let query = supabase.from("products").select("*, business:businesses(id, name)");
  if (filters.q) {
    const term = `%${filters.q}%`;
    query = query.or(`name.ilike.${term},slug.ilike.${term}`);
  }
  if (filters.businessId) query = query.eq("business_id", filters.businessId);
  const { data } = await query.order("name");
  return ((data ?? []) as never[]).map((row: unknown) => {
    const r = row as AdminProductRow & { business: AdminProductRow["business"] | AdminProductRow["business"][] };
    return { ...r, business: Array.isArray(r.business) ? (r.business[0] ?? null) : r.business };
  });
}

export async function getAdminProductById(id: string): Promise<AdminProduct | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

export interface ProductFulfillmentOptionRow {
  id: string;
  method: "shipping" | "local_delivery" | "pickup" | "event_pickup";
  price: number;
  enabled: boolean;
  appearance_id: string | null;
}

export async function getProductFulfillmentOptions(productId: string): Promise<ProductFulfillmentOptionRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("product_fulfillment_options")
    .select("id, method, price, enabled, appearance_id")
    .eq("product_id", productId);
  return (data as ProductFulfillmentOptionRow[]) ?? [];
}

/** Upcoming, non-canceled appearances for one business — the bounded pool
 * a product's Event Pickup option can be attached to. Small enough per
 * business that a plain list is fine; no search picker needed. */
export async function getUpcomingAppearanceOptionsForBusiness(businessId: string): Promise<SelectOption[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("appearances")
    .select("id, title, venue_name, start_at")
    .eq("business_id", businessId)
    .neq("status", "canceled")
    .gte("start_at", new Date().toISOString())
    .order("start_at", { ascending: true });
  return (data ?? []).map((a) => ({
    value: a.id,
    label: `${a.venue_name ?? a.title} — ${new Date(a.start_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
  }));
}

/** Global slug-uniqueness check for the admin layer — the DB constraint is
 * only unique(business_id, slug), but the admin explicitly wants no two
 * products anywhere sharing a slug, since /product/[slug] resolves on the
 * slug alone. */
export async function isProductSlugTaken(slug: string, excludeId?: string): Promise<boolean> {
  const supabase = getAdminSupabase();
  if (!supabase) return false;
  let query = supabase.from("products").select("id").eq("slug", slug);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query;
  return (data?.length ?? 0) > 0;
}
