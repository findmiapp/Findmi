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
import type { EventImportFetchDiagnostics } from "./diagnostics";
import type { ImportedAttendance } from "./attendance";
import type { LocationVisibility, RsvpCta } from "../event-attendance";

export type EventImportIntent = "participating" | "hosting";

/** Unified Event Import — the input methods feeding the ONE engine. */
export type EventImportOrigin = "link" | "text" | "image";

/** Upload (V1): flyers / screenshots / invitations. The bytes decide the
 * type server-side (lib/imageUploadValidation.ts); this is the picker hint. */
export const EVENT_IMPORT_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
export const EVENT_IMPORT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

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
  /** "Location Website:" — the PLACE's own official website (never the
   * Business's). Location Import evidence only; not an Event field. */
  website?: string | null;
}

/** One dated instance of the Event, kept together with ITS OWN place —
 * a tour's stops each have their own date, time and venue, so a date is
 * never separated from where it happens. An empty venue means the page
 * didn't say. */
export interface ImportedOccurrence extends ImportedDate {
  venue: ImportedVenue;
  /** This date's own details / programming (event_occurrences.details) —
   * never the Event's description. Admin structured paste only, today. */
  details?: string | null;
  /** The page line(s) this was read from, when it came from page text. */
  evidence: string | null;
  /** Set by Analyze: already over. Past dates are kept (not discarded) so
   * Review can show them; they just start out not included. */
  past?: boolean;
}

export interface EventCandidate {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  /** The page the Business pasted (after redirects), always https. Empty
   * for pasted text / an uploaded image — never invented. */
  sourceUrl: string;
  /** Which input fed this candidate (ephemeral; never stored): a link, text
   * the Business pasted, or an image it uploaded. Absent = a link. */
  origin?: EventImportOrigin;
  /** The Event's stated place when no date carries it (pasted text / an
   * image that gives an address but no readable date). */
  place?: ImportedVenue;
  /** "Eventbrite", "Luma", … when the host is recognisable. */
  platform: string | null;
  /** Chronological; each with its own place. */
  occurrences: ImportedOccurrence[];
  online: boolean;
  organizer: string | null;
  /** Other named brands/businesses the source explicitly evidences as
   * featured, co-hosting or participating — never the organizer, never
   * auto-linked. Populated either from an Admin structured paste's own
   * "Featured:"/"Participating:" field (candidate.structured.
   * otherBusinesses) or, for a normal Event Link/paste, from the AI step's
   * grounded reading (./ai.ts sanitizeEventAiOutput) — shown to the
   * operator for review either way. */
  otherBusinesses?: string[];
  sources: Partial<Record<"title" | "description" | "image" | "dates" | "venue" | "organizer", FieldSource>>;
  /** Rich Event Persistence — set by Analyze: "event" when the source
   * grounds a genuine Event (structured Event data, or a dedicated Event
   * page with its own details) → saved as a canonical Findmi Event the
   * Business takes part in; "schedule_item" otherwise → the Business's own
   * standalone schedule item, exactly as before. */
  persistAs?: "event" | "schedule_item";
  /** Attendance evidence (./attendance.ts) — only what the source states;
   * never filled by the AI step. Absent = unknown. */
  attendance?: ImportedAttendance;
  /** What the source made public about the place (exact / broad / hidden /
   * none). "hidden" occurrences carry no venue name or street address. */
  locationVisibility?: LocationVisibility;
  /** Admin structured paste only (./structured-paste.ts): explicit field
   * values that aren't Event columns — Business evidence, taxonomy names to
   * resolve against the canonical vocabulary, and notes for Review. */
  structured?: StructuredEventHints;
  /** Set when the page's only image was a page-level social image proven to
   * be generic site / Business imagery (./image-guard.ts) — dropped, so
   * the candidate has no image. */
  imageGuard?: { ignored: "generic_site_image"; provenance: "og:image:secure_url" | "og:image" | "twitter:image"; evidence: "page_logo" | "brand_import" | "homepage_image" };
}

