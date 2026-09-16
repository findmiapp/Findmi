import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AdminEditButton from "@/components/AdminEditButton";
import ClaimButton from "@/components/ClaimButton";
import MessageButton from "@/components/MessageButton";
import InquireButton from "@/components/InquireButton";
import { shouldShowMessageButton } from "@/lib/message-visibility";
import LocationFollowButton from "@/components/LocationFollowButton";
import PageViewTracker from "@/components/analytics/PageViewTracker";
import AnalyticsLink from "@/components/analytics/AnalyticsLink";
import LocationSaveButton from "@/components/LocationSaveButton";
import ShareButton from "@/components/ShareButton";
import ImageGalleryStrip from "@/components/ImageGalleryStrip";
import SupabaseImage from "@/components/SupabaseImage";
import { CategoryPill } from "@/components/Badge";
import { HappeningFeatureCard, HappeningRow } from "@/components/HappeningCard";
import { getLocationBySlug, getLocationGalleryImages, getUpcomingAtLocation } from "@/lib/data";
import { cityStateZip } from "@/lib/format";
import { LOCATION_WEEKDAYS, formatDayHours, getHoursSummaryLabel, hasAnyHours, isOpenNow } from "@/lib/locationHours";
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

  const [happenings, galleryImages, showMessageButton] = await Promise.all([
    getUpcomingAtLocation({ id: location.id, name: location.name }),
    getLocationGalleryImages(location.id),
    shouldShowMessageButton("location", location.id),
  ]);
  const fullAddress = [location.address, cityStateZip(location.city, location.state, location.postal_code)]
    .filter(Boolean)
    .join(", ");
  const mapsQuery = encodeURIComponent([location.name, fullAddress].filter(Boolean).join(", "));
  const directionsHref = mapsQuery ? `https://www.google.com/maps/search/?api=1&query=${mapsQuery}` : null;
  const showHours = hasAnyHours(location.hours);
  const openNow = showHours ? isOpenNow(location.hours) : null;
  const hoursSummary = showHours ? getHoursSummaryLabel(location.hours) : null;
  const website = isSafeExternalUrl(location.website_url) ? location.website_url : null;
  // Public Graph Integrity Pass 1 — same canonical-URL resolution
  // generateLocationMetadata already uses (handle-first, /location/slug
  // fallback), so a shared link always matches this page's own canonical
  // identity.
  const canonicalUrl = await resolveCanonicalUrl(location.id, location.slug);

  return (
    <div className="relative mx-auto max-w-4xl px-0 pb-10 sm:px-6">
      <PageViewTracker
        subject_type="location"
        subject_id={location.id}
        location_id={location.id}
        page_type="location"
        page_path={`/location/${location.slug}`}
      />
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

      {/* 3. Action row (Public Experience V5) — Directions used to be a
          giant solid full-color pill, the single largest object on the
          page after the cover, isolated above a separate horizontally-
          scrolling utility rail. Redesigned into one coherent, equally-
          weighted secondary-action cluster — Directions/Message/Website/
          Call — all the same compact outline geometry (matches
          MessageButton's own "compact" h-9/rounded-lg treatment), so
          Directions stays easy and obvious without dominating the page or
          being visually isolated. flex-wrap (never horizontal scroll) —
          every essential action stays reachable at 360px by wrapping to a
          second line rather than requiring a swipe. Save/Share are true
          utilities now: a separate, smaller row, always shown regardless
          of whether Website/Call/Email exist (Save/Share never depended
          on contact info existing). Every action still only renders when
          its underlying data exists. */}
      <div className="px-4 sm:px-0">
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {directionsHref && (
            <AnalyticsLink
              href={directionsHref}
              target="_blank"
              rel="noreferrer"
              className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-findmi/40 px-3 text-xs font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
              trackPayload={{ event_name: "click_directions", subject_type: "location", subject_id: location.id, location_id: location.id }}
            >
              <DirectionsGlyph className="h-3.5 w-3.5 shrink-0" />
              Directions
            </AnalyticsLink>
          )}
          {showMessageButton && (
            <MessageButton size="compact" targetType="location" targetId={location.id} targetName={location.name} />
          )}
          {website && (
            <a
              href={website}
              target="_blank"
              rel="noreferrer"
              className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-black/10 px-3 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink"
            >
              <GlobeGlyph className="h-3.5 w-3.5 shrink-0" />
              Website
            </a>
          )}
          {location.phone && (
            <a
              href={`tel:${location.phone}`}
              className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-black/10 px-3 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink"
            >
              <PhoneGlyph className="h-3.5 w-3.5 shrink-0" />
              Call
            </a>
          )}
          {/* Unify Site-Wide Communications pass — this pill no longer
              exposes location.email directly via mailto; it opens the
              native Venue Contact inquiry form instead
              (subject_type='venue_inquiry'), gated on the exact same
              "does this venue have contact info on file" condition as
              before. */}
          {location.email && (
            <InquireButton
              targetType="location"
              targetId={location.id}
              targetName={location.name}
              label="Contact"
              className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-black/10 px-3 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink"
            />
          )}
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          <LocationSaveButton slug={location.slug} id={location.id} />
          <ShareButton
            url={canonicalUrl}
            title={location.name}
            variant="icon"
            track={{ subject_type: "location", subject_id: location.id, location_id: location.id }}
          />
        </div>
      </div>

      <div className="px-4 sm:px-0">
        {/* Coming Up Here comes FIRST now — "what happens here" is the
            primary reason to visit a Location page, so it belongs
            immediately below identity/actions rather than after About/
            Gallery/Hours. Presentation only; the underlying occurrence-
            aware query (getUpcomingAtLocation) is untouched. Exactly one
            empty-state message, never both a "0 upcoming" line and a
            separate block. Stays right here even when About/Gallery are
            both empty.

            Duplicate-render fix (Public Experience V4) — the previous
            version mapped the exact same `happenings` array twice: once
            as photo cards in a carousel, once as compact rows right below
            it, so every single happening (e.g. Piccola Pasta Shop's Sep
            20 "Native Rose" Event) rendered on screen twice with 100%
            overlap between the two sections. Fixed here with a
            cardinality-aware split instead, per the density rule this
            pass establishes for Business/Event/Location relationship
            presentations: a SMALL set (<=3) is rendered once, as cards —
            rich enough to browse directly, no separate list needed. A
            LARGER set gets exactly ONE featured card for the very next
            happening, then the genuine remainder (never re-including that
            first item) as a compact chronological schedule below it.
            Either branch enumerates every happening exactly once.

            Density pass (Public Experience V5) — the V4 fix above stopped
            the duplication, but for the single-item case it still used
            HappeningCard, a full-bleed aspect-[3/4] photo poster that
            consumed nearly an entire mobile viewport for one relationship.
            Coming Up Here is meant to feel like one of the most important
            Location modules, not one enormous poster — so every branch
            now uses HappeningFeatureCard, a compact card with a real but
            modestly-sized thumbnail (see that component's own note), and
            <=3 items lay out in a responsive grid so 2-3 upcoming
            happenings can be scanned without each claiming a full
            viewport. 4+ still gets one featured card for the nearest
            happening plus HappeningRow (no thumbnail at all) for the
            rest, the most compact tier for a real schedule. */}
        <section className="mt-8">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">Coming Up Here</h2>

          {happenings.length === 0 ? (
            <p className="mt-3 text-sm text-ink/50">Nothing scheduled here yet. Check back soon.</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-ink/55">{happenings.length} upcoming</p>
              {happenings.length <= 3 ? (
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {happenings.map((h) => (
                    <HappeningFeatureCard key={h.id} item={h} />
                  ))}
                </div>
              ) : (
                <>
                  <div className="mt-4 max-w-xl">
                    <HappeningFeatureCard item={happenings[0]} />
                  </div>
                  <div className="mt-3 flex flex-col gap-3">
                    {happenings.slice(1).map((h) => (
                      <HappeningRow key={h.id} item={h} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </section>

        {/* About — hidden entirely when no description. Never repeats
            address/hours/contact. */}
        {location.description && (
          <section className="mt-8">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">About</h2>
            <p className="mt-2 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-ink/70">
              {location.description}
            </p>
          </section>
        )}

        {/* Gallery — same shared ImageGalleryStrip as Business/Event
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

        {/* Hours — now a compact, collapsed-by-default accordion below
            Coming Up Here (never a big permanently-open block ahead of
            the discovery content). Native <details>/<summary> gives real
            disclosure semantics for free, no dependency. The summary
            line reuses the same reliable "Open Until X" / "Closed now"
            computation as the identity badge above — never shown when
            isOpenNow can't say for sure. No holiday exceptions/split
            shifts/timezone overhaul. */}
        {showHours && (
          <section className="mt-8">
            <details className="group rounded-2xl border border-black/5 bg-white shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden sm:p-5">
                <span className="font-display text-lg font-bold tracking-tight text-ink">Hours</span>
                <span className="flex items-center gap-2 text-sm text-ink/60">
                  {hoursSummary}
                  <ChevronGlyph className="h-4 w-4 shrink-0 text-ink/40 transition group-open:rotate-180" />
                </span>
              </summary>
              <dl className="flex flex-col gap-1 border-t border-black/5 p-4 pt-3 sm:p-5 sm:pt-4">
                {LOCATION_WEEKDAYS.map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between text-sm">
                    <dt className="text-ink/60">{label}</dt>
                    <dd className="font-medium text-ink">{formatDayHours(location.hours?.[key])}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </section>
        )}

        {/* Claim — final major section before footer, deliberately quiet
            (ClaimButton's own compact card variant, no oversized styling
            added here) and narrower than the page so it never competes
            with Follow/Directions/Message above. ClaimButton itself
            renders nothing once the Location has a real member (state
            "member"), so an already-claimed Location shows no claim
            surface at all — unchanged existing behavior. Stays at the
            bottom, never moved back up. */}
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

// Same glyph/sizing convention as Event's own Directions pill (h-3.5 w-3.5,
// strokeWidth 1.8, currentColor).
function DirectionsGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 2L4.5 20.5l.9.9L12 18l6.6 3.4.9-.9L12 2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
