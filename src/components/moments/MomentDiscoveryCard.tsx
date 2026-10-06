import Link from "next/link";
import Image from "next/image";
import type { MomentFeedCard } from "@/lib/moment-discovery";
import { parseYmd } from "@/lib/journalArchive";
import MomentMediaCollage from "./MomentMediaCollage";

/** "Oct 1" this year, "Oct 1, 2025" otherwise. */
export function momentDateLabel(ymd: string, now = new Date()): string {
  const d = parseYmd(ymd);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Findmi Moments discovery card — the collage carries the card; then the
 * title, "Location · date", and the author as attribution at the bottom
 * with the photo count. No engagement counts (none exist to show). The
 * whole card is one link (keyboard focusable, one tab stop). */
export default function MomentDiscoveryCard({
  moment,
  className = "",
  sizes,
  priority = false,
}: {
  moment: Pick<MomentFeedCard, "title" | "href" | "entryDate" | "contextLabel" | "media" | "photoCount" | "author">;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  const initial = moment.author?.name.trim().charAt(0).toUpperCase() ?? "";
  return (
    <Link
      href={moment.href}
      className={`group block min-w-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-findmi focus-visible:ring-offset-2 ${className}`}
    >
      <div className="transition-opacity group-hover:opacity-95 motion-safe:group-active:scale-[0.99]">
        <MomentMediaCollage items={moment.media} total={moment.photoCount} variant="card" sizes={sizes} priority={priority} label={moment.title} />
      </div>
      <div className="px-0.5 pt-2.5">
        <p className="line-clamp-2 break-words font-display text-[15px] font-semibold leading-snug text-ink">{moment.title}</p>
        <p className="mt-0.5 flex min-w-0 text-metadata text-ink/55">
          {moment.contextLabel && <span className="min-w-0 truncate">{moment.contextLabel}</span>}
          <span className="shrink-0 whitespace-pre">{moment.contextLabel ? " · " : ""}{momentDateLabel(moment.entryDate)}</span>
        </p>
        {(moment.author || moment.photoCount > 0) && (
          <div className="mt-2 flex items-center gap-2 text-metadata text-ink/60">
            {moment.author && (
              <>
                {moment.author.avatarUrl ? (
                  <Image src={moment.author.avatarUrl} alt="" width={22} height={22} unoptimized className="h-[22px] w-[22px] shrink-0 rounded-full object-cover" />
                ) : (
                  <span aria-hidden className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-findmi-50 text-[11px] font-bold text-findmi-700">
                    {initial}
                  </span>
                )}
                <span className="min-w-0 truncate font-semibold text-ink/75">{moment.author.name}</span>
              </>
            )}
            {moment.photoCount > 0 && (
              <span className="ml-auto shrink-0 pl-1 text-ink/45">
                {moment.photoCount} {moment.photoCount === 1 ? "photo" : "photos"}
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
