"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AVAILABILITY_RELATIONSHIPS,
  AVAILABILITY_RELATIONSHIP_HINTS,
  AVAILABILITY_RELATIONSHIP_LABELS,
  type AvailabilityRelationship,
} from "@/lib/business-availability-domain";
import { BULK_OP_LABELS, bulkOpReturnsToReview, mergeBulkProgress, emptyBulkProgress, type AvailabilityFilter, type BulkOp, type BulkProgress } from "@/lib/business-availability-bulk-domain";
import type { ProductSet } from "@/lib/business-product-sets-domain";
import { bulkAvailabilityAction } from "../availability-actions";

type Mode = BulkOp["kind"];
const MODES: Mode[] = ["add_relationships", "remove_relationships", "apply_set", "add_products", "remove_products", "remove_from_footprint"];

const chipClass = (on: boolean) => `flex h-9 max-w-full items-center rounded-full px-3.5 text-metadata font-semibold transition ${on ? "bg-findmi text-white" : "bg-black/[0.04] text-muted hover:text-primary"}`;

/** The bulk-action bar for Find Us Here. Acts on the Business ↔ Location entries
 * the owner selected (explicit ids, or everything matching the current filter) —
 * never on a canonical Location. One chunk per request until done, with progress;
 * only adding a way you’re there returns an entry to Pending Review (the single-entry
 * rule), and the panel says how many live entries that affects before anything is
 * applied. Products, Product Sets and removing a way you’re there keep every place
 * exactly as approved. */
