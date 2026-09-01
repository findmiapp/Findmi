"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { errorRedirectUrl, str } from "@/lib/admin/form-helpers";
import { createCategoryRow, saveCategoryRows, type CategoryRowEdit } from "@/lib/admin/categoryForm";

const EDIT_PATH = "/admin/categories/products";

/** Creates a new product-kind category — first-class product taxonomy,
 * separate from a product's selling business's category. Assign it to a
 * specific product from that product's own edit page. */
export async function createCategory(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const result = await createCategoryRow(supabase, "product", formData);
  if (result.error) redirect(errorRedirectUrl(EDIT_PATH, result.error));

  revalidatePath(EDIT_PATH);
  revalidatePath("/admin/categories");
  redirect(`${EDIT_PATH}?saved=1`);
}

/** Bulk-saves name/slug edits for every existing product category at
 * once — same "one form, all rows" shape as the other two category
 * screens. */
export async function saveProductCategories(formData: FormData) {
  const supabase = await requireAdminSupabase();

  const allCategoryIds = formData.getAll("all_category_ids").map(String);
  const rows: CategoryRowEdit[] = allCategoryIds.map((id) => ({
    id,
    name: str(formData, `name_${id}`),
    slug: str(formData, `slug_${id}`),
  }));

  const result = await saveCategoryRows(supabase, "product", rows);
  if (result.error) redirect(errorRedirectUrl(EDIT_PATH, result.error));

  revalidatePath(EDIT_PATH);
  redirect(`${EDIT_PATH}?saved=1`);
}
