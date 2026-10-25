import "server-only";
import { recordProvenance } from "../provenance";
// Event Import V1 — persistence, ONLY after the Business has reviewed the
// candidate. Re-validates every reviewed value (the Review form is client
// input) and writes through the existing domain paths:
//
// PARTICIPATING (something someone else organizes)
//   - confirmed existing Findmi Event → applyBusinessToEvent (the shared
//     participation invariant: 'applied', or approved now only if the
//     organizer already invited this Business). No new Event, no new Date.
//   - a genuine Event (Rich Event Persistence — review.asEvent) → ONE
//     canonical Event (no host, no owner, pending Findmi review) + its
//     Occurrences + this Business's approved participation and Event-linked
//     schedule items; an Event already carrying the same source link is
//     joined instead (see persistParticipatingEvent);
//   - otherwise (whereabouts, thin sources) → this Business's own
//     standalone schedule item(s) (appearances, source 'manual' — the
//     existing Where I'll Be path), one per date, never a second copy of a
//     date already on the schedule.
//     A participant never becomes the owner or host of someone else's Event.
//
// HOSTING (this Business organizes it)
//   - new Event via create_owned_event(p_host_business_id) — the existing
//     host path (events.host_business_id + the creator's owner membership,
//     pending Findmi review); Event Occurrences for multiple dates or a
//     chosen Location. NO Appearance is created for the host.
//   - confirmed existing Event already hosted by this Business → nothing
//     new; any other existing Event is never re-assigned to this Business.
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateTimeToIso } from "../admin/form-helpers";
import { validateCustomDestination } from "../navigation";
import { cleanText, usStateCode } from "../brand-website-extract";
import { cleanEventDescription } from "./description";
import { cleanOccurrenceDetails } from "./occurrence-details";
import type { EventImportIntent, EventImportOutcome, EventImportReview, ReviewPlace } from "./types";
import type { EventApplicationResult } from "../event-participation";
import { NEW_EVENT_PUBLICATION, publishCreatedEvent } from "../event-publication";
import { parseLocationVisibility, type LocationVisibility } from "../event-attendance";
import { existingEventCategoryIds } from "../event-categories-server";
import { cleanEventFormatIds } from "../event-formats";
import { syncEventFormats } from "../event-formats-server";
import { attendanceEventColumns, attendanceExtraColumns, normalizeReviewedAttendance, normalizeReviewedUrl, type ReviewedAttendance } from "./attendance";
import { resolveEntityGeography } from "../geo/entity-geo";

export const REVIEW_MAX_DATES = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An end time earlier than the start means "after midnight" — up to this long. */
const MAX_OVERNIGHT_MS = 12 * 60 * 60 * 1000;

export interface NormalizedPlace {
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  locationId: string | null;
}

export interface NormalizedDate {
  date: string;
  start: string | null;
  end: string | null;
  place: NormalizedPlace;
  details: string | null;
}

export interface NormalizedImport {
  intent: EventImportIntent;
  title: string;
  description: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  /** Chronological; each date with its own place. `date` (YYYY-MM-DD) is
   * always real; `start` / `end` are exact instants ONLY when published —
   * null means unknown (never a placeholder). No end without a start. */
  occurrences: NormalizedDate[];
  useEventId: string | null;
  /** Participating: create (or reuse) a canonical Event for this import. */
  asEvent: boolean;
  /** Organizer named by the source (evidence-gated upstream); never a host link. */
  organizer: string | null;
  /** Reviewed attendance action for a NEW Event (Get Tickets / RSVP / Register). */
  attendance: ReviewedAttendance | null;
  /** A separate reviewed Ticket link beside an RSVP / Registration action. */
  ticketsUrl: string | null;
  /** What the source made public about the place; "hidden" → no venue,
   * street address or Findmi Location is saved for any date. */
  locationVisibility: LocationVisibility | null;
  /** The reviewed primary Event category for a NEW Event (validated as a
   * real kind='event' category when written). */
  categoryId: string | null;
  /** The reviewed Formats for a NEW Event (validated as kind='event_format'). */
  formatIds: string[];
}

/** Privacy: when the organizer withholds the address, a date keeps only its
 * public city/state — never a venue, street, postal code or Location. */
function withholdPlace(p: NormalizedPlace): NormalizedPlace {
  return { name: null, address: null, postalCode: null, locationId: null, city: p.city, state: p.state };
}

function normalizePlace(p: ReviewPlace | null | undefined): NormalizedPlace {
  const postal = cleanText(p?.postalCode, 12);
  return {
    name: cleanText(p?.venueName, 160),
    address: cleanText(p?.address, 200),
    city: cleanText(p?.city, 80),
    state: usStateCode(p?.state) ?? cleanText(p?.state, 40),
    postalCode: postal && /^[A-Za-z0-9 -]{3,12}$/.test(postal) ? postal : null,
    locationId: p?.useLocationId && UUID.test(p.useLocationId) ? p.useLocationId : null,
  };
}

const placeKey = (p: NormalizedPlace) => p.locationId ?? `${(p.name ?? "").toLowerCase()}|${(p.address ?? "").toLowerCase()}`;

/** One Event date's identity: calendar date + exact start (or "untimed") +
 * place. Same date at different Locations stays distinct even with no
 * times; the same date at the same place with the same (or no) time is a
 * duplicate. */
export function importDateKey(d: Pick<NormalizedDate, "date" | "start" | "place">): string {
  return `${d.date}#${d.start ? new Date(d.start).toISOString() : "untimed"}#${placeKey(d.place)}`;
}

/** Chronological without fake times: date, then known start (timed before
 * untimed on the same date), then place. */
