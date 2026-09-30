"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import ShareButton from "@/components/ShareButton";
import { Panel, Stat, StatusDot, primaryButtonClass, secondaryButtonClass } from "../../owner-ui";
import type { QrCampaignStats, QrDestinationType as QrContextKind } from "@/lib/analytics/qrCampaignDetail";
import type { QrCampaignStatus, QrDestinationType } from "@/lib/qr-v2";
import { updateQrCampaign, setQrCampaignLifecycle, duplicateQrCampaign } from "../../business/qr-manager-actions";

const CONTEXT_TYPE_LABELS: Record<QrContextKind, string> = {
  business: "Business Page",
  appearance: "Appearance",
  product: "Product",
  event: "Event",
  location: "Location",
};

const DESTINATION_TYPE_LABEL: Record<QrDestinationType, string> = {
  business: "Business profile",
  product: "Product page",
  event: "Event page",
  location: "Location page",
  custom: "Custom link",
};

const STATUS_META: Record<QrCampaignStatus, { tone: "positive" | "attention" | "quiet"; label: string }> = {
  active: { tone: "positive", label: "Active" },
  paused: { tone: "attention", label: "Paused" },
  archived: { tone: "quiet", label: "Archived" },
};

interface DestinationOption {
  id: string;
  label: string;
}

/** Draws the already-rendered SVG onto a canvas and downloads it as a
 * PNG — no new dependency, no server round trip. Falls back silently
 * (SVG download always remains available) if the browser can't produce
 * a blob for any reason. */
function downloadPng(svgMarkup: string, filename: string) {
  const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const size = 1024;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    URL.revokeObjectURL(url);
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const pngUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = pngUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(pngUrl);
    }, "image/png");
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

/** QR Campaigns V2 — the persistent, reopenable detail/management view
 * for exactly one QR campaign. Never regenerates the code — the QR image
 * always renders from what's already stored. "For" (context/attribution)
 * and "Sends to" (the real V2 destination) are shown as two distinct
 * facts (Product Principle, QR V2 Pass 2) — changing one never touches
 * the other, the campaign's id, or its code. */
