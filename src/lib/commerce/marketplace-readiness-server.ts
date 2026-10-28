// Server half of the Marketplace rule (./marketplace-eligibility.ts): loads
// the fulfillment configuration the pure rule needs, and annotates Product
// rows with the ONE `marketplace_eligible` answer every card / page uses.
// Works with the anon client (RLS already hides disabled options and
// canceled appearances) and the service-role client (filtered explicitly
// here so both agree).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMarketplaceEligible,
  marketplaceReadiness,
  type CheckoutFulfillmentOption,
  type MarketplaceBusinessFields,
  type MarketplaceProductFields,
  type MarketplaceReadiness,
} from "./marketplace-eligibility";

export type FulfillmentByProduct = Map<string, CheckoutFulfillmentOption[]>;

/** Enabled fulfillment options per Product, each event pickup carrying its
 * (non-canceled) appearance's timing. Two queries regardless of size. */
export async function loadCheckoutFulfillment(client: SupabaseClient, productIds: readonly string[]): Promise<FulfillmentByProduct> {
  const out: FulfillmentByProduct = new Map();
  const ids = [...new Set(productIds)].filter(Boolean);
  if (ids.length === 0) return out;
  const { data: options } = await client
    .from("product_fulfillment_options")
    .select("product_id, method, enabled, appearance_id")
    .in("product_id", ids)
    .eq("enabled", true);
  const rows = (options ?? []) as { product_id: string; method: string; enabled: boolean; appearance_id: string | null }[];
  const appearanceIds = [...new Set(rows.map((r) => r.appearance_id).filter(Boolean))] as string[];
  const { data: appearances } = appearanceIds.length
    ? await client.from("appearances").select("id, start_at, end_at, status").in("id", appearanceIds)
    : { data: [] };
  const appearanceById = new Map(
    ((appearances ?? []) as { id: string; start_at: string; end_at: string | null; status?: string | null }[])
      .filter((a) => a.status !== "canceled")
      .map((a) => [a.id, { start_at: a.start_at, end_at: a.end_at }])
  );
  for (const r of rows) {
    const list = out.get(r.product_id) ?? [];
    list.push({ method: r.method, enabled: r.enabled, appearance_id: r.appearance_id, appearance: r.appearance_id ? (appearanceById.get(r.appearance_id) ?? null) : null });
    out.set(r.product_id, list);
  }
  return out;
}

type AnnotatableProduct = MarketplaceProductFields & { id: string };

/** Sets `marketplace_eligible` on each row from the canonical rule.
 * `businessOf` returns the row's joined Business (commerce_enabled,
 * is_demo, publication_status). */
export async function annotateMarketplaceEligibility<T extends AnnotatableProduct>(
  client: SupabaseClient,
  rows: readonly T[],
  businessOf: (row: T) => MarketplaceBusinessFields | null | undefined
): Promise<(T & { marketplace_eligible: boolean })[]> {
  // Only rows that pass the cheap gates need their fulfillment loaded.
  const candidates = rows.filter((r) => r.marketplace_status === "approved" && r.purchasable === true);
  const fulfillment = await loadCheckoutFulfillment(client, candidates.map((r) => r.id));
  return rows.map((r) => ({ ...r, marketplace_eligible: isMarketplaceEligible(r, businessOf(r), fulfillment.get(r.id) ?? []) }));
}

/** Keeps only the rows that are Marketplace-eligible (annotated true). */
export async function filterMarketplaceEligible<T extends AnnotatableProduct>(
  client: SupabaseClient,
  rows: readonly T[],
  businessOf: (row: T) => MarketplaceBusinessFields | null | undefined
): Promise<(T & { marketplace_eligible: boolean })[]> {
  return (await annotateMarketplaceEligibility(client, rows, businessOf)).filter((r) => r.marketplace_eligible);
}

/** Full readiness (both gates + blockers) for Business Manager / Admin. */
export async function loadMarketplaceReadiness<T extends AnnotatableProduct>(
  client: SupabaseClient,
  rows: readonly T[],
  businessOf: (row: T) => MarketplaceBusinessFields | null | undefined
): Promise<Map<string, MarketplaceReadiness>> {
  const fulfillment = await loadCheckoutFulfillment(client, rows.map((r) => r.id));
  return new Map(rows.map((r) => [r.id, marketplaceReadiness(r, businessOf(r), fulfillment.get(r.id) ?? [])]));
}
