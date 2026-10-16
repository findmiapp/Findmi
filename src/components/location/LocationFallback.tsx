import { locationFallbackLine, locationInitials } from "@/lib/location-fallback";

/** Location Import V1 — renderer-level fallbacks for a Location without
 * verified media: Findmi's own clean visual language (white / soft Aqua
 * tint, rounded, Inter display type), built from the Location's own name,
 * category and area. Decorative and clearly not photography; never
 * persisted as an image file. Real media always renders instead. */

/** Profile fallback — a monogram tile in the logo slot. */
export function LocationMonogram({ name, className = "" }: { name: string; className?: string }) {
  return (
    <div aria-hidden="true" data-location-fallback="profile" className={`flex items-center justify-center bg-white ${className}`}>
      <span className="font-display text-2xl font-bold tracking-tight text-findmi-700 sm:text-3xl">{locationInitials(name)}</span>
    </div>
  );
}

/** Cover fallback — a soft branded hero naming the place. */
export function LocationCoverFallback({ name, category, area, city, state }: { name: string; category?: string | null; area?: string | null; city?: string | null; state?: string | null }) {
  const line = locationFallbackLine({ category, area, city, state });
  return (
    <div aria-hidden="true" data-location-fallback="cover" className="relative flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br from-findmi-50 via-white to-findmi-50">
      <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full border-[28px] border-findmi/10" />
      <div className="absolute -bottom-24 -left-12 h-56 w-56 rounded-full border-[20px] border-findmi/[0.07]" />
      <div className="relative flex max-w-[80%] flex-col items-center gap-2 text-center">
        <PinMark className="h-7 w-7 text-findmi" />
        <p className="font-display text-xl font-bold leading-tight tracking-tight text-ink/80 sm:text-3xl">{name}</p>
        {line && <p className="text-xs font-semibold text-ink/50 sm:text-sm">{line}</p>}
      </div>
    </div>
  );
}

function PinMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 21s7-6.2 7-11.5A7 7 0 105 9.5C5 14.8 12 21 12 21z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
