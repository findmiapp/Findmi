"use client";

import type { ResolvedForm } from "@/lib/forms";
import { validateCustomDestination } from "@/lib/navigation";
import FormAction from "./FormAction";
import { useEventOccurrence } from "./EventOccurrenceContext";

type ResolvedAction = Pick<ResolvedForm, "url" | "displayMode">;

/** occurrence override -> parent-resolved action. An occurrence override
 * is always a plain founder-typed URL (no Form Manager assignment
 * concept at the occurrence level, out of scope for this pass), so it
 * only ever renders in "external" mode — same convention the old
 * EventOccurrenceCard already used for ticket_url_override. Validated
 * through the same shared destination check every other founder-entered
 * link on the site goes through; an invalid override is treated as
 * absent and falls through to the parent's already-resolved action. */
function resolveAction(override: string | null | undefined, parent: ResolvedAction | null): ResolvedAction | null {
  if (override) {
    const check = validateCustomDestination(override);
    if (check.ok) return { url: check.value, displayMode: "external" };
  }
  return parent;
}

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
}: {
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

  const ticket = ticketsEnabled
    ? resolveAction(selected.ticket_url_override, ticketsUrl ? { url: ticketsUrl, displayMode: "external" } : null)
    : null;
  const rsvpAction = rsvpEnabled ? resolveAction(selected.rsvp_url_override, rsvp) : null;
  const vendorAction = vendorApplicationsEnabled
    ? resolveAction(selected.vendor_apply_url_override, vendorApplication)
    : null;

  const actions: { label: string; action: ResolvedAction; weight: "solid" | "outline"; eventName: "click_tickets" | "click_rsvp" | "click_apply_to_vend" }[] =
    [];
  if (ticket) actions.push({ label: "Get Tickets", action: ticket, weight: "solid", eventName: "click_tickets" });
  if (rsvpAction) actions.push({ label: "RSVP", action: rsvpAction, weight: "solid", eventName: "click_rsvp" });
  if (vendorAction) actions.push({ label: "Apply to Vend", action: vendorAction, weight: "outline", eventName: "click_apply_to_vend" });

  if (actions.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-stretch gap-2.5">
      {actions.map(({ label, action, weight, eventName }) => (
        <FormAction
          key={label}
          href={action.url}
          displayMode={action.displayMode}
          label={label}
          className={
            weight === "solid"
              ? "flex h-12 flex-1 items-center justify-center rounded-2xl bg-findmi px-6 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
              : "flex h-12 flex-1 items-center justify-center rounded-2xl border border-findmi/40 px-5 text-sm font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
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
      ))}
    </div>
  );
}
