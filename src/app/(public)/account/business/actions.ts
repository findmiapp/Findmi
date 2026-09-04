"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { bool, errorRedirectUrl, localDateTimeToIso, num, str } from "@/lib/admin/form-helpers";
import { requireBusinessMember } from "@/lib/permissions";
import { isBusinessPro } from "@/lib/entitlements";
import { validateImageFile } from "@/lib/imageUploadValidation";
import { validateCustomDestination } from "@/lib/navigation";
import { isProductSlugTaken, isSlugTaken } from "@/lib/admin/queries";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { createBusinessProCheckoutSession } from "@/lib/commerce/businessProCheckout";
import type { ProductPendingChanges, ProductType } from "@/lib/types";

const UPLOAD_BUCKET = "findmi-media";

/**
 * MANAGE BUSINESS — MEMBER IMAGE UPLOAD ONLY. The member-facing
 * counterpart to lib/admin/upload.ts's uploadImage() — same Storage
 * bucket and the exact same shared file-safety rules (size/HEIC/SVG/MIME/
 * magic-byte checks, via lib/imageUploadValidation.ts), but its own
 * separate authorization path. Deliberately NOT a change to uploadImage()
 * itself (still requireAdmin()-gated, untouched) and never exposed to a
 * member — this is a distinct exported function a member-facing
 * component calls directly.
 *
 * Authorization, never trusted from the client:
 *   1. requireBusinessMember(businessId) — the exact same foundation
 *      updateMemberBusiness uses — re-derives real membership from the
 *      caller's own session-scoped query against business_members. No
 *      businessId is ever trusted on its own; it only unlocks an upload
 *      once the CALLER'S real session proves they belong to that
 *      specific business. A signed-out visitor, or a signed-in user with
 *      no business_members row for this businessId, gets a friendly
 *      error and nothing is written to Storage.
 *   2. Only after that succeeds does this reach for the service-role
 *      client to perform the actual Storage write — Storage writes need
 *      elevated privileges the same way the businesses table write in
 *      updateMemberBusiness does, so this mirrors that exact authorize-
 *      then-elevate shape rather than trusting an RLS-scoped client for
 *      the upload itself.
 *
 * Returns a plain { url } / { error } result (same shape uploadImage()
 * already returns) — this function never writes to the businesses table
 * itself. The resulting URL only ever reaches logo_url/cover_image_url
 * via updateMemberBusiness's own existing, already-scoped allowlist —
 * this action's only "purpose" restriction is that its result can never
 * be used for anything besides those two fields, because nothing else in
 * updateMemberBusiness accepts a submitted URL at all.
 */
