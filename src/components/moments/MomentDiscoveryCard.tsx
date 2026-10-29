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

/** Findmi Moments card — THE canonical Moment card for every /moments mode
 * (Explore, For You, My Moments) and the homepage rail. The collage carries the card; then the
 * title, "Location · date", and the author as attribution at the bottom
 * with the photo count. No engagement counts (none exist to show). The
 * whole card is one link (keyboard focusable, one tab stop). */
export default function MomentDiscoveryCard({
  moment,
  className = "",
  sizes,
  priority = false,
  heroFetchPriority,
  eager = false,
  load = true,
  heroOnly = false,
  onHeroSettled,
  variant = "feed",
}: {
  moment: Pick<MomentFeedCard, "title" | "href" | "entryDate" | "contextLabel" | "media" | "photoCount" | "author"> & Partial<Pick<MomentFeedCard, "ownerBadge">>;
  className?: string;
  sizes?: string;
  priority?: boolean;
  heroFetchPriority?: "high";
  eager?: boolean;
  load?: boolean;
  heroOnly?: boolean;
  onHeroSettled?: () => void;
  /** "tray": the compact row of this same card for the Moments map's result
   * tray (first photo, title, place · date, author) — same link, same data. */
  variant?: "feed" | "tray";
}) {
  const initial = moment.author?.name.trim().charAt(0).toUpperCase() ?? "";
  if (variant === "tray") {
    const photo = moment.media[0]?.url ?? null;
    return (
      <Link
        href={moment.href}
        className={`group flex min-w-0 gap-3 rounded-2xl border border-black/5 bg-white p-2 outline-none transition hover:border-black/10 focus-visible:ring-2 focus-visible:ring-findmi ${className}`}
      >
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-mist">
          {photo ? (
            <Image src={photo} alt="" fill unoptimized sizes="80px" className="object-cover" />
          ) : (
            <span aria-hidden className="flex h-full w-full items-center justify-center font-display text-lg font-bold text-ink/25">
              {moment.title.slice(0, 1)}
            </span>
          )}
          {moment.ownerBadge && (
            <span className={`absolute left-1 top-1 rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${moment.ownerBadge === "Draft" ? "bg-amber-100 text-amber-800" : "bg-white/95 text-ink/60"}`}>
              {moment.ownerBadge}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <p className="line-clamp-2 break-words font-display text-[14px] font-semibold leading-snug text-ink">{moment.title}</p>
          <p className="mt-0.5 truncate text-metadata text-ink/55">{momentDateLabel(moment.entryDate)}</p>
          {moment.author && <p className="mt-0.5 truncate text-metadata font-semibold text-ink/70">{moment.author.name}</p>}
        </div>
        <span aria-hidden className="self-center pr-1 text-ink/30 transition group-hover:text-ink/60">›</span>
      </Link>
    );
  }
  return (
    <Link
      href={moment.href}
      className={`group block min-w-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-findmi focus-visible:ring-offset-2 ${className}`}
    >
      <div className="relative transition-opacity group-hover:opacity-95 motion-safe:group-active:scale-[0.99]">
        {/* My Moments only: the owner sees what isn't visible to others yet. */}
        {moment.ownerBadge && (
          <span
            className={`absolute left-2 top-2 z-10 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-sm ${
              moment.ownerBadge === "Draft" ? "bg-amber-100 text-amber-800" : "bg-white/95 text-ink/60"
            }`}
          >
            {moment.ownerBadge}
          </span>
        )}
        <MomentMediaCollage
          items={moment.media}
          total={moment.photoCount}
          variant="card"
          sizes={sizes}
          priority={priority}
          heroFetchPriority={heroFetchPriority}
          eager={eager}
          load={load}
          heroOnly={heroOnly}
          onHeroSettled={onHeroSettled}
          label={moment.title}
        />
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
                  <Image
                    src={moment.author.avatarUrl}
                    alt=""
                    width={22}
                    height={22}
                    unoptimized
                    className={`h-[22px] w-[22px] shrink-0 ${moment.author.kind === "business" ? "rounded-md border border-black/5 bg-white object-contain" : "rounded-full object-cover"}`}
                  />
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
