"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { bool, errorRedirectUrl, localDateTimeToIso, str } from "@/lib/admin/form-helpers";
import { requireBusinessMember } from "@/lib/permissions";
import { isBusinessPro } from "@/lib/entitlements";
import { validateImageFile } from "@/lib/imageUploadValidation";
import { validateCustomDestination } from "@/lib/navigation";
import { isSlugTaken } from "@/lib/admin/queries";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { createBusinessProCheckoutSession } from "@/lib/commerce/businessProCheckout";

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
// management capability: both Free and Pro currently resolve to the same
// tiny allowlist below (name/logo/cover/one category) — the full Pro
// editor (description, website, contact, socials, gallery, products,
// appearances, inquiry/lead settings, multi-category) doesn't exist yet
// and is explicitly out of scope here. No UI calls this yet.

/** Same tiny allowlist for both tiers today — Free because plan_tier
 * genuinely limits it, Pro because the full Pro editor isn't built yet
 * ("allow only the same basic fields implemented by this new action" per
 * the pass spec). Kept as two named constants (rather than one shared
 * one) purely so a later pass can widen PRO_ALLOWED_COLUMNS without
 * touching the Free path at all. */
const FREE_ALLOWED_COLUMNS = ["name", "logo_url", "cover_image_url", "short_description"] as const;
// Pro-only additions — every one an EXISTING businesses column already
// used by the founder admin editor (BusinessForm.tsx); no new columns.
// "announcement" is the bulletin_* group admin already exposes together
// under that same label.
const PRO_ONLY_COLUMNS = [
  "description",
  "city",
  "state",
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
 * Updates a business's name, logo, cover image, and category — the ONLY
 * fields any business_members-authorized user (any role: owner, manager,
 * or staff — role governs WHO can call this, never WHAT plan-tier fields
 * are allowed) may touch through this action, regardless of plan. Every
 * other business column (description, website, email/phone, socials,
 * gallery, products, appearances, inquiry/lead settings, CTAs, bulletin,
 * additional categories, commerce/payout settings, verification/
 * membership/publication status, etc.) is simply never read from the
 * submitted form — there is no generic object spread into Supabase
 * anywhere in this function, only this fixed, named column list — so a
 * request that also includes any of those fields has them silently
 * ignored rather than erroring, the same "extra form fields are just
 * never looked at" pattern every other action in this codebase already
 * uses (saveBusiness, saveEvent, updateProfile, etc.).
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

  const { data: business } = await admin.from("businesses").select("id, plan_tier").eq("id", businessId).maybeSingle();
  if (!business) redirect(errorRedirectUrl(redirectPath, "Business not found."));
  if (!isBusinessPro(business)) {
    redirect(errorRedirectUrl(redirectPath, "Upgrade to Pro to manage FindMi Here participation."));
  }

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
  const admin = await requireProBusinessMember(businessId, redirectPath);

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
 * or otherwise touched through this action. */
export async function withdrawEventParticipation(businessId: string, kind: "event" | "occurrence", key: string) {
  const redirectPath = `/account/business/${businessId}`;
  const admin = await requireProBusinessMember(businessId, redirectPath);

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
  const admin = await requireProBusinessMember(businessId, redirectPath);

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
  const admin = await requireProBusinessMember(businessId, redirectPath);

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
  const admin = await requireProBusinessMember(businessId, redirectPath);

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
