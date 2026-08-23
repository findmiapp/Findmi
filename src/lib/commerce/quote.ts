import { getSupabase } from "@/lib/supabase";
import { formatDateRange } from "@/lib/format";
import {
  estimateProcessingFee,
  resolveMarketplaceFeePercent,
  resolveProcessingFeePayer,
  round2,
} from "./fees";
import { allocateProportionally } from "./processingFee";
import type { CartLine, CartLineQuote, CartQuote } from "./types";
import type { AppliedFeeSource, FulfillmentStatus } from "./types";
import type { Business, FulfillmentMethod, ProcessingFeePayer, Product } from "@/lib/types";

const FULFILLMENT_LABELS: Record<FulfillmentMethod, string> = {
  shipping: "Shipping",
  local_delivery: "Local Delivery",
  pickup: "Pickup",
  event_pickup: "Event Pickup",
};

/** Fully computed, ready-to-insert order_items row — the single source of
 * truth for the line's economics, produced once server-side and reused by
 * both the cart quote (display) and checkout (persistence) so the two can
 * never drift. Processing-fee allocation here is still the *estimate* (see
 * lib/commerce/fees.ts) — reconciled to Stripe's real fee by the webhook. */
export interface ComputedOrderItem {
  lineId: string;
  productId: string;
  productName: string;
  productSlug: string;
  imageUrl: string | null;
  businessId: string;
  businessName: string;
  businessSlug: string;
  unitPrice: number;
  quantity: number;
  lineMerchandiseTotal: number;
  fulfillmentMethod: FulfillmentMethod;
  fulfillmentAmount: number;
  fulfillmentLabel: string;
  appearanceId: string | null;
  appearanceLabel: string | null;
  eventId: string | null;
  marketplaceFeePercent: number;
  marketplaceFeeAmount: number;
  appliedFeeSource: AppliedFeeSource;
  processingFeePayer: ProcessingFeePayer;
  allocatedProcessingFeeAmount: number;
  vendorGross: number;
  vendorNet: number;
  sourceChannel: string | null;
  fulfillmentStatus: FulfillmentStatus;
}

export interface OrderDraft {
  quote: CartQuote;
  items: ComputedOrderItem[];
}

type ProductRow = Product & {
  businesses: (Business & { is_demo?: boolean }) | (Business & { is_demo?: boolean })[] | null;
};

/** Re-reads every product/business/fulfillment-option from the database and
 * recomputes the full economics for a set of cart lines — never trusts
 * prices, fees, or fulfillment amounts from the client. Used both to
 * render the /cart page (display only) and, identically, to build the
 * order about to be persisted at checkout, so what the customer sees is
 * exactly what gets charged. */
