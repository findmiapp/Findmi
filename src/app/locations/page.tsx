import type { Metadata } from "next";
import LocationCard from "@/components/LocationCard";
import { getLocations } from "@/lib/data";

export const metadata: Metadata = {
  title: "Locations",
  description: "Markets, venues, and spots where Findmi businesses show up.",
};
export const revalidate = 60;

export default async function LocationsPage() {
  const locations = await getLocations(50);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Locations</h1>
      <p className="mt-2 text-ink/60">
        Recurring markets and venues — see who&rsquo;s showing up next.
      </p>

      {locations.length === 0 ? (
        <p className="mt-10 text-sm text-ink/50">No locations yet — check back soon.</p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {locations.map((l) => (
            <LocationCard key={l.id} location={l} />
          ))}
        </div>
      )}
    </div>
  );
}
