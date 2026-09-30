"use client";

import { useState } from "react";
import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import type { QrCreatorOption, QrCreatorOptions } from "@/lib/qr-manager";
import type { QrDestinationType } from "@/lib/qr-v2";
import { createIntelligentQrCampaign, type QrContextType } from "../../../qr-manager-actions";
import type { CreatedQrCampaign } from "../../../qr-actions";
import { primaryButtonClass, secondaryButtonClass } from "../../../../owner-ui";

const CONTEXT_TYPE_META: Record<QrContextType, { label: string; helper: string }> = {
  appearance: { label: "Appearance", helper: "A specific time and place your brand is showing up." },
  business: { label: "Business", helper: "Your brand generally." },
  product: { label: "Product", helper: "A specific product." },
  event: { label: "Event", helper: "An event your business is participating in." },
  location: { label: "Location", helper: "A place where your business appears." },
};

const DESTINATION_TYPE_LABEL: Record<QrDestinationType, string> = {
  business: "Business profile",
  product: "Product page",
  event: "Event page",
  location: "Location page",
  custom: "Custom link",
};

const PLACEMENT_OPTIONS = ["Table sign", "Counter", "Packaging", "Poster", "Window", "Booth signage", "Menu", "Product display"];

function shortLabel(label: string): string {
  return label.split(" · ")[0];
}

/** QR Campaigns V2 — the Intelligent Creator. Four short, progressive
 * steps (What is this for? / Placement / Destination / Name + Review),
 * ending in Create. Context and destination are deliberately separate
 * state — choosing an Appearance for Step 1 only pre-selects a SENSIBLE
 * Step 3 default (see goToDestinationStep), it never locks it in. */
