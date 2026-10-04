"use client";

import { useState } from "react";
import Link from "next/link";
import SupabaseImage from "../SupabaseImage";
import LiveDot from "../LiveDot";
import SectionHeading from "../SectionHeading";
import ViewToggle, { useStoredView } from "../ViewToggle";
import { HorizontalScroller } from "../Section";
import AppearanceQuickView, { type AppearanceQuickViewAppearance, type AppearanceQuickViewBusiness } from "../AppearanceQuickView";
import type { FindmiHereModel, HereItem } from "@/lib/findmi-here";
import type { BusinessLocationItem } from "@/lib/business-locations";
import {
  APP_TIMEZONE,
  cityState,
  formatAppearanceDateRange,
  formatDateShort,
  formatTime,
  getTemporalLabel,
  resolveVenueLabel,
} from "@/lib/format";
import { resolveAppearanceDisplayImage } from "@/lib/appearance-image";
import { trackEvent } from "@/lib/analytics/track";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";

/** Public Business V2 — "Findmi Here", the centerpiece of the Business
 * page: where this Business is, will be, and has been.
 *
 *   Happening Now — genuinely live only (see lib/findmi-here isLiveNow)
 *   Upcoming      — one item per experience (a multi-date Event is ONE
 *                   item; its schedule lives on the Event page); Cards /
 *                   List once there are 3+ items
 *   Places        — the Business's public Locations (consumer word only;
 *                   the records stay Locations)
 *   Past          — compact recent history, quieter, never outranking the
 *                   groups above
 *
 * Groups render only with content; with nothing current, one Follow line.
 * Event items link to the Event; standalone appearances open the shared
 * AppearanceQuickView (same quick_view_open tracking as before). */

export type HereAppearance = AppearanceQuickViewAppearance & {
  flyer_image_url: string | null;
  event?: { slug: string; name?: string; cover_image_url?: string | null } | null;
  location?: { id?: string; name: string; slug: string } | null;
  /** Derived from approved Event participation (no Appearance row). */
  derived?: boolean;
};

type Spotlight = FindmiHereModel<HereAppearance>["spotlight"];

const VIEW_STORAGE_KEY = "findmi:business-findmi-here-view";
const PAST_PREVIEW = 3;
/** Expanded Recently stays a short recent history (no "all history" route
 * exists yet) — never a wall of repeated stops. */
const PAST_EXPANDED_MAX = 10;

