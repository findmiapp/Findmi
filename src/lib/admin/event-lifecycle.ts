import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eventEligibility, type EventTransition } from "./lifecycle-eligibility";

export type { EventTransition };

/** Admin Event lifecycle — the ONE implementation of the Event state
 * changes Admin can make, shared by the single-Event controls (Edit Event
 * and New Events: Publish / Hide / Shut Down) and the Events list bulk
 * toolbar, so the two can never drift. Existing canonical columns only
 * (lib/event-publication.ts):
 *
 *   LIVE       is_demo = false (publication_status 'live'), not archived/trashed
 *   HIDDEN     is_demo = true (reversible: Make Live publishes it again —
 *              also how a legacy pending_review / rejected Event is published)
 *   SHUT DOWN  archived_at set — the Archived tab. Restrictive RLS hides the
 *              Event, its dates and every schedule item linked to it.
 *              Shut Down and Archive are the SAME change (one action here).
 *   TRASH      trashed_at set (soft delete; existing bulk Trash action).
 *
 * Nothing here deletes or rewrites occurrences, occurrence details,
 * Locations, participating / Featured Businesses, categories, formats,
 * images or links — only the one column(s) below. Events have no approval
 * workflow (they are Live when created) and no notification on these
 * changes; none is added. Server-only. */

/** The exact patches (shared with the single-Event actions). */
export const EVENT_PUBLISH_PATCH = { is_demo: false, publication_status: "live" } as const;
export const EVENT_HIDE_PATCH = { is_demo: true } as const;
export const eventShutDownPatch = (now: Date = new Date()) => ({ archived_at: now.toISOString() });

export interface EventTransitionResult {
  op: EventTransition;
  changed: string[];
  /** Already in the requested state — untouched (no write). */
  already: string[];
  /** Shut Down / in Trash — not eligible for Make Live / Hide; in Trash for Shut Down. */
  inactive: string[];
  missing: string[];
  /** Not confirmed by the update — still in their old state, retryable. */
  failed: string[];
  changedSlugs: string[];
}

interface EventRow {
  id: string;
  slug: string | null;
  is_demo: boolean;
  publication_status: string | null;
  archived_at: string | null;
  trashed_at: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EVENT_BULK_MAX = 500;

export function cleanEventIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((v): v is string => typeof v === "string" && UUID.test(v)))].slice(0, EVENT_BULK_MAX);
}

/** Applies one transition to the given Events. Every id is re-read first;
 * only rows the guarded update itself returns count as changed. */
export async function transitionEvents(supabase: SupabaseClient, ids: string[], op: EventTransition, now: Date = new Date()): Promise<EventTransitionResult> {
  const result: EventTransitionResult = { op, changed: [], already: [], inactive: [], missing: [], failed: [], changedSlugs: [] };
  if (ids.length === 0) return result;
  const { data, error } = await supabase.from("events").select("id, slug, is_demo, publication_status, archived_at, trashed_at").in("id", ids);
  if (error) return { ...result, failed: [...ids] };
  const rows = new Map(((data ?? []) as EventRow[]).map((r) => [r.id, r]));
  const toChange: string[] = [];
  for (const id of ids) {
    const row = rows.get(id);
    if (!row) result.missing.push(id);
    else {
      const c = eventEligibility(op, row);
      if (c === "change") toChange.push(id);
      else if (c === "already") result.already.push(id);
      else result.inactive.push(id);
    }
  }
  if (toChange.length === 0) return result;
  const patch = op === "live" ? EVENT_PUBLISH_PATCH : op === "hide" ? EVENT_HIDE_PATCH : eventShutDownPatch(now);
  // Same guards as the selection: never touches a row that became Shut
  // Down / Trashed between the read and the write.
  const { data: updated, error: updateError } = await supabase.from("events").update(patch).in("id", toChange).is("trashed_at", null).is("archived_at", null).select("id");
  const confirmed = new Set(updateError ? [] : ((updated ?? []) as { id: string }[]).map((r) => r.id));
  for (const id of toChange) {
    if (confirmed.has(id)) {
      result.changed.push(id);
      const slug = rows.get(id)?.slug;
      if (slug) result.changedSlugs.push(slug);
    } else result.failed.push(id);
  }
  return result;
}

const VERB: Record<EventTransition, { done: string; already: string }> = {
  live: { done: "Made Live", already: "Already Live" },
  hide: { done: "Hidden", already: "Already Hidden" },
  shutdown: { done: "Shut Down", already: "Already Shut Down" },
};

/** One honest summary line ("8 Events Made Live · 3 Already Live"). */
export function describeEventTransition(r: EventTransitionResult): string {
  const v = VERB[r.op];
  const parts = [`${r.changed.length} Event${r.changed.length === 1 ? "" : "s"} ${v.done}`];
  if (r.already.length) parts.push(`${r.already.length} ${v.already}`);
  if (r.inactive.length) parts.push(`${r.inactive.length} Skipped (${r.op === "shutdown" ? "in Trash" : "Shut Down or in Trash — restore first"})`);
  if (r.missing.length) parts.push(`${r.missing.length} Not Found`);
  if (r.failed.length) parts.push(`${r.failed.length} Failed — still selected, try again`);
  return parts.join(" · ");
}
