// The floating map preview for a selected marker whose results are
// GeoResults (archive maps and detail-page maps) — ONE mapping, shared by
// ArchiveGeoShell and ContextMap, so every selectable map shows the same
// card for the same thing. Pure. (/map builds its own from its richer
// MapResultCard data.)

import type { MapPreview } from "@/components/map/MapFloatingPreview";
import type { MapFeature } from "./discovery/map-core";
import type { GeoResult } from "./geo-results";

/** Entity type in words on the preview. */
export const GEO_KIND: Record<GeoResult["kind"], string> = { event: "Event", place: "Place", brand: "Brand", appearance: "Pop-Up", product: "Product", opportunity: "Opportunity" };

/** The preview for one selected marker: its lead result (LIVE first, else
 * the first in the caller's own order), "+N more here" for the rest. */
export function geoPreview(feature: MapFeature | null | undefined, results: readonly GeoResult[]): MapPreview | null {
  if (!feature) return null;
  const mine = results.filter((r) => feature.keys.includes(r.key));
  const lead = mine.find((r) => r.live) ?? mine[0];
  if (!lead) return null;
  // A schedule date names its Location as the title and what's on as the
  // subtitle; on a preview the thing itself leads, the place follows.
  const scheduleDate = lead.kind === "appearance" && lead.subtitle && lead.title === lead.place.name;
  return {
    featureId: feature.id,
    href: lead.href || null,
    title: scheduleDate ? (lead.subtitle as string) : lead.title,
    kind: GEO_KIND[lead.kind],
    image: lead.image,
    logo: lead.logo,
    status: lead.live ? null : lead.status,
    live: lead.live,
    detail: null,
    subtitle: scheduleDate ? lead.place.name : lead.subtitle,
    more: Math.max(0, mine.length - 1),
  };
}
