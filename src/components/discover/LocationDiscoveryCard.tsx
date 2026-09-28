"use client";

import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import WantHeartButton from "@/components/WantHeartButton";
import type { LocationActivityPreviewItem, LocationWithCategory } from "@/lib/data";
import { cityState, formatDateShort } from "@/lib/format";
import { trackEvent } from "@/lib/analytics/track";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";

/** Location Discovery Card V2 — a dedicated PLACE + ACTIVITY grammar,
 * replacing this file's earlier "Locations Discovery V4" dense-row
 * treatment (which borrowed BusinessDiscoveryCard's compact row shape).
 * That row worked for grid density but made every Location read as a
 * generic directory listing — no different from a Business or a plain
 * search result. This card is deliberately its own visual grammar: large
 * place photography establishes atmosphere (like an Event card's photo),
 * but ONLY the image's own lower edge carries a legibility scrim — unlike
 * HomeEventCard's full cinematic overlay, the card's real content area
 * below the photo is light, because a Location's job is "what is
 * happening HERE," not one time-boxed moment. Deliberately NOT built on
 * HomeEventCard/EventCard (both locked, untouched) even though it reuses
 * the same established primitives everywhere they already exist:
 * WantHeartButton for Save (identical glass affordance ProductCard/
 * HomeEventCard already use), the same findmi-teal "intelligence layer"
 * treatment Business Overview's own activity strips use for the
 * upcoming-activity summary, SupabaseImage for photography.
 *
 * Data: location.activityCount/location.activities are computed by
 * lib/data.ts's getLocations() (Location Discovery Card V2's own small,
 * additive batched-query extension — see that file) from the SAME real
 * event_occurrences.location_id / appearances.location_id relationships
 * getUpcomingAtLocation already establishes for the public Location
 * profile page — never a parallel activity system, never a fabricated
 * count. location.upcomingCount (the older, narrower occurrences-only
 * count LocationCard.tsx still reads for Saved/Following) is untouched. */

const TYPE_PILL_CLASS =
  "inline-flex items-center rounded-full bg-black/45 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-sm";

/** Truthful, non-fabricated activity-summary copy. Only ever claims "this
 * week" when every one of the location's real upcoming activities is
 * actually known (count <= the fetched preview items) AND genuinely falls
 * within the next 7 days — otherwise falls back to the safe, always-true
 * "N upcoming happenings" phrasing rather than guessing. */
function formatActivitySummary(count: number, items: LocationActivityPreviewItem[]): string | null {
  if (count <= 0) return null;
  if (count === 1) return "1 thing happening";
  const fullyVisible = count <= items.length;
  const now = Date.now();
  const allWithinWeek =
    fullyVisible &&
    items.every((item) => {
      const days = (new Date(item.startAt).getTime() - now) / 86_400_000;
      return days >= 0 && days <= 7;
    });
  return allWithinWeek ? `${count} things happening this week` : `${count} upcoming happenings`;
}

