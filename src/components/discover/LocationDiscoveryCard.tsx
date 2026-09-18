"use client";

import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import type { LocationWithCategory } from "@/lib/data";
import { cityState } from "@/lib/format";
import { trackEvent } from "@/lib/analytics/track";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";

/** Locations Discovery V4 — a dedicated DENSE result presentation for
 * /locations' own results grid, deliberately separate from LocationCard
 * (which stays unchanged — it's also used by Saved and Following, both
 * out of scope here). Same split BusinessDiscoveryCard already drew
 * against BusinessLogoCard for /businesses, and EventDiscoveryCard drew
 * against HomeEventCard for /events.
 *
 * LocationCard's own "photo on top, logo overlapping its corner, name/
 * meta/upcoming/CTA stacked below" composition is right for a curated
 * profile-style rail; it's what made a single Location eat most of a
 * mobile viewport in search results. This card borrows
 * BusinessDiscoveryCard's proven compact horizontal row instead (fixed
 * thumbnail + one flat content block, whole card as the tap target, no
 * separate CTA line) — a Location is a persistent place, closer to a
 * Business in discovery shape than to an Event's time-boxed happening.
 *
 * Image priority mirrors BusinessDiscoveryCard's cover-then-logo
 * fallback, plus one addition: when a Location has BOTH a cover photo
 * and a logo, a small logo badge overlaps the thumbnail's corner (a
 * scaled-down version of LocationCard's own overlap treatment) so real
 * brand identity isn't lost just because the thumbnail is small. */
export default function LocationDiscoveryCard({
  location,
  analyticsContext,
}: {
  location: LocationWithCategory;
  analyticsContext?: AnalyticsPlacementContext;
}) {
  const geo = cityState(location.city, location.state);
  const meta = [location.category?.name, geo].filter(Boolean).join(" · ");
  const upcoming = location.upcomingCount ?? 0;
  const hasCover = Boolean(location.cover_image_url);
  const hasLogo = Boolean(location.logo_url);
  const showLogoBadge = hasCover && hasLogo;

  const analyticsFields = buildEntityEventFields("location", location.id, { locationId: location.id }, analyticsContext);
  const impressionRef = useViewportImpression<HTMLAnchorElement>({ event_name: "entity_impression", ...analyticsFields });

  return (
    <Link
      ref={impressionRef}
      href={`/location/${location.slug}`}
      onClick={() => trackEvent({ event_name: "entity_click", ...analyticsFields })}
      className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-2.5 shadow-sm transition active:scale-[0.98] hover:border-black/10 hover:shadow"
    >
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-mist">
        {hasCover ? (
          <SupabaseImage src={location.cover_image_url!} alt="" fill sizes="80px" className="object-cover" />
        ) : hasLogo ? (
          <SupabaseImage src={location.logo_url!} alt={location.name} fill sizes="80px" className="object-contain p-2" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-ink">
            <PinGlyph className="h-6 w-6 text-white/25" />
          </div>
        )}
        {showLogoBadge && (
          <div className="absolute -bottom-1 -right-1 h-7 w-7 overflow-hidden rounded-full bg-white shadow ring-2 ring-white">
            <SupabaseImage src={location.logo_url!} alt="" fill sizes="28px" className="object-contain p-0.5" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm font-bold text-ink">{location.name}</p>
        {meta && <p className="truncate text-xs text-ink/55">{meta}</p>}
        {upcoming > 0 && (
          <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-findmi-700">
            <CalendarGlyph className="h-3 w-3 shrink-0" />
            <span>{upcoming} upcoming</span>
          </p>
        )}
      </div>
    </Link>
  );
}

function PinGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 21s7-6.2 7-11.5A7 7 0 105 9.5C5 14.8 12 21 12 21z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.6" />
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
