import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AdminEditButton from "@/components/AdminEditButton";
import { HappeningCard, HappeningRow } from "@/components/HappeningCard";
import { HorizontalScroller } from "@/components/Section";
import { getLocationBySlug, getUpcomingAtLocation } from "@/lib/data";
import { cityState } from "@/lib/format";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const location = await getLocationBySlug(slug);
  if (!location) return { title: "Location not found" };

  return {
    title: location.name,
    description: `See what's happening at ${location.name} on FindMi.`,
  };
}

export default async function LocationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const location = await getLocationBySlug(slug);
  if (!location) notFound();

  const happenings = await getUpcomingAtLocation(location.name);
  const fullAddress = [location.address, cityState(location.city, location.state)]
    .filter(Boolean)
    .join(", ");
  const mapsQuery = encodeURIComponent([location.name, fullAddress].filter(Boolean).join(", "));

  return (
    <div className="relative mx-auto max-w-4xl px-6 py-10">
      <AdminEditButton href={`/admin/locations/${location.id}`} className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6" />
      <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
        {location.name}
      </h1>
      {fullAddress && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-ink/60">
          <PinGlyph />
          {fullAddress}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-full bg-findmi px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Get Directions
        </a>
      </div>

      <section className="mt-12">
        <h2 className="font-display text-lg font-bold tracking-tight text-ink">Coming Up Here</h2>
        <p className="mt-1 text-sm text-ink/55">
          {happenings.length} upcoming
        </p>

        {happenings.length === 0 ? (
          <p className="mt-6 text-sm text-ink/50">
            Nothing scheduled here yet — check back soon.
          </p>
        ) : (
          <>
            <div className="-mx-6 mt-4">
              <HorizontalScroller>
                {happenings.map((h) => (
                  <div key={h.id} className="w-64 shrink-0">
                    <HappeningCard item={h} />
                  </div>
                ))}
              </HorizontalScroller>
            </div>

            <div className="mt-8 flex flex-col gap-3">
              {happenings.map((h) => (
                <HappeningRow key={h.id} item={h} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function PinGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-ink/40">
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
