// Findmi Analytics — the one qr_scan recorder, shared by /q/[code] (scan
// with Analytics already allowed) and /api/analytics/qr-arrival (scan
// recorded after the visitor allows Analytics on the landing page). Both
// callers MUST have passed isAnalyticsAllowedForRequest() first.
import type { SupabaseClient } from "@supabase/supabase-js";
import { establishQrAcquisitionIfAbsent, resolveSessionId } from "./session";
import { isRateLimited } from "./rateLimit";
import { insertAnalyticsEvent } from "./serverTrack";
import type { QrDestinationType } from "@/lib/qr-v2";

export const QR_CAMPAIGN_SELECT =
  "id, business_id, event_id, event_occurrence_id, appearance_id, location_id, product_id, destination_path, placement, is_active, status, destination_type, destination_id, destination_url";

export interface QrCampaignRow {
  id: string;
  business_id: string | null;
  event_id: string | null;
  event_occurrence_id: string | null;
  appearance_id: string | null;
  location_id: string | null;
  product_id: string | null;
  destination_path: string;
  placement: string | null;
  is_active: boolean;
  /** QR V2 Foundation — status is the forward-looking lifecycle
   * authority (see the migration); is_active is kept in lockstep by
   * every write path (setQrCampaignActive et al.) and is no longer read
   * here, so there is exactly one gate, never two that could disagree. */
  status: string;
  destination_type: QrDestinationType | null;
  destination_id: string | null;
  destination_url: string | null;
}

/** Deterministic primary-subject precedence for a QR scan's own
 * subject_type/subject_id — the campaign's explicit relationship columns
 * (business_id/event_id/.../product_id) remain the authoritative,
 * always-populated cross-entity attribution regardless of this choice;
 * this only picks which single entity the event is conceptually "about"
 * for simple per-entity event semantics.
 *
 * appearance > event_occurrence/event > product > location > business —
 * an Appearance is the most specific, physically-scannable real-world
 * moment Findmi models (a specific business, at a specific place, at a
 * specific time); an occurrence/event narrows to "this date" without a
 * physical Appearance; a Product is a specific sellable thing; a
 * Location is physical but generic (many things happen there); Business
 * is the broadest fallback when nothing more specific was configured. */
export function resolvePrimarySubject(campaign: QrCampaignRow): { subjectType: string; subjectId: string } | null {
  if (campaign.appearance_id) return { subjectType: "appearance", subjectId: campaign.appearance_id };
  if (campaign.event_occurrence_id) return { subjectType: "event_occurrence", subjectId: campaign.event_occurrence_id };
  if (campaign.event_id) return { subjectType: "event", subjectId: campaign.event_id };
  if (campaign.product_id) return { subjectType: "product", subjectId: campaign.product_id };
  if (campaign.location_id) return { subjectType: "location", subjectId: campaign.location_id };
  if (campaign.business_id) return { subjectType: "business", subjectId: campaign.business_id };
  return null;
}


/** Mints/reads findmi_sid, establishes first-touch acquisition and writes
 * one qr_scan row. Best-effort: never throws. */
export async function recordQrScan(admin: SupabaseClient, row: QrCampaignRow, code: string, metadata?: Record<string, unknown>): Promise<void> {
  const primary = resolvePrimarySubject(row);
  const sessionId = await resolveSessionId();
  // Established acquisition is read BEFORE this scan is written, so the
  // event's own acquisition_qr_campaign_id reflects the session's real
  // first-touch even when it differs from this scan's campaign.
  if (isRateLimited(sessionId)) return;
  const acquisition = await establishQrAcquisitionIfAbsent(row.id);
  await insertAnalyticsEvent(admin, {
    event_name: "qr_scan",
    subject_type: primary?.subjectType ?? null,
    subject_id: primary?.subjectId ?? null,
    business_id: row.business_id,
    event_id: row.event_id,
    event_occurrence_id: row.event_occurrence_id,
    appearance_id: row.appearance_id,
    location_id: row.location_id,
    product_id: row.product_id,
    qr_campaign_id: row.id,
    page_type: "qr",
    page_path: `/q/${code}`,
    placement: row.placement,
    session_id: sessionId,
    acquisition_source: acquisition.source,
    acquisition_qr_campaign_id: acquisition.qrCampaignId,
    ...(metadata ? { metadata } : {}),
  });
}