export async function uploadMemberBusinessImage(
  businessId: string,
  formData: FormData
): Promise<{ url?: string; error?: string }> {
  try {
    await requireBusinessMember(businessId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "You don't have access to this business." };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file selected." };

  const validated = await validateImageFile(file);
  if ("error" in validated) return validated;

  const admin = getAdminSupabase();
  if (!admin) return { error: "Storage isn't configured on the server." };

  // Same server-generated-path convention as uploadImage() — a random
  // UUID plus the validated extension, never anything derived from the
  // submitted filename or businessId.
  const path = `${crypto.randomUUID()}.${validated.extension}`;

  // A HEIC/HEIF upload was already converted to JPEG bytes above (see
  // validateImageFile) — upload THOSE, never the original File, with the
  // matching contentType. Every other format is uploaded exactly as
  // before, unchanged.
  const uploadBody = validated.converted?.buffer ?? file;
  const uploadContentType = validated.converted?.contentType ?? file.type;

  const { error } = await admin.storage.from(UPLOAD_BUCKET).upload(path, uploadBody, {
    contentType: uploadContentType,
    upsert: false,
  });
  if (error) return { error: error.message };

  const { data } = admin.storage.from(UPLOAD_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}

// OWNER BUSINESS MUTATION — MINIMAL FOUNDATION
//
// The minimal authenticated MEMBER-facing (owner/manager/staff via
// business_members — see lib/permissions.ts) business update action a
// future My FindMi owner workspace will call. Deliberately separate from
// the founder/admin saveBusiness (src/app/admin/(protected)/businesses/
// actions.ts), which is untouched by this file and stays the only
// unrestricted business editor.
//
// This pass establishes a secure MUTATION BOUNDARY, not full business-
// management capability. Free Business Editing Pass 3 gave Free its own
// small allowlist (name/logo/cover/short description/city/state/one
// category) — basic factual presence maintenance, not a Pro feature; Pro
// still gets everything Free gets plus PRO_ONLY_COLUMNS below (full
// description, remaining contact/socials/announcement fields, gallery).
// A fuller Pro editor (products, appearances, inquiry/lead settings,
// multi-category) still doesn't exist and is explicitly out of scope
// here.

/** Free Business Editing Pass 3 — Free's allowlist now also covers city
 * and state: locked product rule is that Free = ownership + accurate
 * basic presence, and correcting a business's basic public location
 * (city/state) is factual maintenance, not a Pro merchandising/growth
 * feature. Pro's allowlist is unaffected in shape (still
 * [...FREE_ALLOWED_COLUMNS, ...PRO_ONLY_COLUMNS] below) — city/state
 * simply moved from one constant to the other, so a Pro business can
 * still edit them exactly as before. `country` deliberately stays
 * Pro-only (see PRO_ONLY_COLUMNS) — this pass only unlocks what it was
 * explicitly asked to unlock. */
const FREE_ALLOWED_COLUMNS = ["name", "logo_url", "cover_image_url", "short_description", "city", "state"] as const;
// Pro-only additions — every one an EXISTING businesses column already
// used by the founder admin editor (BusinessForm.tsx); no new columns.
// "announcement" is the bulletin_* group admin already exposes together
// under that same label.
const PRO_ONLY_COLUMNS = [
  "description",
  "country",
  "email",
  "phone",
  "website_url",
  "instagram_url",
  "facebook_url",
  "tiktok_url",
  "bulletin_enabled",
  "bulletin_label",
  "bulletin_heading",
  "bulletin_body",
  "bulletin_url",
] as const;
const PRO_ALLOWED_COLUMNS = [...FREE_ALLOWED_COLUMNS, ...PRO_ONLY_COLUMNS] as const;

/**
 * Updates a business's basic factual fields — name, logo, cover image,
 * short description, city, state, and category — regardless of plan
 * tier (FREE_ALLOWED_COLUMNS, above); Pro additionally gets everything
 * in PRO_ONLY_COLUMNS (full description, remaining contact/social
 * links, announcement, gallery). Role (owner/manager/staff, via
 * business_members) governs WHO can call this, never WHAT plan-tier
 * fields are allowed. Every business column not in either allowlist
 * (products, appearances, inquiry/lead settings, CTAs, additional
 * categories, commerce/payout settings, verification/membership/
 * publication status, etc.) is simply never read from the submitted
 * form — there is no generic object spread into Supabase anywhere in
 * this function, only these fixed, named column lists — so a request
 * that also includes any of those fields has them silently ignored
 * rather than erroring, the same "extra form fields are just never
 * looked at" pattern every other action in this codebase already uses
 * (saveBusiness, saveEvent, updateProfile, etc.).
 *
 * Authorization is never trusted from the client:
 *   1. A real Supabase Auth session is required (redirects to /login
 *      otherwise, same as every other /account Server Action).
 *   2. requireBusinessMember(businessId) re-derives membership from the
 *      CALLER'S OWN session-scoped query against business_members — RLS
 *      already scopes that table's SELECT to `auth.uid() = user_id`, so
 *      this can only ever see (and only ever throws unless it finds) the
 *      caller's own real membership row for this exact business. No role
 *      or membership claim is ever accepted as a form field.
 *   3. Only AFTER that authorization succeeds does this switch to the
 *      service-role client (getAdminSupabase()) to read plan_tier and
 *      perform the actual write — businesses has no RLS UPDATE policy for
 *      anon/authenticated at all today (verified against the live
 *      schema — only "Public read businesses" SELECT exists), and
 *      plan_tier itself isn't in the public column-level SELECT grant
 *      (see restrict_internal_commerce_columns), so there is no way to
 *      read or act on real plan state through the RLS-scoped client in
 *      the first place. This mirrors requireAdminSupabase()'s own
 *      authorize-then-elevate shape exactly, just for a business member
 *      instead of a founder session.
 */
export async function updateMemberBusiness(businessId: string, formData: FormData) {
  const redirectPath = `/account/business/${businessId}`;

  const sessionSupabase = await getServerSupabase();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(redirectPath)}`);

  try {
    await requireBusinessMember(businessId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to this business.";
    redirect(errorRedirectUrl(redirectPath, message));
  }

  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl(redirectPath, "Server isn't configured."));

  const { data: business } = await admin
    .from("businesses")
    .select("id, slug, plan_tier")
    .eq("id", businessId)
    .maybeSingle();
  if (!business) redirect(errorRedirectUrl(redirectPath, "Business not found."));

  // Resolved here (not just for gating what already differs — see
  // PRO_ALLOWED_COLUMNS above) so the entitlement state is loaded fresh
  // from the database on every call, never assumed or cached.
  const pro = isBusinessPro(business);
  const allowedColumns = pro ? PRO_ALLOWED_COLUMNS : FREE_ALLOWED_COLUMNS;

  const name = str(formData, "name");
  if (!name) {
    redirect(errorRedirectUrl(redirectPath, "Business name is required."));
  }
  const logo_url = str(formData, "logo_url");
  const cover_image_url = str(formData, "cover_image_url");
  const short_description = str(formData, "short_description");

  // Pro-only fields — read from the submitted form regardless of tier
  // (harmless: only the columns actually named in allowedColumns below
  // ever reach the real Supabase payload), same "extra fields are simply
  // never looked at" pattern this action already documents. A Free
  // submission that manually includes these is never able to persist
  // them, because allowedColumns for Free never names them.
  const description = str(formData, "description");
  const city = str(formData, "city");
  const state = str(formData, "state");
  const country = str(formData, "country");
  const email = str(formData, "email");
  const phone = str(formData, "phone");
  const website_url = str(formData, "website_url");
  const instagram_url = str(formData, "instagram_url");
  const facebook_url = str(formData, "facebook_url");
  const tiktok_url = str(formData, "tiktok_url");
  const bulletin_enabled = bool(formData, "bulletin_enabled");
  const bulletin_label = str(formData, "bulletin_label");
  const bulletin_heading = str(formData, "bulletin_heading");
  const bulletin_body = str(formData, "bulletin_body");
  const bulletin_url = str(formData, "bulletin_url");

  // The actual UPDATE payload is built FROM allowedColumns, not just
  // gated by it — every value this action is capable of writing lives in
  // candidateValues, and only the columns named in allowedColumns are
  // ever copied out of it into the real Supabase payload. Widening
  // PRO_ALLOWED_COLUMNS automatically reaches this same construction —
  // no branching logic to duplicate, and Free's allowedColumns can never
  // pick up a Pro-only key no matter what the form submits.
  const candidateValues: Record<(typeof PRO_ALLOWED_COLUMNS)[number], string | boolean | null> = {
    name,
    logo_url,
    cover_image_url,
    short_description,
    description,
    city,
    state,
    country,
    email,
    phone,
    website_url,
    instagram_url,
    facebook_url,
    tiktok_url,
    bulletin_enabled,
    bulletin_label,
    bulletin_heading,
    bulletin_body,
    bulletin_url,
  };
  const payload = Object.fromEntries(allowedColumns.map((column) => [column, candidateValues[column]]));

  // Exactly one category, and it must be a real, existing BUSINESS-kind
  // category — never an event/product category leaking across the
  // taxonomy's own kind boundary (see lib/types.ts's CategoryKind note),
  // and never more than one: this action always replaces the business's
  // entire category set with this single row, structurally guaranteeing
  // "exactly 1 category" regardless of how many an admin may have set
  // previously.
  const categoryId = str(formData, "category_id");
  if (!categoryId) {
    redirect(errorRedirectUrl(redirectPath, "Choose a category."));
  }
  const { data: category } = await admin
    .from("categories")
    .select("id")
    .eq("id", categoryId)
    .eq("kind", "business")
    .maybeSingle();
  if (!category) {
    redirect(errorRedirectUrl(redirectPath, "That's not a valid category."));
  }

  const { error: updateError } = await admin.from("businesses").update(payload).eq("id", businessId);
  if (updateError) {
    redirect(errorRedirectUrl(redirectPath, updateError.message));
  }

  // Atomic replace — see set_business_category() in the not-yet-applied
  // migration. A plain delete-then-insert here would be two separate
  // requests: if the delete succeeded but the insert then failed, the
  // business would be left with zero categories instead of its previous
  // one. This RPC does both inside one Postgres function call, so
  // Postgres's own implicit transaction makes it atomic — success leaves
  // exactly the new category, any failure leaves the previous category
  // relationship completely untouched (the delete itself gets rolled
  // back), never a mid-write zero-category state.
  const { error: categoryError } = await admin.rpc("set_business_category", {
    p_business_id: businessId,
    p_category_id: categoryId,
  });
  if (categoryError) {
    const message =
      categoryError.message === "invalid_category"
        ? "That's not a valid category."
        : categoryError.message === "business_not_found"
          ? "Business not found."
          : categoryError.message;
    redirect(errorRedirectUrl(redirectPath, message));
  }

  // Gallery — Pro only, reusing the exact same business_images table and
  // delete-then-reinsert-on-save shape admin's saveBusiness already uses
  // (current config, not economic history — see that action's own
  // comment). Gated on the server-resolved `pro` above, never on
  // anything submitted: a Free request that includes gallery_image_url
  // fields simply never reaches this block, so no gallery row is ever
  // touched for a Free business.
  if (pro) {
    const galleryUrls = formData.getAll("gallery_image_url").map(String).filter(Boolean);
    await admin.from("business_images").delete().eq("business_id", businessId);
    if (galleryUrls.length > 0) {
      await admin
        .from("business_images")
        .insert(galleryUrls.map((url, i) => ({ business_id: businessId, url, display_order: i })));
    }
  }

  revalidatePath(redirectPath);
  if (business.slug) revalidatePath(`/business/${business.slug}`);

  redirect(`${redirectPath}?saved=1`);
}

// ── Pro FindMi Here — Owner Appearance Manager ──────────────────────────
//
// Two DELIBERATELY separate concepts, per this pass's own instruction:
//   1. The business's own FindMi Here calendar — plain `appearances` rows
//      it fully owns (business_id-scoped), editable/removable at will.
//   2. Official event roster visibility (event_businesses/
//      event_occurrence_businesses, EventParticipationStatus) — still
//      entirely founder-controlled; these actions only ever create a new
//      roster row as 'applied' (never 'approved', never update an
//      existing row's status) and never edit `events`/`event_occurrences`
//      themselves.
// Adding an appearance from an existing FindMi event creates BOTH (the
// appearance, and — only if not already on that roster — the applied
// request) but they stay independently readable/removable: removing the
// appearance never touches the roster row, and withdrawing the roster
// request never touches the appearance.
//
// Every action below shares the same authorize-then-elevate shape as
// every other action in this file: requireBusinessMember(businessId)
// first (real session-scoped membership, business_id never trusted from
// the client beyond that check), then a fresh service-role read of
// plan_tier — re-checked on every call, never cached/assumed — gates the
// whole feature to Pro. A Free business (including one downgraded after
// creating an appearance) gets the same "Upgrade to Pro" redirect a
// tampered request would.

/** Pro Products Foundation pass — this helper previously had zero
 * callers (FindMi Here appearance management moved off it in Free
 * Appearances Pass 1, onto requireAuthorizedBusinessMember below); it
 * now gets its first real caller here, for Products, which — unlike
 * appearances — genuinely IS Pro/Pro Seller-only (locked rule: Free
 * cannot add/manage products). Also now returns the business row
 * (id/slug/plan_tier), not just `admin` — every real caller needs the
 * slug for revalidatePath anyway, so callers no longer need their own
 * extra read for it. Message generalized from its old FindMi-Here-
 * specific wording since it's shared across features now. */
async function requireProBusinessMember(businessId: string, redirectPath: string) {
  const sessionSupabase = await getServerSupabase();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(redirectPath)}`);

  try {
    await requireBusinessMember(businessId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to this business.";
    redirect(errorRedirectUrl(redirectPath, message));
  }

  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl(redirectPath, "Server isn't configured."));

  const { data: business } = await admin
    .from("businesses")
    .select("id, slug, plan_tier")
    .eq("id", businessId)
    .maybeSingle();
  if (!business) redirect(errorRedirectUrl(redirectPath, "Business not found."));
  if (!isBusinessPro(business)) {
    redirect(errorRedirectUrl(redirectPath, "Upgrade to Pro to unlock this feature."));
  }

  return { admin, business };
}