export default function BusinessFindmiHere({
  spotlight,
  now,
  upcoming,
  past,
  places,
  business,
  galleryImages,
  analyticsContext,
}: {
  spotlight: Spotlight;
  now: HereItem<HereAppearance>[];
  upcoming: HereItem<HereAppearance>[];
  past: HereItem<HereAppearance>[];
  places: BusinessLocationItem[];
  business: AppearanceQuickViewBusiness;
  galleryImages: string[];
  analyticsContext?: AnalyticsPlacementContext;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, chooseView] = useStoredView(VIEW_STORAGE_KEY);
  const [pastExpanded, setPastExpanded] = useState(false);
  const allAppearances = [...(spotlight ? [spotlight.item] : []), ...now, ...upcoming, ...past].flatMap((i) => i.appearances);
  const openAppearance = allAppearances.find((a) => a.id === openId && !a.derived) ?? null;

  const hasCurrent = Boolean(spotlight && spotlight.state !== "recent") || now.length > 0 || upcoming.length > 0 || places.length > 0;
  const showToggle = upcoming.length >= 3;

  function changeView(next: "cards" | "list") {
    if (next === view) return;
    chooseView(next);
    // Unchanged analytics contract: the generic entity_click carries it.
    trackEvent({
      event_name: "entity_click",
      subject_type: "business",
      subject_id: business.id,
      business_id: business.id,
      metadata: { action: "findmi_here_view_change", view: next },
    });
  }

  const itemProps = { business, galleryImages, analyticsContext, onOpen: setOpenId };
  const visiblePast = past.slice(0, pastExpanded ? PAST_EXPANDED_MAX : PAST_PREVIEW);
  const pastMore = Math.min(past.length, PAST_EXPANDED_MAX) - PAST_PREVIEW;

  return (
    <section id="findmi-here" className="scroll-mt-24">
      <SectionHeading>Findmi Here</SectionHeading>

      {spotlight && (
        <div className="mt-3">
          <SpotlightCard spotlight={spotlight} {...itemProps} />
        </div>
      )}

      {!hasCurrent && (
        <p className="mt-3 text-body text-secondary">
          {spotlight ? "Nothing scheduled right now. " : "No upcoming activity yet. "}
          Follow {business.name} to hear where they&rsquo;ll be next.
        </p>
      )}

      {now.length > 0 && (
        <div className="mt-6">
          <GroupHeading live>Happening Now</GroupHeading>
          <Rail>
            {now.map((item) => (
              <div key={item.key} className="shrink-0 snap-start">
                <HereCard item={item} {...itemProps} />
              </div>
            ))}
          </Rail>
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <GroupHeading>{spotlight && spotlight.state !== "recent" ? "Also Coming Up" : "Upcoming"}</GroupHeading>
            </div>
            {showToggle && <ViewToggle view={view} onChange={changeView} label="Show upcoming as" />}
          </div>
          {showToggle && view === "list" ? (
            <ul className="mt-2.5 divide-y divide-black/[0.06] border-y border-black/[0.06]">
              {upcoming.map((item) => (
                <li key={item.key}>
                  <HereListRow item={item} {...itemProps} />
                </li>
              ))}
            </ul>
          ) : (
            <Rail>
              {upcoming.map((item) => (
                <div key={item.key} className="shrink-0 snap-start">
                  <HereCard item={item} {...itemProps} />
                </div>
              ))}
            </Rail>
          )}
        </div>
      )}

      {places.length > 0 && (
        <div className="mt-6">
          <GroupHeading>Places</GroupHeading>
          <ul className="mt-2 divide-y divide-black/[0.06] border-y border-black/[0.06]">
            {places.map((place) => (
              <li key={place.locationId}>
                <PlaceRow place={place} showPrimary={places.length > 1} businessId={business.id} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {past.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <GroupHeading>{spotlight?.state === "recent" ? "Also Recently" : "Recently"}</GroupHeading>
            {pastMore > 0 && (
              <button
                type="button"
                onClick={() => setPastExpanded((v) => !v)}
                className="shrink-0 text-metadata font-semibold text-findmi-700 hover:underline"
              >
                {pastExpanded ? "Show less" : `Show ${pastMore} more`}
              </button>
            )}
          </div>
          <Rail>
            {visiblePast.map((item) => (
              <div key={item.key} className="shrink-0 snap-start">
                <HereCard item={item} past {...itemProps} />
              </div>
            ))}
          </Rail>
        </div>
      )}

      {openAppearance && (
        <AppearanceQuickView appearance={openAppearance} business={business} onClose={() => setOpenId(null)} analyticsContext={analyticsContext} />
      )}
    </section>
  );
}

/** Edge-bleeding horizontal rail (first card on the page gutter, snap). */
function Rail({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 mt-1 sm:-mx-6 lg:mx-0">
      <HorizontalScroller className="snap-x snap-mandatory scroll-px-4 pt-1.5 sm:scroll-px-6 lg:scroll-px-0 lg:px-0">
        {children}
        <span aria-hidden="true" className="w-px shrink-0" />
      </HorizontalScroller>
    </div>
  );
}

function GroupHeading({ children, live = false, muted = false }: { children: React.ReactNode; live?: boolean; muted?: boolean }) {
  return (
    <h3 className={`flex items-center gap-1.5 text-card-title font-bold ${muted ? "text-muted" : live ? "text-red-600" : "text-primary"}`}>
      {live && <LiveDot className="text-red-600" />}
      {children}
    </h3>
  );
}

// ── shared item helpers ─────────────────────────────────────────────────

function monthDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: APP_TIMEZONE, month: "short", day: "numeric" });
}

function yearOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: APP_TIMEZONE, year: "numeric" });
}

function venueFor(item: HereItem<HereAppearance>): string | null {
  const labels = Array.from(new Set(item.appearances.map((a) => resolveVenueLabel(a)).filter((v): v is string => Boolean(v))));
  if (labels.length <= 1) return labels[0] ?? null;
  return `${labels.length} places`;
}

