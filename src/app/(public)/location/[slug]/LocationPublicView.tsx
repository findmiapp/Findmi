import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AdminEditButton from "@/components/AdminEditButton";
import ClaimButton from "@/components/ClaimButton";
import MessageButton from "@/components/MessageButton";
import ImageGalleryStrip from "@/components/ImageGalleryStrip";
import SupabaseImage from "@/components/SupabaseImage";
import { CategoryPill } from "@/components/Badge";
import { HappeningCard, HappeningRow } from "@/components/HappeningCard";
import { HorizontalScroller } from "@/components/Section";
import { getLocationBySlug, getLocationGalleryImages, getUpcomingAtLocation } from "@/lib/data";
import { cityStateZip } from "@/lib/format";
import { LOCATION_WEEKDAYS, formatDayHours, hasAnyHours, isOpenNow } from "@/lib/locationHours";
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
    openGraph: location.cover_image_url ? { images: [location.cover_image_url] } : undefined,
  };
}

export async function LocationPublicView({ slug }: { slug: string }) {
  const location = await getLocationBySlug(slug);
  if (!location) notFound();

  const [happenings, galleryImages] = await Promise.all([
    getUpcomingAtLocation({ id: location.id, name: location.name }),
    getLocationGalleryImages(location.id),
  ]);
  const fullAddress = [location.address, cityStateZip(location.city, location.state, location.postal_code)]
    .filter(Boolean)
    .join(", ");
  const mapsQuery = encodeURIComponent([location.name, fullAddress].filter(Boolean).join(", "));
  const showHours = hasAnyHours(location.hours);
  const openNow = showHours ? isOpenNow(location.hours) : null;

  return (
    <div className="relative mx-auto max-w-4xl px-0 pb-10 sm:px-6">
      {/* Cover / hero — same contained, rounded landscape treatment
          Business/Product use, so a Location profile reads like one app
          with the rest of Findmi rather than a bare address record. No
          fabricated imagery: a Location with no cover just gets the same
          branded dark placeholder. */}
      <div className="px-4 pt-4 sm:px-0 sm:pt-6">
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-3xl border border-black/5 bg-mist shadow-sm sm:aspect-[21/9]">
          {location.cover_image_url ? (
            <SupabaseImage
              src={location.cover_image_url}
              alt={location.name}
              fill
              priority
              sizes="(min-width: 1024px) 1024px, 100vw"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-ink">
              <PinGlyph className="h-12 w-12 text-white/15" />
            </div>
          )}
          <AdminEditButton href={`/admin/locations/${location.id}`} className="absolute right-3 top-3 z-10" />
        </div>
      </div>

      {/* Identity — logo overlaps the cover's bottom edge the same way
          Business's own profile does, so the two entity types read as one
          visual system. */}
      <div className="px-4 sm:px-0">
        <div className="max-w-xl pl-3 sm:pl-4">
          <div className="flex items-start gap-2">
            {location.logo_url && (
              <div className="relative -mt-10 h-24 w-24 shrink-0 overflow-hidden rounded-2xl border-4 border-paper bg-white shadow-sm sm:-mt-12 sm:h-28 sm:w-28">
                <SupabaseImage src={location.logo_url} alt={location.name} fill sizes="112px" className="object-cover" />
              </div>
            )}
            <div className={`ml-auto flex shrink-0 items-center ${location.logo_url ? "mt-2.5 sm:mt-3.5" : ""}`}>
              <MessageButton targetType="location" targetId={location.id} targetName={location.name} />
            </div>
          </div>

          <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            {location.name}
          </h1>

          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {location.category && <CategoryPill>{location.category.name}</CategoryPill>}
            {showHours && openNow != null && (
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
                  openNow ? "bg-findmi-50 text-findmi-700" : "bg-black/[0.04] text-ink/50"
                }`}
              >
                {openNow ? "Open Now" : "Closed"}
              </span>
            )}
          </div>

          {fullAddress && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-ink/60">
              <PinGlyph className="h-4 w-4 shrink-0 text-ink/40" />
              {fullAddress}
            </p>
          )}

          {/* Primary actions */}
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
          </div>

          {location.description && <p className="mt-5 text-sm leading-relaxed text-ink/70">{location.description}</p>}

          {showHours && (
            <div className="mt-6 rounded-2xl border border-black/5 bg-white p-4 shadow-sm sm:p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Hours</p>
              <dl className="mt-2 flex flex-col gap-1">
                {LOCATION_WEEKDAYS.map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between text-sm">
                    <dt className="text-ink/60">{label}</dt>
                    <dd className="font-medium text-ink">{formatDayHours(location.hours?.[key])}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {galleryImages.length > 1 && (
            <div className="mt-6">
              <ImageGalleryStrip images={galleryImages} alt={location.name} />
            </div>
          )}

          <div className="mt-6">
            <ClaimButton type="location" slug={location.slug} entityName={location.name} variant="card" />
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-0">
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
              <div className="-mx-4 mt-4 sm:-mx-0">
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
    </div>
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
