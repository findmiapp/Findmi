import type { SupabaseClient } from "@supabase/supabase-js";

// Event-Linked Appearance Removal Sync pass — the reverse direction of the
// forward Approval <-> FindMi Here sync (ensureEventAppearance/
// cancelEventAppearance/ensureOccurrenceAppearance/cancelOccurrenceAppearance
// below). Event participation -> Appearance was already correctly synced
// both ways; Appearance removal -> Event participation was not synced at
// all (confirmed by the "Findmi Here Sync Audit" — a canceled/deleted
// official-participation Appearance left a stale 'approved'
// event_businesses/event_occurrence_businesses row, so a withdrawn business
// kept showing on the public Event roster).
//
// Deliberately a plain lib module (no "use server", no admin-only auth) so
// both the member-facing Business/Event Manager actions (account/business/
// actions.ts, account/event/actions.ts), the public Conversation-approval
// actions (connect/actions.ts), and the admin appearance/event actions
// (admin/appearances/actions.ts, admin/events/actions.ts) can call it
// without importing across the admin/member boundary — it operates
// entirely on the already-authorized SupabaseClient its caller passes in,
// the same shape as lib/market-requests.ts's own plain helpers.
//
// Occurrence-Aware Event Participation pass — ensureEventAppearance/
// cancelEventAppearance/ensureOccurrenceAppearance/cancelOccurrenceAppearance
// moved here (from admin/(protected)/events/actions.ts, a "use server" file)
// so lib/opportunities.ts's own occurrence-aware application resolver
// (resolveEventApplicationDecision) can call them directly without a
// circular import between a plain lib module and a Server Actions file.
// Behavior is byte-identical to before the move — every existing call site
// (admin/events/actions.ts, account/business/actions.ts, account/event/
// actions.ts, connect/actions.ts) now imports from here instead of from
// admin/events/actions.ts, nothing else changed about them.

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

// ── Approval <-> FindMi Here sync (forward direction) ──────────────────
// (Admin Approval → FindMi Here Sync pass, extended by the Event
// Participation → Official Appearance Reverse-Sync pass, relocated here by
// the Occurrence-Aware Event Participation pass — see this file's own top
// comment.)
//
// Idempotent by construction: ensure* checks for an existing, non-canceled
// appearance first and returns early if one already exists (regardless of
// its source), so re-approving never creates a duplicate. The occurrence
// path additionally relies on the real DB-level partial unique index
// (appearances_one_per_business_occurrence, business_id +
// event_occurrence_id, scoped to status <> 'canceled') as a race-safe
// backstop — a unique_violation there is treated as "already exists," not
// an error. No unique index constrains the non-recurring (event_id +
// business_id, event_occurrence_id null) case, so that path's existence
// check is the only safeguard.
//
// Reverse-sync (cancel*) and reactivation (inside ensure*) both target
// ONLY appearances.source = 'official_participation', on top of the exact
// same business_id/event_id(/event_occurrence_id) identifiers ensure*
// already uses to check existence — never a broader event+business match
// that could reach an owner's own 'manual' or 'event_self_added'
// appearance. All historical (pre-provenance) appearances are
// source='manual' by migration default and are therefore never touched by
// any of this — a deliberate, conservative exclusion, not an oversight.

/** Non-recurring event -> one appearances row (event_occurrence_id left
 * null). Inherits title/start/end/venue straight from the event row —
 * no title/date fuzzy matching. If a CANCELED appearance already exists
 * for this exact business+event that this sync itself created
 * (source='official_participation'), re-approving reactivates that same
 * row (status back to 'confirmed', fields refreshed) instead of inserting
 * a new one — never reuses/reactivates an owner's canceled 'manual' or
 * 'event_self_added' row, since the reactivation lookup itself is scoped
 * to source='official_participation'. */
export async function ensureEventAppearance(supabase: SupabaseClient, eventId: string, businessId: string) {
  const { data: existing } = await supabase
    .from("appearances")
    .select("id")
    .eq("business_id", businessId)
    .eq("event_id", eventId)
    .is("event_occurrence_id", null)
    .neq("status", "canceled")
    .maybeSingle();
  if (existing) return;

  const { data: event } = await supabase
    .from("events")
    .select("name, start_at, end_at, venue_name, address, city, state, latitude, longitude")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return;

  const fields = {
    title: event.name,
    start_at: event.start_at,
    end_at: event.end_at,
    venue_name: event.venue_name,
    address: event.address,
    city: event.city,
    state: event.state,
    latitude: event.latitude,
    longitude: event.longitude,
  };

  const { data: canceled } = await supabase
    .from("appearances")
    .select("id")
    .eq("business_id", businessId)
    .eq("event_id", eventId)
    .is("event_occurrence_id", null)
    .eq("status", "canceled")
    .eq("source", "official_participation")
    .maybeSingle();
  if (canceled) {
    await supabase.from("appearances").update({ ...fields, status: "confirmed" }).eq("id", canceled.id);
    return;
  }

  await supabase.from("appearances").insert({
    business_id: businessId,
    event_id: eventId,
    ...fields,
    status: "confirmed",
    // Appearance Provenance pass — only this admin-approval sync path
    // (and its occurrence-level sibling below) ever writes this value.
    // The existence check above already returns early if a matching
    // appearance exists at all — owner-created or otherwise — so this
    // insert only ever runs when nothing existed yet, never overwriting
    // an owner-added appearance's provenance.
    source: "official_participation",
  });
}

