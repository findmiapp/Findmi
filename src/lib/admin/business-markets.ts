// Markets Foundation V1 — admin-only read helpers for the new
// business_markets table (canonical business <-> FindMi Market
// entitlement). Same shape as lib/business-followers.ts/lib/inquiries.ts:
// every export here takes an already-service-role `admin` client, called
// only from the protected /admin/businesses/[id] editor — business_markets
// has RLS enabled with zero policies, so only this admin client can read
// or write it at all (see migration business_markets).
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AdminMarketOption {
  id: string;
  name: string;
  slug: string;
  active: boolean;
}

export type BusinessMarketRelationship = "primary" | "additional";

export interface BusinessMarketAssignment {
  id: string;
  marketId: string;
  marketName: string;
  marketSlug: string;
  relationship: BusinessMarketRelationship;
  provenance: string | null;
  active: boolean;
  createdAt: string;
}

/** Every Market row (active and inactive) — admin needs to see an
 * inactive market's name if a legacy assignment references one, even
 * though only active markets are offered for a brand-new assignment. */
export async function getAllMarketsForAdmin(admin: SupabaseClient): Promise<AdminMarketOption[]> {
  const { data } = await admin.from("markets").select("id, name, slug, active").order("sort_order");
  return (data ?? []) as AdminMarketOption[];
}

type AssignmentRow = {
  id: string;
  market_id: string;
  relationship: BusinessMarketRelationship;
  provenance: string | null;
  active: boolean;
  created_at: string;
  markets: { name: string; slug: string } | { name: string; slug: string }[] | null;
};

export async function getBusinessMarketAssignments(
  admin: SupabaseClient,
  businessId: string
): Promise<BusinessMarketAssignment[]> {
  const { data } = await admin
    .from("business_markets")
    .select("id, market_id, relationship, provenance, active, created_at, markets(name, slug)")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });

  return ((data ?? []) as AssignmentRow[]).map((r) => {
    const market = Array.isArray(r.markets) ? r.markets[0] : r.markets;
    return {
      id: r.id,
      marketId: r.market_id,
      marketName: market?.name ?? "Unknown market",
      marketSlug: market?.slug ?? "",
      relationship: r.relationship,
      provenance: r.provenance,
      active: r.active,
      createdAt: r.created_at,
    };
  });
}

/** Business Market -> Multi-Area Assignment pass — every business_market_areas
 * row for this business, grouped by market_id (one business can have
 * independent Area sets under multiple Markets — see business_markets'
 * own multi-Market support). Returns a plain Map so the admin editor can
 * look up `businessAreasByMarket.get(marketId) ?? []` per Market section
 * without a second query per row. Same admin/service-role-only posture as
 * getBusinessMarketAssignments above — business_market_areas has RLS
 * enabled with zero policies. */
export async function getBusinessAreasByMarket(admin: SupabaseClient, businessId: string): Promise<Map<string, string[]>> {
  const { data } = await admin.from("business_market_areas").select("market_id, market_area_id").eq("business_id", businessId);
  const byMarket = new Map<string, string[]>();
  for (const row of (data ?? []) as { market_id: string; market_area_id: string }[]) {
    byMarket.set(row.market_id, [...(byMarket.get(row.market_id) ?? []), row.market_area_id]);
  }
  return byMarket;
}