/** Free Appearances Pass 1 — the exact same authorize-then-elevate shape
 * as requireProBusinessMember above (real Supabase Auth session,
 * requireBusinessMember() re-deriving real membership from the caller's
 * OWN session-scoped business_members row — never trusted from the
 * client — then elevating to the service-role client for the actual
 * write, same pattern every member action in this file already uses),
 * MINUS the plan_tier/isBusinessPro check: locked product rule is that
 * plan tier must never prevent an authorized business member from
 * maintaining FindMi Here appearance data — FindMi wants accurate
 * appearance data from Free businesses too. Deliberately a separate
 * function rather than editing requireProBusinessMember in place —
 * withdrawEventParticipation (below) still calls the original
 * Pro-gated helper, untouched by this pass; only the four actions this
 * pass's spec names (addAppearanceFromEvent, addManualAppearance,
 * updateOwnerAppearance, removeOwnerAppearance) now call this one. */
async function requireAuthorizedBusinessMember(businessId: string, redirectPath: string) {
  const sessionSupabase = await getServerSupabase();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(redirectPath)}`);

  try {
    await requireBusinessMember(businessId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to this business.";
    redirect(errorRedirectUrl(redirectPath, message));
  }

  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl(redirectPath, "Server isn't configured."));

  return admin;
}

/** Option 1 — "Choose an existing FindMi event." `target` is one of:
 *   "event:<eventId>"               -> non-recurring event
 *   "occ:<eventId>:<occurrenceId>"  -> one occurrence of a recurring event
 *
 * Creates/links the business's OWN appearance (using the real event_id/
 * event_occurrence_id — never title/date fuzzy matching), inheriting
 * title/date-time/location straight from the event or occurrence row.
 * Deduplicated by an existence check first: a non-recurring appearance is
 * unique per (business_id, event_id, event_occurrence_id IS NULL); an
 * occurrence appearance is additionally backed by the real DB-level
 * partial unique index (appearances_one_per_business_occurrence) as a
 * race-safe backstop — a 23505 there just means it already exists.
 *
 * Only when this business isn't already on that event's/occurrence's
 * OFFICIAL roster does this also create an event_businesses/
 * event_occurrence_businesses row — always status: 'applied', never
 * accepted from the form, and via ignoreDuplicates so an existing
 * approved/declined row is never touched or downgraded. Official roster
 * visibility still requires founder approval there, unchanged — creating
 * an appearance here never grants it. */
export async function addAppearanceFromEvent(businessId: string, formData: FormData) {
  const redirectPath = `/account/business/${businessId}`;
  const admin = await requireAuthorizedBusinessMember(businessId, redirectPath);

  const target = str(formData, "target");
  if (!target) redirect(errorRedirectUrl(redirectPath, "Choose an event to add."));

  const [kind, a, b] = target.split(":");

  if (kind === "event") {
    const eventId = a;
    const { data: event } = await admin
      .from("events")
      .select("id, name, start_at, end_at, venue_name, address, city, state, latitude, longitude")
      .eq("id", eventId)
      .eq("is_demo", false)
      .maybeSingle();
    if (!event) redirect(errorRedirectUrl(redirectPath, "That event is no longer available."));

    const { data: existingAppearance } = await admin
      .from("appearances")
      .select("id")
      .eq("business_id", businessId)
      .eq("event_id", eventId)
      .is("event_occurrence_id", null)
      .neq("status", "canceled")
      .maybeSingle();
    if (!existingAppearance) {
      const { error } = await admin.from("appearances").insert({
        business_id: businessId,
        event_id: eventId,
        title: event.name,
        start_at: event.start_at,
        end_at: event.end_at,
        venue_name: event.venue_name,
        address: event.address,
        city: event.city,
        state: event.state,
        latitude: event.latitude,
        longitude: event.longitude,
        status: "confirmed",
        // Appearance Provenance pass — the OWNER chose this event
        // themselves; never becomes 'official_participation' just because
        // admin later approves the roster row this also upserts below
        // (ensureEventAppearance's own existence check finds this row and
        // returns without touching it — see that helper's comment).
        source: "event_self_added",
      });
      if (error) redirect(errorRedirectUrl(redirectPath, "Couldn't create that appearance. Please try again."));
    }

    await admin
      .from("event_businesses")
      .upsert(
        { event_id: eventId, business_id: businessId, status: "applied" },
        { onConflict: "event_id,business_id", ignoreDuplicates: true }
      );
  } else if (kind === "occ") {
    const eventId = a;
    const occurrenceId = b;
    const { data: occurrence } = await admin
      .from("event_occurrences")
      .select("id, event_id, start_at, end_at, location_id, events(name, venue_name, address, city, state, latitude, longitude)")
      .eq("id", occurrenceId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (!occurrence) redirect(errorRedirectUrl(redirectPath, "That date is no longer available."));
    const event = Array.isArray(occurrence.events) ? occurrence.events[0] : occurrence.events;
    if (!event) redirect(errorRedirectUrl(redirectPath, "That event is no longer available."));

    let venue = {
      venue_name: event.venue_name as string | null,
      address: event.address as string | null,
      city: event.city as string | null,
      state: event.state as string | null,
      latitude: event.latitude as number | null,
      longitude: event.longitude as number | null,
    };
    if (occurrence.location_id) {
      const { data: location } = await admin
        .from("locations")
        .select("name, address, city, state, latitude, longitude")
        .eq("id", occurrence.location_id)
        .maybeSingle();
      if (location) {
        venue = {
          venue_name: location.name,
          address: location.address,
          city: location.city,
          state: location.state,
          latitude: location.latitude,
          longitude: location.longitude,
        };
      }
    }

    const { data: existingAppearance } = await admin
      .from("appearances")
      .select("id")
      .eq("business_id", businessId)
      .eq("event_occurrence_id", occurrenceId)
      .neq("status", "canceled")
      .maybeSingle();
    if (!existingAppearance) {
      const { error } = await admin.from("appearances").insert({
        business_id: businessId,
        event_id: occurrence.event_id,
        event_occurrence_id: occurrenceId,
        title: event.name,
        start_at: occurrence.start_at,
        end_at: occurrence.end_at,
        status: "confirmed",
        ...venue,
        // Appearance Provenance pass — same reasoning as the non-recurring
        // branch above: owner-chosen, never reassigned to
        // 'official_participation' by a later admin approval.
        source: "event_self_added",
      });
      // 23505 = unique_violation — a concurrent add already won the race
      // against appearances_one_per_business_occurrence; treat that as
      // "already exists," not a failure.
      if (error && error.code !== "23505") {
        redirect(errorRedirectUrl(redirectPath, "Couldn't create that appearance. Please try again."));
      }
    }

    await admin
      .from("event_occurrence_businesses")
      .upsert(
        { occurrence_id: occurrenceId, business_id: businessId, status: "applied" },
        { onConflict: "occurrence_id,business_id", ignoreDuplicates: true }
      );
  } else {
    redirect(errorRedirectUrl(redirectPath, "Choose a valid event or date."));
  }

  revalidatePath(redirectPath);
  redirect(`${redirectPath}?appearance_added=1`);
}

/** Withdraws this business's OWN request — only while it's still
 * 'applied' or 'pending'. The `.in("status", [...])` guard means an
 * approved row (or a tampered/mismatched key) simply matches zero rows
 * and nothing is deleted — approved participation can never be withdrawn
 * or otherwise touched through this action.
 *
 * Free Appearances Pass 2 — now uses requireAuthorizedBusinessMember
 * (Pass 1), not requireProBusinessMember: withdrawing is basic business
 * data/control, not a Pro feature, same locked rule as adding/editing/
 * removing appearances. Authorization/scoping/status-guard behavior
 * below is otherwise completely unchanged. */
export async function withdrawEventParticipation(businessId: string, kind: "event" | "occurrence", key: string) {
  const redirectPath = `/account/business/${businessId}`;
  const admin = await requireAuthorizedBusinessMember(businessId, redirectPath);

  if (kind === "event") {
    await admin
      .from("event_businesses")
      .delete()
      .eq("business_id", businessId)
      .eq("event_id", key)
      .in("status", ["applied", "pending"]);
  } else {
    await admin
      .from("event_occurrence_businesses")
      .delete()
      .eq("business_id", businessId)
      .eq("id", key)
      .in("status", ["applied", "pending"]);
  }

  revalidatePath(redirectPath);
  redirect(`${redirectPath}?participation_updated=1`);
}

// ── Standalone appearances (Option 2) + edit/remove ─────────────────────
// Plain business_id-owned appearances rows. Creation/edit never touches
// event_businesses/event_occurrence_businesses; a linked appearance's own
// event_id/event_occurrence_id is likewise never touched by edit (see
// updateOwnerAppearance's own note).

// The exact appearance field names this form submits — reused both to
// build the insert/update payload and, on a validation error, to carry
// the visitor's own submitted values back through the redirect so the
// form is never returned blank (see buildAppearanceErrorUrl below).
const APPEARANCE_FIELD_NAMES = [
  "title",
  "date",
  "start_time",
  "end_time",
  "venue_name",
  "address",
  "city",
  "state",
  "external_url",
  "flyer_image_url",
] as const;

/** Same shape errorRedirectUrl already uses (?error=...) plus the
 * visitor's own submitted field values, each namespaced `add_*` or
 * `edit_*` (+ `editing=<id>` for edit) so the page can repopulate
 * exactly the form that failed — "Add" and one specific appearance's
 * "Edit" disclosure never collide even if both existed on the page at
 * once. Never includes parsed/validated values, only the raw strings the
 * visitor actually typed, so correcting one field never loses another. */
function buildAppearanceErrorUrl(
  redirectPath: string,
  message: string,
  kind: "add" | "edit",
  formData: FormData,
  appearanceId?: string
): string {
  const params = new URLSearchParams({ error: message });
  for (const name of APPEARANCE_FIELD_NAMES) {
    const value = formData.get(name);
    if (typeof value === "string" && value) params.set(`${kind}_${name}`, value);
  }
  if (kind === "edit" && appearanceId) params.set("editing", appearanceId);
  return `${redirectPath}?${params.toString()}`;
}

/** Validates + normalizes the shared appearance fields. `onError` is
 * supplied by the caller (never redirects on its own) so each caller can
 * redirect through buildAppearanceErrorUrl with its own "add"/"edit"
 * values-preserving shape — this function itself has no opinion on that,
 * just validation. */
function parseAppearanceFields(formData: FormData, onError: (message: string) => never) {
  const title = str(formData, "title");
  const dateLocal = str(formData, "date");
  const startTime = str(formData, "start_time");
  const endTime = str(formData, "end_time");
  if (!title || !dateLocal || !startTime || !endTime) {
    onError("Name, date, start time, and end time are required.");
  }
  const start_at = localDateTimeToIso(`${dateLocal}T${startTime}`);
  const end_at = localDateTimeToIso(`${dateLocal}T${endTime}`);
  if (!start_at || !end_at || new Date(end_at) <= new Date(start_at)) {
    onError("End time must be after the start time.");
  }

  const externalUrlRaw = str(formData, "external_url");
  let external_url: string | null = null;
  if (externalUrlRaw) {
    const result = validateCustomDestination(externalUrlRaw);
    if (!result.ok) onError(`Link: ${result.error}`);
    external_url = result.value;
  }

  return {
    title,
    start_at: start_at as string,
    end_at: end_at as string,
    venue_name: str(formData, "venue_name"),
    address: str(formData, "address"),
    city: str(formData, "city"),
    state: str(formData, "state"),
    external_url,
    // Reuses the existing appearances.flyer_image_url column admin's own
    // AppearanceForm already writes to, and the file itself was already
    // uploaded (and validated — size/type/magic-byte checks, same
    // findmi-media bucket) by the existing uploadMemberBusinessImage
    // action via MemberImageField before this form ever submits; this
    // just carries the resulting URL through like any other field.
    flyer_image_url: str(formData, "flyer_image_url"),
  };
}

/** Option 2 — "Add an appearance manually." Creates a standalone
 * appearances row (no event_id/event_occurrence_id) owned entirely by
 * this business — never touches the official event roster tables at
 * all. On any validation/write failure, redirects back with every
 * submitted value preserved (see buildAppearanceErrorUrl) — the form is
 * never returned blank. */
export async function addManualAppearance(businessId: string, formData: FormData) {
  const redirectPath = `/account/business/${businessId}`;
  const admin = await requireAuthorizedBusinessMember(businessId, redirectPath);

  const onError = (message: string): never => {
    redirect(buildAppearanceErrorUrl(redirectPath, message, "add", formData));
  };
  const fields = parseAppearanceFields(formData, onError);

  const { error } = await admin.from("appearances").insert({
    business_id: businessId,
    status: "confirmed",
    ...fields,
    // Appearance Provenance pass — a true standalone/manual entry, never
    // linked to a real FindMi event/occurrence (no event_id above). Kept
    // after the ...fields spread so it can never be overridden by it.
    source: "manual",
  });
  if (error) onError("Couldn't create that appearance. Please try again.");

  revalidatePath(redirectPath);
  redirect(`${redirectPath}?appearance_added=1`);
}

/** Edit — only ever touches content fields (title/date-time/venue/
 * address/city/state/link/image) on the owner's OWN appearance row.
 * Ownership is re-verified against the authorized business_id before any
 * write, and never touches event_id/event_occurrence_id/business_id/
 * status — so editing an appearance linked to a real FindMi event/
 * occurrence can never re-point it at a different event, and never
 * touches the underlying event/occurrence or the official roster row
 * either; an owner may freely set/change their OWN appearance's image
 * without that affecting the event itself in any way. Same
 * values-preserved-on-error behavior as addManualAppearance. */
export async function updateOwnerAppearance(businessId: string, appearanceId: string, formData: FormData) {
  const redirectPath = `/account/business/${businessId}`;
  const admin = await requireAuthorizedBusinessMember(businessId, redirectPath);

  const onError = (message: string): never => {
    redirect(buildAppearanceErrorUrl(redirectPath, message, "edit", formData, appearanceId));
  };

  const { data: existing } = await admin
    .from("appearances")
    .select("id")
    .eq("id", appearanceId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!existing) onError("That appearance no longer exists.");

  const fields = parseAppearanceFields(formData, onError);

  const { error } = await admin.from("appearances").update(fields).eq("id", appearanceId).eq("business_id", businessId);
  if (error) onError("Couldn't update that appearance. Please try again.");

  revalidatePath(redirectPath);
  redirect(`${redirectPath}?appearance_updated=1`);
}

/** Remove — a soft cancel (status: 'canceled'), never a hard delete.
 * Scoped by both id and business_id, so a business can only ever cancel
 * its OWN appearance. Every public appearance query already excludes
 * status = 'canceled' (see lib/data.ts), so this alone is enough to stop
 * FindMi Here from showing it — with no risk to the underlying event/
 * occurrence (never touched) or to event_businesses/
 * event_occurrence_businesses (never touched either — an approved
 * official roster entry survives). For an occurrence-linked appearance,
 * the DB-level partial unique index (appearances_one_per_business_
 * occurrence) is itself scoped to `status <> 'canceled'`, so canceling
 * frees the business up to be re-added to that same occurrence later
 * without a conflict. */
export async function removeOwnerAppearance(businessId: string, appearanceId: string) {
  const redirectPath = `/account/business/${businessId}`;
  const admin = await requireAuthorizedBusinessMember(businessId, redirectPath);

  await admin.from("appearances").update({ status: "canceled" }).eq("id", appearanceId).eq("business_id", businessId);

  revalidatePath(redirectPath);
  redirect(`${redirectPath}?appearance_removed=1`);
}

// ── NATIVE FREE BUSINESS CREATION — Native Business Onboarding Pass 2 ──────
//
// Creating a business is free, requires no Pro purchase, and starts every
// new business Free + pending_review — see create_owned_business() (the
// migration this pass adds) for where plan_tier/publication_status are
// actually hardcoded, not trusted from here or anywhere client-side.

const CREATE_BUSINESS_PATH = "/account/business/new";

function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeUrlForMatch(value: string | null): string | null {
  if (!value) return null;
  return value.trim().toLowerCase().replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/, "") || null;
}

/** Practical, non-fuzzy duplicate check — the small candidate pool this
 * catalog actually has today makes a full compare-in-JS pass (not a
 * search index) the honest "smallest thing that works" choice; see this
 * pass's own scope note against building real matching infrastructure.
 * Checked in order: an exact website/Instagram match (the strongest
 * signal) first, then a normalized name match that ALSO agrees on city
 * and state whenever both sides have one (so the same business name in a
 * different city is never flagged). Demo rows are never candidates — a
 * seeded demo business is not a real duplicate target. Every real
 * publication_status (pending_review and live alike) is considered, so
 * two users can't independently create the "same" business twice while
 * the first is still awaiting review. */
async function findLikelyDuplicateBusiness(
  admin: SupabaseClient,
  input: { name: string; city: string | null; state: string | null; websiteUrl: string | null; instagramUrl: string | null }
): Promise<{ slug: string; name: string } | null> {
  const { data } = await admin
    .from("businesses")
    .select("slug, name, city, state, website_url, instagram_url")
    .eq("is_demo", false);
  const rows = (data ?? []) as { slug: string; name: string; city: string | null; state: string | null; website_url: string | null; instagram_url: string | null }[];

  const inputSite = normalizeUrlForMatch(input.websiteUrl);
  const inputInsta = normalizeUrlForMatch(input.instagramUrl);
  if (inputSite || inputInsta) {
    for (const row of rows) {
      if (inputSite && normalizeUrlForMatch(row.website_url) === inputSite) return row;
      if (inputInsta && normalizeUrlForMatch(row.instagram_url) === inputInsta) return row;
    }
  }

  const normalizedName = normalizeForMatch(input.name);
  for (const row of rows) {
    if (normalizeForMatch(row.name) !== normalizedName) continue;
    const cityMatches = !input.city || !row.city || normalizeForMatch(input.city) === normalizeForMatch(row.city);
    const stateMatches = !input.state || !row.state || normalizeForMatch(input.state) === normalizeForMatch(row.state);
    if (cityMatches && stateMatches) return row;
  }

  return null;
}

const CREATE_FRIENDLY_ERROR: Record<string, string> = {
  user_required: "You need to be signed in to create a business.",
  name_required: "Business name is required.",
  slug_required: "Business name is required to generate a URL.",
  invalid_category: "Choose a valid category.",
};

/** Creates a brand-new business natively — free, no payment, starting
 * plan_tier='free' and publication_status='pending_review' (both
 * hardcoded inside create_owned_business(), never accepted as input here
 * or by that RPC). The authenticated creator becomes its owner
 * atomically with the business itself (same RPC, one transaction) — see
 * that migration's own comment for why this needed a small SECURITY
 * DEFINER function rather than two separate inserts from here.
 *
 * city/state/website_url/instagram_url are collected for identity,
 * duplicate detection, and moderation ONLY — they're stored on the new
 * row, but this does NOT grant a Free business ongoing editing rights
 * over them: updateMemberBusiness's own Free allowlist (above) still
 * excludes every one of these columns regardless of how the row was
 * created, so a Free owner can set them here once, at creation, and never
 * touch them again through the normal editor until/unless the business
 * becomes Pro. They also never render publicly for a Free business
 * either (see business/[slug]/page.tsx's own `pro &&` gates) — no
 * additional exposure beyond what a Pro business's owner could already
 * set through the existing Pro editor. */
export async function createMemberBusiness(formData: FormData) {
  const sessionSupabase = await getServerSupabase();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(CREATE_BUSINESS_PATH)}`);

  const name = str(formData, "name");
  const categoryId = str(formData, "category_id");
  const city = str(formData, "city");
  const state = str(formData, "state");
  const websiteUrl = str(formData, "website_url");
  const instagramUrl = str(formData, "instagram_url");
  const authorized = bool(formData, "authorized");

  if (!name) redirect(errorRedirectUrl(CREATE_BUSINESS_PATH, "Business name is required."));
  if (!categoryId) redirect(errorRedirectUrl(CREATE_BUSINESS_PATH, "Choose a category."));
  if (!authorized) {
    redirect(
      errorRedirectUrl(CREATE_BUSINESS_PATH, "Please confirm you're authorized to create and manage this business.")
    );
  }

  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl(CREATE_BUSINESS_PATH, "Server isn't configured."));

  // Server-side duplicate protection — required regardless of any
  // client-side check, run BEFORE the atomic create below. A likely
  // match never auto-creates a second business; the visitor is directed
  // to the existing Claim Business flow instead.
  const duplicate = await findLikelyDuplicateBusiness(admin, {
    name: name!,
    city,
    state,
    websiteUrl,
    instagramUrl,
  });
  if (duplicate) {
    const params = new URLSearchParams({
      error: "We found a business that looks like a match. Claim it instead of creating a duplicate.",
      duplicate_slug: duplicate.slug,
      duplicate_name: duplicate.name,
    });
    redirect(`${CREATE_BUSINESS_PATH}?${params.toString()}`);
  }

  const baseSlug = resolveSlugInput(null, name);
  if (!baseSlug) redirect(errorRedirectUrl(CREATE_BUSINESS_PATH, "Business name is required to generate a URL."));
  const slug = await ensureUniqueSlug(baseSlug, (candidate) => isSlugTaken("businesses", candidate));

  const { data: created, error } = await admin.rpc("create_owned_business", {
    p_user_id: user.id,
    p_name: name,
    p_slug: slug,
    p_category_id: categoryId,
    p_city: city,
    p_state: state,
    p_website_url: websiteUrl,
    p_instagram_url: instagramUrl,
  });

  if (error || !created) {
    const message = CREATE_FRIENDLY_ERROR[error?.message ?? ""] ?? "Couldn't create your business. Please try again.";
    redirect(errorRedirectUrl(CREATE_BUSINESS_PATH, message));
  }

  const businessId = (created as { id: string }).id;
  revalidatePath("/account");

  // Plan choice — Native Business Onboarding Pass 3. The business is
  // ALWAYS created the same safe way first (free + pending_review, owner
  // membership already granted by the RPC above) regardless of which
  // plan was chosen — Pro is never created directly. Choosing Pro here
  // only means immediately continuing into the same native Stripe
  // checkout /upgrade/pro uses, scoped to this exact new business. If
  // checkout creation itself fails for any reason, this still lands the
  // owner on their new (Free, fully usable) business rather than losing
  // it — never a dead end.
  const planChoice = str(formData, "plan_choice");
  if (planChoice === "pro") {
    const checkout = await createBusinessProCheckoutSession(admin, businessId);
    if ("url" in checkout) redirect(checkout.url);
    redirect(`/account/business/${businessId}?created=1&error=${encodeURIComponent(checkout.error)}`);
  }

  redirect(`/account/business/${businessId}?created=1`);
}

