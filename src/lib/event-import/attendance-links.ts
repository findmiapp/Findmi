// Event Import attendance links — client-safe (no parser imports), used by
// Review defaults in the browser and by the server.

type Cta = "tickets" | "rsvp" | "register";

/** Review's two attendance slots from, in precedence order: the operator's
 * explicitly pasted links, then what the Event Link's page evidenced. Each
 * slot fills only from its own kind — an RSVP is never a ticket link and
 * vice versa — and absence never clears anything. */
export function reviewAttendanceDefaults(
  explicit: { rsvp: { cta: "rsvp" | "register"; url: string } | null; tickets: string | null } | null | undefined,
  extracted: { cta: Cta | null; url: string | null } | null | undefined
): { attendance: { cta: Cta; url: string } | null; ticketsUrl: string | null } {
  const found = extracted?.cta && extracted.url ? { cta: extracted.cta, url: extracted.url } : null;
  const rsvp = explicit?.rsvp ?? (found && found.cta !== "tickets" ? found : null);
  const tickets = explicit?.tickets ?? (found && found.cta === "tickets" ? found.url : null);
  if (rsvp) return { attendance: rsvp, ticketsUrl: tickets && tickets !== rsvp.url ? tickets : null };
  return { attendance: tickets ? { cta: "tickets", url: tickets } : null, ticketsUrl: null };
}


export interface AttendanceSlots {
  /** RSVP / Registration: the label and its link ("" while typing). */
  rsvp: { cta: "rsvp" | "register"; url: string } | null;
  /** Ticket link ("" while typing), or null for none. */
  tickets: string | null;
}

/** Review state → the two visible slots. */
export function attendanceSlots(review: { attendance?: { cta: Cta | null; url: string | null } | null; ticketsUrl?: string | null }): AttendanceSlots {
  const a = review.attendance;
  if (a?.cta === "tickets") return { rsvp: null, tickets: a.url ?? "" };
  return {
    rsvp: a?.cta === "rsvp" || a?.cta === "register" ? { cta: a.cta, url: a.url ?? "" } : null,
    tickets: review.ticketsUrl ?? null,
  };
}

/** The two slots → Review state (`attendance` is the RSVP / Registration
 * action when there is one, else Get Tickets; `ticketsUrl` only alongside
 * an RSVP / Registration action). */
export function fromAttendanceSlots(slots: AttendanceSlots): { attendance: { cta: Cta; url: string } | null; ticketsUrl: string | null } {
  if (slots.rsvp) return { attendance: slots.rsvp, ticketsUrl: slots.tickets };
  return { attendance: slots.tickets !== null ? { cta: "tickets", url: slots.tickets } : null, ticketsUrl: null };
}
