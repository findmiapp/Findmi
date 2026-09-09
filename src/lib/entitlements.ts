import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import type { Business, PlanTier } from "./types";

/**
 * Business Plan Entitlement — the one shared resolver every Pro-gated
 * feature should call instead of re-reading business.plan_tier directly,
 * so the actual "what counts as Pro" rule lives in exactly one place.
 * Wired into the Free/Pro member editor allowlist (account/business/
 * actions.ts), /upgrade/pro, and admin's BusinessForm.
 *
 * Deliberately BUSINESS-level, not user-level: a business's plan is a
 * property of the business itself, entirely independent of which role
 * (owner/manager/staff — business_members.role) the current viewer holds
 * on it. Never gate on plan by checking a user's role, and never gate a
 * role check by plan — the two stay separate concepts.
 *
 * pro_seller (Native Business Onboarding, Pass 1) is a FUTURE-ONLY third
 * tier — no seller checkout/Stripe Connect/commissions/payouts/UI exists
 * yet, nothing writes this value anywhere. It's handled here already so
 * that when Seller work does start, every existing Pro-gated feature
 * automatically keeps working for it: isBusinessPro treats pro_seller as
 * Pro (a Pro Seller must never lose Pro entitlements), and the future
 * seller-only surface gates on isBusinessProSeller instead, never on a
 * raw plan_tier === "pro_seller" comparison scattered around the app.
 */
export function isBusinessPro(business: Pick<Business, "plan_tier">): boolean {
  return isPlanTierPro(business.plan_tier);
}

/** Same resolver for a bare plan_tier value, for a caller that only has
 * that one column (e.g. a narrow admin query) rather than a full Business
 * row. isBusinessPro above delegates here so both agree by construction.
 * True for "pro" AND "pro_seller" — Pro Seller inherits every Pro
 * entitlement, it's never a lesser or separate tier for Pro-gated
 * features. */
export function isPlanTierPro(planTier: PlanTier | null | undefined): boolean {
  return planTier === "pro" || planTier === "pro_seller";
}

/** True ONLY for pro_seller — the future seller-only entitlement check
 * (marketplace selling features, once built). Currently unused by any
 * caller (nothing in the app is seller-gated yet — see Pass 1's own
 * scope), provided now so that future work has one canonical place to
 * check it rather than a scattered plan_tier === "pro_seller" comparison. */
export function isBusinessProSeller(business: Pick<Business, "plan_tier">): boolean {
  return isPlanTierProSeller(business.plan_tier);
}

/** Bare-value counterpart to isBusinessProSeller, same relationship as
 * isPlanTierPro above. */
export function isPlanTierProSeller(planTier: PlanTier | null | undefined): boolean {
  return planTier === "pro_seller";
}

/**
 * Markets Foundation V1 / Market Management + Plan Market Allowances V1
 * — the one centralized resolver for how many FindMi Markets
 * (business_markets rows, active primary + additional COMBINED — never
 * "1 primary + N additional") a business is entitled to hold. Callers
 * must always go through this function rather than re-deriving the
 * number from plan_tier themselves, so a later change only ever needs to
 * change the body of this one function, never its callers.
 *
 * The allowance is now founder-configurable per plan_tier (see
 * /admin/plans' "Business Plan Market Allowance" section) via the
 * plan_market_limits table, rather than hardcoded here — there is no
 * built-in assumption that Free/Pro/Pro Seller are all 1 (or all equal
 * to each other); the founder can set any of the three independently
 * without a code change. `null` means Unlimited — the same convention
 * membership_plans.market_limit already uses, never a magic sentinel
 * number like 999.
 *
 * A business-level override column doesn't exist in this codebase today,
 * so none is introduced here — the plan's own configured allowance is
 * the sole source of truth.
 */
export async function getBusinessMarketLimit(business: Pick<Business, "plan_tier">): Promise<number | null> {
  return getMarketLimitForPlanTier(business.plan_tier);
}