/** Starts the native Pro checkout for an EXISTING, already-owned
 * business — the same one createMemberBusiness above uses for the
 * "create as Pro" path, and what /upgrade/pro's "Continue to secure
 * payment" now submits to instead of the old Tally handoff. Real
 * authorization first (requireBusinessMember, same as every other member
 * action in this file), never trusting the businessId from the client
 * beyond that. createBusinessProCheckoutSession itself re-reads plan_tier
 * fresh and refuses a business that's already pro/pro_seller, so this is
 * safe to call even from a stale page. */
export async function startBusinessProCheckout(businessId: string) {
  const upgradePath = `/upgrade/pro?business=${businessId}`;

  try {
    await requireBusinessMember(businessId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to this business.";
    redirect(errorRedirectUrl("/account", message));
  }

  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl(upgradePath, "Server isn't configured."));

  const checkout = await createBusinessProCheckoutSession(admin, businessId);
  if ("url" in checkout) redirect(checkout.url);
  redirect(errorRedirectUrl(upgradePath, checkout.error));
}

// ── Pro Products — Member Product Management ────────────────────────────
//
// Pro Products Foundation pass. Locked rule: Free cannot add/manage
// products; Pro and Pro Seller (isBusinessPro covers both) can manage
// products belonging to their OWN business. Reuses the existing
// `products` table/schema/taxonomy as-is — no new table, no parallel
// product system, no new RLS write policy: every write here still goes
// through the service-role client, exactly like admin's own
// saveProduct/deleteProduct (src/app/admin/(protected)/products/
// actions.ts, untouched) — the difference is WHO is allowed to reach
// this code path, enforced entirely server-side before any write:
//   1. requireProBusinessMember(businessId, redirectPath) — real
//      Supabase Auth session -> requireBusinessMember() (real,
//      session-scoped business_members row, business_id never trusted
//      from the client beyond that check) -> fresh service-role
//      plan_tier read -> isBusinessPro gate. A Free business (including
//      one downgraded after adding a product) gets the same
//      "Upgrade to Pro" redirect a tampered request would.
//   2. Edit/deactivate/reactivate additionally re-verify
//      product.business_id === the authorized business_id with a
//      `.eq("id", productId).eq("business_id", businessId)` double scope
//      on both the existence check AND the write itself — the same
//      pattern addManualAppearance/updateOwnerAppearance/
//      removeOwnerAppearance above already use for appearances.
//      Changing a product id or business id in a crafted request
//      therefore matches zero rows rather than touching another
//      business's product.
// The service role is never treated as the user's authorization — it's
// only ever reached after both checks above succeed.
//
// Field set is deliberately restricted to genuinely public catalog
// fields already on the existing schema — name, description, image,
// category, price/price label, product/service type, external purchase
// link, and active status (via deactivate/reactivate, kept separate
// from content edits, same split appearances use for status). Never
// exposed here, even though the columns exist: is_featured/
// home_sort_order/profile_sort_order (founder homepage/marketplace
// curation), purchasable/inventory_status/marketplace_fee_override_
// percent/processing_fee_payer_override/fulfillment options (commerce/
// payout/fee internals — admin-only, see ProductForm.tsx's own
// "Commerce" section, completely untouched by this pass).

