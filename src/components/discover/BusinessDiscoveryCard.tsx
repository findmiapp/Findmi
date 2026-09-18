"use client";

import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import type { BusinessWithCategories } from "@/lib/types";
import type { NextAppearanceHint } from "@/lib/data";
import { cityState, formatDateShort } from "@/lib/format";
import { trackEvent } from "@/lib/analytics/track";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";

/** Businesses Discovery V4 — a dedicated DENSE result presentation for
 * /businesses' own Results Mode grid, deliberately separate from
 * BusinessLogoCard (the rich vertical card Browse Mode's rails, Discover
 * More Like This, and Brands We Love all still use unchanged). A
 * BusinessLogoCard-sized card is right for a curated rail or a profile's
 * "similar businesses" strip; it's far too tall for a scannable search-
 * results list, where a customer wants to compare several Businesses per
 * viewport, not admire one. This card exists so that redesign never has
 * to touch — or compromise — the other, genuinely different job those
 * surfaces do.
 *
 * Image-led but compact: a wide (not full-bleed-tall) thumbnail, then one
 * flat content block — name (+ a small inline Pro/Founding/New signal,
 * not a banner over the photo), category · geography, and a "Next Up"
 * line using the exact same NextAppearanceHint bulk-fetched by the page
 * (getNextAppearanceHints — zero new queries). No separate "View
 * Profile" CTA line; the whole card is the single tap target, which is
 * itself part of the density win. Same entity_impression/entity_click
 * analytics wiring as BusinessLogoCard (buildEntityEventFields), so the
 * results grid keeps the same tracked placement it always had. */
export default function BusinessDiscoveryCard({
  business,
  nextAppearance,
  analyticsContext,
}: {
  business: BusinessWithCategories;
  nextAppearance?: NextAppearanceHint | null;
  analyticsContext?: AnalyticsPlacementContext;
}) {
  const category = business.categories[0]?.name;
  const geo = cityState(business.city, business.state);
  const meta = [category, geo].filter(Boolean).join(" · ");
  const image = business.cover_image_url ?? business.logo_url;
  const isLogoOnly = !business.cover_image_url && Boolean(business.logo_url);

  // Same precedence BusinessLogoCard's own badge already uses (Pro
  // Member > Founding Member > recency-based New, never alongside
  // is_featured) — only WHERE/HOW prominently it renders changes here,
  // not what it means or when it appears.
  const badge = business.is_pro_member
    ? "Pro Member"
    : business.founding_member
      ? "Founding Member"
      : !business.is_featured && Date.now() - new Date(business.created_at).getTime() < 30 * 24 * 60 * 60 * 1000
        ? "New"
        : null;

  const analyticsFields = buildEntityEventFields("business", business.id, { businessId: business.id }, analyticsContext);
  const impressionRef = useViewportImpression<HTMLAnchorElement>({ event_name: "entity_impression", ...analyticsFields });

  return (
    <Link
      ref={impressionRef}
      href={`/business/${business.slug}`}
      onClick={() => trackEvent({ event_name: "entity_click", ...analyticsFields })}
      className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-2.5 shadow-sm transition active:scale-[0.98] hover:border-black/10 hover:shadow"
    >
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-mist">
        {image ? (
          <SupabaseImage
            src={image}
            alt=""
            fill
            sizes="80px"
            className={isLogoOnly ? "object-contain p-2" : "object-cover"}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-ink">
            <StorefrontGlyph className="h-6 w-6 text-white/25" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5">
          <span className="truncate font-display text-sm font-bold text-ink">{business.name}</span>
          {badge && (
            <span className="shrink-0 rounded-full bg-findmi-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-findmi-700">
              {badge}
            </span>
          )}
        </p>
        {meta && <p className="truncate text-xs text-ink/55">{meta}</p>}
        {nextAppearance && (
          <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-findmi-700">
            <CalendarGlyph className="h-3 w-3 shrink-0" />
            <span className="truncate">
              Next Up · {formatDateShort(nextAppearance.startAt)} · {nextAppearance.venue}
            </span>
          </p>
        )}
      </div>
    </Link>
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
