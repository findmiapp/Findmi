"use client";

import { resolveEventCtas, type EventCtaConfig, type ResolvedAction, type ResolvedEventCta } from "@/lib/event-ctas";
import FormAction from "./FormAction";
import { useEventOccurrence } from "./EventOccurrenceContext";

// The action decision itself lives in lib/event-ctas.ts (shared, pure);
// re-exported here for existing importers.
export { resolveEventCtas };
export type { EventCtaConfig, ResolvedEventCta };

/** RSVP / Tickets / Apply to Vend for a recurring event (Tier A CTAs) —
 * Recurring Events V2. Reuses the exact same resolved parent-level
 * values the legacy path already computes (resolveEventActionForm for
 * RSVP/Apply to Vend, the plain Ticket Link for Tickets — Tickets has no
 * Form Manager purpose) and renders through the same FormAction
 * component; the only new logic is preferring the selected occurrence's
 * own override when it has one. Each *Enabled flag is the same toggle
 * (and, for vendor applications, deadline) gate the legacy path already
 * applies — a founder-disabled action stays disabled regardless of an
 * occurrence override. Renders nothing while the selected occurrence is
 * cancelled, or while there's no selection at all ("No upcoming dates
 * announced"). */
/** Event Page Visual Convergence pass — Directions moved OUT of this row
 * and into the compact Tier B action grid (see EventUtilityActions),
 * alongside Save/Add to Calendar/Share, matching the approved reference's
 * composition: RSVP/Tickets/Apply to Vend alone on their own (largest)
 * row, with Directions/Save/Calendar/Share as a separate row of compact,
 * equally-sized icon-over-label controls directly beneath it. This
 * component now renders ONLY Tier A — one self-guarded flex row, still
 * depending on the selected occurrence (client-only, post-hydration via
 * useEventOccurrence), since the caller (a Server Component) can't know
 * in advance whether any Tier A action exists for the current selection.
 * flex-1 on every button is what lets 1, 2, or 3 of them split the row's
 * width evenly. */
export default function EventScheduleCtas({
  eventId,
  ticketsEnabled,
  ticketsUrl,
  rsvpEnabled,
  rsvp,
  vendorApplicationsEnabled,
  vendorApplication,
  rsvpLabel,
  bare = false,
}: {
  rsvpLabel?: string;
  /** Public Event V2 — render just the buttons (no wrapping row) so the
   * caller can place them in its own action row beside Follow. */
  bare?: boolean;
  /** Analytics attribution only. */
  eventId: string;
  ticketsEnabled: boolean;
  ticketsUrl: string | null;
  rsvpEnabled: boolean;
  rsvp: ResolvedAction | null;
  vendorApplicationsEnabled: boolean;
  vendorApplication: ResolvedAction | null;
}) {
  const { selected, selectedState } = useEventOccurrence();
  if (!selected || selectedState === "cancelled") return null;

  const actions = resolveEventCtas(selected, { ticketsEnabled, ticketsUrl, rsvpEnabled, rsvp, rsvpLabel, vendorApplicationsEnabled, vendorApplication });

  if (actions.length === 0) return null;

  const buttons = actions.map(({ label, action, weight, eventName }) => (
        <FormAction
          key={label}
          href={action.url}
          displayMode={action.displayMode}
          label={label}
          className={
            weight === "solid"
              ? "flex h-11 min-w-[8rem] flex-1 items-center justify-center rounded-full bg-findmi px-6 text-button font-bold text-white transition hover:bg-findmi-600"
              : "flex h-11 min-w-[8rem] flex-1 items-center justify-center rounded-full border border-findmi/40 bg-white px-5 text-button font-bold text-findmi-700 transition hover:bg-findmi-50"
          }
          track={{
            event_name: eventName,
            subject_type: "event_occurrence",
            subject_id: selected.id,
            event_id: eventId,
            event_occurrence_id: selected.id,
            location_id: selected.location?.id ?? undefined,
          }}
        />
      ));
  if (bare) return <>{buttons}</>;
  return <div className="mt-3 flex flex-wrap items-stretch gap-2.5">{buttons}</div>;
}
