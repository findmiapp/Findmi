"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import SupabaseImage from "@/components/SupabaseImage";
import PageViewTracker from "@/components/analytics/PageViewTracker";
import AnalyticsLink from "@/components/analytics/AnalyticsLink";
import { trackEvent } from "@/lib/analytics/track";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";
import { buildEntityEventFields } from "@/lib/analytics/context";
import { cityState, formatAppearanceDateRange, getTemporalLabel } from "@/lib/format";
import type { AppearanceWithEventSlug } from "@/lib/data";
import type { BusinessWithCategories } from "@/lib/types";

/** Embeddable Business Widget Phase 1 — a purpose-built embedded
 * experience, deliberately NOT a shrunk-down BusinessPublicView: no
 * FindMi nav/footer/account controls (this file has zero dependency on
 * (public)/layout.tsx or any session), no Save/Follow (the widget's own
 * cross-site iframe context can't reliably keep a FindMi session anyway
 * — see the Phase 1 audit), no admin chrome. Every analytics/attribution
 * call below reuses FindMi's existing infrastructure verbatim
 * (trackEvent/useViewportImpression/PageViewTracker/AnalyticsLink,
 * buildEntityEventFields, the exact click_directions + entity_click
 * dual-fire convention AppearanceCard already uses) — nothing here
 * invents a parallel analytics or attribution system. `placement: "embed"`
 * + `metadata.source: "embed"` mark every event as widget-originated
 * without any taxonomy/schema change (page_type/placement are plain
 * clamped text server-side, not enum-enforced — see the ingestion route).
 *
 * `business`/`appearances` come from the exact same getBusinessBySlug /
 * getUpcomingAppearancesForBusiness the normal profile page and FindMi
 * Here already use — there is no Native-Rose- or illy-specific code
 * anywhere in this file; whatever business the page above resolves is
 * what renders here. */

const EMBED_PLACEMENT = "embed";
const EMBED_METADATA = { source: "embed" } as const;

/** Appends utm_source/medium/campaign to an internal Findmi destination
 * so the landing page's own existing page_view tracking (currentPageContext
 * in lib/analytics/track.ts already reads these from window.location.search
 * with zero new code) can attribute the visit back to this specific
 * business's widget — the existing UTM attribution model, not a new one. */
function withEmbedAttribution(path: string, businessSlug: string): string {
  const params = new URLSearchParams({
    utm_source: "embed_widget",
    utm_medium: "embed",
    utm_campaign: businessSlug,
  });
  return `${path}?${params.toString()}`;
}

/** Reports this element's real rendered height to the parent page via
 * postMessage, once on mount and again on every subsequent size change
 * (images/fonts loading, content changing) — the smallest reliable
 * mechanism for a host page to size its iframe to fit without clipping
 * or leftover blank space. targetOrigin is "*" deliberately: this widget
 * can be embedded on any business's own external site, so there is no
 * single parent origin to pin in advance — the payload itself carries
 * nothing sensitive (just a height number). A direct, non-embedded visit
 * (window.parent === window) never posts anything. */
function useEmbedAutoResize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    if (window.parent === window) return;

    const post = () => {
      window.parent.postMessage({ type: "findmi:resize", height: node.scrollHeight }, "*");
    };
    post();
    const observer = new ResizeObserver(post);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return ref;
}

