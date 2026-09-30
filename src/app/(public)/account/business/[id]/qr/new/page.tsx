import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";
import { requireBusinessMember } from "@/lib/permissions";
import { getBusinessQrCreatorOptions } from "@/lib/qr-manager";
import QrIntelligentCreator from "./QrIntelligentCreator";

export const dynamic = "force-dynamic";

/** QR Campaigns V2 — Pass 2 Intelligent Creator entry point. Fetches the
 * Business-scoped options the wizard needs (Appearances/Products owned
 * outright, Events/Locations via the Foundation's business-aware
 * eligibility helpers) and hands them to the client wizard — no
 * eligibility logic lives in the client component itself. */
export default async function NewBusinessQrCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    await requireBusinessMember(id);
  } catch (err) {
    redirect(errorRedirectUrl("/account", err instanceof Error ? err.message : "You don't have access to this business."));
  }

  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl(`/account/business/${id}/qr`, "Server isn't configured."));

  const [{ data: business }, options] = await Promise.all([
    admin.from("businesses").select("name, slug").eq("id", id).maybeSingle(),
    getBusinessQrCreatorOptions(admin, id),
  ]);

  if (!business) redirect(errorRedirectUrl(`/account/business/${id}/qr`, "Business not found."));

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-6">
      <Link href={`/account/business/${id}/qr`} className="w-fit text-metadata font-semibold text-muted hover:text-secondary">
        ← Back
      </Link>
      <QrIntelligentCreator businessId={id} businessName={business.name} options={options} />
    </div>
  );
}
