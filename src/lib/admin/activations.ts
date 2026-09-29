// FindMi Activations Pass 1 — admin query helpers, mirroring the exact
// shape lib/admin/queries.ts already uses for every other entity
// (getAdmin<Entity>/getAdmin<Entity>ById, service-role client, plain
// `.select("*")` + `.order(...)`). Kept in its own file rather than
// appended to queries.ts since Activations is a genuinely new, self-
// contained feature area — same "one file per entity area" convention
// already used by business-markets.ts/market-areas.ts/categoryForm.ts.

import { getAdminSupabase } from "./supabase-admin";

export type ActivationPhase =
  | "draft"
  | "exploring"
  | "applications_open"
  | "confirmed"
  | "live"
  | "completed"
  | "archived";

export type ActivationOperatorType = "findmi" | "agency" | "brand";
export type ActivationPriceVisibility = "visible" | "hidden" | "custom_label";
export type ActivationVenueStatus = "planned" | "confirmed" | "cancelled";
export type ActivationOptionKind = "goal" | "family";
export type ActivationInventoryKind = "space" | "timing" | "addon";
export type ActivationInventoryPriceType = "fixed" | "starting_at" | "custom" | "included" | "free";

export interface AdminActivation {
  id: string;
  slug: string;
  internal_name: string;
  public_name: string;
  concept_label: string | null;
  short_description: string | null;
  description: string | null;
  cover_image_url: string | null;
  phase: ActivationPhase;
  is_published: boolean;
  publish_at: string | null;
  city: string | null;
  region: string | null;
  country_code: string | null;
  default_timezone: string;
  market_id: string | null;
  market_area_id: string | null;
  currency_code: string;
  default_price_visibility: ActivationPriceVisibility;
  target_revenue: number | null;
  minimum_committed_threshold: number | null;
  target_brand_count: number | null;
  anchor_partner_target: number | null;
  venue_budget_ceiling: number | null;
  production_budget_ceiling: number | null;
  decision_deadline: string | null;
  operator_type: ActivationOperatorType;
  operator_business_id: string | null;
  meta_title: string | null;
  meta_description: string | null;
  og_image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminActivationVenue {
  id: string;
  activation_id: string;
  location_id: string | null;
  name: string | null;
  city: string | null;
  region: string | null;
  country_code: string | null;
  timezone: string | null;
  start_at: string | null;
  end_at: string | null;
  is_primary: boolean;
  sort_order: number;
  status: ActivationVenueStatus;
  created_at: string;
  updated_at: string;
}

export interface AdminActivationOption {
  id: string;
  activation_id: string;
  kind: ActivationOptionKind;
  label: string;
  description: string | null;
  icon_or_image_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminActivationInventoryItem {
  id: string;
  activation_id: string;
  venue_id: string | null;
  kind: ActivationInventoryKind;
  name: string;
  description: string | null;
  image_url: string | null;
  capacity: number | null;
  price_type: ActivationInventoryPriceType;
  price_amount: number | null;
  price_label: string | null;
  internal_estimated_value: number | null;
  price_visibility: ActivationPriceVisibility | null;
  relevant_category_ids: string[] | null;
  requirements: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminActivationListFilters {
  q?: string;
  phase?: ActivationPhase;
}

export async function getAdminActivations(filters: AdminActivationListFilters = {}): Promise<AdminActivation[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  let query = supabase.from("activations").select("*").order("created_at", { ascending: false });
  if (filters.q) {
    const term = `%${filters.q}%`;
    query = query.or(`internal_name.ilike.${term},public_name.ilike.${term},city.ilike.${term},slug.ilike.${term}`);
  }
  if (filters.phase) query = query.eq("phase", filters.phase);
  const { data } = await query;
  return (data as AdminActivation[]) ?? [];
}

export async function getAdminActivationById(id: string): Promise<AdminActivation | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("activations").select("*").eq("id", id).maybeSingle();
  return (data as AdminActivation) ?? null;
}

export async function getAdminActivationVenues(activationId: string): Promise<AdminActivationVenue[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("activation_venues")
    .select("*")
    .eq("activation_id", activationId)
    .order("sort_order", { ascending: true });
  return (data as AdminActivationVenue[]) ?? [];
}

export async function getAdminActivationOptions(activationId: string): Promise<AdminActivationOption[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("activation_options")
    .select("*")
    .eq("activation_id", activationId)
    .order("kind", { ascending: true })
    .order("sort_order", { ascending: true });
  return (data as AdminActivationOption[]) ?? [];
}

export async function getAdminActivationInventory(activationId: string): Promise<AdminActivationInventoryItem[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("activation_inventory")
    .select("*")
    .eq("activation_id", activationId)
    .order("kind", { ascending: true })
    .order("sort_order", { ascending: true });
  return (data as AdminActivationInventoryItem[]) ?? [];
}

/** Renumbers a same-parent, same-kind reorderable sequence to sequential
 * integers around a swap — same shape as categoryForm.ts's own
 * reorderBusinessCategory, generalized to any table/scope. */
export async function reorderActivationRows(
  supabase: NonNullable<ReturnType<typeof getAdminSupabase>>,
  table: "activation_options" | "activation_inventory",
  scope: { activation_id: string; kind: string },
  id: string,
  direction: "up" | "down"
): Promise<{ error?: string }> {
  const { data, error: fetchError } = await supabase
    .from(table)
    .select("id, sort_order")
    .eq("activation_id", scope.activation_id)
    .eq("kind", scope.kind)
    .order("sort_order", { ascending: true });
  if (fetchError) return { error: fetchError.message };

  const rows = data ?? [];
  const index = rows.findIndex((r) => r.id === id);
  if (index === -1) return { error: "Row not found." };
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= rows.length) return {};

  const reordered = [...rows];
  [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];

  for (let i = 0; i < reordered.length; i++) {
    if (reordered[i].sort_order !== i) {
      const { error } = await supabase.from(table).update({ sort_order: i }).eq("id", reordered[i].id);
      if (error) return { error: error.message };
    }
  }
  return {};
}
