"use client";

import type { ResolvedForm } from "@/lib/forms";
import { validateCustomDestination } from "@/lib/navigation";
import FormAction from "./FormAction";
import { useEventOccurrence } from "./EventOccurrenceContext";
import { cityState } from "@/lib/format";
import { trackEvent } from "@/lib/analytics/track";

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
/** Event CTA Layout pass — renders Tier A (RSVP/Get Tickets/Apply to Vend)
 * AND Directions together as ONE self-guarded flex row (`[ RSVP ]
 * [ DIRECTIONS ]` on mobile), rather than two separately-rendered pieces
 * the caller wraps in its own div. Both halves depend on the selected
 * occurrence (a client-only, post-hydration value via useEventOccurrence),
 * so this component owns the single "is there anything at all to show"
 * decision itself — the caller (EventPublicView, a Server Component)
 * can't know that in advance, and wrapping an always-rendered flex div
 * around two pieces that might both independently return null would
 * leave a stray empty div (a small but real layout bug). flex-1 on every
 * button is what lets 1, 2, or 3 of them split the row's width evenly. */
export default function EventScheduleCtas({
  eventId,
  ticketsEnabled,
  ticketsUrl,
  rsvpEnabled,
  rsvp,
  vendorApplicationsEnabled,
  vendorApplication,
  directionsEnabled,
}: {
  /** Analytics attribution only. */
  eventId: string;
  ticketsEnabled: boolean;
  ticketsUrl: string | null;
  rsvpEnabled: boolean;
  rsvp: ResolvedAction | null;
  vendorApplicationsEnabled: boolean;
  vendorApplication: ResolvedAction | null;
  directionsEnabled: boolean;
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

  // Same resolution EventScheduleDirections (EventScheduleActions.tsx)
  // uses, duplicated here rather than imported so this component can make
  // its own single "render anything at all" decision without composing
  // two components each capable of independently returning null.
  const location = selected.location;
  const mapQuery = location
    ? [location.name, location.address, cityState(location.city, location.state)].filter(Boolean).join(", ")
    : null;
  const directionsHref =
    directionsEnabled && mapQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}` : null;

  if (actions.length === 0 && !directionsHref) return null;

  return (
    <div className="mt-4 flex flex-wrap items-stretch gap-2.5">
      {actions.map(({ label, action, weight, eventName }) => (
        <FormAction
          key={label}
          href={action.url}
          displayMode={action.displayMode}
          label={label}
          className={
            weight === "solid"
              ? "flex h-12 flex-1 items-center justify-center rounded-2xl bg-findmi px-6 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
              : "flex h-11 flex-1 items-center justify-center rounded-2xl border border-findmi/40 px-5 text-sm font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
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
      {directionsHref && (
        <a
          href={directionsHref}
          target="_blank"
          rel="noreferrer"
          className="flex h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-2xl border border-findmi/40 px-4 text-sm font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
          onClick={() =>
            trackEvent({
              event_name: "click_directions",
              subject_type: "event_occurrence",
              subject_id: selected.id,
              event_id: eventId,
              event_occurrence_id: selected.id,
              location_id: location?.id,
            })
          }
        >
          <DirectionsGlyph className="h-3.5 w-3.5 shrink-0" />
          Directions
        </a>
      )}
    </div>
  );
}

// Same glyph/sizing convention as EventScheduleActions' own Directions
// link (h-3.5 w-3.5, strokeWidth 1.8, currentColor).
function DirectionsGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 2L4.5 20.5l.9.9L12 18l6.6 3.4.9-.9L12 2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
