"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { errorRedirectUrl, str } from "@/lib/admin/form-helpers";
import { createCategoryRow, deleteCategoryRow, saveCategoryRows, type CategoryRowEdit } from "@/lib/admin/categoryForm";

// Event Formats V1 — the controlled vocabulary of HOW an Event is
// experienced: kind='event_format' rows in the shared `categories` table,
// managed with the same shared category machinery (lib/admin/categoryForm)
// as every other category screen. Flat — no parent/child. Assigned to
// Events (zero-to-many) from each Event's own edit page.
const EDIT_PATH = "/admin/categories/formats";

/** Creates a new Event Format (kind='event_format'), slug normalized and
 * deduplicated server-side by the shared category helper. */
export async function createEventFormat(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const result = await createCategoryRow(supabase, "event_format", formData);
  if (result.error) redirect(errorRedirectUrl(EDIT_PATH, result.error));

  revalidatePath(EDIT_PATH);
  revalidatePath("/admin/categories");
  redirect(`${EDIT_PATH}?saved=1`);
}

/** Bulk-saves name/slug edits for every Event Format at once —
 * same "one form, all rows" shape as the Business Categories screen. No
 * show_on_home/home_sort_order here — that concept is business-specific. */
export async function saveEventFormats(formData: FormData) {
  const supabase = await requireAdminSupabase();

  const allCategoryIds = formData.getAll("all_category_ids").map(String);
  const rows: CategoryRowEdit[] = allCategoryIds.map((id) => ({
    id,
    name: str(formData, `name_${id}`),
    slug: str(formData, `slug_${id}`),
  }));

  const result = await saveCategoryRows(supabase, "event_format", rows);
  if (result.error) redirect(errorRedirectUrl(EDIT_PATH, result.error));

  revalidatePath(EDIT_PATH);
  redirect(`${EDIT_PATH}?saved=1`);
}

/** Category Admin Usability pass — Delete. Re-checks usage server-side
 * regardless of the UI already disabling this for an in-use category.
 * No redirect on success, so the search box/scroll position stays put. */
export async function deleteEventFormat(id: string) {
  const supabase = await requireAdminSupabase();
  const result = await deleteCategoryRow(supabase, "event_format", id);
  if (result.error) redirect(errorRedirectUrl(EDIT_PATH, result.error));
  revalidatePath(EDIT_PATH);
}
