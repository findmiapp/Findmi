import type { FulfillmentMethod, ProcessingFeePayer } from "@/lib/types";

// Shared shapes for the cart/checkout/order pipeline. Kept separate from
// lib/types.ts (the public catalog types) since these are commerce-specific
// and mostly server/admin-facing.

export type AppliedFeeSource =
  | "marketplace_default"
  | "business_override"
  | "product_override"
  | "campaign_override";

export type OrderPaymentStatus = "pending" | "paid" | "failed" | "canceled";
export type OrderRefundStatus = "none" | "partial" | "full";
export type FulfillmentStatus = "unfulfilled" | "fulfilled";
export type AllocationStatus = "held" | "partially_paid" | "paid" | "refunded" | "cancelled";
export type SettlementMethod = "ach" | "zelle" | "check" | "cash" | "other";

/** What the browser stores per cart line — no prices. Everything priced is
 * re-derived server-side from productId/quantity/fulfillment at quote and
 * checkout time (see lib/commerce/quote.ts) — never trusted from the
 * client. */
export interface CartLine {
  /** Client-generated id for this line, so the same product can appear
   * twice with different fulfillment choices without colliding. */
  lineId: string;
  productId: string;
  quantity: number;
  fulfillmentMethod: FulfillmentMethod;
  /** Set only when fulfillmentMethod === "event_pickup". */
  appearanceId?: string | null;
  /** Where this item was added from, e.g. "event:minthorne-market" or
   * "business:the-native-rose" — carried through to the order item's
   * source_channel for later attribution reporting. */
  sourceChannel?: string | null;
}

export interface CartLineQuote {
  lineId: string;
  productId: string;
  productName: string;
  productSlug: string;
  imageUrl: string | null;
  businessId: string;
  businessName: string;
  businessSlug: string;
  quantity: number;
  unitPrice: number;
  lineMerchandiseTotal: number;
  fulfillmentMethod: FulfillmentMethod;
  fulfillmentAmount: number;
  fulfillmentLabel: string;
  appearanceId: string | null;
  appearanceLabel: string | null;
  eventId: string | null;
  processingFeePayer: ProcessingFeePayer;
  sourceChannel: string | null;
  /** False when the product/business/fulfillment choice is no longer valid
   * (commerce disabled, no longer purchasable, option removed) — the cart
   * UI surfaces this instead of silently dropping or mispricing the line. */
  available: boolean;
  unavailableReason?: string;
  /** Every currently-enabled fulfillment choice for this product, so the
   * cart can offer "change fulfillment" without a second round trip. */
  availableFulfillmentOptions: {
    method: FulfillmentMethod;
    price: number;
    label: string;
    appearanceId: string | null;
  }[];
}

export interface CartQuote {
  lines: CartLineQuote[];
  merchandiseSubtotal: number;
  fulfillmentTotal: number;
  /** Customer-facing surcharge only — never the vendor-absorbed processing
   * fee, which customers never see (see Part 16). */
  customerProcessingFeeTotal: number;
  total: number;
  hasUnavailable: boolean;
}
