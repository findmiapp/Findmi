import type { AppliedFeeSource } from "./types";
import type { Business, ProcessingFeePayer, Product } from "@/lib/types";

export const MARKETPLACE_DEFAULT_FEE_PERCENT = 5;
export const MARKETPLACE_DEFAULT_PROCESSING_PAYER: ProcessingFeePayer = "vendor";

/** Fee precedence (Part 1): product override > business override > 5%
 * marketplace default. A future campaign/promotion override would slot in
 * ahead of product — see AppliedFeeSource's "campaign_override" member,
 * reserved but not populated by any lookup yet (Part 26: no campaign
 * system in this pass). */
export function resolveMarketplaceFeePercent(
  business: Pick<Business, "marketplace_fee_percent">,
  product: Pick<Product, "marketplace_fee_override_percent">
): { percent: number; source: AppliedFeeSource } {
  if (product.marketplace_fee_override_percent != null) {
    return { percent: product.marketplace_fee_override_percent, source: "product_override" };
  }
  if (business.marketplace_fee_percent != null) {
    return { percent: business.marketplace_fee_percent, source: "business_override" };
  }
  return { percent: MARKETPLACE_DEFAULT_FEE_PERCENT, source: "marketplace_default" };
}

/** Processing-fee-payer precedence (Part 2): product override > business
 * setting > marketplace default (vendor). */
export function resolveProcessingFeePayer(
  business: Pick<Business, "processing_fee_payer">,
  product: Pick<Product, "processing_fee_payer_override">
): ProcessingFeePayer {
  if (product.processing_fee_payer_override) return product.processing_fee_payer_override;
  if (business.processing_fee_payer) return business.processing_fee_payer;
  return MARKETPLACE_DEFAULT_PROCESSING_PAYER;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Standard US Stripe card rate, used only as an up-front estimate at
 * checkout-creation time (before Stripe has actually charged the card and
 * told us its real fee). Reconciled against the real
 * balance_transaction.fee once the webhook fires — see
 * lib/commerce/processingFee.ts. */
export const ESTIMATED_STRIPE_RATE = 0.029;
export const ESTIMATED_STRIPE_FIXED_CENTS = 30;

export function estimateProcessingFee(totalCharged: number): number {
  return round2(totalCharged * ESTIMATED_STRIPE_RATE + ESTIMATED_STRIPE_FIXED_CENTS / 100);
}
