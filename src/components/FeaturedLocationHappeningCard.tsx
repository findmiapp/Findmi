import Image from "@/components/SupabaseImage";
import Link from "next/link";
import LiveDot from "./LiveDot";

/** Location Detail V1 (visual implementation pass) — the Location page's
 * own featured-happening hero, a contained horizontal card (image left,
 * content right) matching the approved Hudson Yards reference exactly.
 * Visually distinct from Business's locked FeaturedAppearanceCard (a
 * full-bleed image with bottom-gradient text) — never imports or reuses
 * that component. No Directions action here: this happening is already
 * confirmed to be AT this Location, and the page's own Directions tile
 * (in the primary action grid above) already covers getting to this
 * exact place. `kindLabel` is truthful per entity — "Featured Event" for
 * an event occurrence, "Featured Appearance" for a standalone appearance
 * — never forcing Event language onto an Appearance. */
export default function FeaturedLocationHappeningCard({
  kindLabel,
  title,
  imageUrl,
  href,
  ctaLabel,
  subtitleLine,
  dateTimeLine,
  locationLine,
  live,
}: {
  kindLabel: string;
  title: string;
  imageUrl: string | null;
  href: string;
  ctaLabel: string;
  /** Business/organizer line — "by illy". Null when the happening has no
   * such attribution (e.g. an occurrence with no organizer_name). */
  subtitleLine: string | null;
  dateTimeLine: string | null;
  locationLine: string | null;
  live: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex items-stretch gap-3 overflow-hidden rounded-2xl border border-black/10 bg-white p-2.5 shadow-sm transition hover:border-black/20 sm:gap-4 sm:p-3"
    >
      <div className="relative aspect-square w-28 shrink-0 overflow-hidden rounded-xl bg-ink sm:w-36">
        {imageUrl ? (
          <Image src={imageUrl} alt={title} fill unoptimized sizes="(min-width: 640px) 144px, 112px" className="object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-ink">
            <span className="text-[10px] font-bold uppercase tracking-wide text-white/25">Findmi</span>
          </div>
        )}
        {live && (
          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
            <LiveDot className="text-white" />
            Happening Now
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-0.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-findmi-700">{kindLabel}</p>
        <h2 className="font-display text-base font-bold leading-snug text-ink line-clamp-2 sm:text-lg">{title}</h2>
        {subtitleLine && <p className="truncate text-sm text-ink/60">by {subtitleLine}</p>}
        {dateTimeLine && <p className="mt-0.5 truncate text-xs text-ink/55">{dateTimeLine}</p>}
        {locationLine && <p className="truncate text-xs text-ink/45">{locationLine}</p>}
        <span className="mt-1.5 inline-flex h-8 w-fit items-center justify-center rounded-lg bg-findmi px-3 text-[11px] font-bold uppercase tracking-wide text-white">
          {ctaLabel}
        </span>
      </div>
    </Link>
  );
}
