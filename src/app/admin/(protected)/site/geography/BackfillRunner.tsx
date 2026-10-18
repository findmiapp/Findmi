"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { backfillDryRunAction, backfillApplyAction } from "./actions";
import type { BackfillReport } from "@/lib/geo/entity-geo-backfill";
import { BACKFILL_TABLES, type BackfillTable } from "@/lib/geo/entity-geo-core";

const TABLE_LABEL: Record<BackfillTable, string> = {
  events: "Events",
  event_occurrences: "Event Occurrences",
  locations: "Locations",
  businesses: "Businesses",
  appearances: "Appearances",
};

/** Canonical Entity Geography — the Admin-only backfill runner. Dry Run
 * writes nothing (just reports); Apply only fills rows that still have no
 * geo_place_key/geo_state_key at all, in one bounded batch per click. No
 * step here ever creates a Market, an Area, or a Market Request — see
 * lib/geo/entity-geo-backfill.ts's own doc comment. */
export default function BackfillRunner() {
  const router = useRouter();
  const [table, setTable] = useState<BackfillTable>("businesses");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<BackfillReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(mode: "dry" | "apply") {
    setBusy(true);
    setError(null);
    try {
      const result = mode === "dry" ? await backfillDryRunAction(table) : await backfillApplyAction(table);
      if (!result.ok) setError(result.error);
      else {
        setReport(result.report);
        if (mode === "apply") router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink/60">
          Table
          <select value={table} onChange={(e) => setTable(e.target.value as BackfillTable)} className="rounded-lg border border-black/10 px-3 py-2 text-sm text-ink">
            {BACKFILL_TABLES.map((t) => (
              <option key={t} value={t}>
                {TABLE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => run("dry")} className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">
          {busy ? "Working…" : "Dry Run"}
        </button>
        <button type="button" disabled={busy} onClick={() => run("apply")} className="rounded-full bg-findmi px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          Apply This Batch
        </button>
      </div>
      <p className="mt-2 text-xs text-ink/50">
        Dry Run writes nothing. Apply only fills rows with no canonical geography at all, up to 200 at a time — run it
        again to continue. Never touches city/state/postal code, never creates a Market, Area, or Market Request.
      </p>
      {error && <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {report && (
        <div className="mt-3 rounded-xl bg-black/[0.03] p-3 text-xs text-ink/70">
          <p className="font-semibold text-ink">
            {TABLE_LABEL[report.table]}: scanned {report.scanned.toLocaleString()}
            {report.applied > 0 ? ` · applied ${report.applied.toLocaleString()}` : ""}
          </p>
          <p className="mt-1">
            Resolved {report.counts.resolved} · Partial {report.counts.partial} · Ambiguous {report.counts.ambiguous} · Unresolved{" "}
            {report.counts.unresolved}
          </p>
          {report.samples.length > 0 && (
            <ul className="mt-2 max-h-48 overflow-y-auto font-mono text-[11px] leading-relaxed">
              {report.samples.map((s) => (
                <li key={s.id}>
                  {s.outcome} — {[s.city, s.state].filter(Boolean).join(", ") || "(no city/state)"}
                  {s.label ? ` → ${s.label}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
