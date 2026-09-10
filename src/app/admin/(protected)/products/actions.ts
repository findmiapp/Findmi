"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { isProductSlugTaken } from "@/lib/admin/queries";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { getEntityManagerEmails } from "@/lib/notifications/recipients";
import { sendProductNotification } from "@/lib/notifications/productNotify";

/** Marketplace decision notification — every CURRENT business_members
 * recipient of the Product's owning Business. Best-effort: a Resend
 * failure never affects the Marketplace decision itself, which has
 * already committed by the time this runs. */
async function notifyMarketplaceDecision(
  supabase: SupabaseClient,
  businessId: string,
  productName: string,
  outcome: "approved" | "rejected" | "paused" | "resumed"
): Promise<void> {
  const to = await getEntityManagerEmails(supabase, "business", businessId);
  const copyByOutcome: Record<typeof outcome, { type: string; subject: string; heading: string; body: string[] }> = {
    approved: {
      type: "marketplace_approved",
      subject: `Your Marketplace submission was approved — ${productName}`,
      heading: "Your Marketplace submission was approved",
      body: [`${productName} is now visible on Findmi Marketplace.`],
    },
    rejected: {
      type: "marketplace_rejected",
      subject: `Update on your Marketplace submission — ${productName}`,
      heading: "Your Marketplace submission wasn't approved",
      body: [
        `${productName} wasn't approved for Findmi Marketplace this time.`,
        "It's still visible on your own Business page — only broader Marketplace placement was declined.",
      ],
    },
    paused: {
      type: "marketplace_paused",
      subject: `Your Marketplace listing was paused — ${productName}`,
      heading: "Your Marketplace listing was paused",
      body: [
        `${productName} has been temporarily paused on Findmi Marketplace.`,
        "It's still visible on your own Business page — only broader Marketplace placement is paused.",
      ],
    },
    resumed: {
      type: "marketplace_resumed",
      subject: `Your Marketplace listing is active again — ${productName}`,
      heading: "Your Marketplace listing is active again",
      body: [`${productName} is visible on Findmi Marketplace again.`],
    },
  };
  const copy = copyByOutcome[outcome];

  await sendProductNotification({
    to,
    type: copy.type,
    subject: copy.subject,
    heading: copy.heading,
    body: copy.body,
    actionLabel: `Manage ${productName}`,
    actionUrl: `/account/business/${businessId}?tab=products`,
  });
}

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
    .select("id, name, slug, business_id, moderation_status, pending_changes, business:businesses(name)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return data;
  const business = Array.isArray(data.business) ? data.business[0] : data.business;
  return { ...data, business: business ?? null };
}

/** Content-moderation decision notification — every CURRENT
 * business_members recipient of the Product's owning Business. Entirely
 * distinct from notifyMarketplaceDecision below (different type strings,
 * different copy, never called from the same code path) — content
 * approval/rejection and Marketplace distribution are two independent
 * decisions, and a single admin action here must never also fire a
 * Marketplace email. Best-effort: a Resend failure never affects the
 * moderation decision itself, which has already committed by the time
 * this runs. No rejection-reason field exists on this workflow today, so
 * none is included (never invented). */
