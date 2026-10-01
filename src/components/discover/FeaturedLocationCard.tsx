"use client";

import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import LocationFollowButton from "@/components/LocationFollowButton";
import { useAccountSaved } from "@/lib/useAccountSaved";
import type { LocationActivityPreviewItem, LocationWithCategory } from "@/lib/data";
import { cityState, cityStateZip, formatDateShort, formatTime } from "@/lib/format";
import { trackEvent } from "@/lib/analytics/track";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";

/** Homepage Featured Locations — Final Horizontal Layout + Bottom Action
 * Strip pass. A dedicated, homepage-only card: deliberately NOT a change
 * to LocationDiscoveryCard (still used unmodified on /locations and
 * /discover). Same underlying data (LocationWithCategory.activities/
 * activityCount, already batched by getFeaturedLocations/getLocations —
 * no new query), same Follow (LocationFollowButton, reused verbatim at
 * its own `compact` size), Save (the exact useAccountSaved hook
 * WantHeartButton itself calls — reused directly here rather than
 * through that component, since WantHeartButton has no label slot and
 * this strip needs an icon+text "Save" pill, not an icon-only circle)
 * and Directions (the exact mapsQuery/directionsHref pattern
 * LocationPublicView.tsx already uses) behavior.
 *
 * Final layout correction — two earlier revisions tried squeezing
 * Follow/Directions/Save into the narrow left identity column, which
 * either floated them over the photo (illegible, competed with the
 * title) or cramped them beside a 3-line title in a tight 44% column.
 * Both are resolved by moving every action into its own full-width strip
 * BELOW the two content panels — a sibling of both, not nested inside
 * either one, so no nested-anchor or stopPropagation gymnastics are
 * needed anywhere in this file. The left panel goes back to full-bleed
 * photography with the identity (category/title/geo) overlaid via a
 * gradient scrim — now that no buttons compete for that space, there's
 * real room for up to a 3-line title. The right panel's event preview(s)
 * are now a vertical (image-top, text-below) card using the FULL
 * available panel width, which is what actually fixes date/time wrapping
 * ("Thu, Oct / 1") — that was a narrow-column problem, not a font-size
 * problem; solved through layout, not smaller type. */
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

  const { saved, toggle: toggleSaved } = useAccountSaved("location", location.slug, location.id);

  const analyticsFields = buildEntityEventFields("location", location.id, { locationId: location.id }, analyticsContext);
  const impressionRef = useViewportImpression<HTMLDivElement>({ event_name: "entity_impression", ...analyticsFields });

  return (
    <div
      ref={impressionRef}
      // Outer carousel geometry — ~93% of the rail on mobile (bumped from
      // 90%, giving the two content panels a little more breathing room)
      // while a deliberate sliver of the next Location still peeks;
      // narrowing at larger breakpoints where more of the rail is visible
      // at once anyway.
      className="flex shrink-0 snap-start flex-col overflow-hidden rounded-3xl border border-black/5 bg-white shadow-sm flex-[0_0_93%] max-w-[640px] sm:flex-[0_0_60%] lg:flex-[0_0_44%]"
    >
      {/* BODY — the two content panels, side by side. */}
      <div className="flex h-48 sm:h-52">
        {/* LEFT — full-bleed location photo, identity overlaid via
            gradient (category pill top, title + geo bottom). No actions
            here anymore — see the bottom strip. */}
        <Link
          href={`/location/${location.slug}`}
          onClick={() => trackEvent({ event_name: "entity_click", ...analyticsFields })}
          className="relative w-[46%] shrink-0 overflow-hidden bg-mist sm:w-[47%]"
        >
          {location.cover_image_url ? (
            <SupabaseImage src={location.cover_image_url} alt={location.name} fill sizes="280px" className="object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ink to-black">
              <PinGlyph className="h-8 w-8 text-white/20" />
            </div>
          )}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-3/4"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0) 100%)" }}
          />
          {typeLabel && (
            <span className="absolute left-2.5 top-2.5 inline-flex max-w-[calc(100%-1.25rem)] items-center truncate rounded-full bg-black/50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
              {typeLabel}
            </span>
          )}
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3">
            <h3 className="line-clamp-3 font-display text-sm font-extrabold leading-snug tracking-tight text-white sm:text-base">
              {location.name}
            </h3>
            {geo && (
              <p className="flex items-center gap-1 text-[11px] text-white/85">
                <PinGlyph className="h-3 w-3 shrink-0" />
                <span className="truncate">{geo}</span>
              </p>
            )}
          </div>
        </Link>

        {/* RIGHT — "Happening Here" (shortened from "Events Happening
            Here" so the heading fits on one line at ~390px and the
            reclaimed vertical room goes to the event title below instead).
            A single substantial vertical preview for exactly one real
            happening; a compact "1 full + partial next" horizontal rail
            of the same vertical card shape for 2+. */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 bg-white p-2.5 sm:p-3">
          <h4 className="shrink-0 font-display text-sm font-bold tracking-tight text-ink">Happening Here</h4>
          {activities.length === 0 ? (
            // Defensive only — getFeaturedLocations already filters to
            // activityCount > 0, so this is normally unreachable; kept
            // truthful (never a fabricated event) in case activityCount
            // and the preview array ever disagree (e.g. a happening
            // canceled between the two batched queries).
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

      {/* BOTTOM ACTION STRIP — full width, a sibling of both panels above
          (never nested inside the LEFT panel's <Link>), so none of these
          controls can accidentally trigger Location navigation. */}
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-t border-black/5 bg-white px-2.5 sm:px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <LocationFollowButton locationId={location.id} locationSlug={location.slug} locationName={location.name} size="compact" />
          <button
            type="button"
            onClick={() => window.open(directionsHref, "_blank", "noopener,noreferrer")}
            className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-black/10 px-2.5 text-[11px] font-semibold text-ink/70 transition active:scale-95"
          >
            <NavigationGlyph className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Directions</span>
          </button>
          <button
            type="button"
            onClick={toggleSaved}
            aria-pressed={saved}
            aria-label={saved ? `Remove ${location.name} from Saved` : `Save ${location.name}`}
            className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-black/10 px-2.5 text-[11px] font-semibold text-ink/70 transition active:scale-95"
          >
            <HeartGlyph className="h-3.5 w-3.5 shrink-0" filled={saved} />
            <span className="hidden sm:inline">{saved ? "Saved" : "Save"}</span>
          </button>
        </div>
        <div className="h-5 w-px shrink-0 bg-black/10" />
        <Link
          href={`/location/${location.slug}`}
          className="flex shrink-0 items-center gap-1 text-xs font-bold text-findmi-700 transition hover:text-findmi-800"
        >
          View This Location
          <ChevronGlyph className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

/** Exactly one real happening — a substantial vertical card (image on
 * top, full available right-panel width) instead of a small tile with
 * dead space beside it. The full-width text block beneath the image is
 * what keeps "Thu, Oct 1 · 11:00 AM – 7:00 PM" on one readable line. */
function EventFeaturePreview({ item }: { item: LocationActivityPreviewItem }) {
  return (
    <Link
      href={item.href}
      aria-label={`View ${item.kind === "event" ? "Event" : "Appearance"}: ${item.title}`}
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-black/5 bg-black/[0.02] transition active:scale-[0.98]"
    >
      {/* aspect-[2/1] (was [16/9]) — a modest ~10px shorter image at this
          panel's real mobile width, reclaimed for the title block below
          so a genuine 2-line title (line-clamp-2) has room to render
          completely instead of being sliced by the date/time row. Within
          a fixed card-height budget, the title can only gain room by the
          image giving a little back — this is the minimal version of
          that trade that still reads as a real event photo, not a
          cropped sliver. */}
      <div className="relative aspect-[2/1] w-full shrink-0 overflow-hidden bg-black/5">
        {item.imageUrl ? (
          <SupabaseImage src={item.imageUrl} alt="" fill sizes="220px" className="object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-ink">
            <TagGlyph className="h-5 w-5 text-white/40" />
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-0.5 px-2 py-1.5">
        {/* Shorter "Happening Here" heading above (was "Events Happening
            Here") reclaims the vertical room a legitimate title needs —
            up to 2 lines now, never truncated to a fragment, instead of
            the previous single-line `truncate` that could still clip a
            longer title. */}
        <p className="line-clamp-2 text-sm font-bold leading-snug text-ink">{item.title}</p>
        <p className="flex items-center gap-1 whitespace-nowrap text-xs text-ink/55">
          <CalendarGlyph className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {formatDateShort(item.startAt)} · {formatTime(item.startAt)}
          </span>
        </p>
      </div>
    </Link>
  );
}

/** 2+ real happenings — the same vertical card shape, fixed-width so
 * "1 full + about half of the next" is visible before the user swipes
 * this inner rail. */
function EventMiniPreview({ item }: { item: LocationActivityPreviewItem }) {
  return (
    <Link
      href={item.href}
      aria-label={`View ${item.kind === "event" ? "Event" : "Appearance"}: ${item.title}`}
      className="flex h-full w-28 shrink-0 flex-col overflow-hidden rounded-xl border border-black/5 bg-black/[0.02] text-left transition active:scale-[0.97] sm:w-32"
    >
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-black/5">
        {item.imageUrl ? (
          <SupabaseImage src={item.imageUrl} alt="" fill sizes="128px" className="object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-ink">
            <TagGlyph className="h-3.5 w-3.5 text-white/40" />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-1.5 py-1">
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

/** Same bookmark glyph WantHeartButton itself uses, for one consistent
 * save/bookmark visual language across the app. */
function HeartGlyph({ className, filled }: { className?: string; filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} className={className}>
      <path d="M6 4h12a1 1 0 011 1v15l-7-4-7 4V5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
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

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
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
