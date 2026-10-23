import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser, getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";
import { isAdminSession } from "@/lib/admin/auth";
import { requireBusinessMember, type Membership } from "@/lib/permissions";
import { isBusinessPro } from "@/lib/entitlements";
import { getAccountContexts } from "@/lib/accountContext";
import { getPersonalDisplayName } from "@/lib/personalGraph";

/** Business Manager — the shared manager context.
 *
 * Everything every Business Manager destination needs, and nothing a single
 * destination needs: who is asking, whether they may manage this Business,
 * the Business row (identity + plan + the profile fields) and the data the
 * persistent shell renders (the account switcher). Each function is wrapped in
 * React's per-request `cache()`, so the layout (the persistent shell) and the
 * page (the content view) can both ask for it and it runs once. A tab switch
 * only re-renders the page, so the shell's pieces are not re-fetched at all.
 *
 * Authorization is NOT skipped on a tab switch: the page calls
 * `getManagerCore` itself, because a layout is not re-run when only the page
 * segment changes. */

/** The Business row the manager reads. `plan_tier` isn't in the public column
 * grant, so this is only ever read through the service-role client, and only
 * once `requireBusinessMember` has passed (see `getManagerCore`). */
export const BUSINESS_COLUMNS =
  "id, name, slug, logo_url, cover_image_url, plan_tier, plan_expires_at, publication_status, short_description, description, city, state, postal_code, country, email, phone, website_url, instagram_url, facebook_url, tiktok_url, bulletin_enabled, bulletin_label, bulletin_heading, bulletin_body, bulletin_url, native_inquiries_enabled, accepts_inquiries, inquiry_topics, inquiry_cta_label, market_area_id, featured_appearance_id";

export const getManagerCore = cache(async (id: string) => {
  const user = await getCurrentUser();
  // Same defense-in-depth bounce every /account page does; Admin Manage-As
  // lets a founder admin session through with no personal Supabase user.
  if (!user && !(await isAdminSession())) redirect(`/login?next=${encodeURIComponent(`/account/business/${id}`)}`);

  const admin = getAdminSupabase();

  // Authorization and the Business row are independent reads, so they share
  // one round trip. The row is only used once authorization has passed — a
  // failed check redirects before anything below it is returned.
  const [membershipResult, businessResult] = await Promise.all([
    requireBusinessMember(id).then(
      (membership) => ({ ok: true as const, membership }),
      (err: unknown) => ({ ok: false as const, err })
    ),
    admin ? admin.from("businesses").select(BUSINESS_COLUMNS).eq("id", id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!membershipResult.ok) {
    const message = membershipResult.err instanceof Error ? membershipResult.err.message : "You don't have access to that business.";
    redirect(errorRedirectUrl("/account", message));
  }
  if (!admin) redirect(errorRedirectUrl("/account", "Server isn't configured."));
  const business = businessResult.data;
  if (!business) redirect(errorRedirectUrl("/account", "Business not found."));

  const membership: Membership = membershipResult.membership;
  const pro = isBusinessPro(business);
  return {
    user,
    admin,
    membership,
    membershipRole: membership.role as string,
    isAdminElevated: Boolean(membership.viaAdmin),
    business,
    pro,
    // plan_tier still 'pro'/'pro_seller' while `pro` is false = a lapsed term.
    isExpiredPro: !pro && (business.plan_tier === "pro" || business.plan_tier === "pro_seller"),
  };
});

/** The persistent shell's own data: the signed-in person's other contexts and
 * display label for the account switcher. Only the layout reads this. */
export const getShellExtras = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return { managedBusinesses: [] as Awaited<ReturnType<typeof getAccountContexts>>, personalLabel: "Your Findmi Account" };
  const supabase = await getServerSupabase();
  const [managedBusinesses, displayName] = await Promise.all([getAccountContexts(supabase, user.id), getPersonalDisplayName(supabase, user.id)]);
  return { managedBusinesses, personalLabel: displayName || "Your Findmi Account" };
});

/** Props for `BusinessAppShell` — identity, plan and the switcher data. */
export async function getManagerShellProps(id: string) {
  const [core, extras] = await Promise.all([getManagerCore(id), getShellExtras()]);
  return {
    basePath: `/account/business/${id}`,
    business: {
      id,
      name: core.business.name as string,
      slug: (core.business.slug as string | null) ?? null,
      logoUrl: (core.business.logo_url as string | null) ?? null,
    },
    pro: core.pro,
    isExpiredPro: core.isExpiredPro,
    personalLabel: extras.personalLabel,
    managedBusinesses: extras.managedBusinesses,
    isAdminElevated: core.isAdminElevated,
  };
}
