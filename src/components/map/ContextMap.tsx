"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { bboxAround, type Bbox } from "@/lib/discovery/map-core";
import { boundsOf, geoFeatures, type GeoResult } from "@/lib/geo-results";
import GeoResultCard from "./GeoResultCard";

// Map Everywhere — the contextual map on a detail page: where this is
// happening / available / located. Not /map in a card: no filters, no
// sheet, no Search This Area — just the place(s), a marker to select when
// there are several, and the way to the Place page and to the full Map.
// The map itself starts only when it scrolls near the viewport; the place
// names and addresses around it are ordinary server-rendered text.

const DiscoveryMapCanvas = dynamic(() => import("./DiscoveryMapCanvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#eef0ef]" />,
});

export default function ContextMap({ results, label, tall = false, listPlaces = true }: { results: GeoResult[]; label: string; tall?: boolean; listPlaces?: boolean }) {
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const features = useMemo(() => geoFeatures(results), [results]);
  const places = useMemo(() => {
    const seen = new Map<string, GeoResult>();
    for (const r of results) if (!seen.has(r.place.id)) seen.set(r.place.id, r);
    return [...seen.values()];
  }, [results]);
  const bbox = useMemo<Bbox | null>(() => {
    if (!results.length) return null;
    if (places.length === 1) return bboxAround(places[0].place.lat, places[0].place.lng, 0.35);
    return boundsOf(results, 0.01);
  }, [results, places]);
  if (!bbox) return null;
  const single = places.length === 1;
  const selectedFeature = features.find((f) => f.id === selected) ?? null;
  const picked = selectedFeature ? results.filter((r) => selectedFeature.keys.includes(r.key)) : [];
  const mapHref = single && places[0].place.href ? `/map?place=${encodeURIComponent(places[0].place.href.replace("/location/", ""))}` : `/map?bbox=${bbox.map((x) => Math.round(x * 1e4) / 1e4).join(",")}`;

  return (
    <div data-context-map className="flex flex-col gap-2">
      <div ref={holder} className={`relative overflow-hidden rounded-2xl border border-black/5 bg-[#eef0ef] ${tall ? "h-64 sm:h-80" : "h-40 sm:h-48"}`}>
        {visible && <DiscoveryMapCanvas features={features} selectedId={selected} onSelect={setSelected} onViewportChange={() => undefined} initialBbox={bbox} cooperativeGestures label={label} />}
        <Link href={mapHref} className="absolute right-2 top-2 z-10 rounded-full border border-black/[0.08] bg-white px-3 py-1.5 text-xs font-bold text-ink shadow-sm hover:border-black/20">
          View On Map
        </Link>
      </div>
      {picked.length > 0 && (
        <div className="flex flex-col gap-2">
          {picked.map((r) => (
            <GeoResultCard key={r.key} result={r} compact />
          ))}
        </div>
      )}
      {listPlaces && !single && (
        <ul className="flex flex-col divide-y divide-black/5 rounded-2xl border border-black/5 bg-white">
          {places.map((r) => {
            const here = results.filter((x) => x.place.id === r.place.id);
            return (
              <li key={r.place.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink">{r.place.name}</p>
                  <p className="truncate text-xs text-ink/55">{[...new Set(here.map((x) => x.status).filter(Boolean))].join(" · ") || r.place.address}</p>
                  {r.place.address && here.some((x) => x.status) && <p className="truncate text-xs text-ink/45">{r.place.address}</p>}
                </div>
                {r.place.href && (
                  <Link href={r.place.href} className="shrink-0 text-xs font-bold text-findmi-700 hover:underline">
                    View Place
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
