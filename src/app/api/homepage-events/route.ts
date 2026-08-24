import { NextResponse, type NextRequest } from "next/server";
import { attachEventCategories, getEventsDiscovery } from "@/lib/data";
import type { DiscoveryWindow } from "@/lib/format";

export const dynamic = "force-dynamic";

const WINDOW_BY_TIME_KEY: Record<string, DiscoveryWindow> = {
  upNext: "anytime", // same real chronological query as All Events — see HomeEventDiscovery's note
  today: "now",
  weekend: "weekend",
  anytime: "anytime",
};

/**
 * Homepage event discovery's live combine query — Time × Category. The
 * four time windows are prefetched server-side on page load (zero
 * latency, the common case); this route only gets called once a founder-
 * configured category chip is also selected, since prefetching every
 * Time×Category combination up front doesn't scale as more categories
 * get used. Reuses the exact same getEventsDiscovery() every other
 * events query already goes through — no parallel filtering logic.
 */
export async function GET(request: NextRequest) {
  const timeKey = request.nextUrl.searchParams.get("when") ?? "upNext";
  const category = request.nextUrl.searchParams.get("category")?.trim() || undefined;
  const when = WINDOW_BY_TIME_KEY[timeKey] ?? "anytime";

  const events = await getEventsDiscovery({ when, categorySlug: category, limit: 20 });
  const withCategories = await attachEventCategories(events);
  return NextResponse.json({ events: withCategories });
}
