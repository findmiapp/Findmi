import { NextResponse, type NextRequest } from "next/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { QR_CAMPAIGN_SELECT, recordQrScan, type QrCampaignRow } from "@/lib/analytics/qrScan";
import { resolveQrDestination } from "@/lib/qr-v2";
import { getServerSupabase } from "@/lib/supabase/server";
import { isAnalyticsAllowedForRequest, readDeviceChoice, readGpc } from "@/lib/privacy/consent-server";
import { withQrArrivalParam } from "@/lib/privacy/qr-arrival";

export const dynamic = "force-dynamic";

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
    .select(QR_CAMPAIGN_SELECT)
    .eq("code", code)
    .maybeSingle();

  // Paused/archived AND unknown codes are all indistinguishable to the
  // visitor — never confirm/deny a code's existence or lifecycle state
  // in the response. Paused/archived campaigns, their code, and their
  // scan history all remain fully intact in the database; this route
  // simply declines to resolve/redirect them, exactly like an unknown
  // code, and reactivates nothing.
  if (!campaign || (campaign as QrCampaignRow).status !== "active") return failsafe();

  const row = campaign as QrCampaignRow;
  // Legacy campaigns (destination_type null) resolve via destination_path;
  // V2 campaigns resolve via destination_type/destination_id/
  // destination_url — see resolveQrDestination's own doc comment.
  const destination = await resolveQrDestination(admin, row);
  if (!destination) return failsafe();

  // PRIVACY CHOICES (Phase 2A): resolving and redirecting a code is
  // essential and ALWAYS happens. Measuring the scan (findmi_sid,
  // findmi_acq, the qr_scan row) is Analytics and only happens with
  // permission. A visitor who hasn't decided yet (and sends no GPC signal)
  // lands with ?fmqr=<code> on an internal destination, so the scan can be
  // recorded if, and only if, they then allow Analytics on that page
  // (PrivacyChoicesRoot -> /api/analytics/qr-arrival). A refusal, or GPC,
  // records nothing at all.
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await isAnalyticsAllowedForRequest(supabase, user?.id ?? null))) {
    const [deviceChoice, gpc] = await Promise.all([readDeviceChoice(), readGpc()]);
    const undecided = deviceChoice === null && !gpc;
    const target = undecided ? withQrArrivalParam(destination, code) : destination;
    return NextResponse.redirect(new URL(target, request.url));
  }

  await recordQrScan(admin, row, code);

  return NextResponse.redirect(new URL(destination, request.url));
}
