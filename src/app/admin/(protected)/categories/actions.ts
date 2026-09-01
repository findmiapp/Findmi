"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";
import { createCategoryRow, saveCategoryRows, type CategoryRowEdit } from "@/lib/admin/categoryForm";

const EDIT_PATH = "/admin/categories";

/** Creates a new business-kind category from the "Add Category" mini-form
 * — the one real gap this screen had before the taxonomy foundation pass
 * (toggling show_on_home/order already worked, creating a category from
 * scratch didn't). */
export async function createBusinessCategory(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const result = await createCategoryRow(supabase, "business", formData);
  if (result.error) redirect(errorRedirectUrl(EDIT_PATH, result.error));

  revalidatePath(EDIT_PATH);
  redirect(`${EDIT_PATH}?saved=1`);
}

/** Bulk-saves every business category row at once — name, slug, homepage
 * visibility, and homepage order, all from the one list-as-form below.
 * Slug safety goes through the same lib/slug utility as every other
 * entity (see saveCategoryRows). */
export async function saveHomeCategories(formData: FormData) {
  const supabase = await requireAdminSupabase();

  const allCategoryIds = formData.getAll("all_category_ids").map(String);
  const rows: CategoryRowEdit[] = allCategoryIds.map((id) => ({
    id,
    name: str(formData, `name_${id}`),
    slug: str(formData, `slug_${id}`),
    show_on_home: bool(formData, `show_${id}`),
    home_sort_order: num(formData, `order_${id}`),
  }));

  const result = await saveCategoryRows(supabase, "business", rows);
  if (result.error) redirect(errorRedirectUrl(EDIT_PATH, result.error));

  revalidatePath(EDIT_PATH);
  revalidatePath("/");
  redirect(`${EDIT_PATH}?saved=1`);
}
