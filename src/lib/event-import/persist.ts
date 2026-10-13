import "server-only";
// Event Import V1 — persistence, ONLY after the Business has reviewed the
// candidate. Re-validates every reviewed value (the Review form is client
// input) and writes through the existing domain paths:
//
// PARTICIPATING (something someone else organizes)
//   - confirmed existing Findmi Event → applyBusinessToEvent (the shared
//     participation invariant: 'applied', or approved now only if the
//     organizer already invited this Business). No new Event, no new Date.
//   - no Findmi Event → this Business's own standalone schedule item(s)
//     (appearances, source 'manual' — the existing Where I'll Be path), one
//     per date, never a second copy of a date already on the schedule.
//     A participant never becomes the owner of someone else's Event.
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
import type { EventImportIntent, EventImportOutcome, EventImportReview } from "./types";
import type { EventApplicationResult } from "../event-participation";

export const REVIEW_MAX_DATES = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NormalizedImport {
  intent: EventImportIntent;
  title: string;
  description: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  dates: { start: string; end: string }[];
  venue: { name: string | null; address: string | null; city: string | null; state: string | null; postalCode: string | null };
  useEventId: string | null;
  useLocationId: string | null;
}

/** Pure validation of reviewed values → normalized import, or a field error. */
export function normalizeReview(review: EventImportReview): { ok: true; value: NormalizedImport } | { ok: false; error: string; field?: string } {
  if (review.intent !== "participating" && review.intent !== "hosting") return { ok: false, error: "Choose how your Business is involved." };
  const title = cleanText(review.title, 200);
  if (!title) return { ok: false, error: "Add the event's name.", field: "title" };
  const rawDates = Array.isArray(review.dates) ? review.dates.slice(0, REVIEW_MAX_DATES + 1) : [];
  if (rawDates.length === 0) return { ok: false, error: "Add at least one date.", field: "dates" };
  if (rawDates.length > REVIEW_MAX_DATES) return { ok: false, error: `Add up to ${REVIEW_MAX_DATES} dates at a time.`, field: "dates" };
  const dates: { start: string; end: string }[] = [];
  for (const d of rawDates) {
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.date ?? "")) return { ok: false, error: "Each date needs a day.", field: "dates" };
    if (!/^\d{2}:\d{2}$/.test(d.startTime ?? "") || !/^\d{2}:\d{2}$/.test(d.endTime ?? "")) {
      return { ok: false, error: "Each date needs a start and end time.", field: "dates" };
    }
    const start = localDateTimeToIso(`${d.date}T${d.startTime}`);
    const end = localDateTimeToIso(`${d.date}T${d.endTime}`);
    if (!start || !end || Date.parse(end) <= Date.parse(start)) return { ok: false, error: "End time must be after the start time.", field: "dates" };
    if (!dates.some((x) => x.start === start)) dates.push({ start, end });
  }
  dates.sort((a, b) => a.start.localeCompare(b.start));

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
  const postal = cleanText(review.postalCode, 12);
  return {
    ok: true,
    value: {
      intent: review.intent,
      title,
      description: cleanText(review.description, 2000),
      imageUrl,
      sourceUrl,
      dates,
      venue: {
        name: cleanText(review.venueName, 160),
        address: cleanText(review.address, 200),
        city: cleanText(review.city, 80),
        state: usStateCode(review.state) ?? cleanText(review.state, 40),
        postalCode: postal && /^[A-Za-z0-9 -]{3,12}$/.test(postal) ? postal : null,
      },
      useEventId: review.useEventId && UUID.test(review.useEventId) ? review.useEventId : null,
      useLocationId: review.useLocationId && UUID.test(review.useLocationId) ? review.useLocationId : null,
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
}

const businessHome = (businessId: string) => `/account/business/${businessId}`;

async function venueFromLocation(admin: SupabaseClient, locationId: string | null) {
  if (!locationId) return null;
  const { data } = await admin
    .from("locations")
    .select("id, name, address, city, state, postal_code, latitude, longitude")
    .eq("id", locationId)
    .is("archived_at", null)
    .is("trashed_at", null)
    .maybeSingle();
  return (data as { id: string; name: string; address: string | null; city: string | null; state: string | null; postal_code: string | null; latitude: number | null; longitude: number | null } | null) ?? null;
}

export async function persistEventImport(input: NormalizedImport, deps: PersistDeps): Promise<EventImportOutcome> {
  return input.intent === "hosting" ? persistHosting(input, deps) : persistParticipating(input, deps);
}

async function persistParticipating(input: NormalizedImport, deps: PersistDeps): Promise<EventImportOutcome> {
  const { admin, businessId } = deps;
  const scheduleHref = `${businessHome(businessId)}?tab=findmi-here`;

  if (input.useEventId) {
    const result = await deps.applyToEvent(input.useEventId);
    if (result === "unavailable") return { ok: false, error: "That Findmi Event is no longer available. Import it as a new item instead." };
    if (result === "already_approved") return { ok: true, kind: "already", title: input.title, viewHref: scheduleHref };
    if (result === "approved_now") return { ok: true, kind: "scheduled", title: input.title, viewHref: scheduleHref };
    return { ok: true, kind: "requested", title: input.title, viewHref: scheduleHref };
  }

  const location = await venueFromLocation(admin, input.useLocationId);
  const venue = location
    ? { venue_name: location.name, address: location.address, city: location.city, state: location.state }
    : { venue_name: input.venue.name, address: input.venue.address, city: input.venue.city, state: input.venue.state };
  let geography: { market_id: string | null; market_area_id: string | null } = { market_id: null, market_area_id: null };
  if (!location) {
    const text = [venue.city, venue.state].filter(Boolean).join(", ");
    const match = text ? await deps.geography(text) : null;
    if (match) geography = { market_id: match.marketId, market_area_id: match.areaId };
  }

  // Never add a second copy of a date already on this Business's schedule.
  const { data: existing } = await admin
    .from("appearances")
    .select("start_at, title")
    .eq("business_id", businessId)
    .neq("status", "canceled")
    .in(
      "start_at",
      input.dates.map((d) => d.start)
    );
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const taken = new Set(((existing ?? []) as { start_at: string; title: string }[]).filter((r) => norm(r.title) === norm(input.title)).map((r) => new Date(r.start_at).toISOString()));
  const toAdd = input.dates.filter((d) => !taken.has(new Date(d.start).toISOString()));
  if (toAdd.length === 0) return { ok: true, kind: "already", title: input.title, viewHref: scheduleHref };

  const flyer = input.imageUrl ? await deps.storeImage(input.imageUrl) : null;
  const { error } = await admin.from("appearances").insert(
    toAdd.map((d) => ({
      business_id: businessId,
      status: "confirmed",
      title: input.title,
      start_at: d.start,
      end_at: d.end,
      ...venue,
      location_id: location?.id ?? null,
      external_url: input.sourceUrl,
      flyer_image_url: flyer,
      ...geography,
      // Business-entered standalone schedule item (the existing provenance
      // value for Where I'll Be items not linked to a Findmi Event).
      source: "manual",
    }))
  );
  if (error) return { ok: false, error: "Couldn't add it to your schedule. Please try again." };
  return { ok: true, kind: "scheduled", title: input.title, viewHref: scheduleHref };
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
  const first = input.dates[0];
  const last = input.dates[input.dates.length - 1];

  const location = await venueFromLocation(admin, input.useLocationId);
  const geoText = [location?.city ?? input.venue.city, location?.state ?? input.venue.state].filter(Boolean).join(", ");
  const geo = geoText ? await deps.geography(geoText) : null;

  const { data: created, error } = await admin.rpc("create_owned_event", {
    p_user_id: deps.userId,
    p_name: input.title,
    p_slug: slug,
    p_start_at: first.start,
    p_end_at: last.end,
    p_market_id: geo?.marketId ?? null,
    p_requested_market_text: null,
    p_host_business_id: businessId,
  });
  if (error || !created) return { ok: false, error: "Couldn't create your Event. Please try again." };
  const eventId = (created as { id: string }).id;

  const cover = input.imageUrl ? await deps.storeImage(input.imageUrl) : null;
  const venueSnapshot = location
    ? { venue_name: location.name, address: location.address, city: location.city, state: location.state, postal_code: location.postal_code, latitude: location.latitude, longitude: location.longitude }
    : { venue_name: input.venue.name, address: input.venue.address, city: input.venue.city, state: input.venue.state, postal_code: input.venue.postalCode };
  // Best-effort detail fill — the Event already exists either way.
  await admin
    .from("events")
    .update({
      ...venueSnapshot,
      description: input.description,
      external_url: input.sourceUrl,
      ...(cover ? { cover_image_url: cover } : {}),
      ...(geo?.areaId ? { market_area_id: geo.areaId } : {}),
    })
    .eq("id", eventId);

  // Dates: one Event Occurrence per date when there are several, or when a
  // real Location was chosen (the same seeded-occurrence shape Host an
  // Event's manual form uses for a Location).
  if (input.dates.length > 1 || location) {
    const { data: occs } = await admin
      .from("event_occurrences")
      .insert(
        input.dates.map((d) => ({
          event_id: eventId,
          start_at: d.start,
          end_at: d.end,
          location_id: location?.id ?? null,
          venue_name: venueSnapshot.venue_name,
          address: venueSnapshot.address,
          city: venueSnapshot.city,
          state: venueSnapshot.state,
          postal_code: venueSnapshot.postal_code,
        }))
      )
      .select("id");
    const ids = ((occs ?? []) as { id: string }[]).map((o) => o.id);
    if (ids.length) await deps.propagateDates(eventId, ids);
  }

  await deps.notifyNewEvent(eventId, input.title, first.start);
  return { ok: true, kind: "scheduled", title: input.title, viewHref: `/account/event/${eventId}?business_id=${encodeURIComponent(businessId)}` };
}
