import type { Metadata } from "next";
import Link from "next/link";
import JournalCollection from "@/components/journal/JournalCollection";
import { getPublicJournalCollection, journalCollectionHref, momentsHeading } from "@/lib/journal-distribution";
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
import AddToCalendarButton from "@/components/AddToCalendarButton";
import { UtilityActionGrid } from "@/components/EventUtilityActions";
import EventCoverLightbox from "@/components/EventCoverLightbox";
import ImageGalleryStrip from "@/components/ImageGalleryStrip";
import ReadMoreText from "@/components/ReadMoreText";
import SupabaseImage from "@/components/SupabaseImage";
import { CategoryPill } from "@/components/Badge";
import FeaturedLocationHappeningCard from "@/components/FeaturedLocationHappeningCard";
import LocationHappeningCollection from "@/components/LocationHappeningCollection";
import {
  getLocationBySlug,
  getLocationGalleryImages,
  getLocationPlaceContext,
  getUpcomingAtLocation,
  getUpcomingWithinLocation,
  type LocationHappening,
} from "@/lib/data";
import { cityStateZip, formatAppearanceDateRange, getTemporalLabel } from "@/lib/format";
import { LOCATION_WEEKDAYS, formatDayHours, getHoursSummaryLabel, hasAnyHours, isOpenNow } from "@/lib/locationHours";
import { getPublicHandleForEntity } from "@/lib/handles";
import { getPublicOrigin } from "@/lib/site-url";
import { getSupabase } from "@/lib/supabase";
import { getOperatorsForLocation } from "@/lib/business-locations";

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

function locationHappeningCtaLabel(type: LocationHappening["type"]): string {
  return type === "event" ? "View Event" : "View Appearance";
}

/** Location Detail V1 — the Location page's own featured-happening
 * resolver. Pure/synchronous, operating only on the `happenings` array
 * getUpcomingAtLocation already fetched once for this render — never a
 * second query, and never touching Business's own locked
 * resolveFeaturedAppearance/featured_appearance_id system. Same
 * precedence shape that system established: manual override (only when
 * it still resolves to a real, currently-eligible upcoming item) -> a
 * happening live right now -> the nearest upcoming happening -> none.
 *
 * `location.featured_event_id` is an existing Event-only manual pointer
 * (unchanged, untouched schema) — honored here only when one of the
 * already-fetched happenings is actually that Event (via its real
 * eventId), so a stale pointer to an Event no longer connected to this
 * Location silently falls through to the automatic rule instead of
 * dead-ending the hero. */
