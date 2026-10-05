import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemberRole } from "@/lib/permissions";

/** Global Account Context Switcher V1 — the one shared read every shell
 * (Personal, Business, Event Manager, Location Manager) uses to learn
 * which Business contexts a signed-in person may switch into. Business
 * access here is ALWAYS a real `business_members` row for this exact
 * user — never inferred from an Event/Location/Appearance relationship or
 * a `business_id` query hint (those remain navigation hints elsewhere,
 * never authorization, and never context-switcher data). RLS on
 * business_members already scopes SELECT to `auth.uid() = user_id`, so
 * this is safe to call with the plain request-scoped client, same as
 * every other /account business-list read in this app. No schema
 * changes — profiles/business_members/businesses are sufficient. */
export interface AccountBusinessContext {
  id: string;
  name: string;
  slug: string | null;
  logoUrl: string | null;
  role: MemberRole;
}

const ROLE_ORDER: Record<MemberRole, number> = { owner: 0, manager: 1, staff: 2 };

type MembershipRow = {
  role: MemberRole;
  business: { id: string; name: string; slug: string | null; logo_url: string | null } | { id: string; name: string; slug: string | null; logo_url: string | null }[] | null;
};

/** Predictable ordering: owner before manager before staff, alphabetical
 * by name within the same role — never recents/favorites/folders. */
export async function getAccountContexts(supabase: SupabaseClient, userId: string): Promise<AccountBusinessContext[]> {
  const { data } = await supabase
    .from("business_members")
    .select("role, business:businesses(id, name, slug, logo_url)")
    .eq("user_id", userId);

  const contexts = ((data ?? []) as MembershipRow[])
    .map((row) => {
      const b = Array.isArray(row.business) ? row.business[0] : row.business;
      return b ? { id: b.id, name: b.name, slug: b.slug, logoUrl: b.logo_url, role: row.role } : null;
    })
    .filter((b): b is AccountBusinessContext => Boolean(b));

  return contexts.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
}
