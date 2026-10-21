// QR Campaigns V2 — Foundation (Pass 1). Backend primitives only; no UI.
// See supabase/migrations/20260930000100_qr_campaigns_v2_foundation.sql
// for the schema this file assumes.
//
// Core principle: QR ATTRIBUTION CONTEXT (business_id/appearance_id/
// event_id/event_occurrence_id/location_id/product_id — the physical
// "where/what this code was printed for") IS INDEPENDENT FROM QR REDIRECT
// DESTINATION (destination_type/destination_id/destination_url, or the
// legacy destination_path). Nothing in this file ever requires context
// to equal destination.
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateCustomDestination } from "./navigation";
import { isSafeQrDestinationPath } from "./analytics/qrCode";

export const QR_CAMPAIGN_STATUSES = ["active", "paused", "archived"] as const;
export type QrCampaignStatus = (typeof QR_CAMPAIGN_STATUSES)[number];

export const QR_DESTINATION_TYPES = ["business", "product", "event", "location", "custom"] as const;
export type QrDestinationType = (typeof QR_DESTINATION_TYPES)[number];

export interface QrCampaignDestinationFields {
  destination_type: QrDestinationType | null;
  destination_id: string | null;
  destination_url: string | null;
  /** Legacy — every pre-V2 campaign only ever set this. Still the
   * fallback whenever the structured fields above are null; never
   * required to be converted. */
  destination_path: string;
}

/**
 * Resolves ONE campaign's actual redirect target: the structured V2
 * fields when present, falling back to the legacy destination_path
 * otherwise. Returns null when nothing safe can be resolved — never a
 * half-built or unsafe URL. Callers (see /q/[code]'s route) fail safe to
 * their own fallback destination rather than trusting a null through.
 *
 * Re-validates even the legacy path and the stored custom URL at resolve
 * time (never trusts previously-stored data blindly) — same discipline
 * every other stored-then-redisplayed destination in this codebase
 * already follows (e.g. AppearanceQuickView re-validating
 * appearance.external_url via this same validateCustomDestination).
 */
export async function resolveQrDestination(
  supabase: SupabaseClient,
  campaign: QrCampaignDestinationFields
): Promise<string | null> {
  if (!campaign.destination_type) {
    return isSafeQrDestinationPath(campaign.destination_path) ? campaign.destination_path : null;
  }

  if (campaign.destination_type === "custom") {
    if (!campaign.destination_url) return null;
    const validated = validateCustomDestination(campaign.destination_url);
    return validated.ok ? validated.value : null;
  }

  if (!campaign.destination_id) return null;

  if (campaign.destination_type === "business") {
    const { data } = await supabase.from("businesses").select("slug").eq("id", campaign.destination_id).maybeSingle();
    return data?.slug ? `/business/${data.slug}` : null;
  }
  if (campaign.destination_type === "product") {
    const { data } = await supabase.from("products").select("slug").eq("id", campaign.destination_id).maybeSingle();
    return data?.slug ? `/product/${data.slug}` : null;
  }
  if (campaign.destination_type === "event") {
    const { data } = await supabase.from("events").select("slug").eq("id", campaign.destination_id).maybeSingle();
    return data?.slug ? `/event/${data.slug}` : null;
  }
  if (campaign.destination_type === "location") {
    const { data } = await supabase.from("locations").select("slug").eq("id", campaign.destination_id).maybeSingle();
    return data?.slug ? `/location/${data.slug}` : null;
  }
  return null;
}

export interface QrAppearanceDerivedContext {
  businessId: string | null;
  appearanceId: string;
  eventId: string | null;
  eventOccurrenceId: string | null;
  locationId: string | null;
}

/**
 * Derives the real, already-existing relationships for one Appearance —
 * so creating a QR "for" an Appearance can pre-fill business/event/
 * occurrence/location context instead of asking the creator to re-supply
 * what Findmi already knows. Tolerant of any relationship being null (a
 * standalone Appearance has no Event/occurrence at all); never fabricates
 * a relationship that isn't really there. Product is deliberately not
 * derived here — it stays optional, separately-chosen context (an
 * Appearance has no product of its own).
 */
