"use client";

import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import WantHeartButton from "@/components/WantHeartButton";
import LocationFollowButton from "@/components/LocationFollowButton";
import type { LocationActivityPreviewItem, LocationWithCategory } from "@/lib/data";
import { cityState, cityStateZip, formatDateShort, formatTime } from "@/lib/format";
import { trackEvent } from "@/lib/analytics/track";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";

/** Homepage Featured Locations — Horizontal Carousel pass, Live Mobile
 * Polish correction. A dedicated, homepage-only card: deliberately NOT a
 * change to LocationDiscoveryCard (still used unmodified on /locations
 * and /discover). Same underlying data (LocationWithCategory.activities/
 * activityCount, already batched by getFeaturedLocations/getLocations —
 * no new query), same Save (WantHeartButton), Follow (LocationFollowButton
 * — already exists, reused verbatim at its own `compact` size rather than
 * inventing a new follow action) and Directions (the exact mapsQuery/
 * directionsHref pattern LocationPublicView.tsx already uses) behavior.
 *
 * Live mobile QA correction — the first version overlaid Directions/Save
 * on the photo and shrank the whole card for a one-event Location, which
 * read as cramped and truncated the title too aggressively. Both are
 * reworked here: every card now targets the same ~88-90% rail width
 * regardless of event count (only the inner event preview adapts — see
 * below), and Directions/Save/Follow moved into a plain action row below
 * the photo instead of floating over it.
 *
 * Structure: the LEFT side's <Link> wraps only the photo + title + geo
 * (so tapping the photo/name navigates to the Location); the action row
 * (Follow/Directions/Save) is a SIBLING below that Link, not nested
 * inside it — avoiding the need for stopPropagation workarounds on
 * LocationFollowButton (which doesn't call it internally, unlike
 * WantHeartButton) while still keeping valid HTML (no nested anchors). */
