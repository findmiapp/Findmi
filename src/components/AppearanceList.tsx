"use client";

import LiveDot from "./LiveDot";
import type { AppearanceCarouselAppearance } from "./AppearanceCarousel";
import type { AppearanceQuickViewBusiness } from "./AppearanceQuickView";
import { formatAppearanceTime, getTemporalLabel, resolveVenueLabel } from "@/lib/format";
import { trackEvent } from "@/lib/analytics/track";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";

/** FindMi Here View Modes pass — the List view of the same "Findmi Here"
 * dataset Cards (AppearanceCarousel.tsx) renders, dense and easy to scan
 * rather than photo-led. Adapts the compact date-tile + title/time/venue
 * row language the old public AppearanceCard list used to render here,
 * but the interaction is deliberately NOT restored: every row opens the
 * same shared AppearanceQuickView via `onOpen` (owned by the parent,
 * AppearanceFindMiHere.tsx) — never AppearanceCard's own tiered Event/
 * external-link/flyer-lightbox/GPS click destinations. Business identity
 * is intentionally omitted per row — the visitor is already on this
 * business's own profile, so repeating its name/logo on every row would
 * only be clutter, not new information.
 *
 * Public Experience Consolidation pass — same dataset/interaction as
 * above, presentation only: a real temporal label (NOW/TODAY/etc., from
 * the same getTemporalLabel every other surface already uses) leads each
 * row instead of a plain month abbreviation, venue is promoted to a real
 * (not de-emphasized) line using the shared venue-priority resolver, and
 * the row itself gets a touch more breathing room plus a visible
 * hover/active affordance so it reads as "tap for detail," not a schedule
 * printout. */
export default function AppearanceList({
  appearances,
  business,
  onOpen,
  analyticsContext,
}: {
  appearances: AppearanceCarouselAppearance[];
  business: AppearanceQuickViewBusiness;
  onOpen: (id: string) => void;
  analyticsContext?: AnalyticsPlacementContext;
}) {
  return (
    <ul className="flex flex-col divide-y divide-black/[0.05] overflow-hidden rounded-2xl border border-black/5 bg-white">
      {appearances.map((a) => (
        <AppearanceListRow key={a.id} appearance={a} business={business} onOpen={onOpen} analyticsContext={analyticsContext} />
      ))}
    </ul>
  );
}

function AppearanceListRow({
  appearance,
  business,
  onOpen,
  analyticsContext,
}: {
  appearance: AppearanceCarouselAppearance;
  business: AppearanceQuickViewBusiness;
  onOpen: (id: string) => void;
  analyticsContext?: AnalyticsPlacementContext;
}) {
  const { label, live } = getTemporalLabel(appearance.start_at, appearance.end_at);
  const venueLabel = resolveVenueLabel(appearance);
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
    onOpen(appearance.id);
  }

  return (
    <li>
      <button
        type="button"
        onClick={handleOpen}
        aria-label={`${appearance.title}: view details`}
        className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition active:scale-[0.99] hover:bg-findmi-50/60"
      >
        <div
          className={`flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl py-2 ${
            live ? "animate-happening-now-glow bg-red-600 text-white" : "bg-black/[0.04] text-ink"
          }`}
        >
          {live ? (
            <>
              <LiveDot className="text-white" />
              <span className="text-[9px] font-extrabold uppercase tracking-wide">Now</span>
            </>
          ) : (
            <>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/50">
                {new Date(appearance.start_at).toLocaleDateString("en-US", { month: "short" })}
              </span>
              <span className="text-lg font-bold leading-none">{new Date(appearance.start_at).getDate()}</span>
            </>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {!live && <p className="text-[10px] font-bold uppercase tracking-wide text-findmi-700">{label}</p>}
          <p className="mt-0.5 line-clamp-1 font-display text-sm font-semibold leading-snug text-ink">{appearance.title}</p>
          {venueLabel && <p className="mt-0.5 truncate text-xs font-medium text-ink/70">{venueLabel}</p>}
          <p className="mt-0.5 truncate text-xs text-ink/50">
            {formatAppearanceTime(appearance.start_at, appearance.end_at, appearance.description)}
          </p>
        </div>

        <ArrowGlyph className="h-3.5 w-3.5 shrink-0 text-ink/30" />
      </button>
    </li>
  );
}

function ArrowGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
