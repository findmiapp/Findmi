"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { errorRedirectUrl, str } from "@/lib/admin/form-helpers";
import { createCategoryRow, deleteCategoryRow, saveCategoryRows, type CategoryRowEdit } from "@/lib/admin/categoryForm";

const EDIT_PATH = "/admin/categories/locations";

/** Location V2 — creates a new location-kind row in the shared
 * `categories` table (same table Business/Event/Product already use,
 * distinguished by kind — see the migration widening categories_kind_check
 * to allow 'location'). Immediately available to tag onto a Location from
 * that Location's own admin edit page (Category / Subcategory field). */
export async function createLocationCategory(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const result = await createCategoryRow(supabase, "location", formData);
  if (result.error) redirect(errorRedirectUrl(EDIT_PATH, result.error));

  revalidatePath(EDIT_PATH);
  revalidatePath("/admin/categories");
  redirect(`${EDIT_PATH}?saved=1`);
}

/** Bulk-saves name/slug edits for every existing location category at
 * once — same "one form, all rows" shape as Business/Event Categories. No
 * show_on_home/home_sort_order here — that concept is business-specific. */
export async function saveLocationCategories(formData: FormData) {
  const supabase = await requireAdminSupabase();

  const allCategoryIds = formData.getAll("all_category_ids").map(String);
  const rows: CategoryRowEdit[] = allCategoryIds.map((id) => ({
    id,
    name: str(formData, `name_${id}`),
    slug: str(formData, `slug_${id}`),
  }));

  const result = await saveCategoryRows(supabase, "location", rows);
  if (result.error) redirect(errorRedirectUrl(EDIT_PATH, result.error));

  revalidatePath(EDIT_PATH);
  redirect(`${EDIT_PATH}?saved=1`);
}

/** Re-checks usage server-side regardless of the UI already disabling
 * this for an in-use category. No redirect on success, so the search
 * box/scroll position stays put. */
export async function deleteLocationCategory(id: string) {
  const supabase = await requireAdminSupabase();
  const result = await deleteCategoryRow(supabase, "location", id);
  if (result.error) redirect(errorRedirectUrl(EDIT_PATH, result.error));
  revalidatePath(EDIT_PATH);
}
