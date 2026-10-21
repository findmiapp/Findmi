"use client";

import { useState } from "react";
import Link from "next/link";
import type { QrCampaignSummary } from "@/lib/qr-manager";
import type { QrCampaignStatus } from "@/lib/qr-v2";
import { EmptyLine, Panel, SectionEyebrow, StatusDot } from "../../owner-ui";

const STATUS_TONE: Record<QrCampaignStatus, "positive" | "attention" | "quiet"> = {
  active: "positive",
  paused: "attention",
  archived: "quiet",
};

type StatusFilter = "all" | QrCampaignStatus;
type KindFilter = "all" | "event" | "product" | "location" | "appearance" | "business";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "archived", label: "Archived" },
];

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "Any Type" },
  { value: "event", label: "Events" },
  { value: "product", label: "Products" },
  { value: "location", label: "Locations" },
  { value: "appearance", label: "Where I’ll Be" },
  { value: "business", label: "Business" },
];

/** What a campaign is FOR — same precedence the list's contextSummary uses. */
function kindOf(c: QrCampaignSummary): Exclude<KindFilter, "all"> {
  if (c.appearanceId) return "appearance";
  if (c.productId) return "product";
  if (c.eventId) return "event";
  if (c.locationId) return "location";
  return "business";
}

/** A Business's QR campaigns grouped by lifecycle (Active / Paused /
 * Archived) — the list the QR Codes view renders. Searchable (name, what
 * it's for, placement, destination) and filterable by status and type;
 * filtering is local because this is the Business's own, already-loaded
 * list. Each row opens the unchanged /account/qr/[id] detail page. */
export default function QrCampaignGroups({ campaigns, newHref }: { campaigns: QrCampaignSummary[]; newHref: string }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");

  if (campaigns.length === 0) {
    return (
      <Panel>
        <EmptyLine action={{ href: newHref, label: "Create One" }}>No QR codes yet.</EmptyLine>
      </Panel>
    );
  }

  const q = query.trim().toLowerCase();
  const kindsPresent = new Set(campaigns.map(kindOf));
  const visible = campaigns.filter(
    (c) =>
      (status === "all" || c.status === status) &&
      (kind === "all" || kindOf(c) === kind) &&
      (!q || `${c.name} ${c.contextSummary} ${c.placement ?? ""} ${c.destinationSummary}`.toLowerCase().includes(q))
  );
  const filtering = q !== "" || status !== "all" || kind !== "all";

  return (
    <>
      <div className="flex flex-col gap-2">
        <input
          type="search"
          autoCapitalize="none"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search QR Codes"
          aria-label="Search QR codes"
          className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none"
        />
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          {STATUS_FILTERS.map((f) => (
            <FilterChip key={f.value} active={status === f.value} onClick={() => setStatus(f.value)}>
              {f.label}
            </FilterChip>
          ))}
          <span aria-hidden="true" className="mx-1 w-px shrink-0 self-stretch bg-black/10" />
          {KIND_FILTERS.filter((f) => f.value === "all" || kindsPresent.has(f.value)).map((f) => (
            <FilterChip key={f.value} active={kind === f.value} onClick={() => setKind(f.value)}>
              {f.label}
            </FilterChip>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-body text-muted">
          No QR codes match{q ? ` “${query.trim()}”` : " those filters"}.{" "}
          {filtering && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setStatus("all");
                setKind("all");
              }}
              className="font-semibold text-accent hover:underline"
            >
              Clear Filters
            </button>
          )}
        </p>
      ) : (
        <>
          <CampaignGroup title="Active" items={visible.filter((c) => c.status === "active")} />
          <CampaignGroup title="Paused" items={visible.filter((c) => c.status === "paused")} />
          <CampaignGroup title="Archived" items={visible.filter((c) => c.status === "archived")} />
        </>
      )}
    </>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-metadata font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40 ${
        active ? "bg-findmi-50 text-findmi-700" : "bg-black/[0.04] text-muted hover:text-primary"
      }`}
    >
      {children}
    </button>
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
