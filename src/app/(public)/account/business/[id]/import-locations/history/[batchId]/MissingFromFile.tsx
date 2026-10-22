"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { bulkAvailabilityAction } from "../../../availability-actions";
import type { MissingEntry } from "@/lib/locator-import/history";

/** Places an earlier import added that this file no longer lists. Shown for
 * information — nothing is removed or hidden because a file omits it. The owner may
 * take chosen places off their footprint (the Location itself is never touched). */
export default function MissingFromFile({ businessId, total, entries }: { businessId: string; total: number; entries: MissingEntry[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toggle = (id: string) => setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const remove = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await bulkAvailabilityAction(businessId, { kind: "ids", ids: [...picked] }, { kind: "remove_from_footprint" }, null);
      if (!result.ok) return setMessage(result.error);
      setPicked(new Set());
      setConfirming(false);
      setMessage(`Removed ${result.progress.changed} from your footprint.`);
      router.refresh();
    });

  return (
    <section aria-labelledby="ih-missing">
      <h2 id="ih-missing" className="font-display text-card-title-lg font-bold text-primary">Not In This File</h2>
      <p className="mt-1 text-metadata text-muted">
        {total.toLocaleString()} {total === 1 ? "place" : "places"} from an earlier import of this source {total === 1 ? "isn’t" : "aren’t"} in this file. They stay on your footprint unless you choose to remove them.
      </p>
      <ul className="mt-3 flex flex-col divide-y divide-black/[0.06] rounded-2xl border border-black/[0.06] bg-white">
        {entries.map((e) => (
          <li key={e.availabilityId} className="flex items-center gap-3 px-3.5 py-2.5">
            <input type="checkbox" checked={picked.has(e.availabilityId)} onChange={() => toggle(e.availabilityId)} aria-label={`Select ${e.location.name}`} className="h-5 w-5 shrink-0 accent-findmi" />
            <span className="min-w-0 flex-1">
              <Link href={`/location/${e.location.slug}`} className="block truncate text-body font-semibold text-primary hover:underline">{e.location.name}</Link>
              <span className="block truncate text-metadata text-muted">{[e.location.city, e.location.state].filter(Boolean).join(", ")} · Source ID {e.externalId}</span>
            </span>
          </li>
        ))}
      </ul>
      {total > entries.length && <p className="mt-2 text-microcopy text-subtle">Showing the first {entries.length}. Find the rest under Find Us Here → Imported.</p>}
      {picked.size > 0 && !confirming && (
        <button type="button" onClick={() => setConfirming(true)} className="mt-3 h-11 w-full rounded-xl border border-black/10 bg-white px-4 text-button font-semibold text-primary transition hover:border-red-300">
          Remove {picked.size} From My Footprint
        </button>
      )}
      {confirming && (
        <div role="alertdialog" aria-label="Confirm removal" className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3.5">
          <p className="text-body font-semibold text-red-800">Remove {picked.size} {picked.size === 1 ? "place" : "places"} from your footprint?</p>
          <p className="mt-0.5 text-metadata text-red-800/80">This takes them off Find Us Here only. The Locations stay on Findmi and nothing else changes.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={pending} onClick={remove} className="h-11 flex-1 rounded-xl bg-red-700 px-4 text-button font-bold text-white disabled:opacity-60">Remove</button>
            <button type="button" onClick={() => setConfirming(false)} className="h-11 rounded-xl border border-black/10 bg-white px-4 text-button font-semibold text-primary">Cancel</button>
          </div>
        </div>
      )}
      {message && <p role="status" className="mt-2 text-metadata font-semibold text-secondary">{message}</p>}
    </section>
  );
}
