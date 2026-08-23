"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { bool, errorRedirectUrl, num } from "@/lib/admin/form-helpers";

export async function saveHomeCategories(formData: FormData) {
  const supabase = getAdminSupabase();
  if (!supabase) redirect(errorRedirectUrl("/admin/categories", "Server isn't configured for writes."));

  const allCategoryIds = formData.getAll("all_category_ids").map(String);

  for (const id of allCategoryIds) {
    const show_on_home = bool(formData, `show_${id}`);
    const home_sort_order = num(formData, `order_${id}`);
    await supabase.from("categories").update({ show_on_home, home_sort_order }).eq("id", id);
  }

  revalidatePath("/admin/categories");
  revalidatePath("/");
  redirect("/admin/categories?saved=1");
}
