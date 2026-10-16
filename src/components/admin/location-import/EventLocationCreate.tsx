"use client";

import { useState } from "react";
import type { Category } from "@/lib/types";
import type { ReviewPlace } from "@/lib/event-import/types";
import type { ReviewCreatedLocation } from "@/lib/event-import/review";
import type { ExistingLocation, LocationEvidence, LocationResolution } from "@/lib/location-import/types";
import { adminCreateImportedLocation, adminReadLocationWebsite, adminResolveLocationEvidence } from "@/app/admin/(protected)/locations/import/actions";
import LocationProposalEditor, { createInputFromDraft, draftFromProposal, mergeWebsiteProposal, type LocationDraft } from "./LocationProposalEditor";

/** Admin Event Import's missing-Location step, through Location Import V1
 * (the SAME actions as Admin → Locations → Import Locations):
 *   1. match before create — an existing Location is offered, never
 *      duplicated; possible matches are the operator's choice;
 *   2. a genuinely missing place gets a reviewable proposal, optionally
 *      enriched from the Location's OWN website (never the Business's);
 *   3. Create → an unlisted Location (Needs Review), reported back keyed
 *      by the place, so every matching date / Event in the batch reuses it.
 * Nothing about the Event is saved here. */

const toCreated = (key: string, l: ExistingLocation): ReviewCreatedLocation => ({ key, id: l.id, name: l.name, address: l.address, city: l.city, state: l.state, postalCode: l.postal_code });

export default function EventLocationCreate({
  idPrefix,
  place,
  placeKey,
  categories,
  onSelected,
  onCreated,
}: {
  idPrefix: string;
  place: ReviewPlace;
  placeKey: string;
  categories: Category[];
  onSelected: (location: ReviewCreatedLocation) => void;
  /** A Location actually created here (Import Complete counts only these). */
  onCreated: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState<LocationEvidence | null>(null);
  const [resolution, setResolution] = useState<LocationResolution | null>(null);
  const [draft, setDraft] = useState<LocationDraft | null>(null);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState<"check" | "website" | "create" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    setOpen(true);
    setBusy("check");
    setMessage(null);
    const res = await adminResolveLocationEvidence({ name: place.venueName, address: place.address, city: place.city, state: place.state, postalCode: place.postalCode }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setMessage(res?.error ?? "Couldn't check this place against Findmi. Please try again.");
      return;
    }
    setEvidence(res.row.evidence);
    setResolution(res.row.resolution);
    setDraft(draftFromProposal(res.row.proposal));
    setForce(false);
  }

  async function readWebsite() {
    if (!draft || !evidence) return;
    setBusy("website");
    setMessage(null);
    const out = await adminReadLocationWebsite({ ...evidence, name: draft.name || null, address: draft.address || null, city: draft.city || null, state: draft.state || null, postalCode: draft.postalCode || null, website: draft.website || null, phone: draft.phone || null, description: draft.description || null }).catch(() => null);
    setBusy(null);
    if (out?.ok) setDraft((d) => (d ? mergeWebsiteProposal(d, out.proposal) : d));
    else setMessage(out?.error ?? "Findmi couldn't read this website. You can still create the Location from these details.");
  }

  async function create() {
    if (!draft) return;
    setBusy("create");
    setMessage(null);
    const r = await adminCreateImportedLocation(createInputFromDraft(draft), force).catch(() => ({ status: "error" as const, error: "Couldn't create this Location. Please try again." }));
    setBusy(null);
    if (r.status === "created") {
      onCreated(r.location.id);
      setOpen(false);
      onSelected(toCreated(placeKey, r.location));
    } else if (r.status === "duplicates") {
      setResolution({ kind: "ambiguous", candidates: r.duplicates });
    } else {
      setMessage(r.error);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={start} className="w-fit py-1 text-metadata font-semibold text-accent hover:underline">
        + Create New Location
      </button>
    );
  }

  const candidates = resolution?.kind === "existing" ? [resolution.location] : resolution?.kind === "ambiguous" ? resolution.candidates : [];
  const canCreate = resolution?.kind === "new" || force;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-black/[0.08] bg-black/[0.015] p-3">
      <p className="text-label font-bold uppercase text-subtle">New Findmi Location</p>
      {busy === "check" && <p className="text-metadata text-secondary">Checking Findmi for this place…</p>}

      {candidates.length > 0 && !force && (
        <div className="flex flex-col gap-2">
          <p className="text-metadata text-secondary">{resolution?.kind === "existing" ? "This place is already on Findmi — use it instead of creating another." : "This place may already be on Findmi. Choose — Findmi won’t guess."}</p>
          {candidates.map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-2 rounded-lg border border-black/[0.08] bg-white p-2.5">
              <span className="min-w-0">
                <span className="block text-body font-semibold text-primary">{c.name}</span>
                <span className="block text-metadata text-secondary">{[c.address, [c.city, c.state].filter(Boolean).join(", "), c.postal_code].filter(Boolean).join(" · ")}</span>
                <span className="block text-[11px] font-semibold text-muted">{c.is_public === false ? "Not Listed" : "Listed"}</span>
              </span>
              <button type="button" onClick={() => onSelected(toCreated(placeKey, c))} className="shrink-0 rounded-full bg-findmi px-3 py-1.5 text-metadata font-semibold text-white">
                Use This Location
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setForce(true)} className="w-fit text-metadata font-semibold text-muted hover:underline">
            Not the same place — create a new Location
          </button>
        </div>
      )}

      {resolution?.kind === "insufficient" && <p className="text-metadata text-red-700">{resolution.reason}</p>}

      {draft && (canCreate || resolution?.kind === "insufficient") && (
        <>
          <LocationProposalEditor draft={draft} onChange={(p) => setDraft((d) => (d ? { ...d, ...p } : d))} categories={categories} idPrefix={`${idPrefix}-li`} />
          <p className="text-[11px] text-muted">Website: the Location&rsquo;s own site only — not the hosting Business&rsquo;s.</p>
          <div className="flex flex-wrap items-center gap-3">
            {canCreate && (
              <button type="button" disabled={busy !== null} onClick={create} className="rounded-full bg-findmi px-4 py-2 text-metadata font-semibold text-white disabled:opacity-50">
                {busy === "create" ? "Creating…" : "Create Location"}
              </button>
            )}
            {draft.website && (
              <button type="button" disabled={busy !== null} onClick={readWebsite} className="text-metadata font-semibold text-findmi-700 hover:underline disabled:opacity-50">
                {busy === "website" ? "Reading Website…" : "Read Website"}
              </button>
            )}
          </div>
        </>
      )}

      {message && (
        <p role="alert" className="text-metadata text-amber-800">
          {message}
        </p>
      )}
      <button type="button" onClick={() => setOpen(false)} className="w-fit text-metadata font-semibold text-muted hover:underline">
        Cancel
      </button>
    </div>
  );
}
