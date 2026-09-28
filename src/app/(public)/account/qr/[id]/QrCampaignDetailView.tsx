"use client";

import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import ShareButton from "@/components/ShareButton";
import { Panel, Stat, StatusDot, secondaryButtonClass } from "../../owner-ui";
import type { QrCampaignStats, QrDestinationType } from "@/lib/analytics/qrCampaignDetail";

const DESTINATION_TYPE_LABELS: Record<QrDestinationType, string> = {
  business: "Business Page",
  appearance: "Appearance",
  product: "Product",
  event: "Event",
  location: "Location",
};

/** QR Campaigns V1 — the persistent, reopenable detail view for exactly
 * one QR campaign (Goal 1). Reached from every creation flow's "View
 * Details" link and every contextual/central reopen link — never
 * regenerates the code, just re-renders it from what's already stored.
 *
 * Free vs Pro (Goal 7): the QR itself, its link, download, and the raw
 * scan count are always shown — creating and reopening a QR is a Free
 * capability. Unique visitors / downstream actions / the action
 * breakdown are the deeper intelligence layer, shown only when `pro` is
 * true (business-owned campaigns on a Pro plan; Event/Location campaigns
 * have no Pro concept today, so they always render the Free-tier view —
 * see page.tsx). */
export default function QrCampaignDetailView({
  name,
  qrSvg,
  qrUrl,
  code,
  isActive,
  destinationPath,
  destinationType,
  destinationLabel,
  stats,
  pro,
  backHref,
}: {
  name: string;
  qrSvg: string;
  qrUrl: string;
  code: string;
  isActive: boolean;
  destinationPath: string;
  destinationType: QrDestinationType;
  destinationLabel: string;
  stats: QrCampaignStats;
  pro: boolean;
  backHref: string;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
      <Link href={backHref} className="w-fit text-[12px] font-semibold text-ink/50 hover:text-ink/70">
        ← Back
      </Link>

      <Panel padded={false}>
        <div className="flex flex-col items-center gap-3 border-b border-black/[0.06] px-5 py-6">
          {/* The QR itself is the visually prominent element on this
              screen — no competing headline above it. */}
          <div className="h-52 w-52 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <div className="text-center">
            <p className="font-display text-lg font-bold tracking-tight text-ink">{name}</p>
            <p className="mt-0.5 flex items-center justify-center gap-1.5 text-[12px] text-ink/45">
              <StatusDot tone={isActive ? "positive" : "quiet"} label={isActive ? "Active" : "Inactive"} />
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1 px-5 py-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink/35">Destination</p>
          <p className="text-sm font-semibold text-ink">{destinationLabel}</p>
          <p className="text-[12px] text-ink/45">
            {DESTINATION_TYPE_LABELS[destinationType]} · {destinationPath}
          </p>
          <p className="mt-2 truncate text-[11px] text-ink/40">{qrUrl}</p>
        </div>

        <div className="flex flex-wrap gap-2 px-5 pb-5">
          <CopyButton value={qrUrl} label="Copy Link" className={secondaryButtonClass("sm")} />
          <a
            href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`}
            download={`findmi-qr-${code}.svg`}
            className={secondaryButtonClass("sm")}
          >
            Download SVG
          </a>
          <ShareButton url={qrUrl} title={name} variant="default" />
        </div>
      </Panel>

      <Panel title="Performance">
        <div className="grid grid-cols-3 gap-2">
          <Stat value={stats.scans.toLocaleString()} label="Scans" />
          <Stat value={pro ? stats.uniqueVisitors.toLocaleString() : "—"} label="Visitors" />
          <Stat value={pro ? stats.actions.toLocaleString() : "—"} label="Actions" />
        </div>
        {!pro && (
          <p className="mt-3 text-[12px] text-ink/40">
            Unique visitors and downstream actions are a Pro feature.{" "}
            <Link href="/account" className="font-semibold text-findmi-700">
              Upgrade to see full attribution →
            </Link>
          </p>
        )}
        {pro && stats.actionBreakdown.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5 border-t border-black/[0.06] pt-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink/35">From this QR</p>
            {stats.actionBreakdown.map((a) => (
              <div key={a.label} className="flex items-center justify-between text-[13px]">
                <span className="text-ink/70">{a.label}</span>
                <span className="font-semibold text-ink">{a.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Link href={backHref} className={`${secondaryButtonClass("md")} justify-center`}>
        Done
      </Link>
    </div>
  );
}
