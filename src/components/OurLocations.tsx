import Link from "next/link";
import SupabaseImage from "./SupabaseImage";
import NavIcon from "./NavIcon";
import { LocationOpenBadge } from "./LocationHours";
import { cityState } from "@/lib/format";
import { publicLocationHref } from "@/lib/location-links";
import type { BusinessLocationItem } from "@/lib/business-locations";

/** Our Locations — the permanent physical places this Business operates
 * (business_locations: an explicit Business ↔ Location relationship). Never
 * Event venues, Appearance places, pop-ups, stockists or anything inferred:
 * only Locations a Business/Admin explicitly connected. Every item links to
 * the canonical Findmi Location page, which stays the source of truth.
 * Renders nothing when there are none (no empty section). */
export default function OurLocations({
  businessName,
  locations,
  first = false,
}: {
  businessName: string;
  locations: BusinessLocationItem[];
  /** First section in its column (no Findmi Here above it). */
  first?: boolean;
}) {
  if (locations.length === 0) return null;
  const single = locations.length === 1;
  return (
    <section id="our-locations" className={`${first ? "mt-6 lg:mt-0" : "mt-8"} scroll-mt-24`} aria-labelledby="our-locations-heading">
      <h2 id="our-locations-heading" className="font-display text-lg font-bold tracking-tight text-ink">
        Our Locations
      </h2>
      <p className="mt-1 text-sm text-ink/55">
        {single ? `Visit ${businessName} in person.` : `Visit ${businessName} at ${locations.length} locations.`}
      </p>
      <ul className={`mt-3 grid gap-3 ${single ? "" : "sm:grid-cols-2"}`}>
        {locations.map((l) => (
          <li key={l.locationId}>
            <CompactLocationCard location={l} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The compact canonical-Location card shared by Our Locations and Find Us At
 * (image, name, address, Open Now / Closed, link to the Location page). */
export type CompactLocation = Pick<BusinessLocationItem, "name" | "slug" | "address" | "city" | "state" | "logoUrl" | "coverImageUrl" | "hours">;

export function CompactLocationCard({ location }: { location: CompactLocation }) {
  const image = location.coverImageUrl ?? location.logoUrl;
  const contain = !location.coverImageUrl && Boolean(location.logoUrl);
  const place = cityState(location.city, location.state);
  // Only a Location with BOTH Logo and Cover is a consumer Location (lib/location-eligibility.ts).
  // Anything else keeps its place in the list — name and address, in context — but is not
  // a link to a Location page.
  const href = publicLocationHref({ slug: location.slug, logo_url: location.logoUrl, cover_image_url: location.coverImageUrl });
  const body = (
    <>
      <span className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl ${image ? (contain ? "bg-findmi-50" : "bg-mist") : "bg-findmi-50"}`}>
        {image ? (
          <SupabaseImage src={image} alt="" fill sizes="64px" className={contain ? "object-contain p-2" : "object-cover"} />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <NavIcon name="pin" className="h-6 w-6 text-findmi-700" />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-base font-bold tracking-tight text-ink">{location.name}</span>
        {(location.address || place) && (
          <span className="block truncate text-xs text-ink/55">{[location.address, place].filter(Boolean).join(", ")}</span>
        )}
        <LocationOpenBadge hours={location.hours} />
      </span>
      {href && <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-findmi-700">Visit</span>}
    </>
  );
  if (!href) {
    return <div className="flex items-center gap-3 rounded-3xl border border-black/5 bg-white p-3 shadow-sm">{body}</div>;
  }
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-3xl border border-black/5 bg-white p-3 shadow-sm transition hover:border-findmi/40 active:scale-[0.99]"
    >
      {body}
    </Link>
  );
}
