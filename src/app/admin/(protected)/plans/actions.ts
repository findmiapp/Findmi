"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";
import type { PlanTier } from "@/lib/types";

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

const PLAN_TIERS: PlanTier[] = ["free", "pro", "pro_seller"];

/** Market Management + Plan Market Allowances V1 — saves the Free/Pro/
 * Pro Seller "Market Allowance" (plan_market_limits), the configurable
 * backing store for lib/entitlements.ts's getBusinessMarketLimit. A
 * SEPARATE system from savePlans above (membership_plans, the legacy
 * Founding Membership funnel) — this section governs the business
 * plan_tier column's own Market entitlement instead.
 *
 * Blank input = Unlimited (null), matching the exact convention
 * membership_plans.market_limit already uses elsewhere on this same
 * page. Server-side validated: an explicit value must be a positive
 * integer — zero, negative, or non-numeric input is rejected with the
 * same visible error banner every other save on this page uses, rather
 * than silently coercing to some other number. */
export async function savePlanMarketLimits(formData: FormData) {
  const supabase = await requireAdminSupabase();

  for (const tier of PLAN_TIERS) {
    const raw = str(formData, `market_limit_${tier}`);
    let marketLimit: number | null;
    if (raw === null) {
      marketLimit = null; // blank field -> Unlimited
    } else {
      const parsed = num(formData, `market_limit_${tier}`);
      if (parsed === null || !Number.isInteger(parsed) || parsed < 1) {
        redirect(
          errorRedirectUrl(
            "/admin/plans",
            `Market Allowance for ${tier} must be a whole number of 1 or more, or left blank for Unlimited.`
          )
        );
      }
      marketLimit = parsed;
    }
    const { error } = await supabase
      .from("plan_market_limits")
      .update({ market_limit: marketLimit, updated_at: new Date().toISOString() })
      .eq("plan_tier", tier);
    if (error) redirect(errorRedirectUrl("/admin/plans", error.message));
  }

  revalidatePath("/admin/plans");
  redirect("/admin/plans?saved=1");
}
