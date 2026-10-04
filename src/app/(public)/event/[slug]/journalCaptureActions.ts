"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { isAdminSession } from "@/lib/admin/auth";
import { isoToLocalDateTime } from "@/lib/admin/form-helpers";
import { getEventBySlug, getBusinessesForEvent, eventHasAnyOccurrences, getAllOccurrencesForEvent, findLocationByExactVenue } from "@/lib/data";
import type { FindmiEvent } from "@/lib/types";
import { resolveAppearanceHostBusiness } from "./EventPublicView";

// Event Action UX + Universal Journal CTA pass — "Document Your
// Experience" is now a standard consumer-facing action on every public
// Event, not an admin-only utility (the previous Journal Live Capture
// pass's own isAdminSession()-gated entry point). Authorization is just
// "a real signed-in Findmi account" (requireUser(), the same check every
// other Journal Server Action already performs) — because
// journal_entries.user_id is a real, NOT NULL foreign key to auth.users,
// same as every entry created through the normal Create wizard. Whether
// THIS session also happens to hold an admin cookie only changes two
// things now: author_label (still "Findmi" for an admin's own capture,
// exactly as the prior pass set it; null — the normal Create flow's own
// default — for an ordinary consumer) and which existing editor the
// caller sends the user to afterward (/admin/journal/[id]/capture for an
// admin, the already-built consumer /my-world/journal/[id]/edit for
// everyone else) — never whether the action itself is allowed.
async function requireUser() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to document this experience.");
  return user;
}

async function findExistingEntryForEventUser(
  eventId: string,
  userId: string,
  admin: SupabaseClient
): Promise<{ id: string; status: "draft" | "published" } | null> {
  const { data } = await admin
    .from("journal_entries")
    .select("id, status, journal_entry_connections!inner(event_id)")
    .eq("user_id", userId)
    .eq("journal_entry_connections.event_id", eventId)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = data?.[0];
  return row ? { id: row.id, status: row.status as "draft" | "published" } : null;
}

/** No new occurrence/business-resolution logic — this mirrors, field for
 * field, the exact same deterministic resolution EventPublicView's own
 * hero/"Hosted By" already computes server-side for this event (see that
 * file's own comments on hostBusiness/canonicalLocation precedence),
 * reusing its exported resolveAppearanceHostBusiness rather than
 * duplicating that resolution. Returns only what's genuinely
 * unambiguous — an event with 2+ un-featured, un-Appearance-linked
 * businesses, or no resolvable occurrence/Location, simply yields a null
 * for that one field rather than guessing.
 *
 * Journal V2 Pass 2 — Event Occurrence integrity. This is the exact
 * mechanism the Cup of Love bug traced back to: an arbitrary occurrence
 * was being treated as "the" occurrence for both the entry_date default
 * AND the real database occurrenceId relationship, even when the event had
 * multiple real dates and this Event-level CTA (one Add Moment link per
 * Event, not one per date) has no way to know which one the
 * visitor actually means. `occurrenceId` is only ever populated when
 * exactly one REAL occurrence exists. When 2+ real occurrences exist, this
 * returns occurrenceId: null AND falls back entry_date to today (never an
 * arbitrary occurrence's date presented as if it were confidently known) —
 * the owner can still connect the correct occurrence afterward in Edit via
 * JournalConnectionsPicker's own "Which date was this?" picker (Pass 2B),
 * which reuses this exact same determinism rule.
 *
 * Journal V2 Pass 2B — Past Event CTA semantics. Deliberately
 * getAllOccurrencesForEvent (no end_at filter) rather than
 * getEffectiveEventSchedule/getUpcomingOccurrencesForEvent, both of which
 * are correctly upcoming-only for public discovery surfaces but were
 * silently causing a single-occurrence event to resolve as "ambiguous"
 * (occurrenceId: null) the moment that one occurrence finished — exactly
 * backwards for Journal, where documenting something that already happened
 * is the common case, not an edge case. A fully-finished Event with one
 * real occurrence is exactly as deterministic as an upcoming one. */
