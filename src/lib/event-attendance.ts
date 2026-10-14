// Event attendance + location visibility — shared vocabulary (pure; safe for
// client and server).
//
// Attendance reuses the Event's EXISTING action fields rather than a second
// system:
//   Get Tickets → tickets_enabled + tickets_url
//   RSVP        → rsvp_enabled + rsvp_url            (rsvp_cta null/'rsvp')
//   Register    → rsvp_enabled + rsvp_url            (rsvp_cta 'register')
// rsvp_cta only changes the LABEL of the existing RSVP action (registration
// is the same "say you're coming" action); null keeps every Admin-created
// RSVP exactly as before.
//
// external_url stays the source / "Event details" link — it is never an
// attendance destination on its own.
//
// location_visibility records what the SOURCE made public:
//   exact  — a precise public venue/address;
//   broad  — only broad geography (e.g. "New York, NY");
//   hidden — the organizer withholds the address until registration;
//   none   — no meaningful location.
// null = an Event created before this existed (treated as before).

export type RsvpCta = "rsvp" | "register";
export type LocationVisibility = "exact" | "broad" | "hidden" | "none";

export const LOCATION_VISIBILITIES: readonly LocationVisibility[] = ["exact", "broad", "hidden", "none"];

export function parseRsvpCta(value: unknown): RsvpCta | null {
  return value === "rsvp" || value === "register" ? value : null;
}

export function parseLocationVisibility(value: unknown): LocationVisibility | null {
  return typeof value === "string" && (LOCATION_VISIBILITIES as readonly string[]).includes(value) ? (value as LocationVisibility) : null;
}

/** The public label of the Event's RSVP action. */
export function rsvpActionLabel(rsvpCta: unknown): "RSVP" | "Register" {
  return parseRsvpCta(rsvpCta) === "register" ? "Register" : "RSVP";
}

/** The organizer withholds the address until people register. */
export function isLocationHidden(visibility: unknown): boolean {
  return parseLocationVisibility(visibility) === "hidden";
}

export const HIDDEN_LOCATION_COPY = "Location shared after registration";
