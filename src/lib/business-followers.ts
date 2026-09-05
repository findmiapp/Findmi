import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicProfilesByUserIds } from "./profiles";
import type { PublicProfile } from "./types";

export interface BusinessFollowerSummary {
  /** Total audience — legacy email-capture rows plus authenticated
   * account follows. These two pools can't be safely deduped (a legacy
   * follower is identified only by email, an account follower only by
   * user_id — see this pass's own report on why guessing that overlap
   * is unsafe), so this is a sum, not a distinct count. */
  totalCount: number;
  accountCount: number;
  legacyCount: number;
  /** Public-safe identity chips for the subset of account followers who
   * have completed a public profile (username set) — never more than
   * PROFILE_PREVIEW_LIMIT, newest first. A follower with an authenticated
   * account but no username yet is counted in accountCount/totalCount
   * above but never appears here — exactly the "count them, don't expose
   * a private fallback identity" rule this pass requires. */
  profiles: PublicProfile[];
}

const PROFILE_PREVIEW_LIMIT = 24;

/** Server/service-role only — called from Business Manager pages that
 * have ALREADY verified the caller is an authorized member of this exact
 * business (requireBusinessMember), same authorize-then-elevate pattern
 * every other owner-facing admin-client read in that page already uses.
 * Never exposes raw user_id, email, or any auth-adjacent field to the
 * caller — only counts and (for the subset with a public username) the
 * same PublicProfile shape /user/[username] itself renders. */
export async function getBusinessFollowerSummary(
  admin: SupabaseClient,
  businessId: string
): Promise<BusinessFollowerSummary> {
  const [{ count: legacyCount }, { data: accountRows, count: accountCount }] = await Promise.all([
    admin.from("followers").select("id", { count: "exact", head: true }).eq("business_id", businessId),
    admin
      .from("account_followed_businesses")
      .select("user_id", { count: "exact" })
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(PROFILE_PREVIEW_LIMIT),
  ]);

  const userIds = ((accountRows ?? []) as { user_id: string }[]).map((r) => r.user_id);
  const profileMap = await getPublicProfilesByUserIds(admin, userIds);
  // Preserve the newest-first order from accountRows rather than
  // whatever order the profiles query happens to return.
  const profiles = userIds.map((id) => profileMap.get(id)).filter((p): p is PublicProfile => Boolean(p));

  return {
    totalCount: (legacyCount ?? 0) + (accountCount ?? 0),
    accountCount: accountCount ?? 0,
    legacyCount: legacyCount ?? 0,
    profiles,
  };
}
