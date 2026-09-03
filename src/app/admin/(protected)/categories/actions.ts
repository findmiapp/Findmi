"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";
import {
  createCategoryRow,
  deleteCategoryRow,
  reorderBusinessCategory,
  saveCategoryRows,
  type CategoryRowEdit,
} from "@/lib/admin/categoryForm";

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

/** Category Admin Usability pass — Move Up/Down. No redirect on success:
 * same pattern as events/actions.ts's per-occurrence vendor actions
 * (revalidatePath only), so the admin stays exactly where they were —
 * including whatever they'd typed into the search box — rather than a
 * navigation resetting client state for a small in-place reorder. */
export async function moveBusinessCategory(id: string, direction: "up" | "down") {
  const supabase = await requireAdminSupabase();
  const result = await reorderBusinessCategory(supabase, id, direction);
  if (result.error) redirect(errorRedirectUrl(EDIT_PATH, result.error));
  revalidatePath(EDIT_PATH);
}

/** Category Admin Usability pass — Delete. Re-checks usage server-side
 * (see deleteCategoryRow) regardless of the UI already disabling this
 * for an in-use category — never trusts the client alone. No redirect on
 * success, same reasoning as moveBusinessCategory above. */
export async function deleteBusinessCategory(id: string) {
  const supabase = await requireAdminSupabase();
  const result = await deleteCategoryRow(supabase, "business", id);
  if (result.error) redirect(errorRedirectUrl(EDIT_PATH, result.error));
  revalidatePath(EDIT_PATH);
}
