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
  if (targetType === "business") {
    return managed.businesses.some((b) => b.id !== targetId) || managed.events.length > 0;
  }
  return managed.businesses.length > 0;
}
