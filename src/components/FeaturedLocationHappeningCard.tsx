import Image from "next/image";
import Link from "next/link";

/** Location Detail V1 — the Location page's own featured-happening hero,
 * visually/interaction-modeled on Business's locked FeaturedAppearanceCard
 * (same full-bleed image + bottom gradient treatment) but never importing
 * or reusing that component directly — this is a Location-only card with
 * its own content shape. No Directions action here: unlike an appearance
 * that can be anywhere, this happening is already confirmed to be AT this
 * Location, and the page's own Directions action (in the identity/action
 * row above) already covers getting to this exact place. */
export default function FeaturedLocationHappeningCard({
  title,
  imageUrl,
  href,
  ctaLabel,
  dateTimeLine,
  subtitleLine,
}: {
  title: string;
  imageUrl: string | null;
  href: string;
  ctaLabel: string;
  dateTimeLine: string | null;
  subtitleLine: string | null;
}) {
  return (
    <Link
      href={href}
      className="block overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm transition hover:border-black/20"
    >
      <div className="relative aspect-[16/10] w-full bg-ink">
        {imageUrl ? (
          <Image src={imageUrl} alt={title} fill unoptimized sizes="(min-width: 640px) 480px, 100vw" className="object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-ink">
            <span className="text-label uppercase tracking-wide text-white/25">Findmi</span>
          </div>
        )}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3 pt-16 sm:p-4"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.90) 0%, rgba(0,0,0,0.70) 28%, rgba(0,0,0,0.28) 58%, rgba(0,0,0,0) 85%)",
          }}
        >
          <h2 className="font-display text-card-title-lg font-bold tracking-tight text-white line-clamp-2">{title}</h2>
          {dateTimeLine && <p className="text-metadata font-medium text-white/90">{dateTimeLine}</p>}
          {subtitleLine && <p className="text-metadata font-medium text-white/70 line-clamp-1">{subtitleLine}</p>}
        </div>
      </div>
      <div className="flex items-center p-3 sm:p-4">
        <span className="flex h-10 items-center justify-center rounded-xl bg-findmi px-4 text-xs font-bold uppercase tracking-wide text-white">
          {ctaLabel}
        </span>
      </div>
    </Link>
  );
}