/** "Oct 4 – Oct 31 · 12 dates" for a multi-date Event; the appearance's
 * own date/time (Time TBD aware) for a single date. */
function scheduleLine(item: HereItem<HereAppearance>): string {
  const n = item.appearances.length;
  if (n > 1) return `${monthDay(item.firstStart)} – ${monthDay(item.lastEnd)} · ${n} dates`;
  return formatAppearanceDateRange(item.lead.start_at, item.lead.end_at, item.lead.description);
}

function directionsHref(a: HereAppearance): string | null {
  const query = [a.location?.name ?? a.venue_name, a.address, cityState(a.city, a.state)].filter(Boolean).join(", ");
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

function imageFor(item: HereItem<HereAppearance>, business: AppearanceQuickViewBusiness, galleryImages: string[]): string | null {
  return resolveAppearanceDisplayImage({
    appearanceId: item.lead.id,
    specificImageUrl: item.lead.flyer_image_url ?? item.lead.event?.cover_image_url ?? null,
    galleryImages,
    businessCoverUrl: business.cover_image_url,
  });
}

interface ItemProps {
  item: HereItem<HereAppearance>;
  business: AppearanceQuickViewBusiness;
  galleryImages: string[];
  analyticsContext?: AnalyticsPlacementContext;
  onOpen: (id: string) => void;
}

function itemAnalyticsFields(item: HereItem<HereAppearance>, business: AppearanceQuickViewBusiness, analyticsContext?: AnalyticsPlacementContext) {
  const a = item.lead;
  // Derived (participation-only) rows have no Appearance id — attribute to
  // the Event instead of inventing an appearance subject.
  if (a.derived && a.event_id) {
    return buildEntityEventFields("event", a.event_id, { eventId: a.event_id, businessId: business.id, locationId: a.location_id }, analyticsContext);
  }
  return buildEntityEventFields(
    "appearance",
    a.id,
    { appearanceId: a.id, businessId: business.id, eventId: a.event_id, locationId: a.location_id },
    analyticsContext
  );
}

/** Event items navigate to the Event (its schedule); standalone items open
 * the shared Quick View. Same element contract for cards and rows. */
function ItemTarget({
  item,
  business,
  analyticsContext,
  onOpen,
  className,
  children,
}: Omit<ItemProps, "galleryImages"> & { className: string; children: React.ReactNode }) {
  const fields = itemAnalyticsFields(item, business, analyticsContext);
  if (item.kind === "event" && item.eventSlug) {
    return (
      <Link
        href={`/event/${item.eventSlug}`}
        onClick={() => trackEvent({ event_name: "entity_click", ...fields, metadata: { ...fields.metadata, action: "event_open" } })}
        className={className}
      >
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        trackEvent({ event_name: "entity_click", ...fields, metadata: { ...fields.metadata, action: "quick_view_open" } });
        onOpen(item.lead.id);
      }}
      aria-label={`${item.title}: view details`}
      className={`text-left ${className}`}
    >
      {children}
    </button>
  );
}

function DirectionsLink({ item, business, analyticsContext }: Omit<ItemProps, "galleryImages" | "onOpen">) {
  const href = directionsHref(item.lead);
  const fields = itemAnalyticsFields(item, business, analyticsContext);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={() => trackEvent({ event_name: "click_directions", ...fields })}
      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-black/10 px-4 text-button font-bold text-ink/70 transition hover:border-ink/30 hover:text-ink"
    >
      <DirectionsGlyph className="h-4 w-4" />
      Directions
    </a>
  );
}

// ── Spotlight ───────────────────────────────────────────────────────────

const SPOTLIGHT_LABEL: Record<NonNullable<Spotlight>["state"], string> = {
  featured: "Featured",
  now: "Happening Now",
  next: "Next Up",
  recent: "Recently",
};

/** The large photographic card at the top of Findmi Here — the visual
 * weight the pre-V2 Featured Appearance card carried (16:10 photo, dark
 * gradient, title/date/place over it, actions beneath), now for whichever
 * experience the model promotes. */
