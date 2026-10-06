import "server-only";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";
import { isAdminSession } from "@/lib/admin/auth";
import { requireBusinessMember, type Membership } from "@/lib/permissions";
import { isBusinessPro } from "@/lib/entitlements";
import { getAccountContexts } from "@/lib/accountContext";
import { getPersonalDisplayName } from "@/lib/personalGraph";

/** Same authorization + BusinessAppShell inputs the main
 * /account/business/[id] page derives (login bounce, requireBusinessMember,
 * account contexts, personal label, Pro state), for a sub-route that
 * renders inside the same shell. */
export async function loadBusinessShell(id: string, nextPath: string) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user && !(await isAdminSession())) redirect(`/login?next=${encodeURIComponent(nextPath)}`);

  let membership: Membership;
  try {
    membership = await requireBusinessMember(id);
  } catch (err) {
    redirect(errorRedirectUrl("/account", err instanceof Error ? err.message : "You don't have access to that business."));
  }

  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl("/account", "Server isn't configured."));

  const [{ data: business }, contexts, displayName] = await Promise.all([
    admin.from("businesses").select("id, name, slug, logo_url, plan_tier, plan_expires_at").eq("id", id).maybeSingle(),
    user ? getAccountContexts(supabase, user.id) : Promise.resolve([] as Awaited<ReturnType<typeof getAccountContexts>>),
    user ? getPersonalDisplayName(supabase, user.id) : Promise.resolve(null),
  ]);
  if (!business) redirect(errorRedirectUrl("/account", "Business not found."));

  const pro = isBusinessPro(business);
  return {
    membership,
    shell: {
      basePath: `/account/business/${id}`,
      business: { id, name: business.name as string, slug: (business.slug as string | null) ?? null, logoUrl: (business.logo_url as string | null) ?? null },
      pro,
      isExpiredPro: !pro && (business.plan_tier === "pro" || business.plan_tier === "pro_seller"),
      personalLabel: displayName || "Your Findmi Account",
      managedBusinesses: contexts,
      isAdminElevated: Boolean(membership.viaAdmin),
    },
  };
}
