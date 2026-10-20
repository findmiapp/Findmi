import type { ResolvedForm } from "@/lib/forms";
import { validateCustomDestination } from "@/lib/navigation";

// Event organizer actions (Get Tickets / RSVP / Apply to Vend) — the pure
// domain decision, shared by every surface that shows them. Moved here
// verbatim from components/EventScheduleCtas.tsx (a "use client" module)
// so Server Components and other products (JerseyCity.guide) can use the
// same rule; the Findmi components import it from here unchanged.

export type ResolvedAction = Pick<ResolvedForm, "url" | "displayMode">;

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

export interface EventCtaConfig {
  ticketsEnabled: boolean;
  ticketsUrl: string | null;
  rsvpEnabled: boolean;
  rsvp: ResolvedAction | null;
  /** "RSVP" (default) or "Register" — the Event's rsvp_cta label. */
  rsvpLabel?: string;
  vendorApplicationsEnabled: boolean;
  vendorApplication: ResolvedAction | null;
}

export type ResolvedEventCta = {
  label: string;
  action: ResolvedAction;
  weight: "solid" | "outline";
  eventName: "click_tickets" | "click_rsvp" | "click_apply_to_vend";
};

/** The organizer actions for one selected date, in priority order (Get
 * Tickets, RSVP, Apply to Vend) — per-date overrides win over the Event's
 * own destinations. Shared by EventScheduleCtas and EventActionRow. */
export function resolveEventCtas(
  selected: { ticket_url_override: string | null; rsvp_url_override: string | null; vendor_apply_url_override: string | null },
  c: EventCtaConfig
): ResolvedEventCta[] {
  const ticket = c.ticketsEnabled
    ? resolveAction(selected.ticket_url_override, c.ticketsUrl ? { url: c.ticketsUrl, displayMode: "external" } : null)
    : null;
  const rsvpAction = c.rsvpEnabled ? resolveAction(selected.rsvp_url_override, c.rsvp) : null;
  const vendorAction = c.vendorApplicationsEnabled ? resolveAction(selected.vendor_apply_url_override, c.vendorApplication) : null;
  const actions: ResolvedEventCta[] = [];
  if (ticket) actions.push({ label: "Get Tickets", action: ticket, weight: "solid", eventName: "click_tickets" });
  if (rsvpAction) actions.push({ label: c.rsvpLabel ?? "RSVP", action: rsvpAction, weight: "solid", eventName: "click_rsvp" });
  if (vendorAction) actions.push({ label: "Apply to Vend", action: vendorAction, weight: "outline", eventName: "click_apply_to_vend" });
  return actions;
}
