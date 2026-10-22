"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CSV_MAX_BYTES, parseCsv, type ParsedCsv } from "@/lib/locator-import/csv";
import { IMPORT_FIELDS, detectMapping, missingRequiredMapping, rowFromCells, type ColumnMapping, type ImportFieldKey } from "@/lib/locator-import/fields";
import type { MatchStatus, RowDecision } from "@/lib/locator-import/match";
import type { CommitProgress, ImportCounts, ReviewRow } from "@/lib/locator-import/server";
import type { ProductSet } from "@/lib/business-product-sets-domain";
import { AVAILABILITY_RELATIONSHIPS, AVAILABILITY_RELATIONSHIP_HINTS, AVAILABILITY_RELATIONSHIP_LABELS, type AvailabilityRelationship } from "@/lib/business-availability-domain";
import { ProductSetsBar } from "../v2/AvailableAtView";
import { commitImportAction, importDecisionsAction, importReviewAction, matchImportAction, stageImportAction } from "./actions";

/** Import Locations — upload → match columns → match places → review → import.
 * Nothing is written to Find Us Here (or created as a Location) until the last
 * step; every earlier step only stages rows for review. */

const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-xl bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass = "flex h-11 w-full items-center justify-center rounded-xl border border-black/10 bg-white px-4 text-button font-semibold text-primary transition hover:border-findmi/40";
const selectClass = "h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-input text-primary focus:border-findmi/50 focus:outline-none";
const cardClass = "rounded-2xl border border-black/[0.06] bg-white p-4";

type Step = "upload" | "map" | "matching" | "review" | "options" | "importing" | "done";

const BUCKETS: { status: MatchStatus; label: string; hint: string }[] = [
  { status: "existing", label: "Confident Matches", hint: "Already on Findmi — these will be linked." },
  { status: "possible", label: "Possible Matches", hint: "Findmi found similar places. Choose the right one, or add it as new." },
  { status: "new", label: "New Locations", hint: "Not on Findmi yet. They’re added unlisted and Findmi reviews them." },
  { status: "invalid", label: "Needs Details", hint: "Not enough to place these. They’re left out." },
  { status: "duplicate", label: "Repeats", hint: "These repeat an earlier row in your file." },
];

