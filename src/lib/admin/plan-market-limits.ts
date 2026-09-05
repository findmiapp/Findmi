// Market Management + Plan Market Allowances V1 — admin read helper for
// plan_market_limits, the configurable backing store behind
// lib/entitlements.ts's getBusinessMarketLimit/getMarketLimitForPlanTier.
// Same small dedicated-file shape as lib/admin/business-markets.ts. A
// SEPARATE system from membership_plans (the legacy Founding Membership
// funnel's own plans, managed on this same /admin/plans page) — this one
// is the Free/Pro/Pro Seller business plan_tier's Market allowance.
import { getAdminSupabase } from "./supabase-admin";
import type { PlanTier } from "@/lib/types";

export interface PlanMarketLimitRow {
  planTier: PlanTier;
  /** null = Unlimited. */
  marketLimit: number | null;
}

const PLAN_TIERS: PlanTier[] = ["free", "pro", "pro_seller"];

/** Always returns exactly one row per PLAN_TIERS entry, defaulting a
 * missing row to a 1-Market allowance (the same conservative default
 * getMarketLimitForPlanTier itself falls back to) — should not happen
 * post-migration since it seeds all three, but keeps this admin screen
 * correct even if a row were ever removed directly in the database. */
export async function getPlanMarketLimits(): Promise<PlanMarketLimitRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return PLAN_TIERS.map((planTier) => ({ planTier, marketLimit: 1 }));
  const { data } = await supabase.from("plan_market_limits").select("plan_tier, market_limit");
  const byTier = new Map((data ?? []).map((r) => [r.plan_tier as PlanTier, r.market_limit as number | null]));
  return PLAN_TIERS.map((planTier) => ({
    planTier,
    marketLimit: byTier.has(planTier) ? byTier.get(planTier)! : 1,
  }));
}
