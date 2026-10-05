import type { ReactNode } from "react";
import Link from "next/link";
import type { PublicJournalCard } from "@/lib/journal-distribution";
import JournalPreviewCard from "@/components/journal/JournalPreviewCard";
import ChevronIcon from "@/components/ChevronIcon";

/** The one compact Moment-card presentation shared by every public surface
 * that shows Moments (Event, Business, Location, Product) — a Findmi
 * product primitive, not an entity-specific widget. Carousel-ready rather
 * than a fixed grid: a single Moment stays a compact card (never stretches
 * full width), and more Moments continue naturally in the same
 * horizontally-scrollable row, with the next card peeking into view on
 * mobile — same edge-bleed/snap idiom already used by JournalCollection's
 * own "compact" rail and Upcoming Dates. The batch itself stays
 * server-bounded by whatever limit the caller's own getPublicJournalCollection
 * call used; "View all Moments" only appears once real Moments exist
 * beyond that bound. Carries no subject-specific wording — callers supply
 * their own heading above it.
 *
 * Moment V1A — `emptyState` is the one small additive prop: when there are
 * zero entries, render it instead of nothing (so a page's own "+ Add
 * Moment" capability stays discoverable even with no Moments yet — see
 * Business/Location/Product's own usage). Omitting it keeps this
 * component's exact prior behavior (render nothing when empty), which
 * /journal/page.tsx-adjacent callers that never pass it don't need to
 * change. This component never renders its own "+ Add Moment" action —
 * that stays page-owned (next to each page's own heading, mirroring the
 * Event page's existing pattern), so there is never a duplicated CTA. */
export default function MomentsCarousel({
  entries,
  total,
  viewAllHref,
  emptyState,
}: {
  entries: PublicJournalCard[];
  total: number | null;
  viewAllHref: string;
  emptyState?: ReactNode;
}) {
  if (entries.length === 0) return emptyState ?? null;
  const hasMoreRemote = total != null && total > entries.length;

  return (
    <div>
      <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {entries.map((entry) => (
          <JournalPreviewCard key={entry.id} entry={entry} variant="compact" className="w-56 shrink-0 snap-start sm:w-60" />
        ))}
      </div>
      {hasMoreRemote && (
        <Link href={viewAllHref} className="mt-3 inline-flex items-center gap-1 text-metadata font-semibold text-findmi-700 hover:underline">
          View All Moments
          <ChevronIcon direction="right" className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}
