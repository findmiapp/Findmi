"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl, str } from "@/lib/admin/form-helpers";

const EDIT_PATH = "/admin/categories/events";

/** Creates a new row in the shared `categories` table (Part 4 of the 2026
 * nav/QA pass — the one real gap: there was no admin way to create a
 * category at all, business or event). The new category is immediately
 * available to tag onto events from that event's own edit page (see
 * EventForm's existing "Categories / Experience" checklist — assignment
 * already worked, creation didn't). */
export async function createCategory(formData: FormData) {
  const supabase = getAdminSupabase();
  if (!supabase) redirect(errorRedirectUrl(EDIT_PATH, "Server isn't configured for writes."));

  const name = str(formData, "name");
  const slug = str(formData, "slug");
  if (!name || !slug) redirect(errorRedirectUrl(EDIT_PATH, "Name and slug are both required."));

  const { error } = await supabase.from("categories").insert({ name, slug, show_on_home: false });
  if (error) redirect(errorRedirectUrl(EDIT_PATH, error.message));

  revalidatePath(EDIT_PATH);
  revalidatePath("/admin/categories");
  redirect(`${EDIT_PATH}?saved=1`);
}