export async function deriveQrContextFromAppearance(
  supabase: SupabaseClient,
  appearanceId: string
): Promise<QrAppearanceDerivedContext | null> {
  const { data } = await supabase
    .from("appearances")
    .select("id, business_id, event_id, event_occurrence_id, location_id")
    .eq("id", appearanceId)
    .maybeSingle();
  if (!data) return null;
  return {
    businessId: data.business_id,
    appearanceId: data.id,
    eventId: data.event_id,
    eventOccurrenceId: data.event_occurrence_id,
    locationId: data.location_id,
  };
}

export interface QrEligibleEntity {
  id: string;
  name: string;
}

/**
 * Events legitimately associated with `businessId` — approved
 * event/occurrence participation (event_businesses / event_occurrence_
 * businesses, status='approved', the same "approved" bar the rest of the
 * app already uses for real participation) PLUS any Event this Business
 * has a real, non-canceled Appearance at. This answers only "does this
 * Business legitimately show up at this Event" — it is independent of
 * (and additive to) whichever user happens to be asking; a caller that
 * also wants the user's own direct event_members ownership combines that
 * separately (see account/business/[id]/page.tsx). Three small, batched
 * queries — never one query per event.
 */
export async function getBusinessQrEligibleEvents(
  supabase: SupabaseClient,
  businessId: string
): Promise<QrEligibleEntity[]> {
  const [{ data: direct }, { data: occRows }, { data: appearanceRows }] = await Promise.all([
    supabase.from("event_businesses").select("event_id").eq("business_id", businessId).eq("status", "approved"),
    supabase.from("event_occurrence_businesses").select("occurrence_id").eq("business_id", businessId).eq("status", "approved"),
    supabase.from("appearances").select("event_id").eq("business_id", businessId).not("event_id", "is", null).neq("status", "canceled"),
  ]);

  const eventIds = new Set<string>();
  for (const r of (direct ?? []) as { event_id: string | null }[]) if (r.event_id) eventIds.add(r.event_id);
  for (const r of (appearanceRows ?? []) as { event_id: string | null }[]) if (r.event_id) eventIds.add(r.event_id);

  const occurrenceIds = ((occRows ?? []) as { occurrence_id: string | null }[])
    .map((r) => r.occurrence_id)
    .filter((v): v is string => Boolean(v));
  if (occurrenceIds.length > 0) {
    const { data: occurrences } = await supabase.from("event_occurrences").select("event_id").in("id", occurrenceIds);
    for (const o of (occurrences ?? []) as { event_id: string | null }[]) if (o.event_id) eventIds.add(o.event_id);
  }

  if (eventIds.size === 0) return [];
  const { data: events } = await supabase.from("events").select("id, name").in("id", Array.from(eventIds));
  return ((events ?? []) as QrEligibleEntity[]).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Locations legitimately associated with `businessId` — everywhere this
 * Business has a real, non-canceled Appearance (appearances.location_id)
 * PLUS everywhere it participates (approved) in an occurrence that's
 * physically held at a Location (event_occurrence_businesses ->
 * event_occurrences.location_id). Same additive relationship to direct
 * location_members ownership as getBusinessQrEligibleEvents above.
 */
export async function getBusinessQrEligibleLocations(
  supabase: SupabaseClient,
  businessId: string
): Promise<QrEligibleEntity[]> {
  const [{ data: appearanceRows }, { data: occRows }] = await Promise.all([
    supabase.from("appearances").select("location_id").eq("business_id", businessId).not("location_id", "is", null).neq("status", "canceled"),
    supabase.from("event_occurrence_businesses").select("occurrence_id").eq("business_id", businessId).eq("status", "approved"),
  ]);

  const locationIds = new Set<string>();
  for (const r of (appearanceRows ?? []) as { location_id: string | null }[]) if (r.location_id) locationIds.add(r.location_id);

  const occurrenceIds = ((occRows ?? []) as { occurrence_id: string | null }[])
    .map((r) => r.occurrence_id)
    .filter((v): v is string => Boolean(v));
  if (occurrenceIds.length > 0) {
    const { data: occurrences } = await supabase.from("event_occurrences").select("location_id").in("id", occurrenceIds);
    for (const o of (occurrences ?? []) as { location_id: string | null }[]) if (o.location_id) locationIds.add(o.location_id);
  }

  if (locationIds.size === 0) return [];
  const { data: locations } = await supabase.from("locations").select("id, name").in("id", Array.from(locationIds));
  return ((locations ?? []) as QrEligibleEntity[]).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Which scheduled dates (event_occurrences) of an Event this Business may
 * scope a QR code to — the "Specific Occurrence" choice. Stricter than the
 * Event-level eligibility above, on purpose:
 *   - approved Event participation that is not `selected_dates` (all_dates, or
 *     legacy null) → every date of that Event;
 *   - a non-canceled Appearance at the Event with no specific date → every date;
 *   - otherwise only the dates it is approved for (event_occurrence_businesses,
 *     status 'approved') or has an Appearance on.
 * Pure over already-loaded rows so the creator's options and the server action
 * apply the identical rule.
 */
export interface QrOccurrenceAuthorityInput {
  occurrences: { id: string }[];
  /** This Business's event_businesses row for the Event, when approved. */
  eventLevel: { participation_scope: string | null } | null;
  /** This Business's non-canceled Appearances at the Event. */
  appearances: { event_occurrence_id: string | null }[];
  /** event_occurrence_businesses occurrence ids approved for this Business. */
  approvedOccurrenceIds: ReadonlySet<string>;
}

export function allowedQrOccurrenceIds(input: QrOccurrenceAuthorityInput): Set<string> {
  const all = new Set(input.occurrences.map((o) => o.id));
  if (input.eventLevel && input.eventLevel.participation_scope !== "selected_dates") return all;
  if (input.appearances.some((a) => !a.event_occurrence_id)) return all;
  const allowed = new Set<string>();
  for (const a of input.appearances) if (a.event_occurrence_id && all.has(a.event_occurrence_id)) allowed.add(a.event_occurrence_id);
  for (const id of input.approvedOccurrenceIds) if (all.has(id)) allowed.add(id);
  return allowed;
}

/** Loads the rows allowedQrOccurrenceIds needs for MANY Events in four
 * batched reads (never per Event) and returns each Event's allowed set. */
export async function getBusinessQrAllowedOccurrences(
  supabase: SupabaseClient,
  businessId: string,
  occurrencesByEvent: Map<string, { id: string }[]>
): Promise<Map<string, Set<string>>> {
  const eventIds = [...occurrencesByEvent.keys()];
  const result = new Map<string, Set<string>>();
  if (eventIds.length === 0) return result;
  const allOccurrenceIds = [...occurrencesByEvent.values()].flat().map((o) => o.id);
  const [{ data: levels }, { data: appearances }, { data: approved }] = await Promise.all([
    supabase.from("event_businesses").select("event_id, participation_scope").eq("business_id", businessId).eq("status", "approved").in("event_id", eventIds),
    supabase.from("appearances").select("event_id, event_occurrence_id").eq("business_id", businessId).neq("status", "canceled").in("event_id", eventIds),
    allOccurrenceIds.length
      ? supabase.from("event_occurrence_businesses").select("occurrence_id").eq("business_id", businessId).eq("status", "approved").in("occurrence_id", allOccurrenceIds)
      : Promise.resolve({ data: [] as { occurrence_id: string }[] }),
  ]);
  const levelByEvent = new Map(((levels ?? []) as { event_id: string; participation_scope: string | null }[]).map((r) => [r.event_id, r]));
  const apps = (appearances ?? []) as { event_id: string; event_occurrence_id: string | null }[];
  const approvedIds = new Set(((approved ?? []) as { occurrence_id: string }[]).map((r) => r.occurrence_id));
  for (const [eventId, occurrences] of occurrencesByEvent) {
    result.set(
      eventId,
      allowedQrOccurrenceIds({
        occurrences,
        eventLevel: levelByEvent.get(eventId) ?? null,
        appearances: apps.filter((a) => a.event_id === eventId),
        approvedOccurrenceIds: approvedIds,
      })
    );
  }
  return result;
}
