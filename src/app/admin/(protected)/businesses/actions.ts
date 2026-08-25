"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";

export async function saveBusiness(id: string | null, formData: FormData) {
  const supabase = getAdminSupabase();
  const editPath = id ? `/admin/businesses/${id}` : "/admin/businesses/new";
  if (!supabase) redirect(errorRedirectUrl(editPath, "Server isn't configured for writes."));

  const name = str(formData, "name");
  const slug = str(formData, "slug");
  if (!name || !slug) {
    redirect(errorRedirectUrl(editPath, "Name and slug are required."));
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
    // Final refinement pass, item 4.
    bulletin_enabled: bool(formData, "bulletin_enabled"),
    bulletin_heading: str(formData, "bulletin_heading"),
    bulletin_body: str(formData, "bulletin_body"),
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

  revalidatePath("/admin/businesses");
  revalidatePath(`/business/${slug}`);
  revalidatePath("/");
  revalidatePath("/businesses");
  redirect(`/admin/businesses/${businessId}?saved=1`);
}
