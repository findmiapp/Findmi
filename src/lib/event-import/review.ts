// Event Import V1 — Review defaults (pure; used by the importer UI and tests).
// Dates are shown/edited as Eastern wall-clock values — the zone every
// Findmi date is displayed in — and converted back server-side.
import type { EventCandidate, EventImportIntent, EventImportMatches, EventImportReview, ImportedDate } from "./types";

const TZ = "America/New_York";

export function toEasternParts(iso: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

export function reviewDateFor(d: ImportedDate): { date: string; startTime: string; endTime: string } {
  if (!d.hasTime) return { date: d.start, startTime: "", endTime: "" };
  const s = toEasternParts(d.start);
  const e = d.end ? toEasternParts(d.end) : null;
  // A multi-day span is reviewed as its first day; the Business adjusts.
  return { date: s.date, startTime: s.time, endTime: e && e.date === s.date ? e.time : "" };
}

/** Initial Review values. Existing records are pre-selected only when the
 * match is strong (an Event) or a likely duplicate (a Location); a weak
 * Event match is shown but left unselected. A host's import never
 * pre-selects someone else's Event. */
export function reviewDefaults(candidate: EventCandidate, matches: EventImportMatches, intent: EventImportIntent): EventImportReview {
  const event = matches.event;
  const useEvent = event && event.confidence === "strong" && (intent === "participating" || event.hostedByThisBusiness) ? event.id : null;
  return {
    intent,
    title: candidate.title ?? "",
    description: candidate.description,
    imageUrl: candidate.imageUrl,
    sourceUrl: candidate.sourceUrl,
    dates: candidate.dates.length > 0 ? candidate.dates.map(reviewDateFor) : [{ date: "", startTime: "", endTime: "" }],
    venueName: candidate.venue.name,
    address: candidate.venue.address,
    city: candidate.venue.city,
    state: candidate.venue.state,
    postalCode: candidate.venue.postalCode,
    organizer: candidate.organizer,
    useEventId: useEvent,
    useLocationId: matches.location?.id ?? null,
  };
}

/** Business-facing success sentence — never "Appearance". */
export function successMessage(kind: "scheduled" | "requested" | "already", title: string, businessName: string, intent: EventImportIntent): string {
  if (kind === "already") return `${title} is already on ${businessName}'s Findmi schedule.`;
  if (kind === "requested") return `Request sent to join ${title}. It shows on ${businessName}'s schedule once the organizer confirms.`;
  return intent === "hosting"
    ? `${title} is now on ${businessName}'s Findmi schedule. Findmi reviews new Events before they're public.`
    : `${title} is now on ${businessName}'s Findmi schedule.`;
}
