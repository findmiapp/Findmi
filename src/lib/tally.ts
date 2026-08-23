/**
 * Centralized helpers for building Tally form URLs with hidden fields
 * pre-filled. Keep every Tally URL construction going through here so the
 * hidden-field contract stays in one place.
 */

const INQUIRY_BASE = process.env.NEXT_PUBLIC_TALLY_INQUIRY_URL ?? "";
const ONBOARDING_BASE = process.env.NEXT_PUBLIC_TALLY_ONBOARDING_URL ?? "";

/**
 * Builds the consumer "Book / Inquire" Tally URL for a specific business,
 * passing business_id, business_name, business_slug and source as hidden
 * fields (Tally reads query params matching a hidden field's key). An
 * optional product adds product_id/product_name so an inquiry started from
 * a product page still routes to the one Tally form Findmi has today —
 * there's no separate per-product form, just added context on the same one.
 */
export function getInquiryFormUrl(
  business: { id: string; name: string; slug: string },
  product?: { id: string; name: string }
): string {
  if (!INQUIRY_BASE) return "";
  const params = new URLSearchParams({
    business_id: business.id,
    business_name: business.name,
    business_slug: business.slug,
    source: product ? "findmi_product" : "findmi_profile",
    ...(product ? { product_id: product.id, product_name: product.name } : {}),
  });
  const separator = INQUIRY_BASE.includes("?") ? "&" : "?";
  return `${INQUIRY_BASE}${separator}${params.toString()}`;
}

/** The vendor onboarding form shown after a successful Founding Membership payment. */
export function getOnboardingFormUrl(): string {
  return ONBOARDING_BASE;
}
