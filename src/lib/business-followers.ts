import type { SupabaseClient } from "@supabase/supabase-js";

export interface BusinessFollowerSummary {
  /** Total audience — legacy email-capture rows plus authenticated
   * account follows. These two pools can't be safely deduped (a legacy
   * follower is identified only by email, an account follower only by
   * user_id), so this is a sum, not a distinct count. */
  totalCount: number;
  accountCount: number;
  legacyCount: number;
  /** Follows started in the last 30 days (both pools). Aggregate only. */
  newLast30Days: number;
}

const GROWTH_WINDOW_DAYS = 30;

/** Server/service-role only — called from Business Manager pages that
 * have ALREADY verified the caller is an authorized member of this exact
 * business (requireBusinessMember).
 *
 * Follower privacy (Trust & Privacy Phase 2A): a Business receives
 * AGGREGATE audience information only (totals and recent growth). Clicking
 * Follow never hands a Business the follower's name, username, avatar,
 * bio or location label. Head-only count queries: no follower row, user
 * id or email ever leaves the database through this function. */
export async function getBusinessFollowerSummary(admin: SupabaseClient, businessId: string): Promise<BusinessFollowerSummary> {
  const since = new Date(Date.now() - GROWTH_WINDOW_DAYS * 86_400_000).toISOString();
  const [legacy, account, legacyNew, accountNew] = await Promise.all([
    admin.from("followers").select("id", { count: "exact", head: true }).eq("business_id", businessId),
    admin.from("account_followed_businesses").select("user_id", { count: "exact", head: true }).eq("business_id", businessId),
    admin.from("followers").select("id", { count: "exact", head: true }).eq("business_id", businessId).gte("created_at", since),
    admin.from("account_followed_businesses").select("user_id", { count: "exact", head: true }).eq("business_id", businessId).gte("created_at", since),
  ]);
  const legacyCount = legacy.count ?? 0;
  const accountCount = account.count ?? 0;
  return {
    totalCount: legacyCount + accountCount,
    accountCount,
    legacyCount,
    newLast30Days: (legacyNew.count ?? 0) + (accountNew.count ?? 0),
  };
}
