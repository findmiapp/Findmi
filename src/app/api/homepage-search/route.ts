import { NextResponse, type NextRequest } from "next/server";
import { getEventsDiscovery, getMarketplaceProducts, searchBusinesses } from "@/lib/data";
import { formatPrice } from "@/lib/format";

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
 * forwarded ONLY into the searchBusinesses() branch. Events and products
 * never receive it — FindMi Market controls general BUSINESS discovery
 * only (see the locked product rule), and getEventsDiscovery/
 * getMarketplaceProducts have no Market concept to begin with.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const marketSlug = request.nextUrl.searchParams.get("market")?.trim() || undefined;
  if (q.length < 2) return NextResponse.json({ businesses: [], events: [], products: [] });

  const [businesses, events, products] = await Promise.all([
    searchBusinesses({ q, marketSlug }),
    getEventsDiscovery({ q, limit: 4 }),
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
