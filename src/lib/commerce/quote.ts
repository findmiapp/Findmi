import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { formatAppearanceDateRange, isAppearanceStillAvailable } from "@/lib/format";
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

export const FULFILLMENT_LABELS: Record<FulfillmentMethod, string> = {
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
 * exactly what gets charged.
 *
 * Uses the service-role client, not the public anon client — this is the
 * one legitimate reader of businesses.marketplace_fee_percent/
 * processing_fee_payer and products.marketplace_fee_override_percent/
 * processing_fee_payer_override (Security Pass 1 revoked anon/authenticated
 * SELECT on those internal columns; this function already only ever runs
 * server-side, from "use server" Server Actions, never from the browser). */
export async function computeOrderDraft(lines: CartLine[]): Promise<OrderDraft> {
  const supabase = getAdminSupabase();
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

  // Product Pickup Occurrences — Expire Past Options fix: an event_pickup
  // option whose appearance has expired (isAppearanceStillAvailable,
  // end_at falling back to start_at) is excluded from every list this
  // returns — both the cart's "change fulfillment" alternatives and the
  // matched-option lookup below, so an expired pickup can never remain
  // selectable, freshly re-checked server-side on every quote/checkout
  // call rather than trusted from the product page's own filtering.
  function optionsForProduct(productId: string) {
    return (fulfillmentOptions ?? [])
      .filter((o) => o.product_id === productId)
      .filter((o) => {
        if (o.method !== "event_pickup") return true;
        const appearance = o.appearance_id ? appearanceById.get(o.appearance_id) : null;
        return Boolean(appearance) && isAppearanceStillAvailable(appearance!);
      })
      .map((o) => {
        const appearance = o.appearance_id ? appearanceById.get(o.appearance_id) : null;
        const label =
          o.method === "event_pickup" && appearance
            ? `Pickup at ${appearance.venue_name ?? appearance.title} — ${formatAppearanceDateRange(appearance.start_at, appearance.end_at, appearance.description)}`
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

    if (
      !product ||
      !business ||
      (business as Business & { is_demo?: boolean }).is_demo ||
      business.publication_status !== "live"
    ) {
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

    // Product Pickup Occurrences — Expire Past Options fix — cart safety:
    // a cart line can be added while its pickup appearance was still
    // valid, then left open past that appearance's end_at/start_at. A
    // still-enabled product_fulfillment_options row (matchedOption above)
    // never expires on its own, so re-check the appearance's real time
    // here too, every time a quote/checkout is computed — never rely only
    // on the product page's own filtering. An expired match is treated
    // exactly like "no longer offered" above (never silently swapped to a
    // different occurrence): the line becomes unavailable, hasUnavailable
    // blocks checkout (see createOrder.ts), and availableFulfillmentOptions
    // (already expiry-filtered by optionsForProduct) is what the cart UI
    // offers as a real replacement, if one exists.
    if (matchedOption.method === "event_pickup") {
      const matchedAppearance = matchedOption.appearance_id ? appearanceById.get(matchedOption.appearance_id) : null;
      if (!matchedAppearance || !isAppearanceStillAvailable(matchedAppearance)) {
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
          eventId: matchedAppearance?.event_id ?? null,
          processingFeePayer: "vendor",
          available: false,
          unavailableReason: "This pickup date has passed — please choose another.",
          availableFulfillmentOptions: optionsForProduct(product.id),
        } as CartLineQuote);
        continue;
      }
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
      ? `${appearance.venue_name ?? appearance.title} — ${formatAppearanceDateRange(appearance.start_at, appearance.end_at, appearance.description)}`
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
      fulfillmentStatus: "new",
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
