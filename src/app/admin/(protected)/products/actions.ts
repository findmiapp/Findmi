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
