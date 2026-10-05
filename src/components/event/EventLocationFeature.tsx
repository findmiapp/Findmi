import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import DirectionsIconLink from "@/components/event/DirectionsIconLink";
import ChevronIcon from "@/components/ChevronIcon";
import type { FindmiLocation } from "@/lib/types";
import type { LocationPlaceContext } from "@/lib/data";
import { cityState } from "@/lib/format";

/** Location feature strip (Public Event V2 Next Body pass) — a compact
 * destination/context strip for the Event's real linked Location, distinct
 * from the WHEN/WHERE facts band above (which is temporal/logistics, not
 * this place-identity card) and from Hosted By (organizer identity, not a
 * physical place). Only ever rendered for a genuine linked Location (see
 * EventPublicView's canonicalLocation) — never built from plain venue
 * text. Directions reuses the same DirectionsIconLink/maps-query behavior
 * already approved on the Location page and Event action row. */
export default function EventLocationFeature({
  location,
  placeContext,
}: {
  location: FindmiLocation;
  placeContext: LocationPlaceContext | null;
}) {
  const addressLine = [location.address, cityState(location.city, location.state)].filter(Boolean).join(" · ");
  const parentName = placeContext?.ancestors[0]?.name ?? null;
  const mapsQuery = [location.name, location.address, cityState(location.city, location.state)].filter(Boolean).join(", ");
  const directionsHref = mapsQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}` : null;
  const image = location.logo_url ?? location.cover_image_url;

  return (
    <section id="location" className="scroll-mt-24">
      {/* Live QA Polish pass — larger visual identity (h-14→h-20 thumbnail)
          without a taller card: row height is governed by the text column,
          not the thumbnail, so this grows "for free"; p-4→p-3 and
          mt-2.5→mt-2 tighten the rest to net a shorter card overall. */}
      <div className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-black/[0.04]">
          {image ? (
            <SupabaseImage
              src={image}
              alt=""
              fill
              sizes="80px"
              className={location.logo_url ? "object-contain p-2" : "object-cover"}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-lg font-bold uppercase text-ink/30">
              {location.name.charAt(0)}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-card-title-lg font-bold text-primary">{location.name}</p>
          {addressLine && <p className="mt-0.5 truncate text-metadata text-muted">{addressLine}</p>}
          {parentName && <p className="mt-0.5 truncate text-metadata text-subtle">Inside {parentName}</p>}
          <div className="mt-2 flex items-center gap-4">
            <Link href={`/location/${location.slug}`} className="flex items-center gap-1 text-metadata font-semibold text-findmi-700 hover:underline">
              View Location
              <ChevronIcon direction="right" className="h-3 w-3" />
            </Link>
            {directionsHref && (
              <DirectionsIconLink
                href={directionsHref}
                placeName={location.name}
                variant="icon"
                trackPayload={{
                  event_name: "click_directions",
                  subject_type: "location",
                  subject_id: location.id,
                  location_id: location.id,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