export function compareImportDates(a: NormalizedDate, b: NormalizedDate): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.start && b.start && a.start !== b.start) return a.start.localeCompare(b.start);
  if (a.start && !b.start) return -1;
  if (!a.start && b.start) return 1;
  return placeKey(a.place).localeCompare(placeKey(b.place));
}

/** The parent Event's calendar range from its dates. Dates are always
 * real; the parent's exact start / end are kept ONLY when every date on the
 * first (last) calendar day publishes one — never borrowed from a later
 * date, a Programming item or a guess. */
export function parentEventRange(dates: Pick<NormalizedDate, "date" | "start" | "end">[]): { start_date: string; end_date: string; start_at: string | null; end_at: string | null } {
  const endDateOf = (d: Pick<NormalizedDate, "date" | "end">) => (d.end ? dateInAppZone(d.end, d.date) : d.date);
  const start_date = dates.reduce((min, d) => (d.date < min ? d.date : min), dates[0].date);
  const end_date = dates.reduce((max, d) => (endDateOf(d) > max ? endDateOf(d) : max), endDateOf(dates[0]));
  const first = dates.filter((d) => d.date === start_date);
  const start_at = first.every((d) => d.start) ? first.map((d) => d.start as string).sort()[0] : null;
  const last = dates.filter((d) => endDateOf(d) === end_date);
  const end_at = start_at && last.every((d) => d.end) ? last.map((d) => d.end as string).sort().at(-1)! : null;
  return { start_date, end_date: end_date > start_date ? end_date : start_date, start_at, end_at };
}

// A timed end's calendar date in the app timezone (an end exactly at
// midnight belongs to the day before).
function dateInAppZone(iso: string, fallback: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return fallback;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t - 1));
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function nextDay(date: string): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

/** Pure validation of reviewed values → normalized import, or a field error. */
export function normalizeReview(review: EventImportReview): { ok: true; value: NormalizedImport } | { ok: false; error: string; field?: string } {
  if (review.intent !== "participating" && review.intent !== "hosting") return { ok: false, error: "Choose how your Business is involved." };
  const title = cleanText(review.title, 200);
  if (!title) return { ok: false, error: "Add the event's name.", field: "title" };
  const raw = Array.isArray(review.occurrences) ? review.occurrences.slice(0, REVIEW_MAX_DATES + 1) : [];
  if (raw.length === 0) return { ok: false, error: "Add at least one date.", field: "dates" };
  if (raw.length > REVIEW_MAX_DATES) return { ok: false, error: `Add up to ${REVIEW_MAX_DATES} dates at a time.`, field: "dates" };
  const shared = review.sharedPlace ? normalizePlace(review.place) : null;
  const occurrences: NormalizedImport["occurrences"] = [];
  const seen = new Set<string>();
  const HHMM = /^\d{2}:\d{2}$/;
  for (const d of raw) {
    // The calendar date is required; times are optional precision on it.
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.date ?? "")) return { ok: false, error: "Each date needs a day.", field: "dates" };
    const startText = (d.startTime ?? "").trim();
    const endText = (d.endTime ?? "").trim();
    if (startText && !HHMM.test(startText)) return { ok: false, error: "A start time couldn't be read. Fix it or leave it blank.", field: "dates" };
    if (endText && !HHMM.test(endText)) return { ok: false, error: "An end time couldn't be read. Fix it or leave it blank.", field: "dates" };
    // An end with no start is never guessed into a start.
    if (endText && !startText) return { ok: false, error: "An end time needs a start time. Add the start, or clear the end.", field: "dates" };
    let start: string | null = null;
    let end: string | null = null;
    if (startText) {
      start = localDateTimeToIso(`${d.date}T${startText}`);
      if (!start) return { ok: false, error: "A start time couldn't be read. Fix it or leave it blank.", field: "dates" };
      const endDateText = (d.endDate ?? "").trim();
      if (endDateText && !/^\d{4}-\d{2}-\d{2}$/.test(endDateText)) return { ok: false, error: "An end date couldn't be read. Fix it or clear it.", field: "dates" };
      if (endDateText && endDateText < d.date) return { ok: false, error: "The end date can't be before the start date.", field: "dates" };
      if (endDateText && !endText) return { ok: false, error: "An end date needs an end time. Add the end time, or clear the end date.", field: "dates" };
      if (endText && endDateText > d.date) {
        // A continuous span into a later day: its own end day, as reviewed.
        end = localDateTimeToIso(`${endDateText}T${endText}`);
      } else if (endText) {
        end = localDateTimeToIso(`${d.date}T${endText}`);
        // 6 PM – 12 AM: an end before the start ends after midnight.
        if (end && Date.parse(end) <= Date.parse(start) && endText < startText) {
          const overnight = localDateTimeToIso(`${nextDay(d.date)}T${endText}`);
          end = overnight && Date.parse(overnight) - Date.parse(start) <= MAX_OVERNIGHT_MS ? overnight : end;
        }
      }
      if (endText && (!end || Date.parse(end) <= Date.parse(start))) return { ok: false, error: "End time must be after the start time.", field: "dates" };
    }
    const place = shared ?? normalizePlace(d.place);
    const next: NormalizedDate = { date: d.date, start, end, place, details: cleanOccurrenceDetails(d.details) };
    const key = importDateKey(next);
    if (seen.has(key)) continue;
    seen.add(key);
    occurrences.push(next);
  }
  occurrences.sort(compareImportDates);

  // The source's location decision. "hidden" is enforced on every date;
  // "broad" never links a precise Location by itself, but a place the
  // person typed in Review is their own precise information ("exact").
  let locationVisibility = parseLocationVisibility(review.locationVisibility);
  if (locationVisibility === "hidden") {
    for (const o of occurrences) o.place = withholdPlace(o.place);
  } else if (locationVisibility === "broad" || locationVisibility === "none") {
    for (const o of occurrences) if (!o.place.name && !o.place.address) o.place = { ...o.place, locationId: null };
    if (occurrences.some((o) => o.place.name || o.place.address || o.place.locationId)) locationVisibility = "exact";
    else if (locationVisibility === "none" && occurrences.some((o) => o.place.city || o.place.state)) locationVisibility = "broad";
  }

  let sourceUrl: string | null = null;
  if (review.sourceUrl?.trim()) {
    const r = validateCustomDestination(review.sourceUrl.trim());
    if (!r.ok) return { ok: false, error: `Event link: ${r.error}`, field: "sourceUrl" };
    sourceUrl = r.value;
  }
  let imageUrl: string | null = null;
  if (review.imageUrl?.trim()) {
    try {
      const u = new URL(review.imageUrl.trim());
      imageUrl = u.protocol === "https:" ? u.toString() : null;
    } catch {
      imageUrl = null;
    }
  }
  return {
    ok: true,
    value: {
      intent: review.intent,
      title,
      description: cleanEventDescription(review.description),
      imageUrl,
      sourceUrl,
      occurrences,
      useEventId: review.useEventId && UUID.test(review.useEventId) ? review.useEventId : null,
      // Analyze decides from the EVIDENCE (persistAs); a source link is
      // provenance, never a requirement — pasted text / an uploaded image
      // can ground a real Event without one. A name and at least one full
      // date are already required above.
      asEvent: review.intent === "participating" && review.asEvent === true,
      organizer: cleanText(review.organizer, 160),
      attendance: normalizeReviewedAttendance(review.attendance),
      ticketsUrl: normalizeReviewedUrl(review.ticketsUrl),
      locationVisibility,
      categoryId: review.categoryId && UUID.test(review.categoryId) ? review.categoryId : null,
      formatIds: cleanEventFormatIds(Array.isArray(review.formatIds) ? review.formatIds : []).slice(0, 32),
    },
  };
}

