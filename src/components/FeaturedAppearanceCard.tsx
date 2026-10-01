import Image from "next/image";
import Link from "next/link";

/** Business Public Profile — Featured Appearance System. The ONE unified
 * premium presentation for a Business's featured Appearance, replacing the
 * old split (an immersive FeaturedEventCard for an event-backed appearance
 * vs. a plain white "Next Up" card for a standalone one — see
 * BusinessPublicView's own history) with a single photographic/gradient-
 * overlay treatment used for both. Visually modeled on FeaturedEventCard/
 * FeaturedEventHeroOverlay (same aspect-[16/10] full-bleed photo + dark
 * gradient + light text), but deliberately its OWN small component rather
 * than a reuse of that shared overlay: this needs two explicit actions
 * (View Details / Directions) below the photo, and keeping it separate
 * means the Event/Location pages that already depend on
 * FeaturedEventHeroOverlay's exact current (buttonless, whole-card-Link)
 * behavior are never put at risk by this Business-only change.
 *
 * The photo itself is one Link (tapping it reaches the same destination as
 * View Details); the two buttons below are plain siblings, never nested
 * inside that Link.
 *
 * Featured Appearance Heading pass — the "FEATURED APPEARANCE" eyebrow
 * used to render as overlay text inside this card, above the title. It
 * now lives OUTSIDE this component entirely (BusinessPublicView.tsx
 * renders it directly above, using the same section-label treatment
 * "Findmi Here" already uses) so it reads as a real page section heading
 * rather than card chrome — this component starts straight at the title. */
export default function FeaturedAppearanceCard({
  title,
  imageUrl,
  viewDetailsHref,
  directionsHref,
  dateTimeLine,
  venueLine,
}: {
  title: string;
  /** Real appearance flyer / event cover / business cover image, already
   * resolved by the caller — this component never guesses or fabricates
   * one. Null renders the same safe neutral fallback FeaturedEventCard
   * already uses for an imageless Event. */
  imageUrl: string | null;
  viewDetailsHref: string;
  /** Null when there isn't enough real location data to build a maps
   * query — Directions is simply omitted, never a guessed destination. */
  directionsHref: string | null;
  /** Pre-formatted by the caller (formatAppearanceDateRange/"Happening
   * now"/"Until X") — this component never computes or guesses time. */
  dateTimeLine: string | null;
  /** Pre-formatted "Venue Name · City, ST" (or whichever half exists) —
   * never fabricated when the underlying data doesn't exist. */
  venueLine: string | null;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm">
      <Link href={viewDetailsHref} className="relative block aspect-[16/10] w-full bg-ink">
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
          {venueLine && <p className="text-metadata font-medium text-white/70 line-clamp-1">{venueLine}</p>}
        </div>
      </Link>
      <div className="flex flex-wrap items-center gap-2 p-3 sm:p-4">
        <Link
          href={viewDetailsHref}
          className="flex h-10 items-center justify-center rounded-xl bg-findmi px-4 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          View Details
        </Link>
        {directionsHref && (
          <a
            href={directionsHref}
            target="_blank"
            rel="noreferrer"
            className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-black/10 px-4 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink"
          >
            Directions
          </a>
        )}
      </div>
    </div>
  );
}