/** Shared field parsing for create/update — mirrors admin's saveProduct
 * payload shape for exactly the public-catalog subset this pass allows
 * a member to touch. `onError` (from the caller) both reports the
 * message and never returns, so every field below is safely non-null
 * where required by the time this returns. */
function parseProductFields(
  formData: FormData,
  onError: (message: string) => never
): {
  name: string;
  description: string | null;
  image_url: string | null;
  price: number | null;
  price_label: string | null;
  product_type: ProductType;
  external_purchase_url: string | null;
} {
  const name = str(formData, "name");
  if (!name) onError("Product name is required.");

  const externalRaw = str(formData, "external_purchase_url");
  let external_purchase_url: string | null = null;
  if (externalRaw) {
    const result = validateCustomDestination(externalRaw);
    if (!result.ok) onError(`Product link: ${result.error}`);
    external_purchase_url = result.value;
  }

  return {
    name: name as string,
    description: str(formData, "description"),
    image_url: str(formData, "image_url"),
    price: num(formData, "price"),
    price_label: str(formData, "price_label"),
    product_type: str(formData, "product_type") === "service" ? "service" : "product",
    external_purchase_url,
  };
}

/** Atomic single-category replace for a member-owned product — same
 * "current config, delete-then-reinsert" shape admin's saveProduct
 * already uses for product_categories, just re-validated against
 * kind="product" here too (never trusts the submitted id is actually a
 * product-kind category). Optional: a blank selection simply clears it. */