export async function computeOrderDraft(lines: CartLine[]): Promise<OrderDraft> {
  const supabase = getSupabase();
  const emptyQuote: CartQuote = {
    lines: [],
    merchandiseSubtotal: 0,
    fulfillmentTotal: 0,
    customerProcessingFeeTotal: 0,
    total: 0,
    hasUnavailable: false,
  };
  if (!supabase || lines.length === 0) return { quote: emptyQuote, items: [] };

  const productIds = Array.from(new Set(lines.map((l) => l.productId)));
  const { data: products } = await supabase
    .from("products")
    .select("*, businesses(*)")
    .in("id", productIds);

  const productById = new Map<string, ProductRow>();
  for (const p of (products ?? []) as ProductRow[]) productById.set(p.id, p);

  const { data: fulfillmentOptions } = await supabase
    .from("product_fulfillment_options")
    .select("*")
    .in("product_id", productIds)
    .eq("enabled", true);

  const appearanceIds = Array.from(
    new Set((fulfillmentOptions ?? []).map((o) => o.appearance_id).filter(Boolean))
  ) as string[];
  const { data: appearances } = appearanceIds.length
    ? await supabase.from("appearances").select("*").in("id", appearanceIds)
    : { data: [] as never[] };
  const appearanceById = new Map((appearances ?? []).map((a) => [a.id, a]));

  function optionsForProduct(productId: string) {
    return (fulfillmentOptions ?? [])
      .filter((o) => o.product_id === productId)
      .map((o) => {
        const appearance = o.appearance_id ? appearanceById.get(o.appearance_id) : null;
        const label =
          o.method === "event_pickup" && appearance
            ? `Pickup at ${appearance.venue_name ?? appearance.title} — ${formatDateRange(appearance.start_at, appearance.end_at)}`
            : FULFILLMENT_LABELS[o.method as FulfillmentMethod];
        return {
          method: o.method as FulfillmentMethod,
          price: o.price,
          label,
          appearanceId: o.appearance_id,
        };
      });
  }

  const quoteLines: CartLineQuote[] = [];
  const computedItems: ComputedOrderItem[] = [];

  for (const line of lines) {
    const product = productById.get(line.productId);
    const business = product
      ? Array.isArray(product.businesses)
        ? product.businesses[0]
        : product.businesses
      : null;

    const baseQuote: Partial<CartLineQuote> = {
      lineId: line.lineId,
      productId: line.productId,
      quantity: Math.max(1, Math.floor(line.quantity)),
      fulfillmentMethod: line.fulfillmentMethod,
      appearanceId: line.appearanceId ?? null,
      sourceChannel: line.sourceChannel ?? null,
    };

    if (!product || !business || (business as Business & { is_demo?: boolean }).is_demo) {
      quoteLines.push({
        ...baseQuote,
        productName: "Unavailable product",
        productSlug: "",
        imageUrl: null,
        businessId: "",
        businessName: "",
        businessSlug: "",
        unitPrice: 0,
        lineMerchandiseTotal: 0,
        fulfillmentAmount: 0,
        fulfillmentLabel: FULFILLMENT_LABELS[line.fulfillmentMethod],
        appearanceLabel: null,
        eventId: null,
        processingFeePayer: "vendor",
        available: false,
        unavailableReason: "This item is no longer available.",
        availableFulfillmentOptions: [],
      } as CartLineQuote);
      continue;
    }

    if (!product.purchasable || !business.commerce_enabled || !product.is_active) {
      quoteLines.push({
        ...baseQuote,
        productName: product.name,
        productSlug: product.slug,
        imageUrl: product.image_url,
        businessId: business.id,
        businessName: business.name,
        businessSlug: business.slug,
        unitPrice: product.price ?? 0,
        lineMerchandiseTotal: 0,
        fulfillmentAmount: 0,
        fulfillmentLabel: FULFILLMENT_LABELS[line.fulfillmentMethod],
        appearanceLabel: null,
        eventId: null,
        processingFeePayer: "vendor",
        available: false,
        unavailableReason: "This item is no longer available for purchase.",
        availableFulfillmentOptions: optionsForProduct(product.id),
      } as CartLineQuote);
      continue;
    }

    const options = (fulfillmentOptions ?? []).filter((o) => o.product_id === product.id);
    const matchedOption =
      line.fulfillmentMethod === "event_pickup"
        ? options.find((o) => o.method === "event_pickup" && o.appearance_id === line.appearanceId)
        : options.find((o) => o.method === line.fulfillmentMethod);

    if (!matchedOption) {
      quoteLines.push({
        ...baseQuote,
        productName: product.name,
        productSlug: product.slug,
        imageUrl: product.image_url,
        businessId: business.id,
        businessName: business.name,
        businessSlug: business.slug,
        unitPrice: product.price ?? 0,
        lineMerchandiseTotal: round2((product.price ?? 0) * (baseQuote.quantity ?? 1)),
        fulfillmentAmount: 0,
        fulfillmentLabel: FULFILLMENT_LABELS[line.fulfillmentMethod],
        appearanceLabel: null,
        eventId: null,
        processingFeePayer: "vendor",
        available: false,
        unavailableReason: "The selected fulfillment option is no longer offered — please choose another.",
        availableFulfillmentOptions: optionsForProduct(product.id),
      } as CartLineQuote);
      continue;
    }

    const appearance = line.appearanceId ? appearanceById.get(line.appearanceId) : null;
    const unitPrice = product.price ?? 0;
    const quantity = baseQuote.quantity ?? 1;
    const lineMerchandiseTotal = round2(unitPrice * quantity);
    const fulfillmentAmount = matchedOption.price;
    const { percent: marketplaceFeePercent, source: appliedFeeSource } = resolveMarketplaceFeePercent(
      business,
      product
    );
    const marketplaceFeeAmount = round2(lineMerchandiseTotal * (marketplaceFeePercent / 100));
    const processingFeePayer = resolveProcessingFeePayer(business, product);
    const vendorGross = round2(lineMerchandiseTotal + fulfillmentAmount);
    const eventId = appearance?.event_id ?? null;

    const appearanceLabel = appearance
      ? `${appearance.venue_name ?? appearance.title} — ${formatDateRange(appearance.start_at, appearance.end_at)}`
      : null;

    quoteLines.push({
      lineId: line.lineId,
      productId: product.id,
      productName: product.name,
      productSlug: product.slug,
      imageUrl: product.image_url,
      businessId: business.id,
      businessName: business.name,
      businessSlug: business.slug,
      quantity,
      unitPrice,
      lineMerchandiseTotal,
      fulfillmentMethod: line.fulfillmentMethod,
      fulfillmentAmount,
      fulfillmentLabel:
        line.fulfillmentMethod === "event_pickup" && appearanceLabel
          ? `Pickup at ${appearanceLabel}`
          : FULFILLMENT_LABELS[line.fulfillmentMethod],
      appearanceId: line.appearanceId ?? null,
      appearanceLabel,
      eventId,
      processingFeePayer,
      sourceChannel: line.sourceChannel ?? null,
      available: true,
      availableFulfillmentOptions: optionsForProduct(product.id),
    });

    computedItems.push({
      lineId: line.lineId,
      productId: product.id,
      productName: product.name,
      productSlug: product.slug,
      imageUrl: product.image_url,
      businessId: business.id,
      businessName: business.name,
      businessSlug: business.slug,
      unitPrice,
      quantity,
      lineMerchandiseTotal,
      fulfillmentMethod: line.fulfillmentMethod,
      fulfillmentAmount,
      fulfillmentLabel:
        line.fulfillmentMethod === "event_pickup" && appearanceLabel
          ? `Pickup at ${appearanceLabel}`
          : FULFILLMENT_LABELS[line.fulfillmentMethod],
      appearanceId: line.appearanceId ?? null,
      appearanceLabel,
      eventId,
      marketplaceFeePercent,
      marketplaceFeeAmount,
      appliedFeeSource,
      processingFeePayer,
      allocatedProcessingFeeAmount: 0, // filled in below, after the order total is known
      vendorGross,
      vendorNet: 0, // filled in below
      sourceChannel: line.sourceChannel ?? null,
      fulfillmentStatus: "unfulfilled",
    });
  }

  const merchandiseSubtotal = round2(quoteLines.filter((l) => l.available).reduce((s, l) => s + l.lineMerchandiseTotal, 0));
  const fulfillmentTotal = round2(quoteLines.filter((l) => l.available).reduce((s, l) => s + l.fulfillmentAmount, 0));
  const baseTotal = round2(merchandiseSubtotal + fulfillmentTotal);

  // One blended processing fee for the whole payment, estimated on the
  // base total (see lib/commerce/fees.ts) and allocated proportionally by
  // chargeable value (Part 24) — items whose processing_fee_payer is
  // "customer" turn their share into a visible surcharge instead of a
  // deduction from that vendor's net. Reconciled to Stripe's real fee by
  // the webhook once payment completes.
  const estimatedFee = baseTotal > 0 ? estimateProcessingFee(baseTotal) : 0;
  const allocationInput = computedItems.map((i) => ({
    id: i.lineId,
    chargeableValue: i.vendorGross,
  }));
  const allocation = allocateProportionally(allocationInput, estimatedFee);

  let customerProcessingFeeTotal = 0;
  for (const item of computedItems) {
    const share = allocation.get(item.lineId) ?? 0;
    if (item.processingFeePayer === "customer") {
      item.allocatedProcessingFeeAmount = share;
      customerProcessingFeeTotal = round2(customerProcessingFeeTotal + share);
      item.vendorNet = round2(item.vendorGross - item.marketplaceFeeAmount);
    } else {
      item.allocatedProcessingFeeAmount = share;
      item.vendorNet = round2(item.vendorGross - item.marketplaceFeeAmount - share);
    }
  }

  const total = round2(baseTotal + customerProcessingFeeTotal);

  return {
    quote: {
      lines: quoteLines,
      merchandiseSubtotal,
      fulfillmentTotal,
      customerProcessingFeeTotal,
      total,
      hasUnavailable: quoteLines.some((l) => !l.available),
    },
    items: computedItems,
  };
}