export default function QrCampaignDetailView({
  id,
  name,
  qrSvg,
  qrUrl,
  code,
  status,
  placement,
  destinationType,
  destinationLabel,
  destinationSummary,
  currentDestinationType,
  currentDestinationId,
  currentDestinationUrl,
  editableDestinationOptions,
  stats,
  pro,
  backHref,
}: {
  id: string;
  name: string;
  qrSvg: string;
  qrUrl: string;
  code: string;
  status: QrCampaignStatus;
  placement: string | null;
  destinationType: QrContextKind;
  destinationLabel: string;
  destinationSummary: string;
  currentDestinationType: QrDestinationType | null;
  currentDestinationId: string | null;
  currentDestinationUrl: string | null;
  editableDestinationOptions: { products: DestinationOption[]; events: DestinationOption[]; locations: DestinationOption[] } | null;
  stats: QrCampaignStats;
  pro: boolean;
  backHref: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editName, setEditName] = useState(name);
  const [editPlacement, setEditPlacement] = useState(placement ?? "");
  const [editDestinationType, setEditDestinationType] = useState<QrDestinationType>(currentDestinationType ?? "business");
  const [editDestinationId, setEditDestinationId] = useState(currentDestinationId ?? "");
  const [editDestinationUrl, setEditDestinationUrl] = useState(currentDestinationUrl ?? "");

  function optionsFor(type: QrDestinationType): DestinationOption[] {
    if (!editableDestinationOptions) return [];
    if (type === "product") return editableDestinationOptions.products;
    if (type === "event") return editableDestinationOptions.events;
    if (type === "location") return editableDestinationOptions.locations;
    return [];
  }

  async function saveEdits() {
    setPending(true);
    setError(null);
    const res = await updateQrCampaign({
      campaignId: id,
      name: editName,
      placement: editPlacement || null,
      destinationType: editableDestinationOptions ? editDestinationType : undefined,
      destinationId: editDestinationType === "business" || editDestinationType === "custom" ? undefined : editDestinationId,
      destinationUrl: editDestinationType === "custom" ? editDestinationUrl.trim() : undefined,
    });
    setPending(false);
    if (res.ok) {
      setEditing(false);
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  async function changeStatus(next: QrCampaignStatus) {
    setPending(true);
    setError(null);
    const res = await setQrCampaignLifecycle(id, next);
    setPending(false);
    setConfirmingArchive(false);
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  async function duplicate() {
    setPending(true);
    setError(null);
    const res = await duplicateQrCampaign(id);
    setPending(false);
    if (res.ok) router.push(`/account/qr/${res.campaign.id}`);
    else setError(res.error);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
      <Link href={backHref} className="w-fit text-metadata font-semibold text-muted hover:text-secondary">
        ← Back
      </Link>

      <Panel padded={false}>
        <div className="flex flex-col items-center gap-3 border-b border-black/[0.06] px-5 py-6">
          <div className="h-52 w-52 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <div className="text-center">
            <p className="font-display text-section-title-lg font-bold text-primary">{name}</p>
            <p className="mt-0.5 flex items-center justify-center gap-1.5 text-metadata text-subtle">
              <StatusDot tone={STATUS_META[status].tone} label={STATUS_META[status].label} />
            </p>
          </div>
        </div>

        {!editing ? (
          <div className="flex flex-col gap-3 px-5 py-4">
            <div>
              <p className="text-label font-bold uppercase text-subtle">For</p>
              <p className="text-body font-semibold text-primary">{destinationLabel}</p>
              <p className="text-metadata text-subtle">{CONTEXT_TYPE_LABELS[destinationType]}</p>
            </div>
            <div>
              <p className="text-label font-bold uppercase text-subtle">Sends to</p>
              <p className="text-body font-semibold text-primary">{destinationSummary}</p>
            </div>
            {placement && (
              <div>
                <p className="text-label font-bold uppercase text-subtle">Placement</p>
                <p className="text-body text-primary">{placement}</p>
              </div>
            )}
            <p className="truncate text-microcopy text-subtle">{qrUrl}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-5 py-4">
            <label className="block">
              <span className="mb-1 block text-microcopy font-semibold text-muted">Campaign name</span>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-input text-primary focus:border-ink/30 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-microcopy font-semibold text-muted">Placement</span>
              <input
                type="text"
                value={editPlacement}
                onChange={(e) => setEditPlacement(e.target.value)}
                placeholder="e.g. Counter, Table sign, Packaging"
                maxLength={60}
                className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none"
              />
            </label>

            {editableDestinationOptions ? (
              <div>
                <span className="mb-1.5 block text-microcopy font-semibold text-muted">Sends to</span>
                <p className="mb-1.5 text-microcopy text-subtle">The QR code stays the same even if you change where it sends people.</p>
                <div className="flex flex-wrap gap-1.5">
                  {(["business", "product", "event", "location", "custom"] as QrDestinationType[])
                    .filter((t) => t === "business" || t === "custom" || optionsFor(t).length > 0)
                    .map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setEditDestinationType(t);
                          setEditDestinationId("");
                        }}
                        className={`rounded-full border px-3 py-1.5 text-microcopy font-semibold transition ${
                          editDestinationType === t ? "border-findmi bg-findmi-50 text-accent" : "border-black/10 bg-white text-muted hover:border-black/20"
                        }`}
                      >
                        {DESTINATION_TYPE_LABEL[t]}
                      </button>
                    ))}
                </div>
                {editDestinationType !== "business" && editDestinationType !== "custom" && (
                  <div className="mt-2 flex max-h-56 flex-col gap-1.5 overflow-y-auto rounded-xl border border-black/10 bg-white p-1.5">
                    {optionsFor(editDestinationType).map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => setEditDestinationId(o.id)}
                        className={`rounded-lg px-3 py-2 text-left text-body transition ${
                          editDestinationId === o.id ? "bg-findmi-50 font-semibold text-accent" : "text-primary hover:bg-black/[0.03]"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
                {editDestinationType === "custom" && (
                  <input
                    type="text"
                    value={editDestinationUrl}
                    onChange={(e) => setEditDestinationUrl(e.target.value)}
                    placeholder="https://example.com/promo"
                    className="mt-2 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none"
                  />
                )}
              </div>
            ) : (
              <p className="text-microcopy text-subtle">Destination editing isn&rsquo;t available for this QR yet.</p>
            )}

            {error && <p className="text-metadata text-red-600">{error}</p>}

            <div className="flex gap-2">
              <button type="button" disabled={pending} onClick={saveEdits} className={`${primaryButtonClass("sm")} disabled:opacity-60`}>
                {pending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                className={secondaryButtonClass("sm")}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!editing && (
          <div className="flex flex-col gap-2 px-5 pb-5">
            {error && <p className="text-metadata text-red-600">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <CopyButton value={qrUrl} label="Copy Link" className={secondaryButtonClass("sm")} />
              <a
                href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`}
                download={`findmi-qr-${code}.svg`}
                className={secondaryButtonClass("sm")}
              >
                Download SVG
              </a>
              <button type="button" onClick={() => downloadPng(qrSvg, `findmi-qr-${code}.png`)} className={secondaryButtonClass("sm")}>
                Download PNG
              </button>
              <ShareButton url={qrUrl} title={name} variant="default" />
            </div>

            <div className="mt-1 flex flex-wrap gap-2">
              {status !== "archived" && (
                <button type="button" onClick={() => setEditing(true)} className={secondaryButtonClass("sm")}>
                  Edit
                </button>
              )}
              {status === "active" && (
                <button type="button" disabled={pending} onClick={() => changeStatus("paused")} className={secondaryButtonClass("sm")}>
                  Pause
                </button>
              )}
              {status === "paused" && (
                <button type="button" disabled={pending} onClick={() => changeStatus("active")} className={secondaryButtonClass("sm")}>
                  Reactivate
                </button>
              )}
              {status !== "archived" && !confirmingArchive && (
                <button type="button" onClick={() => setConfirmingArchive(true)} className={secondaryButtonClass("sm")}>
                  Archive
                </button>
              )}
              <button type="button" disabled={pending} onClick={duplicate} className={secondaryButtonClass("sm")}>
                Duplicate
              </button>
            </div>

            {confirmingArchive && (
              <div className="mt-1 rounded-lg border border-black/10 bg-black/[0.02] p-3">
                <p className="text-metadata text-primary">
                  Archive this QR? The code and its history stay, but it moves out of your active list. This isn&rsquo;t reversible from here.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => changeStatus("archived")}
                    className="inline-flex h-8 items-center justify-center rounded-lg bg-red-600 px-3 text-button font-bold text-white transition hover:bg-red-700 disabled:opacity-60"
                  >
                    Archive
                  </button>
                  <button type="button" onClick={() => setConfirmingArchive(false)} className={secondaryButtonClass("sm")}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Performance">
        <div className="grid grid-cols-3 gap-2">
          <Stat value={stats.scans.toLocaleString()} label="Scans" />
          <Stat value={pro ? stats.uniqueVisitors.toLocaleString() : "—"} label="Visitors" />
          <Stat value={pro ? stats.actions.toLocaleString() : "—"} label="Actions" />
        </div>
        {!pro && (
          <p className="mt-3 text-metadata text-subtle">
            Unique visitors and downstream actions are a Pro feature.{" "}
            <Link href="/account" className="font-semibold text-accent">
              Upgrade to see full attribution →
            </Link>
          </p>
        )}
        {pro && stats.actionBreakdown.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5 border-t border-black/[0.06] pt-3">
            <p className="text-label font-bold uppercase text-subtle">From this QR</p>
            {stats.actionBreakdown.map((a) => (
              <div key={a.label} className="flex items-center justify-between text-body">
                <span className="text-secondary">{a.label}</span>
                <span className="font-semibold text-primary">{a.count.toLocaleString()}</span>
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
