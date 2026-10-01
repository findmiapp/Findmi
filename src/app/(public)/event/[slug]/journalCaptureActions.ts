"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { isAdminSession } from "@/lib/admin/auth";
import { isoToLocalDateTime } from "@/lib/admin/form-helpers";
import {
  getEventBySlug,
  getBusinessesForEvent,
  eventHasAnyOccurrences,
  getEffectiveEventSchedule,
  findLocationByExactVenue,
} from "@/lib/data";
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

export type EventJournalCtaState = { kind: "none" } | { kind: "draft"; id: string } | { kind: "published"; id: string };

/** Read-only — drives the Journal CTA's own copy on the Event page itself
 * (Document Your Experience / Continue Your Journal Entry / View Your
 * Journal Entry). One extra query for an authenticated viewer, the exact
 * same shape startOrResumeEventJournalEntry's own lookup below already
 * runs (shared via findExistingEntryForEventUser) — never a second,
 * divergent check. A signed-out visitor (or a signed-in one the service-
 * role client can't reach) always gets "none" — the same default CTA a
 * brand-new account would see, never a guess at future state. */
export async function getEventJournalCtaState(eventId: string): Promise<EventJournalCtaState> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "none" };
  const admin = getAdminSupabase();
  if (!admin) return { kind: "none" };
  const existing = await findExistingEntryForEventUser(eventId, user.id, admin);
  if (!existing) return { kind: "none" };
  return existing.status === "published" ? { kind: "published", id: existing.id } : { kind: "draft", id: existing.id };
}

/** No new occurrence/business-resolution logic — this mirrors, field for
 * field, the exact same deterministic resolution EventPublicView's own
 * hero/"Hosted By" already computes server-side for this event (see that
 * file's own comments on hostBusiness/canonicalLocation precedence),
 * reusing its exported resolveAppearanceHostBusiness rather than
 * duplicating that resolution. Returns only what's genuinely
 * unambiguous — an event with 2+ un-featured, un-Appearance-linked
 * businesses, or no resolvable occurrence/Location, simply yields a null
 * for that one field rather than guessing. */
async function resolveDeterministicEventContext(eventId: string, event: Parameters<typeof getEffectiveEventSchedule>[0]) {
  const [businesses, hasOccurrences, matchedLocation, appearanceHostBusiness] = await Promise.all([
    getBusinessesForEvent(eventId),
    eventHasAnyOccurrences(eventId),
    event.venue_name ? findLocationByExactVenue(event.venue_name, event.address) : Promise.resolve(null),
    resolveAppearanceHostBusiness(eventId),
  ]);
  const upcomingOccurrences = hasOccurrences ? await getEffectiveEventSchedule(event, 40) : [];
  const canonicalLocation = upcomingOccurrences.find((o) => o.location)?.location ?? matchedLocation;
  const heroTemporalSource = upcomingOccurrences[0] ?? { start_at: event.start_at, end_at: event.end_at };
  const hostBusiness = businesses.find((b) => b.featured) ?? appearanceHostBusiness ?? (businesses.length === 1 ? businesses[0] : null);

  return {
    hostBusinessId: hostBusiness?.id ?? null,
    locationId: canonicalLocation?.id ?? null,
    entryDate: isoToLocalDateTime(heroTemporalSource.start_at).slice(0, 10),
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

    const { hostBusinessId, locationId, entryDate } = await resolveDeterministicEventContext(event.id, event);

    const { data: newEntry, error: insertError } = await admin
      .from("journal_entries")
      .insert({
        user_id: user.id,
        title: event.name,
        entry_date: entryDate,
        location_id: locationId,
        author_label: isAdmin ? "Findmi" : null,
      })
      .select("id")
      .single();
    if (insertError || !newEntry) return { error: insertError?.message ?? "Couldn't start this Journal entry." };

    const connectionRows = [
      { journal_entry_id: newEntry.id, event_id: event.id },
      ...(hostBusinessId ? [{ journal_entry_id: newEntry.id, business_id: hostBusinessId }] : []),
    ];
    const { error: connectionError } = await admin.from("journal_entry_connections").insert(connectionRows);
    if (connectionError) return { error: connectionError.message };

    return { id: newEntry.id, status: "draft", isAdmin };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't start capturing this experience." };
  }
}
