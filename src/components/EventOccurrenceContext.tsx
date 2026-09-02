"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { EventOccurrenceWithLocation } from "@/lib/data";

// Recurring Events V2 — the single shared selectedOccurrence controller.
// Per the pass spec: no individual component (hero, Directions/Add to
// Calendar, an Upcoming Dates card) is ever allowed to independently
// decide its own occurrence. Everything date-specific on a recurring
// event's public page reads from this one context instead.

export type OccurrenceScheduleState = "current" | "next" | "selected" | "cancelled" | "none";

interface EventOccurrenceContextValue {
  occurrences: EventOccurrenceWithLocation[];
  selected: EventOccurrenceWithLocation | null;
  selectedState: OccurrenceScheduleState;
  select: (occurrenceId: string) => void;
}

const EventOccurrenceContext = createContext<EventOccurrenceContextValue | null>(null);

/** Read the shared selectedOccurrence state. Must be called from inside
 * an EventOccurrenceProvider (only rendered for events that actually
 * have event_occurrences rows — see the public event page). */
export function useEventOccurrence(): EventOccurrenceContextValue {
  const ctx = useContext(EventOccurrenceContext);
  if (!ctx) {
    throw new Error("useEventOccurrence must be used within an EventOccurrenceProvider");
  }
  return ctx;
}

type DefaultResolution =
  | { occurrence: EventOccurrenceWithLocation; state: "current" | "next" }
  | { occurrence: null; state: "none" };

/** CURRENT = a scheduled occurrence genuinely happening right now
 * (start_at <= now < end_at). NEXT = the nearest still-to-come scheduled
 * occurrence. Cancelled occurrences are never eligible for either — the
 * `status === "scheduled"` guard on both checks is what enforces that.
 * `occurrences` is expected pre-sorted ascending by start_at (matches
 * getUpcomingOccurrencesForEvent's own ordering), so the first match for
 * each is the nearest one. */
function resolveDefault(occurrences: EventOccurrenceWithLocation[]): DefaultResolution {
  const now = Date.now();
  const current = occurrences.find(
    (o) => o.status === "scheduled" && new Date(o.start_at).getTime() <= now && new Date(o.end_at).getTime() > now
  );
  if (current) return { occurrence: current, state: "current" };

  const next = occurrences.find((o) => o.status === "scheduled" && new Date(o.start_at).getTime() > now);
  if (next) return { occurrence: next, state: "next" };

  return { occurrence: null, state: "none" };
}

// A one-shot re-evaluation clock, not a poll: `tick` only exists to force
// resolveDefault() to re-run against the current wall clock, and only
// ever advances from a real trigger — either a precisely-timed timer for
// the NEXT occurrence's own start/end boundary (re-armed once per
// recompute, never on a fixed interval) or the tab becoming visible
// again. Nothing here fetches, subscribes, or repeats on a schedule.
const MAX_BOUNDARY_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // safety clamp, see the effect below

/** Wraps the recurring-event detail experience (hero schedule summary,
 * Directions/Add to Calendar, the Upcoming Dates selector) in one shared
 * selectedOccurrence state. The default selection (CURRENT if one is
 * happening now, else the nearest NEXT scheduled occurrence, else none)
 * is recomputed against the browser's own clock — at mount, exactly when
 * the current/next occurrence's own start_at or end_at arrives (so an
 * already-open page rolls CURRENT -> the following NEXT, or NEXT ->
 * CURRENT, with zero admin intervention and no page reload), and again
 * whenever the tab regains visibility (covers a backgrounded/returned-to
 * tab whose timers were throttled). A visitor's own manual pick is never
 * overridden by this — `select()` marks the selection manual, and only a
 * still-automatic (never-manually-changed) selection is kept synced to
 * the live default as it moves. */
export function EventOccurrenceProvider({
  occurrences,
  children,
}: {
  occurrences: EventOccurrenceWithLocation[];
  children: React.ReactNode;
}) {
  const [tick, setTick] = useState(0);
  // `tick` is a deliberate cache-buster, not read inside the callback —
  // its only job is forcing this to re-run against the current wall
  // clock when the boundary timer/visibility effects below advance it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initial = useMemo(() => resolveDefault(occurrences), [occurrences, tick]);

  const [selectedId, setSelectedId] = useState<string | null>(initial.occurrence?.id ?? null);
  const [hasManualSelection, setHasManualSelection] = useState(false);

  // Follow the live default until (and unless) the visitor manually picks
  // a different date — this is what actually performs the rollover once
  // `initial` recomputes to a new occurrence.
  useEffect(() => {
    if (!hasManualSelection) {
      setSelectedId(initial.occurrence?.id ?? null);
    }
  }, [initial, hasManualSelection]);

  // Re-evaluate the moment the current/next occurrence's own start_at
  // (if NEXT, becoming CURRENT) or end_at (if CURRENT, ending) arrives —
  // a single timer for exactly that instant, re-armed only when `initial`
  // itself changes. Clamped to a safe max delay purely to avoid the
  // browser's ~24.8-day setTimeout overflow (a delay beyond the 32-bit
  // signed int range fires almost immediately instead of waiting) — not
  // a recurring poll; a genuinely distant occurrence is instead caught by
  // the visibility-change effect below the next time someone opens the
  // tab.
  useEffect(() => {
    if (!initial.occurrence) return;
    const boundaryMs =
      initial.state === "current"
        ? new Date(initial.occurrence.end_at).getTime()
        : new Date(initial.occurrence.start_at).getTime();
    const delay = boundaryMs - Date.now();
    if (delay <= 0) return; // resolveDefault() already reflects "now" correctly on the next render
    const id = window.setTimeout(() => setTick((t) => t + 1), Math.min(delay, MAX_BOUNDARY_TIMEOUT_MS));
    return () => window.clearTimeout(id);
  }, [initial]);

  // Covers a backgrounded tab (where the boundary timer above may have
  // been throttled/delayed by the browser) coming back into view.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  const select = useCallback((occurrenceId: string) => {
    setHasManualSelection(true);
    setSelectedId(occurrenceId);
  }, []);

  const value = useMemo<EventOccurrenceContextValue>(() => {
    const selected = occurrences.find((o) => o.id === selectedId) ?? null;
    let selectedState: OccurrenceScheduleState = "none";
    if (selected) {
      if (selected.status === "cancelled") {
        selectedState = "cancelled";
      } else if (initial.occurrence && selected.id === initial.occurrence.id) {
        // The default (current/next) card, re-selected or never changed —
        // keep its real state label rather than relabeling it "selected".
        selectedState = initial.state;
      } else {
        selectedState = "selected";
      }
    }
    return { occurrences, selected, selectedState, select };
  }, [occurrences, selectedId, initial, select]);

  return <EventOccurrenceContext.Provider value={value}>{children}</EventOccurrenceContext.Provider>;
}