export default function FeaturedLocationCard({
  location,
  analyticsContext,
}: {
  location: LocationWithCategory;
  analyticsContext?: AnalyticsPlacementContext;
}) {
  const geo = cityState(location.city, location.state);
  const typeLabel = location.category?.name ?? null;
  const activities = location.activities ?? [];
  const hasMultiple = activities.length >= 2;

  const fullAddress = [location.address, cityStateZip(location.city, location.state, location.postal_code)].filter(Boolean).join(", ");
  const mapsQuery = encodeURIComponent([location.name, fullAddress].filter(Boolean).join(", "));
  const directionsHref = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

  const analyticsFields = buildEntityEventFields("location", location.id, { locationId: location.id }, analyticsContext);
  const impressionRef = useViewportImpression<HTMLDivElement>({ event_name: "entity_impression", ...analyticsFields });

  return (
    <div
      ref={impressionRef}
      // Every card now targets the same rail-relative width regardless of
      // event count (the earlier content-sized narrow card for a single
      // event read as cramped/truncated in live QA) — only the inner
      // event preview below adapts to how many real happenings exist.
      className="flex h-48 shrink-0 snap-start overflow-hidden rounded-3xl border border-black/5 bg-white shadow-sm sm:h-52 flex-[0_0_88%] max-w-[620px] sm:flex-[0_0_60%] lg:flex-[0_0_44%]"
    >
      {/* LEFT — location identity (Link) + action row (sibling, not nested).
          44% rather than a flat 42% — the reused LocationFollowButton has
          its own fixed content-based width ("Follow" + padding, not
          resizable without touching that shared component), and fitting
          it beside two icon buttons at a comfortable touch target needs
          a hair more than the panel's floor. */}
      <div className="flex w-[44%] shrink-0 flex-col border-r border-black/5">
        <Link
          href={`/location/${location.slug}`}
          onClick={() => trackEvent({ event_name: "entity_click", ...analyticsFields })}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="relative h-20 w-full shrink-0 overflow-hidden bg-mist sm:h-24">
            {location.cover_image_url ? (
              <SupabaseImage src={location.cover_image_url} alt={location.name} fill sizes="200px" className="object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ink to-black">
                <PinGlyph className="h-7 w-7 text-white/20" />
              </div>
            )}
            {typeLabel && (
              <span className="absolute left-2 top-2 inline-flex max-w-[calc(100%-1rem)] items-center truncate rounded-full bg-black/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
                {typeLabel}
              </span>
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1 px-2.5 pt-2">
            <h3 className="line-clamp-3 font-display text-sm font-extrabold leading-snug tracking-tight text-ink">{location.name}</h3>
            {geo && (
              <p className="mt-auto flex items-center gap-1 text-[11px] text-ink/55">
                <PinGlyph className="h-3 w-3 shrink-0" />
                <span className="truncate">{geo}</span>
              </p>
            )}
          </div>
        </Link>

        {/* ACTION ROW — Follow (reused LocationFollowButton, compact size)
            + Directions + Save. None of these navigate to the Location. */}
        <div className="flex shrink-0 items-center gap-1 px-2 pb-2 pt-1.5">
          <LocationFollowButton locationId={location.id} locationSlug={location.slug} locationName={location.name} size="compact" />
          <button
            type="button"
            onClick={() => window.open(directionsHref, "_blank", "noopener,noreferrer")}
            aria-label={`Get directions to ${location.name}`}
            title="Directions"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/10 text-ink/60 transition active:scale-90"
          >
            <NavigationGlyph className="h-[42%] w-[42%]" />
          </button>
          <WantHeartButton
            type="location"
            slug={location.slug}
            id={location.id}
            className="h-8 w-8 !bg-transparent !text-ink/60 border border-black/10"
          />
        </div>
      </div>

      {/* RIGHT — "Events Happening Here." A single substantial preview for
          exactly one real happening; a compact "1 full + partial next"
          horizontal rail for 2+. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 bg-white p-2.5 sm:p-3">
        <h4 className="shrink-0 font-display text-sm font-bold tracking-tight text-ink">Events Happening Here</h4>
        {activities.length === 0 ? (
          // Defensive only — getFeaturedLocations already filters to
          // activityCount > 0, so this is normally unreachable; kept
          // truthful (never a fabricated event) in case activityCount and
          // the preview array ever disagree (e.g. a happening canceled
          // between the two batched queries).
          <Link href={`/location/${location.slug}`} className="mt-auto text-xs font-semibold text-findmi-700 hover:text-findmi-800">
            Explore this place →
          </Link>
        ) : hasMultiple ? (
          <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {activities.map((item) => (
              <EventMiniPreview key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <EventFeaturePreview item={activities[0]} />
        )}
      </div>
    </div>
  );
}

/** Exactly one real happening — fills the available right-panel width
 * instead of sitting in a small tile with dead space beside it. */
function EventFeaturePreview({ item }: { item: LocationActivityPreviewItem }) {
  return (
    <Link
      href={item.href}
      aria-label={`View ${item.kind === "event" ? "Event" : "Appearance"}: ${item.title}`}
      className="flex min-h-0 flex-1 items-stretch gap-2.5 overflow-hidden rounded-2xl border border-black/5 bg-black/[0.02] transition active:scale-[0.98]"
    >
      <div className="relative w-2/5 shrink-0 overflow-hidden bg-black/5">
        {item.imageUrl ? (
          <SupabaseImage src={item.imageUrl} alt="" fill sizes="160px" className="object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-ink">
            <TagGlyph className="h-5 w-5 text-white/40" />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-2 pr-2.5">
        <p className="line-clamp-2 text-sm font-bold leading-snug text-ink">{item.title}</p>
        <p className="flex items-center gap-1.5 text-xs text-ink/55">
          <CalendarGlyph className="h-3.5 w-3.5 shrink-0" />
          {formatDateShort(item.startAt)}
        </p>
        <p className="flex items-center gap-1.5 text-xs text-ink/55">
          <ClockGlyph className="h-3.5 w-3.5 shrink-0" />
          {formatTime(item.startAt)}
        </p>
        <span className="mt-0.5 flex w-fit items-center gap-1 text-xs font-bold text-findmi-700">
          View Event
          <ChevronGlyph className="h-2.5 w-2.5" />
        </span>
      </div>
    </Link>
  );
}

/** 2+ real happenings — a compact, fixed-width tile so "1 full + about
 * half of the next" is visible before the user swipes this inner rail. */
function EventMiniPreview({ item }: { item: LocationActivityPreviewItem }) {
  return (
    <Link
      href={item.href}
      aria-label={`View ${item.kind === "event" ? "Event" : "Appearance"}: ${item.title}`}
      className="flex h-full w-28 shrink-0 items-stretch gap-1.5 overflow-hidden rounded-xl border border-black/5 bg-black/[0.02] text-left transition active:scale-[0.97] sm:w-32"
    >
      <div className="relative w-11 shrink-0 overflow-hidden bg-black/5">
        {item.imageUrl ? (
          <SupabaseImage src={item.imageUrl} alt="" fill sizes="44px" className="object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-ink">
            <TagGlyph className="h-3.5 w-3.5 text-white/40" />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-1 pr-1.5">
        <p className="truncate text-[11px] font-semibold leading-tight text-ink">{item.title}</p>
        <p className="truncate text-[10px] text-ink/45">
          {formatDateShort(item.startAt)} · {formatTime(item.startAt)}
        </p>
      </div>
    </Link>
  );
}

function PinGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 21s7-6.2 7-11.5A7 7 0 105 9.5C5 14.8 12 21 12 21z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function NavigationGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M3 11l17-8-8 17-2-7-7-2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ClockGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TagGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M11.5 4H5a1 1 0 00-1 1v6.5a1 1 0 00.3.7l9 9a1 1 0 001.4 0l6.5-6.5a1 1 0 000-1.4l-9-9a1 1 0 00-.7-.3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="8.2" cy="8.2" r="1.3" fill="currentColor" />
    </svg>
  );
}
