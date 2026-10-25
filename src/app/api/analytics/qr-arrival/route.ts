import { NextResponse, type NextRequest } from "next/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { QR_CAMPAIGN_SELECT, recordQrScan, type QrCampaignRow } from "@/lib/analytics/qrScan";
import { isAnalyticsAllowedForRequest } from "@/lib/privacy/consent-server";
import { isQrArrivalCode } from "@/lib/privacy/qr-arrival";

export const dynamic = "force-dynamic";

/** Deferred QR measurement (lib/privacy/qr-arrival.ts). Called once by the
 * landing page after a visitor who arrived from /q/<code> allows Analytics.
 * Records nothing unless Analytics is allowed for this request right now.
 * Never echoes campaign details back. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = body?.code;
  if (!isQrArrivalCode(code)) return new NextResponse(null, { status: 204 });

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await isAnalyticsAllowedForRequest(supabase, user?.id ?? null))) return new NextResponse(null, { status: 204 });

  const admin = getAdminSupabase();
  if (!admin) return new NextResponse(null, { status: 204 });
  const { data: campaign } = await admin.from("qr_campaigns").select(QR_CAMPAIGN_SELECT).eq("code", code).maybeSingle();
  if (!campaign || (campaign as QrCampaignRow).status !== "active") return new NextResponse(null, { status: 204 });

  await recordQrScan(admin, campaign as QrCampaignRow, code, { measured_after_consent: true });
  return new NextResponse(null, { status: 204 });
}
