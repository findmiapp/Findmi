// QR Campaigns V1 — shared, entity-agnostic data access for ONE QR
// campaign's own detail view (src/app/(public)/account/qr/[id]/page.tsx).
// Deliberately separate from ownerPerformance.ts (which aggregates an
// entire Business's Performance tab, Pro-gated) — this reads a single
// campaign by id so it can be reached and reopened regardless of plan
// tier (see qr-actions.ts's own doc comment on Free vs Pro). Reuses the
// exact same analytics_events query shape and action-breakdown vocabulary
// ownerPerformance.ts already established (buildQrActionBreakdown) rather
// than a second, parallel QR-attribution implementation.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildQrActionBreakdown, OWNER_ACTION_EVENT_NAMES, type OwnerPerformanceBreakdownItem } from "./ownerPerformance";

export interface QrCampaignRow {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  placement: string | null;
  destination_path: string;
  business_id: string | null;
  appearance_id: string | null;
  product_id: string | null;
  event_id: string | null;
  location_id: string | null;
}

export interface QrCampaignStats {
  scans: number;
  uniqueVisitors: number;
  actions: number;
  actionBreakdown: OwnerPerformanceBreakdownItem[];
}

export type QrDestinationType = "business" | "appearance" | "product" | "event" | "location";

/** Call ONLY after the page has already authorized the viewer against
 * whichever relationship column this row populates (business_id ->
 * requireBusinessMember, event_id -> requireEventMember, location_id ->
 * requireLocationMember) — this does no authorization of its own, same
 * convention as ownerPerformance.ts. */
export async function getQrCampaignRow(admin: SupabaseClient, campaignId: string): Promise<QrCampaignRow | null> {
  const { data } = await admin
    .from("qr_campaigns")
    .select("id, name, code, is_active, placement, destination_path, business_id, appearance_id, product_id, event_id, location_id")
    .eq("id", campaignId)
    .maybeSingle();
  return (data as QrCampaignRow | null) ?? null;
}

/** All-time totals — the detail view isn't range-boxed like the
 * Performance tab (it's "everything this one QR has ever done," not a
 * trend), same reasoning as the admin QR campaign view. */
export async function getQrCampaignStats(admin: SupabaseClient, campaignId: string): Promise<QrCampaignStats> {
  // Metric Consistency Correction — must use the EXACT same "action"
  // definition as the Business-wide QR Performance aggregate
  // (ownerPerformance.ts's own actionQuery): acquisition_source="qr" AND
  // event_name in OWNER_ACTION_EVENT_NAMES. Previously this only excluded
  // qr_scan by name, so any other event carrying acquisition_qr_campaign_id
  // (e.g. the page_view that lands right after the scan's redirect, which
  // every event in that session gets stamped with for attribution, not
  // because it's itself a meaningful action) was miscounted as an action.
  const [{ data: scanRows }, { data: actionRows }] = await Promise.all([
    admin.from("analytics_events").select("session_id").eq("event_name", "qr_scan").eq("qr_campaign_id", campaignId),
    admin
      .from("analytics_events")
      .select("event_name")
      .eq("acquisition_source", "qr")
      .eq("acquisition_qr_campaign_id", campaignId)
      .in("event_name", [...OWNER_ACTION_EVENT_NAMES]),
  ]);
  const scans = (scanRows ?? []) as { session_id: string }[];
  const actions = (actionRows ?? []) as { event_name: string }[];
  return {
    scans: scans.length,
    uniqueVisitors: new Set(scans.map((r) => r.session_id)).size,
    actions: actions.length,
    actionBreakdown: buildQrActionBreakdown(actions),
  };
}

/** Resolves a human destination type/label for a campaign row, given
 * which relationship column is populated — mirrors the exact precedence
 * src/app/q/[code]/route.ts already uses for its own primary-subject
 * resolution (appearance > event > product > location > business), so
 * "what is this QR fundamentally about" reads the same everywhere this
 * codebase answers that question. */
export async function getQrCampaignDestination(
  admin: SupabaseClient,
  row: QrCampaignRow
): Promise<{ type: QrDestinationType; label: string }> {
  if (row.appearance_id) {
    const { data } = await admin.from("appearances").select("title").eq("id", row.appearance_id).maybeSingle();
    return { type: "appearance", label: data?.title ?? "Appearance" };
  }
  if (row.event_id) {
    const { data } = await admin.from("events").select("name").eq("id", row.event_id).maybeSingle();
    return { type: "event", label: data?.name ?? "Event" };
  }
  if (row.product_id) {
    const { data } = await admin.from("products").select("name").eq("id", row.product_id).maybeSingle();
    return { type: "product", label: data?.name ?? "Product" };
  }
  if (row.location_id) {
    const { data } = await admin.from("locations").select("name").eq("id", row.location_id).maybeSingle();
    return { type: "location", label: data?.name ?? "Location" };
  }
  const { data } = await admin.from("businesses").select("name").eq("id", row.business_id ?? "").maybeSingle();
  return { type: "business", label: data?.name ?? "Business" };
}
