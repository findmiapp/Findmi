import { NextResponse, type NextRequest } from "next/server";
import { paramsToQuery, searchHref } from "@/lib/discovery/query";
import { interpretSearch, runDiscovery } from "@/lib/discovery/server";

export const dynamic = "force-dynamic";

/** Discovery Intelligence V1 — contextual search as JSON (read-only, public
 * data only, same helpers and RLS as the /search page). `q` is parsed into
 * a structured query; other params already are one. */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const raw = (params.get("q") ?? "").trim().slice(0, 200);
  const { text: _text, ...structured } = paramsToQuery(params);
  const interpretation = raw ? await interpretSearch(raw, structured) : null;
  const query = interpretation ? interpretation.query : paramsToQuery(params);
  const result = await runDiscovery({ ...query, limit: 8 }, { geo: interpretation?.geoScope ?? null });
  return NextResponse.json({
    query,
    href: searchHref(query),
    geo: interpretation?.geo?.label ?? result.geoLabel,
    choices: interpretation?.choices.map((c) => ({ text: c.text, options: c.options.map((o) => ({ label: o.label, href: searchHref(o.query) })) })) ?? [],
    nearMeUnavailable: interpretation?.nearMeUnavailable ?? false,
    total: result.total,
    items: result.items.map(({ item }) => ({ kind: item.kind, id: item.id, title: item.title, subtitle: item.subtitle, href: item.href, image: item.image })),
    refinements: result.refinements.map((r) => ({ label: r.label, count: r.count, href: r.href })),
  });
}
