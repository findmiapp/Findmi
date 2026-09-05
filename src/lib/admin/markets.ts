// Market Management + Plan Market Allowances V1 — admin read helpers for
// the `markets` table (same table business_markets/events/event_occurrences/
// locations already reference by id; this pass only adds founder-editable
// presentation/metadata columns to it — see the migration). Same small
// dedicated-file shape as lib/admin/business-markets.ts.
import { getAdminSupabase } from "./supabase-admin";
import type { Market } from "@/lib/types";

export async function getAdminMarkets(): Promise<Market[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase.from("markets").select("*").order("sort_order");
  return (data as Market[]) ?? [];
}

export async function getAdminMarketById(id: string): Promise<Market | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("markets").select("*").eq("id", id).maybeSingle();
  return (data as Market) ?? null;
}

/** Whether this Market is referenced anywhere it must never be
 * hard-deleted out from under — business/event/occurrence/location
 * assignments all point at a Market by id. Used only to decide whether a
 * delete action should even be offered, per this pass's "prefer active/
 * inactive archival behavior, do not hard-delete a referenced Market"
 * instruction. No delete action exists yet for markets (unlike locations/
 * events), so this pass doesn't add one — provided for a future pass that
 * might. */
export async function isMarketReferenced(id: string): Promise<boolean> {
  const supabase = getAdminSupabase();
  if (!supabase) return true; // fail safe: assume referenced if we can't check
  const [{ count: businessCount }, { count: eventCount }, { count: occurrenceCount }, { count: locationCount }] =
    await Promise.all([
      supabase.from("business_markets").select("id", { count: "exact", head: true }).eq("market_id", id),
      supabase.from("events").select("id", { count: "exact", head: true }).eq("market_id", id),
      supabase.from("event_occurrences").select("id", { count: "exact", head: true }).eq("market_id", id),
      supabase.from("locations").select("id", { count: "exact", head: true }).eq("market_id", id),
    ]);
  return (businessCount ?? 0) + (eventCount ?? 0) + (occurrenceCount ?? 0) + (locationCount ?? 0) > 0;
}