/** Each new date's own details (event_occurrences.details), best-effort AFTER
 * the rows exist — so Event creation keeps working on a database where that
 * column's migration hasn't been applied yet (the write then just fails
 * quietly). Rows are matched by their own start time + place, never by
 * position. */
async function writeOccurrenceDetails(
  admin: SupabaseClient,
  rows: OccurrenceRowRef[],
  dates: NormalizedImport["occurrences"],
  snaps: { location_id: string | null; venue_name: string | null }[]
): Promise<void> {
  const used = new Set<string>();
  for (let i = 0; i < dates.length; i++) {
    const details = dates[i].details;
    if (!details) continue;
    const row = rows.find((r) => !used.has(r.id) && sameImportDateRow(r, dates[i], snaps[i]));
    if (!row) continue;
    used.add(row.id);
    const { error } = await admin.from("event_occurrences").update({ details }).eq("id", row.id);
    if (error) {
      console.warn("[event-import] occurrence details not saved", { reason: error.message });
      return;
    }
  }
}

export interface OccurrenceRowRef {
  id: string;
  occurrence_date?: string | null;
  start_at?: string | null;
  location_id?: string | null;
  venue_name?: string | null;
}

/** A created row IS this reviewed date: same calendar date, same start
 * (both unknown counts as the same), same Location and venue. Never by
 * position — so two untimed dates on the same day at different Locations
 * each get their own details. */
export function sameImportDateRow(r: OccurrenceRowRef, d: Pick<NormalizedDate, "date" | "start">, snap: { location_id: string | null; venue_name: string | null }): boolean {
  if (r.occurrence_date && r.occurrence_date !== d.date) return false;
  const rowStart = r.start_at ? Date.parse(r.start_at) : null;
  const dateStart = d.start ? Date.parse(d.start) : null;
  if (rowStart !== dateStart) return false;
  return (r.location_id ?? null) === snap.location_id && (r.venue_name ?? null) === snap.venue_name;
}

/** The newer Event columns, best-effort (see attendanceExtraColumns). */
async function writeEventExtras(admin: SupabaseClient, eventId: string, input: NormalizedImport): Promise<void> {
  const extras = attendanceExtraColumns(input.attendance, input.locationVisibility);
  if (Object.keys(extras).length === 0) return;
  const { error } = await admin.from("events").update(extras).eq("id", eventId);
  if (error) console.warn("[event-import] attendance/location extras not saved", { eventId, reason: error.message });
}

/** Event Taxonomy V1 — links a NEW Event to its reviewed primary category
 * (one event_categories row; only a real kind='event' category). Called
 * only right after this import created the Event, so an existing Event an
 * import joins never has its categories touched. Best-effort. */
async function writeEventCategory(admin: SupabaseClient, eventId: string, input: NormalizedImport): Promise<void> {
  const ids = await existingEventCategoryIds(admin, input.categoryId ? [input.categoryId] : []);
  if (ids.length === 0) return;
  const { error } = await admin.from("event_categories").insert(ids.map((category_id) => ({ event_id: eventId, category_id })));
  if (error) console.warn("[event-import] category not saved", { eventId, reason: error.message });
}

/** Event Formats V1 — the reviewed Formats of a NEW Event (only called
 * right after this import created it, like writeEventCategory). */
async function writeEventFormats(admin: SupabaseClient, eventId: string, input: NormalizedImport): Promise<void> {
  if (input.formatIds.length === 0) return;
  const { error } = await syncEventFormats(admin, eventId, input.formatIds);
  if (error) console.warn("[event-import] formats not saved", { eventId, reason: error });
}

