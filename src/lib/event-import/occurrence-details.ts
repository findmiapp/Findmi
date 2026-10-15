// Event Occurrence details (event_occurrences.details) — one date's own
// descriptive text / programming. Pure.

/** The database bound (event_occurrences_details_length_check). */
export const OCCURRENCE_DETAILS_MAX = 2000;

/** Plain text: line breaks kept (at most one blank line), spaces collapsed,
 * bounded; empty → null. */
export function cleanOccurrenceDetails(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? text.slice(0, OCCURRENCE_DETAILS_MAX) : null;
}
