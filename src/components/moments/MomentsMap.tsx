"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { bboxAround, type Bbox } from "@/lib/discovery/map-core";
import type { MomentFeedCard } from "@/lib/moment-discovery";
import { momentMapBounds, momentMapFeatures } from "@/lib/moment-map";
import MomentDiscoveryCard from "./MomentDiscoveryCard";

// /moments → Map: the SAME Moments the feed shows (mode + category),
// placed by their real Location (lib/moment-map). Reuses the one Findmi map
// renderer — DiscoveryMapCanvas, with its clustering, summed counts and
// marker selection — exactly as the contextual maps do; no second map
// engine, no Search This Area, no filters of its own. Selecting a marker
// lists that place's Moments as the canonical Moment cards.

const DiscoveryMapCanvas = dynamic(() => import("@/components/map/DiscoveryMapCanvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-[#eef0ef] motion-reduce:animate-none" />,
});

export default function MomentsMap({ cards }: { cards: MomentFeedCard[] }) {
  const features = useMemo(() => momentMapFeatures(cards), [cards]);
  const [selected, setSelected] = useState<string | null>(null);
  const bbox = useMemo<Bbox | null>(() => {
    if (features.length === 1) return bboxAround(features[0].lat, features[0].lng, 0.35);
    return momentMapBounds(features);
  }, [features]);
  const onMap = features.reduce((n, f) => n + f.count, 0);
  const feature = features.find((f) => f.id === selected) ?? null;
  const picked = feature ? cards.filter((c) => feature.keys.includes(c.id)) : [];

  if (!bbox) {
    return <p className="rounded-2xl bg-black/[0.03] px-4 py-6 text-sm text-ink/55">None of these Moments has a place on the map yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="relative h-[52vh] min-h-[18rem] overflow-hidden rounded-2xl border border-black/5 bg-[#eef0ef] sm:h-[60vh]">
        <DiscoveryMapCanvas
          features={features}
          selectedId={selected}
          onSelect={setSelected}
          onViewportChange={() => undefined}
          initialBbox={bbox}
          autoCollapseAttribution
          label="Map of Moments"
        />
      </div>
      <p className="text-metadata text-muted">
        {onMap} of {cards.length} {cards.length === 1 ? "Moment" : "Moments"} on the map
        {onMap < cards.length ? " — the rest have no place attached" : ""}. {feature ? "" : "Tap a marker to see its Moments."}
      </p>
      {feature && (
        <section aria-label={`Moments at ${feature.place}`}>
          <h2 className="mb-3 text-card-title font-bold text-primary">{feature.place}</h2>
          <div className="grid grid-cols-1 gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
            {picked.map((m) => (
              <MomentDiscoveryCard key={m.id} moment={m} className="h-full" sizes="(min-width: 1024px) 340px, (min-width: 640px) 50vw, 100vw" />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
