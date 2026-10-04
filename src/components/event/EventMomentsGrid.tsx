"use client";

import { useState } from "react";
import Link from "next/link";
import type { PublicJournalCard } from "@/lib/journal-distribution";
import JournalPreviewCard from "@/components/journal/JournalPreviewCard";

const INITIAL_COUNT = 4;
const STEP = 3;

/** Findmi Moments (Public Event V2 Next Body pass) — the initial grid never
 * exceeds two visual rows (4 cards at 2-up mobile, 2 rows at 3-up sm+).
 * Expanding reveals up to 3 more at a time from the already-fetched batch
 * (never a new request); once that batch is exhausted, "View all Moments"
 * takes over if more exist beyond it (see EventPublicView's fetch limit). */
export default function EventMomentsGrid({
  entries,
  total,
  viewAllHref,
}: {
  entries: PublicJournalCard[];
  total: number | null;
  viewAllHref: string;
}) {
  const [shown, setShown] = useState(Math.min(INITIAL_COUNT, entries.length));
  const visible = entries.slice(0, shown);
  const hasMoreLocal = shown < entries.length;
  const hasMoreRemote = total != null && total > entries.length;

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {visible.map((entry) => (
          <JournalPreviewCard key={entry.id} entry={entry} variant="compact" />
        ))}
      </div>
      {hasMoreLocal ? (
        <button
          type="button"
          onClick={() => setShown((s) => Math.min(entries.length, s + STEP))}
          className="mt-3 text-metadata font-semibold text-findmi-700 hover:underline"
        >
          Show {Math.min(STEP, entries.length - shown)} more
        </button>
      ) : hasMoreRemote ? (
        <Link href={viewAllHref} className="mt-3 inline-block text-metadata font-semibold text-findmi-700 hover:underline">
          View all Moments →
        </Link>
      ) : null}
    </div>
  );
}
