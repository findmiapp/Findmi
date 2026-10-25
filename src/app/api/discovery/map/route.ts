import { NextResponse, type NextRequest } from "next/server";
import { paramsToQuery, queryToParams, type DiscoveryQuery } from "@/lib/discovery/query";
import { getVocabulary, interpretSearch } from "@/lib/discovery/server";
import { isTaxonomyTopic } from "@/lib/discovery/map-core";
import { subjectWordsAsText } from "@/lib/discovery/search-state";
import { getMapPersonalSignals, runMapDiscovery } from "@/lib/discovery/map-server";

export const dynamic = "force-dynamic";

/**
 * Discovery Engine V1 — the one endpoint Map and Feed read.
 *
 *   GET /api/discovery/map?<Discovery Query params>
 *     &nl=<free text>   natural language → the SAME structured query
 *                       (deterministic parser + canonical Brand / place
 *                       resolution); the response carries the structured
 *                       interpretation so the UI shows it as chips
 *     &count=1          result count only (filter sheet "Show 23 …")
 *     &view=feed        chip / relaxation links keep the Feed view
 *     &focus=<loc id>   every qualifying result at one Location (the
 *                       selected marker's preview — lazy hydration)
 *
 * Read-only, anon client (RLS). Anonymous responses are briefly cacheable;
 * a signed-in viewer with Personalized Discovery on gets a private,
 * uncached response (their follows/saves only reorder results). The
 * viewer's location is never sent here — only a viewport.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const view = params.get("view") === "feed" ? "feed" : "map";
  let query: DiscoveryQuery = paramsToQuery(params);
  const nl = (params.get("nl") ?? "").trim().slice(0, 200);
  const now = new Date();
  let interpretation: { params: string; choices: { text: string; options: { label: string; params: string }[] }[] } | null = null;
  if (nl) {
    const { text: _text, ...structured } = query;
    const i = await interpretSearch(nl, structured, { now, brands: true });
    const vocab = await getVocabulary();
    query = subjectWordsAsText(i.query, i.parsed.recognized, structured, vocab.topicRows, isTaxonomyTopic);
    if (structured.bbox) query.bbox = structured.bbox;
    // A place named in the text replaces the viewport it was typed over;
    // otherwise text never changes the geography it was typed in.
    const typedPlace = i.geo || (query.area && query.area !== structured.area) || (query.market && query.market !== structured.market) || (query.census && query.census !== structured.census);
    if (typedPlace) delete query.bbox;
    interpretation = {
      params: queryToParams(query).toString(),
      choices: i.choices.map((c) => ({ text: c.text, options: c.options.map((o) => ({ label: o.label, params: queryToParams(o.query).toString() })) })),
    };
  }
  const countOnly = params.get("count") === "1";
  const personal = countOnly ? null : await getMapPersonalSignals();
  const focus = params.get("focus");
  const focusLocation = focus && /^[0-9a-f-]{36}$/i.test(focus) ? focus : null;
  const result = await runMapDiscovery(query, { now, personal, countOnly, view, focusLocation });
  return NextResponse.json(
    { ...result, interpretation },
    { headers: { "Cache-Control": personal ? "private, no-store" : "public, s-maxage=30, stale-while-revalidate=60" } }
  );
}