/** Cancels (never deletes) the linked official-participation appearance
 * for this exact business+event — the reverse of ensureEventAppearance.
 * Scoped to source='official_participation' on top of the identical
 * business_id/event_id/event_occurrence_id-is-null identifiers
 * ensureEventAppearance itself checks, so an owner's own 'manual' or
 * 'event_self_added' appearance for the same event can never match. A
 * no-op (0 rows) when no such appearance exists, or it's already
 * canceled — both expected, not errors. */
export async function cancelEventAppearance(supabase: SupabaseClient, eventId: string, businessId: string) {
  await supabase
    .from("appearances")
    .update({ status: "canceled" })
    .eq("business_id", businessId)
    .eq("event_id", eventId)
    .is("event_occurrence_id", null)
    .eq("source", "official_participation")
    .neq("status", "canceled");
}

/** Recurring occurrence -> one appearances row identified by business_id +
 * event_occurrence_id. Venue/address prefers the occurrence's own linked
 * location (same location_id convention getUpcomingOccurrences already
 * uses); falls back to the parent event's own venue fields when the
 * occurrence has no location_id set. Reactivates a matching CANCELED
 * source='official_participation' row instead of inserting a duplicate —
 * same reasoning as ensureEventAppearance above. Exported (moved from
 * admin/events/actions.ts, where it was module-private) so
 * lib/opportunities.ts's occurrence-aware application resolver can call it
 * directly. */
export async function ensureOccurrenceAppearance(supabase: SupabaseClient, occurrenceId: string, businessId: string) {
  const { data: existing } = await supabase
    .from("appearances")
    .select("id")
    .eq("business_id", businessId)
    .eq("event_occurrence_id", occurrenceId)
    .neq("status", "canceled")
    .maybeSingle();
  if (existing) return;

  const { data: occurrence } = await supabase
    .from("event_occurrences")
    .select("event_id, start_at, end_at, location_id, events(name, venue_name, address, city, state, latitude, longitude)")
    .eq("id", occurrenceId)
    .maybeSingle();
  if (!occurrence) return;
  const event = Array.isArray(occurrence.events) ? occurrence.events[0] : occurrence.events;
  if (!event) return;

  let venue = {
    venue_name: event.venue_name as string | null,
    address: event.address as string | null,
    city: event.city as string | null,
    state: event.state as string | null,
    latitude: event.latitude as number | null,
    longitude: event.longitude as number | null,
  };
  if (occurrence.location_id) {
    const { data: location } = await supabase
      .from("locations")
      .select("name, address, city, state, latitude, longitude")
      .eq("id", occurrence.location_id)
      .maybeSingle();
    if (location) {
      venue = {
        venue_name: location.name,
        address: location.address,
        city: location.city,
        state: location.state,
        latitude: location.latitude,
        longitude: location.longitude,
      };
    }
  }

  const fields = {
    event_id: occurrence.event_id,
    title: event.name,
    start_at: occurrence.start_at,
    end_at: occurrence.end_at,
    ...venue,
  };

  const { data: canceled } = await supabase
    .from("appearances")
    .select("id")
    .eq("business_id", businessId)
    .eq("event_occurrence_id", occurrenceId)
    .eq("status", "canceled")
    .eq("source", "official_participation")
    .maybeSingle();
  if (canceled) {
    await supabase.from("appearances").update({ ...fields, status: "confirmed" }).eq("id", canceled.id);
    return;
  }

  const { error } = await supabase.from("appearances").insert({
    business_id: businessId,
    ...fields,
    status: "confirmed",
    // Appearance Provenance pass — same reasoning as ensureEventAppearance
    // above: the existence check already returned early if a matching
    // appearance (owner-added or otherwise) already existed.
    source: "official_participation",
  });
  // 23505 = unique_violation — a concurrent approval already won the race
  // against appearances_one_per_business_occurrence; that's the intended
  // idempotency backstop, not a real failure.
  if (error && error.code !== "23505") {
    // Non-fatal by design: the participation approval itself already
    // succeeded above: a sync hiccup here shouldn't roll that back or
    // interrupt the founder's save.
  }
}

/** Cancels (never deletes) the linked official-participation appearance
 * for this exact business+occurrence — the reverse of
 * ensureOccurrenceAppearance. Scoped to source='official_participation' on
 * top of the identical business_id/event_occurrence_id identifiers
 * ensureOccurrenceAppearance itself checks — event_occurrence_id alone
 * already pins one specific occurrence of one specific event (an
 * occurrence's event_id never changes), so no separate event_id filter is
 * needed for correctness. An owner's own 'manual' or 'event_self_added'
 * appearance, or one for a different occurrence/business, can never
 * match. No-op when nothing matches. Exported for the same reason as
 * ensureOccurrenceAppearance above. */
export async function cancelOccurrenceAppearance(supabase: SupabaseClient, occurrenceId: string, businessId: string) {
  await supabase
    .from("appearances")
    .update({ status: "canceled" })
    .eq("business_id", businessId)
    .eq("event_occurrence_id", occurrenceId)
    .eq("source", "official_participation")
    .neq("status", "canceled");
}
