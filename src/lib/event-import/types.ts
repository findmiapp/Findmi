// Event Import V1 — shared types for the ONE Event Import engine.
//
// Every entry point (Business → Where I'll Be, Business → Host an Event,
// and later Admin / onboarding) is a CONTEXT into the same engine:
//   source → fetch → extract → normalize → match → relationship → review → persist
//
// Business-facing vocabulary (locked): PARTICIPATING = taking part in
// something someone else organizes; HOSTING = this Business organizes it.
// Internally: Event (the canonical thing), Event Occurrence (a dated
// instance), Appearance (a Business's participation), host_business_id
// (hosting). A host never gets a manufactured Appearance.

export type EventImportIntent = "participating" | "hosting";

export function parseEventImportIntent(value: unknown): EventImportIntent | null {
  return value === "participating" || value === "hosting" ? value : null;
}

/** Where a value came from — shown in Review so AI-filled values are
 * visibly "please check". */
export type FieldSource = "structured" | "page" | "ai";

export interface ImportedDate {
  /** ISO instant when the source gave a time, else a plain YYYY-MM-DD. */
  start: string;
  end: string | null;
  hasTime: boolean;
}

export interface ImportedVenue {
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

export interface EventCandidate {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  /** The page the Business pasted (after redirects), always https. */
  sourceUrl: string;
  /** "Eventbrite", "Luma", … when the host is recognisable. */
  platform: string | null;
  dates: ImportedDate[];
  venue: ImportedVenue;
  online: boolean;
  organizer: string | null;
  sources: Partial<Record<"title" | "description" | "image" | "dates" | "venue" | "organizer", FieldSource>>;
}

/** What Analyze returns to Review. Nothing is written by Analyze. */
export interface EventImportMatches {
  event: { id: string; name: string; slug: string; startAt: string; venueName: string | null; city: string | null; confidence: "strong" | "weak"; hostBusinessId: string | null; hostedByThisBusiness: boolean } | null;
  location: { id: string; name: string; address: string | null; city: string | null; state: string | null } | null;
  organizerBusiness: { id: string; name: string } | null;
  /** This Business's existing standalone schedule item for the same day/title, if any. */
  existingAppearance: { id: string; title: string; startAt: string } | null;
}

export type EventImportFailure =
  | "invalid_url"
  | "blocked_url"
  | "unreachable"
  | "blocked_by_site"
  | "not_html"
  | "no_event"
  | "rate_limited"
  | "server";

export type EventImportAnalysis =
  | { ok: true; candidate: EventCandidate; matches: EventImportMatches; warnings: string[] }
  | { ok: false; code: EventImportFailure };

/** Plain-language failure copy (never internal errors). */
export const EVENT_IMPORT_FAILURE_COPY: Record<EventImportFailure, string> = {
  invalid_url: "That doesn't look like a web address. Paste the full link to the event page.",
  blocked_url: "That link can't be imported. Use a public https event page.",
  unreachable: "We couldn't open that page. Check the link, or try again in a moment.",
  blocked_by_site: "That site didn't let Findmi read the page. You can add the details manually instead.",
  not_html: "That link isn't an event web page. Paste the link to the event's page.",
  no_event: "We couldn't find event details on that page. Try another link, or add it manually.",
  rate_limited: "You've imported a lot of links in a short time. Please wait a few minutes and try again.",
  server: "Something went wrong on our side. Please try again.",
};

/** The reviewed values the Business confirms. Re-validated server-side. */
export interface EventImportReview {
  intent: EventImportIntent;
  title: string;
  description: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  /** NY wall-clock values from the Review form: YYYY-MM-DD + HH:MM. */
  dates: { date: string; startTime: string; endTime: string }[];
  venueName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  organizer: string | null;
  /** Confirmed existing records to reuse (null = create new / none). */
  useEventId: string | null;
  useLocationId: string | null;
}

export type EventImportOutcome =
  /** Now on this Business's Findmi schedule. */
  | { ok: true; kind: "scheduled"; title: string; viewHref: string }
  /** Request sent to an existing Findmi Event's organizer (participation needs their confirmation). */
  | { ok: true; kind: "requested"; title: string; viewHref: string }
  /** Already on this Business's schedule — nothing new created. */
  | { ok: true; kind: "already"; title: string; viewHref: string }
  | { ok: false; error: string; field?: string };
