"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";
import { validateCustomDestination } from "@/lib/navigation";
import { isSlugTaken } from "@/lib/admin/queries";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";

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
    lead_status: str(formData, "lead_status") ?? "new",
    // Framed to the founder as "Published" — is_demo is the inverse.
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
  const editPath = `/admin/businesses/${businessId}`;
  const supabase = await requireAdminSupabase();

  const email = str(formData, "email");
  if (!email) {
    redirect(errorRedirectUrl(editPath, "Enter an email address."));
  }

  const { data: userId, error: lookupError } = await supabase.rpc("lookup_auth_user_id_by_email", {
    p_email: email,
  });
  if (lookupError) {
    redirect(errorRedirectUrl(editPath, "Couldn't look up that email. Please try again."));
  }
  if (!userId) {
    redirect(errorRedirectUrl(editPath, "No FindMi account found with that email."));
  }

  const { data: existing } = await supabase
    .from("business_members")
    .select("id")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    redirect(errorRedirectUrl(editPath, "That user is already a member of this business."));
  }

  const { error: insertError } = await supabase
    .from("business_members")
    .insert({ business_id: businessId, user_id: userId, role: "manager" });
  if (insertError) {
    redirect(errorRedirectUrl(editPath, "Couldn't assign that member. Please try again."));
  }

  revalidatePath(editPath);
  redirect(`${editPath}?member_updated=1`);
}

/** Removes a manager/staff member's access entirely. Same `.neq("role",
 * "owner")` guard the claims page's own removeMember() uses, so this can
 * never remove an owner even given a tampered member id — ownership only
 * ever changes via remove_business_owner()/transfer_business_ownership()
 * (claims page), untouched by this pass. Never deletes the user or the
 * business — only the one business_members row. */
export async function removeBusinessMember(businessId: string, memberId: string) {
  const editPath = `/admin/businesses/${businessId}`;
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
    redirect(errorRedirectUrl(editPath, "Couldn't remove that member — they may no longer be a member."));
  }

  revalidatePath(editPath);
  redirect(`${editPath}?member_updated=1`);
}
