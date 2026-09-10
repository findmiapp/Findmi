import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AdminEditButton from "@/components/AdminEditButton";
import ClaimButton from "@/components/ClaimButton";
import MessageButton from "@/components/MessageButton";
import LocationFollowButton from "@/components/LocationFollowButton";
import LocationSaveButton from "@/components/LocationSaveButton";
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

function isSafeExternalUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

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
  const directionsHref = mapsQuery ? `https://www.google.com/maps/search/?api=1&query=${mapsQuery}` : null;
  const showHours = hasAnyHours(location.hours);
  const openNow = showHours ? isOpenNow(location.hours) : null;
  const website = isSafeExternalUrl(location.website_url) ? location.website_url : null;

  return (
    <div className="relative mx-auto max-w-4xl px-0 pb-10 sm:px-6">
      {/* 1. Cover / hero — same contained, rounded landscape treatment
          Business/Product use, so a Location profile reads like one app
          with the rest of Findmi rather than a bare address record. No
          fabricated imagery: a Location with no cover just gets the same
          branded dark placeholder. No generic "LOCATION" badge overlay —
          the category pill below (real taxonomy, not a fixed label) is
          the identity signal instead. */}
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
          {/* 14. Edit affordance — same corner-of-hero placement/behavior
              as Business's own AdminEditButton; only ever visible to an
              authorized manager/admin session. */}
          <AdminEditButton href={`/admin/locations/${location.id}`} className="absolute right-3 top-3 z-10" />
        </div>
      </div>

      {/* 2. Logo + identity — logo overlaps the cover's bottom edge the
          same way Business's own profile does, so the two entity types
          read as one visual system. */}
      <div className="px-4 sm:px-0">
        <div className="max-w-xl pl-3 sm:pl-4">
          <div className="flex items-start justify-between gap-2">
            {location.logo_url ? (
              <div className="relative -mt-10 h-24 w-24 shrink-0 overflow-hidden rounded-2xl border-4 border-paper bg-white shadow-sm sm:-mt-12 sm:h-28 sm:w-28">
                <SupabaseImage src={location.logo_url} alt={location.name} fill sizes="112px" className="object-cover" />
              </div>
            ) : (
              <span />
            )}
            {/* Follow lives here, top identity area — same prominence
                Business/Event's own Follow gets beside logo/name, never
                buried in a secondary utility row. Required for every
                Location regardless of claim/hours/gallery state. */}
            <div className={`shrink-0 ${location.logo_url ? "mt-2.5 sm:mt-3.5" : ""}`}>
              <LocationFollowButton
                locationId={location.id}
                locationSlug={location.slug}
                locationName={location.name}
                size="compact"
              />
            </div>
          </div>

          <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            {location.name}
          </h1>

          {/* 8. Category / subcategory — the single most-specific pick
              (parent or its chosen subcategory), no internal id, no tag
              list. Paired with Open Now/Closed only when real hours data
              makes that reliable — never guessed. */}
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
        </div>
      </div>

      {/* 3. Action row — Tier A (Directions + Message) fixed, always
          visible without scrolling, matching Event's own [ MESSAGE ]
          [ APPLY TO VEND ] fixed-primary-row geometry (h-11/rounded-lg).
          Directions leads (solid aqua) since a Location's physical place
          IS the point of the page. Tier B (Website/Call/Email/Save) is a
          quiet, horizontally-scrollable pill rail below — same treatment
          Event's own Directions/Save/Share/Contact rail already uses —
          so no giant stacked buttons and no clipped labels at any width.
          Every action only renders when its underlying data exists. */}
      <div className="px-4 sm:px-0">
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {directionsHref && (
            <a
              href={directionsHref}
              target="_blank"
              rel="noreferrer"
              className="flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg bg-findmi px-5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
            >
              Get Directions
            </a>
          )}
          <MessageButton size="default" targetType="location" targetId={location.id} targetName={location.name} />
        </div>

        {(website || location.phone || location.email) && (
          <div className="mt-2.5 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max items-center gap-2">
              <div className="shrink-0">
                <LocationSaveButton slug={location.slug} />
              </div>
              {website && (
                <a
                  href={website}
                  target="_blank"
                  rel="noreferrer"
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:border-ink/30 hover:text-ink"
                >
                  <GlobeGlyph className="h-3.5 w-3.5 shrink-0" />
                  Website
                </a>
              )}
              {location.phone && (
                <a
                  href={`tel:${location.phone}`}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:border-ink/30 hover:text-ink"
                >
                  <PhoneGlyph className="h-3.5 w-3.5 shrink-0" />
                  Call
                </a>
              )}
              {location.email && (
                <a
                  href={`mailto:${location.email}`}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:border-ink/30 hover:text-ink"
                >
                  <MailGlyph className="h-3.5 w-3.5 shrink-0" />
                  Email
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="px-4 sm:px-0">
        {/* 4. About — hidden entirely when no description. Never repeats
            address/hours/contact. */}
        {location.description && (
          <section className="mt-8">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">About</h2>
            <p className="mt-2 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-ink/70">
              {location.description}
            </p>
          </section>
        )}

        {/* 6. Hours — compact, conditional, never an inaccurate badge
            (the Open Now/Closed pill above already only renders when
            showHours is true). No holiday exceptions/split shifts/
            timezone overhaul. */}
        {showHours && (
          <section className="mt-8">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">Hours</h2>
            <div className="mt-3 max-w-sm rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
              <dl className="flex flex-col gap-1">
                {LOCATION_WEEKDAYS.map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between text-sm">
                    <dt className="text-ink/60">{label}</dt>
                    <dd className="font-medium text-ink">{formatDayHours(location.hours?.[key])}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        )}

        {/* 7. Gallery — same shared ImageGalleryStrip as Business/Event
            (scroll strip + lightbox), hidden entirely below 2 images.
            Never duplicates the cover — location_images is a separate
            source from cover_image_url. */}
        {galleryImages.length > 1 && (
          <section className="mt-8">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">Gallery</h2>
            <div className="mt-3">
              <ImageGalleryStrip images={galleryImages} alt={location.name} />
            </div>
          </section>
        )}

        {/* 9. Coming Up Here — presentation only; the underlying
            occurrence-aware query (getUpcomingAtLocation) is untouched.
            Exactly one empty-state message, never both a "0 upcoming"
            line and a separate block. */}
        <section className="mt-8">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">Coming Up Here</h2>

          {happenings.length === 0 ? (
            <p className="mt-3 text-sm text-ink/50">Nothing scheduled here yet. Check back soon.</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-ink/55">{happenings.length} upcoming</p>
              <div className="-mx-4 mt-4 sm:-mx-0">
                <HorizontalScroller>
                  {happenings.map((h) => (
                    <div key={h.id} className="w-64 shrink-0">
                      <HappeningCard item={h} />
                    </div>
                  ))}
                </HorizontalScroller>
              </div>

              <div className="mt-6 flex flex-col gap-3">
                {happenings.map((h) => (
                  <HappeningRow key={h.id} item={h} />
                ))}
              </div>
            </>
          )}
        </section>

        {/* 10/11. Claim — final major section before footer, deliberately
            quiet (ClaimButton's own compact card variant, no oversized
            styling added here) and narrower than the page so it never
            competes with Follow/Directions/Message above. ClaimButton
            itself renders nothing once the Location has a real member
            (state "member"), so an already-claimed Location shows no
            claim surface at all — unchanged existing behavior. */}
        <div className="mt-10 max-w-sm">
          <ClaimButton type="location" slug={location.slug} entityName={location.name} variant="card" />
        </div>
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

function GlobeGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <ellipse cx="12" cy="12" rx="3.4" ry="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 12h17" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function PhoneGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M6.5 4h3l1.5 4-2 1.5a11 11 0 005.5 5.5L16 13l4 1.5v3a2 2 0 01-2.2 2A16 16 0 014.5 6.2 2 2 0 016.5 4z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MailGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4.5 7l7.5 6 7.5-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
