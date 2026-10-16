"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Category } from "@/lib/types";
import type { ReviewPlace } from "@/lib/event-import/types";
import type { ReviewCreatedLocation } from "@/lib/event-import/review";
import type { ExistingLocation, LocationEvidence, LocationResolution } from "@/lib/location-import/types";
import type { PreparedLocation } from "@/lib/entity-prepare";
import { adminCreateImportedLocation, adminReadLocationWebsite } from "@/app/admin/(protected)/locations/import/actions";
import LocationProposalEditor, { createInputFromDraft, draftFromProposal, mergeWebsiteProposal, type LocationDraft } from "./LocationProposalEditor";

/** Admin Event Import's missing-Location step, through Location Import V1
 * (the SAME actions as Admin → Locations → Import Locations):
 *   1. prepared WITHOUT a click — match before create (an existing Location
 *      is offered, never duplicated; possible matches are the operator's
 *      choice), then the pasted Location Website, then — only if that's
 *      missing or unreadable — contextual web research for the place's
 *      official site, read by the same Location Import reader;
 *   2. shown as "New Location · Ready For Review" with what Findmi knows
 *      and where each fact came from;
 *   3. Review & Create → an unlisted Location (Needs Review), reported back
 *      keyed by the place, so every matching date / Event reuses it.
 * Each distinct place is prepared ONCE per batch (LocationPrepContext).
 * Nothing about the Event is saved here. */

export type LocationPrepState = { status: "pending" } | { status: "done"; prepared: PreparedLocation } | { status: "error"; error: string };

/** Batch-level preparation, owned by the importer: `ensure` asks once per
 * place key; `preps` holds every result. */
export const LocationPrepContext = createContext<{ preps: Record<string, LocationPrepState>; ensure: (key: string, place: ReviewPlace) => void } | null>(null);

const toCreated = (key: string, l: ExistingLocation): ReviewCreatedLocation => ({ key, id: l.id, name: l.name, address: l.address, city: l.city, state: l.state, postalCode: l.postal_code });

