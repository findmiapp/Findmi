"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { processBrandImportCandidateAction } from "./actions";

/** Retry for a failed candidate — the same claim/process action (the
 * server enforces eligibility, the attempt limit and the global cap). */
export default function RetryCandidateButton({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function retry() {
    setBusy(true);
    setNote(null);
    try {
      const result = await processBrandImportCandidateAction(candidateId);
      if (result.outcome === "busy") setNote("Busy — try again in a moment.");
      else if (result.outcome !== "processed") setNote("Couldn't retry right now.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={retry}
        disabled={busy}
        className="rounded-full border border-black/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-ink hover:border-black/30 disabled:opacity-60"
      >
        {busy ? "Retrying…" : "Retry"}
      </button>
      {note && <span className="text-xs text-ink/55">{note}</span>}
    </span>
  );
}
