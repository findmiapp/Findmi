"use client";

import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import LiveDot from "@/components/LiveDot";
import type { AppearanceFeedItem } from "@/lib/data";
import { cityState, getTemporalLabel } from "@/lib/format";
import { trackEvent } from "@/lib/analytics/track";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";

/** Discovery Density System V1 — the COLLECTIBLE card for "Happening
 * Soon" on /discover, replacing AppearanceFeedCard's row shape there
 * (AppearanceFeedCard itself is untouched — it's still used elsewhere as
 * a text/avatar row; this is a new, additive, image-forward sibling for
 * the discovery-rail context specifically, same split already drawn
 * between LocationCard/LocationDiscoveryCard and BusinessCard/
 * BusinessDiscoveryCard). Deliberately small and quick to scan — this is
 * a "quick discovery window," not a full appearance detail: image (or an
 * honest fallback, never fabricated), a real TODAY/TOMORROW/date label,
 * the business identity, the appearance title, and where. No Save
 * control — appearances have no save/follow entity type today
 * (useAccountSaved's SavedEntityType is business/event/product/location
 * only); inventing one would be new entitlement/query architecture, out
 * of this pass's scope. Always links to the business (same destination
 * AppearanceFeedCard already uses) — an appearance's real "profile" lives
 * on its business, not a standalone page of its own. */
export default function AppearanceDiscoveryCard({
  item,
  analyticsContext,
}: {
  item: AppearanceFeedItem;
  analyticsContext?: AnalyticsPlacementContext;
}) {
  const { label: when, live } = getTemporalLabel(item.start_at, item.end_at);
  const imageUrl = item.flyer_image_url ?? item.business.cover_image_url ?? item.business.logo_url ?? null;
  const whereLabel = item.location?.name ?? (item.city ? cityState(item.city, item.state) : null);

  const analyticsFields = buildEntityEventFields(
    "appearance",
    item.id,
    {
      appearanceId: item.id,
      businessId: item.business_id,
      eventId: item.event_id,
      eventOccurrenceId: item.event_occurrence_id,
      locationId: item.location_id,
    },
    analyticsContext
  );
  const impressionRef = useViewportImpression<HTMLAnchorElement>({ event_name: "entity_impression", ...analyticsFields });

  return (
    <Link
      ref={impressionRef}
      href={`/business/${item.business.slug}`}
      onClick={() => trackEvent({ event_name: "entity_click", ...analyticsFields })}
      className="flex flex-col overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm transition active:scale-[0.98] hover:border-black/10 hover:shadow"
    >
      <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-black/5">
        {imageUrl ? (
          <SupabaseImage
            src={imageUrl}
            alt={item.business.name}
            fill
            sizes="(min-width: 1024px) 18vw, (min-width: 640px) 25vw, 42vw"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-findmi-700 to-ink">
            <CalendarGlyph className="h-8 w-8 text-white/25" />
          </div>
        )}
        <div className="absolute left-1.5 top-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
              live
                ? "animate-happening-now-glow bg-red-600 text-white"
                : "bg-black/45 text-white backdrop-blur-sm"
            }`}
          >
            {live && <LiveDot className="text-white" />}
            {live ? "Now" : when}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-0.5 p-2.5">
        <p className="truncate text-[10px] font-bold uppercase tracking-wide text-ink/40">{item.business.name}</p>
        <p className="line-clamp-2 font-display text-xs font-bold leading-snug text-ink">{item.title}</p>
        {whereLabel && <p className="truncate text-[11px] text-ink/45">{whereLabel}</p>}
      </div>
    </Link>
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
