import { getServerSupabase } from "@/lib/supabase/server";
import { isAdminSession } from "@/lib/admin/auth";

export type MemberRole = "owner" | "manager" | "staff";

export interface Membership {
  id: string;
  role: MemberRole;
  /** Admin Manage-As Foundation — true only when this Membership was
   * synthesized for a founder admin session with NO real business_members/
   * event_members row of their own. Never a real row, never persisted,
   * never a fabricated membership — the founder's own ADMIN_PASSWORD
   * session cookie (the exact same one requireAdminSupabase() checks) is
   * the actor throughout, checked fresh on every call, only AFTER a real
   * membership lookup has already failed. Every existing caller that only
   * awaits this function for its throw-or-succeed side effect (which is
   * all of them today — confirmed by inspection) is completely unaffected
   * by this field's presence; a caller that needs to render an "Admin
   * mode" banner reads it explicitly. */
  viaAdmin?: boolean;
}

/** Foundation helpers for authenticated business/event workspace features.
 * Real ownership is still exactly business_members/event_members, only
 * ever populated via founder-approved claims (approve_business_claim()/
 * approve_event_claim() in the claim foundation migration) — a
 * claim_requests row, pending or otherwise, is never authorization on its
 * own. RLS on both membership tables already scopes SELECT to
 * `auth.uid() = user_id`, so the query below can only ever see the
 * calling user's own row regardless of what businessId/eventId is passed
 * in — these helpers don't themselves need to re-derive that, but still
 * filter by the session's own user.id explicitly, same defense-in-depth
 * discipline as the rest of the app's authenticated queries.
 *
 * Admin Manage-As Foundation — when no real membership row exists for the
 * caller (including when there is no Supabase Auth session at all), a
 * valid founder admin session is checked as a fallback SECOND (never
 * instead of) the real membership lookup, so a genuine owner is never
 * routed through the admin path just because they also happen to hold an
 * admin session. This is deliberately the one place this bypass lives —
 * every action/page that already calls requireBusinessMember()/
 * requireEventMember() (directly, or via a local wrapper like
 * requireProBusinessMember) inherits Manage-As for free, with no other
 * code needing to change. */
async function requireMembership(
  table: "business_members" | "event_members" | "location_members",
  column: "business_id" | "event_id" | "location_id",
  entityId: string
): Promise<Membership> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data } = await supabase.from(table).select("id, role").eq("user_id", user.id).eq(column, entityId).maybeSingle();
    if (data) return data as Membership;
  }

  if (await isAdminSession()) {
    return { id: "admin-override", role: "owner", viaAdmin: true };
  }

  throw new Error("You don't have access to this business, event, or location.");
}

/** Throws unless the current authenticated session has a business_members
 * row for this business. Returns that row (id + role) on success. */
export async function requireBusinessMember(businessId: string): Promise<Membership> {
  return requireMembership("business_members", "business_id", businessId);
}

/** Throws unless the current authenticated session has an event_members
 * row for this event. Returns that row (id + role) on success. */
export async function requireEventMember(eventId: string): Promise<Membership> {
  return requireMembership("event_members", "event_id", eventId);
}

/** Multi-Entity Self-Service V1, Stage 3 — throws unless the current
 * authenticated session has a location_members row for this location (or
 * an explicit founder admin session — see requireMembership's own
 * comment). Location ownership is deliberately its own independent
 * membership table, never derived from business_members — see this
 * stage's Locked Product Model (Location ownership does NOT depend on
 * Business ownership). */
export async function requireLocationMember(locationId: string): Promise<Membership> {
  return requireMembership("location_members", "location_id", locationId);
}
