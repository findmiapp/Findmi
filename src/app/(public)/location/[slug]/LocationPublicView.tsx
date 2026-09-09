import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AdminEditButton from "@/components/AdminEditButton";
import ClaimButton from "@/components/ClaimButton";
import ConnectButton from "@/components/ConnectButton";
import ImageGalleryStrip from "@/components/ImageGalleryStrip";
import { HappeningCard, HappeningRow } from "@/components/HappeningCard";
import { HorizontalScroller } from "@/components/Section";
import { getLocationBySlug, getLocationGalleryImages, getUpcomingAtLocation } from "@/lib/data";
import { cityState } from "@/lib/format";
import { getPublicHandleForEntity } from "@/lib/handles";
import { getPublicOrigin } from "@/lib/site-url";
import { getSupabase } from "@/lib/supabase";

/** Vanity URL rendering pass — this is the actual render tree for a
 * Location's public page, shared verbatim by both the canonical
 * /location/[slug] route and the root /[username] vanity route (see
 * that route's own file). Neither route duplicates this logic; each is
 * just a thin wrapper resolving its own params into a `slug` and
 * calling straight into generateLocationMetadata/LocationPublicView
 * below — the exact same getLocationBySlug fetch (and its own existing
 * publication/visibility rules) either way. */

async function resolveCanonicalUrl(locationId: string, slug: string): Promise<string> {
  const supabase = getSupabase();
  const handle = supabase ? await getPublicHandleForEntity(supabase, "location", locationId) : null;
  return `${getPublicOrigin()}/${handle ?? `location/${slug}`}`;
}

export async function generateLocationMetadata(slug: string): Promise<Metadata> {
  const location = await getLocationBySlug(slug);
  if (!location) return { title: "Location not found" };

  const canonicalUrl = await resolveCanonicalUrl(location.id, location.slug);

  return {
    title: location.name,
    description: `See what's happening at ${location.name} on Findmi.`,
    alternates: { canonical: canonicalUrl },
  };
}

export async function LocationPublicView({ slug }: { slug: string }) {
  const location = await getLocationBySlug(slug);
  if (!location) notFound();

  const [happenings, galleryImages] = await Promise.all([
    getUpcomingAtLocation({ id: location.id, name: location.name }),
    getLocationGalleryImages(location.id),
  ]);
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
      {location.description && <p className="mt-3 text-sm text-ink/70">{location.description}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-full bg-findmi px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Get Directions
        </a>
        {location.website_url && (
          <a
            href={location.website_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold text-ink/50 hover:text-ink/70"
          >
            Website
          </a>
        )}
        {location.phone && (
          <a href={`tel:${location.phone}`} className="text-xs font-semibold text-ink/50 hover:text-ink/70">
            {location.phone}
          </a>
        )}
        {location.email && (
          <a href={`mailto:${location.email}`} className="text-xs font-semibold text-ink/50 hover:text-ink/70">
            {location.email}
          </a>
        )}
        {/* Public Messaging V1 — Business<->Location plain messaging
            only (Section 10's minimal scope: no Location-specific
            structured Opportunity type this pass). */}
        <ConnectButton targetType="location" targetId={location.id} targetName={location.name} />
      </div>

      {galleryImages.length > 1 && (
        <div className="mt-6">
          <ImageGalleryStrip images={galleryImages} alt={location.name} />
        </div>
      )}

      <div className="mt-6">
        <ClaimButton type="location" slug={location.slug} entityName={location.name} variant="card" />
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
