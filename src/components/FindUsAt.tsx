import { CompactLocationCard } from "./OurLocations";
import AvailabilityDetailLine from "./AvailabilityDetail";
import type { AvailabilityLocationItem } from "@/lib/business-location-availability";

/** Find Us At — third-party places where this Business/Brand is normally
 * available (business_location_availability: explicit connections only —
 * Findmi-entered, or owner-submitted and approved; Live and in-effect only). Never places it operates (Our Locations), never Event/Appearance
 * venues. Same compact canonical-Location card as Our Locations; the
 * caller passes only the small displayed set (no View All in V1 — the
 * reader already pages, so one can be added later). Nothing renders with
 * none. */
export default function FindUsAt({ businessName, locations }: { businessName: string; locations: AvailabilityLocationItem[] }) {
  if (locations.length === 0) return null;
  const single = locations.length === 1;
  return (
    <section id="find-us-at" className="mt-8 scroll-mt-24" aria-labelledby="find-us-at-heading">
      <h2 id="find-us-at-heading" className="font-display text-lg font-bold tracking-tight text-ink">
        Find Us Here
      </h2>
      <p className="mt-1 text-sm text-ink/55">Places that carry or serve {businessName}.</p>
      <ul className={`mt-3 grid gap-3 ${single ? "" : "sm:grid-cols-2"}`}>
        {locations.map((l) => (
          <li key={l.locationId}>
            <CompactLocationCard location={l} />
            <AvailabilityDetailLine detail={l.detail} className="px-3 pt-1.5" />
          </li>
        ))}
      </ul>
    </section>
  );
}
