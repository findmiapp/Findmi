import { getAdminSupabase } from "./supabase-admin";
import type { Appearance, Business, Category, FindmiEvent, FindmiLocation, Product } from "@/lib/types";

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
  const [businesses, events, locations, appearances, products] = await Promise.all([
    supabase.from("businesses").select("id, is_demo", { count: "exact", head: true }),
    supabase.from("events").select("id", { count: "exact", head: true }),
    supabase.from("locations").select("id", { count: "exact", head: true }),
    supabase.from("appearances").select("id", { count: "exact", head: true }),
    supabase.from("products").select("id", { count: "exact", head: true }),
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
  };
}

// ---------------------------------------------------------------------
// Businesses
// ---------------------------------------------------------------------

export async function getAdminBusinesses(q?: string): Promise<AdminBusiness[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  let query = supabase.from("businesses").select("*").order("name");
  if (q) query = query.ilike("name", `%${q}%`);
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

export async function getBusinessSelectOptions(): Promise<SelectOption[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("businesses")
    .select("id, name, is_demo")
    .order("name");
  return (data ?? []).map((b: { id: string; name: string; is_demo: boolean }) => ({
    value: b.id,
    label: b.name,
    sublabel: b.is_demo ? "Demo (hidden)" : "Public",
  }));
}

// ---------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------

export async function getAdminEvents(): Promise<AdminEvent[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase.from("events").select("*").order("start_at", { ascending: false });
  return (data as AdminEvent[]) ?? [];
}

export async function getAdminEventById(
  id: string
): Promise<{ event: AdminEvent; businessIds: string[] } | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const [{ data: event }, { data: links }] = await Promise.all([
    supabase.from("events").select("*").eq("id", id).maybeSingle(),
    supabase.from("event_businesses").select("business_id").eq("event_id", id),
  ]);
  if (!event) return null;
  return {
    event: event as AdminEvent,
    businessIds: (links ?? []).map((l: { business_id: string }) => l.business_id),
  };
}

export async function getEventSelectOptions(): Promise<SelectOption[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("events")
    .select("id, name, is_demo")
    .order("name");
  return (data ?? []).map((e: { id: string; name: string; is_demo: boolean }) => ({
    value: e.id,
    label: e.name,
    sublabel: e.is_demo ? "Demo (hidden)" : "Public",
  }));
}

// ---------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------

export async function getAdminLocations(): Promise<AdminLocation[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase.from("locations").select("*").order("name");
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

export async function getAdminAppearances(): Promise<AdminAppearanceRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("appearances")
    .select("*, business:businesses(id, name), event:events(id, name)")
    .order("start_at", { ascending: false });
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

export async function getAdminProducts(): Promise<AdminProductRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("products")
    .select("*, business:businesses(id, name)")
    .order("name");
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
