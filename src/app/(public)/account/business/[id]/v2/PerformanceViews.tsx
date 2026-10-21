import OptimisticTabs from "./OptimisticTabs";
import Link from "next/link";
import ChevronIcon from "@/components/ChevronIcon";
import type { QrCampaignSummary } from "@/lib/qr-manager";
import QrCampaignGroups from "../QrCampaignGroups";

/** Performance is where QR codes live: Overview (analytics, plus QR
 * performance) and QR Codes (manage / create). Same routes as before —
 * `?tab=performance` and `?tab=qr` — now presented as two views of one
 * section, with Create QR Code always one tap away. */
export type PerformanceView = "overview" | "qr";

export function PerformanceViewTabs({ basePath, view }: { basePath: string; view: PerformanceView }) {
  const tabs: { value: PerformanceView; label: string; href: string }[] = [
    { value: "overview", label: "Overview", href: `${basePath}?tab=performance` },
    { value: "qr", label: "QR Codes", href: `${basePath}?tab=qr` },
  ];
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <OptimisticTabs
        ariaLabel="Performance views"
        semantics="tab"
        navClass="flex gap-0.5 rounded-full bg-black/[0.04] p-0.5"
        linkClass="flex h-8 items-center rounded-full px-3.5 text-metadata font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
        activeClass="bg-white text-primary shadow-sm"
        inactiveClass="text-muted hover:text-primary"
        active={view}
        items={tabs.map((t) => ({ key: t.value, href: t.href, label: t.label }))}
      />
      <Link href={`${basePath}/qr/new`} className="flex h-9 shrink-0 items-center rounded-full bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600">
        Create QR Code
      </Link>
    </div>
  );
}

function summarize(campaigns: QrCampaignSummary[]) {
  return {
    active: campaigns.filter((c) => c.status === "active").length,
    total: campaigns.length,
    scans: campaigns.reduce((n, c) => n + c.scans, 0),
  };
}

/** A compact QR line for the Overview — real counts, linking to the full
 * QR Codes view. Omitted when the Business has no QR codes yet (the header
 * already offers Create QR Code). */
export function QrSnapshot({ basePath, campaigns }: { basePath: string; campaigns: QrCampaignSummary[] }) {
  if (campaigns.length === 0) return null;
  const { active, scans } = summarize(campaigns);
  return (
    <Link
      href={`${basePath}?tab=qr`}
      className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-black/[0.03] px-4 py-3 transition hover:bg-black/[0.05]"
    >
      <span className="min-w-0">
        <span className="block text-card-title font-bold text-primary">QR Codes</span>
        <span className="block text-metadata text-muted">
          {active} Active · {scans.toLocaleString()} {scans === 1 ? "Scan" : "Scans"}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-metadata font-bold text-accent">
        Manage QR Codes
        <ChevronIcon direction="right" className="h-3 w-3" />
      </span>
    </Link>
  );
}

/** The QR Codes view: summary numbers, then the searchable / filterable
 * list. Free-tier reachable (QR creation is never plan-gated). */
export function QrCodesView({ basePath, campaigns }: { basePath: string; campaigns: QrCampaignSummary[] }) {
  const { active, scans } = summarize(campaigns);
  return (
    <div className="flex flex-col gap-4 lg:max-w-2xl">
      <div>
        <h1 className="font-display text-page-title sm:text-page-title-lg font-bold text-primary">QR Codes</h1>
        <p className="mt-1 text-body text-muted">Create and manage trackable QR codes for your business, products, where you show up, events and locations.</p>
      </div>
      {campaigns.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { value: active, label: "Active" },
            { value: campaigns.length, label: "Total Codes" },
            { value: scans, label: "Total Scans" },
          ].map((m) => (
            <div key={m.label} className="rounded-2xl bg-black/[0.03] px-3 py-3">
              <p className="font-display text-stat font-bold leading-none text-primary tabular-nums">{m.value.toLocaleString()}</p>
              <p className="mt-1.5 text-metadata font-medium text-muted">{m.label}</p>
            </div>
          ))}
        </div>
      )}
      <QrCampaignGroups campaigns={campaigns} newHref={`${basePath}/qr/new`} />
    </div>
  );
}
