// Marketplace presentation — owner-facing (Business Manager) and Admin
// wording derived ONLY from the canonical readiness engine
// (./marketplace-eligibility.ts → marketplaceReadiness). No eligibility is
// computed here: every state below is a reading of `MarketplaceReadiness`.
// Pure — server, client, tests.
//
// Three concepts, never conflated:
//   Marketplace Review   has Findmi approved it? (marketplace_status)
//   Checkout             can Findmi checkout complete it? (commerce gate)
//   Marketplace Listing  is it actually live in Marketplace shopping
//                        surfaces right now? (= readiness.eligible)

import type { MarketplaceReadiness } from "./marketplace-eligibility";

export type OwnerMarketplaceStep =
  | "activate" // not a public catalog Product yet — nothing to request
  | "add_price" // public, but no price — review can't be requested
  | "request" // ready to request review
  | "rerequest" // Findmi didn't approve it last time
  | "pending" // review requested
  | "complete_checkout" // approved, checkout incomplete
  | "paused" // Findmi paused the listing / approval
  | "live"; // Available in Marketplace

export interface StatusRow {
  label: string;
  value: string;
  ok: boolean;
}

export interface OwnerMarketplaceState {
  step: OwnerMarketplaceStep;
  headline: string;
  body: string;
  /** The owner may submit a review request right now (never offered when
   * the request is known to fail). */
  canRequest: boolean;
  rows: StatusRow[];
}

const REVIEW_LABEL = {
  catalog_only: "Not Requested",
  submitted: "Pending",
  approved: "Approved",
  rejected: "Not Approved",
  paused: "Paused",
} as const;

export function ownerMarketplaceState(r: MarketplaceReadiness): OwnerMarketplaceState {
  const rows: StatusRow[] = [
    { label: "Product Profile", value: r.catalogVisible ? "Live" : "Not Live", ok: r.catalogVisible },
    { label: "Checkout", value: r.commerceReady ? "Ready" : "Not Ready", ok: r.commerceReady },
    { label: "Marketplace Review", value: REVIEW_LABEL[r.approval], ok: r.approved },
  ];
  const base = { rows, canRequest: false };
  if (r.eligible) return { ...base, step: "live", headline: "Available in Marketplace ✓", body: "Customers can buy this through Findmi checkout." };
  if (!r.catalogVisible) {
    return { ...base, step: "activate", headline: "Not Ready to Submit", body: "Make this product active and live on your profile before requesting Marketplace review." };
  }
  switch (r.approval) {
    case "submitted":
      return { ...base, step: "pending", headline: "Review Pending", body: r.commerceReady ? "Findmi is reviewing this product for Marketplace." : "Findmi is reviewing this product. Finish checkout setup so it can go live once approved." };
    case "approved":
      return { ...base, step: "complete_checkout", headline: "Approved · Complete Checkout Setup", body: "Findmi approved this product for Marketplace. Finish checkout setup so customers can buy it." };
    case "paused":
      return { ...base, step: "paused", headline: "Marketplace Paused", body: "Findmi has paused this product in Marketplace. It's still shown on your profile." };
    default: {
      if (r.blockers.includes("no_price")) {
        return { ...base, step: "add_price", headline: "Not Ready to Submit", body: "Add a price before requesting Marketplace review." };
      }
      const rejected = r.approval === "rejected";
      return {
        ...base,
        canRequest: true,
        step: rejected ? "rerequest" : "request",
        headline: rejected ? "Not Approved Yet" : "Listed in Your Catalog",
        body: rejected
          ? "Findmi didn't approve this product for Marketplace. Update it and request review again, or keep it catalog only."
          : "Shown on your Findmi profile. Request Marketplace review to sell it through Findmi.",
      };
    }
  }
}

export interface AdminMarketplaceSummary {
  rows: StatusRow[];
  /** One sentence that never calls a non-listed Product "live". */
  summary: string;
  listingLive: boolean;
}

export function adminMarketplaceSummary(r: MarketplaceReadiness): AdminMarketplaceSummary {
  const rows: StatusRow[] = [
    { label: "Marketplace Review", value: r.approved ? "Approved ✓" : REVIEW_LABEL[r.approval], ok: r.approved },
    { label: "Checkout", value: r.commerceReady ? "Ready ✓" : "Not Ready", ok: r.commerceReady },
    { label: "Marketplace Listing", value: r.eligible ? "Live ✓" : "Not Live", ok: r.eligible },
  ];
  let summary: string;
  if (r.eligible) summary = "Live in Marketplace shopping surfaces — customers can buy it through Findmi checkout.";
  else if (!r.catalogVisible) summary = "Not a public catalog product, so it can't be listed in Marketplace.";
  else if (r.approved) summary = "This product is approved for Findmi Marketplace. Complete checkout setup before it can appear in Marketplace shopping surfaces.";
  else if (r.approval === "submitted") summary = "Waiting for Marketplace review. It stays on its Business catalog meanwhile.";
  else if (r.approval === "paused") summary = "Marketplace approval is paused — not listed, even if checkout becomes ready. Still on its Business catalog.";
  else if (r.approval === "rejected") summary = "Marketplace review declined. Still on its Business catalog.";
  else summary = "Catalog only — shown on its Business profile, not in Marketplace.";
  return { rows, summary, listingLive: r.eligible };
}
