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

/**
 * Product Management Completion pass — this already-existing admin-only
 * hard delete previously never checked the delete's own result: if the
 * database blocked it (order_items.product_id -> products.id is
 * ON DELETE NO ACTION — a product that has ever appeared in a real order
 * can't be hard-deleted without orphaning that order's line item), the
 * row silently survived while the page redirected as if it had
 * succeeded. Traced dependencies: account_saved_products, event_products,
 * product_categories, and product_fulfillment_options all cascade-delete
 * safely (no data loss — saved-lists/join-tables/config only); order_items
 * is the sole blocker, and correctly so — deleting a product should never
 * silently orphan real order history. Now surfaces that as a clear error
 * instead of a false success, and points the admin at deactivation
 * (already the safe, always-available alternative) rather than adding any
 * cascade/force-delete behavior.
 */
export async function deleteProduct(id: string) {
  const supabase = await requireAdminSupabase();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) {
    redirect(
      errorRedirectUrl(
        `/admin/products/${id}`,
        "Couldn't delete — this product has order history. Deactivate it instead if it shouldn't stay public."
      )
    );
  }
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

// ── Product Marketplace Distribution — Admin Review ───────────────────────
//
// CONTENT moderation (approveProduct/rejectProduct above) and Marketplace
// distribution approval are two entirely independent decisions — see
// lib/types.ts's ProductMarketplaceStatus. Owner-facing half of this
// workflow: (public)/account/business/actions.ts's
// submitProductToMarketplace/returnProductToCatalog. Admin-only
// (requireAdminSupabase); a business member has no path to any action
// below and no form field reaches them.

async function getProductForMarketplaceReview(supabase: Awaited<ReturnType<typeof requireAdminSupabase>>, id: string) {
  const { data } = await supabase
    .from("products")
    .select("id, slug, business_id, moderation_status, marketplace_status")
    .eq("id", id)
    .maybeSingle();
  return data;
}

/** Grants broader Marketplace/discovery visibility. Blocked entirely
 * unless the product's CONTENT is already approved (moderation_status
 * must be "live") — Marketplace submission must never bypass content
 * moderation, regardless of how long a submission has been waiting. */
export async function approveMarketplaceSubmission(id: string) {
  const supabase = await requireAdminSupabase();
  const product = await getProductForMarketplaceReview(supabase, id);
  if (!product) redirect(errorRedirectUrl("/admin/products", "Product not found."));

  if (product.moderation_status !== "live") {
    redirect(
      errorRedirectUrl(`/admin/products/${id}`, "Approve this product's content first — Marketplace approval requires it to be live.")
    );
  }

  await supabase
    .from("products")
    .update({ marketplace_status: "approved", marketplace_approved_at: new Date().toISOString() })
    .eq("id", id);

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${id}`);
  revalidatePath("/marketplace");
  if (product.slug) revalidatePath(`/product/${product.slug}`);
  redirect(`/admin/products/${id}?marketplace_approved=1`);
}

/** Declines a Marketplace submission. The Product's own business-profile/
 * storefront visibility (moderation_status/is_active) is never touched
 * here — only future broader Marketplace/discovery placement is
 * declined. Also used to reject an already-"paused" listing outright. */
export async function rejectMarketplaceSubmission(id: string) {
  const supabase = await requireAdminSupabase();
  const product = await getProductForMarketplaceReview(supabase, id);
  if (!product) redirect(errorRedirectUrl("/admin/products", "Product not found."));

  await supabase.from("products").update({ marketplace_status: "rejected" }).eq("id", id);

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${id}`);
  revalidatePath("/marketplace");
  redirect(`/admin/products/${id}?marketplace_rejected=1`);
}

/** Temporarily withdraws Marketplace visibility without rejecting the
 * submission outright — the Product remains fully visible on its own
 * business's profile/storefront (untouched here); only broader
 * Marketplace/discovery placement pauses. resumeMarketplaceListing below
 * restores it without a new review. */
export async function pauseMarketplaceListing(id: string) {
  const supabase = await requireAdminSupabase();
  const product = await getProductForMarketplaceReview(supabase, id);
  if (!product) redirect(errorRedirectUrl("/admin/products", "Product not found."));

  await supabase.from("products").update({ marketplace_status: "paused" }).eq("id", id);

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${id}`);
  revalidatePath("/marketplace");
  redirect(`/admin/products/${id}?marketplace_paused=1`);
}

/** Resumes a paused listing — restores "approved" without re-running a
 * fresh review (the admin already approved it once; pausing was a hold,
 * not a rejection). Still requires moderation_status="live", same gate
 * as approveMarketplaceSubmission, purely defensive. */
export async function resumeMarketplaceListing(id: string) {
  const supabase = await requireAdminSupabase();
  const product = await getProductForMarketplaceReview(supabase, id);
  if (!product) redirect(errorRedirectUrl("/admin/products", "Product not found."));

  if (product.moderation_status !== "live") {
    redirect(
      errorRedirectUrl(`/admin/products/${id}`, "Approve this product's content first — Marketplace approval requires it to be live.")
    );
  }

  await supabase.from("products").update({ marketplace_status: "approved" }).eq("id", id);

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${id}`);
  revalidatePath("/marketplace");
  redirect(`/admin/products/${id}?marketplace_approved=1`);
}
