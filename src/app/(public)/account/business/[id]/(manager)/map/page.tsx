import type { Metadata } from "next";
import Link from "next/link";
import { getManagerCore } from "../../managerContext";
import ManagerMapView from "@/components/map/ManagerMapView";
import { getManagerMapData, MANAGER_LAYER_LABELS, MANAGER_LAYERS, type ManagerLayer } from "@/lib/discovery/manager-lens";
import { managerHref } from "@/lib/manager-links";

export const metadata: Metadata = { title: "Map", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Manager Map — this Business's places and relationships on the same
 * Findmi Map engine consumers use (lib/discovery/manager-lens). Layers are
 * plain links, so every view is a shareable URL. */
export default async function ManagerMapPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ layer?: string | string[] }> }) {
  const { id } = await params;
  const { layer } = await searchParams;
  const { admin, business } = await getManagerCore(id);
  const raw = (Array.isArray(layer) ? layer.join(",") : (layer ?? "")).split(",").filter((l): l is ManagerLayer => (MANAGER_LAYERS as readonly string[]).includes(l));
  const layers: ManagerLayer[] = raw.length ? raw : [...MANAGER_LAYERS];
  const data = await getManagerMapData(admin, { id, slug: business.slug as string }, layers);
  const base = managerHref(id, "map");
  const hrefFor = (l: ManagerLayer) => {
    const next = layers.includes(l) ? layers.filter((x) => x !== l) : [...layers, l];
    return next.length && next.length < MANAGER_LAYERS.length ? `${base}?layer=${next.join(",")}` : base;
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-page-title font-bold text-primary">Map</h1>
        <p className="mt-1 text-metadata text-muted">Where {business.name as string} is, where it&rsquo;s going, and the places you&rsquo;re working on.</p>
      </div>
      <nav aria-label="Map layers" className="flex flex-wrap gap-2">
        {MANAGER_LAYERS.map((l) => {
          const on = layers.includes(l);
          return (
            <Link key={l} href={hrefFor(l)} aria-pressed={on} className={`min-h-9 rounded-full border px-3.5 py-2 text-[13px] font-semibold ${on ? "border-findmi bg-findmi text-white" : "border-black/10 bg-white text-ink/70 hover:border-black/25"}`}>
              {MANAGER_LAYER_LABELS[l]}
            </Link>
          );
        })}
      </nav>
      {data.unplaced > 0 && <p className="text-xs text-ink/55">{data.unplaced} more {data.unplaced === 1 ? "relationship is" : "relationships are"} at places that aren&rsquo;t on the map yet.</p>}
      <ManagerMapView features={data.features} rows={data.rows} />
    </div>
  );
}
