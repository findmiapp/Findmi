import { NextResponse, type NextRequest } from "next/server";
import { getEventsDiscovery, getMarketplaceProducts, searchBusinesses, searchLocations } from "@/lib/data";
import { cityState, formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Homepage live search — read-only, and deliberately not a new search
 * system: every result comes from the same public, already-visibility-
 * filtered query functions the full /businesses, /events, and
 * /marketplace pages already use (searchBusinesses, getEventsDiscovery,
 * getMarketplaceProducts — all gated on is_demo=false/publication_status
 * ='live' the same way everywhere else on the public site). This route
 * only fans them out in parallel and trims each result down to the
 * minimal fields a dropdown needs.
 *
 * Homepage Market Filtering V1 — optional `market` query param is
 * forwarded into the searchBusinesses() branch, scoped by
 * business_markets (the business's discovery/distribution entitlement).
 *
 * Consumer Event Market Filtering V1 — the SAME `market` param is now
 * also forwarded into the getEventsDiscovery() branch, but resolved
 * there against each occurrence's EFFECTIVE PHYSICAL Market (see
 * lib/event-markets.ts) — a structurally separate system from
 * business_markets that never cross-pollinates with it. Products remain
 * Market-independent — getMarketplaceProducts has no Market concept at
 * all and never receives this param.
 *
 * Global Search — Locations pass — Locations are Market-independent here
 * too (same posture as Products above; a Location's own market_id is an
 * unrelated home-market concept, not a discovery filter — out of scope
 * for this pass), so searchLocations never receives `marketSlug` either.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const marketSlug = request.nextUrl.searchParams.get("market")?.trim() || undefined;
  if (q.length < 2) return NextResponse.json({ businesses: [], locations: [], events: [], products: [] });

  const [businesses, locations, events, products] = await Promise.all([
    searchBusinesses({ q, marketSlug }),
    searchLocations(q, 4),
    getEventsDiscovery({ q, limit: 4, marketSlug }),
    getMarketplaceProducts({ q, limit: 4 }),
  ]);

  return NextResponse.json({
    businesses: businesses.slice(0, 4).map((b) => ({
      id: b.id,
      name: b.name,
      href: `/business/${b.slug}`,
      image: b.logo_url ?? b.cover_image_url,
      subtitle: [b.categories[0]?.name, [b.city, b.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
    })),
    // Placed right after Businesses (and before Events) in the response
    // itself, not just left to render order in each search UI, so an
    // exact/strong Location-name match (e.g. "Perk Up Coffeehouse") is
    // never visually buried beneath a loosely-related Event match (e.g.
    // "Perk Up Fest") — the smallest change for that prominence, no
    // relevance-scoring rewrite.
    locations: locations.slice(0, 4).map((l) => ({
      id: l.id,
      name: l.name,
      href: `/location/${l.slug}`,
      image: l.logo_url ?? l.cover_image_url,
      subtitle: [l.category?.name, cityState(l.city, l.state)].filter(Boolean).join(" · "),
    })),
    events: events.slice(0, 4).map((e) => ({
      id: e.id,
      name: e.name,
      href: `/event/${e.slug}`,
      image: e.cover_image_url,
      subtitle: [
        new Date(e.start_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        e.venue_name ?? [e.city, e.state].filter(Boolean).join(", "),
      ]
        .filter(Boolean)
        .join(" · "),
    })),
    products: products.slice(0, 4).map((p) => ({
      id: p.id,
      name: p.name,
      href: `/product/${p.slug}`,
      image: p.image_url ?? p.business?.logo_url ?? null,
      subtitle: [p.business?.name, formatPrice(p.price, p.price_label)].filter(Boolean).join(" · "),
    })),
  });
}
