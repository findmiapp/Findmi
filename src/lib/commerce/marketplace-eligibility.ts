// Marketplace eligibility — the ONE rule for which Products may appear on
// Marketplace surfaces (/marketplace, Marketplace search, Featured
// Products, homepage Shop rows, curated Product sections), show commerce
// UI (price + Add to Cart) on cards and the Product page, and be bought
// through Findmi checkout.
//
// Three distinct Product concepts, never one status:
//   Catalog      — public discovery content (lib/product-catalog.ts).
//   Marketplace  — this file: Catalog + approval + commerce readiness.
//   Want         — demand (product_wants), independent of both.
//
// A Product is Marketplace-eligible only when ALL three gates pass:
//
//   1. catalog       active, content 'live', not archived / trashed; its
//                    Business live and not a demo (lib/product-catalog.ts)
//   2. approval      products.marketplace_status = 'approved' (a Business
//                    can only REQUEST; Admin approves). Approval alone
//                    never makes a Product buyable.
//   3. commerce      products.purchasable AND businesses.commerce_enabled
//      readiness     AND a real price (> 0) AND not sold out AND at least
//                    one fulfillment option Findmi checkout can actually
//                    complete today (pickup, or event pickup at a still-
//                    upcoming appearance — address-based methods aren't
//                    collectable at checkout yet, ./fulfillment-support.ts)
//
// If checkout cannot succeed, the Product is not Marketplace-eligible.
// Queries apply the database form (applyMarketplaceProductFilter) so a
// limit() counts mostly-eligible rows; the in-memory rule
// (marketplaceReadiness / isMarketplaceEligible) is the exact guard,
// including the joined Business and the fulfillment options.
// Pure — safe for server, client and tests.

import { isCatalogBusinessPublic, isCatalogProductPublic } from "@/lib/product-catalog";
import { isCheckoutSupportedMethod } from "./fulfillment-support";

export interface MarketplaceProductFields {
  is_active?: boolean | null;
  purchasable?: boolean | null;
  marketplace_status?: string | null;
  moderation_status?: string | null;
  archived_at?: string | null;
  trashed_at?: string | null;
  price?: number | string | null;
  inventory_status?: string | null;
}

export interface MarketplaceBusinessFields {
  commerce_enabled?: boolean | null;
  is_demo?: boolean | null;
  publication_status?: string | null;
}

/** One configured fulfillment option, as checkout sees it. `appearance` is
 * the event-pickup appearance's timing (null/absent = missing, canceled or
 * hidden — never usable). */
export interface CheckoutFulfillmentOption {
  method: string;
  enabled?: boolean | null;
  appearance_id?: string | null;
  appearance?: { start_at: string; end_at?: string | null } | null;
}

export type MarketplaceIneligibility =
  // catalog gate
  | "inactive"
  | "business_not_live"
  // approval gate
  | "not_approved"
  // commerce-readiness gate
  | "not_purchasable"
  | "commerce_disabled"
  | "no_price"
  | "sold_out"
  | "no_checkout_fulfillment";

export const CATALOG_BLOCKERS: readonly MarketplaceIneligibility[] = ["inactive", "business_not_live"];
export const COMMERCE_BLOCKERS: readonly MarketplaceIneligibility[] = ["not_purchasable", "commerce_disabled", "no_price", "sold_out", "no_checkout_fulfillment"];

/** Same expiry rule as isAppearanceStillAvailable (lib/format.ts): end_at,
 * falling back to start_at. Inlined to keep this module dependency-free. */
function appearanceStillAvailable(a: { start_at: string; end_at?: string | null }, now: number): boolean {
  return new Date(a.end_at ?? a.start_at).getTime() >= now;
}

/** The options Findmi checkout can actually complete right now. */
export function usableCheckoutFulfillment<T extends CheckoutFulfillmentOption>(options: readonly T[], now = Date.now()): T[] {
  return options.filter((o) => {
    if (o.enabled === false) return false;
    if (!isCheckoutSupportedMethod(o.method)) return false;
    if (o.method === "event_pickup") return Boolean(o.appearance) && appearanceStillAvailable(o.appearance!, now);
    return true;
  });
}

