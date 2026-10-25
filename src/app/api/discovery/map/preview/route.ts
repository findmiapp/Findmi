import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getAvailableBrandsForLocation } from "@/lib/business-location-availability";
import { getOperatorsForLocation } from "@/lib/business-locations";
import { getPublicJournalCollection } from "@/lib/journal-distribution";
import { isLocationDiscoverable } from "@/lib/location-eligibility";
import { normalizeLocationHours } from "@/lib/locationHours";
import { openNowAt } from "@/lib/discovery/map-core";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lazy detail for the ONE selected marker (never for the whole map): the
 * Location's open status (only from real hours), Brands operating /
 * genuinely Available Here, and Recent Moments Here through the existing
 * public Moment collection (same rules as the Location page). Only for a
 * consumer-discoverable Location; anything else returns nothing extra.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("location") ?? "";
  const empty = NextResponse.json({ location: null, brands: [], moments: [] });
  if (!UUID.test(id)) return empty;
  const supabase = getSupabase();
  if (!supabase) return empty;
  const { data: loc } = await supabase.from("locations").select("id, name, slug, is_demo, logo_url, cover_image_url, hours, city, state").eq("id", id).maybeSingle();
  if (!loc || !isLocationDiscoverable(loc)) return empty;
  const [ops, avail, journal] = await Promise.all([
    getOperatorsForLocation(supabase, id, { limit: 4, publicOnly: true }),
    getAvailableBrandsForLocation(supabase, id, { limit: 6, publicOnly: true }),
    getPublicJournalCollection({ subjectType: "location", subjectId: id, limit: 3 }),
  ]);
  const open = openNowAt(normalizeLocationHours(loc.hours), new Date());
  return NextResponse.json(
    {
      location: { id: loc.id, name: loc.name, href: `/location/${loc.slug}`, logo: loc.logo_url, cover: loc.cover_image_url, city: loc.city, open },
      operators: ops.items.map((b) => ({ name: b.name, slug: b.slug, logo: b.logoUrl })),
      brands: avail.items.map((b) => ({ name: b.name, slug: b.slug, logo: b.logoUrl })),
      moments: journal.entries.map((m) => ({ id: m.id, title: m.title, cover: m.coverUrl, href: `/journal/${m.id}` })),
    },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } }
  );
}
