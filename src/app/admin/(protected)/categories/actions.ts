"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, num } from "@/lib/admin/form-helpers";

export async function saveHomeCategories(formData: FormData) {
  const supabase = await requireAdminSupabase();

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
