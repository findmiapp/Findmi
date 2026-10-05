import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { isAdminSession } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";

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
  /** Business-Hosted Events V1 — set only on an EVENT authorization
   * result derived from the Event's canonical host Business
   * (events.host_business_id): the caller has NO event_members row but is
   * an owner or manager of that host Business. Like viaAdmin, this is
   * never a real row — `id` is a sentinel, never an event_members id (no
   * caller of requireEventMember reads `id`; confirmed by inspection). */
  viaHost?: { businessId: string };
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
 * requireBusinessMemberWithDetails) inherits Manage-As for free, with no
 * other code needing to change. */
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

    // Business-Hosted Events V1 — the ONE additional Event grant: an owner
    // or manager of the Event's canonical host Business. Checked after the
    // real event_members row (a genuine member is never routed through
    // this path) and before the admin fallback. Only events.host_business_id
    // counts — never participation (event_businesses /
    // event_occurrence_businesses), appearances, or a URL business_id —
    // and staff never qualify.
    if (table === "event_members") {
      const hostBusinessId = await getHostBusinessManagedBy(supabase, user.id, entityId);
      if (hostBusinessId) return { id: "host-business", role: "manager", viaHost: { businessId: hostBusinessId } };
    }
  }

  if (await isAdminSession()) {
    return { id: "admin-override", role: "owner", viaAdmin: true };
  }

  throw new Error("You don't have access to this business, event, or location.");
}

/** Business-Hosted Events V1 — the Event's canonical host Business id,
 * but only when `userId` is an owner or manager of it; otherwise null.
 * The host is read with the service-role client (never depends on the
 * events public-read policy); the membership is read through the
 * session's own client, which RLS already scopes to the caller's rows. */
async function getHostBusinessManagedBy(
  supabase: SupabaseClient,
  userId: string,
  eventId: string
): Promise<string | null> {
  const admin = getAdminSupabase();
  if (!admin) return null;
  const { data: event } = await admin.from("events").select("host_business_id").eq("id", eventId).maybeSingle();
  const hostBusinessId = (event as { host_business_id: string | null } | null)?.host_business_id ?? null;
  if (!hostBusinessId) return null;
  const { data: member } = await supabase
    .from("business_members")
    .select("id")
    .eq("user_id", userId)
    .eq("business_id", hostBusinessId)
    .in("role", ["owner", "manager"])
    .maybeSingle();
  return member ? hostBusinessId : null;
}

/** Throws unless the current authenticated session has a business_members
 * row for this business. Returns that row (id + role) on success. */
export async function requireBusinessMember(businessId: string): Promise<Membership> {
  return requireMembership("business_members", "business_id", businessId);
}

/** Throws unless the current authenticated session has an event_members
 * row for this event, OR is an owner/manager of the Event's canonical host
 * Business (viaHost), OR holds a founder admin session (viaAdmin). Returns
 * the real row (id + role) when one exists. */
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

/** Account Shell V1 (Event + Location Manager pass) — resolves an
 * explicit `?business_id=` navigation HINT into {id, name} for a
 * lightweight "<- {Business}" return link on the Event/Location Manager.
 * This is NEVER an authorization check for the Event/Location itself —
 * requireEventMember/requireLocationMember already independently gate the
 * real page access before this ever runs — and it is NEVER evidence that
 * the Business owns the Event/Location: it only renders a way back to
 * wherever the click genuinely came from. A hint that's missing, not a
 * real business id, or one the caller isn't actually a member of simply
 * resolves to null; the caller then falls back to a neutral return path,
 * never a guessed Business (never "the first participating Business",
 * never any inference from event_businesses/location relationships).
 * Same shape account/event/new and account/location/new's own
 * resolveBusinessContext already used; consolidated here now that the
 * Event/Location Managers need it too. */
export async function resolveBusinessNavContext(
  admin: SupabaseClient,
  businessId: string | undefined
): Promise<{ id: string; name: string } | null> {
  if (!businessId) return null;
  try {
    await requireBusinessMember(businessId);
  } catch {
    return null;
  }
  const { data } = await admin.from("businesses").select("id, name").eq("id", businessId).maybeSingle();
  return (data as { id: string; name: string } | null) ?? null;
}

/** Opportunities + Conversation Foundation V1 — the same
 * profiles.email_verified_at re-check the claim flow already established
 * (see /api/account/claim/route.ts's own isEmailVerified), extracted here
 * as a shared helper rather than duplicated a third time. Claiming an
 * existing listing and initiating/responding to an Opportunity are both
 * identity assertions about a real-world relationship — the same
 * verification bar applies. Never re-derives its own admin client; the
 * caller passes one already-authorized for other reads in the same
 * request. */
export async function isEmailVerified(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin.from("profiles").select("email_verified_at").eq("id", userId).maybeSingle();
  return Boolean(data?.email_verified_at);
}
