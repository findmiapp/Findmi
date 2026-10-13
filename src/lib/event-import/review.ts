// Event Import V1 — Review defaults (pure; used by the importer UI and tests).
// Dates are shown/edited as Eastern wall-clock values — the zone every
// Findmi date is displayed in — and converted back server-side.
//
// V1B: each date keeps its own place. When every date shares one place,
// Review keeps a single Where section (`sharedPlace`); when places differ,
// each date is reviewed together with its place.
import {
  EMPTY_VENUE,
  sharedVenue,
  venueKey,
  type EventCandidate,
  type EventImportIntent,
  type EventImportMatches,
  type EventImportReview,
  type ImportedOccurrence,
  type ImportedVenue,
  type ReviewOccurrence,
  type ReviewPlace,
} from "./types";

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

const nextDay = (date: string) => {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

export function reviewDateFor(d: { start: string; end: string | null; hasTime: boolean }): { date: string; startTime: string; endTime: string } {
  if (!d.hasTime) return { date: d.start, startTime: "", endTime: "" };
  const s = toEasternParts(d.start);
  const e = d.end ? toEasternParts(d.end) : null;
  // Same day, or an evening that ends after midnight (6pm–12am); a longer
  // multi-day span is reviewed as its first day and the Business adjusts.
  const overnight = e && e.date === nextDay(s.date) && e.time <= s.time;
  return { date: s.date, startTime: s.time, endTime: e && (e.date === s.date || overnight) ? e.time : "" };
}

export function placeFromVenue(v: ImportedVenue, matches: EventImportMatches): ReviewPlace {
  const key = venueKey(v);
  const match = key ? matches.locations.find((l) => l.key === key) : undefined;
  return {
    venueName: v.name,
    address: v.address,
    city: v.city,
    state: v.state,
    postalCode: v.postalCode,
    useLocationId: match && match.confidence === "strong" ? match.id : null,
    matchKey: key || null,
  };
}

let rowSeq = 0;
function toReviewOccurrence(o: ImportedOccurrence, matches: EventImportMatches): ReviewOccurrence {
  rowSeq += 1;
  return { id: `d${rowSeq}`, ...reviewDateFor(o), place: placeFromVenue(o.venue, matches) };
}

export function emptyReviewOccurrence(place: ReviewPlace | null = null): ReviewOccurrence {
  rowSeq += 1;
  return { id: `d${rowSeq}`, date: "", startTime: "", endTime: "", place: place ?? placeFromVenue(EMPTY_VENUE, { event: null, locations: [], organizerBusiness: null, existingAppearance: null }) };
}

/** The occurrences Review starts with: upcoming ones — or, when every date
 * has passed, all of them (the Business decides). */
function includedByDefault(candidate: EventCandidate): ImportedOccurrence[] {
  const upcoming = candidate.occurrences.filter((o) => !o.past);
  return upcoming.length > 0 ? upcoming : candidate.occurrences;
}

/** Past dates left out of Review by default (shown so they can be added back). */
export function pastReviewOccurrences(candidate: EventCandidate, matches: EventImportMatches): ReviewOccurrence[] {
  const included = new Set(includedByDefault(candidate));
  return candidate.occurrences.filter((o) => !included.has(o)).map((o) => toReviewOccurrence(o, matches));
}

const sameName = (a: string | null, b: string) => (a ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Initial Review values. Existing records are pre-selected only when the
 * match is strong; a weak Event match or a possible Location match is shown
 * but left unselected. A host's import never pre-selects someone else's
 * Event. A participating Business is not shown as the organizer unless the
 * page's structured data says so explicitly. */
export function reviewDefaults(candidate: EventCandidate, matches: EventImportMatches, intent: EventImportIntent, businessName = ""): EventImportReview {
  const event = matches.event;
  const useEvent = event && event.confidence === "strong" && (intent === "participating" || event.hostedByThisBusiness) ? event.id : null;
  const included = includedByDefault(candidate);
  const shared = sharedVenue(included);
  const occurrences = included.length > 0 ? included.map((o) => toReviewOccurrence(o, matches)) : [emptyReviewOccurrence()];
  const organizer =
    intent === "participating" && businessName && candidate.organizer && sameName(candidate.organizer, businessName) && candidate.sources.organizer !== "structured"
      ? null
      : candidate.organizer;
  return {
    intent,
    title: candidate.title ?? "",
    description: candidate.description,
    imageUrl: candidate.imageUrl,
    sourceUrl: candidate.sourceUrl,
    occurrences,
    sharedPlace: shared !== null,
    place: placeFromVenue(shared ?? EMPTY_VENUE, matches),
    organizer,
    useEventId: useEvent,
  };
}

/** "18:00" → "6:00 PM". */
export function formatTime(hhmm: string): string {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "2026-09-24" → "Thu, Sep 24". */
export function formatDay(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** One-line summary of a reviewed date: "Thu, Sep 24 · 1:00 PM – 7:00 PM". */
export function occurrenceSummary(o: { date: string; startTime: string; endTime: string }): { day: string; time: string } {
  const start = formatTime(o.startTime);
  const end = formatTime(o.endTime);
  return { day: formatDay(o.date), time: start && end ? `${start} – ${end}` : start };
}

/** Business-facing success sentence — never "Appearance". */
export function successMessage(kind: "scheduled" | "requested" | "already", title: string, businessName: string, intent: EventImportIntent): string {
  if (kind === "already") return `${title} is already on ${businessName}'s Findmi schedule.`;
  if (kind === "requested") return `Request sent to join ${title}. It shows on ${businessName}'s schedule once the organizer confirms.`;
  return intent === "hosting"
    ? `${title} is now on ${businessName}'s Findmi schedule. Findmi reviews new Events before they're public.`
    : `${title} is now on ${businessName}'s Findmi schedule.`;
}
