"use client";

import { useState } from "react";
import ContextMap from "./map/ContextMap";
import type { GeoResult } from "@/lib/geo-results";
import AppearanceCarousel, { type AppearanceCarouselAppearance } from "./AppearanceCarousel";
import AppearanceList from "./AppearanceList";
import AppearanceQuickView, { type AppearanceQuickViewBusiness } from "./AppearanceQuickView";
import { useStoredView } from "./ViewToggle";
import { ProgressiveListFooter, useProgressiveReveal } from "./ProgressiveList";
import { trackEvent } from "@/lib/analytics/track";
import type { AnalyticsPlacementContext } from "@/lib/analytics/context";

/** FindMi Here View Modes pass — the view-owning parent for the Business
 * profile's "Findmi Here" section: one already-fetched Appearance dataset,
 * one selectable presentation ("cards" | "list", Cards by default), and
 * exactly ONE shared AppearanceQuickView instance/selection state, so
 * switching views never loses "which appearance is open" and never
 * duplicates the modal. Switching is client-side only — no refetch, no
 * route/searchParam change, same dataset either way.
 *
 * Map-ready by construction: ViewMode is the one place a future "map"
 * branch gets added (plus one more control in ViewSwitcher) — neither
 * AppearanceCarousel nor AppearanceList nor AppearanceQuickView, nor the
 * Appearance data contract they all already share, would need to change. */
type ViewMode = "cards" | "list" | "map";

export default function AppearanceFindMiHere({
  appearances,
  business,
  galleryImages,
  analyticsContext,
  geo,
}: {
  appearances: AppearanceCarouselAppearance[];
  /** Map Everywhere — the SAME schedule, each date at its own real
   * Location (lib/geo-results-server scheduleResults). Omitted → no Map. */
  geo?: GeoResult[];
  business: AppearanceQuickViewBusiness;
  /** Image Fallback Refinement pass — this Business's own existing
   * gallery (business_images), already fetched by the caller — passed
   * through to AppearanceCarousel (Cards view only; List never shows
   * imagery) so an image-less appearance card can deterministically pick
   * a real gallery photo instead of all repeating the business cover. */
  galleryImages: string[];
  analyticsContext?: AnalyticsPlacementContext;
}) {
  // Per-device Cards/List preference (Cards on first paint; the stored
  // choice applies after mount — shared useStoredView).
  const modes: ViewMode[] = geo && appearances.length > 0 ? ["cards", "list", "map"] : ["cards", "list"];
  const [view, setView] = useStoredView("findmi:business-findmi-here-view", "cards", modes);
  // Field QA UX Pass 2 — LIST view reveals 3 at a time (shared rule).
  const listReveal = useProgressiveReveal(appearances.length);
  const [openId, setOpenId] = useState<string | null>(null);
  const openAppearance = appearances.find((a) => a.id === openId) ?? null;

  function switchView(next: ViewMode) {
    if (next === view) return;
    setView(next);
    // No dedicated view-mode taxonomy event — the existing generic
    // entity_click (subject_type="business", already used elsewhere on
    // this same page) cleanly carries it via metadata, no schema/taxonomy
    // change needed.
    trackEvent({
      event_name: "entity_click",
      subject_type: "business",
      subject_id: business.id,
      business_id: business.id,
      metadata: { action: "findmi_here_view_change", view: next },
    });
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Findmi Here</p>
          <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-ink">Upcoming Schedule</h2>
          <p className="mt-0.5 text-xs text-ink/50">See where {business.name} is showing up next.</p>
        </div>
        <ViewSwitcher view={view} onChange={switchView} modes={modes} />
      </div>

      <div className="mt-3">
        {view === "map" && geo ? (
          <ScheduleMap geo={geo} total={appearances.length} name={business.name} onOpen={setOpenId} />
        ) : view === "cards" ? (
          <AppearanceCarousel
            appearances={appearances}
            business={business}
            galleryImages={galleryImages}
            onOpen={setOpenId}
            analyticsContext={analyticsContext}
          />
        ) : (
          <>
            <AppearanceList
              appearances={appearances.slice(0, listReveal.visible)}
              business={business}
              onOpen={setOpenId}
              analyticsContext={analyticsContext}
            />
            <ProgressiveListFooter
              visible={listReveal.visible}
              total={appearances.length}
              onMore={listReveal.showMore}
              onAll={listReveal.showAll}
              noun="Dates"
            />
          </>
        )}
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

/** Where can I find this Brand? — the schedule's own dates on the shared
 * contextual map; tapping a date opens the same quick view as Cards. */
function ScheduleMap({ geo, total, name, onOpen }: { geo: GeoResult[]; total: number; name: string; onOpen: (id: string) => void }) {
  const unmapped = total - geo.length;
  if (geo.length === 0)
    return <p className="rounded-2xl border border-black/5 bg-black/[0.015] p-4 text-center text-sm text-ink/60">None of these dates are at a placed Findmi Location yet — Cards and List show them all.</p>;
  return (
    <div className="flex flex-col gap-2">
      <ContextMap results={geo} label={`Map of where to find ${name}`} tall initialSelect="first" onResult={(r) => onOpen(r.key.replace(/^app:/, ""))} />
      {unmapped > 0 && (
        <p className="text-xs font-semibold text-ink/50">
          {geo.length} of {total} dates on the map · {unmapped} without {unmapped === 1 ? "a location" : "locations"}
        </p>
      )}
    </div>
  );
}

function ViewSwitcher({ view, onChange, modes }: { view: ViewMode; onChange: (v: ViewMode) => void; modes: ViewMode[] }) {
  return (
    <div role="group" aria-label="View" className="flex shrink-0 items-center gap-0.5 rounded-full border border-black/10 bg-white p-0.5">
      {(
        [
          { mode: "cards" as const, label: "Cards" },
          { mode: "list" as const, label: "List" },
          { mode: "map" as const, label: "Map" },
        ]
      ).filter(({ mode }) => modes.includes(mode)).map(({ mode, label }) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          aria-pressed={view === mode}
          className={`rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition ${
            view === mode ? "bg-findmi text-white" : "text-ink/50 hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
