import type { Metadata } from "next";
import Link from "next/link";
import { DiscoveryGrid } from "@/components/discovery/DiscoveryTile";
import DiscoverySignal from "@/components/discovery/DiscoverySignal";
import RelationshipButton from "@/components/discovery/RelationshipButton";
import { mapHref, paramsToQuery, searchHref, WHEN_LABELS, type DiscoveryQuery } from "@/lib/discovery/query";
import { getVocabulary, interpretSearch, runDiscovery } from "@/lib/discovery/server";

export const metadata: Metadata = {
  title: "Search",
  description: "Search Findmi by what, when and where: pop-ups, sample sales, events and places near you.",
};
export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

/**
 * Discovery Intelligence V1 — contextual search. Free text (`?q=`) is
 * parsed deterministically into a structured query (lib/discovery/parse);
 * everything else on the URL already IS a structured query. Results,
 * refinements and choices are all real links to other structured queries,
 * so every state is shareable and nothing is guessed.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const base = paramsToQuery(params);
  const raw = typeof params.q === "string" ? params.q.trim().slice(0, 200) : "";
  // ?q= is interpreted once; the interpretation replaces it in every link.
  const { text: _text, ...structured } = base;
  const interpretation = raw ? await interpretSearch(raw, structured) : null;
  const query: DiscoveryQuery = interpretation ? interpretation.query : base;
  const [result, vocab] = await Promise.all([runDiscovery({ ...query, limit: 48 }, { personal: true, geo: interpretation?.geoScope ?? null }), getVocabulary()]);

  const chips: { label: string; without: DiscoveryQuery }[] = [];
  const drop = (k: keyof DiscoveryQuery) => {
    const next = { ...query };
    delete next[k];
    if (k === "market") delete next.area;
    return next;
  };
  for (const s of query.topics ?? []) chips.push({ label: vocab.topicRows.find((t) => t.slug === s)?.name ?? s, without: { ...query, topics: query.topics!.filter((x) => x !== s) } });
  if (query.when) chips.push({ label: WHEN_LABELS[query.when], without: drop("when") });
  for (const s of [...(query.categories ?? []), ...(query.formats ?? [])]) {
    const name = [...vocab.taxonomyById.values()].find((t) => t.slug === s)?.name ?? s;
    chips.push({ label: name, without: { ...query, categories: query.categories?.filter((x) => x !== s), formats: query.formats?.filter((x) => x !== s) } });
  }
  if (query.free) chips.push({ label: "Free", without: drop("free") });
  if (query.family) chips.push({ label: "Family Friendly", without: drop("family") });
  const areaName = query.area ? vocab.areaRows.find((a) => a.slug === query.area && (!query.market || a.market === query.market))?.name : null;
  const marketName = query.market ? vocab.marketRows.find((m) => m.slug === query.market)?.name : null;
  if (query.area) chips.push({ label: interpretation?.geo?.label ?? areaName ?? query.area, without: drop("area") });
  else if (query.market) chips.push({ label: interpretation?.geo?.label ?? marketName ?? query.market, without: drop("market") });
  if (query.census) chips.push({ label: interpretation?.geo?.label ?? result.geoLabel ?? "Selected Area", without: drop("census") });
  if (query.text) chips.push({ label: `“${query.text}”`, without: drop("text") });

  const heading = raw || chips.map((c) => c.label).join(" · ") || "Search Findmi";
  // A single-Topic view is a Topic page: its own signal and Like.
  const soloTopic = !raw && query.topics?.length === 1 ? vocab.topicRows.find((t) => t.slug === query.topics![0]) : undefined;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <DiscoverySignal event_name="search_submit" page_type="search" metadata={{ query: { ...query, text: query.text ? "[text]" : undefined }, total: result.total }} />
      <form action="/search" className="mb-5">
        <label htmlFor="discovery-search" className="sr-only">Search Findmi</label>
        <div className="flex gap-2">
          <input
            id="discovery-search"
            name="q"
            defaultValue={raw}
            autoCapitalize="none"
            autoComplete="off"
            placeholder="Pop-ups in SoHo this weekend"
            className="min-w-0 flex-1 rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-findmi"
          />
          <button type="submit" className="shrink-0 rounded-full bg-findmi px-4 py-2.5 text-sm font-bold text-white">Search</button>
        </div>
      </form>

      {soloTopic && <DiscoverySignal event_name="topic_open" page_type="topic" discovery_topic_id={soloTopic.id} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{heading}</h1>
        {soloTopic && <RelationshipButton entityType="topic" entityId={soloTopic.id} relation="like" label="Like" activeLabel="Liked" />}
      </div>
      {soloTopic?.description && <p className="mt-1 text-sm text-ink/60">{soloTopic.description}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <p className="text-sm text-ink/50">{result.total === 1 ? "1 Result" : `${result.total} Results`}</p>
        {/* The same structured query on the Map (Discovery Engine V1). */}
        <Link href={mapHref(query)} className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-bold text-ink/75 hover:border-findmi hover:text-findmi-700">
          View On Map
        </Link>
      </div>

      {chips.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Your Search">
          {chips.map((c) => (
            <li key={c.label}>
              <Link href={searchHref(c.without)} className="inline-flex items-center gap-1.5 rounded-full bg-findmi-50 px-3 py-1 text-xs font-semibold text-findmi-700">
                {c.label}
                <span aria-hidden className="text-findmi-700/60">×</span>
                <span className="sr-only">Remove</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {interpretation?.choices.map((c) => (
        <div key={c.text} className="mt-4 rounded-2xl border border-black/5 bg-white p-4">
          <p className="text-sm font-semibold text-ink">Which {c.text.replace(/\b\w/g, (m) => m.toUpperCase())} Did You Mean?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {c.options.map((o) => (
              <Link key={o.label} href={searchHref(o.query)} className="rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-ink hover:border-findmi">
                {o.label}
              </Link>
            ))}
          </div>
        </div>
      ))}

      {interpretation?.nearMeUnavailable && (
        <p className="mt-4 rounded-2xl bg-black/[0.03] p-3 text-sm text-ink/60">Near Me isn&apos;t available yet. Try a neighborhood, city or ZIP code instead.</p>
      )}

      {result.refinements.length > 0 && (
        <nav aria-label="Refine" className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
          {result.refinements.map((r) => (
            <Link key={`${r.dimension}:${r.label}`} href={r.href} className="shrink-0 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-findmi">
              {r.label} <span className="text-ink/40">{r.count}</span>
            </Link>
          ))}
        </nav>
      )}

      <div className="mt-6">
        {result.items.length > 0 ? (
          <DiscoveryGrid items={result.items.map((r) => r.item)} />
        ) : (
          <div className="rounded-2xl border border-black/5 bg-white p-6 text-center">
            <p className="font-display text-lg font-bold text-ink">Nothing Here Yet</p>
            <p className="mt-1 text-sm text-ink/55">Try a broader time, another area, or remove a filter.</p>
            <Link href="/events" className="mt-3 inline-block text-sm font-bold text-findmi-700">Browse All Events</Link>
          </div>
        )}
      </div>
    </div>
  );
}
