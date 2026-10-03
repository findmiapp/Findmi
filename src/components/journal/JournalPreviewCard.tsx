import Link from "next/link";
import Image from "next/image";
import type { PublicJournalCard } from "@/lib/journal-distribution";
import { parseYmd } from "@/lib/journalArchive";

/** Journal Distribution V1 — the PUBLIC Journal preview card used on
 * Business/Event/Location/Product pages and the /journal collection.
 * Photography-first and editorial: cover photo carries the weight, then
 * experience date, title, a short excerpt and the author line. Distinct
 * from JournalArchiveCard (the owner's own archive row, with Draft/Private
 * state) — nothing owner-specific ever renders here. */
export default function JournalPreviewCard({
  entry,
  className = "",
}: {
  entry: PublicJournalCard;
  className?: string;
}) {
  const dateLabel = parseYmd(entry.entryDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const metaParts = [
    entry.authorLabel ? `By ${entry.authorLabel}` : null,
    entry.photoCount > 1 ? `${entry.photoCount} photos` : null,
  ].filter((v): v is string => Boolean(v));

  return (
    <Link
      href={`/journal/${entry.id}`}
      className={`group block overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm transition active:scale-[0.99] hover:border-black/10 hover:shadow ${className}`}
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-mist">
        {entry.coverUrl ? (
          <Image
            src={entry.coverUrl}
            alt=""
            fill
            unoptimized
            sizes="(min-width: 640px) 288px, 256px"
            className="object-cover transition duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-ink">
            <span className="text-[10px] font-bold uppercase tracking-wide text-white/25">Findmi Journal</span>
          </div>
        )}
      </div>
      <div className="p-3.5">
        <p className="truncate text-[11px] font-bold uppercase tracking-wide text-findmi-700">
          {dateLabel}
          {entry.locationName ? ` · ${entry.locationName}` : ""}
        </p>
        <p className="mt-1 line-clamp-2 font-display text-[15px] font-semibold leading-snug text-ink">{entry.title}</p>
        {entry.excerpt && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink/60">{entry.excerpt}</p>}
        {metaParts.length > 0 && <p className="mt-2 truncate text-[11px] text-ink/45">{metaParts.join(" · ")}</p>}
      </div>
    </Link>
  );
}
