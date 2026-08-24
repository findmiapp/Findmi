/**
 * Founder Form Manager — resolution layer. Tally remains the form engine;
 * /admin/forms only lets the founder point FindMi's existing form-driven
 * actions at a configured Tally URL, with per-entity overrides, without a
 * code change. Every resolver here follows the same shape:
 *
 *   assigned form (most specific entity) -> ... -> global default form
 *   -> existing behavior (env var / direct URL field) -> unavailable
 *
 * and never trusts anything here for payment/security decisions — that
 * stays server-side elsewhere (see /api/webhooks/tally).
 */
import { getSupabase } from "./supabase";
import { getInquiryFormUrl, getOnboardingFormUrl } from "./tally";
import type { FindmiForm, FormEntityType, FormPurpose } from "./types";

export const FORM_PURPOSES: FormPurpose[] = [
  "vendor_onboarding",
  "business_inquiry",
  "product_inquiry",
  "booking",
  "rsvp",
  "vendor_application",
  "contact_organizer",
];

export const FORM_PURPOSE_LABELS: Record<FormPurpose, string> = {
  vendor_onboarding: "Vendor Onboarding",
  business_inquiry: "Business Inquiry",
  product_inquiry: "Product Inquiry",
  booking: "Booking",
  rsvp: "RSVP",
  vendor_application: "Vendor Application",
  contact_organizer: "Contact Organizer",
};

export interface ResolvedForm {
  url: string;
  displayMode: "embed" | "external";
  /** null when this came from the legacy env-var fallback, not a real
   * Form Manager record — nothing else needs to key off it today, but
   * keeping it distinguishable costs nothing. */
  formId: string | null;
}

type Supabase = NonNullable<ReturnType<typeof getSupabase>>;

