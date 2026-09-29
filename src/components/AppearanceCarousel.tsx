"use client";

import { useState } from "react";
import SupabaseImage from "./SupabaseImage";
import LiveDot from "./LiveDot";
import AppearanceQuickView, {
  type AppearanceQuickViewAppearance,
  type AppearanceQuickViewBusiness,
} from "./AppearanceQuickView";
import { cityState, formatAppearanceTime, getTemporalLabel } from "@/lib/format";
import { trackEvent } from "@/lib/analytics/track";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";

/** Public Appearance Quick View, Pass 1 — the Business profile's "Upcoming
 * Appearances" horizontal carousel. Replaces the vertical AppearanceCard
 * list that used to render here (that component — and its own tiered
 * Event/link/flyer/GPS click destinations — is untouched and keeps serving
 * every other caller; this is a new, deliberately visual, discovery-
 * oriented card that only ever opens the reusable AppearanceQuickView
 * modal, never navigates immediately). One modal instance is shared by the
 * whole row (keyed by whichever appearance id is open) rather than
 * mounting one per card. */

export interface AppearanceCarouselAppearance extends AppearanceQuickViewAppearance {
  flyer_image_url: string | null;
}

export default function AppearanceCarousel({
  appearances,
  business,
  analyticsContext,
}: {
  appearances: AppearanceCarouselAppearance[];
  business: AppearanceQuickViewBusiness;
  analyticsContext?: AnalyticsPlacementContext;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openAppearance = appearances.find((a) => a.id === openId) ?? null;

  return (
    <>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {appearances.map((a) => (
          <AppearanceCarouselCard
            key={a.id}
            appearance={a}
            business={business}
            onOpen={() => setOpenId(a.id)}
            analyticsContext={analyticsContext}
          />
        ))}
      </div>
      {openAppearance && (
        <AppearanceQuickView
          appearance={openAppearance}
          business={business}
          onClose={() => setOpenId(null)}
          analyticsContext={analyticsContext}
        />
      )}
    </>
  );
}

function AppearanceCarouselCard({
  appearance,
  business,
  onOpen,
  analyticsContext,
}: {
  appearance: AppearanceCarouselAppearance;
  business: AppearanceQuickViewBusiness;
  onOpen: () => void;
  analyticsContext?: AnalyticsPlacementContext;
}) {
  const { label, live } = getTemporalLabel(appearance.start_at, appearance.end_at);
  const venueLabel = appearance.location?.name ?? appearance.venue_name;
  const location = cityState(appearance.city, appearance.state);
  const analyticsFields = buildEntityEventFields(
    "appearance",
    appearance.id,
    {
      appearanceId: appearance.id,
      businessId: business.id,
      eventId: appearance.event_id,
      locationId: appearance.location_id,
    },
    analyticsContext
  );

  function handleOpen() {
    trackEvent({ event_name: "entity_click", ...analyticsFields, metadata: { action: "quick_view_open" } });
    onOpen();
  }

  const flyerUrl = appearance.flyer_image_url;

  return (
    <button
      type="button"
      onClick={handleOpen}
      aria-label={`${appearance.title}: view details`}
      className="block w-64 shrink-0 overflow-hidden rounded-2xl border border-black/5 bg-white text-left shadow-sm transition active:scale-[0.98] sm:w-72"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-mist">
        {flyerUrl ? (
          <>
            <SupabaseImage src={flyerUrl} alt="" fill sizes="(min-width: 640px) 288px, 256px" className="object-cover" />
            {business.logo_url && (
              <div className="absolute bottom-2 left-2 h-8 w-8 overflow-hidden rounded-full border-2 border-white bg-white shadow-sm">
                <SupabaseImage src={business.logo_url} alt="" fill sizes="32px" className="object-cover" />
              </div>
            )}
          </>
        ) : business.logo_url ? (
          <div className="flex h-full w-full items-center justify-center bg-findmi-50 p-8">
            <div className="relative h-full w-full">
              <SupabaseImage src={business.logo_url} alt="" fill sizes="(min-width: 640px) 288px, 256px" className="object-contain" />
            </div>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-ink">
            <StorefrontGlyph className="h-8 w-8 text-white/25" />
          </div>
        )}
        <span
          className={`absolute left-2 top-2 flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
            live ? "bg-red-600 text-white" : "bg-white/90 text-ink backdrop-blur-sm"
          }`}
        >
          {live && <LiveDot className="text-white" />}
          {label}
        </span>
      </div>
      <div className="p-3">
        {!flyerUrl && (
          <p className="truncate text-[11px] font-bold uppercase tracking-wide text-findmi-700">{business.name}</p>
        )}
        <p className="mt-0.5 line-clamp-2 font-display text-sm font-semibold leading-snug text-ink">{appearance.title}</p>
        {(venueLabel || location) && (
          <p className="mt-1 truncate text-xs text-ink/55">{[venueLabel, location].filter(Boolean).join(" · ")}</p>
        )}
        <p className="mt-0.5 truncate text-xs text-ink/45">
          {formatAppearanceTime(appearance.start_at, appearance.end_at, appearance.description)}
        </p>
      </div>
    </button>
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
