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
/** Event compact action hierarchy — shared with the single-date path in
 * EventPublicView so both render identical buttons. */
export const EVENT_PRIMARY_CTA_CLASS =
  "flex h-11 min-w-0 flex-1 items-center justify-center rounded-xl bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600";
export const EVENT_SECONDARY_CTA_CLASS =
  "inline-flex h-9 items-center justify-center rounded-lg border border-findmi/40 bg-white px-3.5 text-xs font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50";

export default function EventScheduleCtas({
  eventId,
  ticketsEnabled,
  ticketsUrl,
  rsvpEnabled,
  rsvp,
  vendorApplicationsEnabled,
  vendorApplication,
  bare = false,
  pick,
  fallback,
  withPrimary,
}: {
  /** Public Event V2 — render just the buttons (no wrapping row) so the
   * caller can place them in its own action row beside Follow. */
  bare?: boolean;
  /** Event compact action hierarchy: "primary" renders only the ONE
   * dominant transactional action (Get Tickets, else RSVP) — or `fallback`
   * when none resolves for the selected date; "secondary" renders the
   * rest (Apply to Vend, a second transactional action) as compact
   * outlined buttons, plus `withPrimary` when a primary exists. */
  pick?: "primary" | "secondary";
  fallback?: React.ReactNode;
  withPrimary?: React.ReactNode;
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
  if (!selected || selectedState === "cancelled") return pick === "primary" ? <>{fallback ?? null}</> : null;

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

  if (pick) {
    const primaryIdx = actions.findIndex((a) => a.weight === "solid");
    const track = (eventName: (typeof actions)[number]["eventName"]) => ({
      event_name: eventName,
      subject_type: "event_occurrence",
      subject_id: selected.id,
      event_id: eventId,
      event_occurrence_id: selected.id,
      location_id: selected.location?.id ?? undefined,
    });
    if (pick === "primary") {
      const p = actions[primaryIdx];
      if (!p) return <>{fallback ?? null}</>;
      return (
        <FormAction
          href={p.action.url}
          displayMode={p.action.displayMode}
          label={p.label}
          className={EVENT_PRIMARY_CTA_CLASS}
          track={track(p.eventName)}
        />
      );
    }
    const rest = actions.filter((_, i) => i !== primaryIdx);
    if (rest.length === 0 && !(primaryIdx >= 0 && withPrimary)) return null;
    return (
      <>
        {rest.map((a) => (
          <FormAction
            key={a.label}
            href={a.action.url}
            displayMode={a.action.displayMode}
            label={a.label}
            className={EVENT_SECONDARY_CTA_CLASS}
            track={track(a.eventName)}
          />
        ))}
        {primaryIdx >= 0 ? withPrimary : null}
      </>
    );
  }

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