async function getAssignedForm(
  supabase: Supabase,
  entityType: FormEntityType,
  entityId: string,
  purpose: FormPurpose
): Promise<FindmiForm | null> {
  const { data: assignment } = await supabase
    .from("form_assignments")
    .select("form_id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("purpose", purpose)
    .maybeSingle();
  if (!assignment) return null;

  const { data: form } = await supabase
    .from("forms")
    .select("*")
    .eq("id", assignment.form_id)
    .eq("is_active", true)
    .maybeSingle();
  return form ?? null;
}

async function getDefaultForm(supabase: Supabase, purpose: FormPurpose): Promise<FindmiForm | null> {
  const { data } = await supabase
    .from("forms")
    .select("*")
    .eq("purpose", purpose)
    .eq("is_default", true)
    .eq("is_active", true)
    .maybeSingle();
  return data ?? null;
}

function appendParams(base: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${qs}`;
}

function toResolvedForm(form: FindmiForm, params: Record<string, string>): ResolvedForm {
  return { url: appendParams(form.form_url, params), displayMode: form.display_mode, formId: form.id };
}

/**
 * Business "Book / Inquire" — a business can point its own button at
 * either a booking-specific or a general-inquiry form (both purposes are
 * checked at the business tier, then again as global defaults) before
 * falling back to the legacy NEXT_PUBLIC_TALLY_INQUIRY_URL env var.
 */
export async function resolveBusinessInquiryForm(
  business: { id: string; name: string; slug: string },
  product?: { id: string; name: string }
): Promise<ResolvedForm | null> {
  const supabase = getSupabase();
  const params = {
    business_id: business.id,
    business_name: business.name,
    business_slug: business.slug,
    source: product ? "findmi_product" : "findmi_profile",
    ...(product ? { product_id: product.id, product_name: product.name } : {}),
  };

  if (supabase) {
    const form =
      (await getAssignedForm(supabase, "business", business.id, "booking")) ??
      (await getAssignedForm(supabase, "business", business.id, "business_inquiry")) ??
      (await getDefaultForm(supabase, "booking")) ??
      (await getDefaultForm(supabase, "business_inquiry"));
    if (form) return toResolvedForm(form, params);
  }

  const envUrl = getInquiryFormUrl(business, product);
  return envUrl ? { url: envUrl, displayMode: "external", formId: null } : null;
}

/**
 * Product inquiry (non-purchasable products) — product-specific form,
 * then the business's own inquiry form, then either purpose's global
 * default, then the legacy env fallback. Purchasable products never call
 * this — they use Add to Cart.
 */
export async function resolveProductInquiryForm(
  product: { id: string; name: string },
  business: { id: string; name: string; slug: string }
): Promise<ResolvedForm | null> {
  const supabase = getSupabase();
  const params = {
    business_id: business.id,
    business_name: business.name,
    business_slug: business.slug,
    product_id: product.id,
    product_name: product.name,
    source: "findmi_product",
  };

  if (supabase) {
    const form =
      (await getAssignedForm(supabase, "product", product.id, "product_inquiry")) ??
      (await getAssignedForm(supabase, "business", business.id, "business_inquiry")) ??
      (await getDefaultForm(supabase, "product_inquiry")) ??
      (await getDefaultForm(supabase, "business_inquiry"));
    if (form) return toResolvedForm(form, params);
  }

  const envUrl = getInquiryFormUrl(business, product);
  return envUrl ? { url: envUrl, displayMode: "external", formId: null } : null;
}

/**
 * Event actions (RSVP / Apply to Vend / Contact Organizer). Precedence is
 * deliberately different from the others: an already-configured direct
 * URL on the event itself (the existing architecture) outranks the
 * purpose's global default — only an explicit per-event Form Manager
 * assignment overrides it. `directUrl` is whatever the event's own
 * existing field already resolved to (rsvp_url, vendor_application_url,
 * contact_url/mailto) — untouched by this pass.
 */
export async function resolveEventActionForm(
  purpose: "rsvp" | "vendor_application" | "contact_organizer",
  event: { id: string; name: string },
  directUrl?: string | null
): Promise<ResolvedForm | null> {
  const supabase = getSupabase();
  const params = { event_id: event.id, event_name: event.name, source: `findmi_event_${purpose}` };

  if (supabase) {
    const assigned = await getAssignedForm(supabase, "event", event.id, purpose);
    if (assigned) return toResolvedForm(assigned, params);
  }

  if (directUrl) return { url: directUrl, displayMode: "external", formId: null };

  if (supabase) {
    const def = await getDefaultForm(supabase, purpose);
    if (def) return toResolvedForm(def, params);
  }

  return null;
}

/** A resolved vendor-onboarding URL must be a genuine absolute http(s)
 * URL — never something a browser could mis-resolve as a path relative to
 * findmi.app. Guards the paid-member success page's onboarding CTA
 * against ANY bad value reaching it as a clickable href, regardless of
 * where that value came from (a malformed Form Manager row, a broken
 * NEXT_PUBLIC_TALLY_ONBOARDING_URL, or anything else) — fails safe (no
 * CTA rendered) instead. Deliberately never logs the value itself, in
 * case it turns out to be a credential rather than an ordinary bad URL. */
function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Hostname only, for diagnostics — never logs the full URL (which carries
 * membership_id) or a value that fails to parse as a URL at all (which is
 * exactly the failure case this is watching for, so it must never echo
 * that raw value into logs either, in case it's a credential). */
function safeHostname(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

/**
 * Vendor onboarding — global only (no per-business/event assignment; see
 * CLAUDE.md's onboarding pass). Falls back to the existing
 * NEXT_PUBLIC_TALLY_ONBOARDING_URL env var — membership/payment/
 * publication logic and the intake webhook's server-side validation are
 * completely unchanged by this; this only selects which URL opens.
 *
 * `context` is a log label only ("ssr" | "poll", see /join/success's two
 * callers) — it changes nothing about resolution, it just lets a
 * diagnostic line be traced back to which of the two paid-success code
 * paths produced it.
 */
export async function resolveOnboardingForm(
  membership?: Parameters<typeof getOnboardingFormUrl>[0],
  context = "unknown"
): Promise<ResolvedForm | null> {
  const supabase = getSupabase();

  if (supabase) {
    const form = await getDefaultForm(supabase, "vendor_onboarding");
    if (form) {
      const params = membership
        ? {
            membership_id: membership.id,
            source: membership.source,
            ...(membership.planSlug ? { plan: membership.planSlug } : {}),
            ...(membership.existingBusinessId ? { existing_business_id: membership.existingBusinessId } : {}),
          }
        : {};
      const resolved = toResolvedForm(form, params);
      const ok = isAbsoluteHttpUrl(resolved.url);
      console.log("[resolveOnboardingForm]", {
        context,
        branch: "DB_FORM",
        formId: form.id,
        formSlug: form.slug,
        formUrlHost: safeHostname(form.form_url),
        resolvedHost: ok ? safeHostname(resolved.url) : null,
        absolute: ok,
        hrefLength: resolved.url.length,
      });
      if (ok) return resolved;
      console.error(
        "[resolveOnboardingForm] Form Manager vendor_onboarding row resolved to a non-absolute URL — refusing to render it",
        { context, formId: form.id }
      );
      return null;
    }
  }

  const envUrl = getOnboardingFormUrl(membership);
  if (!envUrl) {
    console.log("[resolveOnboardingForm]", { context, branch: "NONE" });
    return null;
  }
  const ok = isAbsoluteHttpUrl(envUrl);
  console.log("[resolveOnboardingForm]", {
    context,
    branch: "ENV_FALLBACK",
    resolvedHost: ok ? safeHostname(envUrl) : null,
    absolute: ok,
    hrefLength: envUrl.length,
  });
  if (!ok) {
    console.error(
      "[resolveOnboardingForm] NEXT_PUBLIC_TALLY_ONBOARDING_URL resolved to a non-absolute URL — refusing to render it",
      { context }
    );
    return null;
  }
  return { url: envUrl, displayMode: "external", formId: null };
}