/**
 * Multi-Entity Self-Service V1 — Event-management entitlement.
 *
 * LOCKED RULE: Events are NOT their own paid subscription. An authenticated
 * user may create a brand-new Event at no additional Event fee if they have
 * qualifying FindMi access through EITHER:
 * (Universal Free Claim UX pass — CLAIMING an existing Event no longer
 * consults this function at all; that's a free ownership/management
 * request now, gated only on authentication + email verification. This
 * entitlement still gates new Event creation and other Event-management
 * capabilities untouched by that pass.)
 *   (a) active paid OR complimentary Business Pro access on ANY business
 *       they belong to (business_members join businesses.plan_tier — Pro
 *       is, and remains, a property of a BUSINESS; Stripe checkout and a
 *       Pro Invite redemption both converge on the same plan_tier value,
 *       so this one check already covers "paid OR complimentary"), OR
 *   (b) Stage 2B addition — an active, non-expired account-level
 *       'event_management' row in account_entitlements, granted directly
 *       to the USER by redeeming an Event-Management-purpose Pro Invite
 *       (redeem_event_management_invite()) with NO Business involved at
 *       all. This is what lets an organizer with zero Businesses qualify
 *       (see the Event Entitlement Edge-Case audit) without fabricating a
 *       placeholder Business or touching any businesses.plan_tier row.
 * A user with zero businesses and no account entitlement, or only Free
 * businesses and no account entitlement, does not qualify.
 *
 * Requires the service-role client because plan_tier isn't in the public
 * column grant (see restrict_internal_commerce_columns), and
 * account_entitlements has zero RLS policies for authenticated/anon (see
 * its own migration) — same authorize-then-elevate shape used everywhere
 * else a caller needs either: the caller already has a verified, real
 * userId (from its own getServerSupabase().auth.getUser() call) before
 * this ever runs; this function itself trusts that userId completely, the
 * same way every other admin-client read in this codebase trusts an
 * already-authorized id.
 *
 * IMPORTANT — this is a ONE-WAY OR: account_entitlements is consulted
 * ONLY by this function. No Business Pro feature check anywhere in the
 * codebase (isBusinessPro, the Business Manager's Pro-gated tabs, product
 * limits, etc.) reads account_entitlements, and this function never
 * writes to businesses.plan_tier — an account 'event_management' grant
 * unlocks Event management ONLY, never any Business Pro feature.
 */
export async function canCurrentUserManageEvents(admin: SupabaseClient, userId: string): Promise<boolean> {
  const [{ data: memberships }, { data: entitlements }] = await Promise.all([
    admin.from("business_members").select("businesses(plan_tier)").eq("user_id", userId),
    admin
      .from("account_entitlements")
      .select("expires_at")
      .eq("user_id", userId)
      .eq("entitlement_key", "event_management"),
  ]);

  type MembershipRow = { businesses: { plan_tier: PlanTier } | { plan_tier: PlanTier }[] | null };
  const hasBusinessPro = ((memberships ?? []) as MembershipRow[]).some((row) => {
    const business = Array.isArray(row.businesses) ? row.businesses[0] : row.businesses;
    return business ? isPlanTierPro(business.plan_tier) : false;
  });
  if (hasBusinessPro) return true;

  const now = Date.now();
  type EntitlementRow = { expires_at: string | null };
  return ((entitlements ?? []) as EntitlementRow[]).some(
    (row) => row.expires_at === null || new Date(row.expires_at).getTime() > now
  );
}

/** Bare-value counterpart to getBusinessMarketLimit, same relationship as
 * isPlanTierPro above — for a caller that only has the plan_tier column
 * (e.g. a narrow admin query) rather than a full Business row. Reads the
 * founder-configured plan_market_limits row for this tier (public-read
 * RLS — same posture as membership_plans); defaults to the conservative
 * 1-Market allowance only when Supabase isn't configured or no row
 * exists yet for this tier (should not happen post-migration, since the
 * migration seeds all three), never to Unlimited. */
export async function getMarketLimitForPlanTier(planTier: PlanTier | null | undefined): Promise<number | null> {
  const tier: PlanTier = planTier ?? "free";
  const supabase = getSupabase();
  if (!supabase) return 1;
  const { data } = await supabase
    .from("plan_market_limits")
    .select("market_limit")
    .eq("plan_tier", tier)
    .maybeSingle();
  if (!data) return 1;
  return data.market_limit; // null = Unlimited, passed through as-is
}
