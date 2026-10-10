import { isDirectBusinessMessagingEnabled } from "@/lib/communication-policy";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getUserManagedEntities } from "@/lib/opportunities";

/** Unify Site-Wide Communications pass — the direct MESSAGE CTA
 * (MessageButton, on the Business/Event/Location public pages) must not
 * even exist in the markup for an ineligible viewer: not hidden with
 * CSS, not shown disabled, not shown and then redirected to login (see
 * this pass's own report). Server-derived, never trusted to the client —
 * MessageButton itself is only ever rendered by its caller when this
 * returns true. This is a VISIBILITY gate only; the actual send is
 * separately, redundantly authorized server-side in connect/actions.ts
 * (requireBusinessMember/requireEventMember before any write), which
 * this function does not change or replace.
 *
 * Mirrors MessageButton's own existing actorOptions computation exactly
 * (business target: any OTHER business the viewer manages, or any event
 * they organize; event/location target: any business they manage) — a
 * viewer eligible to see the button is, by construction, also eligible
 * to actually pick a valid "message as" identity once it opens. */
export async function shouldShowMessageButton(
  targetType: "business" | "event" | "location",
  targetId: string
): Promise<boolean> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const admin = getAdminSupabase();
  if (!admin) return false;

  const managed = await getUserManagedEntities(admin, user.id);
  // Communication boundary — with direct org messaging paused, the button
  // only offers the structured actions: Invite to Event (Business page,
  // for viewers who organize an Event) and Apply to Vend (Event page, for
  // viewers with a Business). A Location has no structured action, so its
  // button is hidden.
  if (!isDirectBusinessMessagingEnabled()) {
    if (targetType === "business") return managed.events.length > 0;
    if (targetType === "event") return managed.businesses.length > 0;
    return false;
  }
  if (targetType === "business") {
    return managed.businesses.some((b) => b.id !== targetId) || managed.events.length > 0;
  }
  return managed.businesses.length > 0;
}