function hasRealPrice(price: MarketplaceProductFields["price"]): boolean {
  const n = typeof price === "string" ? Number(price) : price;
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** Every reason a Product is not Marketplace-eligible (empty = eligible),
 * in gate order: catalog, approval, commerce readiness. */
export function marketplaceIneligibility(
  product: MarketplaceProductFields,
  business: MarketplaceBusinessFields | null | undefined,
  fulfillment: readonly CheckoutFulfillmentOption[],
  now = Date.now()
): MarketplaceIneligibility[] {
  const reasons: MarketplaceIneligibility[] = [];
  if (!isCatalogProductPublic(product)) reasons.push("inactive");
  if (!isCatalogBusinessPublic(business)) reasons.push("business_not_live");
  if (product.marketplace_status !== "approved") reasons.push("not_approved");
  if (product.purchasable !== true) reasons.push("not_purchasable");
  if (!business || business.commerce_enabled !== true) reasons.push("commerce_disabled");
  if (!hasRealPrice(product.price)) reasons.push("no_price");
  if (product.inventory_status === "out_of_stock") reasons.push("sold_out");
  if (usableCheckoutFulfillment(fulfillment, now).length === 0) reasons.push("no_checkout_fulfillment");
  return reasons;
}

export function isMarketplaceEligible(
  product: MarketplaceProductFields,
  business: MarketplaceBusinessFields | null | undefined,
  fulfillment: readonly CheckoutFulfillmentOption[],
  now = Date.now()
): boolean {
  return marketplaceIneligibility(product, business, fulfillment, now).length === 0;
}

export type MarketplaceApprovalStatus = "catalog_only" | "submitted" | "approved" | "rejected" | "paused";

export interface MarketplaceReadiness {
  eligible: boolean;
  /** Publicly visible as catalog content. */
  catalogVisible: boolean;
  approval: MarketplaceApprovalStatus;
  approved: boolean;
  /** Commerce gate alone (independent of approval). */
  commerceReady: boolean;
  blockers: MarketplaceIneligibility[];
  commerceBlockers: MarketplaceIneligibility[];
}

/** The full picture for Business Manager / Admin: the two gates reported
 * separately, plus the exact blockers. */
export function marketplaceReadiness(
  product: MarketplaceProductFields,
  business: MarketplaceBusinessFields | null | undefined,
  fulfillment: readonly CheckoutFulfillmentOption[],
  now = Date.now()
): MarketplaceReadiness {
  const blockers = marketplaceIneligibility(product, business, fulfillment, now);
  const commerceBlockers = blockers.filter((b) => COMMERCE_BLOCKERS.includes(b));
  const approval = (["catalog_only", "submitted", "approved", "rejected", "paused"].includes(product.marketplace_status ?? "")
    ? product.marketplace_status
    : "catalog_only") as MarketplaceApprovalStatus;
  return {
    eligible: blockers.length === 0,
    catalogVisible: !blockers.some((b) => CATALOG_BLOCKERS.includes(b)),
    approval,
    approved: approval === "approved",
    commerceReady: commerceBlockers.length === 0,
    blockers,
    commerceBlockers,
  };
}

/** The Business half of the database pre-filter, for a joined Business
 * row (the exact rule still runs through isMarketplaceEligible). */
export function isMarketplaceBusinessEligible(business: MarketplaceBusinessFields | null | undefined): boolean {
  return isCatalogBusinessPublic(business) && business!.commerce_enabled === true;
}

/** Owner / Admin explanation of each blocker — actionable, never shown to
 * the public (the public sees only the catalog state). */
export const MARKETPLACE_INELIGIBILITY_COPY: Record<MarketplaceIneligibility, string> = {
  inactive: "The product is hidden, inactive or not yet approved as content.",
  business_not_live: "This Business isn't live on Findmi yet.",
  not_approved: "Not approved for the Marketplace yet.",
  not_purchasable: "Selling through Findmi checkout is turned off for this product.",
  commerce_disabled: "Findmi checkout isn't enabled for this Business yet — Findmi turns this on.",
  no_price: "Add a price — Marketplace products need a real price.",
  sold_out: "Marked sold out.",
  no_checkout_fulfillment: "Add a pickup or event pickup option — checkout can't complete without one (shipping and delivery aren't available at checkout yet).",
};

/** The database form of the Product half of the rule (catalog + approval +
 * purchasable + price). `query` is any PostgREST filter builder on
 * `products`. Business, stock and fulfillment are checked in memory with
 * isMarketplaceEligible. */
export function applyMarketplaceProductFilter(query: any): any {
  return query
    .eq("is_active", true)
    .eq("moderation_status", "live")
    .eq("marketplace_status", "approved")
    .eq("purchasable", true)
    .gt("price", 0)
    .is("archived_at", null)
    .is("trashed_at", null);
}
