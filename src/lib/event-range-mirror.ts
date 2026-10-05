/** Field QA UX Pass 2 / 2B — the ONE definition of a "range-mirror"
 * occurrence: a REAL event_occurrences row whose start/end exactly equal
 * its Event's own overall multi-day start/end (typically the seed row
 * created alongside the Event), sitting beside the genuine granular
 * per-day occurrences. Shown as a date or used for live status it reads
 * as one month-long session that is permanently "Happening Now".
 *
 * Presentation-only: callers leave such a row out of what they DISPLAY
 * or use for status, and only when other real occurrences of the same
 * Event remain. The row itself is never mutated or deleted. A genuine
 * multi-day Event with a single (multi-day) occurrence is unaffected. */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type Range = { start_at: string; end_at: string | null };

export function isRangeMirrorOccurrence(occurrence: Range, event: Range): boolean {
  if (!event.end_at || !occurrence.end_at) return false;
  const eventStart = new Date(event.start_at).getTime();
  const eventEnd = new Date(event.end_at).getTime();
  return (
    new Date(occurrence.start_at).getTime() === eventStart &&
    new Date(occurrence.end_at).getTime() === eventEnd &&
    eventEnd - eventStart > ONE_DAY_MS
  );
}

/** `occurrences` of ONE Event, minus its range-mirror rows — unless that
 * would leave nothing (a genuine single multi-day occurrence stays). */
export function withoutRangeMirrors<T extends Range>(occurrences: T[], event: Range): T[] {
  const kept = occurrences.filter((o) => !isRangeMirrorOccurrence(o, event));
  return kept.length > 0 ? kept : occurrences;
}
