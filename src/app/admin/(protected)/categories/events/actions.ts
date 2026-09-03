"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { errorRedirectUrl, str } from "@/lib/admin/form-helpers";
import { createCategoryRow, deleteCategoryRow, saveCategoryRows, type CategoryRowEdit } from "@/lib/admin/categoryForm";

const EDIT_PATH = "/admin/categories/events";

/** Creates a new event-kind row in the shared `categories` table (Part 4
 * of the 2026 nav/QA pass — the one real gap: there was no admin way to
 * create a category at all, business or event). The new category is
 * immediately available to tag onto events from that event's own edit
 * page (see EventForm's "Categories / Experience" checklist — assignment
 * already worked, creation didn't). Same shared slug utility as every
 * other public entity's create/edit form — see lib/slug — so taxonomy
 * records don't need their own separate slug logic. Post-taxonomy-pass:
 * "event-kind" now, not the old undifferentiated shared table. */
export async function createCategory(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const result = await createCategoryRow(supabase, "event", formData);
  if (result.error) redirect(errorRedirectUrl(EDIT_PATH, result.error));

  revalidatePath(EDIT_PATH);
  revalidatePath("/admin/categories");
  redirect(`${EDIT_PATH}?saved=1`);
}

/** Bulk-saves name/slug edits for every existing event category at once —
 * same "one form, all rows" shape as the Business Categories screen. No
 * show_on_home/home_sort_order here — that concept is business-specific. */
export async function saveEventCategories(formData: FormData) {
  const supabase = await requireAdminSupabase();

  const allCategoryIds = formData.getAll("all_category_ids").map(String);
  const rows: CategoryRowEdit[] = allCategoryIds.map((id) => ({
    id,
    name: str(formData, `name_${id}`),
    slug: str(formData, `slug_${id}`),
  }));

  const result = await saveCategoryRows(supabase, "event", rows);
  if (result.error) redirect(errorRedirectUrl(EDIT_PATH, result.error));

  revalidatePath(EDIT_PATH);
  redirect(`${EDIT_PATH}?saved=1`);
}

/** Category Admin Usability pass — Delete. Re-checks usage server-side
 * regardless of the UI already disabling this for an in-use category.
 * No redirect on success, so the search box/scroll position stays put. */
export async function deleteEventCategory(id: string) {
  const supabase = await requireAdminSupabase();
  const result = await deleteCategoryRow(supabase, "event", id);
  if (result.error) redirect(errorRedirectUrl(EDIT_PATH, result.error));
  revalidatePath(EDIT_PATH);
}
