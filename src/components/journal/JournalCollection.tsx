import Link from "next/link";
import type { PublicJournalCard } from "@/lib/journal-distribution";
import JournalPreviewCard from "./JournalPreviewCard";

/** Journal Distribution V1 — the one public Journal collection used by
 * every surface (Business, Event, Location, Product). Renders nothing at
 * all when there are no eligible entries — no empty module, no "be the
 * first" prompt. "rail" = a compact horizontal preview on entity pages;
 * "grid" = the full /journal collection page. */
export default function JournalCollection({
  heading,
  entries,
  seeAllHref,
  total,
  layout = "rail",
}: {
  /** Omit when the surrounding page already titles the collection. */
  heading?: string;
  entries: PublicJournalCard[];
  seeAllHref?: string | null;
  /** Exact eligible count when known; drives "See all N". */
  total?: number | null;
  layout?: "rail" | "grid";
}) {
  if (entries.length === 0) return null;
  const showSeeAll = Boolean(seeAllHref) && (total == null || total > entries.length);

  return (
    <div>
      {(heading || showSeeAll) && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          {heading && <h2 className="font-display text-lg font-bold tracking-tight text-ink">{heading}</h2>}
          {showSeeAll && seeAllHref && (
            <Link href={seeAllHref} className="shrink-0 text-xs font-semibold text-findmi-700 hover:underline">
              {total != null ? `See all ${total}` : "See all"}
            </Link>
          )}
        </div>
      )}
      {layout === "rail" ? (
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {entries.map((entry) => (
            <JournalPreviewCard key={entry.id} entry={entry} className="w-64 shrink-0 sm:w-72" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {entries.map((entry) => (
            <JournalPreviewCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
