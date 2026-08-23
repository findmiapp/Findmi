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
 * fields (Tally reads query params matching a hidden field's key).
 */
export function getInquiryFormUrl(business: {
  id: string;
  name: string;
  slug: string;
}): string {
  if (!INQUIRY_BASE) return "";
  const params = new URLSearchParams({
    business_id: business.id,
    business_name: business.name,
    business_slug: business.slug,
    source: "findmi_profile",
  });
  const separator = INQUIRY_BASE.includes("?") ? "&" : "?";
  return `${INQUIRY_BASE}${separator}${params.toString()}`;
}

/** The vendor onboarding form shown after a successful Founding Membership payment. */
export function getOnboardingFormUrl(): string {
  return ONBOARDING_BASE;
}
