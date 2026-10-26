import Link from "next/link";
import { publicLocationHref } from "@/lib/location-links";
import SupabaseImage from "@/components/SupabaseImage";
import SectionHeading from "@/components/SectionHeading";
import DirectionsIconLink from "@/components/event/DirectionsIconLink";
import type { FindmiLocation } from "@/lib/types";
import type { LocationPlaceContext } from "@/lib/data";
import { cityState, cityStateZip } from "@/lib/format";
import { placeResult } from "@/lib/geo-results";
import ContextMap from "@/components/map/ContextMap";

/** Event page — Location section: a "Location" heading and ONE compact card
 * for the Event's real linked Location (never built from plain venue text;
 * see EventPublicView's canonicalLocation, which is null for a
 * hidden-location Event, so this never renders for one). The name gets up
 * to two lines; the address is the Location's own structured fields
 * (street / "City, ST ZIP"); actions are Get Directions (primary, same
 * maps query + click_directions tracking as before) and View Location
 * (the canonical Location page). Map Everywhere: a thin, lazily started
 * map of the Location (with View On Map) sits above the card when the
 * Location has real coordinates.
 *
 * The ONE Location map / address block: the Location's own page renders it
 * as `variant="self"` — its heading, no repeated name / logo (the page
 * heading already says it) and no View Location (you're there); the map,
 * full address, "Inside …" context and Get Directions stay. */
export default function EventLocationFeature({
  location,
  placeContext,
  variant = "event",
  heading = "Location",
  sectionId = "location",
}: {
  location: FindmiLocation;
  placeContext: LocationPlaceContext | null;
  variant?: "event" | "self";
  heading?: string;
  sectionId?: string;
}) {
  const self = variant === "self";
  const street = location.address?.trim() || null;
  const cityLine = cityStateZip(location.city, location.state, location.postal_code) || null;
  const parentName = placeContext?.ancestors[0]?.name ?? null;
  const mapsQuery = [location.name, location.address, cityState(location.city, location.state)].filter(Boolean).join(", ");
  const directionsHref = mapsQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}` : null;
  const image = location.logo_url ?? location.cover_image_url;
  const geo = placeResult(location, { linkable: Boolean(publicLocationHref(location)) });

  return (
    <section id={sectionId} aria-labelledby={`${sectionId}-heading`} className={self ? "mt-8 scroll-mt-20" : "scroll-mt-24"}>
      {self ? (
        <h2 id={`${sectionId}-heading`} className="font-display text-lg font-bold tracking-tight text-ink">
          {heading}
        </h2>
      ) : (
        <SectionHeading id={`${sectionId}-heading`}>{heading}</SectionHeading>
      )}
      <div className="mt-3 rounded-2xl border border-black/5 bg-white p-3.5 sm:max-w-xl">
        {geo && (
          <div className="mb-3">
            <ContextMap results={[geo]} label={`Map of ${location.name}`} />
          </div>
        )}
        <div className="flex items-start gap-3">
          {!self && (
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-black/[0.04]">
            {image ? (
              <SupabaseImage src={image} alt="" fill sizes="64px" className={location.logo_url ? "object-contain p-2" : "object-cover"} />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg font-bold uppercase text-ink/30">{location.name.charAt(0)}</div>
            )}
          </div>
          )}
          <div className="min-w-0 flex-1">
            {!self && <p className="line-clamp-2 break-words font-display text-card-title-lg font-bold leading-snug text-primary">{location.name}</p>}
            {(street || cityLine) && (
              <div className={`${self ? "" : "mt-1 "}flex items-start gap-1.5`}>
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
          {/* Only a listed Location has a public page (never a dead link). */}
          {!self && publicLocationHref(location) && (
            <Link
              href={publicLocationHref(location)!}
              className="flex h-10 min-w-0 flex-1 items-center justify-center rounded-full border border-black/10 bg-white px-4 text-sm font-bold text-ink transition hover:border-ink/30 active:scale-[0.98]"
            >
              View Location
            </Link>
          )}
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
