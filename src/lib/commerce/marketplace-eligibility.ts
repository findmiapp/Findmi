// Marketplace eligibility — the ONE rule for which Products may appear on
// Marketplace surfaces (/marketplace, Marketplace search, Featured
// Products, homepage Shop rows, curated Product sections) and be bought
// through Findmi checkout.
//
// Product EXISTENCE is not Marketplace DISTRIBUTION. A live, active
// Product is always shown contextually — on its Business profile, its own
// page, Events, Appearances — whatever its Marketplace state. It is
// Marketplace-eligible only when ALL of these hold:
//
//   1. marketplace approval   products.marketplace_status = 'approved'
//                             (a Business can only SUBMIT; Admin approves)
//   2. active / published     products.is_active, moderation_status 'live',
//                             not archived / trashed; its Business is
//                             live and not a demo
//   3. Findmi purchase        products.purchasable AND
//      capability             businesses.commerce_enabled (real
//                             add-to-cart through Findmi checkout)
//
// Queries apply the database form (applyMarketplaceProductFilter) so a
// limit() counts only eligible rows; the in-memory predicate
// (isMarketplaceEligible) is the exact guard for the joined Business.
// Pure — safe for server, client and tests.

export interface MarketplaceProductFields {
  is_active?: boolean | null;
  purchasable?: boolean | null;
  marketplace_status?: string | null;
  moderation_status?: string | null;
  archived_at?: string | null;
  trashed_at?: string | null;
}

export interface MarketplaceBusinessFields {
  commerce_enabled?: boolean | null;
  is_demo?: boolean | null;
  publication_status?: string | null;
}

export type MarketplaceIneligibility =
  | "not_approved"
  | "inactive"
  | "not_purchasable"
  | "commerce_disabled"
  | "business_not_live";

/** Every reason a Product is not on the Marketplace (empty = eligible). */
export function marketplaceIneligibility(product: MarketplaceProductFields, business: MarketplaceBusinessFields | null | undefined): MarketplaceIneligibility[] {
  const reasons: MarketplaceIneligibility[] = [];
  if (product.marketplace_status !== "approved") reasons.push("not_approved");
  if (product.is_active !== true || (product.moderation_status ?? "live") !== "live" || product.archived_at || product.trashed_at) reasons.push("inactive");
  if (product.purchasable !== true) reasons.push("not_purchasable");
  if (!business || business.commerce_enabled !== true) reasons.push("commerce_disabled");
  if (!business || business.is_demo === true || (business.publication_status ?? "live") !== "live") reasons.push("business_not_live");
  return reasons;
}

export function isMarketplaceEligible(product: MarketplaceProductFields, business: MarketplaceBusinessFields | null | undefined): boolean {
  return marketplaceIneligibility(product, business).length === 0;
}

/** The Business half of the rule, for a joined Business row. */
export function isMarketplaceBusinessEligible(business: MarketplaceBusinessFields | null | undefined): boolean {
  return Boolean(business) && business!.commerce_enabled === true && business!.is_demo !== true && (business!.publication_status ?? "live") === "live";
}

/** Owner-facing explanation of why a Product isn't on the Marketplace. */
export const MARKETPLACE_INELIGIBILITY_COPY: Record<MarketplaceIneligibility, string> = {
  not_approved: "Not approved for the Marketplace yet.",
  inactive: "Hidden or not yet live.",
  not_purchasable: "Checkout isn't turned on for this product.",
  commerce_disabled: "Findmi checkout isn't enabled for this Business yet.",
  business_not_live: "This Business isn't live on Findmi yet.",
};

/** The database form of the Product half of the rule. `query` is any
 * PostgREST filter builder on `products`. The Business half is checked on
 * the joined row with isMarketplaceEligible. */
export function applyMarketplaceProductFilter(query: any): any {
  return query.eq("is_active", true).eq("moderation_status", "live").eq("marketplace_status", "approved").eq("purchasable", true).is("archived_at", null).is("trashed_at", null);
}
