import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";
import { requireBusinessMember, requireEventMember, requireLocationMember } from "@/lib/permissions";
import { isBusinessPro } from "@/lib/entitlements";
import { getPublicOrigin } from "@/lib/site-url";
import {
  getQrCampaignRow,
  getQrCampaignStats,
  getQrCampaignDestination,
  getQrCampaignDestinationSummary,
} from "@/lib/analytics/qrCampaignDetail";
import { getBusinessQrCreatorOptions } from "@/lib/qr-manager";
import QrCampaignDetailView from "./QrCampaignDetailView";

export const dynamic = "force-dynamic";

/** QR Campaigns V1 — the one shared, entity-agnostic "reopen my QR"
 * destination (Goal 1). Every contextual/central creation entry point
 * links here instead of ever showing a QR only once at creation time.
 *
 * Authorization dispatches on whichever relationship column the campaign
 * row actually has populated — never trusts the id alone. A campaign
 * always has exactly one of business_id (covers Business/Appearance/
 * Product, all of which require business membership — see qr-actions.ts)
 * or event_id or location_id populated (see createOwnerQrCampaign). */
export default async function QrCampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl("/account", "Server isn't configured."));

  const row = await getQrCampaignRow(admin, id);
  if (!row) redirect(errorRedirectUrl("/account", "That QR code couldn't be found."));

  let pro = false;
  let backHref = "/account";
  try {
    if (row.business_id) {
      await requireBusinessMember(row.business_id);
      const { data: business } = await admin
        .from("businesses")
        .select("plan_tier, plan_expires_at")
        .eq("id", row.business_id)
        .maybeSingle();
      pro = business ? isBusinessPro(business) : false;
      backHref = `/account/business/${row.business_id}`;
    } else if (row.event_id) {
      await requireEventMember(row.event_id);
      backHref = `/account/event/${row.event_id}`;
    } else if (row.location_id) {
      await requireLocationMember(row.location_id);
      backHref = `/account/location/${row.location_id}`;
    } else {
      // A campaign with no relationship column at all shouldn't exist
      // (createOwnerQrCampaign always sets exactly one) — fail closed.
      redirect(errorRedirectUrl("/account", "That QR code couldn't be found."));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to that QR code.";
    redirect(errorRedirectUrl("/account", message));
  }

  const [stats, destination, destinationSummary, destinationOptions] = await Promise.all([
    getQrCampaignStats(admin, id),
    getQrCampaignDestination(admin, row),
    getQrCampaignDestinationSummary(admin, row),
    // Edit's destination picker (Products/Events/Locations) is only ever
    // meaningful for a Business-scoped campaign — see updateQrCampaign's
    // own guard. Legacy Event/Location-only campaigns (business_id null)
    // still fully DISPLAY here; only destination editing is unavailable
    // for them in this pass.
    row.business_id ? getBusinessQrCreatorOptions(admin, row.business_id) : Promise.resolve(null),
  ]);

  // Regenerated from the persisted, immutable code — never a new one
  // (Goal 1/8: existing short URLs must keep resolving exactly as before).
  const qrUrl = `${getPublicOrigin()}/q/${row.code}`;
  const qrSvg = await QRCode.toString(qrUrl, { type: "svg", margin: 1, width: 320 }).catch(() => "");

  return (
    <QrCampaignDetailView
      id={row.id}
      name={row.name}
      qrSvg={qrSvg}
      qrUrl={qrUrl}
      code={row.code}
      status={row.status}
      placement={row.placement}
      destinationType={destination.type}
      destinationLabel={destination.label}
      destinationSummary={destinationSummary}
      currentDestinationType={row.destination_type}
      currentDestinationId={row.destination_id}
      currentDestinationUrl={row.destination_url}
      editableDestinationOptions={
        destinationOptions ? { products: destinationOptions.products, events: destinationOptions.events, locations: destinationOptions.locations } : null
      }
      stats={stats}
      pro={pro}
      backHref={backHref}
    />
  );
}
