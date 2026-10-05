import { getSupabase } from "@/lib/supabase";
import { isoToLocalDateTime } from "@/lib/admin/form-helpers";
import { getBusinessesForEvent, getAllOccurrencesForEvent, findLocationByExactVenue } from "@/lib/data";
import type { FindmiEvent } from "@/lib/types";
import { resolveAppearanceHostBusiness, resolveCanonicalHostBusiness } from "./EventPublicView";

// Moments V2 — Event → Add Moment is a PREFILL for a brand-new Moment
// (/my-world/journal/new?event=<id>), never "reopen my latest Moment for
// this Event" (the previous create-or-resume behavior, which silently
// reopened even a published Moment). This module only RESOLVES the
// deterministic, removable context that new Moment starts with; it never
// writes anything. Server-only (imported by the new-Moment page).
//
// Same determinism rules as before:
//   - an occurrence is only prefilled when the Event has exactly ONE real
//     occurrence (past included — Moments document things that already
//     happened); with 2+ the composer asks "Which date was this?" instead
//     of guessing;
//   - the Location comes from that occurrence, else from any occurrence
//     with a Location, else from an exact venue match;
//   - a host Business is only prefilled when unambiguous: the canonical
//     host (events.host_business_id), else a featured participant, else an
//     Appearance host, else the single participant.
// Anything prefilled is only offered when it's actually connectable
// (non-demo; Businesses live) so saving never rejects it.

export interface EventMomentPrefill {
  occurrence: {
    id: string;
    event_id: string;
    start_at: string;
    end_at: string;
    timezone: string;
    location_id: string | null;
    localDate: string;
    localTime: string;
  } | null;
  location: { value: string; label: string; sublabel?: string; image_url: string | null } | null;
  hostBusiness: { value: string; label: string; image_url: string | null } | null;
}

export async function resolveEventMomentPrefill(
  event: Pick<FindmiEvent, "id" | "venue_name" | "address"> & { host_business_id?: string | null }
): Promise<EventMomentPrefill> {
  const [occurrences, businesses, matchedLocation, appearanceHost, canonicalHost] = await Promise.all([
    getAllOccurrencesForEvent(event.id),
    getBusinessesForEvent(event.id),
    event.venue_name ? findLocationByExactVenue(event.venue_name, event.address) : Promise.resolve(null),
    resolveAppearanceHostBusiness(event.id),
    resolveCanonicalHostBusiness(event.host_business_id),
  ]);

  const single = occurrences.length === 1 ? occurrences[0] : null;
  const occurrenceLocation = single?.location ?? occurrences.find((o) => o.location)?.location ?? null;
  const locationCandidate = occurrenceLocation
    ? { id: occurrenceLocation.id, name: occurrenceLocation.name, city: occurrenceLocation.city, state: occurrenceLocation.state, image: occurrenceLocation.logo_url ?? occurrenceLocation.cover_image_url }
    : matchedLocation
      ? { id: matchedLocation.id, name: matchedLocation.name, city: matchedLocation.city, state: matchedLocation.state, image: matchedLocation.logo_url ?? matchedLocation.cover_image_url }
      : null;

  const hostCandidate =
    canonicalHost ??
    businesses.find((b) => b.featured) ??
    appearanceHost ??
    (businesses.length === 1 ? businesses[0] : null);

  const [locationOk, hostOk] = await Promise.all([
    locationCandidate ? isPublicLocation(locationCandidate.id) : Promise.resolve(false),
    hostCandidate ? isLiveBusiness(hostCandidate.id) : Promise.resolve(false),
  ]);

  return {
    occurrence: single
      ? {
          id: single.id,
          event_id: single.event_id,
          start_at: single.start_at,
          end_at: single.end_at,
          timezone: single.timezone,
          location_id: single.location_id ?? null,
          localDate: isoToLocalDateTime(single.start_at, single.timezone).slice(0, 10),
          localTime: isoToLocalDateTime(single.start_at, single.timezone).slice(11, 16),
        }
      : null,
    location:
      locationCandidate && locationOk
        ? {
            value: locationCandidate.id,
            label: locationCandidate.name,
            sublabel: [locationCandidate.city, locationCandidate.state].filter(Boolean).join(", ") || undefined,
            image_url: locationCandidate.image ?? null,
          }
        : null,
    hostBusiness: hostCandidate && hostOk ? { value: hostCandidate.id, label: hostCandidate.name, image_url: hostCandidate.logo_url ?? null } : null,
  };
}

async function isPublicLocation(id: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { data } = await supabase.from("locations").select("id").eq("id", id).eq("is_demo", false).maybeSingle();
  return Boolean(data);
}

async function isLiveBusiness(id: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { data } = await supabase.from("businesses").select("id").eq("id", id).eq("is_demo", false).eq("publication_status", "live").maybeSingle();
  return Boolean(data);
}
