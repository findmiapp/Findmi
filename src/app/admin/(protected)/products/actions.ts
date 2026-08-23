"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { isProductSlugTaken } from "@/lib/admin/queries";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";

export async function saveProduct(id: string | null, formData: FormData) {
  const supabase = getAdminSupabase();
  const editPath = id ? `/admin/products/${id}` : "/admin/products/new";
  if (!supabase) redirect(errorRedirectUrl(editPath, "Server isn't configured for writes."));

  const businessId = str(formData, "business_id");
  const name = str(formData, "name");
  const slug = str(formData, "slug");
  if (!businessId || !name || !slug) {
    redirect(errorRedirectUrl(editPath, "Business, name, and slug are required."));
  }

  // The DB constraint is only unique(business_id, slug) — /product/[slug]
  // resolves on the slug alone, so the admin enforces global uniqueness
  // here rather than letting two businesses collide.
  if (await isProductSlugTaken(slug, id ?? undefined)) {
    redirect(
      errorRedirectUrl(
        editPath,
        `The slug "${slug}" is already used by another product. Choose a different one.`
      )
    );
  }

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

  revalidatePath("/admin/products");
  revalidatePath(`/product/${slug}`);
  revalidatePath("/");
  redirect(`/admin/products/${productId}?saved=1`);
}

export async function deleteProduct(id: string) {
  const supabase = getAdminSupabase();
  if (!supabase) redirect(errorRedirectUrl("/admin/products", "Server isn't configured for writes."));
  await supabase.from("products").delete().eq("id", id);
  revalidatePath("/admin/products");
  revalidatePath("/");
  redirect("/admin/products");
}