async function setMemberProductCategory(admin: SupabaseClient, productId: string, formData: FormData) {
  const categoryId = str(formData, "category_id");
  await admin.from("product_categories").delete().eq("product_id", productId);
  if (!categoryId) return;
  const { data: category } = await admin
    .from("categories")
    .select("id")
    .eq("id", categoryId)
    .eq("kind", "product")
    .maybeSingle();
  if (category) {
    await admin.from("product_categories").insert({ product_id: productId, category_id: categoryId });
  }
}

export async function createMemberProduct(businessId: string, formData: FormData) {
  const redirectPath = `/account/business/${businessId}`;
  const { admin, business } = await requireProBusinessMember(businessId, redirectPath);

  const onError = (message: string): never => {
    redirect(errorRedirectUrl(redirectPath, message));
  };
  const fields = parseProductFields(formData, onError);

  const baseSlug = resolveSlugInput(null, fields.name);
  if (!baseSlug) onError("Product name is required to generate a URL.");
  const slug = await ensureUniqueSlug(baseSlug, (candidate) => isProductSlugTaken(candidate));

  // Product Marketplace Distribution pass — the owner's initial choice
  // between Catalog Only (default) and Submit To Marketplace. Setting
  // marketplace_status="submitted" here is only ever a REQUEST — it never
  // grants broader Marketplace/discovery placement itself (see
  // approveMarketplaceSubmission in admin/products/actions.ts, the only
  // place marketplace_status becomes "approved"), and content moderation
  // below is completely unaffected by this choice either way.
  const distribution = str(formData, "distribution") === "marketplace" ? "marketplace" : "catalog_only";

  // Product Moderation pass — a member-created product is NEVER
  // immediately public. moderation_status starts "pending_review"
  // (overriding the column's own 'live' default, which exists only so
  // existing admin-authored rows read as already-approved) and the RLS
  // policy on products now requires moderation_status='live' in addition
  // to is_active — so this row genuinely cannot appear on any public
  // surface until an admin approves it. The owner has no field/param
  // that can set this to "live" themselves.
  const { data, error } = await admin
    .from("products")
    .insert({
      business_id: businessId,
      slug,
      is_active: true,
      moderation_status: "pending_review",
      marketplace_status: distribution === "marketplace" ? "submitted" : "catalog_only",
      marketplace_submitted_at: distribution === "marketplace" ? new Date().toISOString() : null,
      ...fields,
    })
    .select("id")
    .single();
  if (error || !data) return onError("Couldn't create that product. Please try again.");

  // Safe to assign the category immediately — the product itself is
  // still pending_review, so it can't leak through any public
  // category-filtered query (getMarketplaceProducts etc. all require
  // moderation_status='live' via RLS) even though product_categories has
  // no moderation gate of its own.
  await setMemberProductCategory(admin, data.id, formData);

  revalidatePath(redirectPath);
  revalidatePath(`/product/${slug}`);
  if (business.slug) revalidatePath(`/business/${business.slug}`);
  revalidatePath("/marketplace");
  redirect(`${redirectPath}?product_added=1`);
}

