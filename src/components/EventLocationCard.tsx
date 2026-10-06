import Image from "@/components/SupabaseImage";
import Link from "next/link";
import { cityState } from "@/lib/format";

export interface EventLocationCardLocation {
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
}

/** Event Page Visual Correction pass — "this is a real FindMi place you
 * can open," not plain text. Shared by the legacy event's own matched-
 * Location block (EventPublicView.tsx) and the recurring-event schedule
 * summary (EventScheduleSummary.tsx) so both paths render the same
 * linked object card. Image falls back through the Location's own
 * existing logo/cover fields — never a fabricated image — to a plain pin
 * glyph when neither exists. The whole card is one Link to the public
 * Location page. */
export default function EventLocationCard({ location }: { location: EventLocationCardLocation }) {
  const imageUrl = location.logo_url ?? location.cover_image_url;
  const addressLine = [location.address, cityState(location.city, location.state)].filter(Boolean).join(", ");

  return (
    <Link
      href={`/location/${location.slug}`}
      className="flex items-center gap-3 rounded-xl border border-black/10 bg-white p-2.5 transition hover:border-findmi/40 hover:bg-findmi-50"
    >
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-black/5">
        {imageUrl ? (
          <Image src={imageUrl} alt="" fill unoptimized sizes="44px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <PinGlyph className="h-4 w-4 text-findmi-700" />
          </div>
        )}
      </div>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-wide text-ink/40">Location</span>
        <span className="block truncate font-semibold text-findmi-700">{location.name}</span>
        {addressLine && <span className="block truncate text-xs text-ink/55">{addressLine}</span>}
      </span>
      <ChevronGlyph className="h-4 w-4 shrink-0 text-ink/30" />
    </Link>
  );
}

function PinGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 21s7-6.2 7-11.5A7 7 0 105 9.5C5 14.8 12 21 12 21z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