const addressLine = (d: { address: string | null; city: string | null; state: string | null; postalCode: string | null }) => [d.address, d.city, [d.state, d.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");

export default function ImportLocationsWizard({
  businessId,
  homeHref,
  products,
  productSets,
  productSetsAvailable,
}: {
  businessId: string;
  homeHref: string;
  products: { id: string; name: string }[];
  productSets: ProductSet[];
  productSetsAvailable: boolean;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [counts, setCounts] = useState<ImportCounts | null>(null);
  const [relationships, setRelationships] = useState<AvailabilityRelationship[]>(["stocked"]);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [summary, setSummary] = useState<CommitProgress["summary"] | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const reset = () => {
    setStep("upload");
    setText("");
    setCsv(null);
    setFileName("");
    setBatchId(null);
    setCounts(null);
    setSummary(null);
    setError(null);
  };

  async function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > CSV_MAX_BYTES) return setError("That file is too large. Keep it under 2 MB.");
    const content = await file.text();
    const parsed = parseCsv(content);
    if (!parsed.ok) return setError(parsed.error);
    setText(content);
    setFileName(file.name);
    setCsv(parsed.csv);
    setMapping(detectMapping(parsed.csv.headers));
    setStep("map");
  }

  async function stageAndMatch() {
    setError(null);
    setStep("matching");
    setWorking("Reading your file…");
    const staged = await stageImportAction(businessId, { text, label: fileName || null, mapping });
    if (!staged.ok) {
      setError(staged.error);
      setWorking(null);
      return setStep("map");
    }
    setBatchId(staged.batchId);
    setCounts(staged.counts);
    // Bounded chunks until nothing is pending (a long list never needs one long request).
    let lastRemaining = Number.POSITIVE_INFINITY;
    for (;;) {
      const matched = await matchImportAction(businessId, staged.batchId);
      // Every call must make progress; a stalled batch stops instead of looping.
      if (!matched.ok || matched.remaining >= lastRemaining) {
        setError(matched.ok ? "Matching stopped making progress. Please try again." : matched.error);
        setWorking(null);
        return setStep("map");
      }
      lastRemaining = matched.remaining;
      setCounts(matched.counts);
      setWorking(`Matching places… ${matched.counts.total - matched.remaining} of ${matched.counts.total}`);
      if (matched.remaining === 0) break;
    }
    setWorking(null);
    setStep("review");
  }

  async function runImport() {
    if (!batchId) return;
    setError(null);
    setStep("importing");
    let lastFinished = -1;
    for (;;) {
      const result = await commitImportAction(businessId, batchId, { relationships, productIds });
      if (!result.ok) {
        setError(result.error);
        setWorking(null);
        return setStep("options");
      }
      setSummary(result.summary);
      const finished = result.summary.linked + result.summary.created + result.summary.updated + result.summary.skipped + result.summary.failed;
      if (!result.done && finished <= lastFinished) {
        setError("Importing stopped making progress. Please try again.");
        setWorking(null);
        return setStep("options");
      }
      lastFinished = finished;
      setWorking(`Importing… ${finished} done`);
      if (result.done) break;
    }
    setWorking(null);
    setStep("done");
  }

  return (
    <div className="flex flex-col gap-4">
      <Steps step={step} />
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-metadata font-semibold text-red-700">
          {error}
        </p>
      )}

      {step === "upload" && <UploadStep onFile={onFile} homeHref={homeHref} />}

      {step === "map" && csv && (
        <MapStep csv={csv} fileName={fileName} mapping={mapping} onMapping={setMapping} onBack={reset} onContinue={stageAndMatch} />
      )}

      {(step === "matching" || step === "importing") && (
        <div className={cardClass} role="status" aria-live="polite">
          <p className="text-body font-semibold text-primary">{step === "matching" ? "Matching Your Places" : "Importing"}</p>
          <p className="mt-1 text-metadata text-muted">{working ?? "Working…"}</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-findmi" />
          </div>
        </div>
      )}

      {step === "review" && batchId && counts && (
        <ReviewStep businessId={businessId} batchId={batchId} counts={counts} onBack={reset} onContinue={() => setStep("options")} />
      )}

      {step === "options" && counts && (
        <div className="flex flex-col gap-4">
          <div className={cardClass}>
            <p id="imp-how" className="text-metadata font-semibold text-secondary">
              How are you there? <span className="font-normal text-muted">(Choose All That Apply)</span>
            </p>
            <p className="text-microcopy text-subtle">Applies to every place, unless a row in your file says otherwise.</p>
            <div role="group" aria-labelledby="imp-how" className="mt-2 flex flex-wrap gap-1.5">
              {AVAILABILITY_RELATIONSHIPS.map((r) => {
                const on = relationships.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={on}
                    title={AVAILABILITY_RELATIONSHIP_HINTS[r]}
                    onClick={() => setRelationships((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))}
                    className={`flex h-9 items-center rounded-full px-3.5 text-metadata font-semibold transition ${on ? "bg-findmi text-white" : "bg-black/[0.04] text-muted hover:text-primary"}`}
                  >
                    {AVAILABILITY_RELATIONSHIP_LABELS[r]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className={cardClass}>
            <p className="text-metadata font-semibold text-secondary">Products</p>
            <p className="text-microcopy text-subtle">Optional. Leave empty if this is your Brand generally. Existing products on a place are kept.</p>
            {products.length > 0 && (productSetsAvailable || productSets.length > 0) && (
              <ProductSetsBar businessId={businessId} products={products} sets={productSets} selected={productIds} onChange={setProductIds} />
            )}
            {products.length === 0 ? (
              <p className="mt-1 text-metadata text-muted">Add products to your catalog to be specific.</p>
            ) : (
              <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {products.map((p) => {
                  const on = productIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setProductIds((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]))}
                      className={`h-9 max-w-full truncate rounded-full px-3 text-metadata font-semibold transition ${on ? "bg-findmi text-white" : "bg-black/[0.04] text-muted hover:text-primary"}`}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <p className="text-metadata text-muted">
            {counts.existing} matched · {counts.new} new{counts.possible > 0 ? ` · ${counts.possible} possible (undecided ones are left out)` : ""}. Imported places start in Pending Review until Findmi approves them.
          </p>
          <button type="button" disabled={relationships.length === 0} onClick={runImport} className={primaryButtonClass}>
            Import Places
          </button>
          <button type="button" onClick={() => setStep("review")} className={secondaryButtonClass}>
            Back To Review
          </button>
        </div>
      )}

      {step === "done" && summary && (
        <div className={cardClass} role="status">
          <p className="font-display text-section-title font-bold text-primary">Import Complete</p>
          <ul className="mt-2 flex flex-col gap-1 text-body text-secondary">
            <li>{summary.linked} linked to existing Locations</li>
            <li>{summary.created} new Locations added (unlisted, for Findmi to review)</li>
            <li>{summary.updated} existing entries updated</li>
            <li>{summary.skipped} left out</li>
            {summary.failed > 0 && <li className="font-semibold text-red-700">{summary.failed} couldn’t be imported</li>}
          </ul>
          <p className="mt-2 text-metadata text-muted">Imported places are in Pending Review. Importing the same list again updates them instead of adding duplicates.</p>
          <Link href={homeHref} className={`${primaryButtonClass} mt-4`}>
            View Where To Find Us
          </Link>
          <button type="button" onClick={reset} className={`${secondaryButtonClass} mt-2`}>
            Import Another File
          </button>
        </div>
      )}
    </div>
  );
}

const STEP_LABELS: { step: Step[]; label: string }[] = [
  { step: ["upload"], label: "Upload" },
  { step: ["map"], label: "Columns" },
  { step: ["matching", "review"], label: "Review" },
  { step: ["options", "importing", "done"], label: "Import" },
];

function Steps({ step }: { step: Step }) {
  const current = STEP_LABELS.findIndex((s) => s.step.includes(step));
  return (
    <ol className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-metadata font-semibold" aria-label="Import progress">
      {STEP_LABELS.map((s, i) => (
        <li key={s.label} aria-current={i === current ? "step" : undefined} className={`flex items-center gap-1.5 ${i === current ? "text-primary" : i < current ? "text-findmi-700" : "text-subtle"}`}>
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${i <= current ? "bg-findmi text-white" : "bg-black/[0.06] text-muted"}`}>{i + 1}</span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function UploadStep({ onFile, homeHref }: { onFile: (file: File | undefined) => void; homeHref: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className={cardClass}>
        <p className="text-body font-semibold text-primary">Upload A CSV</p>
        <p className="mt-1 text-metadata text-muted">One row per place. Include at least a name, street address, city and state. A source ID column (like a store number) lets you re-import later and update instead of duplicating.</p>
        <label className="mt-3 flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600 focus-within:ring-2 focus-within:ring-findmi/40">
          Choose CSV File
          <input type="file" accept=".csv,.tsv,text/csv,text/plain" className="sr-only" aria-label="Choose CSV file" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      </div>
      <div className={`${cardClass} opacity-70`} aria-disabled="true">
        <div className="flex items-center justify-between gap-3">
          <p className="text-body font-semibold text-primary">Sync Existing Locator</p>
          <span className="rounded-full bg-black/[0.06] px-2.5 py-1 text-microcopy font-semibold text-muted">Coming Soon</span>
        </div>
        <p className="mt-1 text-metadata text-muted">Connect the store locator you already use and keep it in step. For now, export it as a CSV and upload it above.</p>
      </div>
      <Link href={homeHref} className="text-center text-metadata font-semibold text-muted hover:text-primary">
        Add A Single Location Instead
      </Link>
    </div>
  );
}

function MapStep({
  csv,
  fileName,
  mapping,
  onMapping,
  onBack,
  onContinue,
}: {
  csv: ParsedCsv;
  fileName: string;
  mapping: ColumnMapping;
  onMapping: (m: ColumnMapping) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const missing = missingRequiredMapping(mapping);
  const preview = csv.rows.slice(0, 3).map((cells) => rowFromCells(cells, mapping));
  const set = (key: ImportFieldKey, value: string) => {
    const next = { ...mapping };
    if (value === "") delete next[key];
    else {
      const index = Number(value);
      // A column maps to one field; moving it frees the field that had it.
      for (const k of Object.keys(next) as ImportFieldKey[]) if (next[k] === index) delete next[k];
      next[key] = index;
    }
    onMapping(next);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className={cardClass}>
        <p className="text-body font-semibold text-primary">Match Your Columns</p>
        <p className="mt-0.5 text-metadata text-muted">
          {fileName} · {csv.rows.length} {csv.rows.length === 1 ? "row" : "rows"}
          {csv.truncated > 0 ? ` (${csv.truncated} more left out — the limit is 10,000 per import)` : ""}
        </p>
        <div className="mt-3 flex flex-col gap-3">
          {IMPORT_FIELDS.map((f) => (
            <div key={f.key}>
              <label htmlFor={`map-${f.key}`} className="text-metadata font-semibold text-secondary">
                {f.label}
                {f.required && <span className="ml-1 text-red-700" aria-hidden="true">*</span>}
              </label>
              <select id={`map-${f.key}`} className={selectClass} value={mapping[f.key] === undefined ? "" : String(mapping[f.key])} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">{f.required ? "Choose A Column" : "Not In My File"}</option>
                {csv.headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h}
                  </option>
                ))}
              </select>
              {f.hint && <p className="mt-0.5 text-microcopy text-subtle">{f.hint}</p>}
            </div>
          ))}
        </div>
      </div>
      <div className={cardClass}>
        <p className="text-metadata font-semibold text-secondary">Preview</p>
        <ul className="mt-2 flex flex-col divide-y divide-black/[0.06]">
          {preview.map((row, i) => (
            <li key={i} className="py-2">
              <p className="truncate text-body font-semibold text-primary">{row.name ?? <span className="text-muted">No name</span>}</p>
              <p className="truncate text-metadata text-muted">{addressLine(row) || "No address"}</p>
              {row.externalId && <p className="truncate text-microcopy text-subtle">Source ID {row.externalId}</p>}
            </li>
          ))}
        </ul>
      </div>
      {missing.length > 0 && <p role="status" className="text-metadata font-semibold text-amber-800">Still needed: {missing.join(", ")}.</p>}
      <button type="button" disabled={missing.length > 0} onClick={onContinue} className={primaryButtonClass}>
        Match My Places
      </button>
      <button type="button" onClick={onBack} className={secondaryButtonClass}>
        Choose A Different File
      </button>
    </div>
  );
}

function ReviewStep({ businessId, batchId, counts, onBack, onContinue }: { businessId: string; batchId: string; counts: ImportCounts; onBack: () => void; onContinue: () => void }) {
  const first = BUCKETS.find((b) => counts[b.status as keyof ImportCounts] > 0)?.status ?? "existing";
  const [bucket, setBucket] = useState<MatchStatus>(first);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const live = useRef(0);

  const load = useCallback(
    async (status: MatchStatus, p: number, append: boolean) => {
      const token = ++live.current;
      setLoading(true);
      if (!append) setRows([]);
      const result = await importReviewAction(businessId, batchId, status, p).catch(() => null);
      if (token !== live.current) return;
      setLoading(false);
      if (!result) return setError("Couldn’t load this group. Please try again.");
      if (!result.ok) return setError(result.error);
      setError(null);
      setRows((prev) => (append ? [...prev, ...result.rows] : result.rows));
      setHasMore(result.hasMore);
    },
    [businessId, batchId]
  );

  useEffect(() => {
    setPage(0);
    load(bucket, 0, false);
  }, [bucket, load]);

  const decide = (row: ReviewRow, decision: RowDecision | null, chosenLocationId: string | null = null) => {
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, decision, chosenLocationId } : r)));
    startTransition(async () => {
      const result = await importDecisionsAction(businessId, batchId, [{ rowId: row.id, decision, chosenLocationId }]);
      if (!result.ok) setError(result.error);
    });
  };

  const meta = BUCKETS.find((b) => b.status === bucket)!;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Review groups">
        {BUCKETS.map((b) => {
          const n = counts[b.status as keyof ImportCounts] as number;
          if (n === 0 && b.status !== bucket) return null;
          const on = b.status === bucket;
          return (
            <button
              key={b.status}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setBucket(b.status)}
              className={`h-9 rounded-full px-3.5 text-metadata font-semibold transition ${on ? "bg-findmi text-white" : "bg-black/[0.04] text-muted hover:text-primary"}`}
            >
              {b.label} · {n}
            </button>
          );
        })}
      </div>
      <p className="text-metadata text-muted">{meta.hint}</p>
      {error && <p role="alert" className="text-metadata font-semibold text-red-700">{error}</p>}
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.id} className={`${cardClass} ${row.decision === "skip" ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-body font-semibold text-primary">{row.data.name ?? "No name"}</p>
                <p className="truncate text-metadata text-muted">{addressLine(row.data) || "No address"}</p>
              </div>
              <span className="shrink-0 text-microcopy text-subtle">Row {row.rowNumber}</span>
            </div>
            {row.repeat && <p className="mt-1 text-microcopy font-semibold text-findmi-700">Imported Before — Updates Its Entry</p>}
            {row.problem && <p className="mt-1 text-metadata text-amber-800">{row.problem}</p>}
            {row.status === "existing" && row.matched && (
              <p className="mt-2 rounded-lg bg-findmi-50 px-3 py-2 text-metadata text-findmi-700">
                On Findmi: <span className="font-semibold">{row.matched.name}</span> · {[row.matched.address, row.matched.city].filter(Boolean).join(", ")}
              </p>
            )}
            {row.status === "possible" && (
              <fieldset className="mt-2 flex flex-col gap-1.5">
                <legend className="sr-only">Choose the matching Location for row {row.rowNumber}</legend>
                {row.candidates.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded-lg bg-black/[0.03] px-3 py-2 text-metadata">
                    <input type="radio" name={`pick-${row.id}`} checked={row.decision === "use_match" && row.chosenLocationId === c.id} onChange={() => decide(row, "use_match", c.id)} className="mt-0.5 accent-findmi" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-primary">{c.name}</span>
                      <span className="block truncate text-muted">{[c.address, c.city, c.state].filter(Boolean).join(", ")}</span>
                    </span>
                  </label>
                ))}
                <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-black/[0.03] px-3 py-2 text-metadata">
                  <input type="radio" name={`pick-${row.id}`} checked={row.decision === "create_new"} onChange={() => decide(row, "create_new")} className="accent-findmi" />
                  <span className="font-semibold text-primary">None Of These — Add As New</span>
                </label>
              </fieldset>
            )}
            {(row.status === "existing" || row.status === "new" || row.status === "possible") && (
              <button
                type="button"
                aria-pressed={row.decision === "skip"}
                onClick={() => decide(row, row.decision === "skip" ? null : "skip")}
                className="mt-2 text-metadata font-semibold text-muted hover:text-primary"
              >
                {row.decision === "skip" ? "Skipped — Undo" : "Skip This Row"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {loading && <p role="status" className="text-metadata text-muted">Loading…</p>}
      {!loading && rows.length === 0 && <p className="text-metadata text-muted">Nothing in this group.</p>}
      {hasMore && !loading && (
        <button
          type="button"
          onClick={() => {
            setPage(page + 1);
            load(bucket, page + 1, true);
          }}
          className={secondaryButtonClass}
        >
          Show More
        </button>
      )}
      <button type="button" onClick={onContinue} className={primaryButtonClass}>
        Continue
      </button>
      <button type="button" onClick={onBack} className={secondaryButtonClass}>
        Start Over
      </button>
    </div>
  );
}