/** Edit — only ever touches this ONE product, and only after confirming
 * it belongs to the authorized business (see the section comment above
 * for the exact double-scoped check). Slug is deliberately never
 * regenerated here even if the name changes — keeps the product's
 * public URL stable across edits; only admin's own editor changes it.
 *
 * Product Moderation pass — behavior now branches on the product's
 * current moderation_status:
 *   - "live" (already approved and public): the submitted fields are
 *     NEVER written to the product's real columns. They're stored as a
 *     proposal in pending_changes instead, so the currently-approved
 *     content keeps showing publicly untouched until an admin approves
 *     the edit (see admin's approveProduct/rejectProduct). A second edit
 *     while one is already pending simply replaces the standing
 *     proposal — there's only ever one pending revision per product.
 *   - "pending_review" or "rejected" (never successfully live): nothing
 *     is public yet regardless of what changes, so the row's real
 *     columns are updated directly, same as before this pass. Editing a
 *     rejected product also resubmits it (back to "pending_review") —
 *     the smallest way to let an owner act on admin feedback without a
 *     dead-end state; there is no separate "resubmit" action. */
export async function updateMemberProduct(businessId: string, productId: string, formData: FormData) {
  const redirectPath = `/account/business/${businessId}`;
  const { admin, business } = await requireProBusinessMember(businessId, redirectPath);

  const onError = (message: string): never => {
    redirect(errorRedirectUrl(redirectPath, message));
  };

  const { data: existing } = await admin
    .from("products")
    .select("id, slug, moderation_status")
    .eq("id", productId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!existing) return onError("That product no longer exists.");

  const fields = parseProductFields(formData, onError);
  const categoryId = str(formData, "category_id");

  if (existing.moderation_status === "live") {
    const pending_changes: ProductPendingChanges = { ...fields, category_id: categoryId || null };
    const { error } = await admin
      .from("products")
      .update({ pending_changes })
      .eq("id", productId)
      .eq("business_id", businessId);
    if (error) onError("Couldn't submit those changes. Please try again.");
    revalidatePath(redirectPath);
    redirect(`${redirectPath}?product_changes_pending=1`);
  }

  const { error } = await admin
    .from("products")
    .update({ ...fields, moderation_status: "pending_review" })
    .eq("id", productId)
    .eq("business_id", businessId);
  if (error) onError("Couldn't update that product. Please try again.");

  await setMemberProductCategory(admin, productId, formData);

  revalidatePath(redirectPath);
  revalidatePath(`/product/${existing.slug}`);
  if (business.slug) revalidatePath(`/business/${business.slug}`);
  revalidatePath("/marketplace");
  redirect(`${redirectPath}?product_updated=1`);
}

