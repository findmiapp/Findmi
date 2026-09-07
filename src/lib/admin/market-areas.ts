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
