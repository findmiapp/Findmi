// Occurrence-aware Event links (client- and server-safe, no imports).
//
// A card or row that stands for ONE specific Event date links to the Event
// page with that date requested: /event/<slug>?occurrence=<occurrence id>.
// The Event page's shared date selection (EventOccurrenceContext) honors the
// request only when the id is one of THAT Event's own listed dates; anything
// else — missing, malformed, past/removed, another Event's — is ignored and
// the page keeps its normal live / next default. Generic Event links (not
// about a particular date) stay plain /event/<slug>.

export const OCCURRENCE_PARAM = "occurrence";

/** /event/<slug>, plus ?occurrence=<id> when the link is about one date. */
export function eventHref(slug: string, occurrenceId?: string | null): string {
  const base = `/event/${slug}`;
  return occurrenceId ? `${base}?${OCCURRENCE_PARAM}=${encodeURIComponent(occurrenceId)}` : base;
}

/** The date a URL's query string requests — only if it is one of `occurrences`. */
export function requestedOccurrence<T extends { id: string }>(search: string, occurrences: readonly T[]): T | null {
  let id: string | null = null;
  try {
    id = new URLSearchParams(search).get(OCCURRENCE_PARAM);
  } catch {
    return null;
  }
  if (!id) return null;
  return occurrences.find((o) => o.id === id) ?? null;
}