/** Deactivate/reactivate — a status toggle only, never a delete (Section
 * 9's own "prefer deactivate/unpublish" instruction): flips is_active,
 * which every existing public product query already filters on (see
 * lib/data.ts's getProductsForBusiness and the products table's own
 * "Public read active products" RLS policy) — an inactive product keeps
 * its row, its slug, its category, and its order history intact, it
 * simply stops appearing publicly, and reactivating brings it straight
 * back with nothing to rebuild. Same double-scoped ownership check as
 * updateMemberProduct above. */
export async function setMemberProductActive(businessId: string, productId: string, active: boolean) {
  const redirectPath = `/account/business/${businessId}`;
  const { admin, business } = await requireProBusinessMember(businessId, redirectPath);

  const { data: existing } = await admin
    .from("products")
    .select("id, slug")
    .eq("id", productId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!existing) redirect(errorRedirectUrl(redirectPath, "That product no longer exists."));

  const { error } = await admin
    .from("products")
    .update({ is_active: active })
    .eq("id", productId)
    .eq("business_id", businessId);
  if (error) redirect(errorRedirectUrl(redirectPath, "Couldn't update that product. Please try again."));

  revalidatePath(redirectPath);
  revalidatePath(`/product/${existing.slug}`);
  if (business.slug) revalidatePath(`/business/${business.slug}`);
  revalidatePath("/marketplace");
  redirect(`${redirectPath}?product_updated=1`);
}

// ── Product Marketplace Distribution — Member Actions ────────────────────
//
// Two owner-facing state transitions, deliberately separate from content
// edits (updateMemberProduct above) — marketplace_status changes never
// touch moderation_status/pending_changes, and content edits never touch
// marketplace_status. Same requireProBusinessMember + double-scoped
// (id + business_id) authorization shape as every other action in this
// section. Neither action can ever set marketplace_status to "approved" —
// that value is written exclusively by admin/products/actions.ts's
// approveMarketplaceSubmission/resumeMarketplaceListing, which this file
// has no access to and never calls.

/** Catalog Only -> Submit To Marketplace, or Rejected -> resubmit for
 * review. A no-op (redirects back unchanged) from any other state
 * ("submitted" is already pending; "approved"/"paused" are admin
 * decisions the owner can't self-override by resubmitting). */
export async function submitProductToMarketplace(businessId: string, productId: string) {
  const redirectPath = `/account/business/${businessId}`;
  const { admin } = await requireProBusinessMember(businessId, redirectPath);

  const { data: existing } = await admin
    .from("products")
    .select("id, marketplace_status")
    .eq("id", productId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!existing) redirect(errorRedirectUrl(redirectPath, "That product no longer exists."));

  if (existing.marketplace_status === "catalog_only" || existing.marketplace_status === "rejected") {
    await admin
      .from("products")
      .update({ marketplace_status: "submitted", marketplace_submitted_at: new Date().toISOString() })
      .eq("id", productId)
      .eq("business_id", businessId);
  }

  revalidatePath(redirectPath);
  redirect(`${redirectPath}?marketplace_updated=1`);
}

/** Withdraws the owner's own not-yet-decided request ("submitted"), or
 * opts back out after a rejection ("rejected") — back to catalog_only.
 * A no-op from "catalog_only" (nothing to withdraw) or "approved"/
 * "paused" (an admin decision the owner can't self-revert — see
 * pauseMarketplaceListing in admin/products/actions.ts for the admin-side
 * equivalent). */
export async function returnProductToCatalog(businessId: string, productId: string) {
  const redirectPath = `/account/business/${businessId}`;
  const { admin } = await requireProBusinessMember(businessId, redirectPath);

  const { data: existing } = await admin
    .from("products")
    .select("id, marketplace_status")
    .eq("id", productId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!existing) redirect(errorRedirectUrl(redirectPath, "That product no longer exists."));

  if (existing.marketplace_status === "submitted" || existing.marketplace_status === "rejected") {
    await admin
      .from("products")
      .update({ marketplace_status: "catalog_only" })
      .eq("id", productId)
      .eq("business_id", businessId);
  }

  revalidatePath(redirectPath);
  redirect(`${redirectPath}?marketplace_updated=1`);
}
