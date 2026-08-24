/**
 * Centralized helpers for building Tally form URLs with hidden fields
 * pre-filled. Keep every Tally URL construction going through here so the
 * hidden-field contract stays in one place.
 */

const INQUIRY_BASE = process.env.NEXT_PUBLIC_TALLY_INQUIRY_URL ?? "";

// .env.example ships NEXT_PUBLIC_TALLY_ONBOARDING_URL with this exact
// placeholder value. If a deployment goes live without ever replacing it,
// treat it identically to "unset" rather than sending a paying customer to
// a Tally form that doesn't exist (see /join/success's safe fallback).
const ONBOARDING_PLACEHOLDER = "https://tally.so/r/your-onboarding-form-id";
const ONBOARDING_BASE = ((): string => {
  const raw = (process.env.NEXT_PUBLIC_TALLY_ONBOARDING_URL ?? "").trim();
  return raw === ONBOARDING_PLACEHOLDER ? "" : raw;
})();

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

/**
 * The one vendor onboarding/intake Tally form, used by both membership
 * paths (see CLAUDE.md's onboarding pass): a paid brand lands here right
 * after checkout (source=paid), and a founder-invited comped vendor gets
 * the same URL pre-filled with their own membership_id (source=invited).
 * membership_id is always required server-side by the intake webhook —
 * see /api/webhooks/tally — so a submission can never be trusted to
 * self-report its own plan/payment status.
 *
 * Required hidden fields to configure on the Tally form (Settings ->
 * Hidden fields), matching these param keys exactly: membership_id,
 * source, existing_business_id, plan.
 */
export function getOnboardingFormUrl(membership?: {
  id: string;
  source: "paid" | "invited";
  planSlug?: string | null;
  existingBusinessId?: string | null;
}): string {
  if (!ONBOARDING_BASE) return "";
  if (!membership) return ONBOARDING_BASE;
  const params = new URLSearchParams({
    membership_id: membership.id,
    source: membership.source,
    ...(membership.planSlug ? { plan: membership.planSlug } : {}),
    ...(membership.existingBusinessId ? { existing_business_id: membership.existingBusinessId } : {}),
  });
  const separator = ONBOARDING_BASE.includes("?") ? "&" : "?";
  return `${ONBOARDING_BASE}${separator}${params.toString()}`;
}
