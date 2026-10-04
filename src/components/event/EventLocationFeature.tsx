import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import DirectionsIconLink from "@/components/event/DirectionsIconLink";
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
      <div className="flex items-center gap-4 rounded-2xl border border-black/5 bg-white p-4">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-black/[0.04]">
          {image ? (
            <SupabaseImage
              src={image}
              alt=""
              fill
              sizes="56px"
              className={location.logo_url ? "object-contain p-1.5" : "object-cover"}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm font-bold uppercase text-ink/30">
              {location.name.charAt(0)}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-card-title-lg font-bold text-primary">{location.name}</p>
          {addressLine && <p className="mt-0.5 truncate text-metadata text-muted">{addressLine}</p>}
          {parentName && <p className="mt-0.5 truncate text-metadata text-subtle">Inside {parentName}</p>}
          <div className="mt-2.5 flex items-center gap-4">
            <Link href={`/location/${location.slug}`} className="text-metadata font-semibold text-findmi-700 hover:underline">
              View Location →
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
