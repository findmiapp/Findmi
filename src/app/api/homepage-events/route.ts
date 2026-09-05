import { NextResponse, type NextRequest } from "next/server";
import { attachEventCategories, getEventsDiscovery } from "@/lib/data";
import { WINDOW_BY_TIME_KEY, type DiscoveryTimeKey } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Homepage event discovery's live combine query — Time × Category. The
 * four time windows are prefetched server-side on page load (zero
 * latency, the common case); this route only gets called once a founder-
 * configured category chip is also selected, since prefetching every
 * Time×Category combination up front doesn't scale as more categories
 * get used. Reuses the exact same getEventsDiscovery() every other
 * events query already goes through — no parallel filtering logic.
 *
 * Consumer Event Market Filtering V1 — optional `market` query param is
 * forwarded straight into getEventsDiscovery, which resolves it against
 * each candidate occurrence's EFFECTIVE physical Market (see
 * lib/event-markets.ts). An unknown/inactive slug resolves to zero
 * results there — never a silent fallback to the unfiltered/global set.
 */
export async function GET(request: NextRequest) {
  const timeKey = request.nextUrl.searchParams.get("when") ?? "upNext";
  const category = request.nextUrl.searchParams.get("category")?.trim() || undefined;
  const market = request.nextUrl.searchParams.get("market")?.trim() || undefined;
  const when = WINDOW_BY_TIME_KEY[timeKey as DiscoveryTimeKey] ?? "anytime";

  const events = await getEventsDiscovery({ when, categorySlug: category, marketSlug: market, limit: 20 });
  const withCategories = await attachEventCategories(events);
  return NextResponse.json({ events: withCategories });
}
