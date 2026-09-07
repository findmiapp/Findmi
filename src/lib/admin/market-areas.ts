// Market -> Area Admin Management Completion pass — admin read/write
// helpers for the EXISTING `market_areas` table (Market -> Area/Submarket
// Hierarchy V2). Same small dedicated-file shape as lib/admin/markets.ts.
// This is the same table/columns/semantics getConsumerVisibleMarketsWithAreas
// (lib/data.ts) and AreaPicker already read — no parallel geography system.
import { getAdminSupabase } from "./supabase-admin";
import type { MarketArea } from "@/lib/types";

export async function getAdminAreasByMarket(marketId: string): Promise<MarketArea[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase.from("market_areas").select("*").eq("market_id", marketId).order("sort_order");
  return (data as MarketArea[]) ?? [];
}

export async function getAdminMarketAreaById(id: string): Promise<MarketArea | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("market_areas").select("*").eq("id", id).maybeSingle();
  return (data as MarketArea) ?? null;
}

/** Market list "N Areas" — Section 8's cheap-count requirement. One plain
 * select of every market_areas row's own market_id (current real volume
 * is a handful of Markets each with a handful of Areas), tallied in JS —
 * a single query, never one query per Market row. */
export async function getMarketAreaCounts(): Promise<Map<string, number>> {
  const supabase = getAdminSupabase();
  if (!supabase) return new Map();
  const { data } = await supabase.from("market_areas").select("market_id");
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { market_id: string }[]) {
    counts.set(row.market_id, (counts.get(row.market_id) ?? 0) + 1);
  }
  return counts;
}

/** market_areas has a (market_id, slug) UNIQUE constraint, not a
 * table-wide one like markets/businesses/events/locations/people — same
 * scoped-uniqueness shape as isCategorySlugTaken (lib/admin/queries.ts),
 * reusing the exact same ensureUniqueSlug/resolveSlugInput generation
 * utilities, just with the correct scope for this table. */
export async function isMarketAreaSlugTaken(marketId: string, slug: string, excludeId?: string): Promise<boolean> {
  const supabase = getAdminSupabase();
  if (!supabase) return false;
  let query = supabase.from("market_areas").select("id").eq("market_id", marketId).eq("slug", slug);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query;
  return (data?.length ?? 0) > 0;
}

/** Event + Appearance Geography Completion pass — feeds MarketAreaFields
 * (the Market -> Area cascading select) on both the Admin Event form and
 * the owner Event Manager's Market/Area tab. Deliberately `active` only
 * (NOT also `consumer_visible`, unlike getConsumerVisibleMarketsWithAreas
 * in lib/data.ts) — an admin/owner needs to be able to assign an Area
 * that's valid but not yet publicly discoverable; consumer_visible only
 * ever gates the public AreaPicker. Two cheap queries total (all active
 * Markets, all active Areas), joined in JS — never one query per Market. */
export interface ActiveMarketWithAreaOptions {
  id: string;
  name: string;
  areas: { id: string; name: string }[];
}

export async function getActiveMarketsWithAreaOptions(): Promise<ActiveMarketWithAreaOptions[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const [{ data: marketRows }, { data: areaRows }] = await Promise.all([
    supabase.from("markets").select("id, name").eq("active", true).order("sort_order"),
    supabase.from("market_areas").select("id, name, market_id").eq("active", true).order("sort_order"),
  ]);
  const areasByMarket = new Map<string, { id: string; name: string }[]>();
  for (const a of (areaRows ?? []) as { id: string; name: string; market_id: string }[]) {
    areasByMarket.set(a.market_id, [...(areasByMarket.get(a.market_id) ?? []), { id: a.id, name: a.name }]);
  }
  return ((marketRows ?? []) as { id: string; name: string }[]).map((m) => ({
    ...m,
    areas: areasByMarket.get(m.id) ?? [],
  }));
}

/** True when `areaId` belongs to `marketId` — the server-side backstop
 * behind MarketAreaFields' client-side reset-on-Market-change. Every save
 * action that writes market_area_id calls this before writing it, so a
 * stale/tampered submission (JS disabled, race, hand-crafted request)
 * can never leave an Area attached to the wrong Market. */
export async function isAreaInMarket(areaId: string, marketId: string): Promise<boolean> {
  const supabase = getAdminSupabase();
  if (!supabase) return false;
  const { data } = await supabase.from("market_areas").select("id").eq("id", areaId).eq("market_id", marketId).maybeSingle();
  return Boolean(data);
}
