import type { Metadata } from "next";
import MapExplorer from "@/components/map/MapExplorer";
import type { FilterOptions } from "@/components/map/MapFilterSheet";
import { getMapPersonalSignals, runMapDiscovery } from "@/lib/discovery/map-server";
import { normalizeMapLens } from "@/lib/discovery/map-filters";
import { paramsToQuery, type DiscoveryQuery } from "@/lib/discovery/query";
import { getVocabulary } from "@/lib/discovery/server";
import { DEFAULT_MAP_BBOX } from "@/lib/map-config";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

/** Shareable, bookmarkable discovery state — but not an index of every
 * filter combination: only the bare /map is indexable. */
export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const params = await searchParams;
  const filtered = Object.keys(params).length > 0;
  return {
    title: "Map",
    description: "Find what's happening near you on Findmi — live now, later today, this weekend or any date, by place, brand and perks.",
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
  };
}

/**
 * Discovery Map + Feed (Discovery Engine V1). The URL is the Discovery
 * Query (lib/discovery/query). The first result set is rendered on the
 * server by the same engine the client calls afterwards.
 */
export default async function MapPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const parsed = paramsToQuery(params);
  const view = params.view === "feed" ? "feed" : "map";
  // Near Me is never resolved without the viewer's explicit tap on THIS
  // device: a shared "near me" link opens on a default area and asks.
  const nearRequested = Boolean(parsed.near && !parsed.bbox);
  // The visible lens is always what runs (an implicit Happening scope
  // becomes explicit; Places never carries time).
  const query: DiscoveryQuery = { ...normalizeMapLens(parsed).query };
  if (nearRequested) delete query.near;
  if (query.near && query.bbox) delete query.near;
  const hasGeo = Boolean(query.bbox || query.area || query.market || query.census || query.place);
  if (!hasGeo) query.bbox = DEFAULT_MAP_BBOX;

  const [vocab, personal] = await Promise.all([getVocabulary(), getMapPersonalSignals()]);
  const initialData = await runMapDiscovery(query, { personal, view }).catch(() => null);

  const tax = [...vocab.taxonomyById.values()];
  const options: FilterOptions = {
    categories: tax
      .filter((t) => t.kind === "event" && !t.parentSlug)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({
        slug: t.slug,
        name: t.name,
        children: tax.filter((c) => c.kind === "event" && c.parentSlug === t.slug).sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ slug: c.slug, name: c.name })),
      })),
    formats: tax.filter((t) => t.kind === "event_format").sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ slug: t.slug, name: t.name })),
  };

  return (
    <>
      <h1 className="sr-only">Findmi Map</h1>
      <MapExplorer initialQuery={query} initialView={view} initialData={initialData} defaultBbox={DEFAULT_MAP_BBOX} options={options} nearRequested={nearRequested} />
    </>
  );
}
