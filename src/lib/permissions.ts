import { getServerSupabase } from "@/lib/supabase/server";

export type MemberRole = "owner" | "manager" | "staff";

export interface Membership {
  id: string;
  role: MemberRole;
}

/** Foundation-only helpers for future authenticated business/event
 * workspace features (no vendor/organizer dashboard exists yet — nothing
 * calls these today). Both require a real Supabase Auth session and check
 * the actual membership table (business_members/event_members), which is
 * only ever populated via founder-approved claims
 * (approve_business_claim()/approve_event_claim() in the claim foundation
 * migration) — a claim_requests row, pending or otherwise, is never
 * authorization on its own. RLS on both membership tables already scopes
 * SELECT to `auth.uid() = user_id`, so the query below can only ever see
 * the calling user's own row regardless of what businessId/eventId is
 * passed in — these helpers don't themselves need to re-derive that, but
 * still filter by the session's own user.id explicitly, same
 * defense-in-depth discipline as the rest of the app's authenticated
 * queries. */

async function requireMembership(table: "business_members" | "event_members", column: "business_id" | "event_id", entityId: string): Promise<Membership> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data } = await supabase.from(table).select("id, role").eq("user_id", user.id).eq(column, entityId).maybeSingle();
  if (!data) throw new Error("You don't have access to this business or event.");

  return data as Membership;
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
