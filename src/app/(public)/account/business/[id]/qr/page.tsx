import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";
import { requireBusinessMember } from "@/lib/permissions";
import { getBusinessQrCampaigns, type QrCampaignSummary } from "@/lib/qr-manager";
import type { QrCampaignStatus } from "@/lib/qr-v2";
import { EmptyLine, Panel, SectionEyebrow, StatusDot, primaryButtonClass } from "../../../owner-ui";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<QrCampaignStatus, "positive" | "attention" | "quiet"> = {
  active: "positive",
  paused: "attention",
  archived: "quiet",
};

/** QR Campaigns V2 — Pass 2 Campaign Manager. The polished, dedicated
 * surface for a Business's QR codes, reached from that Business's
 * existing "QR" tab (?tab=qr) rather than a disconnected dashboard.
 * Deliberately a separate route (not inlined into the already very large
 * business/[id]/page.tsx) — that file's existing inline QR creator/list
 * stays exactly as it was, still fully functional, while this page
 * becomes the recommended, richer surface. */
export default async function BusinessQrManagerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    await requireBusinessMember(id);
  } catch (err) {
    redirect(errorRedirectUrl("/account", err instanceof Error ? err.message : "You don't have access to this business."));
  }

  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl(`/account/business/${id}?tab=qr`, "Server isn't configured."));

  const [{ data: business }, campaigns] = await Promise.all([
    admin.from("businesses").select("name").eq("id", id).maybeSingle(),
    getBusinessQrCampaigns(admin, id),
  ]);

  const active = campaigns.filter((c) => c.status === "active");
  const paused = campaigns.filter((c) => c.status === "paused");
  const archived = campaigns.filter((c) => c.status === "archived");

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-6">
      <Link href={`/account/business/${id}?tab=qr`} className="w-fit text-metadata font-semibold text-muted hover:text-secondary">
        ← Back
      </Link>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-page-title font-bold text-primary">QR Codes</p>
          <p className="truncate text-metadata text-subtle">{business?.name ?? "Your business"}</p>
        </div>
        <Link href={`/account/business/${id}/qr/new`} className={primaryButtonClass("md")}>
          + New QR
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <Panel>
          <EmptyLine action={{ href: `/account/business/${id}/qr/new`, label: "Create one" }}>No QR campaigns yet.</EmptyLine>
        </Panel>
      ) : (
        <>
          <CampaignGroup title="Active" items={active} />
          <CampaignGroup title="Paused" items={paused} />
          <CampaignGroup title="Archived" items={archived} />
        </>
      )}
    </div>
  );
}

function CampaignGroup({ title, items }: { title: string; items: QrCampaignSummary[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <SectionEyebrow>
        {title} ({items.length})
      </SectionEyebrow>
      <div className="mt-2 flex flex-col divide-y divide-black/[0.05] rounded-lg border border-black/[0.06] bg-white">
        {items.map((c) => (
          <Link key={c.id} href={`/account/qr/${c.id}`} className="flex items-start gap-3 px-4 py-3 transition hover:bg-black/[0.015]">
            <span className="mt-1.5 shrink-0">
              <StatusDot tone={STATUS_TONE[c.status]} label="" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-card-title font-semibold text-primary">{c.name}</span>
              <span className="mt-0.5 block truncate text-metadata text-subtle">{c.contextSummary}</span>
              <span className="mt-0.5 block truncate text-microcopy text-muted">
                {c.placement && `${c.placement} · `}Sends to {c.destinationSummary}
              </span>
            </span>
            <span className="shrink-0 text-right text-microcopy font-semibold text-muted">{c.scans.toLocaleString()} scans</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