function resolveFeaturedLocationHappening(
  happenings: LocationHappening[],
  featuredEventId: string | null
): LocationHappening | null {
  if (happenings.length === 0) return null;

  if (featuredEventId) {
    const manual = happenings.find((h) => h.type === "event" && h.eventId === featuredEventId);
    if (manual) return manual;
  }

  const liveNow = happenings.find((h) => getTemporalLabel(h.start_at, h.end_at).live);
  if (liveNow) return liveNow;

  // happenings is already sorted start_at ascending by getUpcomingAtLocation.
  return happenings[0];
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

  const [happenings, galleryImages, showMessageButton, placeContext, withinHappenings, journal, operators] = await Promise.all([
    getUpcomingAtLocation({ id: location.id, name: location.name }),
    getLocationGalleryImages(location.id),
    shouldShowMessageButton("location", location.id),
    // Physical Presence Pass 2 — physical-context line only; null (no
    // query at all) for a Location without a parent place.
    getLocationPlaceContext(location),
    // Physical Presence Pass 3 — activity at places physically INSIDE this
    // one (descendants), kept separate from `happenings` (exactly here),
    // which still drives Featured, Calendar and What's Happening Here.
    getUpcomingWithinLocation(location.id),
    // Journal Distribution V1 — entries whose structured location_id is
    // EXACTLY this place (no descendants, no manual-text matching).
    getPublicJournalCollection({ subjectType: "location", subjectId: location.id, limit: 6, withCount: true }),
    // /account V2 Pass 2 — live Businesses with an ongoing presence here
    // (business_locations). Public read; empty if none (or if the table
    // isn't there yet).
    getOperatorsForLocation(getSupabase(), location.id, { limit: 6, publicOnly: true }),
  ]);
  // Location Detail V1 — one unified "What's Happening Here" module
  // replaces the old split Featured Event hero + separate "Coming Up
  // Here" list (which could render the exact same Event in both places).
  // Resolution is pure/in-memory off the happenings array already fetched
  // above — see resolveFeaturedLocationHappening's own note.
  const featuredHappening = resolveFeaturedLocationHappening(happenings, location.featured_event_id ?? null);
  const featuredLive = featuredHappening ? getTemporalLabel(featuredHappening.start_at, featuredHappening.end_at).live : false;
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

  // Visual implementation pass — the hero's own tappable gallery (cover +
  // location_images, already both fetched above — no new query), reusing
  // the exact same cover+gallery lightbox EventCoverLightbox already
  // provides for Event covers (a generic images/alt primitive, not
  // Event-specific despite its name) rather than building a second one.
  const heroImages = [location.cover_image_url, ...galleryImages].filter((u): u is string => Boolean(u));

  // Visual implementation pass — the primary action grid (Directions/
  // Save/Share/Calendar), same derived-column-count UtilityActionGrid
  // shell the Event page's own Tier B utility row already uses (imported,
  // not modified). Directions is the one PRIMARY (teal-filled) tile here —
  // a deliberate Location-only visual choice per the approved reference,
  // built locally rather than reusing Event's own outline-styled
  // DirectionsGridCell. Add to Calendar only renders when the already-
  // resolved featuredHappening gives it something truthful to add — never
  // a fabricated "add this Location to your calendar" entry.
  const directionsAction = directionsHref ? (
    <AnalyticsLink
      href={directionsHref}
      target="_blank"
      rel="noreferrer"
      trackPayload={{ event_name: "click_directions", subject_type: "location", subject_id: location.id, location_id: location.id }}
      className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-2xl bg-findmi text-white transition hover:bg-findmi-600"
    >
      <DirectionsGlyph className="h-4 w-4" />
      <span className="text-[11px] font-semibold uppercase tracking-wide">Directions</span>
    </AnalyticsLink>
  ) : null;
  const calendarAction = featuredHappening ? (
    <AddToCalendarButton
      title={featuredHappening.title}
      description={featuredHappening.description}
      location={location.name}
      startAt={featuredHappening.start_at}
      endAt={featuredHappening.end_at}
      layout="grid"
    />
  ) : null;
  const primaryActionItems = [
    directionsAction,
    <LocationSaveButton key="save" slug={location.slug} id={location.id} layout="grid" />,
    <ShareButton
      key="share"
      url={canonicalUrl}
      title={location.name}
      variant="grid"
      track={{ subject_type: "location", subject_id: location.id, location_id: location.id }}
    />,
    calendarAction,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <div className="relative mx-auto max-w-4xl px-0 pb-10 sm:px-6">
      <PageViewTracker
        subject_type="location"
        subject_id={location.id}
        location_id={location.id}
        page_type="location"
        page_path={`/location/${location.slug}`}
      />
      {/* 1. Cover / hero — Visual implementation pass: edge-to-edge and
          flush with the nav at mobile (the reference's immersive
          "environmental photography" treatment), rounded only at the
          bottom corners there; the original contained, rounded-on-every-
          side landscape treatment (matching Business/Product) is
          untouched from sm+ up. No fabricated imagery: a Location with
          no cover/gallery at all just gets the same branded dark
          placeholder it always has. Tappable zoom + a real "current /
          total" count badge when more than one photo exists (cover +
          location_images, both already fetched for this render — no new
          query), reusing EventCoverLightbox (a generic images/alt
          primitive, not actually Event-specific) rather than building a
          second gallery/lightbox system.
          Location + Event Moment Continuity pass — modest mobile height
          bump (aspect-[4/3] -> aspect-[5/4]) so the environmental photo
          has more presence before the overlapping logo/identity content;
          still image-first, still edge-to-edge, still a modest crop, not
          a takeover hero. Desktop (sm:aspect-[21/9]) is untouched. */}
      <div className="sm:px-0 sm:pt-6">
        <div className="relative aspect-[5/4] w-full overflow-hidden rounded-b-3xl bg-mist shadow-sm sm:aspect-[21/9] sm:rounded-3xl sm:border sm:border-black/5">
          {heroImages.length > 0 ? (
            <EventCoverLightbox images={heroImages} alt={location.name} />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-ink">
              <PinGlyph className="h-12 w-12 text-white/15" />
            </div>
          )}
          {heroImages.length > 1 && (
            <div className="pointer-events-none absolute right-3 top-3 z-[2] flex items-center gap-1 rounded-full bg-black/50 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
              <GalleryGlyph className="h-3.5 w-3.5" />
              1/{heroImages.length}
            </div>
          )}
          {/* 14. Edit affordance — same affordance as Business's own
              AdminEditButton, only ever visible to an authorized manager/
              admin session; moved to the opposite corner from the new
              consumer-facing gallery-count badge above so the two never
              overlap. */}
          <AdminEditButton href={`/admin/locations/${location.id}`} className="absolute bottom-3 right-3 z-10" />
        </div>
      </div>

      {/* 2. Logo + identity — Visual implementation pass: the logo now
          stands alone on its own line, overlapping the hero's bottom edge
          (left-aligned, bigger/more substantial), with Name + Follow
          recomposed into their own row directly beneath it — Follow
          sits beside the NAME now (vertically centered against it),
          matching the approved reference, rather than beside the logo as
          before. No fabricated follower count: LocationFollowButton has
          no such count to report, so none is shown (never invented). */}
      <div className="px-4 sm:px-0">
        <div className="max-w-xl">
          {location.logo_url && (
            // Small Public UI Polish pass — border-paper (#F8F8F6) is the
            // same color as the page's own bg-paper background, so the
            // tile had no visible edge at all against it — a white/light
            // logo (e.g. Hudson Yards) disappeared entirely. border-white
            // keeps the clean white frame against the logo itself, and a
            // subtle ring gives the tile a real edge against the page,
            // regardless of whether the logo artwork is light or
            // colorful. Overlap geometry/size/shadow unchanged.
            <div className="relative -mt-14 h-28 w-28 shrink-0 overflow-hidden rounded-2xl border-4 border-white bg-white shadow-sm ring-1 ring-black/[0.08] sm:-mt-16 sm:h-32 sm:w-32">
              <SupabaseImage src={location.logo_url} alt={location.name} fill sizes="128px" className="object-cover" />
            </div>
          )}

          <div className={`flex items-start justify-between gap-3 ${location.logo_url ? "mt-3" : ""}`}>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{location.name}</h1>
            <div className="shrink-0 pt-0.5">
              <LocationFollowButton
                locationId={location.id}
                locationSlug={location.slug}
                locationName={location.name}
                size="compact"
              />
            </div>
          </div>

          {/* Physical Presence Pass 2 — where this place physically sits
              (nearest parent first), e.g. "Madison Square Park · Flatiron,
              New York". Context, not navigation chrome: quiet text, each
              parent linking to its own page. Absent for a flat Location. */}
          {placeContext && (
            <p className="mt-1 text-sm leading-snug text-ink/55">
              {placeContext.ancestors.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && <span aria-hidden="true"> · </span>}
                  <Link href={`/location/${a.slug}`} className="font-medium text-ink/70 hover:text-findmi-700 hover:underline">
                    {a.name}
                  </Link>
                </span>
              ))}
              {placeContext.geography && (
                <>
                  <span aria-hidden="true"> · </span>
                  {placeContext.geography}
                </>
              )}
            </p>
          )}

          {/* /account V2 Pass 2 — "Operated by": quiet context line, each
              Business linking to its own page. Absent when none. */}
          {operators.items.length > 0 && (
            <p className="mt-1 text-sm leading-snug text-ink/55">
              Operated by{" "}
              {operators.items.map((b, i) => (
                <span key={b.businessId}>
                  {i > 0 && (i === operators.items.length - 1 ? " & " : ", ")}
                  <Link href={`/business/${b.slug}`} className="font-medium text-ink/70 hover:text-findmi-700 hover:underline">
                    {b.name}
                  </Link>
                </span>
              ))}
            </p>
          )}

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

      {/* 3. Primary action grid (Visual implementation pass) — Directions/
          Save/Share/Add to Calendar, the four equally-sized "doing
          something right now" actions, matching the approved reference.
          Directions is the one PRIMARY teal-filled tile (built above);
          Save/Share use their own new "grid"/"grid" layouts (same icon-
          over-label shape Event's own EventSaveButton/EventShareButton
          already established for their own action grid). Add to Calendar
          only joins when there's a truthful, already-resolved happening
          to add (featuredHappening) — never a fabricated "add this
          Location" entry; column count is derived from how many of the
          four actually render (UtilityActionGrid, reused from the Event
          page's own Tier B row, unmodified). Message/Website/Call/Contact
          are real, but secondary here — moved below (see the compact
          contact row ahead of Hours) rather than competing with this
          grid for the page's prime real estate. */}
      <div className="px-4 sm:px-0">
        <div className="mt-4">
          <UtilityActionGrid items={primaryActionItems} />
        </div>
      </div>

      {/* "Events" (Visual implementation pass) — the one resolved featured
          happening (resolveFeaturedLocationHappening — manual Event
          override when still eligible, else live-now, else nearest
          upcoming; LOCKED resolution logic, untouched here) as a
          contained horizontal card matching the approved reference. A
          short, truthful description preview and the compact Events/
          About/Photos section nav follow directly after — tabs/anchors
          only for sections that truthfully exist on this render (no dead
          Nearby/Map tabs). "Coming Up Here" (the genuine remainder, never
          re-including the featured item) comes after the nav, exactly
          the zero/one/multiple states this architecture already
          established: zero happenings -> one empty-state line; exactly
          one -> the featured card alone, no remainder section at all;
          more -> featured card + a real remainder rail. */}
      <div className="px-4 sm:px-0">
        <section id="events" className="mt-5 scroll-mt-20">
          {featuredHappening ? (
            <FeaturedLocationHappeningCard
              kindLabel={featuredHappening.type === "event" ? "Featured Event" : "Featured Appearance"}
              title={featuredHappening.title}
              imageUrl={featuredHappening.imageUrl}
              href={featuredHappening.href}
              ctaLabel={locationHappeningCtaLabel(featuredHappening.type)}
              subtitleLine={featuredHappening.subtitle}
              dateTimeLine={formatAppearanceDateRange(
                featuredHappening.start_at,
                featuredHappening.end_at,
                featuredHappening.description
              )}
              locationLine={location.name}
              live={featuredLive}
            />
          ) : withinHappenings.length === 0 ? (
            // Physical Presence Pass 3 — only truly empty when there is
            // nothing exactly here AND nothing within this place.
            <p className="text-sm text-ink/50">Nothing scheduled here yet. Check back soon.</p>
          ) : null}
        </section>

        {location.description && (
          <div className="mt-4 max-w-2xl">
            <ReadMoreText text={location.description} />
          </div>
        )}

        <nav className="mt-5 flex items-center gap-5 overflow-x-auto border-b border-black/5 pb-2.5 text-sm font-semibold text-ink/50 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <a href="#events" className="shrink-0 transition hover:text-ink">
            Events
          </a>
          {location.description && (
            <a href="#about" className="shrink-0 transition hover:text-ink">
              About
            </a>
          )}
          {galleryImages.length > 1 && (
            <a href="#photos" className="shrink-0 transition hover:text-ink">
              Photos
            </a>
          )}
        </nav>
      </div>

      {/* What's Happening Here collection (Location + Event Moment
          Continuity pass) — replaces the old "Coming Up Here" remainder-
          only rail. This is the COMPLETE upcoming schedule, including the
          featured happening shown editorially above: the Featured module
          is emphasis, this collection is the full record — same product
          behavior Business's own Featured Appearance + FindMi Here
          collection already establishes (that appearance stays listed in
          FindMi Here too). Cards/List toggle, additive Location-only
          implementation (see LocationHappeningCollection's own note on
          why it doesn't reuse Business's Appearance components directly).
          Renders nothing when there's nothing upcoming — the Featured
          section's own empty-state line above already covers that
          truthfully; a second identical message here would be
          redundant. */}
      {happenings.length > 0 && (
        <section className="mt-6 px-4 sm:px-0">
          <LocationHappeningCollection happenings={happenings} />
        </section>
      )}

      {/* Physical Presence Pass 3 — "Within": activity at places physically
          inside this one (e.g. Eataly Chiosco inside Flatiron North Plaza).
          Separate from What's Happening Here so the page never implies it
          happens at this place itself; every item names and links its
          exact place ("at Eataly Chiosco"). Renders nothing when empty. */}
      {withinHappenings.length > 0 && (
        <section className="mt-6 px-4 sm:px-0">
          <LocationHappeningCollection happenings={withinHappenings} heading={`Within ${location.name}`} />
        </section>
      )}

      {/* Journal Distribution V1 — separate from activity; renders nothing
          when empty. */}
      {journal.entries.length > 0 && (
        <section className="mt-6 px-4 sm:px-0">
          <JournalCollection
            heading={momentsHeading("location", location.name)}
            entries={journal.entries}
            total={journal.total}
            seeAllHref={journalCollectionHref("location", location.slug)}
          />
        </section>
      )}

      <div className="px-4 sm:px-0">
        {/* Secondary contact actions (Visual implementation pass) — real,
            but no longer competing with Directions/Save/Share/Calendar
            for prime real estate between identity and discovery. Same
            underlying data/behavior as before (Website/Call open
            directly; Contact opens the native Venue Contact inquiry
            form), just recomposed into a compact, lower-priority row.
            Every action still only renders when its underlying data
            exists; the whole row disappears when none do. */}
        {(showMessageButton || website || location.phone || location.email) && (
          <div className="mt-8 flex flex-wrap items-center gap-1.5">
            {showMessageButton && <MessageButton size="compact" targetType="location" targetId={location.id} targetName={location.name} />}
            {website && (
              <a
                href={website}
                target="_blank"
                rel="noreferrer"
                className="flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-black/10 px-2.5 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink"
              >
                <GlobeGlyph className="h-3.5 w-3.5 shrink-0" />
                Website
              </a>
            )}
            {location.phone && (
              <a
                href={`tel:${location.phone}`}
                className="flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-black/10 px-2.5 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink"
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
                className="flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-black/10 px-2.5 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink"
              />
            )}
          </div>
        )}

        {/* Hours — moved above About/Gallery (Location Detail V1):
            "is this place open" is a more immediate, actionable question
            than its description/photos. Still a compact, collapsed-by-
            default accordion, not a big permanently-open block. Native
            <details>/<summary> gives real disclosure semantics for free,
            no dependency. The summary line reuses the same reliable
            "Open Until X" / "Closed now" computation as the identity
            badge above — never shown when isOpenNow can't say for sure.
            No holiday exceptions/split shifts/timezone overhaul. */}
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

        {/* About — hidden entirely when no description. Never repeats
            address/hours/contact. The short preview directly under the
            featured happening (above) already covers the "is this place
            interesting" question above the fold; this is the same full
            text for anyone who taps through from the section nav or the
            preview's own "Read more". */}
        {location.description && (
          <section id="about" className="mt-8 scroll-mt-20">
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
          <section id="photos" className="mt-8 scroll-mt-20">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">Gallery</h2>
            <div className="mt-3">
              <ImageGalleryStrip images={galleryImages} alt={location.name} />
            </div>
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

function GalleryGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="8.5" cy="10" r="1.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 17l4.5-4.5 3 3 4-4 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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