export default function FindUsBulk({
  businessId,
  selectedIds,
  allMatching,
  matchingTotal,
  filter,
  liveSelected,
  products,
  productSets,
  onFinished,
  onClear,
}: {
  businessId: string;
  selectedIds: string[];
  allMatching: boolean;
  matchingTotal: number;
  filter: AvailabilityFilter;
  /** Live entries among the explicitly selected ones (unknown for "all matching"). */
  liveSelected: number | null;
  products: { id: string; name: string }[];
  productSets: ProductSet[];
  onFinished: () => void;
  onClear: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [rels, setRels] = useState<AvailabilityRelationship[]>([]);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [setId, setSetId] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [result, setResult] = useState<{ progress: BulkProgress; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const count = allMatching ? matchingTotal : selectedIds.length;
  const buildOp = (): BulkOp | null => {
    if (mode === "add_relationships" || mode === "remove_relationships") return rels.length ? { kind: mode, relationships: rels } : null;
    if (mode === "add_products" || mode === "remove_products") return productIds.length ? { kind: mode, productIds } : null;
    if (mode === "apply_set") return setId ? { kind: "apply_set", setId } : null;
    if (mode === "remove_from_footprint") return { kind: "remove_from_footprint" };
    return null;
  };
  const op = buildOp();
  const rewrites = mode !== null && bulkOpReturnsToReview({ kind: mode } as BulkOp);
  const staysLive = mode !== null && mode !== "remove_from_footprint" && !rewrites;

  const run = async () => {
    if (!op || !mode) return;
    setRunning(true);
    setError(null);
    setResult(null);
    let total = emptyBulkProgress();
    let cursor: string | null = null;
    const scope = allMatching ? ({ kind: "filter", filter } as const) : ({ kind: "ids", ids: selectedIds } as const);
    for (;;) {
      const res = await bulkAvailabilityAction(businessId, scope, op, cursor);
      if (!res.ok) {
        setError(res.error);
        setRunning(false);
        return;
      }
      total = mergeBulkProgress(total, res.progress);
      setProgress(total);
      // Each call must advance; a stalled cursor stops rather than loops.
      if (res.done || res.nextCursor === null || res.nextCursor === cursor) break;
      cursor = res.nextCursor;
    }
    setRunning(false);
    setResult({ progress: total, label: BULK_OP_LABELS[mode] });
    setMode(null);
    startTransition(() => router.refresh());
    onFinished();
  };

  if (result) {
    const p = result.progress;
    return (
      <div role="status" className="rounded-2xl border border-findmi/30 bg-findmi-50 p-3.5">
        <p className="text-body font-semibold text-findmi-700">{result.label}: {p.changed.toLocaleString()} updated</p>
        <p className="mt-0.5 text-metadata text-findmi-700/80">
          {p.unchanged > 0 ? `${p.unchanged.toLocaleString()} already matched. ` : ""}
          {p.returnedToReview > 0 ? `${p.returnedToReview.toLocaleString()} returned to Pending Review. ` : ""}
          {p.skipped.map((s) => `${s.count.toLocaleString()} skipped (${s.reason}).`).join(" ")}
        </p>
        <button type="button" onClick={() => { setResult(null); onClear(); }} className="mt-2 text-metadata font-semibold text-accent hover:underline">Done</button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-3.5 shadow-lg">
      <div className="flex items-center justify-between gap-3">
        <p className="text-body font-semibold text-primary">{count.toLocaleString()} Selected</p>
        <button type="button" onClick={onClear} disabled={running} className="text-metadata font-semibold text-muted hover:text-primary disabled:opacity-50">Clear</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Bulk actions">
        {MODES.map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} disabled={running} onClick={() => setMode(mode === m ? null : m)} className={chipClass(mode === m)}>
            {BULK_OP_LABELS[m]}
          </button>
        ))}
      </div>

      {mode && (
        <div className="mt-3 flex flex-col gap-3">
          {(mode === "add_relationships" || mode === "remove_relationships") && (
            <div role="group" aria-label="Relationships" className="flex flex-wrap gap-1.5">
              {AVAILABILITY_RELATIONSHIPS.map((r) => (
                <button key={r} type="button" aria-pressed={rels.includes(r)} title={AVAILABILITY_RELATIONSHIP_HINTS[r]} onClick={() => setRels((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]))} className={chipClass(rels.includes(r))}>
                  {AVAILABILITY_RELATIONSHIP_LABELS[r]}
                </button>
              ))}
            </div>
          )}
          {(mode === "add_products" || mode === "remove_products") && (
            <div role="group" aria-label="Products" className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {products.length === 0 && <p className="text-metadata text-muted">Add products to your catalog first.</p>}
              {products.map((p) => (
                <button key={p.id} type="button" aria-pressed={productIds.includes(p.id)} onClick={() => setProductIds((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]))} className={chipClass(productIds.includes(p.id))}>
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          )}
          {mode === "apply_set" && (
            <label className="block text-metadata font-semibold text-secondary">
              Product Set
              <select value={setId} onChange={(e) => setSetId(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-input text-primary">
                <option value="">Choose A Set</option>
                {productSets.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} · {s.productIds.length}</option>
                ))}
              </select>
              <span className="mt-1 block text-microcopy font-normal text-subtle">Adds the set’s products to each selected place. The places keep their own copy of the products.</span>
            </label>
          )}
          {mode === "remove_from_footprint" && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-metadata text-red-800">
              This takes {count.toLocaleString()} {count === 1 ? "place" : "places"} off your Find Us Here footprint. The Locations themselves stay on Findmi and nothing else changes.
            </p>
          )}
          {rewrites && (
            <p className="text-microcopy text-subtle">
              {liveSelected === null || liveSelected > 0
                ? `${liveSelected === null ? "Any live places in this selection" : `${liveSelected.toLocaleString()} live ${liveSelected === 1 ? "place" : "places"}`} will go back to Pending Review until Findmi approves the new relationship.`
                : "Places that gain a relationship go back to Pending Review until Findmi approves it."}
            </p>
          )}
          {staysLive && (
            <p className="text-microcopy text-subtle">
              {mode === "remove_relationships" ? "Taking away a way you’re there just narrows it." : "Product changes are routine upkeep."} Live places stay live and nothing goes back to review.
            </p>
          )}
          {error && <p role="alert" className="text-metadata font-semibold text-red-700">{error}</p>}
          <button
            type="button"
            disabled={!op || running}
            onClick={run}
            className={`h-11 rounded-xl px-4 text-button font-bold text-white transition disabled:opacity-50 ${mode === "remove_from_footprint" ? "bg-red-700" : "bg-findmi hover:bg-findmi-600"}`}
          >
            {running ? `Working… ${progress ? progress.processed.toLocaleString() : 0} of ${count.toLocaleString()}` : mode === "remove_from_footprint" ? `Remove ${count.toLocaleString()}` : `${BULK_OP_LABELS[mode]} To ${count.toLocaleString()}`}
          </button>
        </div>
      )}
    </div>
  );
}