export default function QrIntelligentCreator({
  businessId,
  businessName,
  options,
}: {
  businessId: string;
  businessName: string;
  options: QrCreatorOptions;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [contextType, setContextType] = useState<QrContextType | null>(null);
  const [contextId, setContextId] = useState("");
  const [placement, setPlacement] = useState("");
  const [placementOther, setPlacementOther] = useState("");
  const [destinationType, setDestinationType] = useState<QrDestinationType | null>(null);
  const [destinationId, setDestinationId] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreatedQrCampaign | null>(null);

  function optionsFor(type: QrContextType | QrDestinationType | null): QrCreatorOption[] {
    if (type === "appearance") return options.appearances;
    if (type === "product") return options.products;
    if (type === "event") return options.events;
    if (type === "location") return options.locations;
    return [];
  }

  const availableContextTypes = (["appearance", "business", "product", "event", "location"] as QrContextType[]).filter(
    (t) => t === "business" || optionsFor(t).length > 0
  );
  const availableDestinationTypes = (["business", "product", "event", "location", "custom"] as QrDestinationType[]).filter(
    (t) => t === "business" || t === "custom" || optionsFor(t).length > 0
  );

  function labelForContext(): string {
    if (contextType === "business") return businessName;
    return optionsFor(contextType).find((o) => o.id === contextId)?.label ?? "";
  }
  function labelForDestination(): string {
    if (destinationType === "business") return `${businessName} on FindMi`;
    if (destinationType === "custom") return destinationUrl.trim() || "Custom link";
    return optionsFor(destinationType).find((o) => o.id === destinationId)?.label ?? "";
  }
  function effectivePlacement(): string | null {
    if (placement === "Other") return placementOther.trim() || null;
    return placement || null;
  }
  function defaultName(): string {
    const base = contextType === "business" ? businessName : shortLabel(labelForContext()) || businessName;
    const place = effectivePlacement();
    return place ? `${base} — ${place}` : base;
  }

  function goToPlacementStep() {
    setStep(2);
  }

  function goToDestinationStep() {
    if (!destinationType) {
      // Smart default (section 16 of the spec) — only ever a starting
      // point; the owner can still pick anything else on this step.
      if (contextType === "product" || contextType === "event" || contextType === "location") {
        setDestinationType(contextType);
        setDestinationId(contextId);
      } else if (contextType === "appearance") {
        const appearance = options.appearances.find((a) => a.id === contextId);
        if (appearance?.eventId) {
          setDestinationType("event");
          setDestinationId(appearance.eventId);
        } else {
          setDestinationType("business");
        }
      } else {
        setDestinationType("business");
      }
    }
    setStep(3);
  }

  function goToReviewStep() {
    if (!nameTouched) setName(defaultName());
    setStep(4);
  }

  const canAdvanceStep1 = Boolean(contextType) && (contextType === "business" || Boolean(contextId));
  const canAdvanceStep3 =
    Boolean(destinationType) &&
    (destinationType === "business" || (destinationType === "custom" ? destinationUrl.trim().length > 0 : Boolean(destinationId)));

  async function submit() {
    if (!contextType || !destinationType) return;
    setSubmitting(true);
    setError(null);
    const finalName = name.trim() || defaultName();
    const res = await createIntelligentQrCampaign({
      businessId,
      contextType,
      contextId: contextType === "business" ? undefined : contextId,
      destinationType,
      destinationId: destinationType === "business" || destinationType === "custom" ? undefined : destinationId,
      destinationUrl: destinationType === "custom" ? destinationUrl.trim() : undefined,
      name: finalName,
      placement: effectivePlacement(),
    });
    setSubmitting(false);
    if (res.ok) setResult(res.campaign);
    else setError(res.error);
  }

  if (result) {
    return (
      <div className="rounded-xl border border-black/[0.06] bg-white p-4">
        <p className="text-card-title font-bold text-primary">{result.name}</p>
        <div className="mx-auto mt-3 h-40 w-40 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: result.qrSvg }} />
        <p className="mt-3 truncate text-center text-microcopy text-subtle">{result.qrUrl}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <CopyButton value={result.qrUrl} label="Copy Link" className={secondaryButtonClass("sm")} />
          <a
            href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.qrSvg)}`}
            download={`findmi-qr-${result.code}.svg`}
            className={secondaryButtonClass("sm")}
          >
            Download SVG
          </a>
          <Link href={`/account/qr/${result.id}`} className={secondaryButtonClass("sm")}>
            View Details
          </Link>
        </div>
        <Link href={`/account/business/${businessId}/qr`} className={`${primaryButtonClass("md")} mt-4 w-full`}>
          Done
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-microcopy font-semibold uppercase tracking-wide text-subtle">Step {step} of 4</p>

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <p className="text-section-title font-bold text-primary">What is this QR for?</p>
          <div className="flex flex-col gap-2">
            {availableContextTypes.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setContextType(t);
                  setContextId("");
                  setDestinationType(null);
                }}
                className={`rounded-xl border p-3 text-left transition ${
                  contextType === t ? "border-findmi bg-findmi-50" : "border-black/10 bg-white hover:border-black/20"
                }`}
              >
                <span className="block text-body font-bold text-primary">{CONTEXT_TYPE_META[t].label}</span>
                <span className="mt-0.5 block text-microcopy text-subtle">{CONTEXT_TYPE_META[t].helper}</span>
              </button>
            ))}
          </div>

          {contextType && contextType !== "business" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-microcopy font-semibold text-muted">Choose {CONTEXT_TYPE_META[contextType].label.toLowerCase()}</span>
              <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto rounded-xl border border-black/10 bg-white p-1.5">
                {optionsFor(contextType).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setContextId(o.id)}
                    className={`rounded-lg px-3 py-2.5 text-left text-body transition ${
                      contextId === o.id ? "bg-findmi-50 font-semibold text-accent" : "text-primary hover:bg-black/[0.03]"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button type="button" disabled={!canAdvanceStep1} onClick={goToPlacementStep} className={`${primaryButtonClass("md")} disabled:opacity-50`}>
            Next
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <p className="text-section-title font-bold text-primary">Where will people see this QR?</p>
          <div className="flex flex-wrap gap-1.5">
            {PLACEMENT_OPTIONS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlacement(p)}
                className={`rounded-full border px-3 py-1.5 text-microcopy font-semibold transition ${
                  placement === p ? "border-findmi bg-findmi-50 text-accent" : "border-black/10 bg-white text-muted hover:border-black/20"
                }`}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPlacement("Other")}
              className={`rounded-full border px-3 py-1.5 text-microcopy font-semibold transition ${
                placement === "Other" ? "border-findmi bg-findmi-50 text-accent" : "border-black/10 bg-white text-muted hover:border-black/20"
              }`}
            >
              Other
            </button>
          </div>
          {placement === "Other" && (
            <input
              type="text"
              value={placementOther}
              onChange={(e) => setPlacementOther(e.target.value)}
              placeholder="Describe where this QR will be seen"
              maxLength={60}
              className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none"
            />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(1)} className={secondaryButtonClass("md")}>
              Back
            </button>
            <button type="button" onClick={goToDestinationStep} className={primaryButtonClass("md")}>
              Next
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3">
          <p className="text-section-title font-bold text-primary">Where should it send them?</p>
          <p className="text-microcopy text-subtle">The QR code stays the same even if you change where it sends people later.</p>
          <div className="flex flex-wrap gap-1.5">
            {availableDestinationTypes.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setDestinationType(t);
                  setDestinationId("");
                }}
                className={`rounded-full border px-3 py-1.5 text-microcopy font-semibold transition ${
                  destinationType === t ? "border-findmi bg-findmi-50 text-accent" : "border-black/10 bg-white text-muted hover:border-black/20"
                }`}
              >
                {DESTINATION_TYPE_LABEL[t]}
              </button>
            ))}
          </div>

          {destinationType && destinationType !== "business" && destinationType !== "custom" && (
            <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto rounded-xl border border-black/10 bg-white p-1.5">
              {optionsFor(destinationType).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setDestinationId(o.id)}
                  className={`rounded-lg px-3 py-2.5 text-left text-body transition ${
                    destinationId === o.id ? "bg-findmi-50 font-semibold text-accent" : "text-primary hover:bg-black/[0.03]"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}

          {destinationType === "custom" && (
            <label className="block">
              <span className="mb-1.5 block text-microcopy font-semibold text-muted">Destination link</span>
              <input
                type="text"
                value={destinationUrl}
                onChange={(e) => setDestinationUrl(e.target.value)}
                placeholder="https://example.com/promo"
                className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none"
              />
              <span className="mt-1 block text-microcopy text-subtle">Must be a secure https:// link. Checked again when you create the QR.</span>
            </label>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(2)} className={secondaryButtonClass("md")}>
              Back
            </button>
            <button
              type="button"
              disabled={!canAdvanceStep3}
              onClick={goToReviewStep}
              className={`${primaryButtonClass("md")} disabled:opacity-50`}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="mb-1.5 block text-microcopy font-semibold text-muted">Campaign name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
              placeholder={defaultName()}
              className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none"
            />
          </label>

          <div className="rounded-xl border border-black/[0.06] bg-black/[0.015] p-3.5">
            <p className="text-label font-bold uppercase text-subtle">For</p>
            <p className="text-body font-semibold text-primary">{labelForContext()}</p>
            {effectivePlacement() && (
              <>
                <p className="mt-2 text-label font-bold uppercase text-subtle">Placement</p>
                <p className="text-body text-primary">{effectivePlacement()}</p>
              </>
            )}
            <p className="mt-2 text-label font-bold uppercase text-subtle">Sends to</p>
            <p className="text-body text-primary">{labelForDestination()}</p>
          </div>

          {error && <p className="text-metadata text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(3)} className={secondaryButtonClass("md")}>
              Back
            </button>
            <button type="button" disabled={submitting} onClick={submit} className={`${primaryButtonClass("md")} flex-1 disabled:opacity-60`}>
              {submitting ? "Creating…" : "Create QR"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
