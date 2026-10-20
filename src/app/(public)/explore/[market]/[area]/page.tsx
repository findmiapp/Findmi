import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSite } from "@/lib/site";
import { getResolvedSiteScope } from "@/lib/site-scope";
import { DiscoveryRail } from "@/components/discovery/DiscoveryTile";
import DiscoverySignal from "@/components/discovery/DiscoverySignal";
import RelationshipButton from "@/components/discovery/RelationshipButton";
import { TileRail, TopicTile } from "@/components/discovery/DiscoveryLanes";
import { searchHref, type DiscoveryQuery } from "@/lib/discovery/query";
import { getVocabulary, runDiscovery } from "@/lib/discovery/server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ market: string; area: string }> };

async function findArea(marketSlug: string, areaSlug: string) {
  const vocab = await getVocabulary();
  const area = vocab.areaRows.find((a) => a.market === marketSlug && a.slug === areaSlug);
  const market = vocab.marketRows.find((m) => m.slug === marketSlug);
  // Consumer-hidden Areas (e.g. seeded neighborhoods) have no public page.
  if (!area || !market || !area.consumer_visible || !market.consumer_visible) return null;
  return { area, market, vocab };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { market, area } = await params;
  const found = await findArea(market, area);
  if (!found) return { title: "Explore" };
  return { title: `${found.area.name}, ${found.market.name}`, description: `What's happening in ${found.area.name} on Findmi: pop-ups, events, places and brands.` };
}

/** Discovery Intelligence V1 — an Area page. Every section is the same
 * structured engine with this Area as context (a borough includes its
 * neighborhoods), and sections with nothing to show are omitted. */
export default async function AreaPage({ params }: Props) {
  const { market: marketSlug, area: areaSlug } = await params;
  // Geo-locked site (lib/site.ts): only its own Area and neighborhoods;
  // any other Area page is shown on Findmi.
  const site = getSite();
  if (site.scope) {
    const scope = await getResolvedSiteScope();
    if (marketSlug !== site.scope.market || !scope?.areaSlugs.has(areaSlug)) redirect(`https://findmi.app/explore/${marketSlug}/${areaSlug}`);
  }
  const found = await findArea(marketSlug, areaSlug);
  if (!found) notFound();
  const { area, market, vocab } = found;
  const context: DiscoveryQuery = { market: market.slug, area: area.slug };

  const sections: { title: string; query: DiscoveryQuery }[] = [
    { title: "Happening Now", query: { when: "now" } },
    { title: "This Weekend", query: { when: "weekend" } },
    { title: "Coming Up", query: { when: "upcoming" } },
    { title: "Places", query: { entities: ["place"] } },
    { title: "Brands", query: { entities: ["business"] } },
  ];
  const [results, topicCounts] = await Promise.all([
    Promise.all(sections.map((s) => runDiscovery({ ...s.query, limit: 12 }, { context, personal: true }))),
    Promise.all(vocab.topicRows.slice(0, 18).map(async (t) => ({ t, n: (await runDiscovery({ topics: [t.slug], limit: 1 }, { context })).total }))),
  ]);
  const seen = new Set<string>();
  const topics = topicCounts.filter((x) => x.n > 0 && !["happening-now", "today", "tonight", "this-weekend"].includes(x.t.slug)).slice(0, 8);
  const others = vocab.areaRows.filter((a) => a.market === market.slug && a.consumer_visible && a.level === "area" && a.slug !== area.slug);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <DiscoverySignal event_name="area_open" page_type="area" market_area_id={area.id} />
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">{market.name}</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{area.name}</h1>
        <RelationshipButton entityType="area" entityId={area.id} relation="like" label="Like" activeLabel="Liked" />
      </div>
      <Link href={searchHref(context)} className="mt-2 inline-block text-sm font-semibold text-findmi-700">Search {area.name}</Link>

      {topics.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-xl font-bold tracking-tight text-ink">What You&apos;ll Find</h2>
          <TileRail>
            {topics.map(({ t, n }) => (
              <div key={t.id} className="w-[40%] shrink-0 snap-start sm:w-auto">
                <TopicTile topic={t} count={n} href={searchHref({ ...context, topics: [t.slug] })} />
              </div>
            ))}
          </TileRail>
        </section>
      )}

      {sections.map((s, i) => {
        // Each item appears once: in the most immediate section it fits.
        const items = results[i].items.map((r) => r.item).filter((it) => !seen.has(`${it.kind}:${it.id}`));
        items.forEach((it) => seen.add(`${it.kind}:${it.id}`));
        if (items.length === 0) return null;
        return (
          <section key={s.title} className="mt-8">
            <div className="mb-3 flex items-end justify-between gap-3">
              <h2 className="font-display text-xl font-bold tracking-tight text-ink">{s.title}</h2>
              <Link href={searchHref({ ...context, ...s.query })} className="shrink-0 text-xs font-bold uppercase tracking-wide text-findmi-700">See All</Link>
            </div>
            <DiscoveryRail items={items} />
          </section>
        );
      })}

      {results.every((r) => r.total === 0) && <p className="mt-8 rounded-2xl border border-black/5 bg-white p-6 text-center text-sm text-ink/55">Nothing listed in {area.name} yet. Check back soon.</p>}

      {others.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 font-display text-xl font-bold tracking-tight text-ink">More In {market.name}</h2>
          <div className="flex flex-wrap gap-2">
            {others.map((a) => (
              <Link key={a.id} href={`/explore/${market.slug}/${a.slug}`} className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-findmi">{a.name}</Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
