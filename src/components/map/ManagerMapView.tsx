"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Bbox, MapFeature } from "@/lib/discovery/map-core";
import type { ManagerRow } from "@/lib/discovery/manager-lens";
import { DEFAULT_MAP_BBOX } from "@/lib/map-config";

const DiscoveryMapCanvas = dynamic(() => import("./DiscoveryMapCanvas"), { ssr: false, loading: () => <div className="h-full w-full bg-[#eef0ef]" /> });

/** Business Manager Map — the consumer Discovery Map renderer with the
 * Manager lens's features; marker ↔ row selection is the same model. */
export default function ManagerMapView({ features, rows }: { features: MapFeature[]; rows: ManagerRow[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lng: number; lat: number; key: number } | null>(null);
  const bbox = useMemo<Bbox>(() => {
    if (!features.length) return DEFAULT_MAP_BBOX;
    const lngs = features.map((f) => f.lng);
    const lats = features.map((f) => f.lat);
    const pad = 0.01;
    return [Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad];
  }, [features]);
  const shown = selected ? rows.filter((r) => r.featureId === selected) : rows;
  return (
    <div className="flex flex-col gap-3 lg:flex-row">
      <div className="h-[55vh] min-h-[320px] overflow-hidden rounded-2xl border border-black/5 lg:h-[70vh] lg:flex-1">
        <DiscoveryMapCanvas features={features} selectedId={selected} onSelect={setSelected} onViewportChange={() => undefined} initialBbox={bbox} focus={focus} label="Map of your Business's places and relationships" />
      </div>
      <div className="flex flex-col gap-2 lg:max-h-[70vh] lg:w-[38%] lg:overflow-y-auto">
        {selected && (
          <button type="button" onClick={() => setSelected(null)} className="self-start text-xs font-bold text-findmi-700 hover:underline">
            Show All
          </button>
        )}
        {shown.length === 0 ? (
          <p className="text-sm text-ink/60">Nothing on the map for these layers yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((r) => (
              <li key={r.key}>
                <div className={`flex items-center justify-between gap-3 rounded-2xl border bg-white px-3.5 py-2.5 ${selected === r.featureId ? "border-findmi" : "border-black/5"}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(r.featureId);
                      setFocus({ lng: r.lng, lat: r.lat, key: Date.now() });
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm font-bold text-ink">
                      {r.place} <span className="font-semibold text-ink/50">— {r.status}</span>
                    </span>
                    {r.detail && <span className="block truncate text-xs text-ink/55">{r.detail}</span>}
                  </button>
                  {r.href && (
                    <Link href={r.href} className="shrink-0 text-xs font-bold text-findmi-700 hover:underline">
                      View
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
