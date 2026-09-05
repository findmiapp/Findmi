"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";
import { validateCustomDestination } from "@/lib/navigation";
import { isSlugTaken } from "@/lib/admin/queries";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { getBusinessMarketLimit } from "@/lib/entitlements";

/**
 * Tabbed Business Edit pass — every save action below that's scoped to
 * one specific tab (?tab=<key> on /admin/businesses/[id]) must redirect
 * back to that SAME tab on both success and error, never resetting the
 * founder to a different section. errorRedirectUrl always joins with a
 * bare "?", which breaks once the base URL already has its own query
 * string (a tab-scoped editPath); this merges correctly with "&"
 * whenever `base` already contains "?", via URLSearchParams (which also
 * handles encoding). Same helper/reasoning as the public Business
 * Manager's own appendQuery (account/business/actions.ts) — duplicated
 * locally rather than shared across the admin/public boundary, same as
 * this file's other small helpers.
 */
function appendQuery(base: string, params: Record<string, string>): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${new URLSearchParams(params).toString()}`;
}

export async function saveBusiness(id: string | null, formData: FormData) {
  const editPath = id ? `/admin/businesses/${id}` : "/admin/businesses/new";
  const supabase = await requireAdminSupabase();

  const name = str(formData, "name");
  if (!name) {
    redirect(errorRedirectUrl(editPath, "Name is required."));
  }

  // Slug safety can't depend on the client-side auto-fill having actually
  // run: normalize whatever was submitted, fall back to generating one
  // from the name if it's blank, then resolve any collision with a
  // deterministic -2/-3 suffix — never a blank or colliding slug.
  const baseSlug = resolveSlugInput(str(formData, "slug"), name);
  if (!baseSlug) {
    redirect(errorRedirectUrl(editPath, "Name is required to generate a slug."));
  }
  const slug = await ensureUniqueSlug(baseSlug, (candidate) =>
    isSlugTaken("businesses", candidate, id ?? undefined)
  );

  // Announcement link — optional, but if the founder entered something it
  // has to be a safe destination. Same internal/external validation
  // nav_items' Custom Link already uses (an internal /path, or a full
  // https:// URL) — never javascript:/data:/etc., never an admin path.
  const bulletinUrlRaw = str(formData, "bulletin_url");
  let bulletin_url: string | null = null;
  if (bulletinUrlRaw) {
    const result = validateCustomDestination(bulletinUrlRaw);
    if (!result.ok) redirect(errorRedirectUrl(editPath, `Announcement link: ${result.error}`));
    bulletin_url = result.value;
  }

  const payload = {
    name,
    slug,
    short_description: str(formData, "short_description"),
    description: str(formData, "description"),
    logo_url: str(formData, "logo_url"),
    cover_image_url: str(formData, "cover_image_url"),
    website_url: str(formData, "website_url"),
    instagram_url: str(formData, "instagram_url"),
    facebook_url: str(formData, "facebook_url"),
    tiktok_url: str(formData, "tiktok_url"),
    email: str(formData, "email"),
    phone: str(formData, "phone"),
    city: str(formData, "city"),
    state: str(formData, "state"),
    country: str(formData, "country") ?? "US",
    service_radius_miles: num(formData, "service_radius_miles"),
    verified: bool(formData, "verified"),
    founding_member: bool(formData, "founding_member"),
    is_featured: bool(formData, "is_featured"),
    membership_status: str(formData, "membership_status") ?? "lead",
    plan_tier: str(formData, "plan_tier") ?? "free",
    // Plan Entitlement Provenance (Pass 1) — all optional, str() already
    // resolves a blank/unselected field to null, so leaving every one of
    // these unset is a completely valid save (never required to save an
    // existing business — see this pass's own instruction).
    plan_source: str(formData, "plan_source"),
    plan_started_at: str(formData, "plan_started_at"),
    plan_expires_at: str(formData, "plan_expires_at"),
    plan_payment_reference: str(formData, "plan_payment_reference"),
    lead_status: str(formData, "lead_status") ?? "new",
    // Native Moderation Consolidation pass — THE moderation/discovery
    // gate every public query filters on (together with is_demo below).
    // Defaults to 'live' only because that's this column's own existing
    // DB default for a brand-new admin-created business (unchanged
    // behavior for the founder's own creation flow) — BusinessForm's own
    // Listing Status field always submits a real value for every save,
    // this is just the fallback if that field were somehow missing.
    publication_status: str(formData, "publication_status") ?? "live",
    // Framed to the founder as "Real Business" — is_demo is the inverse.
    // A SEPARATE concept from publication_status above: this is demo/
    // test-content exclusion, not moderation approval.
    is_demo: !bool(formData, "published"),
    commerce_enabled: bool(formData, "commerce_enabled"),
    marketplace_fee_percent: num(formData, "marketplace_fee_percent") ?? 5,
    processing_fee_payer: str(formData, "processing_fee_payer") ?? "vendor",
    payout_method: str(formData, "payout_method") ?? "manual",
    // Business Profile V2 polish pass, item 4/5.
    inquiry_cta_label: str(formData, "inquiry_cta_label"),
    inquiry_cta_url: str(formData, "inquiry_cta_url"),
    cta_1_label: str(formData, "cta_1_label"),
    cta_1_url: str(formData, "cta_1_url"),
    cta_1_enabled: bool(formData, "cta_1_enabled"),
    cta_2_label: str(formData, "cta_2_label"),
    cta_2_url: str(formData, "cta_2_url"),
    cta_2_enabled: bool(formData, "cta_2_enabled"),
    cta_3_label: str(formData, "cta_3_label"),
    cta_3_url: str(formData, "cta_3_url"),
    cta_3_enabled: bool(formData, "cta_3_enabled"),
    // Final refinement pass, item 4; label/url added in the Business
    // Profile polish pass. bulletin_url was already validated above.
    bulletin_enabled: bool(formData, "bulletin_enabled"),
    bulletin_label: str(formData, "bulletin_label"),
    bulletin_heading: str(formData, "bulletin_heading"),
    bulletin_body: str(formData, "bulletin_body"),
    bulletin_url,
  };

  let businessId = id;
  if (businessId) {
    const { error } = await supabase.from("businesses").update(payload).eq("id", businessId);
    if (error) redirect(errorRedirectUrl(editPath, error.message));
  } else {
    const { data, error } = await supabase
      .from("businesses")
      .insert(payload)
      .select("id")
      .single();
    if (error || !data) {
      redirect(errorRedirectUrl(editPath, error?.message ?? "Could not create business."));
    }
    businessId = data.id;
  }

  const categoryIds = formData.getAll("category_ids").map(String);
  await supabase.from("business_categories").delete().eq("business_id", businessId);
  if (categoryIds.length > 0) {
    await supabase
      .from("business_categories")
      .insert(categoryIds.map((category_id) => ({ business_id: businessId, category_id })));
  }

  // Business Profile V2 — gallery is current-config, not economic/
  // historical data (nothing else references a specific row), so it's
  // simply replaced wholesale on every save: delete existing rows,
  // reinsert the submitted list in its current (already-reordered) DOM
  // order. Same reasoning already used for event_images/product
  // fulfillment options.
  const galleryUrls = formData.getAll("gallery_image_url").map(String).filter(Boolean);
  await supabase.from("business_images").delete().eq("business_id", businessId);
  if (galleryUrls.length > 0) {
    await supabase
      .from("business_images")
      .insert(galleryUrls.map((url, i) => ({ business_id: businessId, url, display_order: i })));
  }

  // People roster (business_people) — reverse of savePerson's business
  // roster below: business_id fixed, person_id varies. "Remove" here only
  // deletes the one relationship row for THIS business; the person's own
  // profile (and their other business relationships) is untouched.
  const personIds = formData.getAll("person_id").map(String);
  const removedPersonIds = formData.getAll("removed_person_id").map(String);

  const peopleToUpsert = personIds.map((personId) => ({
    business_id: businessId as string,
    person_id: personId,
    role: str(formData, `role_${personId}`),
    display_order: num(formData, `display_order_${personId}`),
    featured: bool(formData, `featured_${personId}`),
    show_on_business: bool(formData, `show_on_business_${personId}`),
  }));
  if (peopleToUpsert.length > 0) {
    await supabase.from("business_people").upsert(peopleToUpsert, { onConflict: "business_id,person_id" });
  }
  if (removedPersonIds.length > 0) {
    await supabase.from("business_people").delete().eq("business_id", businessId).in("person_id", removedPersonIds);
  }

  revalidatePath("/admin/businesses");
  // The exact page this redirects back to — missing before, which meant
  // Next's client router cache could keep serving the pre-save (or a
  // stale notFound()) RSC payload for this same URL after a redirect,
  // even though the write itself had already succeeded — same bug class
  // already fixed for saveEvent (see events/actions.ts's own editPath
  // revalidation, with the identical comment this one mirrors).
  revalidatePath(editPath);
  revalidatePath(`/business/${slug}`);
  revalidatePath("/");
  revalidatePath("/businesses");

  // A person's own public profile also shows the businesses they're
  // attached to (see lib/data.ts's getBusinessesForPerson) — so anyone
  // added to or removed from this roster needs their profile refreshed
  // too, not just this business's page.
  const affectedPersonIds = [...new Set([...personIds, ...removedPersonIds])];
  if (affectedPersonIds.length > 0) {
    const { data: affectedPeople } = await supabase.from("people").select("slug").in("id", affectedPersonIds);
    for (const p of affectedPeople ?? []) revalidatePath(`/people/${p.slug}`);
  }

  redirect(`/admin/businesses/${businessId}?saved=1`);
}

// ── Tabbed Business Edit — per-section saves ─────────────────────────────
//
// EDITING an existing business (/admin/businesses/[id]) is now tab-based
// (see that page). saveBusiness above stays completely untouched and is
// still the ONLY action /admin/businesses/new uses — creating a business
// is a one-shot flow where a single all-fields form is still correct.
// These six actions are split out of that same field set purely for the
// EDIT experience, so saving one tab never resubmits or overwrites
// another: each one only ever reads/writes its own column set, and each
// redirects back to its OWN tab. Every validation rule saveBusiness
// already had for its slice of fields (slug normalization/uniqueness,
// announcement link safety) is preserved exactly, just distributed.

/** Profile tab — identity/branding/about/location/contact/announcement/
 * CTAs/people roster. Slug safety is identical to saveBusiness: normalize
 * whatever was submitted, fall back to generating one from the name if
 * blank, then resolve any collision with a deterministic suffix. */
export async function saveBusinessProfile(id: string, formData: FormData) {
  const editPath = `/admin/businesses/${id}?tab=profile`;
  const supabase = await requireAdminSupabase();

  const name = str(formData, "name");
  if (!name) redirect(appendQuery(editPath, { error: "Name is required." }));

  const baseSlug = resolveSlugInput(str(formData, "slug"), name);
  if (!baseSlug) redirect(appendQuery(editPath, { error: "Name is required to generate a slug." }));
  const slug = await ensureUniqueSlug(baseSlug, (candidate) => isSlugTaken("businesses", candidate, id));

  // Announcement link — optional, but if the founder entered something it
  // has to be a safe destination. Same internal/external validation
  // nav_items' Custom Link already uses.
  const bulletinUrlRaw = str(formData, "bulletin_url");
  let bulletin_url: string | null = null;
  if (bulletinUrlRaw) {
    const result = validateCustomDestination(bulletinUrlRaw);
    if (!result.ok) redirect(appendQuery(editPath, { error: `Announcement link: ${result.error}` }));
    bulletin_url = result.value;
  }

  const payload = {
    name,
    slug,
    short_description: str(formData, "short_description"),
    description: str(formData, "description"),
    logo_url: str(formData, "logo_url"),
    cover_image_url: str(formData, "cover_image_url"),
    website_url: str(formData, "website_url"),
    instagram_url: str(formData, "instagram_url"),
    facebook_url: str(formData, "facebook_url"),
    tiktok_url: str(formData, "tiktok_url"),
    email: str(formData, "email"),
    phone: str(formData, "phone"),
    city: str(formData, "city"),
    state: str(formData, "state"),
    country: str(formData, "country") ?? "US",
    service_radius_miles: num(formData, "service_radius_miles"),
    inquiry_cta_label: str(formData, "inquiry_cta_label"),
    inquiry_cta_url: str(formData, "inquiry_cta_url"),
    cta_1_label: str(formData, "cta_1_label"),
    cta_1_url: str(formData, "cta_1_url"),
    cta_1_enabled: bool(formData, "cta_1_enabled"),
    cta_2_label: str(formData, "cta_2_label"),
    cta_2_url: str(formData, "cta_2_url"),
    cta_2_enabled: bool(formData, "cta_2_enabled"),
    cta_3_label: str(formData, "cta_3_label"),
    cta_3_url: str(formData, "cta_3_url"),
    cta_3_enabled: bool(formData, "cta_3_enabled"),
    bulletin_enabled: bool(formData, "bulletin_enabled"),
    bulletin_label: str(formData, "bulletin_label"),
    bulletin_heading: str(formData, "bulletin_heading"),
    bulletin_body: str(formData, "bulletin_body"),
    bulletin_url,
  };

  const { error } = await supabase.from("businesses").update(payload).eq("id", id);
  if (error) redirect(appendQuery(editPath, { error: error.message }));

  // People roster (business_people) — same upsert/remove shape saveBusiness
  // already used: "Remove" only deletes the one relationship row for THIS
  // business; the person's own profile (and their other business
  // relationships) is untouched.
  const personIds = formData.getAll("person_id").map(String);
  const removedPersonIds = formData.getAll("removed_person_id").map(String);

  const peopleToUpsert = personIds.map((personId) => ({
    business_id: id,
    person_id: personId,
    role: str(formData, `role_${personId}`),
    display_order: num(formData, `display_order_${personId}`),
    featured: bool(formData, `featured_${personId}`),
    show_on_business: bool(formData, `show_on_business_${personId}`),
  }));
  if (peopleToUpsert.length > 0) {
    await supabase.from("business_people").upsert(peopleToUpsert, { onConflict: "business_id,person_id" });
  }
  if (removedPersonIds.length > 0) {
    await supabase.from("business_people").delete().eq("business_id", id).in("person_id", removedPersonIds);
  }

  revalidatePath("/admin/businesses");
  revalidatePath(editPath);
  revalidatePath(`/business/${slug}`);
  revalidatePath("/");
  revalidatePath("/businesses");

  // A person's own public profile also shows the businesses they're
  // attached to — anyone added to or removed from this roster needs
  // their profile refreshed too, not just this business's page.
  const affectedPersonIds = [...new Set([...personIds, ...removedPersonIds])];
  if (affectedPersonIds.length > 0) {
    const { data: affectedPeople } = await supabase.from("people").select("slug").in("id", affectedPersonIds);
    for (const p of affectedPeople ?? []) revalidatePath(`/people/${p.slug}`);
  }

  redirect(appendQuery(editPath, { saved: "1" }));
}

/** Gallery tab — same "current config, not economic history" wholesale
 * replace saveBusiness already used for business_images. */
export async function saveBusinessGallery(id: string, formData: FormData) {
  const editPath = `/admin/businesses/${id}?tab=gallery`;
  const supabase = await requireAdminSupabase();

  const galleryUrls = formData.getAll("gallery_image_url").map(String).filter(Boolean);
  await supabase.from("business_images").delete().eq("business_id", id);
  if (galleryUrls.length > 0) {
    await supabase
      .from("business_images")
      .insert(galleryUrls.map((url, i) => ({ business_id: id, url, display_order: i })));
  }

  const { data: business } = await supabase.from("businesses").select("slug").eq("id", id).maybeSingle();
  revalidatePath(editPath);
  if (business?.slug) revalidatePath(`/business/${business.slug}`);
  redirect(appendQuery(editPath, { saved: "1" }));
}

/** Categories tab — admin's own multi-category model (business_categories),
 * unrelated to the owner-facing single-category set_business_category()
 * RPC — admin has always allowed several categories per business. */
export async function saveBusinessCategories(id: string, formData: FormData) {
  const editPath = `/admin/businesses/${id}?tab=categories`;
  const supabase = await requireAdminSupabase();

  const categoryIds = formData.getAll("category_ids").map(String);
  await supabase.from("business_categories").delete().eq("business_id", id);
  if (categoryIds.length > 0) {
    await supabase
      .from("business_categories")
      .insert(categoryIds.map((category_id) => ({ business_id: id, category_id })));
  }

  const { data: business } = await supabase.from("businesses").select("slug").eq("id", id).maybeSingle();
  revalidatePath(editPath);
  if (business?.slug) revalidatePath(`/business/${business.slug}`);
  redirect(appendQuery(editPath, { saved: "1" }));
}

/** Plan tab — Plan Tier + entitlement provenance fields only. Never
 * touches publication_status/is_demo (Moderation tab) or Free/Pro
 * columns the member-facing editor also writes — this is the ONE place
 * plan_tier itself changes admin-side, same as before this pass. */
export async function saveBusinessPlan(id: string, formData: FormData) {
  const editPath = `/admin/businesses/${id}?tab=plan`;
  const supabase = await requireAdminSupabase();

  const payload = {
    plan_tier: str(formData, "plan_tier") ?? "free",
    plan_source: str(formData, "plan_source"),
    plan_started_at: str(formData, "plan_started_at"),
    plan_expires_at: str(formData, "plan_expires_at"),
    plan_payment_reference: str(formData, "plan_payment_reference"),
  };

  const { error } = await supabase.from("businesses").update(payload).eq("id", id);
  if (error) redirect(appendQuery(editPath, { error: error.message }));

  revalidatePath(editPath);
  redirect(appendQuery(editPath, { saved: "1" }));
}

/** Moderation tab — THE control that approves a listing
 * (publication_status, together with is_demo/"Real Business") plus the
 * verified/founding-member/featured display badges. Never touches
 * plan_tier (Plan tab) or the CRM/commerce fields (Internal tab). */
export async function saveBusinessModeration(id: string, formData: FormData) {
  const editPath = `/admin/businesses/${id}?tab=moderation`;
  const supabase = await requireAdminSupabase();

  const payload = {
    publication_status: str(formData, "publication_status") ?? "live",
    is_demo: !bool(formData, "published"),
    verified: bool(formData, "verified"),
    founding_member: bool(formData, "founding_member"),
    is_featured: bool(formData, "is_featured"),
  };

  const { data: business, error } = await supabase
    .from("businesses")
    .update(payload)
    .eq("id", id)
    .select("slug")
    .maybeSingle();
  if (error) redirect(appendQuery(editPath, { error: error.message }));

  revalidatePath("/admin/businesses");
  revalidatePath(editPath);
  if (business?.slug) revalidatePath(`/business/${business.slug}`);
  revalidatePath("/");
  revalidatePath("/businesses");
  redirect(appendQuery(editPath, { saved: "1" }));
}

/** Internal tab — CRM status fields (Membership Status/Lead Status,
 * legacy lead-tracking unrelated to Founding Membership billing below)
 * plus commerce/payout settings. Founder-only, never rendered or
 * writable from any owner-facing surface. */
export async function saveBusinessInternal(id: string, formData: FormData) {
  const editPath = `/admin/businesses/${id}?tab=internal`;
  const supabase = await requireAdminSupabase();

  const payload = {
    membership_status: str(formData, "membership_status") ?? "lead",
    lead_status: str(formData, "lead_status") ?? "new",
    commerce_enabled: bool(formData, "commerce_enabled"),
    marketplace_fee_percent: num(formData, "marketplace_fee_percent") ?? 5,
    processing_fee_payer: str(formData, "processing_fee_payer") ?? "vendor",
    payout_method: str(formData, "payout_method") ?? "manual",
  };

  const { error } = await supabase.from("businesses").update(payload).eq("id", id);
  if (error) redirect(appendQuery(editPath, { error: error.message }));

  revalidatePath(editPath);
  redirect(appendQuery(editPath, { saved: "1" }));
}

// ── Markets (Markets Foundation V1) ──────────────────────────────────────
// Admin-only for now — no owner-facing Market editing exists yet (out of
// scope for this pass). All three actions below write business_markets
// through THIS admin/service-role client only (RLS on that table has zero
// policies for anon/authenticated — see migration business_markets), and
// every write is scoped by `.eq("business_id", businessId)` so a forged
// assignment id can never touch another business's row.
//
// "Normal" changes (no override_limit) are blocked from pushing a
// business's total ACTIVE market count above getBusinessMarketLimit() —
// the one centralized resolver (lib/entitlements.ts). override_limit is
// an explicit, visible admin checkbox for correcting legacy/data issues
// (task's own requirement) — it never bypasses the structural rules (one
// active primary, no duplicate business+market row, market must exist and
// be active for a brand-new assignment), only the numeric limit.

async function countActiveBusinessMarkets(supabase: SupabaseClient, businessId: string): Promise<number> {
  const { count } = await supabase
    .from("business_markets")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("active", true);
  return count ?? 0;
}

/** Assign/reassign this business's Primary Market. Demotes whichever
 * market was previously primary (if different) — the partial unique index
 * business_markets_one_active_primary means a naive insert/activate would
 * otherwise fail outright rather than silently double up. */
export async function assignPrimaryMarket(businessId: string, formData: FormData) {
  const editPath = `/admin/businesses/${businessId}?tab=markets`;
  const supabase = await requireAdminSupabase();

  const marketId = str(formData, "market_id");
  if (!marketId) redirect(appendQuery(editPath, { error: "Choose a market." }));

  const [{ data: business }, { data: existing }, { data: currentPrimary }] = await Promise.all([
    supabase.from("businesses").select("plan_tier").eq("id", businessId).maybeSingle(),
    supabase.from("business_markets").select("*").eq("business_id", businessId).eq("market_id", marketId!).maybeSingle(),
    supabase
      .from("business_markets")
      .select("*")
      .eq("business_id", businessId)
      .eq("relationship", "primary")
      .eq("active", true)
      .maybeSingle(),
  ]);
  if (!business) redirect(errorRedirectUrl("/admin/businesses", "Business not found."));

  const isNewAssignment = !existing;
  if (isNewAssignment) {
    const { data: market } = await supabase.from("markets").select("id, active").eq("id", marketId!).maybeSingle();
    if (!market || !market.active) {
      redirect(appendQuery(editPath, { error: "That market doesn't exist or isn't active." }));
    }
  }

  const override = bool(formData, "override_limit");
  if (!override) {
    const activeCount = await countActiveBusinessMarkets(supabase, businessId);
    const targetAlreadyActive = Boolean(existing?.active);
    const demotesAnotherPrimary = Boolean(currentPrimary && currentPrimary.market_id !== marketId);
    const prospective = activeCount - (demotesAnotherPrimary ? 1 : 0) + (targetAlreadyActive ? 0 : 1);
    const limit = getBusinessMarketLimit({ plan_tier: business.plan_tier });
    if (prospective > limit) {
      redirect(
        appendQuery(editPath, {
          error: `This plan is entitled to ${limit} active market${limit === 1 ? "" : "s"} — assigning this would exceed it. Check "Override limit" to correct this deliberately.`,
        })
      );
    }
  }

  const provenance = str(formData, "provenance");

  if (currentPrimary && currentPrimary.market_id !== marketId) {
    await supabase.from("business_markets").update({ active: false }).eq("id", currentPrimary.id);
  }

  if (existing) {
    const { error } = await supabase
      .from("business_markets")
      .update({ relationship: "primary", active: true, provenance })
      .eq("id", existing.id)
      .eq("business_id", businessId);
    if (error) redirect(appendQuery(editPath, { error: error.message }));
  } else {
    const { error } = await supabase
      .from("business_markets")
      .insert({ business_id: businessId, market_id: marketId, relationship: "primary", active: true, provenance });
    if (error) redirect(appendQuery(editPath, { error: error.message }));
  }

  revalidatePath(editPath);
  redirect(appendQuery(editPath, { saved: "1" }));
}

/** Add an Additional Market. Never touches the Primary Market row —
 * assigning a market that's already this business's active primary (or
 * already an active additional market) is rejected with a clear message
 * rather than silently reinterpreted. */
export async function addAdditionalMarket(businessId: string, formData: FormData) {
  const editPath = `/admin/businesses/${businessId}?tab=markets`;
  const supabase = await requireAdminSupabase();

  const marketId = str(formData, "market_id");
  if (!marketId) redirect(appendQuery(editPath, { error: "Choose a market." }));

  const [{ data: business }, { data: existing }] = await Promise.all([
    supabase.from("businesses").select("plan_tier").eq("id", businessId).maybeSingle(),
    supabase.from("business_markets").select("*").eq("business_id", businessId).eq("market_id", marketId!).maybeSingle(),
  ]);
  if (!business) redirect(errorRedirectUrl("/admin/businesses", "Business not found."));

  if (existing?.active) {
    redirect(
      appendQuery(editPath, {
        error:
          existing.relationship === "primary"
            ? "That market is already this business's Primary Market."
            : "That market is already an Additional Market for this business.",
      })
    );
  }

  if (!existing) {
    const { data: market } = await supabase.from("markets").select("id, active").eq("id", marketId!).maybeSingle();
    if (!market || !market.active) {
      redirect(appendQuery(editPath, { error: "That market doesn't exist or isn't active." }));
    }
  }

  const override = bool(formData, "override_limit");
  if (!override) {
    const activeCount = await countActiveBusinessMarkets(supabase, businessId);
    const limit = getBusinessMarketLimit({ plan_tier: business.plan_tier });
    if (activeCount + 1 > limit) {
      redirect(
        appendQuery(editPath, {
          error: `This plan is entitled to ${limit} active market${limit === 1 ? "" : "s"} — adding this would exceed it. Check "Override limit" to correct this deliberately.`,
        })
      );
    }
  }

  const provenance = str(formData, "provenance");

  if (existing) {
    const { error } = await supabase
      .from("business_markets")
      .update({ relationship: "additional", active: true, provenance })
      .eq("id", existing.id)
      .eq("business_id", businessId);
    if (error) redirect(appendQuery(editPath, { error: error.message }));
  } else {
    const { error } = await supabase
      .from("business_markets")
      .insert({ business_id: businessId, market_id: marketId, relationship: "additional", active: true, provenance });
    if (error) redirect(appendQuery(editPath, { error: error.message }));
  }

  revalidatePath(editPath);
  redirect(appendQuery(editPath, { saved: "1" }));
}

/** Soft-removes one assignment (active = false) rather than deleting the
 * row — preserves provenance/history for later reference, same
 * "never delete data to clean up" discipline as the rest of admin. Works
 * for either a Primary or an Additional row. */
export async function removeMarketAssignment(businessId: string, assignmentId: string) {
  const editPath = `/admin/businesses/${businessId}?tab=markets`;
  const supabase = await requireAdminSupabase();

  const { data, error } = await supabase
    .from("business_markets")
    .update({ active: false })
    .eq("id", assignmentId)
    .eq("business_id", businessId)
    .select()
    .maybeSingle();

  if (error || !data) {
    redirect(appendQuery(editPath, { error: "Couldn't remove that market assignment." }));
  }

  revalidatePath(editPath);
  redirect(appendQuery(editPath, { saved: "1" }));
}

// ── Owner/member assignment (Admin Business Owner pass) ─────────────────────
// Deliberately separate from saveBusiness above and from the claims page's
// own membership actions (src/app/admin/(protected)/claims/actions.ts,
// untouched by this pass) — same business_members table and the same
// "never touch an owner row from a generic action" guard those already
// use, just scoped to this page's own redirect target instead of
// /admin/claims. Assignment always creates a 'manager' row, never
// 'owner' — owner is a singular, structurally-enforced role
// (business_members_one_owner_per_business) already governed by the
// claim-approval and transfer_business_ownership() flows; this is a
// separate, additive way to grant access, not a way to set ownership.

/** Resolves an email to an existing FindMi account via the new
 * lookup_auth_user_id_by_email() RPC (service-role only — see its own
 * migration), then adds a 'manager' business_members row for that user.
 * Never creates a user, never touches auth.users beyond the read-only
 * lookup, and never inserts a duplicate membership (checked explicitly,
 * on top of business_members' own (user_id, business_id) uniqueness). */
export async function assignBusinessMember(businessId: string, formData: FormData) {
  const editPath = `/admin/businesses/${businessId}?tab=ownership`;
  const supabase = await requireAdminSupabase();

  const email = str(formData, "email");
  if (!email) {
    redirect(appendQuery(editPath, { error: "Enter an email address." }));
  }

  const { data: userId, error: lookupError } = await supabase.rpc("lookup_auth_user_id_by_email", {
    p_email: email,
  });
  if (lookupError) {
    redirect(appendQuery(editPath, { error: "Couldn't look up that email. Please try again." }));
  }
  if (!userId) {
    redirect(appendQuery(editPath, { error: "No FindMi account found with that email." }));
  }

  const { data: existing } = await supabase
    .from("business_members")
    .select("id")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    redirect(appendQuery(editPath, { error: "That user is already a member of this business." }));
  }

  const { error: insertError } = await supabase
    .from("business_members")
    .insert({ business_id: businessId, user_id: userId, role: "manager" });
  if (insertError) {
    redirect(appendQuery(editPath, { error: "Couldn't assign that member. Please try again." }));
  }

  revalidatePath(editPath);
  redirect(appendQuery(editPath, { member_updated: "1" }));
}

/** Removes a manager/staff member's access entirely. Same `.neq("role",
 * "owner")` guard the claims page's own removeMember() uses, so this can
 * never remove an owner even given a tampered member id — ownership only
 * ever changes via remove_business_owner()/transfer_business_ownership()
 * (claims page), untouched by this pass. Never deletes the user or the
 * business — only the one business_members row. */
export async function removeBusinessMember(businessId: string, memberId: string) {
  const editPath = `/admin/businesses/${businessId}?tab=ownership`;
  const supabase = await requireAdminSupabase();

  const { data, error } = await supabase
    .from("business_members")
    .delete()
    .eq("id", memberId)
    .eq("business_id", businessId)
    .neq("role", "owner")
    .select()
    .maybeSingle();

  if (error || !data) {
    redirect(appendQuery(editPath, { error: "Couldn't remove that member — they may no longer be a member." }));
  }

  revalidatePath(editPath);
  redirect(appendQuery(editPath, { member_updated: "1" }));
}
