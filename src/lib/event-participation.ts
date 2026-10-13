import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createOpportunity } from "./opportunities";
import { ensureEventAppearance } from "./appearance-event-sync";

/** A Business asks to take part in an EXISTING Findmi Event (whole Event).
 * The one shared implementation of the locked participation invariant —
 * used by Where I'll Be's request-to-join composer (addAppearanceFromEvent)
 * and by Event Import:
 *
 *   AN EVENT-LINKED APPEARANCE MUST NOT BECOME CONFIRMED/PUBLIC UNTIL
 *   PARTICIPATION IS MUTUALLY AGREED.
 *
 *   - already approved          → "already_approved", nothing written;
 *   - invited by the organizer  → approved now + ensureEventAppearance
 *                                 (mutual intent already exists);
 *   - applied / pending         → "already_applied", nothing written;
 *   - none / declined           → roster row upserted to 'applied' (no
 *                                 Appearance until the organizer approves).
 * Every non-approved outcome also records its Opportunity/Conversation
 * (best-effort; createOpportunity dedupes), exactly as before.
 * The caller is responsible for authorizing the Business member. */
export type EventApplicationResult = "unavailable" | "already_approved" | "approved_now" | "already_applied" | "applied";

export async function applyBusinessToEvent(
  admin: SupabaseClient,
  input: { eventId: string; businessId: string; userId: string | null; note?: string | null }
): Promise<EventApplicationResult> {
  const { eventId, businessId } = input;
  // Public Events, plus Events still awaiting Findmi review (an Event
  // another Business just imported — a request recorded now is decided
  // with it). Rejected, archived and trashed Events are never joinable.
  const { data: event } = await admin
    .from("events")
    .select("id, is_demo, publication_status")
    .eq("id", eventId)
    .is("trashed_at", null)
    .is("archived_at", null)
    .maybeSingle();
  const ev = event as { id: string; is_demo: boolean; publication_status: string | null } | null;
  if (!ev || (ev.is_demo && ev.publication_status !== "pending_review")) return "unavailable";

  const { data: existingRow } = await admin
    .from("event_businesses")
    .select("status")
    .eq("event_id", eventId)
    .eq("business_id", businessId)
    .maybeSingle();
  const currentStatus = (existingRow as { status: string } | null)?.status ?? null;

  if (currentStatus === "approved") return "already_approved";

  let result: EventApplicationResult;
  if (currentStatus === "invited") {
    await admin.from("event_businesses").update({ status: "approved" }).eq("event_id", eventId).eq("business_id", businessId);
    await ensureEventAppearance(admin, eventId, businessId);
    result = "approved_now";
  } else if (currentStatus === "applied" || currentStatus === "pending") {
    result = "already_applied";
  } else {
    // No row yet, or a terminal 'declined' row being re-applied to — a full
    // upsert (never ignoreDuplicates) so re-applying resets to 'applied'.
    await admin.from("event_businesses").upsert({ event_id: eventId, business_id: businessId, status: "applied" }, { onConflict: "event_id,business_id" });
    result = "applied";
  }

  if (input.userId) {
    try {
      await createOpportunity(admin, {
        type: "event_application",
        eventId,
        eventOccurrenceId: null,
        businessId,
        initiatorUserId: input.userId,
        initiatorEntityType: "business",
        initiatorEntityId: businessId,
        note: input.note?.trim() || null,
      });
    } catch (err) {
      console.error("[opportunities] failed to record application Opportunity", err);
    }
  }
  return result;
}
