import type { FulfillmentMethod } from "@/lib/types";

/** Marketplace shipping safety (Phase 2A): checkout does not yet collect
 * a delivery address, so methods that need one can't be fulfilled and are
 * not offered at checkout or on product pages. Vendor settings are kept;
 * removing a method from this set (once address capture exists) restores
 * them with no data change. */
export const CHECKOUT_ADDRESS_REQUIRED_METHODS: ReadonlySet<FulfillmentMethod> = new Set<FulfillmentMethod>(["shipping", "local_delivery"]);
export const ADDRESS_FULFILLMENT_UNAVAILABLE_REASON =
  "Delivery to an address isn't available at checkout yet. Choose a pickup option, or contact the business.";

export function isCheckoutSupportedMethod(method: string): boolean {
  return !CHECKOUT_ADDRESS_REQUIRED_METHODS.has(method as FulfillmentMethod);
}