export interface PersistDeps {
  admin: SupabaseClient;
  userId: string;
  businessId: string;
  businessName: string;
  applyToEvent: (eventId: string) => Promise<EventApplicationResult>;
  canHost: () => Promise<boolean>;
  /** Verifies + re-hosts a remote image in Findmi storage; null on any failure. */
  storeImage: (url: string) => Promise<string | null>;
  /** Existing active Market/Area for typed city/state (never creates one). */
  geography: (text: string) => Promise<{ marketId: string; areaId: string | null } | null>;
  uniqueEventSlug: (title: string) => Promise<string | null>;
  /** `startIso` is null when the first date has no published time. */
  notifyNewEvent: (eventId: string, title: string, startIso: string | null, date: string) => Promise<void>;
  propagateDates: (eventId: string, occurrenceIds: string[]) => Promise<void>;
  /** Rich Event Persistence: an Event already carrying this source link
   * (pending review included) — reused instead of creating a second one. */
  findEventBySourceUrl?: (url: string) => Promise<{ id: string } | null>;
}

const businessHome = (businessId: string) => `/account/business/${businessId}`;

type LocationRow = { id: string; name: string; address: string | null; city: string | null; state: string | null; postal_code: string | null; latitude: number | null; longitude: number | null };

/** Confirmed existing Locations, each read once (archived/trashed ones are
 * ignored — that date falls back to its typed details). */
async function loadLocations(admin: SupabaseClient, ids: string[]): Promise<Map<string, LocationRow>> {
  const out = new Map<string, LocationRow>();
  for (const id of [...new Set(ids)]) {
    const { data } = await admin
      .from("locations")
      .select("id, name, address, city, state, postal_code, latitude, longitude")
      .eq("id", id)
      .is("archived_at", null)
      .is("trashed_at", null)
      .maybeSingle();
    if (data) out.set(id, data as LocationRow);
  }
  return out;
}

/** The venue snapshot a date is stored with: its confirmed Location's own
 * details, else the reviewed text. */
function snapshotFor(place: NormalizedPlace, locations: Map<string, LocationRow>) {
  const loc = place.locationId ? locations.get(place.locationId) : undefined;
  return loc
    ? { location_id: loc.id, venue_name: loc.name, address: loc.address, city: loc.city, state: loc.state, postal_code: loc.postal_code, latitude: loc.latitude, longitude: loc.longitude }
    : { location_id: null, venue_name: place.name, address: place.address, city: place.city, state: place.state, postal_code: place.postalCode, latitude: null, longitude: null };
}

export async function persistEventImport(input: NormalizedImport, deps: PersistDeps): Promise<EventImportOutcome> {
  return input.intent === "hosting" ? persistHosting(input, deps) : persistParticipating(input, deps);
}

async function persistParticipating(input: NormalizedImport, deps: PersistDeps): Promise<EventImportOutcome> {
  const { admin, businessId } = deps;
  const scheduleHref = `${businessHome(businessId)}?tab=findmi-here`;

  if (input.useEventId) {
    // The Event already on Findmi owns its dates and places: participation
    // applies to that Event (unchanged V1 policy); nothing is duplicated.
    const result = await deps.applyToEvent(input.useEventId);
    if (result === "unavailable") return { ok: false, error: "That Findmi Event is no longer available. Import it as a new item instead." };
    if (result === "already_approved") return { ok: true, kind: "already", title: input.title, viewHref: scheduleHref };
    if (result === "approved_now") return { ok: true, kind: "scheduled", title: input.title, viewHref: scheduleHref };
    return { ok: true, kind: "requested", title: input.title, viewHref: scheduleHref };
  }

  if (input.asEvent) return persistParticipatingEvent(input, deps);

  // A schedule item (appearances) needs a real start time — a date with no
  // published time can't be one, and no placeholder time is ever written.
  if (input.occurrences.some((d) => !d.start)) {
    return { ok: false, error: "Add a start time for each date to put it on your schedule.", field: "dates" };
  }

  // Never add a second copy of a date already on this Business's schedule.
  const { data: existing } = await admin
    .from("appearances")
    .select("start_at, title")
    .eq("business_id", businessId)
    .neq("status", "canceled")
    .in(
      "start_at",
      input.occurrences.map((d) => d.start as string)
    );
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const taken = new Set(((existing ?? []) as { start_at: string; title: string }[]).filter((r) => norm(r.title) === norm(input.title)).map((r) => new Date(r.start_at).toISOString()));
  const toAdd = input.occurrences.filter((d) => !taken.has(new Date(d.start as string).toISOString()));
  if (toAdd.length === 0) return { ok: true, kind: "already", title: input.title, viewHref: scheduleHref };

  const locations = await loadLocations(admin, toAdd.flatMap((d) => (d.place.locationId ? [d.place.locationId] : [])));
  // Existing Market/Area for each typed city (never creates one), looked up once per city.
  type ResolvedGeography = { market_id: string | null; market_area_id: string | null; geo_place_key?: string | null; geo_state_key?: string | null; geo_resolution?: "import" };
  const geoCache = new Map<string, ResolvedGeography>();
  const geographyFor = async (snap: ReturnType<typeof snapshotFor>): Promise<ResolvedGeography> => {
    // Canonical Entity Geography completion pass — a Location-linked date
    // never stores its own copy of the Location's canonical geo_* (read-
    // time authoritative via location_id — see getFindMiHereFeed's own
    // effective-geography join); only a manual (no location) date
    // resolves and stores its own, deterministic-only, never guessed.
    if (snap.location_id) return { market_id: null, market_area_id: null };
    const text = [snap.city, snap.state].filter(Boolean).join(", ");
    if (!text) return { market_id: null, market_area_id: null };
    if (!geoCache.has(text)) {
      const [match, geo] = await Promise.all([
        deps.geography(text),
        snap.city && snap.state ? resolveEntityGeography({ city: snap.city, state: snap.state }).catch(() => ({ status: "unresolved" as const, reason: "" })) : Promise.resolve({ status: "unresolved" as const, reason: "" }),
      ]);
      const geoFields: Pick<ResolvedGeography, "geo_place_key" | "geo_state_key" | "geo_resolution"> = geo.status === "resolved" || geo.status === "partial" ? { geo_place_key: geo.keys.place, geo_state_key: geo.keys.state, geo_resolution: "import" } : {};
      geoCache.set(text, { market_id: match ? match.marketId : null, market_area_id: match ? match.areaId : null, ...geoFields });
    }
    return geoCache.get(text)!;
  };

  const flyer = input.imageUrl ? await deps.storeImage(input.imageUrl) : null;
  const rows = [];
  for (const d of toAdd) {
    const snap = snapshotFor(d.place, locations);
    rows.push({
      business_id: businessId,
      status: "confirmed",
      title: input.title,
      start_at: d.start,
      end_at: d.end,
      // Each date at ITS OWN place (a tour's stops differ).
      venue_name: snap.venue_name,
      address: snap.address,
      city: snap.city,
      state: snap.state,
      location_id: snap.location_id,
      external_url: input.sourceUrl,
      flyer_image_url: flyer,
      ...(await geographyFor(snap)),
      // Business-entered standalone schedule item (the existing provenance
      // value for Where I'll Be items not linked to a Findmi Event).
      source: "manual",
    });
  }
  const { error } = await admin.from("appearances").insert(rows);
  if (error) return { ok: false, error: "Couldn't add it to your schedule. Please try again." };
  return { ok: true, kind: "scheduled", title: input.title, viewHref: scheduleHref };
}

