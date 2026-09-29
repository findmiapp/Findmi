"use client";

import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import WantHeartButton from "@/components/WantHeartButton";
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
 * flat content block — name (+ a small inline truthful "New" signal when
 * applicable, not a banner over the photo), category · geography, and a "Next Up"
 * line using the exact same NextAppearanceHint bulk-fetched by the page
 * (getNextAppearanceHints — zero new queries). No separate "View
 * Profile" CTA line; the whole card is the single tap target, which is
 * itself part of the density win. Same entity_impression/entity_click
 * analytics wiring as BusinessLogoCard (buildEntityEventFields), so the
 * results grid keeps the same tracked placement it always had.
 *
 * Businesses Discovery Density + Category Rail Pass — a second, additive
 * "rail" variant (`variant="rail"`, opt-in only; every existing caller
 * omits it and renders the original row exactly as before). Browse Mode's
 * category rails were using BusinessLogoCard — a rich, tall vertical
 * profile-preview card — at ~80vw, so only about one business was ever
 * visible per screen. Rather than shrink that card until its logo
 * overlap/NEXT UP panel/CTA line become cramped, "rail" is a dedicated
 * compact, image-forward identity card: photo on top, name + city/state
 * below, answering WHO/WHAT KIND/WHERE at a glance — no category text
 * (redundant under a category rail's own heading), no CTA chrome (the
 * whole card is already the tap target), no plan-status badge (Remove
 * Consumer-Facing Plan Status pass — see this file's `badge` below).
 * Reuses this file's existing badge logic and the same
 * NextAppearanceHint bulk data /businesses already fetches — no new
 * query. Save uses the same generic WantHeartButton overlay
 * LocationDiscoveryCard/ProductCard already use, with `type="business"`
 * (an existing SavedEntityType) — not new save/follow architecture. */
export default function BusinessDiscoveryCard({
  business,
  nextAppearance,
  analyticsContext,
  variant = "row",
}: {
  business: BusinessWithCategories;
  nextAppearance?: NextAppearanceHint | null;
  analyticsContext?: AnalyticsPlacementContext;
  variant?: "row" | "rail";
}) {
  const category = business.categories[0]?.name;
  const geo = cityState(business.city, business.state);
  const meta = [category, geo].filter(Boolean).join(" · ");
  const image = business.cover_image_url ?? business.logo_url;
  const isLogoOnly = !business.cover_image_url && Boolean(business.logo_url);

  // Remove Consumer-Facing Plan Status pass — paid plan/membership status
  // (Pro Member, Founding Member) is a commercial relationship with
  // FindMi, not a consumer discovery attribute, so it's no longer shown
  // here. is_pro_member/founding_member are untouched as real fields
  // (still read by account/admin/billing/entitlement resolution) — only
  // this public badge presentation is removed. The one remaining signal,
  // "New," is a truthful non-plan state (recent + not already Featured)
  // and is preserved exactly as before.
  const badge =
    !business.is_featured && Date.now() - new Date(business.created_at).getTime() < 30 * 24 * 60 * 60 * 1000
      ? "New"
      : null;

  const analyticsFields = buildEntityEventFields("business", business.id, { businessId: business.id }, analyticsContext);
  const impressionRef = useViewportImpression<HTMLAnchorElement>({ event_name: "entity_impression", ...analyticsFields });

  if (variant === "rail") {
    return (
      <Link
        ref={impressionRef}
        href={`/business/${business.slug}`}
        onClick={() => trackEvent({ event_name: "entity_click", ...analyticsFields })}
        className="flex flex-col overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm transition active:scale-[0.98] hover:border-black/10 hover:shadow"
      >
        <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-mist">
          {image ? (
            <SupabaseImage
              src={image}
              alt=""
              fill
              sizes="(min-width: 640px) 176px, 42vw"
              className={isLogoOnly ? "object-contain p-3" : "object-cover"}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-ink">
              <StorefrontGlyph className="h-6 w-6 text-white/25" />
            </div>
          )}
          <div className="absolute right-1.5 top-1.5">
            <WantHeartButton type="business" slug={business.slug} id={business.id} className="h-7 w-7" />
          </div>
        </div>

        <div className="flex flex-col gap-0.5 p-2">
          <p className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate font-display text-xs font-bold text-ink">{business.name}</span>
            {badge && (
              <span className="shrink-0 rounded-full bg-findmi-50 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-findmi-700">
                {badge}
              </span>
            )}
          </p>
          {geo && <p className="truncate text-[10px] text-ink/50">{geo}</p>}
          {nextAppearance && (
            <p className="truncate text-[10px] font-bold text-findmi-700">
              Next: {nextAppearance.venue} · {formatDateShort(nextAppearance.startAt)}
            </p>
          )}
        </div>
      </Link>
    );
  }

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
