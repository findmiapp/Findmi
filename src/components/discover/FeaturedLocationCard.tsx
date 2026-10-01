"use client";

import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import WantHeartButton from "@/components/WantHeartButton";
import type { LocationActivityPreviewItem, LocationWithCategory } from "@/lib/data";
import { cityState, cityStateZip, formatDateShort, formatTime } from "@/lib/format";
import { trackEvent } from "@/lib/analytics/track";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";

/** Homepage Featured Locations — Horizontal Carousel pass. A dedicated,
 * homepage-only card: deliberately NOT a change to LocationDiscoveryCard
 * (still used unmodified on /locations and /discover) — that card's tall
 * vertical photo-then-content grammar is the opposite of what this
 * section now needs (a short, wide, horizontally-split LOCATION | EVENTS
 * card). Same underlying data (LocationWithCategory.activities/
 * activityCount, already batched by getFeaturedLocations/getLocations —
 * no new query), same Save (WantHeartButton) and Directions (the exact
 * mapsQuery/directionsHref pattern LocationPublicView.tsx already uses)
 * behavior reused verbatim.
 *
 * No single outer <Link> wrapping the whole card (unlike
 * LocationDiscoveryCard) — the LEFT (location identity) and RIGHT (events
 * rail) halves navigate to genuinely different destinations, so each
 * owns its own real link/button rather than one outer anchor with
 * stopPropagation overrides nested inside it. */
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
      className={`flex h-40 shrink-0 snap-start overflow-hidden rounded-3xl border border-black/5 bg-white shadow-sm sm:h-44 ${
        // Section 9/10 — a multi-event location gets the typical "most of
        // the rail" geometry; a one (or zero)-event location is allowed to
        // be genuinely narrower (content-sized, not stretched to match),
        // which naturally reveals more of the next location card instead
        // of reserving dead space for a second event that doesn't exist.
        hasMultiple ? "flex-[0_0_90%] max-w-[560px] sm:flex-[0_0_62%] lg:flex-[0_0_44%]" : "flex-[0_0_auto]"
      }`}
    >
      {/* LEFT — location photography + identity + Directions/Save. */}
      <Link
        href={`/location/${location.slug}`}
        onClick={() => trackEvent({ event_name: "entity_click", ...analyticsFields })}
        className="relative w-28 shrink-0 overflow-hidden bg-mist sm:w-32"
      >
        {location.cover_image_url ? (
          <SupabaseImage src={location.cover_image_url} alt={location.name} fill sizes="128px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ink to-black">
            <PinGlyph className="h-8 w-8 text-white/20" />
          </div>
        )}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-3/4"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.4) 55%, rgba(0,0,0,0) 100%)" }}
        />

        <div className="absolute right-2 top-2 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(directionsHref, "_blank", "noopener,noreferrer");
            }}
            aria-label={`Get directions to ${location.name}`}
            title="Directions"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition active:scale-90"
          >
            <NavigationGlyph className="h-[45%] w-[45%]" />
          </button>
          <WantHeartButton type="location" slug={location.slug} id={location.id} className="h-8 w-8" />
        </div>

        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-2.5">
          {typeLabel && <p className="truncate text-[9px] font-bold uppercase tracking-wide text-white/70">{typeLabel}</p>}
          <h3 className="line-clamp-2 font-display text-xs font-extrabold leading-snug tracking-tight text-white sm:text-sm">{location.name}</h3>
          {geo && (
            <p className="flex items-center gap-1 text-[10px] text-white/80">
              <PinGlyph className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{geo}</span>
            </p>
          )}
        </div>
      </Link>

      {/* RIGHT — "Events Happening Here," its own inner horizontal rail. */}
      <div className={`flex min-w-0 flex-col gap-1.5 bg-white p-2.5 ${hasMultiple ? "flex-1" : "shrink-0"}`}>
        <h4 className="shrink-0 font-display text-xs font-bold tracking-tight text-ink sm:text-sm">Events Happening Here</h4>
        {activities.length > 0 ? (
          <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {activities.map((item) => (
              <EventMiniPreview key={item.id} item={item} />
            ))}
          </div>
        ) : (
          // Defensive only — getFeaturedLocations already filters to
          // activityCount > 0, so this is normally unreachable; kept
          // truthful (never a fabricated event) in case activityCount and
          // the preview array ever disagree (e.g. a happening canceled
          // between the two batched queries).
          <Link href={`/location/${location.slug}`} className="mt-auto text-xs font-semibold text-findmi-700 hover:text-findmi-800">
            Explore this place →
          </Link>
        )}
      </div>
    </div>
  );
}

function EventMiniPreview({ item }: { item: LocationActivityPreviewItem }) {
  return (
    <Link
      href={item.href}
      aria-label={`View ${item.kind === "event" ? "Event" : "Appearance"}: ${item.title}`}
      className="flex w-32 shrink-0 flex-col gap-1 overflow-hidden rounded-xl border border-black/5 bg-black/[0.02] text-left transition active:scale-[0.97]"
    >
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-black/5">
        {item.imageUrl ? (
          <SupabaseImage src={item.imageUrl} alt="" fill sizes="128px" className="object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-ink">
            <TagGlyph className="h-4 w-4 text-white/40" />
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0 px-1.5 pb-1.5">
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
