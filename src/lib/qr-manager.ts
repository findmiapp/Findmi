// QR Campaigns V2 — Pass 2 read layer for the owner-facing Campaign
// Manager. Builds on the Pass 1 foundation (lib/qr-v2.ts) — reuses
// getBusinessQrEligibleEvents/Locations verbatim rather than
// reimplementing participation rules, and never re-derives lifecycle or
// destination-safety logic that already lives there.
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDateShort } from "./format";
import { getBusinessQrAllowedOccurrences, getBusinessQrEligibleEvents, getBusinessQrEligibleLocations, type QrCampaignStatus, type QrDestinationType } from "./qr-v2";

export interface QrCampaignSummary {
  id: string;
  name: string;
  code: string;
  status: QrCampaignStatus;
  placement: string | null;
  createdAt: string;
  scans: number;
  /** "What is this QR for" — a human-readable attribution summary. */
  contextSummary: string;
  /** "Where does it send people" — a human-readable destination summary. */
  destinationSummary: string;
  destinationType: QrDestinationType | null;
  destinationId: string | null;
  destinationUrl: string | null;
  destinationPath: string;
  appearanceId: string | null;
  eventId: string | null;
  eventOccurrenceId: string | null;
  locationId: string | null;
  productId: string | null;
}

function describeLegacyDestinationPath(path: string): string {
  if (path.startsWith("/business/")) return path.includes("#") ? "Business profile (Findmi Here)" : "Business profile";
  if (path.startsWith("/product/")) return "Product page";
  if (path.startsWith("/event/")) return "Event page";
  if (path.startsWith("/location/")) return "Location page";
  return path;
}

interface RawCampaignRow {
  id: string;
  name: string;
  code: string;
  status: QrCampaignStatus;
  placement: string | null;
  destination_path: string;
  destination_type: QrDestinationType | null;
  destination_id: string | null;
  destination_url: string | null;
  appearance_id: string | null;
  event_id: string | null;
  event_occurrence_id: string | null;
  location_id: string | null;
  product_id: string | null;
  created_at: string;
}

/**
 * Every QR campaign this Business owns (its own qr_campaigns.business_id
 * — Business/Appearance/Product/Event/Location destinations alike, since
 * the Intelligent Creator always stamps business_id as context regardless
 * of which entity type the campaign is "for"). Batches all label lookups
 * (context AND destination alike, which can reference different entities
 * entirely — that independence is the whole point) into a handful of
 * `.in()` queries, never one query per campaign.
 */
