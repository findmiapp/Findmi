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
export default function EventScheduleCtas({
  ticketsEnabled,
  ticketsUrl,
  rsvpEnabled,
  rsvp,
  vendorApplicationsEnabled,
  vendorApplication,
}: {
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

  const actions: { label: string; action: ResolvedAction; weight: "solid" | "outline" }[] = [];
  if (ticket) actions.push({ label: "Get Tickets", action: ticket, weight: "solid" });
  if (rsvpAction) actions.push({ label: "RSVP", action: rsvpAction, weight: "solid" });
  if (vendorAction) actions.push({ label: "Apply to Vend", action: vendorAction, weight: "outline" });

  if (actions.length === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2.5">
      {actions.map(({ label, action, weight }) => (
        <FormAction
          key={label}
          href={action.url}
          displayMode={action.displayMode}
          label={label}
          className={
            weight === "solid"
              ? "flex h-12 items-center justify-center rounded-full bg-findmi px-6 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
              : "flex h-11 items-center justify-center rounded-full border border-findmi/40 px-5 text-sm font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
          }
        />
      ))}
    </div>
  );
}