function SpotlightCard({ spotlight, business, galleryImages, analyticsContext, onOpen }: Omit<ItemProps, "item"> & { spotlight: NonNullable<Spotlight> }) {
  const { item, state, live } = spotlight;
  const photo = imageFor(item, business, galleryImages);
  const venue = venueFor(item);
  const n = item.appearances.length;
  const when =
    state === "recent"
      ? pastLine(item)
      : live
        ? item.lead.end_at
          ? `Happening now · until ${formatTime(item.lead.end_at)}`
          : "Happening now"
        : n > 1
          ? `${scheduleLine(item)} · Next ${formatDateShort(item.lead.start_at)}`
          : scheduleLine(item);
  const label = SPOTLIGHT_LABEL[state];
  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm">
      <ItemTarget item={item} business={business} analyticsContext={analyticsContext} onOpen={onOpen} className="group relative block aspect-[16/10] w-full overflow-hidden bg-ink sm:aspect-[2/1]">
        {photo ? (
          <SupabaseImage src={photo} alt="" fill sizes="(min-width: 1024px) 720px, 100vw" className="object-cover transition duration-300 group-hover:scale-[1.02]" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-ink to-findmi-900" />
        )}
        <span
          className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
            live ? "bg-red-600 text-white" : state === "recent" ? "bg-black/55 text-white backdrop-blur-sm" : "bg-white/90 text-ink backdrop-blur-sm"
          }`}
        >
          {live && <LiveDot className="text-white" />}
          {live && state === "featured" ? "Featured · Live" : label}
        </span>
        {n > 1 && (
          <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
            {n} dates
          </span>
        )}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3.5 pt-16 sm:p-5"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.66) 30%, rgba(0,0,0,0.25) 60%, rgba(0,0,0,0) 88%)" }}
        >
          <p className="line-clamp-2 font-display text-card-title-lg font-bold text-white sm:text-section-title-lg">{item.title}</p>
          <p className="text-metadata font-medium text-white/90">{when}</p>
          {venue && <p className="line-clamp-1 text-metadata font-medium text-white/70">{venue}</p>}
        </div>
      </ItemTarget>
      <div className="flex flex-wrap items-center gap-2 p-3">
        <ItemTarget
          item={item}
          business={business}
          analyticsContext={analyticsContext}
          onOpen={onOpen}
          className="inline-flex h-10 items-center justify-center rounded-full bg-findmi px-5 text-button font-bold text-white transition hover:bg-findmi-600"
        >
          {item.kind === "event" ? "View Event" : "View Details"}
        </ItemTarget>
        {state !== "recent" && <DirectionsLink item={item} business={business} analyticsContext={analyticsContext} />}
      </div>
    </div>
  );
}

// ── Upcoming: card + list row ───────────────────────────────────────────

function HereCard({ item, business, galleryImages, analyticsContext, onOpen, past = false }: ItemProps & { past?: boolean }) {
  const photo = imageFor(item, business, galleryImages);
  const { label } = getTemporalLabel(item.lead.start_at, item.lead.end_at);
  const multi = item.appearances.length > 1;
  const venue = venueFor(item);
  return (
    <ItemTarget
      item={item}
      business={business}
      analyticsContext={analyticsContext}
      onOpen={onOpen}
      className={`group block overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm transition active:scale-[0.99] hover:border-black/10 hover:shadow ${past ? "w-56 sm:w-60" : "w-64 sm:w-72"}`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-mist">
        {photo ? (
          <>
            <SupabaseImage src={photo} alt="" fill sizes="(min-width: 640px) 288px, 256px" className="object-cover" />
            {business.logo_url && !past && (
              <div className="absolute bottom-2 left-2 h-10 w-10 overflow-hidden rounded-full border-2 border-white bg-white shadow-sm">
                <SupabaseImage src={business.logo_url} alt="" fill sizes="40px" className="object-cover" />
              </div>
            )}
          </>
        ) : business.logo_url ? (
          <div className="flex h-full w-full items-center justify-center bg-findmi-50 p-8">
            <div className="relative h-full w-full">
              <SupabaseImage src={business.logo_url} alt="" fill sizes="256px" className="object-contain" />
            </div>
          </div>
        ) : (
          <div className="h-full w-full bg-ink" />
        )}
        <span
          className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm ${
            past ? "bg-black/55 text-white" : "bg-white/90 text-ink"
          }`}
        >
          {past ? yearOf(item.lastEnd) : label}
        </span>
        {multi && (
          <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
            {item.appearances.length} dates
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="line-clamp-2 font-display text-card-title font-semibold text-primary">{item.title}</p>
        {venue && <p className="mt-1 truncate text-metadata text-secondary">{venue}</p>}
        <p className="mt-0.5 truncate text-metadata text-muted">{past ? pastLine(item) : scheduleLine(item)}</p>
        {multi && !past && <p className="mt-0.5 truncate text-metadata font-semibold text-findmi-700">Next: {formatDateShort(item.lead.start_at)}</p>}
      </div>
    </ItemTarget>
  );
}

