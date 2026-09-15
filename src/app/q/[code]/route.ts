import { NextResponse, type NextRequest } from "next/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { establishQrAcquisitionIfAbsent, resolveSessionId } from "@/lib/analytics/session";
import { isRateLimited } from "@/lib/analytics/rateLimit";
import { insertAnalyticsEvent } from "@/lib/analytics/serverTrack";
import { isSafeQrDestinationPath } from "@/lib/analytics/qrCode";

export const dynamic = "force-dynamic";

interface QrCampaignRow {
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
function resolvePrimarySubject(campaign: QrCampaignRow): { subjectType: string; subjectId: string } | null {
  if (campaign.appearance_id) return { subjectType: "appearance", subjectId: campaign.appearance_id };
  if (campaign.event_occurrence_id) return { subjectType: "event_occurrence", subjectId: campaign.event_occurrence_id };
  if (campaign.event_id) return { subjectType: "event", subjectId: campaign.event_id };
  if (campaign.product_id) return { subjectType: "product", subjectId: campaign.product_id };
  if (campaign.location_id) return { subjectType: "location", subjectId: campaign.location_id };
  if (campaign.business_id) return { subjectType: "business", subjectId: campaign.business_id };
  return null;
}

// A QR code printed on physical signage can't be edited after the fact —
// a deactivated or unknown code must never dead-end a real visitor with a
// raw error. Same "never trap the consumer" principle as an analytics
// write failure below: fail safe to the homepage, Findmi's one guaranteed-
// always-valid destination.
const FAILSAFE_DESTINATION = "/";

/**
 * The public QR resolution route — GET only (a QR code encodes a URL a
 * camera app navigates to, never a POST). Resolves a campaign, records
 * qr_scan, establishes first-touch session acquisition, and redirects.
 * Never exposes campaign metadata in the response — the only observable
 * output is the redirect itself.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const failsafe = () => NextResponse.redirect(new URL(FAILSAFE_DESTINATION, request.url));

  if (!code || typeof code !== "string" || code.length > 64) return failsafe();

  const admin = getAdminSupabase();
  if (!admin) return failsafe();

  const { data: campaign } = await admin
    .from("qr_campaigns")
    .select("id, business_id, event_id, event_occurrence_id, appearance_id, location_id, product_id, destination_path, placement, is_active")
    .eq("code", code)
    .maybeSingle();

  // Inactive AND unknown codes are indistinguishable to the visitor —
  // never confirm/deny a code's existence in the response.
  if (!campaign || !(campaign as QrCampaignRow).is_active) return failsafe();

  const row = campaign as QrCampaignRow;
  if (!isSafeQrDestinationPath(row.destination_path)) return failsafe();

  const primary = resolvePrimarySubject(row);
  const sessionId = await resolveSessionId();

  // Best-effort only — a rate-limited or failed write never blocks the
  // redirect (see the module doc comment). Established acquisition is
  // read BEFORE this scan is written, so the event's own
  // acquisition_qr_campaign_id correctly reflects the session's real
  // first-touch even when it differs from this specific scan's campaign
  // (e.g. a second, later QR scan in the same session).
  if (!isRateLimited(sessionId)) {
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
    });
  }

  return NextResponse.redirect(new URL(row.destination_path, request.url));
}
