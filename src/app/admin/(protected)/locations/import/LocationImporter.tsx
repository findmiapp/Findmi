"use client";

import { useState } from "react";
import Link from "next/link";
import type { Category } from "@/lib/types";
import { runWithConcurrency } from "@/lib/admin/brand-import-runner";
import { tallyLocationImport, type LocationRowOutcome } from "@/lib/location-import/tally";
import { LOCATION_IMPORT_MAX, type ExistingLocation, type LocationEvidence, type LocationResolution } from "@/lib/location-import/types";
import LocationProposalEditor, { createInputFromDraft, draftFromProposal, mergeWebsiteProposal, type LocationDraft } from "@/components/admin/location-import/LocationProposalEditor";
import { adminAnalyzeLocationPaste, adminCreateImportedLocation, adminReadLocationWebsite, adminResolveLocationEvidence } from "./actions";

/** Admin → Locations → Import Locations (Location Import V1). Paste up to
 * 25 → Analyze (each distinct place resolved once against Findmi) →
 * Existing / New / Needs a Decision → website enrichment for missing places
 * → Review → Create Selected → Import Complete. */

type Decision = { kind: "create"; force: boolean } | { kind: "existing"; location: ExistingLocation } | { kind: "skip" };

interface Row {
  key: string;
  evidence: LocationEvidence;
  resolution: LocationResolution;
  draft: LocationDraft;
  decision: Decision | null;
  website: { status: "idle" | "reading" | "read" | "failed"; message?: string };
  result?: { outcome: LocationRowOutcome; message?: string; location?: ExistingLocation; media?: { logo: string; cover: string } };
}

const EXAMPLE = `LOCATION 1

Location Name: LAVAN Chelsea
Website: https://example.com
Street Address: 541 W 25th St
City: New York
State: NY
ZIP: 10001

=== END LOCATION 1 ===`;

function defaultDecision(r: LocationResolution): Decision | null {
  if (r.kind === "existing") return { kind: "existing", location: r.location };
  if (r.kind === "new") return { kind: "create", force: false };
  return null;
}

const locality = (l: { city: string | null; state: string | null; postal_code?: string | null }) => [[l.city, l.state].filter(Boolean).join(", "), l.postal_code].filter(Boolean).join(" ");

