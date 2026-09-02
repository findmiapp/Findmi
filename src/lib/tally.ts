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

// .env.example ships this exact placeholder value — treated identically to
// "unset", same reasoning as ONBOARDING_PLACEHOLDER above.
const CLAIM_PAYMENT_PLACEHOLDER = "https://tally.so/r/your-claim-payment-form-id";
const CLAIM_PAYMENT_BASE = ((): string => {
  const raw = (process.env.NEXT_PUBLIC_TALLY_CLAIM_PAYMENT_URL ?? "").trim();
  return raw === CLAIM_PAYMENT_PLACEHOLDER ? "" : raw;
})();

/**
 * The $20 claim listing-activation payment Tally form — ONE shared form
 * for both business and event claims, distinguished by claim_type, rather
 * than two separate forms (simplest setup that still cleanly associates a
 * payment with the right claim; see the claim payment pass's report for
 * why two URLs were considered and not used).
 *
 * ONLY claim_id + claim_type are ever trusted by the payment webhook
 * (/api/webhooks/tally) to resolve which pending claim a payment belongs
 * to — never full_name/email/phone, and never the claimant's email alone,
 * since a Tally submission's own field values aren't guaranteed to match
 * what FindMi already has on file. full_name/email/phone are passed
 * ONLY so the founder can configure the Tally form to skip asking for
 * them again (FindMi already collected them in the claim form itself —
 * see /api/account/claim's POST) — they carry no authority and the
 * webhook never reads them for anything.
 *
 * Required hidden fields to configure on the Tally form (Settings ->
 * Hidden fields), matching these param keys exactly: claim_id, claim_type,
 * full_name, email, phone. The visible form itself should be
 * payment-focused only — a brief note that this is the $20 listing
 * activation payment, the Payment question, and a submit button; it
 * should NOT contain separate visible Full Name / Email / Phone
 * questions, since FindMi already has that data (see this pass's report
 * for what Tally's own payment block may still require from the payer,
 * which is a different thing from a duplicate form question). The form
 * also needs a $20 USD Payment question (Tally's built-in Stripe-backed
 * payment block) — see the claim payment webhook's own comments for the
 * field-label conventions it reads to confirm a genuine paid $20
 * submission; that field-shape could not be verified against live Tally
 * documentation from this environment and MUST be confirmed with one
 * real test payment before this is relied on in production.
 */
export function getClaimPaymentFormUrl(claim: {
  id: string;
  type: "business" | "event";
  fullName: string;
  email: string;
  phone: string;
}): string {
  if (!CLAIM_PAYMENT_BASE) return "";
  const params = new URLSearchParams({
    claim_id: claim.id,
    claim_type: claim.type,
    full_name: claim.fullName,
    email: claim.email,
    phone: claim.phone,
  });
  const separator = CLAIM_PAYMENT_BASE.includes("?") ? "&" : "?";
  return `${CLAIM_PAYMENT_BASE}${separator}${params.toString()}`;
}