export interface StructuredEventHints {
  /** "Primary Business:" / "Business:" — matched against the Business directory. */
  business: string | null;
  category: string | null;
  subcategory: string | null;
  formats: string[];
  /** Plain-language notes for Review (unreadable values, fields not saved). */
  notes: string[];
  /** "Business Website:" — the Primary Business's site, for the inline
   * Brand Import (never the Event Link). */
  businessWebsite?: string | null;
  /** "Featured Brand:" / "Participating Businesses:" — additional Business
   * evidence shown in Review; never linked automatically. */
  otherBusinesses?: string[];
  /** Programming text, kept as Review evidence only ("Not Currently Saved
   * To Findmi": event_occurrences has no details column). */
  programming?: { label: string; text: string }[];
  /** Event Link enrichment (Admin only): whether the source page was read
   * and which fields it filled. */
  source?: { status: "read" | "failed" | "several_events" | "not_read"; filled: string[]; detail?: string };
  /** Explicitly pasted attendance links ("RSVP:", "Registration:", "Ticket
   * URL:" …) — the operator's own values, which win over anything read
   * from the Event Link. RSVP / Registration and Tickets are kept apart. */
  links?: { rsvp: { cta: RsvpCta; url: string } | null; tickets: string | null };
  /** The Event Link page's own evidenced attendance link (Admin enrichment)
   * — evidence that may fill an EMPTY Review slot only. */
  pageAttendance?: { cta: "tickets" | RsvpCta; url: string };
}

export const EMPTY_VENUE: ImportedVenue = { name: null, address: null, city: null, state: null, postalCode: null };

const keyPart = (s: string | null) => (s ?? "").toLowerCase().normalize("NFKC").replace(/[^a-z0-9]+/g, " ").trim();
/** Identity of a place as read from the page ("" = no place). */
export function venueKey(v: { name: string | null; address: string | null }): string {
  const name = keyPart(v.name);
  const address = keyPart(v.address);
  return name || address ? `${name}|${address}` : "";
}

/** A source with no structured PostalAddress sometimes puts the venue's own
 * NAME into a free-text "address" field (schema.org allows `address` as a
 * bare string; some AI/JSON extraction mirrors it there too) — that is not
 * a street address, it is the name repeated. Truthfulness over field
 * completeness: a "street address" that is really just the name is
 * dropped, never persisted as if it told us anything the name didn't. */
export function realStreetAddress(name: string | null, address: string | null): string | null {
  if (!address) return null;
  if (name && keyPart(address) === keyPart(name)) return null;
  return address;
}

/** The one place every occurrence shares, or null when they differ. */
export function sharedVenue(occurrences: ImportedOccurrence[]): ImportedVenue | null {
  if (occurrences.length === 0) return { ...EMPTY_VENUE };
  const key = venueKey(occurrences[0].venue);
  return occurrences.every((o) => venueKey(o.venue) === key) ? occurrences[0].venue : null;
}