export default function LocationDiscoveryCard({
  location,
  analyticsContext,
  /** Location Discovery Card V2 — "full" (default) is the primary grid
   * card documented above. "compact" preserves the exact same grammar at
   * reduced density (shorter photo, avatar-row activity previews instead
   * of full title/date rows) for a future carousel context, matching the
   * spec's own Compact Location Card section — no current surface
   * consumes it yet, kept here so the same component covers both
   * densities rather than a second, duplicated card. */
  variant = "full",
}: {
  location: LocationWithCategory;
  analyticsContext?: AnalyticsPlacementContext;
  variant?: "full" | "compact";
}) {
  const geo = cityState(location.city, location.state);
  const typeLabel = location.category?.name ?? null;
  const activityCount = location.activityCount ?? 0;
  const activities = location.activities ?? [];
  const summary = formatActivitySummary(activityCount, activities);
  const hasActivity = activityCount > 0;
  const compact = variant === "compact";
  const overflow = Math.max(0, activityCount - activities.length);

  const analyticsFields = buildEntityEventFields("location", location.id, { locationId: location.id }, analyticsContext);
  const impressionRef = useViewportImpression<HTMLAnchorElement>({ event_name: "entity_impression", ...analyticsFields });

  return (
    <Link
      ref={impressionRef}
      href={`/location/${location.slug}`}
      onClick={() => trackEvent({ event_name: "entity_click", ...analyticsFields })}
      className="flex flex-col overflow-hidden rounded-3xl border border-black/5 bg-white shadow-sm transition active:scale-[0.98] hover:shadow-md hover:shadow-black/5"
    >
      {/* PLACE PHOTOGRAPHY — establishes atmosphere. Legibility scrim is
          confined to the image's own lower half only (never the whole
          card) — this is the one deliberate visual break from a cinematic
          Event-card overlay. */}
      <div className={`relative w-full shrink-0 bg-mist ${compact ? "h-40" : "aspect-[4/3]"}`}>
        {location.cover_image_url ? (
          <SupabaseImage
            src={location.cover_image_url}
            alt={location.name}
            fill
            sizes={compact ? "(min-width: 768px) 280px, 80vw" : "(min-width: 1024px) 360px, (min-width: 640px) 46vw, 92vw"}
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ink to-black">
            <PinGlyph className="h-10 w-10 text-white/20" />
          </div>
        )}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0) 100%)" }}
        />

        {typeLabel && (
          <span className={`absolute left-3 top-3 ${TYPE_PILL_CLASS}`}>{typeLabel}</span>
        )}
        <div className="absolute right-3 top-3">
          <WantHeartButton type="location" slug={location.slug} id={location.id} className="h-9 w-9" />
        </div>

        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-3.5">
          <h3
            className={`line-clamp-2 font-display font-extrabold leading-snug tracking-tight text-white ${compact ? "text-base" : "text-xl"}`}
          >
            {location.name}
          </h3>
          {geo && (
            <p className="flex items-center gap-1.5 text-xs text-white/85">
              <PinGlyph className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{geo}</span>
            </p>
          )}
        </div>
      </div>

      {/* ACTIVITY LAYER — the light, non-cinematic content area. A
          restrained teal intelligence strip, never a giant CTA block.
          Final Polish pass — outer gap tightened (gap-2.5 -> gap-2, ~20%)
          for cards that actually stack summary/previews/CTA; a
          no-activity card only ever renders the CTA here, so this has no
          visible effect on that state (nothing to space out). */}
      <div className={`flex flex-1 flex-col gap-2 ${compact ? "p-3" : "p-4"}`}>
        {summary && (
          <p className="flex items-center gap-1.5 text-xs font-bold text-findmi-700">
            <CalendarGlyph className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{summary}</span>
            <ChevronGlyph className="h-3 w-3 shrink-0" />
          </p>
        )}

        {hasActivity && activities.length > 0 && (compact ? (
          <div className="flex items-center -space-x-2">
            {activities.map((item) => (
              <span
                key={item.id}
                className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border-2 border-white bg-black/5"
              >
                {item.imageUrl ? (
                  <SupabaseImage src={item.imageUrl} alt="" fill sizes="32px" className="object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-ink">
                    <TagGlyph className="h-3 w-3 text-white/40" />
                  </span>
                )}
              </span>
            ))}
            {overflow > 0 && (
              <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-white bg-black/[0.06] text-[10px] font-bold text-ink/60">
                +{overflow}
              </span>
            )}
          </div>
        ) : (
          // Location Discovery Activity Rail — replaces the earlier
          // vertically-stacked title/date rows (which made an active
          // location's card height balloon into a mini schedule) with a
          // horizontal "within this card's own context" rail, matching
          // the same vertical=between-contexts / horizontal=within-a-
          // context rule /discover's rails already use. Deliberately a
          // local scroll container rather than Section.tsx's own
          // HorizontalScroller: that component's built-in px-4 sm:px-6
          // edge padding is tuned for a full-bleed page-level rail sitting
          // directly under a Section title, and would double up with this
          // card's own p-4/p-3 content padding, misaligning the rail's
          // edges against the summary line above and the CTA below it.
          // The natural clip at this container's inherited padding edge
          // is the "peek" affordance the spec asks for — no separate
          // arrow/dot/"+N more" indicator needed.
          <div className="flex gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {activities.map((item) => (
              <ActivityMiniCard key={item.id} item={item} />
            ))}
          </div>
        ))}

        {/* PRIMARY ACTION — invites exploring the place, never one event's
            conversion. Plain teal text link (matches ProductCard/Business
            Overview's own restrained CTA language), not a filled button —
            the whole card is already the tap target.
            Final Polish pass — fixes the confirmed production mismatch:
            this was gated on `compact` (the density variant) instead of
            `hasActivity`, so every full-card location said "See what's
            happening here" regardless of whether it actually had any
            upcoming activity to show. Now correctly reflects the real,
            already-computed activityCount — never re-derives it. */}
        <p
          className={`flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-findmi-700 ${
            hasActivity ? "mt-auto pt-1" : "mt-auto"
          }`}
        >
          {hasActivity ? "See what's happening here" : "Explore this place"}
          <ChevronGlyph className="h-2.5 w-2.5" />
        </p>
      </div>
    </Link>
  );
}

/** Location Discovery Activity Rail — the small, non-interactive mini-card
 * for one activity preview inside the horizontal rail. Deliberately a
 * plain <div>, never a nested <Link>/<a>: the whole LocationDiscoveryCard
 * is already one outer <Link>, and nesting anchors is invalid HTML. Shows
 * only truthful, already-fetched data (thumbnail, title, compact date) —
 * no location/geo text (redundant inside a location's own card), no
 * description, no CTA, no Save control (appearances/occurrences have no
 * save/follow entity type today — inventing one here would be new
 * entitlement architecture, out of this pass's scope). */
function ActivityMiniCard({ item }: { item: LocationActivityPreviewItem }) {
  return (
    <div className="flex w-32 shrink-0 flex-col overflow-hidden rounded-xl border border-black/5 bg-black/[0.02]">
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-black/5">
        {item.imageUrl ? (
          <SupabaseImage src={item.imageUrl} alt="" fill sizes="128px" className="object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-ink">
            <TagGlyph className="h-4 w-4 text-white/40" />
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0 px-1.5 py-1.5">
        <p className="truncate text-[11px] font-semibold leading-tight text-ink">{item.title}</p>
        <p className="truncate text-[10px] text-ink/45">{formatDateShort(item.startAt)}</p>
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
