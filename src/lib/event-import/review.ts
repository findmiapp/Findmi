// Event Import V1 — Review defaults (pure; used by the importer UI and tests).
// Dates are shown/edited as Eastern wall-clock values — the zone every
// Findmi date is displayed in — and converted back server-side.
//
// V1B: each date keeps its own place. When every date shares one place,
// Review keeps a single Where section (`sharedPlace`); when places differ,
// each date is reviewed together with its place.
import { reviewAttendanceDefaults } from "./attendance-links";
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

export function reviewDateFor(d: { start: string; end: string | null; hasTime: boolean }): { date: string; startTime: string; endTime: string; endDate?: string } {
  if (!d.hasTime) return { date: d.start, startTime: "", endTime: "" };
  const s = toEasternParts(d.start);
  const e = d.end ? toEasternParts(d.end) : null;
  if (!e) return { date: s.date, startTime: s.time, endTime: "" };
  // Same day, or an evening that ends after midnight (6pm–12am).
  const overnight = e.date === nextDay(s.date) && e.time <= s.time;
  if (e.date === s.date || overnight) return { date: s.date, startTime: s.time, endTime: e.time };
  // One continuous span into a later day ("Oct 19, 10 AM – Oct 20, 4 PM"):
  // kept whole — its real end day and time — never split into made-up
  // per-day dates and never cut down to its first day.
  return e.date > s.date ? { date: s.date, startTime: s.time, endTime: e.time, endDate: e.date } : { date: s.date, startTime: s.time, endTime: "" };
}

export function placeFromVenue(v: ImportedVenue, matches: EventImportMatches): ReviewPlace {
  const key = venueKey(v);
  const match = key ? matches.locations.find((l) => l.key === key) : undefined;
  return {
    venueName: v.name,
    ...(v.website ? { website: v.website } : {}),
    address: v.address,
    city: v.city,
    state: v.state,
    postalCode: v.postalCode,
    useLocationId: match && match.confidence === "strong" ? match.id : null,
    matchKey: key || null,
    // A strong match starts linked (visibly, and can be undone); a possible
    // one waits for the person's answer.
    matchDecision: match && match.confidence === "strong" ? "use" : null,
  };
}

