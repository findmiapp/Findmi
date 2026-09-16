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

// ── Schedule Integrity pass — canonical Event-authoritative field
// derivation ───────────────────────────────────────────────────────────
// Event → Appearance Schedule Integrity pass. ONE derivation per source
// (non-recurring Event / Occurrence), reused by both creation/reactivation
// (ensureEventAppearance/ensureOccurrenceAppearance, which also need
// title) and the new confirmed-row sync below (syncOfficialEventAppearances/
// syncOfficialOccurrenceAppearances, which never write title — see each
// function's own doc comment). No second, independently-typed copy of this
// mapping exists anywhere else.
//
// LOCKED field-ownership rule for source='official_participation':
// Event/Occurrence own WHEN (start_at/end_at) and WHERE (location_id where
// a real Location relationship exists, venue_name/address/city/state/
// latitude/longitude). The Business owns everything else (title once the
// Appearance is confirmed, description, external_url, flyer_image_url,
// bulletin_text, is_featured, show_on_home, home_sort_order) — none of
// that is ever read or written by anything in this section.

interface EventWhereWhen {
  start_at: string;
  end_at: string;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
}

async function deriveEventFields(
  supabase: SupabaseClient,
  eventId: string
): Promise<(EventWhereWhen & { title: string }) | null> {
  const { data: event } = await supabase
    .from("events")
    .select("name, start_at, end_at, venue_name, address, city, state, latitude, longitude")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return null;
  return {
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
}

// events has no location_id column of its own (only event_occurrences
// does — see updateMemberEventLocation's own comment in account/event/
// actions.ts), so a non-recurring Event-derived Appearance never had, and
// still never gets, a location_id — only the occurrence path below does.

interface OccurrenceWhereWhen extends EventWhereWhen {
  location_id: string | null;
}

async function deriveOccurrenceFields(
  supabase: SupabaseClient,
  occurrenceId: string
): Promise<(OccurrenceWhereWhen & { event_id: string; title: string }) | null> {
  const { data: occurrence } = await supabase
    .from("event_occurrences")
    .select("event_id, start_at, end_at, location_id, events(name, venue_name, address, city, state, latitude, longitude)")
    .eq("id", occurrenceId)
    .maybeSingle();
  if (!occurrence) return null;
  const event = Array.isArray(occurrence.events) ? occurrence.events[0] : occurrence.events;
  if (!event) return null;

  // Venue/address prefers the occurrence's own linked Location; falls back
  // to the parent Event's venue fields when the occurrence has no
  // location_id — same precedence ensureOccurrenceAppearance always used.
  // location_id itself starts (and, on a fallback, stays) null so a
  // Location A -> no-Location-FK switch correctly clears the Appearance's
  // own location_id rather than leaving it pointed at the old Location.
  let venue: OccurrenceWhereWhen = {
    location_id: null,
    venue_name: event.venue_name as string | null,
    address: event.address as string | null,
    city: event.city as string | null,
    state: event.state as string | null,
    latitude: event.latitude as number | null,
    longitude: event.longitude as number | null,
    start_at: occurrence.start_at,
    end_at: occurrence.end_at,
  };
  if (occurrence.location_id) {
    const { data: location } = await supabase
      .from("locations")
      .select("name, address, city, state, latitude, longitude")
      .eq("id", occurrence.location_id)
      .maybeSingle();
    if (location) {
      venue = {
        location_id: occurrence.location_id,
        venue_name: location.name,
        address: location.address,
        city: location.city,
        state: location.state,
        latitude: location.latitude,
        longitude: location.longitude,
        start_at: occurrence.start_at,
        end_at: occurrence.end_at,
      };
    }
  }

  return { event_id: occurrence.event_id, title: event.name, ...venue };
}

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

  const fields = await deriveEventFields(supabase, eventId);
  if (!fields) return;

  // Production Bugfix — Multi-Date Participation Status. Ordered +
  // limited to exactly one row before .maybeSingle(): a business that's
  // been approved/declined more than once for this event can accumulate
  // more than one canceled official_participation row (confirmed against
  // San Gennaro's own production data — repeated approve/decline cycles
  // left 10+ duplicate canceled event-level appearances per business).
  // Without this bound, .maybeSingle() errors on 2+ matches, `canceled`
  // silently becomes null (the error is discarded), and this falls
  // through to the insert branch below — creating ANOTHER duplicate
  // instead of reactivating one of the existing rows, compounding every
  // time. Reactivates the most recently canceled row when duplicates
  // already exist from before this fix.
  const { data: canceled } = await supabase
    .from("appearances")
    .select("id")
    .eq("business_id", businessId)
    .eq("event_id", eventId)
    .is("event_occurrence_id", null)
    .eq("status", "canceled")
    .eq("source", "official_participation")
    .order("created_at", { ascending: false })
    .limit(1)
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
 * directly.
 *
 * Schedule Integrity pass — now also writes location_id (previously left
 * null even when the occurrence had a real Location FK — the Appearance
 * only ever got that Location's TEXT snapshot). Applies uniformly to both
 * a brand-new insert and a reactivated row, via the shared
 * deriveOccurrenceFields derivation every other function in this section
 * also uses. No backfill of existing confirmed rows here — only creation/
 * reactivation and the two sync functions below ever write it. */
export async function ensureOccurrenceAppearance(supabase: SupabaseClient, occurrenceId: string, businessId: string) {
  const { data: existing } = await supabase
    .from("appearances")
    .select("id")
    .eq("business_id", businessId)
    .eq("event_occurrence_id", occurrenceId)
    .neq("status", "canceled")
    .maybeSingle();
  if (existing) return;

  const derived = await deriveOccurrenceFields(supabase, occurrenceId);
  if (!derived) return;
  const { event_id, title, start_at, end_at, location_id, venue_name, address, city, state, latitude, longitude } = derived;
  const fields = { event_id, title, start_at, end_at, location_id, venue_name, address, city, state, latitude, longitude };

  // Production Bugfix — Multi-Date Participation Status. Same ordered +
  // limited bound as ensureEventAppearance's own identical reactivation
  // lookup above — see that function's comment for the proven duplicate-
  // creation bug this prevents.
  const { data: canceled } = await supabase
    .from("appearances")
    .select("id")
    .eq("business_id", businessId)
    .eq("event_occurrence_id", occurrenceId)
    .eq("status", "canceled")
    .eq("source", "official_participation")
    .order("created_at", { ascending: false })
    .limit(1)
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

// ── Event → Appearance Schedule Integrity pass — WHERE/WHEN sync for
// confirmed rows ─────────────────────────────────────────────────────────
// ensureEventAppearance/ensureOccurrenceAppearance above only ever touch a
// MISSING or CANCELED appearance (create, or reactivate-with-fresh-fields).
// An already-CONFIRMED official-participation appearance was never revisited
// after that — a later Event/Occurrence date/venue/Location edit left it
// showing stale schedule information indefinitely (the Schedule Integrity
// audit's core finding). These two functions close that gap: ONE bounded
// UPDATE per Event/Occurrence (never a per-business loop — every approved
// business's row for that Event/Occurrence is refreshed in the same
// statement), called by the organizer/admin actions that change a
// non-recurring Event's or an Occurrence's own WHERE/WHEN fields. Both
// reuse the exact same deriveEventFields/deriveOccurrenceFields this file's
// creation path already uses — one canonical field-derivation rule, never a
// second copy that could drift.
//
// Deliberately narrow: only start_at/end_at/venue_name/address/city/state/
// latitude/longitude(/location_id for the occurrence path) are ever
// written. title is never touched here (Business-customizable once the
// Appearance is confirmed — LOCKED product rule, see this file's own
// header) and no Business-owned presentation field (description/
// external_url/flyer_image_url/bulletin_text/is_featured/show_on_home/
// home_sort_order) is read or written. status='confirmed' is part of the
// WHERE clause, not something this ever sets — a canceled/withdrawn row is
// never touched, so an ordinary Event edit can never resurrect it.
// Best-effort/non-blocking, same posture as every other function here: a
// sync failure is logged and never rolls back or blocks the Event edit
// that already succeeded.

/** Refreshes WHERE/WHEN on every confirmed official-participation
 * Appearance linked to this non-recurring Event (event_occurrence_id is
 * null). Call after any organizer/admin edit that changes a non-recurring
 * Event's own start_at/end_at/venue fields. */
export async function syncOfficialEventAppearances(supabase: SupabaseClient, eventId: string): Promise<void> {
  const fields = await deriveEventFields(supabase, eventId);
  if (!fields) return;

  const { error } = await supabase
    .from("appearances")
    .update({
      start_at: fields.start_at,
      end_at: fields.end_at,
      venue_name: fields.venue_name,
      address: fields.address,
      city: fields.city,
      state: fields.state,
      latitude: fields.latitude,
      longitude: fields.longitude,
    })
    .eq("event_id", eventId)
    .is("event_occurrence_id", null)
    .eq("source", "official_participation")
    .eq("status", "confirmed");
  if (error) {
    console.error(`[appearance-event-sync] failed to sync official-participation appearances for event ${eventId}:`, error);
  }
}

/** Refreshes WHERE/WHEN on every confirmed official-participation
 * Appearance linked to this one Occurrence — never a sibling occurrence of
 * the same Event. Call after any organizer/admin edit that changes an
 * Occurrence's own start_at/end_at/location_id. Writes location_id
 * directly from the Occurrence (null when it falls back to the parent
 * Event's venue text), so a Location A -> Location B change moves the
 * Appearance to Location B, and a Location -> no-Location-FK change
 * correctly clears it rather than leaving it pointed at the old Location. */
export async function syncOfficialOccurrenceAppearances(supabase: SupabaseClient, occurrenceId: string): Promise<void> {
  const fields = await deriveOccurrenceFields(supabase, occurrenceId);
  if (!fields) return;

  const { error } = await supabase
    .from("appearances")
    .update({
      start_at: fields.start_at,
      end_at: fields.end_at,
      location_id: fields.location_id,
      venue_name: fields.venue_name,
      address: fields.address,
      city: fields.city,
      state: fields.state,
      latitude: fields.latitude,
      longitude: fields.longitude,
    })
    .eq("event_occurrence_id", occurrenceId)
    .eq("source", "official_participation")
    .eq("status", "confirmed");
  if (error) {
    console.error(`[appearance-event-sync] failed to sync official-participation appearances for occurrence ${occurrenceId}:`, error);
  }
}

/** Cancels (never deletes) every ACTIVE official-participation Appearance
 * linked to this one Occurrence, regardless of which business — the bulk
 * counterpart to cancelOccurrenceAppearance above (single-business,
 * participation-status driven). Use this when the OCCURRENCE ITSELF is
 * cancelled or removed, not when one business individually withdraws.
 * Scoped entirely by event_occurrence_id, so a sibling occurrence of the
 * same Event is never touched, and by source='official_participation', so
 * a manual/event_self_added Appearance is never touched. Call this BEFORE
 * deleting an event_occurrences row, not after — the FK
 * (appearances.event_occurrence_id -> event_occurrences.id) is
 * ON DELETE SET NULL, so once the occurrence row is gone this function can
 * no longer find the Appearances it needs to cancel by occurrence id. */
export async function cancelOfficialOccurrenceAppearances(supabase: SupabaseClient, occurrenceId: string): Promise<void> {
  const { error } = await supabase
    .from("appearances")
    .update({ status: "canceled" })
    .eq("event_occurrence_id", occurrenceId)
    .eq("source", "official_participation")
    .neq("status", "canceled");
  if (error) {
    console.error(`[appearance-event-sync] failed to cancel official-participation appearances for occurrence ${occurrenceId}:`, error);
  }
}

// ── Multi-Date Business Participation Pass 2B — durable ALL DATES
// propagation ───────────────────────────────────────────────────────────
// event_businesses.participation_scope='all_dates' is durable intent: a
// Business approved this way participates on every CURRENT AND FUTURE date
// of the Event, with zero organizer follow-up required when a date is
// added later. This is the one centralized helper every occurrence-
// creation path (bulkGenerateEventDates, addMemberEventDate,
// updateMemberEventLocation's seed branch, createMemberEvent's seed, and
// Admin's saveEvent() occurrence upsert) calls with whichever occurrence
// ids it just newly inserted — never with an existing/edited occurrence's
// id, so an ordinary date/time/Location edit never re-triggers this.
//
// Idempotent by construction: event_occurrence_businesses' own
// UNIQUE(occurrence_id, business_id) + ignoreDuplicates upsert means
// calling this twice (or from two overlapping bulk operations) never
// creates a duplicate row, and ensureOccurrenceAppearance is itself
// idempotent (checks for an existing non-canceled Appearance first) — so
// re-running this for an occurrence that already has the row/Appearance
// is always a safe no-op, never a duplicate.
export async function propagateAllDatesParticipation(
  supabase: SupabaseClient,
  eventId: string,
  newOccurrenceIds: string[]
): Promise<void> {
  if (newOccurrenceIds.length === 0) return;

  // Only approved, explicitly-scoped all_dates businesses ever propagate —
  // never a pending invitation/application (nothing to realize yet — see
  // this pass's own "pending all_dates invite" rule), never
  // 'selected_dates', and never legacy NULL scope (LOCKED: never
  // auto-propagate an unspecified-scope row onto a new date).
  const { data: allDatesBusinesses, error: fetchError } = await supabase
    .from("event_businesses")
    .select("business_id")
    .eq("event_id", eventId)
    .eq("status", "approved")
    .eq("participation_scope", "all_dates");
  if (fetchError) {
    console.error(`[appearance-event-sync] failed to fetch all_dates businesses for event ${eventId}:`, fetchError);
    return;
  }
  const businessIds = ((allDatesBusinesses ?? []) as { business_id: string }[]).map((r) => r.business_id);
  if (businessIds.length === 0) return;

  const rows = businessIds.flatMap((business_id) =>
    newOccurrenceIds.map((occurrence_id) => ({ occurrence_id, business_id, status: "approved" as const }))
  );
  const { error: upsertError } = await supabase
    .from("event_occurrence_businesses")
    .upsert(rows, { onConflict: "occurrence_id,business_id", ignoreDuplicates: true });
  if (upsertError) {
    console.error(`[appearance-event-sync] failed to propagate all_dates participation for event ${eventId}:`, upsertError);
    return;
  }

  for (const businessId of businessIds) {
    for (const occurrenceId of newOccurrenceIds) {
      await ensureOccurrenceAppearance(supabase, occurrenceId, businessId);
    }
  }
}

/** Reverse direction of propagateAllDatesParticipation — reconciles an
 * all_dates Business's occurrence-level participation DOWN to an explicit
 * set of still-active date ids (Primary Date handled separately by the
 * caller — this only ever touches event_occurrence_businesses/occurrence
 * Appearances). Used by the all_dates -> selected_dates scope change (every
 * occurrence NOT in `keepOccurrenceIds` is declined + its Appearance
 * canceled) and by removing an all_dates Business from the Event entirely
 * (call with `keepOccurrenceIds: []`). Never touches a business whose
 * occurrence row is already 'declined' — same idempotent, safe-to-rerun
 * posture as every other function in this file. */
export async function reconcileOccurrenceParticipationDown(
  supabase: SupabaseClient,
  eventId: string,
  businessId: string,
  keepOccurrenceIds: string[]
): Promise<void> {
  const { data: occurrenceRows, error } = await supabase.from("event_occurrences").select("id").eq("event_id", eventId);
  if (error) {
    console.error(`[appearance-event-sync] failed to fetch occurrences for event ${eventId}:`, error);
    return;
  }
  const keepSet = new Set(keepOccurrenceIds);
  const toDrop = ((occurrenceRows ?? []) as { id: string }[]).map((o) => o.id).filter((id) => !keepSet.has(id));
  if (toDrop.length === 0) return;

  const { error: declineError } = await supabase
    .from("event_occurrence_businesses")
    .update({ status: "declined" })
    .eq("business_id", businessId)
    .in("occurrence_id", toDrop)
    .neq("status", "declined");
  if (declineError) {
    console.error(`[appearance-event-sync] failed to decline occurrence participation for business ${businessId}:`, declineError);
  }

  for (const occurrenceId of toDrop) {
    await cancelOccurrenceAppearance(supabase, occurrenceId, businessId);
  }
}

/** Backfills an all_dates Business's occurrence-level participation UP to
 * EVERY current event_occurrences row (not just newly-created ones — see
 * propagateAllDatesParticipation above for the incremental, new-occurrence-
 * only counterpart). Used at ALL-DATES approval time (an approved all_dates
 * invitation/application must realize every date that already exists, not
 * just future ones) and by the selected_dates -> all_dates scope change.
 * Unlike propagateAllDatesParticipation's ignoreDuplicates upsert, this
 * explicitly OVERWRITES each occurrence's row to 'approved' — an existing
 * 'declined' row (from a prior selected_dates scope, or a prior decline)
 * must be reactivated, not silently skipped. Never touches the Primary
 * Date (events.start_at/end_at, no occurrence row) — the caller is
 * responsible for ensureEventAppearance separately (see
 * realizeEventLevelApproval below, which does both). */
export async function backfillAllDatesParticipation(supabase: SupabaseClient, eventId: string, businessId: string): Promise<void> {
  const { data: occurrenceRows, error } = await supabase.from("event_occurrences").select("id").eq("event_id", eventId);
  if (error) {
    console.error(`[appearance-event-sync] failed to fetch occurrences for event ${eventId}:`, error);
    return;
  }
  const occurrenceIds = ((occurrenceRows ?? []) as { id: string }[]).map((o) => o.id);
  if (occurrenceIds.length === 0) return;

  const { error: upsertError } = await supabase
    .from("event_occurrence_businesses")
    .upsert(
      occurrenceIds.map((occurrence_id) => ({ occurrence_id, business_id: businessId, status: "approved" as const })),
      { onConflict: "occurrence_id,business_id" }
    );
  if (upsertError) {
    console.error(`[appearance-event-sync] failed to backfill all_dates participation for business ${businessId}:`, upsertError);
    return;
  }
  for (const occurrenceId of occurrenceIds) {
    await ensureOccurrenceAppearance(supabase, occurrenceId, businessId);
  }
}

/** Approves whichever occurrence rows were already pre-recorded for a
 * selected_dates Business (written at invite/apply time — see
 * inviteParticipatingBusiness/applyToEventPublic) — never every occurrence
 * of the Event (that's backfillAllDatesParticipation's job, for
 * participation_scope='all_dates' only). Reads the existing rows back
 * rather than requiring the caller to pass the original date list again,
 * so this stays a one-line call at every approval site. Never touches an
 * already-declined row (nothing to approve there). */
export async function approveSelectedDatesOccurrences(supabase: SupabaseClient, eventId: string, businessId: string): Promise<void> {
  const { data: occurrenceRows, error } = await supabase.from("event_occurrences").select("id").eq("event_id", eventId);
  if (error) {
    console.error(`[appearance-event-sync] failed to fetch occurrences for event ${eventId}:`, error);
    return;
  }
  const occurrenceIds = ((occurrenceRows ?? []) as { id: string }[]).map((o) => o.id);
  if (occurrenceIds.length === 0) return;

  const { data: preRecorded, error: fetchError } = await supabase
    .from("event_occurrence_businesses")
    .select("occurrence_id")
    .eq("business_id", businessId)
    .in("occurrence_id", occurrenceIds)
    .neq("status", "declined");
  if (fetchError) {
    console.error(`[appearance-event-sync] failed to fetch pre-recorded occurrence participation for business ${businessId}:`, fetchError);
    return;
  }
  const ids = ((preRecorded ?? []) as { occurrence_id: string }[]).map((r) => r.occurrence_id);
  if (ids.length === 0) return;

  const { error: updateError } = await supabase
    .from("event_occurrence_businesses")
    .update({ status: "approved" })
    .eq("business_id", businessId)
    .in("occurrence_id", ids);
  if (updateError) {
    console.error(`[appearance-event-sync] failed to approve selected-dates occurrence participation for business ${businessId}:`, updateError);
    return;
  }
  for (const occurrenceId of ids) {
    await ensureOccurrenceAppearance(supabase, occurrenceId, businessId);
  }
}

/** The one shared "approve this Business's event-level (Primary Date)
 * participation" realization, scope-aware — replaces a bare
 * ensureEventAppearance call at every approval site
 * (updateParticipatingBusinessStatus, respondToInvitationInThread,
 * inviteParticipatingBusiness/inviteBusinessToEventPublic's "crossed"
 * branch, applyToEventPublic's crossed branch,
 * resolveEventApplicationDecision's whole-event branch). Always ensures
 * the Primary Date Appearance, THEN additionally realizes occurrence-level
 * participation according to whichever scope is currently recorded on
 * event_businesses — all_dates backfills every current occurrence,
 * selected_dates approves only the pre-recorded ones, legacy NULL scope
 * does nothing further (unchanged pre-this-pass behavior). */
export async function realizeEventLevelApproval(supabase: SupabaseClient, eventId: string, businessId: string): Promise<void> {
  await ensureEventAppearance(supabase, eventId, businessId);

  const { data: row } = await supabase
    .from("event_businesses")
    .select("participation_scope")
    .eq("event_id", eventId)
    .eq("business_id", businessId)
    .maybeSingle();
  const scope = (row as { participation_scope: string | null } | null)?.participation_scope ?? null;

  if (scope === "all_dates") {
    await backfillAllDatesParticipation(supabase, eventId, businessId);
  } else if (scope === "selected_dates") {
    await approveSelectedDatesOccurrences(supabase, eventId, businessId);
  }
}

/** The one shared "decline/remove this Business's event-level
 * participation" realization — replaces a bare cancelEventAppearance call
 * at every decline/removal site. Cancels the Primary Date Appearance AND
 * reconciles every occurrence-level row down to none (declined + its
 * Appearance canceled) — LOCKED: a declined/removed Business is never left
 * publicly visible on any date, all_dates or selected_dates alike. */
export async function declineEventLevelParticipation(supabase: SupabaseClient, eventId: string, businessId: string): Promise<void> {
  await cancelEventAppearance(supabase, eventId, businessId);
  await reconcileOccurrenceParticipationDown(supabase, eventId, businessId, []);
}