export default function BusinessEmbedWidget({
  business,
  appearances,
  hasMoreAppearances,
}: {
  business: BusinessWithCategories;
  appearances: AppearanceWithEventSlug[];
  hasMoreAppearances: boolean;
}) {
  const rootRef = useEmbedAutoResize<HTMLDivElement>();
  const geo = cityState(business.city, business.state);
  const profileHref = withEmbedAttribution(`/business/${business.slug}`, business.slug);

  const businessAnalyticsFields = buildEntityEventFields(
    "business",
    business.id,
    { businessId: business.id },
    { pageType: "business", placement: EMBED_PLACEMENT }
  );

  return (
    <div ref={rootRef} className="mx-auto w-full max-w-2xl bg-paper px-4 py-4">
      <PageViewTracker
        subject_type="business"
        subject_id={business.id}
        business_id={business.id}
        page_type="business"
        page_path={`/embed/business/${business.slug}`}
        placement={EMBED_PLACEMENT}
        metadata={EMBED_METADATA}
      />

      {/* BRAND IDENTITY — logo + name + geo + short description. A plain
          inline row (logo beside name), not BusinessLogoCard's cover-photo-
          plus-overlapping-logo treatment: that grammar is tuned for a card
          competing inside a grid of many cards, and its absolute-position
          overlap math is the kind of thing that gets fragile at a genuine
          320px container width. This is simpler and holds up at any width. */}
      <div className="flex items-start gap-3">
        <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-black/5 bg-white">
          {business.logo_url ? (
            <SupabaseImage src={business.logo_url} alt="" fill sizes="48px" className="object-contain p-1" />
          ) : business.cover_image_url ? (
            <SupabaseImage src={business.cover_image_url} alt="" fill sizes="48px" className="object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-ink">
              <StorefrontGlyph className="h-5 w-5 text-white/30" />
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg font-bold leading-tight tracking-tight text-ink">{business.name}</p>
          {geo && <p className="truncate text-xs text-ink/50">{geo}</p>}
        </div>
      </div>

      {business.short_description && (
        <p className="mt-2.5 line-clamp-2 text-sm leading-snug text-ink/70">{business.short_description}</p>
      )}

      {/* FINDMI HERE — the widget's primary purpose. Heading is clickable
          (same profileHref/UTM attribution and entity_click analytics the
          footer's "View on Findmi" link already uses below) — same visual
          treatment as before (flex/gap/size/weight/color unchanged), just
          rendered as AnalyticsLink instead of a plain <p> so it's an
          actual link, with only a subtle hover/focus-visible affordance
          added for interactivity/accessibility. */}
      <div className="mt-4 border-t border-black/5 pt-3.5">
        <AnalyticsLink
          href={profileHref}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wide text-findmi-700 transition-colors hover:text-findmi-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-findmi-700"
          trackPayload={{ event_name: "entity_click", ...businessAnalyticsFields, metadata: EMBED_METADATA }}
        >
          <CalendarGlyph className="h-3.5 w-3.5" />
          Find {business.name} Here
        </AnalyticsLink>

        {appearances.length === 0 ? (
          <div className="mt-2.5 rounded-2xl border border-black/5 bg-black/[0.015] p-4 text-center">
            <p className="text-sm text-ink/60">Nothing announced right now.</p>
            <AnalyticsLink
              href={profileHref}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-block text-sm font-semibold text-findmi-700 underline underline-offset-2"
              trackPayload={{ event_name: "entity_click", ...businessAnalyticsFields, metadata: EMBED_METADATA }}
            >
              Follow {business.name} on Findmi to see where they&rsquo;re showing up next
            </AnalyticsLink>
          </div>
        ) : (
          <div className="mt-2.5 flex flex-col gap-2">
            {appearances.map((appearance) => (
              <AppearanceRow key={appearance.id} appearance={appearance} businessSlug={business.slug} />
            ))}
          </div>
        )}
      </div>

      {/* FOOTER — the "continue to full Findmi experience" action, plus a
          tasteful, secondary Findmi attribution. Always present (not only
          when hasMoreAppearances) — this is the widget's one persistent
          way out to the real site, same reasoning as Location/Business
          discovery cards always keeping one clear CTA to the full page. */}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-black/5 pt-3">
        <AnalyticsLink
          href={profileHref}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-findmi-700"
          trackPayload={{ event_name: "entity_click", ...businessAnalyticsFields, metadata: EMBED_METADATA }}
        >
          {hasMoreAppearances ? "See full schedule on Findmi" : "View on Findmi"}
          <ArrowGlyph className="h-2.5 w-2.5" />
        </AnalyticsLink>

        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-ink/35 transition hover:text-ink/55"
        >
          Powered by
          <Image src="/logo-lockup.png" alt="Findmi" width={73} height={30} className="h-3 w-auto" />
        </a>
      </div>
    </div>
  );
}

/** One appearance preview row — thumbnail (only when a real flyer image
 * exists; never a repeated/fabricated stand-in), title, truthful date+time
 * (formatAppearanceDateRange already handles "Time TBD" honestly), venue/
 * geo, and up to two small actions. Unlike AppearanceCard's own single-
 * winning-tier destination (built for a full-width row that IS the whole
 * tap target), this widget deliberately offers Details and Directions as
 * two independent, clearly-labeled actions when both are genuinely
 * available — closer to what "Directions" plainly means to a visitor
 * landing on someone else's website. Never more than these two. */
function AppearanceRow({ appearance, businessSlug }: { appearance: AppearanceWithEventSlug; businessSlug: string }) {
  const { label: when, live } = getTemporalLabel(appearance.start_at, appearance.end_at);
  const venueLabel = appearance.location?.name ?? appearance.venue_name;
  const geo = cityState(appearance.city, appearance.state);

  const analyticsFields = buildEntityEventFields(
    "appearance",
    appearance.id,
    {
      appearanceId: appearance.id,
      businessId: appearance.business_id,
      eventId: appearance.event_id,
      eventOccurrenceId: appearance.event_occurrence_id,
      locationId: appearance.location_id,
    },
    { pageType: "business", placement: EMBED_PLACEMENT }
  );
  const impressionRef = useViewportImpression<HTMLDivElement>({
    event_name: "entity_impression",
    ...analyticsFields,
    metadata: EMBED_METADATA,
  });

  // Details — same tiering AppearanceCard already uses for its own
  // primary destination (Event > external link > flyer), just offered
  // here as one of two explicit actions rather than the whole card's
  // only destination.
  const detailsHref = appearance.event?.slug
    ? withEmbedAttribution(`/event/${appearance.event.slug}`, businessSlug)
    : appearance.external_url
      ? appearance.external_url
      : appearance.flyer_image_url;
  const detailsIsFindmi = Boolean(appearance.event?.slug);

  // Directions — always a real destination when there's enough address
  // information, independent of whether Details is also shown: a
  // "Directions" action should mean "open a map," not "read more."
  const mapsQuery = [venueLabel, appearance.address, geo].filter(Boolean).join(", ");
  const directionsHref = mapsQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}` : null;

  return (
    <div ref={impressionRef} className="flex items-center gap-2.5 rounded-2xl border border-black/5 bg-white p-2.5">
      <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-black/5">
        {appearance.flyer_image_url ? (
          <SupabaseImage src={appearance.flyer_image_url} alt="" fill sizes="44px" className="object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-ink">
            <CalendarGlyph className="h-4 w-4 text-white/30" />
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-snug text-ink">{appearance.title}</p>
        <p className="mt-0.5 truncate text-xs text-ink/55">
          {live ? "Happening now" : when} · {formatAppearanceDateRange(appearance.start_at, appearance.end_at, appearance.description)}
        </p>
        {(venueLabel || geo) && (
          <p className="mt-0.5 truncate text-xs text-ink/45">{[venueLabel, geo].filter(Boolean).join(" · ")}</p>
        )}

        {(detailsHref || directionsHref) && (
          <div className="mt-1.5 flex items-center gap-3">
            {detailsHref && (
              <AnalyticsLink
                href={detailsHref}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-bold uppercase tracking-wide text-findmi-700"
                trackPayload={{
                  event_name: "entity_click",
                  ...analyticsFields,
                  metadata: detailsIsFindmi ? EMBED_METADATA : { ...EMBED_METADATA, external: true },
                }}
              >
                Details
              </AnalyticsLink>
            )}
            {directionsHref && (
              <AnalyticsLink
                href={directionsHref}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-bold uppercase tracking-wide text-ink/50"
                trackPayload={{ event_name: "entity_click", ...analyticsFields, metadata: EMBED_METADATA }}
                onClick={() => {
                  // Directions is both a generic activation (entity_click,
                  // fired via trackPayload above) AND specifically a
                  // Directions action — the exact same dual-signal
                  // convention AppearanceCard's own trackDirectionsClick
                  // already establishes, reused verbatim here.
                  trackEvent({ event_name: "click_directions", ...analyticsFields, metadata: EMBED_METADATA });
                }}
              >
                Directions
              </AnalyticsLink>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StorefrontGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M4 9.5L5 4h14l1 5.5M4 9.5a2.2 2.2 0 004.3.7M4 9.5a2.2 2.2 0 004.3.7m0 0a2.2 2.2 0 004.4 0m0 0a2.2 2.2 0 004.4 0m0 0a2.2 2.2 0 004.3-.7M5 10v9.5a1 1 0 001 1h5v-6h2v6h5a1 1 0 001-1V10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

function ArrowGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