let rowSeq = 0;
function toReviewOccurrence(o: ImportedOccurrence, matches: EventImportMatches): ReviewOccurrence {
  rowSeq += 1;
  return { id: `d${rowSeq}`, ...reviewDateFor(o), place: placeFromVenue(o.venue, matches), ...(o.details ? { details: o.details } : {}) };
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
  // Pasted text / an image may state the place without a readable date.
  const shared = included.length === 0 && candidate.place ? candidate.place : sharedVenue(included);
  const occurrences = included.length > 0 ? included.map((o) => toReviewOccurrence(o, matches)) : [emptyReviewOccurrence(candidate.place ? placeFromVenue(candidate.place, matches) : null)];
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
    asEvent: candidate.persistAs === "event",
    // Evidence-only defaults (never AI): the action the source supports,
    // and what it made public about the place.
    // Explicitly pasted links first, then what the source evidenced — each
    // slot (RSVP / Registration, Tickets) from its own kind only.
    ...reviewAttendanceDefaults(
      candidate.structured?.links,
      candidate.structured?.links ? (candidate.structured.pageAttendance ?? null) : candidate.attendance
    ),
    locationVisibility: candidate.locationVisibility ?? null,
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

/** Review label for a date with no published time (never a guessed one). */
export const REVIEW_TIME_NOT_LISTED = "Time Not Listed";

/** One-line summary of a reviewed date: "Thu, Sep 24 · 1:00 PM – 7:00 PM",
 * "… · Starts 1:00 PM" (no published end) or "… · Time Not Listed". */
export function occurrenceSummary(o: { date: string; startTime: string; endTime: string; endDate?: string | null }): { day: string; time: string } {
  const start = formatTime(o.startTime);
  const end = formatTime(o.endTime);
  const endDay = o.endDate && o.endDate > o.date ? formatDay(o.endDate) : "";
  return { day: formatDay(o.date), time: start && end ? `${start} – ${endDay ? `${endDay}, ` : ""}${end}` : start ? `Starts ${start}` : end ? "" : REVIEW_TIME_NOT_LISTED };
}

/** Business-facing success sentence — never "Appearance". */
export function successMessage(kind: "scheduled" | "requested" | "already", title: string, businessName: string, intent: EventImportIntent, newEvent = false): string {
  if (kind === "already") return `${title} is already on ${businessName}'s Findmi schedule.`;
  if (kind === "requested") return `Request sent to join ${title}. It shows on ${businessName}'s schedule once the organizer confirms.`;
  return intent === "hosting" || newEvent
    ? `${title} is live on Findmi and on ${businessName}'s schedule.`
    : `${title} is now on ${businessName}'s Findmi schedule.`;
}

// ── V1C — several Events from one source ───────────────────────────────

/** Answer one place's Findmi Location question everywhere that same page
 * place appears in this review — the shared Where and every date — so a
 * venue repeated across dates is confirmed once. Other places are
 * untouched, and any single date can still be changed afterwards. */
export function decidePlace(review: EventImportReview, matchKey: string, decision: "use" | "reject", locationId: string | null): EventImportReview {
  const apply = (p: ReviewPlace): ReviewPlace =>
    p.matchKey === matchKey ? { ...p, matchDecision: decision, useLocationId: decision === "use" ? locationId : null } : p;
  return { ...review, place: apply(review.place), occurrences: review.occurrences.map((o) => ({ ...o, place: apply(o.place) })) };
}

/** Places in this review with a Findmi Location match still unanswered. */
export function pendingPlaceMatches(review: EventImportReview, matches: EventImportMatches): string[] {
  const places = review.sharedPlace ? [review.place] : review.occurrences.map((o) => o.place);
  const keys = new Set<string>();
  for (const p of places) {
    if (p.matchKey && !p.matchDecision && !p.useLocationId && matches.locations.some((l) => l.key === p.matchKey)) keys.add(p.matchKey);
  }
  return [...keys];
}

/** Places in this review that are a real, specific, nameable place (so
 * Review's own Location research/Quick Create step is offered for them —
 * see canResearchLocation) but aren't linked to a canonical Location yet:
 * neither matched nor created. Entity Resolution Truthfulness pass — this
 * is what previously let a place like "Fellini Coffee Chelsea, New York,
 * NY" (a real place with no numbered street address yet) sit unresolved
 * while Review still reported "Ready": canOfferLocationCreate's own
 * (correctly stricter) numbered-street requirement meant no Quick Create
 * was ever offered, so there was nothing "pending" for pendingPlaceMatches
 * to find either. This reuses canResearchLocation's own eligibility rule
 * — exactly what gates showing that step in Review — rather than a new,
 * second notion of "unresolved". */
export function unresolvedLocations(review: EventImportReview): string[] {
  const places = review.sharedPlace ? [review.place] : review.occurrences.map((o) => o.place);
  const keys = new Set<string>();
  for (const p of places) {
    if (canResearchLocation(p, { locationVisibility: review.locationVisibility, online: false }) && p.matchKey) keys.add(p.matchKey);
  }
  return [...keys];
}

export type BatchStatusKind = "ready" | "needs_details" | "possible_match" | "needs_review" | "joins_existing";

/** What a reviewed Event still needs before it can be added. Mirrors the
 * server's normalizeReview requirements (the server re-checks anyway).
 * Entity Resolution Truthfulness pass — "ready" now means the Event's
 * entity relationships are actually resolved, not merely that its own
 * title/date fields are filled: a real, specific place that was never
 * matched or created (Fellini Coffee Chelsea's own regression) is
 * "needs_review", same as an unanswered possible Location match — never
 * silently "ready". This never BLOCKS creation (Admin may still choose
 * Create with these open) — only the label stops overclaiming. */
export function batchItemStatus(review: EventImportReview, matches: EventImportMatches, involvedNames: string[] = []): { kind: BatchStatusKind; missing: string[] } {
  const missing: string[] = [];
  if (!review.title.trim()) missing.push("Name");
  if (!review.useEventId) {
    if (review.occurrences.length === 0 || review.occurrences.some((o) => !/^\d{4}-\d{2}-\d{2}$/.test(o.date))) missing.push("Date");
    // Times are optional (a date with no published time is valid); only an
    // end with no start needs the operator — a start is never guessed.
    if (review.occurrences.some((o) => o.endTime && !o.startTime)) missing.push(END_WITHOUT_START);
  }
  if (missing.length > 0) return { kind: "needs_details", missing };
  if (review.useEventId) return { kind: "joins_existing", missing };
  if (matches.event || pendingPlaceMatches(review, matches).length > 0) return { kind: "possible_match", missing };
  if (unresolvedLocations(review).length > 0) return { kind: "needs_review", missing };
  // An involved-Business candidate the operator hasn't Matched, Created or
  // Ignored is open entity-resolution work — never "Ready" (still never
  // blocks creation).
  if (unresolvedInvolvedBusinesses(review, involvedNames).length > 0) return { kind: "needs_review", missing };
  return { kind: "ready", missing };
}

/** The reviewable involved-Business names for one Event: the structured
 * paste's own field plus the grounded AI reading — the same list the
 * Admin review's Match / Create / Ignore section shows. */
export function involvedBusinessNames(candidate: Pick<EventCandidate, "otherBusinesses" | "structured">): string[] {
  return [...new Set([...(candidate.structured?.otherBusinesses ?? []), ...(candidate.otherBusinesses ?? [])].map((n) => n.trim()).filter(Boolean))];
}

/** Involved-Business names with no Match / Create / Ignore choice yet. */
export function unresolvedInvolvedBusinesses(review: EventImportReview, names: string[]): string[] {
  const choices = review.otherBusinessChoices ?? {};
  return [...new Set(names.map((n) => n.trim()).filter(Boolean))].filter((n) => !choices[n]);
}

export const END_WITHOUT_START = "Start time for an end time";

/** Which reviewed dates have an end time but no start ("Sat, Oct 17", or
 * "Date 3" when the day itself is missing) — so the status names the
 * actual dates. Dates with no time at all are valid and never listed. */
export function datesMissingTime(review: EventImportReview): string[] {
  if (review.useEventId) return [];
  return review.occurrences.flatMap((o, i) => (o.endTime && !o.startTime ? [formatDay(o.date) || `Date ${i + 1}`] : []));
}

export const BATCH_STATUS_LABEL: Record<BatchStatusKind, string> = {
  ready: "Ready",
  needs_details: "Needs Details",
  possible_match: "Possible Match",
  needs_review: "Needs Review",
  joins_existing: "Already on Findmi",
};

export type BatchOutcomeKind = "scheduled" | "requested" | "already";

/** Business-facing batch summary (never database words). */
export function batchSummary(
  results: { title: string; outcome: { ok: true; kind: BatchOutcomeKind } | { ok: false; error: string } }[],
  skipped: number,
  businessName: string
): { headline: string; added: string[]; connected: string[]; already: string[]; attention: { title: string; error: string }[]; skipped: number } {
  const added = results.filter((r) => r.outcome.ok && r.outcome.kind === "scheduled").map((r) => r.title);
  const connected = results.filter((r) => r.outcome.ok && r.outcome.kind === "requested").map((r) => r.title);
  const already = results.filter((r) => r.outcome.ok && r.outcome.kind === "already").map((r) => r.title);
  const attention = results.flatMap((r) => (r.outcome.ok ? [] : [{ title: r.title, error: r.outcome.error }]));
  const n = added.length;
  const headline = n > 0 ? `${n} ${n === 1 ? "Event" : "Events"} Added To ${businessName}` : connected.length > 0 ? `Requests Sent For ${businessName}` : `Nothing New Added To ${businessName}`;
  return { headline, added, connected, already, attention, skipped };
}

/** Which Events start chosen on a several-Events page: participating →
 * upcoming ones not already on this Business's schedule; hosting → none (a
 * calendar listing an Event doesn't mean this Business organizes it). */
export function defaultSelection(events: { key: string; past: boolean; alreadyOnSchedule: unknown }[], intent: EventImportIntent): string[] {
  if (intent !== "participating") return [];
  return events.filter((e) => !e.past && !e.alreadyOnSchedule).map((e) => e.key);
}

/** Answer a place's Findmi Location question from ONE spot in a review
 * (the shared Where, or one date's place). The same page place on other
 * dates that is still unanswered takes the same answer (a venue repeated
 * across dates is confirmed once); places already answered keep their own
 * answer, so changing one date later never changes another. */
export function decidePlaceFrom(review: EventImportReview, target: string, decision: "use" | "reject", locationId: string | null): EventImportReview {
  const targetPlace = target === "shared" ? review.place : review.occurrences.find((o) => o.id === target)?.place;
  const key = targetPlace?.matchKey ?? null;
  const answer = (p: ReviewPlace): ReviewPlace => ({ ...p, matchDecision: decision, useLocationId: decision === "use" ? locationId : null });
  const follows = (p: ReviewPlace) => Boolean(key && p.matchKey === key && !p.matchDecision);
  return {
    ...review,
    place: target === "shared" || follows(review.place) ? answer(review.place) : review.place,
    occurrences: review.occurrences.map((o) => (o.id === target || follows(o.place) ? { ...o, place: answer(o.place) } : o)),
  };
}

/** How a reviewed item will be saved, in Business words (never "Appearance"). */
export function persistNote(review: EventImportReview, businessName: string): { label: string; line: string } {
  if (review.intent === "hosting") return { label: "Your Event", line: `Findmi will add this Event with ${businessName} as its host.` };
  if (review.useEventId) return { label: "On Findmi", line: `${businessName} will ask to join this Event.` };
  if (review.asEvent) return { label: "Event", line: `Findmi will add this Event and put ${businessName} on its schedule.` };
  return { label: "Schedule Item", line: `This will be added to ${businessName}’s schedule.` };
}

// ── Missing canonical Location: Quick Create (Review state only) ───────
// When a reviewed place is a real, specific physical place that isn't on
// Findmi yet, the person can create it inline (the existing
// createInlinePlace action — unlisted, no membership, duplicate-checked)
// and it is selected exactly like a strong Location match. Nothing here
// creates or saves the Event; normal Event persistence later writes
// event_occurrences.location_id from the selected place as always.

/** A Findmi Location created (or chosen from duplicates) during Review. */
export interface ReviewCreatedLocation {
  /** The page-place identity (venueKey) it resolves. */
  key: string;
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

// Names that are not a place: unannounced, secret or online.
const PLACEHOLDER_PLACE = /\b(tba|tbd|tbc|to be (announced|determined|confirmed)|secret|announced later|location (announced|revealed|shared|sent)|online|virtual|zoom|webinar|livestream|live stream|google meet|teams)\b/i;
// A street address starts with a building number ("121 East 27th St",
// "20-30 Main St") — "5th Ave", "SoHo" or "Hudson Yards" never do.
const NUMBERED_STREET = /^\s*\d+[a-z]?(?:-\d+[a-z]?)?\s+[a-z0-9]/i;
// An intersection or corner is not a single building.
const INTERSECTION = /\s(&|and|at|@|x)\s|\bcorner\b|\bbetween\b|\bbtwn\b|\s\/\s/i;

/** Whether Review may offer "Create New Location" for this place. Only a
 * named, specific physical place with a numbered street address, city and
 * state, on an Event whose source publishes an exact place — never for a
 * hidden / broad-only / no-location / online Event, a placeholder name, a
 * neighborhood, city or intersection, or a place already linked. */
export function canOfferLocationCreate(
  place: ReviewPlace,
  context: { locationVisibility?: string | null; online?: boolean | null }
): boolean {
  const visibility = context.locationVisibility ?? null;
  if (visibility === "hidden" || visibility === "broad" || visibility === "none") return false;
  if (context.online) return false;
  if (place.useLocationId) return false;
  const name = place.venueName?.trim() ?? "";
  const address = place.address?.trim() ?? "";
  if (!name || PLACEHOLDER_PLACE.test(name)) return false;
  if (!address || PLACEHOLDER_PLACE.test(address)) return false;
  if (!NUMBERED_STREET.test(address) || INTERSECTION.test(address)) return false;
  if (!place.city?.trim() || !place.state?.trim()) return false;
  return true;
}

/** Whether Review may attempt the EXISTING Location research/prepare step
 * (adminPrepareLocation and its Business-side equivalent) for this place —
 * deliberately looser than canOfferLocationCreate, which additionally
 * requires an already-known numbered street address before offering to
 * create a Location directly. Research's whole job is to go find that
 * address when it isn't known yet (the same way Business Import researches
 * an official website from a name alone), so attempting it must not be
 * gated on already having what it exists to find — a named, specific
 * place with a city and state (most sources give exactly this, no street)
 * is reason enough to try. */
export function canResearchLocation(
  place: Pick<ReviewPlace, "venueName" | "city" | "state" | "useLocationId">,
  context: { locationVisibility?: string | null; online?: boolean | null }
): boolean {
  const visibility = context.locationVisibility ?? null;
  if (visibility === "hidden" || visibility === "broad" || visibility === "none") return false;
  if (context.online) return false;
  if (place.useLocationId) return false;
  const name = place.venueName?.trim() ?? "";
  if (!name || PLACEHOLDER_PLACE.test(name)) return false;
  if (!place.city?.trim() || !place.state?.trim()) return false;
  return true;
}

/** Whether this Review's dates REALLY are at different places — by the
 * linked Location when there is one, else by normalized place evidence
 * (name + street), so it works before any Location exists. One shared
 * place, or every date at the same place, is never "different". */
export function placesDiffer(review: Pick<EventImportReview, "sharedPlace" | "occurrences">): boolean {
  if (review.sharedPlace || review.occurrences.length < 2) return false;
  const keys = new Set(review.occurrences.map((o) => (o.place.useLocationId ? `loc:${o.place.useLocationId}` : `ev:${venueKey({ name: o.place.venueName, address: o.place.address })}`)));
  return keys.size > 1;
}

/** The place's identity key: its page key, or (for a place typed in
 * Review) the same venueKey rule the page places use. */
export function placeKeyFor(place: ReviewPlace): string {
  return place.matchKey || venueKey({ name: place.venueName, address: place.address });
}

/** Matches plus the Locations created/chosen in this Review, each as a
 * strong match for its place key (it replaces any earlier match for that
 * key, so the card shows the Location actually chosen). */
export function withCreatedLocations(matches: EventImportMatches, created: readonly ReviewCreatedLocation[]): EventImportMatches {
  if (created.length === 0) return matches;
  const keys = new Set(created.map((c) => c.key));
  return {
    ...matches,
    locations: [
      ...created.map((c) => ({ key: c.key, id: c.id, name: c.name, address: c.address, city: c.city, state: c.state, postalCode: c.postalCode, confidence: "strong" as const })),
      ...matches.locations.filter((l) => !keys.has(l.key)),
    ],
  };
}

/** Selects a created Location for one place in a review (the shared
 * Where, or one date) through the existing decidePlaceFrom path, so other
 * unanswered places at the same page place on other dates follow. */
export function selectCreatedLocation(review: EventImportReview, target: string, location: ReviewCreatedLocation): EventImportReview {
  const keyed = (p: ReviewPlace): ReviewPlace => (p.matchKey ? p : { ...p, matchKey: location.key });
  const withKey: EventImportReview =
    target === "shared"
      ? { ...review, place: keyed(review.place) }
      : { ...review, occurrences: review.occurrences.map((o) => (o.id === target ? { ...o, place: keyed(o.place) } : o)) };
  return decidePlaceFrom(withKey, target, "use", location.id);
}

/** Another reviewed Event in the same batch: every place with exactly the
 * same place key that isn't already linked to a Location takes the
 * created one. Places with a different key are never touched. */
export function applyCreatedLocation(review: EventImportReview, location: ReviewCreatedLocation): EventImportReview {
  const apply = (p: ReviewPlace): ReviewPlace =>
    p.matchKey === location.key && !p.useLocationId ? { ...p, matchDecision: "use", useLocationId: location.id } : p;
  return { ...review, place: apply(review.place), occurrences: review.occurrences.map((o) => ({ ...o, place: apply(o.place) })) };
}