export async function getBusinessQrCampaigns(admin: SupabaseClient, businessId: string): Promise<QrCampaignSummary[]> {
  const { data: rows } = await admin
    .from("qr_campaigns")
    .select(
      "id, name, code, status, placement, destination_path, destination_type, destination_id, destination_url, appearance_id, event_id, event_occurrence_id, location_id, product_id, created_at"
    )
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  const campaigns = (rows ?? []) as RawCampaignRow[];
  if (campaigns.length === 0) return [];

  const appearanceIds = new Set<string>();
  const eventIds = new Set<string>();
  const occurrenceIds = new Set<string>();
  const locationIds = new Set<string>();
  const productIds = new Set<string>();
  const businessIds = new Set<string>();
  for (const c of campaigns) {
    if (c.appearance_id) appearanceIds.add(c.appearance_id);
    if (c.event_id) eventIds.add(c.event_id);
    if (c.event_occurrence_id) occurrenceIds.add(c.event_occurrence_id);
    if (c.location_id) locationIds.add(c.location_id);
    if (c.product_id) productIds.add(c.product_id);
    if (c.destination_type === "business" && c.destination_id) businessIds.add(c.destination_id);
    if (c.destination_type === "product" && c.destination_id) productIds.add(c.destination_id);
    if (c.destination_type === "event" && c.destination_id) eventIds.add(c.destination_id);
    if (c.destination_type === "location" && c.destination_id) locationIds.add(c.destination_id);
  }

  const [appearanceRes, eventRes, occurrenceRes, locationRes, productRes, businessRes, scanRes] = await Promise.all([
    appearanceIds.size
      ? admin.from("appearances").select("id, title, start_at, venue_name, location_id").in("id", Array.from(appearanceIds))
      : Promise.resolve({ data: [] }),
    eventIds.size ? admin.from("events").select("id, name").in("id", Array.from(eventIds)) : Promise.resolve({ data: [] }),
    occurrenceIds.size ? admin.from("event_occurrences").select("id, start_at").in("id", Array.from(occurrenceIds)) : Promise.resolve({ data: [] }),
    locationIds.size ? admin.from("locations").select("id, name").in("id", Array.from(locationIds)) : Promise.resolve({ data: [] }),
    productIds.size ? admin.from("products").select("id, name").in("id", Array.from(productIds)) : Promise.resolve({ data: [] }),
    businessIds.size ? admin.from("businesses").select("id, name").in("id", Array.from(businessIds)) : Promise.resolve({ data: [] }),
    admin
      .from("analytics_events")
      .select("qr_campaign_id")
      .eq("event_name", "qr_scan")
      .in(
        "qr_campaign_id",
        campaigns.map((c) => c.id)
      ),
  ]);

  const appearanceMap = new Map(
    ((appearanceRes.data ?? []) as { id: string; title: string; start_at: string; venue_name: string | null; location_id: string | null }[]).map(
      (a) => [a.id, a]
    )
  );
  const eventMap = new Map(((eventRes.data ?? []) as { id: string; name: string }[]).map((e) => [e.id, e]));
  const occurrenceMap = new Map(((occurrenceRes.data ?? []) as { id: string; start_at: string }[]).map((o) => [o.id, o]));
  const locationMap = new Map(((locationRes.data ?? []) as { id: string; name: string }[]).map((l) => [l.id, l]));
  const productMap = new Map(((productRes.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p]));
  const businessMap = new Map(((businessRes.data ?? []) as { id: string; name: string }[]).map((b) => [b.id, b]));

  const scanCounts = new Map<string, number>();
  for (const r of (scanRes.data ?? []) as { qr_campaign_id: string | null }[]) {
    if (!r.qr_campaign_id) continue;
    scanCounts.set(r.qr_campaign_id, (scanCounts.get(r.qr_campaign_id) ?? 0) + 1);
  }

  return campaigns.map((c) => {
    let contextSummary = "General — this Business";
    if (c.appearance_id) {
      const a = appearanceMap.get(c.appearance_id);
      if (a) {
        const loc = a.location_id ? locationMap.get(a.location_id) : null;
        contextSummary = [a.title, formatDateShort(a.start_at), loc?.name ?? a.venue_name].filter(Boolean).join(" · ");
      } else {
        contextSummary = "Appearance";
      }
    } else if (c.product_id) {
      contextSummary = productMap.get(c.product_id)?.name ?? "Product";
    } else if (c.event_id) {
      const e = eventMap.get(c.event_id);
      const occ = c.event_occurrence_id ? occurrenceMap.get(c.event_occurrence_id) : null;
      // A QR scoped to one occurrence names its date; one for the Entire
      // Event says so (event_occurrence_id null = every date).
      contextSummary = [e?.name ?? "Event", occ ? formatDateShort(occ.start_at) : "All Dates"].filter(Boolean).join(" · ");
    } else if (c.location_id) {
      contextSummary = locationMap.get(c.location_id)?.name ?? "Location";
    }

    let destinationSummary = "Custom link";
    if (c.destination_type === "business") destinationSummary = `${businessMap.get(c.destination_id ?? "")?.name ?? "Business"} on Findmi`;
    else if (c.destination_type === "product") destinationSummary = productMap.get(c.destination_id ?? "")?.name ?? "Product page";
    else if (c.destination_type === "event") destinationSummary = eventMap.get(c.destination_id ?? "")?.name ?? "Event page";
    else if (c.destination_type === "location") destinationSummary = locationMap.get(c.destination_id ?? "")?.name ?? "Location page";
    else if (c.destination_type === "custom") destinationSummary = c.destination_url ?? "Custom link";
    else destinationSummary = describeLegacyDestinationPath(c.destination_path);

    return {
      id: c.id,
      name: c.name,
      code: c.code,
      status: c.status,
      placement: c.placement,
      createdAt: c.created_at,
      scans: scanCounts.get(c.id) ?? 0,
      contextSummary,
      destinationSummary,
      destinationType: c.destination_type,
      destinationId: c.destination_id,
      destinationUrl: c.destination_url,
      destinationPath: c.destination_path,
      appearanceId: c.appearance_id,
      eventId: c.event_id,
      eventOccurrenceId: c.event_occurrence_id,
      locationId: c.location_id,
      productId: c.product_id,
    };
  });
}

/** One scheduled date of an Event, for the creator's "Specific Occurrence"
 * choice. `label` carries date + time; `place` the occurrence's Location. */
export interface QrOccurrenceOption {
  id: string;
  startAt: string;
  label: string;
  place: string | null;
}

export interface QrCreatorOption {
  id: string;
  label: string;
  /** Secondary line for pickers (an Event's next date / date count). */
  meta?: string | null;
  /** Event options only — every scheduled occurrence, soonest first. */
  occurrences?: QrOccurrenceOption[];
  /** Appearance options only — lets the Intelligent Creator default the
   * DESTINATION to this Appearance's real linked Event when one exists
   * (per the "smart default" spec), without re-deriving eligibility
   * client-side. Every other option array omits this. */
  eventId?: string | null;
}

export interface QrCreatorOptions {
  appearances: QrCreatorOption[];
  products: QrCreatorOption[];
  events: QrCreatorOption[];
  locations: QrCreatorOption[];
}