function HereListRow({ item, business, analyticsContext, onOpen }: ItemProps) {
  const multi = item.appearances.length > 1;
  const venue = venueFor(item);
  return (
    <ItemTarget
      item={item}
      business={business}
      analyticsContext={analyticsContext}
      onOpen={onOpen}
      className="flex w-full items-center gap-3 px-1 py-2.5 transition hover:bg-black/[0.02]"
    >
      <span className="flex w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-black/[0.04] py-1.5 text-ink">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/50">
          {new Date(item.lead.start_at).toLocaleDateString("en-US", { timeZone: APP_TIMEZONE, month: "short" })}
        </span>
        <span className="text-base font-bold leading-none">
          {new Date(item.lead.start_at).toLocaleDateString("en-US", { timeZone: APP_TIMEZONE, day: "numeric" })}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-bold text-primary">{item.title}</span>
        <span className="block truncate text-metadata text-muted">
          {[venue, multi ? `${item.appearances.length} dates · Next ${formatDateShort(item.lead.start_at)}` : scheduleLine(item)]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <ChevronGlyph className="h-3.5 w-3.5 shrink-0 text-ink/25" />
    </ItemTarget>
  );
}

// ── Places ──────────────────────────────────────────────────────────────

function PlaceRow({ place, showPrimary, businessId }: { place: BusinessLocationItem; showPrimary: boolean; businessId: string }) {
  const line = [place.address, cityState(place.city, place.state)].filter(Boolean).join(", ");
  const query = [place.name, place.address, cityState(place.city, place.state)].filter(Boolean).join(", ");
  return (
    <div className="flex items-center gap-3 px-1 py-2.5">
      <Link href={`/location/${place.slug}`} className="group min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-body font-bold text-primary group-hover:text-findmi-700">{place.name}</span>
          {showPrimary && place.isPrimary && (
            <span className="shrink-0 rounded-full bg-findmi-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-findmi-700">
              Primary
            </span>
          )}
        </span>
        {line && <span className="block truncate text-metadata text-muted">{line}</span>}
      </Link>
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`}
        target="_blank"
        rel="noreferrer"
        onClick={() =>
          trackEvent({ event_name: "click_directions", subject_type: "location", subject_id: place.locationId, location_id: place.locationId, business_id: businessId })
        }
        className="shrink-0 text-metadata font-semibold text-findmi-700 hover:underline"
      >
        Directions
      </a>
    </div>
  );
}

// ── Past ────────────────────────────────────────────────────────────────

function pastLine(item: HereItem<HereAppearance>): string {
  const n = item.appearances.length;
  if (n === 1) return `${monthDay(item.firstStart)}, ${yearOf(item.firstStart)}`;
  const sameYear = yearOf(item.firstStart) === yearOf(item.lastEnd);
  const range = sameYear
    ? `${monthDay(item.firstStart)} – ${monthDay(item.lastEnd)}, ${yearOf(item.lastEnd)}`
    : `${monthDay(item.firstStart)}, ${yearOf(item.firstStart)} – ${monthDay(item.lastEnd)}, ${yearOf(item.lastEnd)}`;
  return `${range} · ${n} dates`;
}

function DirectionsGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M12 2L4.5 20.5l.9.9L12 18l6.6 3.4.9-.9L12 2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
