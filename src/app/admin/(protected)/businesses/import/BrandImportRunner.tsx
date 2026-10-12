"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { processBrandImportCandidateAction } from "./actions";
import { BRAND_IMPORT_RUNNER_CONCURRENCY, runWithConcurrency } from "@/lib/admin/brand-import-runner";

/** Processes the batch's runnable candidates, two at a time, one server
 * action per candidate. Holds no important state: every result is
 * persisted server-side, so closing the page only stops new requests and
 * reopening the batch offers Resume for whatever is still runnable.
 * Receives only candidate ids (computed server-side). */
export default function BrandImportRunner({ runnableIds, resumed }: { runnableIds: string[]; resumed: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const stopRef = useRef(false);
  const idsRef = useRef(runnableIds);
  useEffect(() => {
    idsRef.current = runnableIds;
  }, [runnableIds]);

  async function start() {
    const ids = idsRef.current;
    if (running || ids.length === 0) return;
    stopRef.current = false;
    setCompleted(0);
    setRunning(true);
    try {
      await runWithConcurrency(
        ids,
        BRAND_IMPORT_RUNNER_CONCURRENCY,
        async (id) => {
          const result = await processBrandImportCandidateAction(id);
          setCompleted((n) => n + 1);
          router.refresh();
          return result.outcome === "busy" ? "retry_later" : "done";
        },
        { shouldStop: () => stopRef.current }
      );
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  if (!running && runnableIds.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-black/[0.07] bg-white px-4 py-3">
      {running ? (
        <>
          <span className="text-sm text-ink/70">
            Processing… {completed} done (two at a time). Keep this page open.
          </span>
          <button
            type="button"
            onClick={() => (stopRef.current = true)}
            className="rounded-full border border-black/15 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:border-black/30"
          >
            Pause
          </button>
        </>
      ) : (
        <>
          <span className="text-sm text-ink/70">
            {runnableIds.length} {runnableIds.length === 1 ? "website" : "websites"} waiting to be processed.
          </span>
          <button
            type="button"
            onClick={start}
            className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-findmi-600"
          >
            {resumed ? "Resume Processing" : "Start Processing"}
          </button>
        </>
      )}
    </div>
  );
}
