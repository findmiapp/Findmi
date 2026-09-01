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

  // Product categories (product_categories) — same "current-config, not
  // economic history" reasoning as fulfillment options above: nothing
  // else references a specific row, so delete-then-reinsert the submitted
  // set is safe and simpler than diffing.
  const categoryIds = formData.getAll("category_ids").map(String);
  await supabase.from("product_categories").delete().eq("product_id", productId);
  if (categoryIds.length > 0) {
    await supabase
      .from("product_categories")
      .insert(categoryIds.map((category_id) => ({ product_id: productId, category_id })));
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