export default function LocationImporter({ categories }: { categories: Category[] }) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"paste" | "review" | "complete">("paste");
  const [rows, setRows] = useState<Row[]>([]);
  const [blocks, setBlocks] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"analyze" | "create" | null>(null);

  const patchRow = (key: string, patch: Partial<Row> | ((r: Row) => Partial<Row>)) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...(typeof patch === "function" ? patch(r) : patch) } : r)));

  async function readWebsite(row: Row) {
    patchRow(row.key, { website: { status: "reading" } });
    const d = row.draft;
    const outcome = await adminReadLocationWebsite({ ...row.evidence, name: d.name || null, address: d.address || null, city: d.city || null, state: d.state || null, postalCode: d.postalCode || null, website: d.website || null, phone: d.phone || null, description: d.description || null }).catch(() => ({ ok: false as const, error: "Findmi couldn't read this website." }));
    if (outcome.ok) patchRow(row.key, (r) => ({ draft: mergeWebsiteProposal(r.draft, outcome.proposal), website: { status: "read" } }));
    else patchRow(row.key, { website: { status: "failed", message: outcome.error } });
  }

  async function analyze() {
    setBusy("analyze");
    setError(null);
    try {
      const result = await adminAnalyzeLocationPaste(text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const next: Row[] = result.rows.map((r) => ({ key: r.evidence.key, evidence: r.evidence, resolution: r.resolution, draft: draftFromProposal(r.proposal), decision: defaultDecision(r.resolution), website: { status: "idle" } }));
      setRows(next);
      setBlocks(result.blocks);
      setPhase("review");
      // Enrich only places that aren't already on Findmi, 2 websites at a time.
      const toRead = next.filter((r) => r.resolution.kind !== "existing" && r.draft.website);
      await runWithConcurrency(toRead.map((r) => r.key), 2, async (key) => {
        const row = next.find((r) => r.key === key);
        if (row) await readWebsite(row);
        return "done";
      });
    } catch {
      setError("Couldn't analyze these Locations. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function checkAgain(row: Row) {
    const d = row.draft;
    const res = await adminResolveLocationEvidence({ name: d.name, address: d.address, city: d.city, state: d.state, postalCode: d.postalCode, website: d.website }).catch(() => null);
    if (!res?.ok) return;
    patchRow(row.key, { resolution: res.row.resolution, decision: defaultDecision(res.row.resolution), result: undefined });
  }

  async function createSelected() {
    setBusy("create");
    // One at a time: a place created earlier in this batch is found by the
    // next one's duplicate check instead of being created twice.
    for (const row of rows) {
      if (row.result?.outcome === "created" || row.decision?.kind !== "create") continue;
      const r = await adminCreateImportedLocation(createInputFromDraft(row.draft), row.decision.force).catch(() => ({ status: "error" as const, error: "Couldn't create this Location." }));
      if (r.status === "created") patchRow(row.key, { result: { outcome: "created", location: r.location, media: "media" in r ? r.media : undefined } });
      else if (r.status === "duplicates") patchRow(row.key, { resolution: { kind: "ambiguous", candidates: r.duplicates }, decision: null, result: { outcome: "unresolved", message: "Findmi already has a place like this — choose it, or Create Anyway." } });
      else patchRow(row.key, { result: { outcome: "failed", message: r.error } });
    }
    setBusy(null);
    setPhase("complete");
  }

  const outcomes: LocationRowOutcome[] = rows.map((r) => r.result?.outcome === "created" || r.result?.outcome === "failed" ? r.result.outcome : r.decision?.kind === "existing" ? "existing" : r.decision?.kind === "skip" ? "skipped" : "unresolved");
  const toCreate = rows.filter((r) => r.decision?.kind === "create" && r.result?.outcome !== "created").length;

  if (phase === "complete") {
    const t = tallyLocationImport(outcomes);
    const skipped = outcomes.filter((o) => o === "skipped").length;
    const line = (label: string, n: number) => (
      <li className="flex justify-between border-b border-black/[0.05] py-1.5 text-body">
        <span className="text-secondary">{label}</span>
        <span className="font-semibold text-primary">{n}</span>
      </li>
    );
    return (
      <section className="flex flex-col gap-3 rounded-2xl border border-black/[0.07] bg-white p-4">
        <h1 className="font-display text-xl font-bold tracking-tight text-ink">Import Complete</h1>
        <ul>
          {line("Locations Submitted", t.submitted)}
          {line("Existing Locations Matched", t.existingMatched)}
          {line("New Locations Created", t.created)}
          {line("Ambiguous / Needs Resolution", t.needsResolution)}
          {skipped > 0 && line("Skipped", skipped)}
          {line("Failed", t.failed)}
          {line("Awaiting Review (Not Listed)", t.awaitingReview)}
        </ul>
        {blocks > t.submitted && <p className="text-metadata text-secondary">{blocks} pasted blocks named {t.submitted} distinct places — repeats were resolved once.</p>}
        {rows.some((r) => r.result?.message) && (
          <ul className="flex flex-col gap-1 text-metadata text-secondary">
            {rows.filter((r) => r.result?.message).map((r) => (
              <li key={r.key}>
                <span className="font-semibold text-primary">{r.draft.name || r.evidence.labels[0]}:</span> {r.result!.message}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/locations?review=1" className="rounded-full bg-findmi px-4 py-2 text-metadata font-semibold text-white">
            Review Locations
          </Link>
          <Link href="/admin/locations" className="rounded-full border border-black/10 px-4 py-2 text-metadata font-semibold text-primary">
            View Locations
          </Link>
          {t.needsResolution > 0 && (
            <button type="button" onClick={() => setPhase("review")} className="rounded-full border border-black/10 px-4 py-2 text-metadata font-semibold text-primary">
              Back to Review
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setRows([]);
              setText("");
              setPhase("paste");
            }}
            className="rounded-full border border-black/10 px-4 py-2 text-metadata font-semibold text-primary"
          >
            Import More
          </button>
        </div>
      </section>
    );
  }

  if (phase === "paste") {
    return (
      <section className="flex flex-col gap-3 rounded-2xl border border-black/[0.07] bg-white p-4">
        <h1 className="font-display text-xl font-bold tracking-tight text-ink">Import Locations</h1>
        <p className="text-metadata text-secondary">
          Paste up to {LOCATION_IMPORT_MAX} Locations. Findmi checks each one against existing Locations first — nothing is created until you review it, and new Locations start Not Listed.
        </p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} placeholder={EXAMPLE} autoCapitalize="sentences" maxLength={60000} className="w-full rounded-xl border border-black/10 p-3 font-mono text-[13px] text-primary outline-none focus:border-findmi" />
        {error && (
          <p role="alert" className="text-metadata text-red-700">
            {error}
          </p>
        )}
        <button type="button" disabled={busy !== null || !text.trim()} onClick={analyze} className="w-fit rounded-full bg-findmi px-5 py-2 text-metadata font-semibold text-white disabled:opacity-50">
          {busy === "analyze" ? "Analyzing…" : "Analyze"}
        </button>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-xl font-bold tracking-tight text-ink">Review Locations</h1>
        <p className="text-metadata text-secondary">
          {rows.length} {rows.length === 1 ? "place" : "places"}
          {blocks > rows.length ? ` · from ${blocks} pasted` : ""}
        </p>
      </div>
      {rows.map((row) => (
        <LocationRow key={row.key} row={row} categories={categories} onPatch={(p) => patchRow(row.key, p)} onReadWebsite={() => readWebsite(row)} onCheckAgain={() => checkAgain(row)} />
      ))}
      <div className="sticky bottom-3 flex flex-wrap items-center gap-3 rounded-2xl border border-black/[0.07] bg-white/95 p-3 shadow-sm backdrop-blur">
        <button type="button" disabled={busy !== null} onClick={createSelected} className="rounded-full bg-findmi px-5 py-2 text-metadata font-semibold text-white disabled:opacity-50">
          {busy === "create" ? "Creating…" : toCreate > 0 ? `Create ${toCreate} Selected` : "Finish"}
        </button>
        <span className="text-metadata text-secondary">New Locations are created Not Listed — publish them from Needs Review.</span>
      </div>
    </div>
  );
}

const STATUS: Record<LocationResolution["kind"], { label: string; tone: string }> = {
  existing: { label: "On Findmi", tone: "bg-findmi-50 text-findmi-700" },
  new: { label: "New Location", tone: "bg-black/[0.05] text-primary" },
  ambiguous: { label: "Needs a Decision", tone: "bg-amber-50 text-amber-800" },
  insufficient: { label: "Not Specific Enough", tone: "bg-red-50 text-red-700" },
};

function LocationRow({ row, categories, onPatch, onReadWebsite, onCheckAgain }: { row: Row; categories: Category[]; onPatch: (p: Partial<Row>) => void; onReadWebsite: () => void; onCheckAgain: () => void }) {
  const { resolution, decision, draft } = row;
  const created = row.result?.outcome === "created";
  const status = created ? { label: "Created · Not Listed", tone: "bg-findmi-50 text-findmi-700" } : STATUS[resolution.kind];
  const creating = decision?.kind === "create" && !created;
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-black/[0.07] bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-body font-semibold text-primary">{draft.name || row.evidence.name || "Unnamed Place"}</p>
          <p className="text-metadata text-secondary">{[draft.address, [draft.city, draft.state].filter(Boolean).join(", "), draft.postalCode].filter(Boolean).join(" · ") || "No address"}</p>
          <p className="text-[11px] text-muted">{row.evidence.labels.join(", ")}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${status.tone}`}>{status.label}</span>
      </div>
      {row.evidence.warnings.map((w) => (
        <p key={w} className="text-metadata text-amber-800">
          {w}
        </p>
      ))}
      {row.result?.message && <p className={`text-metadata ${row.result.outcome === "failed" ? "text-red-700" : "text-amber-800"}`}>{row.result.message}</p>}

      {created && row.result?.location && (
        <p className="text-metadata text-secondary">
          Created Not Listed{row.result.media && (row.result.media.logo === "failed" || row.result.media.cover === "failed") ? " — an image couldn't be saved; the Findmi fallback shows instead" : ""}.{" "}
          <Link href={`/admin/locations/${row.result.location.id}`} className="font-semibold text-findmi-700 hover:underline">
            Open
          </Link>
        </p>
      )}

      {!created && resolution.kind === "existing" && (
        <ExistingChoice location={resolution.location} chosen={decision?.kind === "existing"} onUse={() => onPatch({ decision: { kind: "existing", location: resolution.location } })} />
      )}
      {!created && resolution.kind === "existing" && decision?.kind === "existing" && (
        <button type="button" onClick={() => onPatch({ decision: { kind: "create", force: true } })} className="w-fit text-metadata font-semibold text-muted hover:underline">
          Not the same place — create a separate Location
        </button>
      )}

      {!created && resolution.kind === "ambiguous" && (
        <div className="flex flex-col gap-2">
          <p className="text-metadata text-secondary">Findmi has {resolution.candidates.length === 1 ? "a place" : "places"} that may be this one. Choose — Findmi won&rsquo;t guess.</p>
          {resolution.candidates.map((c) => (
            <ExistingChoice key={c.id} location={c} chosen={decision?.kind === "existing" && decision.location.id === c.id} onUse={() => onPatch({ decision: { kind: "existing", location: c } })} />
          ))}
          <label className="flex items-center gap-2 text-metadata text-primary">
            <input type="radio" checked={decision?.kind === "create"} onChange={() => onPatch({ decision: { kind: "create", force: true } })} /> None of these — Create New Location
          </label>
        </div>
      )}

      {!created && resolution.kind === "insufficient" && (
        <p className="text-metadata text-red-700">{resolution.reason}</p>
      )}

      {!created && (resolution.kind !== "existing" || decision?.kind === "create") && (
        <details open={creating || resolution.kind === "insufficient"} className="rounded-xl border border-black/[0.06] p-3">
          <summary className="cursor-pointer text-metadata font-semibold text-secondary">Location Details</summary>
          <div className="mt-3 flex flex-col gap-3">
            <LocationProposalEditor draft={draft} onChange={(p) => onPatch({ draft: { ...draft, ...p } })} categories={categories} idPrefix={`loc-${row.key.replace(/[^a-z0-9]/gi, "")}`} />
            <div className="flex flex-wrap items-center gap-3">
              {draft.website && (
                <button type="button" disabled={row.website.status === "reading"} onClick={onReadWebsite} className="text-metadata font-semibold text-findmi-700 hover:underline disabled:opacity-50">
                  {row.website.status === "reading" ? "Reading Website…" : row.website.status === "failed" ? "Retry Website" : row.website.status === "read" ? "Read Website Again" : "Read Website"}
                </button>
              )}
              {resolution.kind === "insufficient" && (
                <button type="button" onClick={onCheckAgain} className="text-metadata font-semibold text-findmi-700 hover:underline">
                  Check Again
                </button>
              )}
            </div>
            {row.website.status === "failed" && <p className="text-metadata text-amber-800">{row.website.message}</p>}
          </div>
        </details>
      )}

      {!created && resolution.kind !== "insufficient" && (
        <div className="flex flex-wrap gap-3">
          {resolution.kind === "new" && (
            <label className="flex items-center gap-2 text-metadata font-semibold text-primary">
              <input type="checkbox" checked={decision?.kind === "create"} onChange={(e) => onPatch({ decision: e.target.checked ? { kind: "create", force: false } : { kind: "skip" } })} /> Create This Location
            </label>
          )}
          {decision?.kind !== "skip" && resolution.kind !== "new" && (
            <button type="button" onClick={() => onPatch({ decision: { kind: "skip" } })} className="text-metadata font-semibold text-muted hover:underline">
              Skip
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function ExistingChoice({ location, chosen, onUse }: { location: ExistingLocation; chosen: boolean; onUse: () => void }) {
  return (
    <div className={`flex items-start justify-between gap-2 rounded-xl border p-2.5 ${chosen ? "border-findmi bg-findmi-50/40" : "border-black/[0.08]"}`}>
      <span className="min-w-0">
        <span className="block text-body font-semibold text-primary">{location.name}</span>
        <span className="block text-metadata text-secondary">{[location.address, locality(location)].filter(Boolean).join(" · ")}</span>
        <span className="block text-[11px] font-semibold text-muted">
          {location.is_public === false ? "Not Listed" : "Listed"}
          {location.category ? ` · ${location.category}` : ""}
        </span>
      </span>
      {chosen ? (
        <span className="shrink-0 text-[11px] font-bold uppercase text-findmi-700">Using This</span>
      ) : (
        <button type="button" onClick={onUse} className="shrink-0 rounded-full bg-findmi px-3 py-1.5 text-metadata font-semibold text-white">
          Use This Location
        </button>
      )}
    </div>
  );
}
