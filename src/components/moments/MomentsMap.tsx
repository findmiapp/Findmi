"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { bboxAround, type Bbox } from "@/lib/discovery/map-core";
import type { MomentFeedCard } from "@/lib/moment-discovery";
import { momentCountLabel, momentMapBounds, momentMapFeatures, momentsAt, validSelection } from "@/lib/moment-map";
import MomentDiscoveryCard from "./MomentDiscoveryCard";

// /moments → Map: the SAME Moments the feed shows (mode + category),
// placed by their real Location (lib/moment-map). Reuses the one Findmi map
// renderer — DiscoveryMapCanvas, with its clustering (a cluster tap zooms
// in to separate its places), summed counts and rich selected marker — as
// the contextual maps do; no second map engine.
//
// Selecting a place opens a result tray OVER the bottom of the map (the
// /map result-preview pattern): the place, how many Moments are there, and
// those Moments as the compact canonical Moment card, swipeable when there
// are several. The map pans the selected place clear of the tray. The tray
// leaves the right edge free for the map's zoom control and attribution,
// closes with ✕, Escape or a tap on empty map, and a selection never
// outlives its marker: when mode / category change the dataset, a stale
// selection clears and the tray closes.

const DiscoveryMapCanvas = dynamic(() => import("@/components/map/DiscoveryMapCanvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-[#eef0ef] motion-reduce:animate-none" />,
});

/** Room the tray takes at the bottom of the map (px) — the selected place is
 * framed above it. */
const TRAY_CLEARANCE = 190;

export default function MomentsMap({ cards }: { cards: MomentFeedCard[] }) {
  const features = useMemo(() => momentMapFeatures(cards), [cards]);
  const [picked, setPicked] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lng: number; lat: number; key: number } | null>(null);
  const selected = validSelection(features, picked);
  // Drop a selection whose marker the current mode / category no longer shows.
  useEffect(() => {
    if (picked && !selected) setPicked(null);
  }, [picked, selected]);

  const bbox = useMemo<Bbox | null>(() => {
    if (features.length === 1) return bboxAround(features[0].lat, features[0].lng, 0.35);
    return momentMapBounds(features);
  }, [features]);
  const feature = features.find((f) => f.id === selected) ?? null;
  const here = momentsAt(features, selected, cards);
  const onMap = features.reduce((n, f) => n + f.count, 0);

  const select = (id: string | null) => {
    setPicked(id);
    const f = id ? features.find((x) => x.id === id) : null;
    if (f) setFocus((prev) => ({ lng: f.lng, lat: f.lat, key: (prev?.key ?? 0) + 1 }));
  };
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPicked(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  if (!bbox) {
    return <p className="rounded-2xl bg-black/[0.03] px-4 py-6 text-sm text-ink/55">None of these Moments has a place on the map yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="relative h-[52vh] min-h-[18rem] overflow-hidden rounded-2xl border border-black/5 bg-[#eef0ef] sm:h-[60vh]">
        <DiscoveryMapCanvas
          features={features}
          selectedId={selected}
          onSelect={select}
          onViewportChange={() => undefined}
          initialBbox={bbox}
          focus={focus}
          padding={{ top: 40, bottom: TRAY_CLEARANCE, left: 24, right: 24 }}
          autoCollapseAttribution
          label="Map of Moments"
        />
        {feature && here.length > 0 && (
          <section
            aria-label={`Moments at ${feature.place}`}
            data-moments-tray
            className="absolute bottom-2 left-2 right-12 z-10 max-w-md rounded-2xl border border-black/[0.06] bg-white/95 p-2.5 shadow-[0_8px_28px_rgba(0,0,0,0.16)] backdrop-blur sm:right-auto sm:w-[26rem]"
          >
            <div className="flex items-start justify-between gap-2 px-0.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink">{feature.place}</p>
                <p className="text-metadata font-semibold text-findmi-700">{momentCountLabel(here.length)}</p>
              </div>
              <button
                type="button"
                onClick={() => setPicked(null)}
                aria-label="Close"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink/50 transition hover:bg-black/[0.05] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
              >
                <span aria-hidden="true" className="text-lg leading-none">✕</span>
              </button>
            </div>
            <ul
              className={`mt-2 flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
            >
              {here.map((m) => (
                <li key={m.id} className={`min-w-0 snap-start ${here.length > 1 ? "w-[88%] shrink-0" : "w-full"}`}>
                  <MomentDiscoveryCard moment={m} variant="tray" />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <p className="text-metadata text-muted">
        {onMap} of {cards.length} {cards.length === 1 ? "Moment" : "Moments"} on the map
        {onMap < cards.length ? " — the rest have no place attached" : ""}.{feature ? "" : " Tap a place to see its Moments."}
      </p>
    </div>
  );
}