async function notifyProductModerationDecision(
  supabase: SupabaseClient,
  businessId: string,
  productName: string,
  businessName: string | null,
  outcome: "approved" | "rejected"
): Promise<void> {
  const to = await getEntityManagerEmails(supabase, "business", businessId);
  const businessSuffix = businessName ? ` for ${businessName}` : "";
  const copy =
    outcome === "approved"
      ? {
          type: "product_content_approved",
          subject: `Your product is now live — ${productName}`,
          heading: "Your product is now live",
          body: [`${productName}${businessSuffix} has been approved and is now visible on Findmi.`],
        }
      : {
          type: "product_content_rejected",
          subject: `Update on your product — ${productName}`,
          heading: "Your product wasn't approved",
          body: [
            `${productName}${businessSuffix} wasn't approved this time.`,
            "You can review and update it, then resubmit for review.",
          ],
        };

  await sendProductNotification({
    to,
    type: copy.type,
    subject: copy.subject,
    heading: copy.heading,
    body: copy.body,
    actionLabel: `Manage ${productName}`,
    actionUrl: `/account/business/${businessId}?tab=products`,
  });
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

  let decided = false;
  if (product.moderation_status === "pending_review") {
    await supabase.from("products").update({ moderation_status: "live" }).eq("id", id);
    decided = true;
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
    decided = true;
  }

  // Only fires when a real state transition just happened above — never
  // for a no-op call (already-live with no pending edit) that changed
  // nothing.
  if (decided) {
    await notifyProductModerationDecision(supabase, product.business_id, product.name, product.business?.name ?? null, "approved");
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

  let decided = false;
  if (product.moderation_status === "pending_review") {
    await supabase.from("products").update({ moderation_status: "rejected" }).eq("id", id);
    decided = true;
  } else if (product.pending_changes) {
    await supabase.from("products").update({ pending_changes: null }).eq("id", id);
    decided = true;
  }

  if (decided) {
    await notifyProductModerationDecision(supabase, product.business_id, product.name, product.business?.name ?? null, "rejected");
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
    .select("id, name, slug, business_id, moderation_status, marketplace_status")
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

  // Marketplace Approval Safety V1 — this action must never be the path
  // that takes a product straight from "catalog_only" (or "rejected") to
  // "approved". The UI already only ever renders the Approve button for a
  // "submitted" product (see MarketplaceReviewPanel), but this guard makes
  // that a real server-side requirement rather than something only the UI
  // happens to enforce.
  if (product.marketplace_status !== "submitted") {
    redirect(
      errorRedirectUrl(`/admin/products/${id}`, "This product hasn't been submitted to Marketplace — nothing to approve.")
    );
  }

  if (product.moderation_status !== "live") {
    redirect(
      errorRedirectUrl(`/admin/products/${id}`, "Approve this product's content first — Marketplace approval requires it to be live.")
    );
  }

  await supabase
    .from("products")
    .update({ marketplace_status: "approved", marketplace_approved_at: new Date().toISOString() })
    .eq("id", id);
  await notifyMarketplaceDecision(supabase, product.business_id, product.name, "approved");

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
  await notifyMarketplaceDecision(supabase, product.business_id, product.name, "rejected");

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
  await notifyMarketplaceDecision(supabase, product.business_id, product.name, "paused");

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

  // Marketplace Lifecycle QA pass — same bypass this action's sibling
  // (approveMarketplaceSubmission) was already guarded against: without
  // this, a catalog_only/submitted/rejected product could be pushed
  // straight to "approved" via this action (the UI only ever renders its
  // button for a "paused" product, but that was never a server-side
  // requirement until now).
  if (product.marketplace_status !== "paused") {
    redirect(
      errorRedirectUrl(`/admin/products/${id}`, "This product isn't paused — nothing to resume.")
    );
  }

  if (product.moderation_status !== "live") {
    redirect(
      errorRedirectUrl(`/admin/products/${id}`, "Approve this product's content first — Marketplace approval requires it to be live.")
    );
  }

  await supabase.from("products").update({ marketplace_status: "approved" }).eq("id", id);
  await notifyMarketplaceDecision(supabase, product.business_id, product.name, "resumed");

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${id}`);
  revalidatePath("/marketplace");
  redirect(`/admin/products/${id}?marketplace_approved=1`);
}

// ── Admin Product Distribution Control V1 ───────────────────────────────
//
// Two NEW admin-initiated actions, distinct from the owner-submission-
// driven pair above (approveMarketplaceSubmission/rejectMarketplaceSubmission)
// and from the owner's own submitProductToMarketplace/returnProductToCatalog
// (account/business/actions.ts, untouched). Founder Admin now has a direct
// lever independent of whether the owner ever submitted anything — but
// content moderation stays the one gate neither path can bypass: both
// actions below still require moderation_status='live' before granting
// Marketplace distribution, exactly like every existing Marketplace action
// already does.
//
// Neither action here ever touches moderation_status, pending_changes,
// is_featured, home_sort_order, purchasable, fee columns
// (marketplace_fee_override_percent/processing_fee_payer_override),
// business_id, or plan_tier — only marketplace_status (plus
// marketplace_approved_at, the same timestamp approveMarketplaceSubmission
// already sets). is_featured is deliberately left untouched on Return to
// Catalog too — existing Marketplace/homepage-featured queries already
// require marketplace_status='approved', so a catalog_only product simply
// stops surfacing there on its own; preserving the flag lets editorial
// priority resume automatically if the product is later pushed back.

/** Push to Marketplace — the NEW admin-initiated path into
 * marketplace_status='approved', usable from ANY current status
 * (catalog_only, rejected, submitted, or even paused) without requiring
 * the owner to have submitted first. Still requires moderation_status=
 * 'live' — Marketplace distribution can never bypass content approval,
 * regardless of which path got the product here. Idempotent: already
 * "approved" is treated as a safe no-op success, not an error. */
export async function pushProductToMarketplace(id: string) {
  const supabase = await requireAdminSupabase();
  const product = await getProductForMarketplaceReview(supabase, id);
  if (!product) redirect(errorRedirectUrl("/admin/products", "Product not found."));

  if (product.marketplace_status === "approved") {
    redirect(`/admin/products/${id}?marketplace_approved=1`);
  }

  if (product.moderation_status !== "live") {
    redirect(
      errorRedirectUrl(
        `/admin/products/${id}`,
        "Approve this product's content first — Marketplace distribution requires it to be live."
      )
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

/** Return to Catalog — the NEW admin-initiated withdrawal from Marketplace
 * distribution, usable from ANY current status. The Product stays fully
 * intact on its own business's catalog/profile (moderation_status,
 * content, fee columns, plan_tier, ownership, and is_featured are all
 * untouched — see this file's own section note above). Distinct from the
 * owner's own returnProductToCatalog (account/business/actions.ts), which
 * stays untouched and still only self-reverts from "submitted"/"rejected"
 * — this admin action works from any state, including an admin-"approved"
 * or admin-"paused" one the owner could never self-revert. Idempotent:
 * already "catalog_only" is a safe no-op success. */
export async function returnProductToCatalog(id: string) {
  const supabase = await requireAdminSupabase();
  const product = await getProductForMarketplaceReview(supabase, id);
  if (!product) redirect(errorRedirectUrl("/admin/products", "Product not found."));

  if (product.marketplace_status === "catalog_only") {
    redirect(`/admin/products/${id}?marketplace_returned=1`);
  }

  await supabase.from("products").update({ marketplace_status: "catalog_only" }).eq("id", id);

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${id}`);
  revalidatePath("/marketplace");
  if (product.slug) revalidatePath(`/product/${product.slug}`);
  redirect(`/admin/products/${id}?marketplace_returned=1`);
}
