import "server-only";
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
import type { EventImportIntent, EventImportOutcome, EventImportReview, ReviewPlace } from "./types";
import type { EventApplicationResult } from "../event-participation";
import { NEW_EVENT_PUBLICATION, publishCreatedEvent } from "../event-publication";

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

export interface NormalizedImport {
  intent: EventImportIntent;
  title: string;
  description: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  /** Chronological; each date with its own place. */
  occurrences: { start: string; end: string; place: NormalizedPlace }[];
  useEventId: string | null;
  /** Participating: create (or reuse) a canonical Event for this import. */
  asEvent: boolean;
  /** Organizer named by the source (evidence-gated upstream); never a host link. */
  organizer: string | null;
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
  for (const d of raw) {
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.date ?? "")) return { ok: false, error: "Each date needs a day.", field: "dates" };
    if (!/^\d{2}:\d{2}$/.test(d.startTime ?? "") || !/^\d{2}:\d{2}$/.test(d.endTime ?? "")) {
      return { ok: false, error: "Each date needs a start and end time.", field: "dates" };
    }
    const start = localDateTimeToIso(`${d.date}T${d.startTime}`);
    let end = localDateTimeToIso(`${d.date}T${d.endTime}`);
    // 6 PM – 12 AM: an end before the start ends after midnight.
    if (start && end && Date.parse(end) <= Date.parse(start) && d.endTime < d.startTime) {
      const overnight = localDateTimeToIso(`${nextDay(d.date)}T${d.endTime}`);
      end = overnight && Date.parse(overnight) - Date.parse(start) <= MAX_OVERNIGHT_MS ? overnight : end;
    }
    if (!start || !end || Date.parse(end) <= Date.parse(start)) return { ok: false, error: "End time must be after the start time.", field: "dates" };
    const place = shared ?? normalizePlace(d.place);
    const key = `${start}#${placeKey(place)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    occurrences.push({ start, end, place });
  }
  occurrences.sort((a, b) => a.start.localeCompare(b.start));

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
      description: cleanText(review.description, 2000),
      imageUrl,
      sourceUrl,
      occurrences,
      useEventId: review.useEventId && UUID.test(review.useEventId) ? review.useEventId : null,
      // An Event needs its own link to the source (identity for matching,
      // retries and the public "event page" link); without one it stays a
      // schedule item.
      asEvent: review.intent === "participating" && review.asEvent === true && Boolean(sourceUrl),
      organizer: cleanText(review.organizer, 160),
    },
  };
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
  notifyNewEvent: (eventId: string, title: string, startIso: string) => Promise<void>;
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

  // Never add a second copy of a date already on this Business's schedule.
  const { data: existing } = await admin
    .from("appearances")
    .select("start_at, title")
    .eq("business_id", businessId)
    .neq("status", "canceled")
    .in(
      "start_at",
      input.occurrences.map((d) => d.start)
    );
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const taken = new Set(((existing ?? []) as { start_at: string; title: string }[]).filter((r) => norm(r.title) === norm(input.title)).map((r) => new Date(r.start_at).toISOString()));
  const toAdd = input.occurrences.filter((d) => !taken.has(new Date(d.start).toISOString()));
  if (toAdd.length === 0) return { ok: true, kind: "already", title: input.title, viewHref: scheduleHref };

  const locations = await loadLocations(admin, toAdd.flatMap((d) => (d.place.locationId ? [d.place.locationId] : [])));
  // Existing Market/Area for each typed city (never creates one), looked up once per city.
  const geoCache = new Map<string, { market_id: string | null; market_area_id: string | null }>();
  const geographyFor = async (snap: ReturnType<typeof snapshotFor>) => {
    if (snap.location_id) return { market_id: null, market_area_id: null };
    const text = [snap.city, snap.state].filter(Boolean).join(", ");
    if (!text) return { market_id: null, market_area_id: null };
    if (!geoCache.has(text)) {
      const match = await deps.geography(text);
      geoCache.set(text, match ? { market_id: match.marketId, market_area_id: match.areaId } : { market_id: null, market_area_id: null });
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
  const { admin, businessId } = deps;
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

  const slug = await deps.uniqueEventSlug(input.title);
  if (!slug) return { ok: false, error: "Add the event's name.", field: "title" };
  const first = input.occurrences[0];
  const lastEnd = input.occurrences.reduce((max, d) => (d.end > max ? d.end : max), first.end);
  const locations = await loadLocations(admin, input.occurrences.flatMap((d) => (d.place.locationId ? [d.place.locationId] : [])));
  const snaps = input.occurrences.map((d) => snapshotFor(d.place, locations));
  const eventPlace = eventPlaceFor(snaps);
  const geoText = [eventPlace.city ?? snaps[0].city, eventPlace.state ?? snaps[0].state].filter(Boolean).join(", ");
  const geo = geoText ? await deps.geography(geoText) : null;
  const cover = input.imageUrl ? await deps.storeImage(input.imageUrl) : null;

  // 2. The Event — published like every new Event (create_owned_event
  // isn't used here: it always makes the caller the Event's owner, which
  // is hosting, not participating).
  const { data: created, error } = await admin
    .from("events")
    .insert({
      name: input.title,
      slug,
      start_at: first.start,
      end_at: lastEnd,
      ...NEW_EVENT_PUBLICATION,
      host_business_id: null,
      organizer_name: input.organizer,
      description: input.description,
      external_url: input.sourceUrl,
      cover_image_url: cover,
      market_id: geo?.marketId ?? null,
      market_area_id: geo?.areaId ?? null,
      ...eventPlace,
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: "Couldn't add this Event. Please try again." };
  const eventId = (created as { id: string }).id;

  // 4a. Participation first, so creating the dates realizes it per date.
  const { error: rosterError } = await admin
    .from("event_businesses")
    .upsert({ event_id: eventId, business_id: businessId, status: "approved", participation_scope: "all_dates" }, { onConflict: "event_id,business_id" });
  if (rosterError) return { ok: false, error: "Couldn't add this Event. Please try again." };

  // 3. One Event Occurrence per date, each at its own place.
  const { data: occs } = await admin
    .from("event_occurrences")
    .insert(
      input.occurrences.map((d, i) => ({
        event_id: eventId,
        start_at: d.start,
        end_at: d.end,
        location_id: snaps[i].location_id,
        venue_name: snaps[i].venue_name,
        address: snaps[i].address,
        city: snaps[i].city,
        state: snaps[i].state,
        postal_code: snaps[i].postal_code,
      }))
    )
    .select("id");
  const ids = ((occs ?? []) as { id: string }[]).map((o) => o.id);
  if (ids.length === 0) {
    // Never leave a dateless Event behind: soft-trash the row just created
    // (nothing is deleted) and report the failure.
    await admin.from("events").update({ trashed_at: new Date().toISOString() }).eq("id", eventId);
    return { ok: false, error: "Couldn't add this Event's dates. Please try again." };
  }
  // 4b. The Business's Event-linked schedule item for every date.
  await deps.propagateDates(eventId, ids);

  await deps.notifyNewEvent(eventId, input.title, first.start);
  return { ok: true, kind: "scheduled", title: input.title, viewHref: scheduleHref, newEvent: true };
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

  const slug = await deps.uniqueEventSlug(input.title);
  if (!slug) return { ok: false, error: "Add the event's name.", field: "title" };
  const first = input.occurrences[0];
  const lastEnd = input.occurrences.reduce((max, d) => (d.end > max ? d.end : max), first.end);

  const locations = await loadLocations(admin, input.occurrences.flatMap((d) => (d.place.locationId ? [d.place.locationId] : [])));
  const snaps = input.occurrences.map((d) => snapshotFor(d.place, locations));
  const eventPlace = eventPlaceFor(snaps);
  const geoText = [eventPlace.city ?? snaps[0].city, eventPlace.state ?? snaps[0].state].filter(Boolean).join(", ");
  const geo = geoText ? await deps.geography(geoText) : null;

  const { data: created, error } = await admin.rpc("create_owned_event", {
    p_user_id: deps.userId,
    p_name: input.title,
    p_slug: slug,
    p_start_at: first.start,
    p_end_at: lastEnd,
    p_market_id: geo?.marketId ?? null,
    p_requested_market_text: null,
    p_host_business_id: businessId,
  });
  if (error || !created) return { ok: false, error: "Couldn't create your Event. Please try again." };
  const eventId = (created as { id: string }).id;
  // Live by default (the RPC still writes the old review state).
  await publishCreatedEvent(admin, eventId);

  const cover = input.imageUrl ? await deps.storeImage(input.imageUrl) : null;
  // Best-effort detail fill — the Event already exists either way.
  await admin
    .from("events")
    .update({
      ...eventPlace,
      description: input.description,
      external_url: input.sourceUrl,
      ...(cover ? { cover_image_url: cover } : {}),
      ...(geo?.areaId ? { market_area_id: geo.areaId } : {}),
    })
    .eq("id", eventId);

  // Dates: one Event Occurrence per date — each linked to ITS OWN Location
  // (or carrying its own venue snapshot) — when there are several dates or
  // any confirmed Location (the same seeded-occurrence shape Host an Event's
  // manual form uses for a Location).
  if (input.occurrences.length > 1 || snaps.some((s) => s.location_id)) {
    const { data: occs } = await admin
      .from("event_occurrences")
      .insert(
        input.occurrences.map((d, i) => ({
          event_id: eventId,
          start_at: d.start,
          end_at: d.end,
          location_id: snaps[i].location_id,
          venue_name: snaps[i].venue_name,
          address: snaps[i].address,
          city: snaps[i].city,
          state: snaps[i].state,
          postal_code: snaps[i].postal_code,
        }))
      )
      .select("id");
    const ids = ((occs ?? []) as { id: string }[]).map((o) => o.id);
    if (ids.length) await deps.propagateDates(eventId, ids);
  }

  await deps.notifyNewEvent(eventId, input.title, first.start);
  return { ok: true, kind: "scheduled", title: input.title, viewHref: `/account/event/${eventId}?business_id=${encodeURIComponent(businessId)}` };
}
