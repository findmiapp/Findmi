// Admin Event Import — merges what the Event Link's page says (read by the
// existing Event URL importer) into the operator's explicit structured
// values. Pure.
//
// Explicit structured values are authoritative: the source page only FILLS
// what the block left empty (image, description, organizer, place, times
// for the SAME dates, or the dates themselves when the block gives none). A
// different source value never replaces an explicit one; it is reported as
// a note so the operator can see the difference.
import { EMPTY_VENUE, venueKey, type EventCandidate, type ImportedOccurrence, type ImportedVenue } from "./types";

const NY = "America/New_York";
/** The local (New York) calendar day of an occurrence. */
export function occurrenceDay(o: Pick<ImportedOccurrence, "start" | "hasTime">): string {
  if (!o.hasTime || /^\d{4}-\d{2}-\d{2}$/.test(o.start)) return o.start.slice(0, 10);
  return new Date(o.start).toLocaleDateString("en-CA", { timeZone: NY });
}
const emptyVenue = (v: ImportedVenue | null | undefined) => !v || (!venueKey(v) && !v.city);

export interface StructuredMerge {
  candidate: EventCandidate;
  /** Fields the source page filled (Review shows "From the Event Link"). */
  filled: string[];
  /** Explicit values the source disagreed with (kept as written). */
  differences: string[];
}

export function mergeSourceIntoStructured(explicit: EventCandidate, source: EventCandidate): StructuredMerge {
  const filled: string[] = [];
  const differences: string[] = [];
  const next: EventCandidate = { ...explicit, occurrences: [...explicit.occurrences], sources: { ...explicit.sources } };

  if (!next.title && source.title) {
    next.title = source.title;
    next.sources.title = source.sources.title ?? "page";
    filled.push("name");
  }
  if (!next.description && source.description) {
    next.description = source.description;
    next.sources.description = source.sources.description ?? "page";
    filled.push("description");
  }
  if (!next.imageUrl && source.imageUrl) {
    next.imageUrl = source.imageUrl;
    next.sources.image = source.sources.image ?? "page";
    filled.push("image");
  }
  if (!next.organizer && source.organizer) {
    next.organizer = source.organizer;
    next.sources.organizer = source.sources.organizer ?? "page";
    filled.push("organizer");
  }
  if (!next.platform && source.platform) next.platform = source.platform;

  const sourcePlace = source.occurrences.find((o) => !emptyVenue(o.venue))?.venue ?? source.place ?? null;
  if (next.occurrences.length === 0 && source.occurrences.length > 0) {
    // No explicit dates: the page's dates (each with the explicit place when given).
    const place = next.place && !emptyVenue(next.place) ? next.place : null;
    next.occurrences = source.occurrences.map((o) => ({ ...o, venue: place ? { ...place } : o.venue }));
    next.place = undefined;
    next.sources.dates = source.sources.dates ?? "page";
    filled.push("dates");
  } else if (next.occurrences.length > 0) {
    // Explicit dates stay exactly as written; a date with no time takes the
    // page's time for that SAME day only.
    const byDay = new Map<string, ImportedOccurrence>();
    for (const o of source.occurrences) if (o.hasTime && !byDay.has(occurrenceDay(o))) byDay.set(occurrenceDay(o), o);
    let timesFilled = false;
    next.occurrences = next.occurrences.map((o) => {
      const match = byDay.get(occurrenceDay(o));
      if (!o.hasTime && match) {
        timesFilled = true;
        return { ...o, start: match.start, end: match.end, hasTime: true };
      }
      if (o.hasTime && match && (match.start !== o.start || (match.end && o.end && match.end !== o.end))) {
        differences.push(`The Event Link lists a different time on ${occurrenceDay(o)}; your time was kept.`);
      }
      return o;
    });
    if (timesFilled) filled.push("times");
    const sourceDays = new Set(source.occurrences.map(occurrenceDay));
    const explicitDays = new Set(next.occurrences.map(occurrenceDay));
    const extra = [...sourceDays].filter((d) => !explicitDays.has(d));
    if (extra.length > 0) differences.push(`The Event Link also lists ${extra.length === 1 ? "another date" : `${extra.length} other dates`} (${extra.slice(0, 4).join(", ")}); only your dates are used.`);
  }

  // Place: only when the block gave none.
  const explicitHasPlace = next.occurrences.some((o) => !emptyVenue(o.venue)) || !emptyVenue(next.place);
  if (!explicitHasPlace && sourcePlace) {
    if (next.occurrences.length > 0) next.occurrences = next.occurrences.map((o) => ({ ...o, venue: { ...EMPTY_VENUE, ...sourcePlace } }));
    else next.place = { ...sourcePlace };
    next.sources.venue = source.sources.venue ?? "page";
    filled.push("place");
  }
  if (!explicitHasPlace && !sourcePlace && source.online) next.online = true;

  return { candidate: next, filled, differences };
}
