import { NextResponse, type NextRequest } from "next/server";
import { brandArchive, eventArchive, findArchive, placeArchive, type ArchiveParams } from "@/lib/archive-params";
import { appearanceGeo, appearancesInBbox, appearanceResults, brandGeo, eventGeo, placeGeo, GEO_LIMIT } from "@/lib/geo-results-server";
import type { GeoResponse } from "@/lib/geo-results";

export const dynamic = "force-dynamic";

/**
 * Map Everywhere — the geographic view of an archive's result set.
 *
 *   GET /api/geo/<events|locations|brands|find>?<the archive's own params>
 *
 * Reads the archive's URL exactly as its page does (lib/archive-params.ts)
 * and the same data function its List pages through; returns only the
 * results that resolve to a real Location, plus the size of the whole set.
 * Read-only, anon client (RLS), briefly cacheable.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ surface: string }> }) {
  const { surface } = await params;
  const p: ArchiveParams = {};
  for (const [k, v] of req.nextUrl.searchParams) p[k] = p[k] === undefined ? v : [...[p[k]].flat() as string[], v];
  let body: GeoResponse | null = null;
  if (surface === "events") body = await eventGeo((await eventArchive(p)).discovery);
  else if (surface === "locations") body = await placeGeo(await placeArchive(p));
  else if (surface === "brands") {
    const a = await brandArchive(p);
    body = await brandGeo(a.search, a.bbox);
  } else if (surface === "find") {
    const a = await findArchive(p);
    if (a.bbox) {
      const { items } = await appearanceGeo(a.when, GEO_LIMIT, a.extra);
      const inside = await appearancesInBbox(items, a.bbox);
      body = { results: await appearanceResults(inside.slice(0, 30)), total: Math.min(inside.length, 30), truncated: false };
    } else body = (await appearanceGeo(a.when, 30, a.extra)).geo;
  }
  if (!body) return NextResponse.json({ error: "Unknown surface" }, { status: 404 });
  return NextResponse.json(body, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
}
