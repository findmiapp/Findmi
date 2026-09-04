"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { isProductSlugTaken } from "@/lib/admin/queries";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";

export async function saveProduct(id: string | null, formData: FormData) {
  const editPath = id ? `/admin/products/${id}` : "/admin/products/new";
  const supabase = await requireAdminSupabase();

  const businessId = str(formData, "business_id");
  const name = str(formData, "name");
  if (!businessId || !name) {
    redirect(errorRedirectUrl(editPath, "Business and name are required."));
  }

  // The DB constraint is only unique(business_id, slug) — /product/[slug]
  // resolves on the slug alone, so the admin enforces global uniqueness
  // here rather than letting two businesses collide. Slug safety can't
  // depend on client JS having run: normalize/generate it server-side,
  // then resolve any collision with a deterministic -2/-3 suffix instead
  // of rejecting the save outright.
  const baseSlug = resolveSlugInput(str(formData, "slug"), name);
  if (!baseSlug) {
    redirect(errorRedirectUrl(editPath, "Name is required to generate a slug."));
  }
  const slug = await ensureUniqueSlug(baseSlug, (candidate) =>
    isProductSlugTaken(candidate, id ?? undefined)
  );

  const payload = {
    business_id: businessId,
    name,
    slug,
    description: str(formData, "description"),
    image_url: str(formData, "image_url"),
    price: num(formData, "price"),
    price_label: str(formData, "price_label"),
    product_type: str(formData, "product_type") ?? "product",
    external_purchase_url: str(formData, "external_purchase_url"),
    is_featured: bool(formData, "is_featured"),
    home_sort_order: num(formData, "home_sort_order"),
    profile_sort_order: num(formData, "profile_sort_order"),
    is_active: bool(formData, "is_active"),
    purchasable: bool(formData, "purchasable"),
    inventory_status: str(formData, "inventory_status"),
    marketplace_fee_override_percent: num(formData, "marketplace_fee_override_percent"),
    processing_fee_payer_override: str(formData, "processing_fee_payer_override"),
  };

  let productId = id;
  if (productId) {
    const { error } = await supabase.from("products").update(payload).eq("id", productId);
    if (error) redirect(errorRedirectUrl(editPath, error.message));
  } else {
    const { data, error } = await supabase.from("products").insert(payload).select("id").single();
    if (error || !data) redirect(errorRedirectUrl(editPath, error?.message ?? "Could not create product."));
    productId = data.id;
  }

  // Fulfillment options: rebuilt from scratch on every save. This is
  // current-config, not economic history (order_items snapshots its own
  // fulfillment_method/fulfillment_amount independently), so
  // delete-then-reinsert is safe and simpler than diffing.
  await supabase.from("product_fulfillment_options").delete().eq("product_id", productId);
  const newOptions: { product_id: string; method: string; price: number; enabled: boolean; appearance_id?: string }[] = [];
  for (const method of ["shipping", "local_delivery", "pickup"] as const) {
    if (bool(formData, `fulfillment_${method}_enabled`)) {
      newOptions.push({
        product_id: productId as string,
        method,
        price: num(formData, `fulfillment_${method}_price`) ?? 0,
        enabled: true,
      });
    }
  }
  for (const appearanceId of formData.getAll("event_pickup_appearance_id").map(String)) {
    newOptions.push({
      product_id: productId as string,
      method: "event_pickup",
      price: num(formData, `event_pickup_price_${appearanceId}`) ?? 0,
      enabled: true,
      appearance_id: appearanceId,
    });
  }
  if (newOptions.length > 0) {
    await supabase.from("product_fulfillment_options").insert(newOptions);
  }

  // Product category (product_categories) — Product Taxonomy V1 pass:
  // the editor now submits exactly one most-specific category id (a
  // Category → Subcategory cascading select — see
  // CategorySubcategoryField) rather than a multi-select checklist.
  // product_categories itself is still a plain junction table (unchanged
  // schema, still capable of more than one row per product), so this
  // stays a delete-then-reinsert of "current config" like fulfillment
  // options above — nothing else references a specific row.
  const categoryId = str(formData, "category_id");
  await supabase.from("product_categories").delete().eq("product_id", productId);
  if (categoryId) {
    await supabase.from("product_categories").insert([{ product_id: productId, category_id: categoryId }]);
  }

  revalidatePath("/admin/products");
  revalidatePath(`/product/${slug}`);
  revalidatePath("/");
  revalidatePath("/marketplace");
  redirect(`/admin/products/${productId}?saved=1`);
}