/** Rich Event Persistence — a genuine Event the Business takes part in
 * (Where I'll Be). The Business is a PARTICIPANT, never the host:
 *
 *   1. same source link already on Findmi → that Event, through the shared
 *      join path (applyToEvent — the organizer/Findmi confirms);
 *   2. otherwise ONE new Event (no host, no owner membership — the
 *      importer doesn't manage someone else's Event), public as soon as it
 *      is saved like every other new Event (lib/event-publication.ts —
 *      Findmi Admin oversees it under New Events), with the source's
 *      description, link, image and organizer name;
 *   3. one Event Occurrence per date, each with its own confirmed Location
 *      (or venue text);
 *   4. the Business's participation: event_businesses approved for all
 *      dates (there is no other organizer on Findmi to agree with yet — the
 *      same self-asserted presence a schedule item records), realized by
 *      the shared propagateAllDatesParticipation into one Event-linked
 *      schedule item per date (event_id + event_occurrence_id + the
 *      occurrence's Location).
 *
 * No Appearance is invented for anyone else, and the Business never
 * becomes host_business_id. */
async function persistParticipatingEvent(input: NormalizedImport, deps: PersistDeps): Promise<EventImportOutcome> {
  const { businessId } = deps;
  const scheduleHref = `${businessHome(businessId)}?tab=findmi-here`;

  // 1. Retry / second Business: the same source Event is never created twice.
  const existing = input.sourceUrl && deps.findEventBySourceUrl ? await deps.findEventBySourceUrl(input.sourceUrl) : null;
  if (existing) {
    const result = await deps.applyToEvent(existing.id);
    if (result === "unavailable") return { ok: false, error: "That Event is already on Findmi but isn't open for new participants right now." };
    if (result === "already_approved") return { ok: true, kind: "already", title: input.title, viewHref: scheduleHref };
    if (result === "approved_now") return { ok: true, kind: "scheduled", title: input.title, viewHref: scheduleHref };
    return { ok: true, kind: "requested", title: input.title, viewHref: scheduleHref };
  }

  const created = await createSourceEvent(input, deps, businessId);
  if (!created.ok) return created;
  // 4b. The Business's Event-linked schedule item for every date.
  await deps.propagateDates(created.eventId, created.occurrenceIds);

  await deps.notifyNewEvent(created.eventId, input.title, input.occurrences[0].start, input.occurrences[0].date);
  return { ok: true, kind: "scheduled", title: input.title, viewHref: scheduleHref, newEvent: true };
}

/** What creating a source Event needs — no initiating Business, no user. */
export type SourceEventDeps = Pick<PersistDeps, "admin" | "storeImage" | "geography" | "uniqueEventSlug" | "propagateDates" | "findEventBySourceUrl">;

/** Steps 2–4a of persistParticipatingEvent, shared with Admin Event Import:
 * ONE new Event with no host and no owner (published like every new Event,
 * the source's organizer name as text only), its reviewed category and
 * Formats, the given Business's approved all-dates participation when one
 * is given (written BEFORE the dates, so creating them realizes it per
 * date), and one Event Occurrence per date at its own place. */