async function resolveDeterministicEventContext(eventId: string, event: Pick<FindmiEvent, "venue_name" | "address">) {
  const [businesses, hasOccurrences, matchedLocation, appearanceHostBusiness] = await Promise.all([
    getBusinessesForEvent(eventId),
    eventHasAnyOccurrences(eventId),
    event.venue_name ? findLocationByExactVenue(event.venue_name, event.address) : Promise.resolve(null),
    resolveAppearanceHostBusiness(eventId),
  ]);
  const realOccurrences = hasOccurrences ? await getAllOccurrencesForEvent(eventId) : [];
  const unambiguousOccurrence = realOccurrences.length === 1 ? realOccurrences[0] : null;

  const canonicalLocation = unambiguousOccurrence?.location ?? realOccurrences.find((o) => o.location)?.location ?? matchedLocation;
  const hostBusiness = businesses.find((b) => b.featured) ?? appearanceHostBusiness ?? (businesses.length === 1 ? businesses[0] : null);

  const entryDate = unambiguousOccurrence
    ? isoToLocalDateTime(unambiguousOccurrence.start_at, unambiguousOccurrence.timezone).slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  return {
    hostBusinessId: hostBusiness?.id ?? null,
    locationId: canonicalLocation?.id ?? null,
    entryDate,
    occurrenceId: unambiguousOccurrence?.id ?? null,
  };
}

export type EventJournalEntryResult = { id: string; status: "draft" | "published"; isAdmin: boolean } | { error: string };

/** Create-or-resume — the core requirement, now for ANY authenticated
 * user. Looks for an existing entry already connected to this event,
 * owned by the caller. A PUBLISHED entry is returned as-is (never
 * resumed into drafting, never duplicated — it's done). A DRAFT is
 * reopened unchanged. Neither found -> creates exactly one new draft,
 * deterministic context only, author_label "Findmi" only when the caller
 * also holds an admin session (see this file's header note) — null (the
 * normal Create flow's own default) otherwise. No new table, no new
 * status, no schema change. */
export async function startOrResumeEventJournalEntry(eventSlug: string): Promise<EventJournalEntryResult> {
  try {
    const user = await requireUser();
    const isAdmin = await isAdminSession();

    const event = await getEventBySlug(eventSlug);
    if (!event) return { error: "That event couldn't be found." };

    const admin = getAdminSupabase();
    if (!admin) return { error: "Server isn't configured." };

    const existing = await findExistingEntryForEventUser(event.id, user.id, admin);
    if (existing) return { id: existing.id, status: existing.status, isAdmin };

    const { hostBusinessId, locationId, entryDate, occurrenceId } = await resolveDeterministicEventContext(event.id, event);

    const { data: newEntry, error: insertError } = await admin
      .from("journal_entries")
      .insert({
        user_id: user.id,
        title: event.name,
        entry_date: entryDate,
        location_id: locationId,
        // Recovery pass — never stamp "Findmi": the shared admin cookie
        // isn't an identity. The byline comes from the author's profile.
        author_label: null,
      })
      .select("id")
      .single();
    if (insertError || !newEntry) return { error: insertError?.message ?? "Couldn't start this Journal entry." };

    // Journal V2 Pass 2 — the parent Event connection is always written
    // (unchanged); the Occurrence connection is a SEPARATE, additional row
    // (never a replacement) and only exists when resolveDeterministicEventContext
    // found exactly one real candidate — see that function's own note on
    // why a null occurrenceId here is the correct, honest outcome rather
    // than a gap to fill with a guess.
    const connectionRows = [
      { journal_entry_id: newEntry.id, event_id: event.id },
      ...(hostBusinessId ? [{ journal_entry_id: newEntry.id, business_id: hostBusinessId }] : []),
      ...(occurrenceId ? [{ journal_entry_id: newEntry.id, event_occurrence_id: occurrenceId }] : []),
    ];
    const { error: connectionError } = await admin.from("journal_entry_connections").insert(connectionRows);
    if (connectionError) return { error: connectionError.message };

    return { id: newEntry.id, status: "draft", isAdmin };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't start capturing this experience." };
  }
}
