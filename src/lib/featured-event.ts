// Featured Event System — resolves which Event a Business or Location's
// public page should show in its premium Featured Event hero
// (FeaturedEventCard). Two-tier resolution, same shape for both entity
// types:
//
//   1. Manual override (businesses.featured_event_id /
//      locations.featured_event_id) — used only when it's still ELIGIBLE
//      (see the two isEligible* checks below) AND the Event itself is
//      still publicly fetchable. getEventBySlug already runs through the
//      anon client, itself RLS-gated to publicly-visible rows, so a
//      deleted/unpublished/archived override Event simply comes back
//      null here — automatic fallback safety with no extra status check
//      needed.
//   2. Automatic — the nearest live/upcoming Event this Business/Location
//      is already legitimately connected to, reusing the exact same
//      queries (getUpcomingAppearancesForBusiness / getUpcomingAtLocation)
//      their own existing "what's coming up" sections already rely on,
//      never a new, parallel eligibility query.
//
// Never copies the Event's own content onto the Business/Location row —
// only the pointer is stored; every read here re-fetches the real Event.
import { getSupabase } from "./supabase";
import { attachEventCategories, getEventBySlug, getUpcomingAppearancesForBusiness, getUpcomingAtLocation } from "./data";
import { getTemporalLabel } from "./format";
import type { FindmiEvent } from "./types";

export interface ResolvedFeaturedEvent {
  event: FindmiEvent;
  category: string | null;
  attribution: string | null;
  statusLabel: string | null;
  isLive: boolean;
}

async function buildResolved(event: FindmiEvent): Promise<ResolvedFeaturedEvent> {
  const supabase = getSupabase();
  const [[withCategories], attribution, occurrence] = await Promise.all([
    attachEventCategories([event]),
    getFeaturedAttributionBusinessName(event.id),
    // Recurring events' own start_at/end_at can be stale once real
    // occurrences exist — the nearest upcoming occurrence (if any) is the
    // true temporal source, same precedence EventPublicView's own
    // canonicalLocation/status logic uses elsewhere.
    supabase
      ? supabase
          .from("event_occurrences")
          .select("start_at, end_at")
          .eq("event_id", event.id)
          .eq("status", "scheduled")
          .order("start_at", { ascending: true })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const temporalSource = occurrence?.data ?? { start_at: event.start_at, end_at: event.end_at };
  const temporal = getTemporalLabel(temporalSource.start_at, temporalSource.end_at ?? undefined);
  return {
    event,
    category: withCategories.categories[0]?.name ?? null,
    attribution,
    // Never a generic "Upcoming" pill — this codebase's existing
    // convention (HomeEventCard/HappeningCard/BusinessPublicView) only
    // ever surfaces a status pill for the live case.
    statusLabel: temporal.live ? "Happening Now" : null,
    isLive: temporal.live,
  };
}

/** The Event's own featured/primary participating Business — reuses the
 * existing event_businesses.featured column (already used to sub-order
 * "Who You'll Find Here"), never a new ownership relationship invented
 * just for display. */
async function getFeaturedAttributionBusinessName(eventId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("event_businesses")
    .select("display_order, business:businesses(name)")
    .eq("event_id", eventId)
    .eq("status", "approved")
    .eq("featured", true)
    .order("display_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const business = Array.isArray(data.business) ? data.business[0] : data.business;
  return business?.name ?? null;
}

async function isEventEligibleForBusiness(eventId: string, businessId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { data } = await supabase
    .from("event_businesses")
    .select("id")
    .eq("event_id", eventId)
    .eq("business_id", businessId)
    .eq("status", "approved")
    .maybeSingle();
  return Boolean(data);
}

async function isEventEligibleForLocation(eventId: string, locationId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { data } = await supabase
    .from("event_occurrences")
    .select("id")
    .eq("event_id", eventId)
    .eq("location_id", locationId)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

/** businessId + the Business's own featured_event_id (already fetched by
 * the caller's own getBusinessBySlug — never re-queried here). */
export async function resolveFeaturedEventForBusiness(
  businessId: string,
  overrideEventId: string | null
): Promise<ResolvedFeaturedEvent | null> {
  if (overrideEventId) {
    const [eligible, event] = await Promise.all([
      isEventEligibleForBusiness(overrideEventId, businessId),
      getEventBySlugById(overrideEventId),
    ]);
    if (eligible && event) return buildResolved(event);
  }

  // Automatic — nearest live/upcoming Appearance for this Business that's
  // linked to a real Event (getUpcomingAppearancesForBusiness is already
  // ordered start_at ascending: a currently-live appearance's start_at is
  // always earlier than any not-yet-started one's, so "first" already
  // means "prefer live, else nearest upcoming" with no extra sort).
  const appearances = await getUpcomingAppearancesForBusiness(businessId, 20);
  const linked = appearances.find((a) => a.event?.slug);
  if (!linked?.event) return null;
  const event = await getEventBySlug(linked.event.slug);
  if (!event) return null;
  return buildResolved(event);
}

export async function resolveFeaturedEventForLocation(
  location: { id: string; name: string },
  overrideEventId: string | null
): Promise<ResolvedFeaturedEvent | null> {
  if (overrideEventId) {
    const [eligible, event] = await Promise.all([
      isEventEligibleForLocation(overrideEventId, location.id),
      getEventBySlugById(overrideEventId),
    ]);
    if (eligible && event) return buildResolved(event);
  }

  // Automatic — nearest "event"-type LocationHappening (already merges
  // real-occurrence and legacy venue-name-matched events, ordered nearest
  // first exactly like the Business case above).
  const happenings = await getUpcomingAtLocation(location, 20);
  const firstEvent = happenings.find((h) => h.type === "event");
  if (!firstEvent) return null;
  const slug = firstEvent.href.replace(/^\/event\//, "");
  const event = await getEventBySlug(slug);
  if (!event) return null;
  return buildResolved(event);
}

/** getEventBySlug takes a slug, not an id — the override column stores an
 * id (the stable FK target), so this resolves id -> full row directly,
 * same RLS-gated anon read (is_demo/publication filtering happens via
 * RLS itself for events, same as getEventBySlug). */
async function getEventBySlugById(eventId: string): Promise<FindmiEvent | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("events").select("*").eq("id", eventId).eq("is_demo", false).maybeSingle();
  return (data as FindmiEvent | null) ?? null;
}