/** Appearance labels disambiguated by date + place — same spirit as
 * business/[id]/page.tsx's own buildAppearanceQrLabel (kept as a small,
 * independent, presentation-only helper here rather than importing from
 * a page file). */
function buildAppearanceLabel(a: { title: string; start_at: string; venue_name: string | null; locationName: string | null }): string {
  const date = formatDateShort(a.start_at);
  const place = a.locationName ?? a.venue_name;
  return [a.title, date, place].filter(Boolean).join(" · ");
}

/**
 * Every option the Intelligent Creator's Step 1 (What is this QR for?)
 * needs, business-scoped: Appearances/Products owned outright by this
 * Business, and Events/Locations via the Foundation's business-aware
 * eligibility helpers (never event_members/location_members alone).
 */
export async function getBusinessQrCreatorOptions(admin: SupabaseClient, businessId: string): Promise<QrCreatorOptions> {
  const [appearanceRes, productRes, events, locations] = await Promise.all([
    admin
      .from("appearances")
      .select("id, title, start_at, venue_name, location_id, event_id")
      .eq("business_id", businessId)
      .neq("status", "canceled")
      .order("start_at", { ascending: false })
      .limit(50),
    admin.from("products").select("id, name").eq("business_id", businessId).eq("is_active", true).is("archived_at", null).is("trashed_at", null).order("name"),
    getBusinessQrEligibleEvents(admin, businessId),
    getBusinessQrEligibleLocations(admin, businessId),
  ]);

  const appearanceRows = (appearanceRes.data ?? []) as {
    id: string;
    title: string;
    start_at: string;
    venue_name: string | null;
    location_id: string | null;
    event_id: string | null;
  }[];
  const locationIds = appearanceRows.map((a) => a.location_id).filter((v): v is string => Boolean(v));
  const { data: appearanceLocations } =
    locationIds.length > 0
      ? await admin.from("locations").select("id, name").in("id", locationIds)
      : { data: [] as { id: string; name: string }[] };
  const appearanceLocationMap = new Map((appearanceLocations ?? []).map((l) => [l.id, l.name]));

  // Event occurrences — one batched read for every eligible Event (never one
  // query per Event), with each occurrence's Location name resolved in one
  // more batched read.
  const eligibleEventIds = events.map((e) => e.id);
  const { data: occurrenceRows } = eligibleEventIds.length
    ? await admin
        .from("event_occurrences")
        .select("id, event_id, start_at, location_id, status")
        .in("event_id", eligibleEventIds)
        .neq("status", "cancelled")
        .order("start_at", { ascending: true })
    : { data: [] as { id: string; event_id: string; start_at: string; location_id: string | null; status: string }[] };
  const occRows = (occurrenceRows ?? []) as { id: string; event_id: string; start_at: string; location_id: string | null }[];
  const occLocationIds = [...new Set(occRows.map((o) => o.location_id).filter((v): v is string => Boolean(v)))];
  const { data: occLocations } = occLocationIds.length
    ? await admin.from("locations").select("id, name").in("id", occLocationIds)
    : { data: [] as { id: string; name: string }[] };
  const occLocationMap = new Map((occLocations ?? []).map((l) => [l.id, l.name]));
  // Only the dates this Business may scope a QR to (see allowedQrOccurrenceIds).
  const rawByEvent = new Map<string, { id: string }[]>(eligibleEventIds.map((id) => [id, occRows.filter((o) => o.event_id === id).map((o) => ({ id: o.id }))]));
  const allowedByEvent = await getBusinessQrAllowedOccurrences(admin, businessId, rawByEvent);
  const occurrencesByEvent = new Map<string, QrOccurrenceOption[]>();
  for (const o of occRows) {
    if (!allowedByEvent.get(o.event_id)?.has(o.id)) continue;
    const list = occurrencesByEvent.get(o.event_id) ?? [];
    list.push({
      id: o.id,
      startAt: o.start_at,
      label: formatDateShort(o.start_at),
      place: o.location_id ? (occLocationMap.get(o.location_id) ?? null) : null,
    });
    occurrencesByEvent.set(o.event_id, list);
  }

  return {
    appearances: appearanceRows.map((a) => ({
      id: a.id,
      label: buildAppearanceLabel({ ...a, locationName: a.location_id ? (appearanceLocationMap.get(a.location_id) ?? null) : null }),
      eventId: a.event_id,
    })),
    products: ((productRes.data ?? []) as { id: string; name: string }[]).map((p) => ({ id: p.id, label: p.name })),
    events: events.map((e) => {
      const occurrences = occurrencesByEvent.get(e.id) ?? [];
      return {
        id: e.id,
        label: e.name,
        occurrences,
        meta: occurrences.length === 0 ? null : occurrences.length === 1 ? occurrences[0].label : `${occurrences.length} dates · from ${occurrences[0].label}`,
      };
    }),
    locations: locations.map((l) => ({ id: l.id, label: l.name })),
  };
}
