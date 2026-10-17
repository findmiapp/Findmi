"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { censusImportStepAction } from "./actions";
import { CENSUS_IMPORT_ORDER, CENSUS_SOURCES, type CensusDataset } from "@/lib/geo/census-format";

type Line = { at: string; text: string; tone?: "error" | "done" };

/** Runs the Census import from the browser: calls ONE bounded server
 * action slice at a time until every dataset is complete. Nothing runs
 * unless an Admin presses the button; closing the tab simply pauses it
 * (progress is saved server-side, Resume picks up from the cursor). */
export default function CensusImportRunner({ defaultVintage }: { defaultVintage: string }) {
  const router = useRouter();
  const [vintage, setVintage] = useState(defaultVintage);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const stop = useRef(false);

  const log = (text: string, tone?: Line["tone"]) => setLines((l) => [...l.slice(-200), { at: new Date().toLocaleTimeString(), text, tone }]);

  async function run(mode: "resume" | "rerun") {
    if (running) return;
    stop.current = false;
    setRunning(true);
    const started = Date.now();
    log(mode === "rerun" ? `Re-running every dataset for ${vintage} (idempotency check)…` : `Importing ${vintage}…`);
    let totalUpserted = 0;
    let skipped = 0;
    try {
      const queue: (CensusDataset | undefined)[] = mode === "rerun" ? [...CENSUS_IMPORT_ORDER] : [undefined];
      for (const restart of queue) {
        let first = true;
        for (let guard = 0; guard < 400 && !stop.current; guard++) {
          const res = await censusImportStepAction(vintage, first ? restart : undefined);
          first = false;
          if (!res.ok) {
            log(res.error, "error");
            return;
          }
          const s = res.step;
          totalUpserted += s.upserted;
          skipped += s.skippedLinks;
          log(`${CENSUS_SOURCES[s.dataset].label}: ${s.cursor.toLocaleString()} / ${s.total.toLocaleString()} rows${s.skippedLinks ? ` · ${s.skippedLinks} links skipped` : ""}${s.retired ? ` · ${s.retired} retired` : ""}`);
          if (restart ? s.status === "complete" : s.next === null) break;
        }
      }
      if (stop.current) log("Paused. Resume continues from the saved position.");
      else log(`Done in ${Math.round((Date.now() - started) / 1000)}s · ${totalUpserted.toLocaleString()} rows written · ${skipped.toLocaleString()} links skipped.`, "done");
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink/60">
          Vintage
          <input value={vintage} onChange={(e) => setVintage(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" autoCapitalize="none" className="w-24 rounded-lg border border-black/10 px-3 py-2 text-sm text-ink" />
        </label>
        <button type="button" disabled={running || vintage.length !== 4} onClick={() => run("resume")} className="rounded-full bg-findmi px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {running ? "Importing…" : "Start / Resume Import"}
        </button>
        <button type="button" disabled={running || vintage.length !== 4} onClick={() => run("rerun")} className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">
          Re-Run (Verify Idempotent)
        </button>
        {running && (
          <button type="button" onClick={() => (stop.current = true)} className="rounded-full px-3 py-2 text-sm font-semibold text-ink/60">
            Pause
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-ink/50">Downloads the official U.S. Census files on the server, a slice at a time. Safe to run again: every write is an upsert.</p>
      {lines.length > 0 && (
        <ol className="mt-3 max-h-64 overflow-y-auto rounded-xl bg-black/[0.03] p-3 font-mono text-[11px] leading-relaxed">
          {lines.map((l, i) => (
            <li key={i} className={l.tone === "error" ? "text-red-700" : l.tone === "done" ? "font-bold text-findmi-700" : "text-ink/70"}>
              {l.at} — {l.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
