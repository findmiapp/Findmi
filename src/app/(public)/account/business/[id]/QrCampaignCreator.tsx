"use client";

import { useState } from "react";
import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import ChevronIcon from "@/components/ChevronIcon";
import { createOwnerQrCampaign, type QrCampaignTarget, type CreatedQrCampaign } from "../qr-actions";
import { secondaryButtonClass } from "../../owner-ui";

const TARGET_LABELS: Record<QrCampaignTarget, string> = {
  business: "Business Page",
  appearance: "An Appearance",
  product: "A Product",
  event: "An Event",
  location: "A Location",
};

/** QR Campaigns V1 — the one shared creation UI, used in two modes:
 *
 *  - Contextual (`fixedTarget` set): launched from the entity a business
 *    owner is already managing (a Product row, an Appearance row, an
 *    Event or Location's own manage page). The destination is already
 *    known, so this only asks for a campaign name — matching this pass's
 *    own "the user should primarily need to name the campaign" spec.
 *
 *  - Central (`centralOptions` set): launched from Business Performance's
 *    QR Campaigns panel. Offers every destination type this business
 *    actually has eligible entities for, then a specific-entity picker,
 *    same UX shape Pro QR Self-Service V1 originally shipped, extended
 *    to 5 types instead of 3.
 *
 * Exactly one of the two props is ever passed by a given call site. */
