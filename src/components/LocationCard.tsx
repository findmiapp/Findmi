import Link from "next/link";
import SupabaseImage from "./SupabaseImage";
import type { LocationWithCategory } from "@/lib/data";
import { cityState } from "@/lib/format";

/** Location Public Profile UX pass — discovery-card structure, modeled
 * directly on BusinessLogoCard's proven "photo on top, logo overlaps its
 * lower-left corner, body content below" composition rather than PostCard's
 * text-over-image overlay (which is what made the old /locations card feel
 * cramped: title/address/CTA all fighting for space on top of a photo).
 * Degrades the same honest way BusinessLogoCard does: cover+logo overlaps;
 * logo-only fills the whole visual area; cover-only skips the overlap;
 * neither falls back to a plain dark placeholder — never a fabricated
 * image. No giant "LOCATION" badge anywhere on the card. */
export default function LocationCard({ location }: { location: LocationWithCategory }) {
  const place = cityState(location.city, location.state);
  const meta = [location.category?.name, place].filter(Boolean).join(" · ");
  const upcoming = location.upcomingCount ?? 0;
  const hasLogo = Boolean(location.logo_url);
  const hasCover = Boolean(location.cover_image_url);
  const overlap = hasLogo && hasCover;

  return (
    <div className="group relative w-full rounded-3xl border border-black/5 bg-white shadow-sm transition active:scale-[0.98]">
      <Link href={`/location/${location.slug}`} aria-label={`${location.name} — See What's Happening`} className="absolute inset-0 z-10 rounded-3xl" />

      <div className="relative">
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-t-3xl bg-mist">
          {hasCover ? (
            <SupabaseImage
              src={location.cover_image_url!}
              alt=""
              fill
              sizes="(min-width: 768px) 384px, 80vw"
              className="object-cover"
            />
          ) : hasLogo ? (
            <div className="flex h-full w-full items-center justify-center bg-findmi-50 p-8">
              <div className="relative h-full w-full">
                <SupabaseImage
                  src={location.logo_url!}
                  alt={location.name}
                  fill
                  sizes="(min-width: 768px) 384px, 80vw"
                  className="object-contain"
                />
              </div>
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-ink">
              <PinGlyph className="h-10 w-10 text-white/25" />
            </div>
          )}
        </div>

        {overlap && (
          <div className="absolute -bottom-7 left-5 h-20 w-20 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-white">
            <SupabaseImage src={location.logo_url!} alt={location.name} fill sizes="80px" className="object-contain" />
          </div>
        )}
      </div>

      <div className={`relative flex flex-col gap-1 rounded-b-3xl p-3.5 ${overlap ? "pt-8" : "pt-3"}`}>
        <p className="line-clamp-1 font-display text-base font-bold tracking-tight text-ink">{location.name}</p>
        {meta && <p className="line-clamp-1 text-xs font-medium text-ink/55">{meta}</p>}

        {/* Upcoming summary — only ever shown when there's real,
            already-scheduled activity; never "0 upcoming" wasting card
            space. */}
        {upcoming > 0 && (
          <div className="mt-1 flex items-center gap-1.5 rounded-lg bg-findmi-50 px-2 py-1.5">
            <CalendarGlyph className="h-3.5 w-3.5 shrink-0 text-findmi-700" />
            <span className="text-xs font-semibold text-findmi-700">
              {upcoming} upcoming
            </span>
          </div>
        )}

        <p className="mt-1 flex items-center gap-0.5 text-xs font-bold uppercase tracking-wide text-findmi-700">
          See What&rsquo;s Happening
          <ChevronGlyph className="h-3 w-3" />
        </p>
      </div>
    </div>
  );
}

function PinGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 21s7-6.2 7-11.5A7 7 0 105 9.5C5 14.8 12 21 12 21z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
