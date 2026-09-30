"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";
import type { TrackEventPayload } from "@/lib/analytics/track";

export default function Section({
  title,
  subtitle,
  eyebrow,
  viewAllHref,
  children,
  className = "py-6",
  titleClassName = "text-lg font-semibold tracking-tight text-ink",
  subtitleClassName = "mt-1 text-sm text-ink/55",
  impressionPayload,
}: {
  title: string;
  subtitle?: string;
  /** Consumer Discovery Homepage V2 — an optional small label above the
   * title, for the rare section that should read as a discovery moment
   * rather than a plain row (e.g. Brands We Love). Every existing caller
   * omits this and renders exactly as before. */
  eyebrow?: string;
  viewAllHref?: string;
  children: React.ReactNode;
  /** Replaces (never appends to) the default "py-6" outer vertical
   * rhythm — a plain string swap avoids the usual Tailwind class-order
   * footgun of trying to override py-6 by appending a second py-*
   * utility. Every existing caller omits this and keeps today's exact
   * spacing; Business Directory Visual Rhythm pass is the first caller
   * to pass a tighter value, scoped to /businesses' own Browse Mode
   * rails only. */
  className?: string;
  /** Homepage Section Header Typography Consistency pass — replaces
   * (never appends to) the title's own default classes, same
   * opt-in-only pattern `className` above already established. Every
   * existing caller across the app (event/location/saved/about/admin
   * pages, etc.) omits this and keeps today's exact text-lg/semibold
   * title unchanged; only the homepage's own Brands We Love/Featured
   * Locations Section calls pass the larger What's Happening-matching
   * treatment, so this stays scoped to those two sections rather than
   * resizing every other page's section headings. */
  titleClassName?: string;
  /** Same opt-in-only override pattern as titleClassName, for the
   * subtitle paragraph. */
  subtitleClassName?: string;
  /** Analytics Phase 2A — set only by a Discovery Page Builder-driven
   * section (a homepage_rows row); every other Section caller (every
   * plain discovery route's own rails) omits this and fires nothing.
   * Fires discovery_section_impression once ~50% visible. */
  impressionPayload?: TrackEventPayload | null;
}) {
  const impressionRef = useViewportImpression<HTMLElement>(impressionPayload ?? null);

  return (
    <section ref={impressionRef} className={className}>
      {/* Launch-polish follow-up: View All used to sit inside the same
          items-end row as the title+subtitle stack, so with a subtitle
          present it bottom-aligned to the SUBTITLE line, not the title —
          reading as if it belonged with the filter pills underneath. The
          title/View All pair is now its own row (items-center, so View
          All vertically centers against the title specifically), with the
          subtitle continuing on its own line below either way. */}
      <div className="mb-3 px-4 sm:px-6">
        {eyebrow && <p className="mb-1 text-xs font-bold uppercase tracking-wide text-findmi-700">{eyebrow}</p>}
        <div className="flex items-center justify-between gap-4">
          <h2 className={titleClassName}>{title}</h2>
          {viewAllHref && (
            <Link
              href={viewAllHref}
              className="shrink-0 text-xs font-semibold text-ink/55 underline decoration-ink/25 underline-offset-4 transition hover:text-ink hover:decoration-ink/50"
            >
              View all
            </Link>
          )}
        </div>
        {subtitle && <p className={subtitleClassName}>{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

// Discovery Density System V1 — the smallest reusable foundation for the
// "vertical scroll = between contexts, horizontal scroll = within a
// context" rule. Three approximate presentation densities, reused
// wherever a discovery rail nests an entity inside another page's own
// context (see each density's own real-world calibration below, checked
// against a ~390px viewport):
//   immersive   — one dominant item, next one clearly peeking (~80vw).
//                 Major events/places/editorial moments.
//   discovery   — businesses/brands/locations inside a rail (not a full
//                 grid, which LocationDiscoveryCard's own locked baseline
//                 already owns for /locations) — enough to identify the
//                 entity, several peek (~64vw).
//   collectible — products/appearances/small moments — quick scanning,
//                 image-forward, ~2 visible at once (~48vw).
// Deliberately three fixed tokens, not a prop-per-page free-for-all — the
// same three names should mean the same thing everywhere this is reused
// (Phase 1 scope: only /discover consumes this; future phases on
// /locations, /businesses, and detail pages reuse the same tokens rather
// than inventing new ones per page).
export type RailDensity = "immersive" | "discovery" | "collectible";

const RAIL_ITEM_WIDTH: Record<RailDensity, string> = {
  // Matches the exact wrapper width the homepage's own HomeEventCard
  // carousel already ships with (src/app/(public)/page.tsx) — a proven,
  // already-live "one dominant card, next clearly peeking" ratio, reused
  // verbatim rather than inventing a slightly different number.
  immersive: "w-[80vw] max-w-[330px] sm:w-72",
  discovery: "w-[64vw] max-w-[250px] sm:w-60",
  collectible: "w-[48vw] max-w-[190px] sm:w-44",
};

/** One item inside a HorizontalScroller, sized to one of the three
 * approximate densities above. Purely a width wrapper — every card
 * component itself (HomeEventCard/BusinessCard/ProductCard/etc.) stays
 * exactly as it already is; this never restyles a card, only how much
 * horizontal room its shrink-0 wrapper gives it. */
export function RailItem({ density, children }: { density: RailDensity; children: React.ReactNode }) {
  return <div className={`shrink-0 ${RAIL_ITEM_WIDTH[density]}`}>{children}</div>;
}

export function HorizontalScroller({
  children,
  className = "",
}: {
  children: React.ReactNode;
  /** Extra classes appended after the defaults — e.g. a touch of top
   * padding for a caller whose cards have a selected-state ring/border
   * that would otherwise butt right up against this container's own top
   * edge and get clipped by its (required, for horizontal scroll)
   * overflow-x-auto — see EventOccurrenceCard's Upcoming Dates usage.
   * Every other caller passes nothing and renders exactly as before. */
  className?: string;
}) {
  // Public Experience Consolidation pass — live mobile QA showed this rail
  // could initially render already scrolled a little, with a clipped
  // "previous" card visible at the left edge instead of the first real
  // card sitting flush against the padding. Two real, non-cosmetic
  // causes, both addressed here rather than papering over it with an
  // arbitrary offset: (1) `overflow-anchor` is `auto` by default, so a
  // post-hydration layout shift anywhere in this row (an image finishing
  // layout, a client-only badge mounting) can make the browser silently
  // adjust scrollLeft to "anchor" whichever child it picked, not
  // necessarily the first one; (2) some mobile browsers restore a
  // scrollable element's last scroll offset on back-navigation/bfcache
  // independently of window scroll restoration. `overflow-anchor: none`
  // disables the first; an explicit scrollLeft reset on mount (a real
  // effect using the DOM's own scroll API, not a padding/margin hack)
  // guarantees the second never leaves a stale offset on a fresh mount.
  // Swipe/scroll behavior itself is completely untouched.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ left: 0 });
  }, []);

  return (
    <div
      ref={ref}
      className={`flex gap-4 overflow-x-auto px-4 pb-2 [overflow-anchor:none] sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {children}
    </div>
  );
}