export default function QrCampaignCreator(
  props:
    | {
        fixedTarget: { target: QrCampaignTarget; targetId: string; label: string };
        centralOptions?: undefined;
      }
    | {
        fixedTarget?: undefined;
        centralOptions: {
          businessId: string;
          businessName: string;
          appearances: { id: string; name: string }[];
          products: { id: string; name: string }[];
          events: { id: string; name: string }[];
          locations: { id: string; name: string }[];
        };
      }
) {
  const { fixedTarget, centralOptions } = props;

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState<QrCampaignTarget>(fixedTarget?.target ?? "business");
  const [entityId, setEntityId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedQrCampaign | null>(null);

  function reset() {
    setName("");
    setTarget(fixedTarget?.target ?? "business");
    setEntityId("");
    setError(null);
    setCreated(null);
  }

  const entityOptions =
    !fixedTarget && centralOptions
      ? target === "appearance"
        ? centralOptions.appearances
        : target === "product"
          ? centralOptions.products
          : target === "event"
            ? centralOptions.events
            : target === "location"
              ? centralOptions.locations
              : []
      : [];
  const needsEntity = !fixedTarget && target !== "business";
  const canSubmit = name.trim().length > 0 && (fixedTarget ? Boolean(fixedTarget.targetId) : !needsEntity || Boolean(entityId));

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const result = await createOwnerQrCampaign({
      name: name.trim(),
      target: fixedTarget?.target ?? target,
      targetId: fixedTarget ? fixedTarget.targetId : needsEntity ? entityId : (centralOptions?.businessId ?? ""),
    });
    setSubmitting(false);
    if (result.ok) {
      setCreated(result.campaign);
    } else {
      setError(result.error);
    }
  }

  if (created) {
    return (
      <div className="rounded-xl border border-black/[0.06] bg-black/[0.015] p-3.5">
        <p className="text-card-title font-bold text-primary">{created.name}</p>
        <div
          className="mx-auto mt-3 h-40 w-40 [&_svg]:h-full [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: created.qrSvg }}
        />
        <p className="mt-3 truncate text-center text-microcopy text-subtle">{created.qrUrl}</p>
        <p className="mt-1 text-center text-microcopy text-subtle">Points to {created.destinationPath}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <CopyButton value={created.qrUrl} label="Copy Link" className={secondaryButtonClass("sm")} />
          <a
            href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(created.qrSvg)}`}
            download={`findmi-qr-${created.code}.svg`}
            className={secondaryButtonClass("sm")}
          >
            Download SVG
          </a>
          <Link href={`/account/qr/${created.id}`} className={secondaryButtonClass("sm")}>
            View Details
          </Link>
          <button
            type="button"
            onClick={() => {
              reset();
              setOpen(false);
            }}
            className={secondaryButtonClass("sm")}
          >
            Done
          </button>
        </div>
        {/* Goal 1 — this QR always remains retrievable; leaving this
            screen never loses it. */}
        <p className="mt-2 text-center text-microcopy text-subtle">You can always reopen this QR from View Details.</p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className={secondaryButtonClass("sm")}
      >
        Create QR Code
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-black/[0.06] bg-black/[0.015] p-3.5">
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="mb-1.5 block text-microcopy font-semibold text-muted">Campaign Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={fixedTarget ? `e.g. ${fixedTarget.label} Table Sign` : `e.g. ${centralOptions?.businessName} — Market Table`}
            autoFocus
            className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none"
          />
        </label>

        {fixedTarget ? (
          <div>
            <span className="mb-1 block text-microcopy font-semibold text-muted">Destination</span>
            <p className="text-body font-semibold text-primary">{fixedTarget.label}</p>
            <p className="text-microcopy text-subtle">{TARGET_LABELS[fixedTarget.target]}</p>
          </div>
        ) : (
          centralOptions && (
            <>
              <div>
                <span className="mb-1.5 block text-microcopy font-semibold text-muted">Where should it go?</span>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { value: "business" as const, label: TARGET_LABELS.business },
                      ...(centralOptions.appearances.length > 0 ? [{ value: "appearance" as const, label: TARGET_LABELS.appearance }] : []),
                      ...(centralOptions.products.length > 0 ? [{ value: "product" as const, label: TARGET_LABELS.product }] : []),
                      ...(centralOptions.events.length > 0 ? [{ value: "event" as const, label: TARGET_LABELS.event }] : []),
                      ...(centralOptions.locations.length > 0 ? [{ value: "location" as const, label: TARGET_LABELS.location }] : []),
                    ]
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setTarget(opt.value);
                        setEntityId("");
                      }}
                      className={`rounded-full border px-3 py-1.5 text-microcopy font-semibold transition ${
                        target === opt.value
                          ? "border-findmi bg-findmi-50 text-accent"
                          : "border-black/10 bg-white text-muted hover:border-black/20"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {needsEntity && (
                <label className="block">
                  <span className="mb-1.5 block text-microcopy font-semibold text-muted">{TARGET_LABELS[target]}</span>
                  <select
                    value={entityId}
                    onChange={(e) => setEntityId(e.target.value)}
                    className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-input text-primary focus:border-ink/30 focus:outline-none"
                  >
                    <option value="">Choose one…</option>
                    {entityOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )
        )}

        {error && <p className="text-metadata text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !canSubmit}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-findmi px-4 text-button font-bold uppercase text-white transition hover:bg-findmi-600 disabled:opacity-60"
          >
            {submitting ? "Creating…" : "Create QR Code"}
          </button>
          <button type="button" onClick={() => setOpen(false)} className={secondaryButtonClass("md")}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** Product Correction — a FindMi entity supports MULTIPLE QR campaigns
 * pointing at the same destination (e.g. "Table Sign" and "Store Window"
 * both -> the same Product), each tracked/compared independently. So a
 * contextual management surface always renders BOTH: every existing
 * campaign for this entity (reopenable, never regenerated — Goal 1) AND
 * the creator, which always stays available to start another one. This
 * replaces the earlier "existing campaign replaces the create form"
 * behavior, which was wrong. */
export function QrCampaignContextualPanel({
  campaigns,
  fixedTarget,
}: {
  campaigns: { id: string; name: string; scans: number }[];
  fixedTarget: { target: QrCampaignTarget; targetId: string; label: string };
}) {
  return (
    <div className="flex flex-col gap-2">
      {campaigns.length > 0 && (
        <div>
          <p className="mb-1 text-label font-bold uppercase text-subtle">QR Campaigns</p>
          <div className="flex flex-col divide-y divide-black/[0.05] rounded-lg border border-black/[0.06] bg-white">
            {campaigns.map((c) => (
              <Link
                key={c.id}
                href={`/account/qr/${c.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2 transition hover:bg-black/[0.015]"
              >
                <span className="min-w-0 truncate text-metadata font-semibold text-primary">{c.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-microcopy text-subtle">
                  {c.scans.toLocaleString()} scans
                  <span className="flex items-center gap-0.5 font-bold text-accent">
                    View
                    <ChevronIcon direction="right" className="h-3 w-3" />
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
      <div>
        <QrCampaignCreator fixedTarget={fixedTarget} />
      </div>
    </div>
  );
}
