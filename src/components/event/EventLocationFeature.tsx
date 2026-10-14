import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import SectionHeading from "@/components/SectionHeading";
import DirectionsIconLink from "@/components/event/DirectionsIconLink";
import type { FindmiLocation } from "@/lib/types";
import type { LocationPlaceContext } from "@/lib/data";
import { cityState, cityStateZip } from "@/lib/format";

/** Event page — Location section: a "Location" heading and ONE compact card
 * for the Event's real linked Location (never built from plain venue text;
 * see EventPublicView's canonicalLocation, which is null for a
 * hidden-location Event, so this never renders for one). The name gets up
 * to two lines; the address is the Location's own structured fields
 * (street / "City, ST ZIP"); actions are Get Directions (primary, same
 * maps query + click_directions tracking as before) and View Location
 * (the canonical Location page). No map link — Findmi's map isn't live. */
export default function EventLocationFeature({
  location,
  placeContext,
}: {
  location: FindmiLocation;
  placeContext: LocationPlaceContext | null;
}) {
  const street = location.address?.trim() || null;
  const cityLine = cityStateZip(location.city, location.state, location.postal_code) || null;
  const parentName = placeContext?.ancestors[0]?.name ?? null;
  const mapsQuery = [location.name, location.address, cityState(location.city, location.state)].filter(Boolean).join(", ");
  const directionsHref = mapsQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}` : null;
  const image = location.logo_url ?? location.cover_image_url;

  return (
    <section id="location" aria-labelledby="location-heading" className="scroll-mt-24">
      <SectionHeading id="location-heading">Location</SectionHeading>
      <div className="mt-3 rounded-2xl border border-black/5 bg-white p-3.5 sm:max-w-xl">
        <div className="flex items-start gap-3">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-black/[0.04]">
            {image ? (
              <SupabaseImage src={image} alt="" fill sizes="64px" className={location.logo_url ? "object-contain p-2" : "object-cover"} />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg font-bold uppercase text-ink/30">{location.name.charAt(0)}</div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 break-words font-display text-card-title-lg font-bold leading-snug text-primary">{location.name}</p>
            {(street || cityLine) && (
              <div className="mt-1 flex items-start gap-1.5">
                <PinGlyph className="mt-0.5 h-3.5 w-3.5 shrink-0 text-findmi-700" />
                <p className="min-w-0 text-metadata leading-snug">
                  {street && <span className="block break-words font-medium text-secondary">{street}</span>}
                  {cityLine && <span className="block break-words text-muted">{cityLine}</span>}
                </p>
              </div>
            )}
            {parentName && <p className="mt-1 truncate text-metadata text-subtle">Inside {parentName}</p>}
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          {directionsHref && (
            <DirectionsIconLink
              href={directionsHref}
              placeName={location.name}
              variant="compact"
              trackPayload={{
                event_name: "click_directions",
                subject_type: "location",
                subject_id: location.id,
                location_id: location.id,
              }}
            />
          )}
          <Link
            href={`/location/${location.slug}`}
            className="flex h-10 min-w-0 flex-1 items-center justify-center rounded-full border border-black/10 bg-white px-4 text-sm font-bold text-ink transition hover:border-ink/30 active:scale-[0.98]"
          >
            View Location
          </Link>
        </div>
      </div>
    </section>
  );
}

function PinGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M12 21s7-6.2 7-11.5A7 7 0 105 9.5C5 14.8 12 21 12 21z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
