import type { SupabaseClient } from "@supabase/supabase-js";

// Event-Linked Appearance Removal Sync pass — the reverse direction of the
// existing Approval <-> FindMi Here sync (see ensureEventAppearance/
// cancelEventAppearance/ensureOccurrenceAppearance/cancelOccurrenceAppearance
// in src/app/admin/(protected)/events/actions.ts, which stay exactly as they
// are — this file is NOT a reimplementation of those, it's the missing
// opposite-direction sync those never needed to cover). Event participation
// -> Appearance was already correctly synced both ways; Appearance removal
// -> Event participation was not synced at all (confirmed by the "Findmi
// Here Sync Audit" — a canceled/deleted official-participation Appearance
// left a stale 'approved' event_businesses/event_occurrence_businesses row,
// so a withdrawn business kept showing on the public Event roster).
//
// Deliberately a plain lib module (no "use server", no admin-only auth) so
// both the member-facing Business Manager action (account/business/
// actions.ts) and the admin appearance actions (admin/appearances/
// actions.ts) can call it without importing across that admin/member
// boundary — it operates entirely on the already-authorized SupabaseClient
// its caller passes in, the same shape as lib/market-requests.ts's own
// plain helpers.

export interface AppearanceEventLinkage {
  event_id: string | null;
  event_occurrence_id: string | null;
  source: string | null;
}

/** Reverse-sync: call this AFTER an official-participation Appearance has
 * been canceled/edited-away-from-confirmed/deleted, passing that
 * Appearance's OWN linkage fields as they were before the removal (for a
 * delete, read them before the DELETE; for a status edit, read them before
 * the UPDATE). Best-effort — logs and returns on any real DB error rather
 * than throwing, so a sync failure can never roll back or block the
 * Appearance mutation that already succeeded (same "secondary, non-fatal"
 * discipline ensureOccurrenceAppearance's own insert already uses).
 *
 * Scoping rules (LOCKED — see this pass's own spec):
 * - source !== 'official_participation' (manual / event_self_added / null)
 *   -> no roster write at all. An owner's own appearance, or one Findmi has
 *   no provenance for, is never mistaken for official Event participation.
 * - event_id === null (standalone Where You'll Be) -> no roster write.
 * - event_occurrence_id set -> withdraws ONLY that one occurrence's
 *   event_occurrence_businesses row (business_id + occurrence_id), never
 *   any sibling occurrence's roster.
 * - event_occurrence_id null but event_id set -> only safe to withdraw the
 *   event-level event_businesses row when the Event has NO occurrence rows
 *   at all (a genuinely non-recurring Event). When the Event DOES have
 *   occurrence rows, which specific occurrence(s) this appearance actually
 *   represented is ambiguous (a real, live data shape found by the audit) —
 *   this deliberately does NOT guess or bulk-withdraw every occurrence; it
 *   logs a warning and leaves every roster row untouched, pending a
 *   separate normalization pass.
 *
 * Withdrawal is a status transition (-> 'declined', the same terminal
 * "no longer participating" value event_businesses/event_occurrence_businesses
 * already use elsewhere), never a delete — the historical roster
 * relationship is preserved, same as the Appearance side's own
 * cancel-never-delete convention. */
export async function reverseSyncEventParticipation(
  supabase: SupabaseClient,
  businessId: string,
  linkage: AppearanceEventLinkage
): Promise<void> {
  if (linkage.source !== "official_participation") return;
  if (!linkage.event_id) return;

  if (linkage.event_occurrence_id) {
    const { error } = await supabase
      .from("event_occurrence_businesses")
      .update({ status: "declined" })
      .eq("occurrence_id", linkage.event_occurrence_id)
      .eq("business_id", businessId)
      .neq("status", "declined");
    if (error) {
      console.error(
        `[appearance-event-sync] failed to withdraw occurrence participation (occurrence=${linkage.event_occurrence_id}, business=${businessId}):`,
        error
      );
    }
    return;
  }

  const { count, error: countError } = await supabase
    .from("event_occurrences")
    .select("id", { count: "exact", head: true })
    .eq("event_id", linkage.event_id);
  if (countError) {
    console.error(
      `[appearance-event-sync] failed to check occurrence count for event ${linkage.event_id}:`,
      countError
    );
    return;
  }

  if ((count ?? 0) > 0) {
    // Ambiguous recurring-event-level appearance — real live data shape
    // found by the audit (event-level appearance, no event_occurrence_id,
    // on an Event that actually has occurrence rows). Never guess which
    // occurrence(s) this represented; never bulk-withdraw every occurrence.
    console.warn(
      `[appearance-event-sync] ambiguous recurring-event participation — business ${businessId}, event ${linkage.event_id} has an event-level official_participation appearance with no event_occurrence_id, but the Event has occurrence rows. Skipping roster reverse-sync; needs manual review/normalization.`
    );
    return;
  }

  const { error } = await supabase
    .from("event_businesses")
    .update({ status: "declined" })
    .eq("event_id", linkage.event_id)
    .eq("business_id", businessId)
    .neq("status", "declined");
  if (error) {
    console.error(
      `[appearance-event-sync] failed to withdraw event participation (event=${linkage.event_id}, business=${businessId}):`,
      error
    );
  }
}
