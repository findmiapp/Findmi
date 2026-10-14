import type { SupabaseClient } from "@supabase/supabase-js";

// Event publication — LIVE BY DEFAULT. A valid new Event (Host an Event,
// Event Import — single, hosted or a calendar's Events — and the legacy
// Appearance → Event conversion) is public as soon as it is saved. Findmi
// Admin oversees instead of approving: every new Event is listed under
// Admin → Events → New Events (and counted on Admin Home), and Admin can
// Hide or Shut Down any Event at any time.
//
// The two existing columns keep their meanings — nothing is removed:
//   - events.is_demo — THE public-visibility gate. Every public Event
//     read (Event page, /events, Location activity, Business activity)
//     requires is_demo = false. Hide sets it back to true.
//   - events.publication_status — 'live' for every Event Findmi has
//     published (the column default). 'pending_review' / 'rejected' are
//     kept for Events created before this pass; no path creates them now.
// Archive / Trash (archived_at / trashed_at) stay the full shut-down:
// restrictive RLS hides the Event, its dates AND every schedule item
// linked to it from all public reads, while the rows are preserved.

/** What a newly created Event is saved with. */
export const NEW_EVENT_PUBLICATION = { is_demo: false, publication_status: "live" } as const;

/** How recent an Event's creation is for Admin's "New Events" oversight. */
export const NEW_EVENT_WINDOW_DAYS = 7;

export function newEventsSinceIso(now: number = Date.now()): string {
  return new Date(now - NEW_EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** create_owned_event (the RPC Host an Event and hosted imports use)
 * still writes the old review state; this publishes what it just created.
 * Guarded to that exact state, so it never re-publishes an Event Admin
 * already hid. If it fails the Event simply stays non-public — never the
 * other way round — and it is still listed under New Events. */
export async function publishCreatedEvent(admin: SupabaseClient, eventId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("events")
    .update(NEW_EVENT_PUBLICATION)
    .eq("id", eventId)
    .eq("publication_status", "pending_review")
    .select("id")
    .maybeSingle();
  return !error && Boolean(data);
}

export type EventVisibility = "live" | "hidden" | "archived" | "trashed";

/** Admin wording for where an Event stands publicly. */
export function eventVisibility(e: { is_demo: boolean; archived_at?: string | null; trashed_at?: string | null }): EventVisibility {
  if (e.trashed_at) return "trashed";
  if (e.archived_at) return "archived";
  return e.is_demo ? "hidden" : "live";
}

export const EVENT_VISIBILITY_LABEL: Record<EventVisibility, string> = {
  live: "Live",
  hidden: "Hidden",
  archived: "Shut Down",
  trashed: "Trash",
};
