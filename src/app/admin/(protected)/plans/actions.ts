"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, num, str } from "@/lib/admin/form-helpers";

export async function savePlans(formData: FormData) {
  const supabase = await requireAdminSupabase();

  const allPlanIds = formData.getAll("all_plan_ids").map(String);

  for (const id of allPlanIds) {
    await supabase
      .from("membership_plans")
      .update({
        annual_price: num(formData, `price_${id}`) ?? 0,
        market_limit: num(formData, `market_limit_${id}`), // blank -> null -> unlimited
        active: bool(formData, `active_${id}`),
        publicly_available: bool(formData, `public_${id}`),
        featured_placement_eligible: bool(formData, `featured_${id}`),
        enhanced_profile: bool(formData, `enhanced_${id}`),
        campaign_eligible: bool(formData, `campaign_${id}`),
        description: str(formData, `description_${id}`),
      })
      .eq("id", id);
  }

  revalidatePath("/admin/plans");
  revalidatePath("/join");
  redirect("/admin/plans?saved=1");
}