const SOURCE_LABEL = { pasted: "Pasted", research: "Web Research" } as const;

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
  const prep = useContext(LocationPrepContext);
  const state = prep?.preps[placeKey];
  useEffect(() => {
    if (prep && !prep.preps[placeKey]) prep.ensure(placeKey, place);
  }, [prep, placeKey, place]);

  const prepared = state?.status === "done" ? state.prepared : null;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LocationDraft | null>(null);
  const [resolution, setResolution] = useState<LocationResolution | null>(null);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState<"website" | "create" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Adopt the prepared proposal once (the operator's edits then win).
  useEffect(() => {
    if (prepared && !draft) {
      setDraft(draftFromProposal(prepared.proposal));
      setResolution(prepared.resolution);
    }
  }, [prepared, draft]);

  if (!state || state.status === "pending") {
    return <p className="text-metadata text-secondary">Preparing this place for Review…</p>;
  }
  if (state.status === "error" || !prepared || !draft || !resolution) {
    return <p className="text-metadata text-amber-800">{state.status === "error" ? state.error : "Couldn’t prepare this place."}</p>;
  }
  const evidence: LocationEvidence = prepared.evidence;

  async function readWebsite() {
    if (!draft) return;
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
      onSelected(toCreated(placeKey, r.location));
    } else if (r.status === "duplicates") {
      setResolution({ kind: "ambiguous", candidates: r.duplicates });
      setForce(false);
    } else {
      setMessage(r.error);
    }
  }

  const candidates = resolution.kind === "existing" ? [resolution.location] : resolution.kind === "ambiguous" ? resolution.candidates : [];
  const isNew = resolution.kind === "new" || force;
  const category = draft.categoryId ? categories.find((c) => c.id === draft.categoryId)?.name ?? null : null;
  const site = prepared.website;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-findmi/30 bg-findmi-50/40 p-3" data-location-prep={resolution.kind}>
      {candidates.length > 0 && !force && (
        <div className="flex flex-col gap-2">
          <p className="text-label font-bold uppercase text-subtle">{resolution.kind === "existing" ? "On Findmi" : "Possible Findmi Location"}</p>
          <p className="text-metadata text-secondary">{resolution.kind === "existing" ? "This place is already on Findmi — use it instead of creating another." : "This place may already be on Findmi. Choose — Findmi won’t guess."}</p>
          {candidates.map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-2 rounded-lg border border-black/[0.08] bg-white p-2.5">
              <span className="min-w-0">
                <span className="block text-body font-semibold text-primary">{c.name}</span>
                <span className="block text-metadata text-secondary">{[c.address, [c.city, c.state].filter(Boolean).join(", "), c.postal_code].filter(Boolean).join(" · ")}</span>
                <span className="block text-[11px] font-semibold text-muted">Existing Findmi Data · {c.is_public === false ? "Not Listed" : "Listed"}</span>
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

      {resolution.kind === "insufficient" && <p className="text-metadata text-red-700">{resolution.reason}</p>}

      {isNew && (
        <>
          <div className="flex items-start gap-3">
            {draft.useLogo && draft.logo?.preview && (
              // Verified, re-encoded data-URI preview (never a remote URL).
              // eslint-disable-next-line @next/next/no-img-element
              <img src={draft.logo.preview} alt="" className="h-12 w-12 shrink-0 rounded-lg bg-white object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold text-primary">{draft.name || evidence.name}</p>
              <p className="text-metadata text-secondary">{[draft.address, [draft.city, draft.state].filter(Boolean).join(", "), draft.postalCode].filter(Boolean).join(" · ")}</p>
              <p className="text-[11px] font-bold uppercase text-findmi-700">New Location · Ready For Review</p>
              <p className="mt-1 text-metadata text-secondary">
                Website: {site.url ? <span className="font-semibold text-primary">{site.url.replace(/^https:\/\//, "").replace(/\/$/, "")}</span> : "Not found"}
                {site.source && <span className="text-muted"> · {SOURCE_LABEL[site.source]}{site.read === "failed" ? " (couldn’t be read)" : site.read === "read" ? " · Official Website read" : ""}</span>}
              </p>
              {category && <p className="text-metadata text-secondary">Category: {category}</p>}
            </div>
            {draft.useCover && draft.cover?.preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={draft.cover.preview} alt="" className="h-12 w-20 shrink-0 rounded-lg bg-white object-cover" />
            )}
          </div>
          {prepared.research && prepared.research.sources.length > 0 && (
            <details className="text-metadata text-secondary">
              <summary className="cursor-pointer font-semibold">Web Research Sources</summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {prepared.research.sources.slice(0, 5).map((s) => (
                  <li key={s.url} className="truncate">
                    <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-findmi-700 hover:underline">
                      {s.title || s.url}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!open ? (
            <button type="button" onClick={() => setOpen(true)} className="w-fit rounded-full bg-findmi px-4 py-2 text-metadata font-semibold text-white">
              Review &amp; Create
            </button>
          ) : (
            <>
              <LocationProposalEditor draft={draft} onChange={(p) => setDraft((d) => (d ? { ...d, ...p } : d))} categories={categories} idPrefix={`${idPrefix}-li`} />
              <p className="text-[11px] text-muted">Website: the Location&rsquo;s own site only — not the hosting Business&rsquo;s. Created Not Listed (Needs Review); no owner.</p>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" disabled={busy !== null} onClick={create} className="rounded-full bg-findmi px-4 py-2 text-metadata font-semibold text-white disabled:opacity-50">
                  {busy === "create" ? "Creating…" : "Create Location"}
                </button>
                {draft.website && (
                  <button type="button" disabled={busy !== null} onClick={readWebsite} className="text-metadata font-semibold text-findmi-700 hover:underline disabled:opacity-50">
                    {busy === "website" ? "Reading Website…" : "Read Website"}
                  </button>
                )}
                <button type="button" onClick={() => setOpen(false)} className="text-metadata font-semibold text-muted hover:underline">
                  Close
                </button>
              </div>
            </>
          )}
        </>
      )}

      {message && (
        <p role="alert" className="text-metadata text-amber-800">
          {message}
        </p>
      )}
    </div>
  );
}
