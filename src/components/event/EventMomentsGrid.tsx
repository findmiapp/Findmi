import Link from "next/link";
import type { PublicJournalCard } from "@/lib/journal-distribution";
import JournalPreviewCard from "@/components/journal/JournalPreviewCard";

/** Findmi Moments (Public Event V2 Next Body pass; Live QA Polish pass) —
 * editorial Event imagery stays in Gallery; this is community Journal
 * content. Carousel-ready rather than a fixed grid: a single Moment stays
 * a compact card (never stretches full width), and more Moments continue
 * naturally in the same horizontally-scrollable row, with the next card
 * peeking into view on mobile — same edge-bleed/snap idiom already used by
 * JournalCollection's own "compact" rail and Upcoming Dates. The batch
 * itself stays server-bounded (see EventPublicView's fetch limit); "View
 * all Moments" only appears once real Moments exist beyond that bound. */
export default function EventMomentsGrid({
  entries,
  total,
  viewAllHref,
}: {
  entries: PublicJournalCard[];
  total: number | null;
  viewAllHref: string;
}) {
  const hasMoreRemote = total != null && total > entries.length;

  return (
    <div>
      <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {entries.map((entry) => (
          <JournalPreviewCard key={entry.id} entry={entry} variant="compact" className="w-56 shrink-0 snap-start sm:w-60" />
        ))}
      </div>
      {hasMoreRemote && (
        <Link href={viewAllHref} className="mt-3 inline-block text-metadata font-semibold text-findmi-700 hover:underline">
          View all Moments →
        </Link>
      )}
    </div>
  );
}
