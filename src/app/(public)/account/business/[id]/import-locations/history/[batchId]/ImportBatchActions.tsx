"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cancelImportAction } from "../../actions";

/** An unfinished import can be picked back up exactly where it stopped, or discarded.
 * Discarding only closes the import; nothing it staged has touched Find Us Here. */
export default function ImportBatchActions({ businessId, batchId, resumeHref }: { businessId: string; batchId: string; resumeHref: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const discard = () =>
    startTransition(async () => {
      setError(null);
      const result = await cancelImportAction(businessId, batchId);
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white p-4">
      <p className="text-body font-semibold text-primary">This Import Wasn’t Finished</p>
      <p className="mt-0.5 text-metadata text-muted">Nothing from it has been added to Find Us Here. Pick it up where you left off, or discard it.</p>
      <div className="mt-3 flex gap-2">
        <Link href={resumeHref} className="flex h-11 flex-1 items-center justify-center rounded-xl bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600">
          Continue Import
        </Link>
        <button type="button" disabled={pending} onClick={discard} className="h-11 rounded-xl border border-black/10 bg-white px-4 text-button font-semibold text-primary transition hover:border-red-300 disabled:opacity-60">
          Discard
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-metadata font-semibold text-red-700">{error}</p>}
    </div>
  );
}