/** What Analyze returns to Review. Nothing is written by Analyze. */
export interface EventImportMatches {
  event: { id: string; name: string; slug: string; startAt: string; venueName: string | null; city: string | null; confidence: "strong" | "weak"; hostBusinessId: string | null; hostedByThisBusiness: boolean } | null;
  /** One entry per distinct place on the page (keyed by venueKey). "strong"
   * = a single clear match and is pre-selected; "possible" is shown but the
   * Business decides. */
  locations: { key: string; id: string; name: string; address: string | null; city: string | null; state: string | null; postalCode?: string | null; confidence: "strong" | "possible" }[];
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
  | "calendar_unreadable"
  | "rate_limited"
  | "server"
  // Paste Details / Upload
  | "text_no_event"
  | "text_too_long"
  | "image_no_event"
  | "unsupported_image"
  | "image_too_large"
  | "image_unavailable"
  | "multiple_events"
  // Paste Details — several explicitly marked Events
  | "paste_malformed"
  | "too_many_events"
  | "paste_no_events";

/** V1C — one Event found on a page that lists many distinct Events. Each
 * is matched on its own; nothing is shared between them. */
export interface SourceEventAnalysis {
  /** Identity within the source (its own Event link, else title + date). */
  key: string;
  candidate: EventCandidate;
  matches: EventImportMatches;
  warnings: string[];
  /** Every date has passed. */
  past: boolean;
  /** Already on this Business's Findmi schedule (same Event link, or same
   * name on the same day) — importing again would duplicate it. */
  alreadyOnSchedule: { title: string; startAt: string } | null;
}

export interface ImportSource {
  /** The pasted page (a calendar / organizer / venue page). */
  url: string;
  name: string | null;
  platform: string | null;
}

export type EventImportAnalysis =
  | { ok: true; kind: "single"; candidate: EventCandidate; matches: EventImportMatches; warnings: string[] }
  | { ok: true; kind: "multi"; source: ImportSource; events: SourceEventAnalysis[]; warnings: string[] }
  | {
      ok: false;
      code: EventImportFailure;
      /** Admin diagnostics only (status / final host of a failed source
       * fetch) — stripped by publicImportAnalysis for consumer surfaces. */
      fetch?: EventImportFetchDiagnostics;
      /** Plain-language specifics shown after the failure copy (e.g. which
       * pasted Event is malformed). Generated by Findmi, never raw input. */
      detail?: string;
    };

/** Plain-language failure copy (never internal errors). */
export const EVENT_IMPORT_FAILURE_COPY: Record<EventImportFailure, string> = {
  invalid_url: "That doesn't look like a web address. Paste the full link to the event page.",
  blocked_url: "That link can't be imported. Use a public https event page.",
  unreachable: "We couldn't open that page. Check the link, or try again in a moment.",
  blocked_by_site: "That site didn't let Findmi read the page. You can add the details manually instead.",
  not_html: "That link isn't an event web page. Paste the link to the event's page.",
  no_event: "We couldn't find event details on that page. Try another link, or add it manually.",
  calendar_unreadable: "We found an Event calendar, but couldn't read its Events yet. Try a link to one Event, or add it manually.",
  rate_limited: "You've imported a lot of links in a short time. Please wait a few minutes and try again.",
  server: "Something went wrong on our side. Please try again.",
  text_no_event: "We couldn't find enough Event information in that text. Include the Event's name, date and place.",
  text_too_long: "That's more than 60,000 characters. Paste fewer Events at a time.",
  image_no_event: "We couldn't find enough Event information in that image.",
  unsupported_image: "Upload a JPG, PNG or WebP image.",
  image_too_large: "That image is too large. Upload one under 5MB.",
  image_unavailable: "Reading images isn't available right now. Paste the details instead.",
  multiple_events: "This looks like it contains multiple Events. Try one Event at a time.",
  paste_malformed: "We couldn't tell where each Event starts and ends. Put EVENT 1 before each Event's details and === END EVENT 1 === after them, numbering each Event.",
  too_many_events: "You can import up to 25 Events at a time.",
  paste_no_events: "We couldn't find enough Event information in any of the pasted Events. Include each Event's name, date and place.",
};

export interface ReviewPlace {
  venueName: string | null;
  /** The place's own website ("Location Website:") — evidence for
   * Location Import V1 when this place isn't on Findmi yet. */
  website?: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  /** Confirmed existing Findmi Location (null = use the typed details). */
  useLocationId: string | null;
  /** The page place this was read from — looks up its Location match. */
  matchKey?: string | null;
  /** The person's answer to a Findmi Location match for this place:
   * "use" (linked — useLocationId set), "reject" (not the same place), or
   * unset (not answered yet; a possible match is never linked silently). */
  matchDecision?: "use" | "reject" | null;
}

export interface ReviewOccurrence {
  /** Client-side row identity only. */
  id?: string;
  /** NY wall-clock values from the Review form: YYYY-MM-DD + HH:MM. An end
   * earlier than the start means it ends after midnight. */
  date: string;
  startTime: string;
  endTime: string;
  /** YYYY-MM-DD when the end falls on a LATER calendar day than `date`
   * beyond a short overnight (a source's "Oct 19, 10 AM – Oct 20, 4 PM"):
   * endTime is on this day. Absent/blank → same day (or after midnight). */
  endDate?: string | null;
  place: ReviewPlace;
  /** This date's own details / programming (event_occurrences.details). */
  details?: string | null;
}

/** The reviewed values the Business confirms. Re-validated server-side. */
export interface EventImportReview {
  intent: EventImportIntent;
  title: string;
  description: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  occurrences: ReviewOccurrence[];
  /** true: every date happens at `place` (one Where section); false: each
   * occurrence carries its own place. */
  sharedPlace: boolean;
  place: ReviewPlace;
  organizer: string | null;
  /** Confirmed existing Findmi Event to join / reuse (null = none). */
  useEventId: string | null;
  /** Participating only: save as a canonical Findmi Event (from Analyze's
   * persistAs) rather than a standalone schedule item. Re-checked on save. */
  asEvent?: boolean;
  /** Attendance action for a new Event: "tickets" → Get Tickets, "rsvp" /
   * "register" → the RSVP action with that label; null/absent → none.
   * Re-validated server-side (https link required). */
  attendance?: { cta: "tickets" | RsvpCta | null; url: string | null } | null;
  /** A separate Ticket link, kept ONLY when `attendance` is the RSVP /
   * Registration action and the Event also has a different Get Tickets
   * destination (both are existing Event columns: rsvp_url, tickets_url). */
  ticketsUrl?: string | null;
  /** From Analyze; "hidden" means the organizer withholds the address — no
   * venue, street address or Findmi Location is saved. */
  locationVisibility?: LocationVisibility | null;
  /** Event Taxonomy V1 — the one primary kind='event' category chosen in
   * Review (a subcategory, or a top-level category). Saved only on a NEW
   * Event; never applied to an existing Event this import joins. */
  categoryId?: string | null;
  /** Event Formats V1 — the Formats the person chose in Review (zero to
   * many kind='event_format' ids). Saved only on a NEW Event; never
   * applied to an existing Event this import joins. Never inferred. */
  formatIds?: string[] | null;
  /** Explicit Involved-Business Resolution (Admin only) — the operator's
   * own Match / Create / Ignore decision for each name the source
   * evidenced as another featured/participating brand (EventCandidate.
   * otherBusinesses / structured.otherBusinesses), keyed by that exact
   * name. Never auto-filled. A non-"ignored" entry becomes an additional
   * approved participant at commit, through the SAME event_businesses
   * write the Event's own primary Business already uses — never a second
   * participation path, never an Appearance written independently. */
  otherBusinessChoices?: Record<string, { id: string; name: string } | "ignored">;
}

export type EventImportOutcome =
  /** Now on this Business's Findmi schedule. */
  | { ok: true; kind: "scheduled"; title: string; viewHref: string; newEvent?: boolean; publicHref?: string; eventId?: string; hosted?: boolean; /** A Business submission saved pending Admin review (not public yet). */ pendingReview?: boolean }
  /** Request sent to an existing Findmi Event's organizer (participation needs their confirmation). */
  | { ok: true; kind: "requested"; title: string; viewHref: string; publicHref?: string; eventId?: string }
  /** Already on this Business's schedule — nothing new created. */
  | { ok: true; kind: "already"; title: string; viewHref: string; publicHref?: string; eventId?: string; hosted?: boolean }
  | { ok: false; error: string; field?: string };
