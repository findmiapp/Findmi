"use client";

import { useState } from "react";
import CopyButton from "@/components/CopyButton";
import { createOwnerQrCampaign, type QrCampaignTarget, type CreatedQrCampaign } from "../qr-actions";
import { secondaryButtonClass } from "../../owner-ui";

/** Pro QR Self-Service V1 — the smallest create flow: name -> target type
 * -> (if needed) the specific owned entity -> create. Every relationship
 * id is verified server-side (see qr-actions.ts) — this component only
 * ever offers entities already scoped to THIS business (passed in as
 * props from page.tsx's own existing products/appearances queries, never
 * fetched again here). No design/customization options by design — V1
 * is one clean, scannable SVG QR code. */
export default function QrCampaignCreator({
  businessId,
  businessName,
  appearances,
  products,
}: {
  businessId: string;
  businessName: string;
  appearances: { id: string; name: string }[];
  products: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState<QrCampaignTarget>("business");
  const [entityId, setEntityId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedQrCampaign | null>(null);

  function reset() {
    setName("");
    setTarget("business");
    setEntityId("");
    setError(null);
    setCreated(null);
  }

  const entityOptions = target === "appearance" ? appearances : target === "product" ? products : [];
  const needsEntity = target !== "business";
  const canSubmit = name.trim().length > 0 && (!needsEntity || entityId);

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const result = await createOwnerQrCampaign(businessId, {
      name: name.trim(),
      target,
      entityId: needsEntity ? entityId : undefined,
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
        <p className="text-[13px] font-bold text-ink">{created.name}</p>
        <div
          className="mx-auto mt-3 h-40 w-40 [&_svg]:h-full [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: created.qrSvg }}
        />
        <p className="mt-3 truncate text-center text-[11px] text-ink/45">{created.qrUrl}</p>
        <p className="mt-1 text-center text-[11px] text-ink/40">Points to {created.destinationPath}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <CopyButton value={created.qrUrl} label="Copy Link" className={secondaryButtonClass("sm")} />
          <a
            href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(created.qrSvg)}`}
            download={`findmi-qr-${created.code}.svg`}
            className={secondaryButtonClass("sm")}
          >
            Download SVG
          </a>
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
          <span className="mb-1.5 block text-[11px] font-semibold text-ink/60">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`e.g. ${businessName} — Market Table`}
            className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
          />
        </label>

        <div>
          <span className="mb-1.5 block text-[11px] font-semibold text-ink/60">Where should it go?</span>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { value: "business" as const, label: "Business Page" },
                ...(appearances.length > 0 ? [{ value: "appearance" as const, label: "An Appearance" }] : []),
                ...(products.length > 0 ? [{ value: "product" as const, label: "A Product" }] : []),
              ]
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setTarget(opt.value);
                  setEntityId("");
                }}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                  target === opt.value
                    ? "border-findmi bg-findmi-50 text-findmi-700"
                    : "border-black/10 bg-white text-ink/60 hover:border-black/20"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {needsEntity && (
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold text-ink/60">
              {target === "appearance" ? "Appearance" : "Product"}
            </span>
            <select
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none"
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

        {error && <p className="text-[12px] text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !canSubmit}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-findmi px-4 text-[13px] font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
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