async function createSourceEvent(
  input: NormalizedImport,
  deps: SourceEventDeps,
  participantBusinessId: string | null,
  /** Explicit Involved-Business Resolution (Admin only) — additional
   * Businesses the operator matched/created from "otherBusinesses"
   * evidence (EHVM/Tangent-style signals), approved the SAME way and
   * through the SAME event_businesses write as participantBusinessId
   * just below — never a second participation path, never written to
   * event_occurrence_businesses or synced to Findmi Here independently. */
  additionalParticipantBusinessIds: string[] = []
): Promise<{ ok: true; eventId: string; occurrenceIds: string[] } | { ok: false; error: string; field?: string }> {
  const { admin } = deps;
  const slug = await deps.uniqueEventSlug(input.title);
  if (!slug) return { ok: false, error: "Add the event's name.", field: "title" };
  // The parent's calendar range from its dates; exact parent times only
  // where the dates themselves publish them (never the festival span
  // pushed down, never a Programming time pulled up).
  const range = parentEventRange(input.occurrences);
  const locations = await loadLocations(admin, input.occurrences.flatMap((d) => (d.place.locationId ? [d.place.locationId] : [])));
  const snaps = input.occurrences.map((d) => snapshotFor(d.place, locations));
  const eventPlace = eventPlaceFor(snaps);
  const geoText = [eventPlace.city ?? snaps[0].city, eventPlace.state ?? snaps[0].state].filter(Boolean).join(", ");
  const geo = geoText ? await deps.geography(geoText) : null;
  // Canonical Entity Geography completion pass — the Event's OWN
  // canonical geography (never inherited — see admin saveEvent's
  // identical addition for the full rule), resolved deterministically
  // from whatever city/state ends up representing this Event.
  const eventCity = eventPlace.city ?? snaps[0].city;
  const eventState = eventPlace.state ?? snaps[0].state;
  const eventCanonicalGeo = eventCity && eventState ? await resolveEntityGeography({ city: eventCity, state: eventState }).catch(() => ({ status: "unresolved" as const, reason: "" })) : { status: "unresolved" as const, reason: "" };
  const eventGeoFields: Partial<{ geo_place_key: string | null; geo_zcta_key: string | null; geo_state_key: string | null; geo_resolution: "import" }> =
    eventCanonicalGeo.status === "resolved" || eventCanonicalGeo.status === "partial" ? { geo_place_key: eventCanonicalGeo.keys.place, geo_zcta_key: eventCanonicalGeo.keys.zcta, geo_state_key: eventCanonicalGeo.keys.state, geo_resolution: "import" } : {};
  const occurrenceGeoFields = await resolveOccurrenceGeoFields(snaps);
  const cover = input.imageUrl ? await deps.storeImage(input.imageUrl) : null;

  // 2. The Event — published like every new Event (create_owned_event
  // isn't used here: it always makes the caller the Event's owner, which
  // is hosting, not participating).
  const { data: created, error } = await admin
    .from("events")
    .insert({
      name: input.title,
      slug,
      start_date: range.start_date,
      end_date: range.end_date,
      start_at: range.start_at,
      end_at: range.end_at,
      ...NEW_EVENT_PUBLICATION,
      host_business_id: null,
      organizer_name: input.organizer,
      description: input.description,
      external_url: input.sourceUrl,
      cover_image_url: cover,
      market_id: geo?.marketId ?? null,
      market_area_id: geo?.areaId ?? null,
      ...eventPlace,
      ...eventGeoFields,
      ...attendanceEventColumns(input.attendance, input.ticketsUrl),
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: "Couldn't add this Event. Please try again." };
  const eventId = (created as { id: string }).id;
  // Imported for a participating Business: the Event's own organizer
  // hasn't provided it. The imported cover keeps a public-source basis.
  await recordProvenance(admin, { entityType: "event", entityId: eventId, sourceKind: "import", sourceMethod: "business_event_import", sourceUrl: input.sourceUrl });
  if (cover) await recordProvenance(admin, { entityType: "event_image", entityId: eventId, sourceKind: "import", sourceMethod: "event_cover_import", sourceUrl: input.imageUrl, rightsBasis: "public_source" });
  await writeEventExtras(admin, eventId, input);
  await writeEventCategory(admin, eventId, input);
  await writeEventFormats(admin, eventId, input);

  // 4a. Participation first, so creating the dates realizes it per date.
  if (participantBusinessId) {
    const { error: rosterError } = await admin
      .from("event_businesses")
      .upsert({ event_id: eventId, business_id: participantBusinessId, status: "approved", participation_scope: "all_dates" }, { onConflict: "event_id,business_id" });
    if (rosterError) return { ok: false, error: "Couldn't add this Event. Please try again." };
  }
  for (const otherId of additionalParticipantBusinessIds) {
    if (otherId === participantBusinessId) continue; // never add the primary Business twice
    await admin
      .from("event_businesses")
      .upsert({ event_id: eventId, business_id: otherId, status: "approved", participation_scope: "all_dates" }, { onConflict: "event_id,business_id" });
    // Best-effort: a failure here never blocks the Event itself from being
    // created — the operator can still add the Business from the Event
    // page afterwards through the exact same ParticipationRoster UI.
  }

  // 3. One Event Occurrence per date, each at its own place.
  const { data: occs } = await admin
    .from("event_occurrences")
    .insert(
      input.occurrences.map((d, i) => occurrenceInsertRow(eventId, d, snaps[i], occurrenceGeoFields.get(i)))
    )
    .select("id, occurrence_date, start_at, location_id, venue_name");
  const occRows = (occs ?? []) as OccurrenceRowRef[];
  const ids = occRows.map((o) => o.id);
  if (ids.length > 0) await writeOccurrenceDetails(admin, occRows, input.occurrences, snaps);
  if (ids.length === 0) {
    // Never leave a dateless Event behind: soft-trash the row just created
    // (nothing is deleted) and report the failure.
    await admin.from("events").update({ trashed_at: new Date().toISOString() }).eq("id", eventId);
    return { ok: false, error: "Couldn't add this Event's dates. Please try again." };
  }
  return { ok: true, eventId, occurrenceIds: ids };
}

/** Admin Event Import — an OPERATOR discovery import of a public
 * third-party Event. No initiating Business and no signed-in person:
 *
 *   - a confirmed existing Findmi Event, or one already carrying the same
 *     source link → nothing is written (never a second copy, and an
 *     existing Event's host / roster is never changed from here);
 *   - otherwise ONE new Event through the same createSourceEvent path as a
 *     Business's participating import: host_business_id null, no owner
 *     membership, the source's organizer name as text only — never Findmi,
 *     never the operator;
 *   - `businessId` is THIS Event's own reviewed Business (the operator
 *     confirmed it per Event in Review) or null. When given it gets the
 *     existing participation relationship (event_businesses approved for
 *     all dates — what Admin's own Event roster records for a Business
 *     that is at an Event) and its Event-linked schedule item per date.
 *     It never becomes the host. Null → the Event is saved unassociated.
 *
 * The caller validates `businessId` names a real Business. */
export async function persistDiscoveryEvent(
  input: NormalizedImport,
  businessId: string | null,
  deps: SourceEventDeps,
  /** Explicit Involved-Business Resolution (Admin only) — see
   * createSourceEvent's own doc comment. Every other caller omits this
   * and behaves exactly as before. */
  otherBusinessIds: string[] = []
): Promise<EventImportOutcome> {
  const adminHref = (id: string) => `/admin/events/${id}`;
  if (input.useEventId) return { ok: true, kind: "already", title: input.title, viewHref: adminHref(input.useEventId) };
  const existing = input.sourceUrl && deps.findEventBySourceUrl ? await deps.findEventBySourceUrl(input.sourceUrl) : null;
  if (existing) return { ok: true, kind: "already", title: input.title, viewHref: adminHref(existing.id) };

  const created = await createSourceEvent(input, deps, businessId, otherBusinessIds);
  if (!created.ok) return created;
  if (businessId) await deps.propagateDates(created.eventId, created.occurrenceIds);
  return { ok: true, kind: "scheduled", title: input.title, viewHref: adminHref(created.eventId), newEvent: true };
}

/** One event_occurrences insert: the real calendar date always, exact
 * times only when published (null otherwise — never a placeholder).
 *
 * Canonical Entity Geography completion pass — `geo` is the resolved
 * canonical geography for a MANUAL (no location_id) date only; a
 * Location-linked date never stores its own copy (read-time authoritative
 * via location_id — see getFindMiHereFeed's own effective-geography
 * join) — see resolveOccurrenceGeoFields below, the one place that
 * actually resolves it. */
export function occurrenceInsertRow(eventId: string, d: NormalizedDate, snap: ReturnType<typeof snapshotFor>, geo?: { geo_place_key: string | null; geo_state_key: string | null; geo_resolution: "import" }) {
  return {
    event_id: eventId,
    occurrence_date: d.date,
    start_at: d.start,
    end_at: d.start ? d.end : null,
    location_id: snap.location_id,
    venue_name: snap.venue_name,
    address: snap.address,
    city: snap.city,
    state: snap.state,
    postal_code: snap.postal_code,
    ...(snap.location_id ? {} : geo ?? {}),
  };
}

/** Resolves deterministic canonical geography for each MANUAL
 * (no location_id) snapshot, keyed by its own city/state text so an
 * Event with several dates in the same place only resolves once. Never
 * guesses — an ambiguous/unresolved date simply gets no geo_* (never
 * blocks the import). */
async function resolveOccurrenceGeoFields(snaps: ReturnType<typeof snapshotFor>[]): Promise<Map<number, { geo_place_key: string | null; geo_state_key: string | null; geo_resolution: "import" }>> {
  const out = new Map<number, { geo_place_key: string | null; geo_state_key: string | null; geo_resolution: "import" }>();
  const cache = new Map<string, { geo_place_key: string | null; geo_state_key: string | null; geo_resolution: "import" } | null>();
  for (let i = 0; i < snaps.length; i++) {
    const snap = snaps[i];
    if (snap.location_id || !snap.city || !snap.state) continue;
    const key = `${snap.city}|${snap.state}`;
    if (!cache.has(key)) {
      const geo = await resolveEntityGeography({ city: snap.city, state: snap.state }).catch(() => ({ status: "unresolved" as const, reason: "" }));
      cache.set(key, geo.status === "resolved" || geo.status === "partial" ? { geo_place_key: geo.keys.place, geo_state_key: geo.keys.state, geo_resolution: "import" } : null);
    }
    const resolved = cache.get(key);
    if (resolved) out.set(i, resolved);
  }
  return out;
}

/** Event-level place: the shared one, or — for a multi-place Event — only
 * the city/state every date has in common (each date keeps its own). */
function eventPlaceFor(snaps: ReturnType<typeof snapshotFor>[]) {
  const sameKey = (s: (typeof snaps)[number]) => s.location_id ?? `${(s.venue_name ?? "").toLowerCase()}|${(s.address ?? "").toLowerCase()}`;
  const onePlace = snaps.every((s) => sameKey(s) === sameKey(snaps[0]));
  const common = <K extends "city" | "state">(k: K) => (snaps.every((s) => (s[k] ?? "") === (snaps[0][k] ?? "")) ? snaps[0][k] : null);
  return onePlace
    ? { venue_name: snaps[0].venue_name, address: snaps[0].address, city: snaps[0].city, state: snaps[0].state, postal_code: snaps[0].postal_code, latitude: snaps[0].latitude, longitude: snaps[0].longitude }
    : { venue_name: null, address: null, city: common("city"), state: common("state"), postal_code: null, latitude: null, longitude: null };
}

async function persistHosting(input: NormalizedImport, deps: PersistDeps): Promise<EventImportOutcome> {
  const { admin, businessId } = deps;
  if (!(await deps.canHost())) return { ok: false, error: `Only an Owner or Manager of ${deps.businessName} can host an Event for it.` };

  if (input.useEventId) {
    const { data: existing } = await admin.from("events").select("id, host_business_id").eq("id", input.useEventId).maybeSingle();
    const ev = existing as { id: string; host_business_id: string | null } | null;
    if (ev && ev.host_business_id === businessId) {
      return { ok: true, kind: "already", title: input.title, viewHref: `/account/event/${ev.id}?business_id=${encodeURIComponent(businessId)}` };
    }
    return {
      ok: false,
      error: "This Event is already on Findmi, organized by someone else. If your Business organizes it, contact Findmi and we'll connect it to you.",
    };
  }

  // Hosting creates through create_owned_event, which (unchanged) requires
  // an exact start and end — ask for them rather than invent either.
  const range = parentEventRange(input.occurrences);
  if (!range.start_at || !range.end_at) {
    return { ok: false, error: "To host this Event, add a start and end time for its first and last dates.", field: "dates" };
  }
  const slug = await deps.uniqueEventSlug(input.title);
  if (!slug) return { ok: false, error: "Add the event's name.", field: "title" };
  const first = input.occurrences[0];

  const locations = await loadLocations(admin, input.occurrences.flatMap((d) => (d.place.locationId ? [d.place.locationId] : [])));
  const snaps = input.occurrences.map((d) => snapshotFor(d.place, locations));
  const eventPlace = eventPlaceFor(snaps);
  const geoText = [eventPlace.city ?? snaps[0].city, eventPlace.state ?? snaps[0].state].filter(Boolean).join(", ");
  const geo = geoText ? await deps.geography(geoText) : null;
  // Canonical Entity Geography completion pass — see createSourceEvent's
  // identical addition for the full rule.
  const eventCity = eventPlace.city ?? snaps[0].city;
  const eventState = eventPlace.state ?? snaps[0].state;
  const eventCanonicalGeo = eventCity && eventState ? await resolveEntityGeography({ city: eventCity, state: eventState }).catch(() => ({ status: "unresolved" as const, reason: "" })) : { status: "unresolved" as const, reason: "" };
  const eventGeoFields: Partial<{ geo_place_key: string | null; geo_zcta_key: string | null; geo_state_key: string | null; geo_resolution: "import" }> =
    eventCanonicalGeo.status === "resolved" || eventCanonicalGeo.status === "partial" ? { geo_place_key: eventCanonicalGeo.keys.place, geo_zcta_key: eventCanonicalGeo.keys.zcta, geo_state_key: eventCanonicalGeo.keys.state, geo_resolution: "import" } : {};
  const occurrenceGeoFields = await resolveOccurrenceGeoFields(snaps);

  const { data: created, error } = await admin.rpc("create_owned_event", {
    p_user_id: deps.userId,
    p_name: input.title,
    p_slug: slug,
    p_start_at: range.start_at,
    p_end_at: range.end_at,
    p_market_id: geo?.marketId ?? null,
    p_requested_market_text: null,
    p_host_business_id: businessId,
  });
  if (error || !created) return { ok: false, error: "Couldn't create your Event. Please try again." };
  const eventId = (created as { id: string }).id;
  // Live by default (the RPC still writes the old review state).
  await publishCreatedEvent(admin, eventId);
  // Hosted by the importing Business itself: organization-provided.
  await recordProvenance(admin, { entityType: "event", entityId: eventId, sourceKind: "organization", sourceMethod: "business_hosted_import", sourceUrl: input.sourceUrl });

  const cover = input.imageUrl ? await deps.storeImage(input.imageUrl) : null;
  // Best-effort detail fill — the Event already exists either way.
  await admin
    .from("events")
    .update({
      ...eventPlace,
      ...eventGeoFields,
      description: input.description,
      external_url: input.sourceUrl,
      ...(cover ? { cover_image_url: cover } : {}),
      ...(geo?.areaId ? { market_area_id: geo.areaId } : {}),
      ...attendanceEventColumns(input.attendance, input.ticketsUrl),
    })
    .eq("id", eventId);
  await writeEventExtras(admin, eventId, input);
  await writeEventCategory(admin, eventId, input);
  await writeEventFormats(admin, eventId, input);

  // Dates: one Event Occurrence per date — each linked to ITS OWN Location
  // (or carrying its own venue snapshot) — when there are several dates or
  // any confirmed Location (the same seeded-occurrence shape Host an Event's
  // manual form uses for a Location).
  // (A date with its own details also gets its row — the details live there.)
  if (input.occurrences.length > 1 || snaps.some((s) => s.location_id) || input.occurrences.some((d) => d.details)) {
    const { data: occs } = await admin
      .from("event_occurrences")
      .insert(
        input.occurrences.map((d, i) => occurrenceInsertRow(eventId, d, snaps[i], occurrenceGeoFields.get(i)))
      )
      .select("id, occurrence_date, start_at, location_id, venue_name");
    const occRows = (occs ?? []) as OccurrenceRowRef[];
    const ids = occRows.map((o) => o.id);
    if (ids.length) await writeOccurrenceDetails(admin, occRows, input.occurrences, snaps);
    if (ids.length) await deps.propagateDates(eventId, ids);
  }

  await deps.notifyNewEvent(eventId, input.title, first.start, first.date);
  return { ok: true, kind: "scheduled", title: input.title, viewHref: `/account/event/${eventId}?business_id=${encodeURIComponent(businessId)}` };
}
