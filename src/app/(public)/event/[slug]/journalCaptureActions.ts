"use server";

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

// Journal Live Capture pass — "Document this experience" on an Event's
// public page. Authorized-admin-only: this is the ONE entry point that
// creates a brand-new journal_entries row outside the normal self-serve
// Create flow, so both layers of this codebase's existing admin
// authorization apply — isAdminSession() (gates that this is a real
// founder session at all) AND a real signed-in Supabase consumer session
// (requireUser(), reused from the exact same check every Journal Server
// Action already performs) — because journal_entries.user_id is a real,
// NOT NULL foreign key to auth.users, same as every entry created through
// the normal Create wizard. An admin-password session alone carries no
// Supabase user identity to own a new row with (see requireOwnEntry's own
// comment in my-world/journal/actions.ts for the parallel reasoning on the
// EDIT side of this same gap). The founder's own real Findmi account —
// the same one that already owns every existing Journal entry, including
// the live Babylist one — is expected to already be signed in for this
// flow; if it isn't, this returns a clear, actionable error rather than
// silently failing or guessing an owner.
async function requireCaptureAuthorizedUser() {
  if (!(await isAdminSession())) throw new Error("Not authorized.");
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to your Findmi account to start capturing.");
  return user;
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

/** Create-or-resume — the core requirement. Looks for an existing DRAFT
 * (never a published entry — a published one is done, not a live capture
 * in progress) already connected to this event, owned by the same real
 * user this request resolves to. Finds one -> returns it unchanged,
 * touching nothing. Finds none -> creates exactly one, with deterministic
 * context only, author_label fixed to "Findmi" for this admin capture
 * path specifically (per instruction — not for the normal consumer Create
 * flow, which is untouched). No new table, no new status, no schema
 * change: the same journal_entries/journal_entry_connections rows the
 * rest of Journal already reads/writes. */
export async function startOrResumeEventJournalCapture(eventSlug: string): Promise<{ id: string } | { error: string }> {
  try {
    const user = await requireCaptureAuthorizedUser();

    const event = await getEventBySlug(eventSlug);
    if (!event) return { error: "That event couldn't be found." };

    const admin = getAdminSupabase();
    if (!admin) return { error: "Server isn't configured." };

    const { data: existingDrafts } = await admin
      .from("journal_entries")
      .select("id, journal_entry_connections!inner(event_id)")
      .eq("user_id", user.id)
      .eq("status", "draft")
      .eq("journal_entry_connections.event_id", event.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const existing = existingDrafts?.[0];
    if (existing) return { id: existing.id };

    const { hostBusinessId, locationId, entryDate } = await resolveDeterministicEventContext(event.id, event);

    const { data: newEntry, error: insertError } = await admin
      .from("journal_entries")
      .insert({
        user_id: user.id,
        title: event.name,
        entry_date: entryDate,
        location_id: locationId,
        author_label: "Findmi",
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

    return { id: newEntry.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't start capturing this experience." };
  }
}
