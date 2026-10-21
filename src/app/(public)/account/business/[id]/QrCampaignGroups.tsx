import Link from "next/link";
import type { QrCampaignSummary } from "@/lib/qr-manager";
import type { QrCampaignStatus } from "@/lib/qr-v2";
import { EmptyLine, Panel, SectionEyebrow, StatusDot } from "../../owner-ui";

const STATUS_TONE: Record<QrCampaignStatus, "positive" | "attention" | "quiet"> = {
  active: "positive",
  paused: "attention",
  archived: "quiet",
};

/** A Business's QR campaigns grouped by lifecycle (Active / Paused /
 * Archived) — the one list the QR tab (`?tab=qr`) renders. Each row opens
 * the unchanged /account/qr/[id] detail page. */
export default function QrCampaignGroups({ campaigns, newHref }: { campaigns: QrCampaignSummary[]; newHref: string }) {
  if (campaigns.length === 0) {
    return (
      <Panel>
        <EmptyLine action={{ href: newHref, label: "Create one" }}>No QR campaigns yet.</EmptyLine>
      </Panel>
    );
  }
  return (
    <>
      <CampaignGroup title="Active" items={campaigns.filter((c) => c.status === "active")} />
      <CampaignGroup title="Paused" items={campaigns.filter((c) => c.status === "paused")} />
      <CampaignGroup title="Archived" items={campaigns.filter((c) => c.status === "archived")} />
    </>
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
