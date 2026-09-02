"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl, str } from "@/lib/admin/form-helpers";
import { requireBusinessMember } from "@/lib/permissions";
import { isBusinessPro } from "@/lib/entitlements";
import { validateImageFile } from "@/lib/imageUploadValidation";

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

  const { error } = await admin.storage.from(UPLOAD_BUCKET).upload(path, file, {
    contentType: file.type,
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
const FREE_ALLOWED_COLUMNS = ["name", "logo_url", "cover_image_url"] as const;
const PRO_ALLOWED_COLUMNS = FREE_ALLOWED_COLUMNS;

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

  // The actual UPDATE payload is built FROM allowedColumns, not just
  // gated by it — every value this action is capable of writing lives in
  // candidateValues, and only the columns named in allowedColumns are
  // ever copied out of it into the real Supabase payload. A future pass
  // widening PRO_ALLOWED_COLUMNS (and candidateValues) automatically
  // reaches this same construction — no branching logic to duplicate.
  const candidateValues: Record<(typeof FREE_ALLOWED_COLUMNS)[number], string | null> = {
    name,
    logo_url,
    cover_image_url,
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

  revalidatePath(redirectPath);
  if (business.slug) revalidatePath(`/business/${business.slug}`);

  redirect(`${redirectPath}?saved=1`);
}
