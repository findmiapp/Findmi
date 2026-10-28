import type { SupabaseClient } from "@supabase/supabase-js";

// Event publication — WHO SUBMITTED decides the starting state (Findmi
// Consolidation pass; supersedes the earlier "live by default" rule):
//
//   - Admin (founder Admin, Admin Event Import, Admin Manage-As hosting,
//     legacy Appearance → Event conversion) is privileged: the Event is
//     public as soon as it is saved (NEW_EVENT_PUBLICATION).
//   - A Business / user submission (Host An Event, Business Event Import —
//     hosting or participating) is saved PENDING REVIEW
//     (SUBMITTED_EVENT_PUBLICATION): its submitting Business manages and
//     edits it straight away, but it is not public until Admin approves it
//     (Admin → Events → Needs Review; EVENT_PUBLISH_PATCH).
//
// The two existing columns keep their meanings — nothing is removed:
//   - events.is_demo — the app-level public-visibility gate. Every public
//     Event read requires is_demo = false.
//   - events.publication_status — 'live' | 'pending_review' | 'rejected'.
//     Enforced below the UI too: a restrictive RLS policy hides pending /
//     rejected Events (and their dates) from everyone except their own
//     managers (migration 20261121000000_consolidation_publication_rules).
// Archive / Trash (archived_at / trashed_at) stay the full shut-down.

export type EventSubmitter = "admin" | "business";

/** What a new ADMIN-created Event is saved with (public at once). */
export const NEW_EVENT_PUBLICATION = { is_demo: false, publication_status: "live" } as const;

/** What a new Business/user-submitted Event is saved with: pending Admin
 * approval, fully manageable by its submitter. */
export const SUBMITTED_EVENT_PUBLICATION = { is_demo: true, publication_status: "pending_review" } as const;

/** The ONE rule for a new Event's starting publication state. */
export function eventPublicationFor(submitter: EventSubmitter): { is_demo: boolean; publication_status: "live" | "pending_review" } {
  return submitter === "admin" ? NEW_EVENT_PUBLICATION : SUBMITTED_EVENT_PUBLICATION;
}

/** Publicly discoverable: approved, not hidden, not retired. */
export function isEventPublic(e: { is_demo?: boolean | null; publication_status?: string | null; archived_at?: string | null; trashed_at?: string | null }): boolean {
  return e.is_demo === false && (e.publication_status ?? "live") === "live" && !e.archived_at && !e.trashed_at;
}

/** How recent an Event's creation is for Admin's "New Events" oversight. */
export const NEW_EVENT_WINDOW_DAYS = 7;

export function newEventsSinceIso(now: number = Date.now()): string {
  return new Date(now - NEW_EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** create_owned_event writes the review state; an ADMIN-privileged caller
 * (e.g. Admin Manage-As) publishes what it just created with this.
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

/** Admin wording for where an Event stands publicly — the shared Admin
 * lifecycle vocabulary (Terminology Normalization): PUBLISHED (is_demo =
 * false), DRAFT (is_demo = true), ARCHIVED (archived_at — formerly "Shut
 * Down"), TRASHED (trashed_at). Labels only; the states are unchanged.
 * Admin-only (public "happening live" wording is unrelated). */
export function eventVisibility(e: { is_demo: boolean; archived_at?: string | null; trashed_at?: string | null }): EventVisibility {
  if (e.trashed_at) return "trashed";
  if (e.archived_at) return "archived";
  return e.is_demo ? "hidden" : "live";
}

export const EVENT_VISIBILITY_LABEL: Record<EventVisibility, string> = {
  live: "Published",
  hidden: "Draft",
  archived: "Archived",
  trashed: "Trashed",
};