export async function deleteProduct(id: string) {
  const supabase = await requireAdminSupabase();
  await supabase.from("products").delete().eq("id", id);
  revalidatePath("/admin/products");
  revalidatePath("/");
  redirect("/admin/products");
}

// ── Product Moderation — Admin Review ────────────────────────────────────
//
// Approve/reject owner-submitted Product content. Admin-only
// (requireAdminSupabase — the same founder-password-gated session every
// other admin action already requires); a business member has no path to
// either of these, and neither takes a business_id or any value from a
// member-facing form, so there's nothing for a member to tamper with to
// reach them. See ../../../(public)/account/business/actions.ts's own
// section comment for the member-facing half of this workflow.

async function getProductForReview(supabase: Awaited<ReturnType<typeof requireAdminSupabase>>, id: string) {
  const { data } = await supabase
    .from("products")
    .select("id, slug, business_id, moderation_status, pending_changes")
    .eq("id", id)
    .maybeSingle();
  return data;
}

/**
 * Approve a NEW product (moderation_status was "pending_review" → "live",
 * nothing else changes) OR approve a standing edit to an already-live
 * product (pending_changes' proposed field values are copied onto the
 * product's real columns — including a delete-then-reinsert of
 * product_categories for the proposed category — and pending_changes is
 * cleared). Either way the approved Product remains a single row; nothing
 * is deleted.
 */
export async function approveProduct(id: string) {
  const supabase = await requireAdminSupabase();
  const product = await getProductForReview(supabase, id);
  if (!product) redirect(errorRedirectUrl("/admin/products", "Product not found."));

  if (product.moderation_status === "pending_review") {
    await supabase.from("products").update({ moderation_status: "live" }).eq("id", id);
  } else if (product.pending_changes) {
    const { category_id, ...fieldChanges } = product.pending_changes as Record<string, unknown> & {
      category_id?: string | null;
    };
    await supabase
      .from("products")
      .update({ ...fieldChanges, pending_changes: null })
      .eq("id", id);
    await supabase.from("product_categories").delete().eq("product_id", id);
    if (category_id) {
      await supabase.from("product_categories").insert({ product_id: id, category_id });
    }
  }

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${id}`);
  revalidatePath("/");
  revalidatePath("/marketplace");
  if (product.slug) revalidatePath(`/product/${product.slug}`);
  redirect(`/admin/products/${id}?approved=1`);
}

/**
 * Reject a NEW product (moderation_status → "rejected"; it stays
 * non-public, the owner can edit it to resubmit) OR reject a standing
 * edit to an already-live product (pending_changes is simply cleared —
 * the currently-approved/live content is never touched, so it keeps
 * showing publicly exactly as it did before the proposal).
 */
export async function rejectProduct(id: string) {
  const supabase = await requireAdminSupabase();
  const product = await getProductForReview(supabase, id);
  if (!product) redirect(errorRedirectUrl("/admin/products", "Product not found."));

  if (product.moderation_status === "pending_review") {
    await supabase.from("products").update({ moderation_status: "rejected" }).eq("id", id);
  } else if (product.pending_changes) {
    await supabase.from("products").update({ pending_changes: null }).eq("id", id);
  }

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${id}`);
  redirect(`/admin/products/${id}?rejected=1`);
}
