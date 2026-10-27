import SupabaseImage from "@/components/SupabaseImage";
import Section, { HorizontalScroller } from "@/components/Section";
import HomeEventCard from "@/components/HomeEventCard";
import BusinessLogoCard from "@/components/BusinessLogoCard";
import ProductCard from "@/components/ProductCard";
import { DiscoveryGrid, DiscoveryRail } from "@/components/discovery/DiscoveryTile";
import ContextMap from "@/components/map/ContextMap";
import { getBusinessGalleryImagesMap, getUpcomingAppearanceSummaries } from "@/lib/data";
import { resolveEffectiveSectionContext, type DiscoveryPage } from "@/lib/discovery-pages";
import { resolveHomepageRowItems, type HomepageRow, type ResolvedHomepageRow } from "@/lib/homepage-rows";
import { coverageStatus, formatCoverage, guideBlockOf, guidePath, type GuideItemRef, type GuideSectionNode } from "@/lib/guides";
import { parseRichText, type EntityResultsConfig, type MapConfig, type RichBlock, type RichSpan, type RichTextConfig, type SectionConfig } from "@/lib/page-sections";
import { resolveEntityResults, type ResolvedEntity } from "@/lib/page-sections-server";
import { geoForItems } from "@/lib/geo-results-server";
import type { GeoResult } from "@/lib/geo-results";
import type { DiscoveryItem } from "@/lib/discovery/engine";
import type { AnalyticsPlacementContext } from "@/lib/analytics/context";

// Pages + Sections V1A — one renderer for a Guide Page: the public
// /guides/[slug] route and the Admin preview both render exactly this, so
// a preview never drifts from what goes live. Page-level hero, then the
// Page's existing Sections (feed rows resolved by the same
// resolveHomepageRowItems every homepage row uses; Groups as a heading over
// their feed children). Unsupported / empty Sections render nothing.
//
// Pages + Sections V1B adds three Section types: Entity Results (the shared
// Discovery tiles / Product cards), Text & Editorial (structured text —
// never HTML) and Map (Map Everywhere's ContextMap over the entities the
// Page's Results Sections render).

const SECTION_TITLE = "font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl";
const SECTION_SUBTITLE = "mt-1 text-sm text-ink/60";
const CHILD_TITLE = "font-display text-xl font-bold tracking-tight text-ink sm:text-2xl";

interface ResolvedFeed {
  row: HomepageRow;
  resolved: ResolvedHomepageRow;
  hints: Record<string, unknown>;
  counts: Record<string, number>;
  galleries: Record<string, string[]>;
}
interface ResolvedResults {
  row: HomepageRow;
  config: EntityResultsConfig;
  items: ResolvedEntity[];
}
interface ResolvedText {
  row: HomepageRow;
  config: RichTextConfig;
  blocks: RichBlock[];
}
interface ResolvedMap {
  row: HomepageRow;
  config: MapConfig;
  results: GeoResult[];
}
export type ResolvedGuideLeaf =
  | { kind: "feed"; feed: ResolvedFeed }
  | { kind: "results"; results: ResolvedResults }
  | { kind: "text"; text: ResolvedText }
  | { kind: "map"; map: ResolvedMap };
export type ResolvedGuideSection = ResolvedGuideLeaf | { kind: "group"; row: HomepageRow; children: ResolvedGuideLeaf[] };

async function resolveFeed(page: DiscoveryPage, row: HomepageRow): Promise<ResolvedFeed | null> {
  const ctx = resolveEffectiveSectionContext(page, row);
  const resolved = await resolveHomepageRowItems(row, ctx.marketSlug, ctx.areaSlug);
  if (!["businesses", "events", "products"].includes(resolved.contentType) || resolved.items.length === 0) return null;
  if (resolved.contentType !== "businesses") return { row, resolved, hints: {}, counts: {}, galleries: {} };
  const ids = resolved.items.map((b) => b.id);
  const [{ hints, counts }, galleries] = await Promise.all([getUpcomingAppearanceSummaries(ids), getBusinessGalleryImagesMap(ids)]);
  return { row, resolved, hints: Object.fromEntries(hints), counts: Object.fromEntries(counts), galleries: Object.fromEntries(galleries) };
}

/** One non-Map leaf; Maps resolve afterwards (they plot what the Results
 * Sections resolved). */
async function resolveLeaf(page: DiscoveryPage, row: HomepageRow, section: SectionConfig | null): Promise<ResolvedGuideLeaf | null> {
  if (!section) {
    const feed = await resolveFeed(page, row);
    return feed ? { kind: "feed", feed } : null;
  }
  if (section.kind === "entity_results") {
    const ctx = resolveEffectiveSectionContext(page, row);
    const { items } = await resolveEntityResults(section.config, { marketSlug: ctx.marketSlug, areaSlug: ctx.areaSlug });
    return items.length ? { kind: "results", results: { row, config: section.config, items } } : null;
  }
  if (section.kind === "rich_text") {
    const blocks = parseRichText(section.config.body);
    const hasCta = Boolean(section.config.cta_label && section.config.cta_url);
    return blocks.length || section.config.image_url || hasCta ? { kind: "text", text: { row, config: section.config, blocks } } : null;
  }
  return { kind: "map", map: { row, config: section.config, results: [] } };
}

const itemsOf = (r: ResolvedResults): DiscoveryItem[] => r.items.flatMap((i) => (i.entity.type === "item" ? [i.entity.item] : []));

/** Resolves every Section of a Guide in parallel; empty ones drop out, and
 * the entities that will render are returned for structured data. */
export async function resolveGuide(page: DiscoveryPage, nodes: readonly GuideSectionNode[]): Promise<{ sections: ResolvedGuideSection[]; items: GuideItemRef[] }> {
  const resolvedNodes = await Promise.all(
    nodes.map(async (n): Promise<ResolvedGuideSection | null> => {
      if (n.kind === "feed") return resolveLeaf(page, n.row, null);
      if (n.kind === "block") return resolveLeaf(page, n.row, n.section);
      const children = (await Promise.all(n.children.map((c) => resolveLeaf(page, c, guideBlockOf(c))))).filter((c): c is ResolvedGuideLeaf => c !== null);
      return children.length ? { kind: "group", row: n.row, children } : null;
    })
  );
  const leaves = resolvedNodes.flatMap((s): ResolvedGuideLeaf[] => (!s ? [] : s.kind === "group" ? s.children : [s]));

  // Maps plot the chosen Results Sections (every one when none is chosen);
  // entities without a real Location are simply not drawn.
  const results = leaves.flatMap((l) => (l.kind === "results" ? [l.results] : []));
  await Promise.all(
    leaves.map(async (l) => {
      if (l.kind !== "map") return;
      const chosen = l.map.config.sections.length ? results.filter((r) => l.map.config.sections.includes(r.row.id)) : results;
      const items = chosen.flatMap(itemsOf);
      l.map.results = items.length ? await geoForItems(items) : [];
    })
  );
  const keep = (l: ResolvedGuideLeaf) => l.kind !== "map" || l.map.results.length > 0;
  const sections = resolvedNodes
    .map((s): ResolvedGuideSection | null => {
      if (!s) return null;
      if (s.kind !== "group") return keep(s) ? s : null;
      const children = s.children.filter(keep);
      return children.length ? { ...s, children } : null;
    })
    .filter((s): s is ResolvedGuideSection => s !== null);

  const items: GuideItemRef[] = [];
  const add = (l: ResolvedGuideLeaf) => {
    if (l.kind === "results") {
      for (const i of l.results.items) items.push(i.entity.type === "product" ? { name: i.entity.product.name, path: `/product/${i.entity.product.slug}` } : { name: i.entity.item.title, path: i.entity.item.href });
      return;
    }
    if (l.kind !== "feed") return;
    const r = l.feed.resolved;
    if (r.contentType === "events") for (const e of r.items) items.push({ name: e.name, path: `/event/${e.slug}` });
    if (r.contentType === "businesses") for (const b of r.items) items.push({ name: b.name, path: `/business/${b.slug}` });
    if (r.contentType === "products") for (const p of r.items) items.push({ name: p.name, path: `/product/${p.slug}` });
  };
  for (const s of sections) (s.kind === "group" ? s.children : [s]).forEach(add);
  return { sections, items };
}

export default function GuideView({ page, sections, today }: { page: DiscoveryPage; sections: ResolvedGuideSection[]; today: string }) {
  return (
    <article className="bg-white pb-10">
      <GuideHero page={page} today={today} />
      <div className="mx-auto max-w-6xl">
        {sections.map((s) =>
          s.kind === "group" ? (
            <section key={s.row.id} className="pt-6" aria-labelledby={`guide-group-${s.row.id}`}>
              <div className="px-4 sm:px-6">
                <h2 id={`guide-group-${s.row.id}`} className={SECTION_TITLE}>
                  {s.row.title}
                </h2>
                {s.row.subtitle && <p className={SECTION_SUBTITLE}>{s.row.subtitle}</p>}
              </div>
              {s.children.map((c) => (
                <Leaf key={leafId(c)} page={page} leaf={c} titleClassName={CHILD_TITLE} />
              ))}
            </section>
          ) : (
            <Leaf key={leafId(s)} page={page} leaf={s} titleClassName={SECTION_TITLE} />
          )
        )}
        {sections.length === 0 && <p className="px-4 py-10 text-sm text-ink/50 sm:px-6">More is coming to this guide soon.</p>}
      </div>
    </article>
  );
}

const leafId = (l: ResolvedGuideLeaf) => (l.kind === "feed" ? l.feed.row.id : l.kind === "results" ? l.results.row.id : l.kind === "text" ? l.text.row.id : l.map.row.id);

function Leaf({ page, leaf, titleClassName }: { page: DiscoveryPage; leaf: ResolvedGuideLeaf; titleClassName: string }) {
  if (leaf.kind === "feed") return <FeedSection page={page} feed={leaf.feed} titleClassName={titleClassName} />;
  if (leaf.kind === "results") return <ResultsSection page={page} results={leaf.results} titleClassName={titleClassName} />;
  if (leaf.kind === "text") return <TextSection page={page} text={leaf.text} titleClassName={titleClassName} />;
  return <MapSection page={page} map={leaf.map} titleClassName={titleClassName} />;
}

export function GuideHero({ page, today }: { page: DiscoveryPage; today: string }) {
  const coverage = formatCoverage(page.starts_on, page.ends_on);
  const status = coverageStatus(page.starts_on, page.ends_on, today);
  const external = page.cta_url ? /^https:\/\//i.test(page.cta_url) : false;
  return (
    <header className="mx-auto max-w-6xl px-4 pt-4 sm:px-6 sm:pt-6">
      {page.hero_image_url && (
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black/[0.04] sm:aspect-[21/9]">
          <SupabaseImage src={page.hero_image_url} alt={page.hero_image_alt ?? ""} fill priority sizes="(min-width: 1152px) 1152px, 100vw" className="object-cover" />
        </div>
      )}
      <div className={page.hero_image_url ? "mt-5" : "mt-2"}>
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Guide</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink sm:text-5xl">{page.title}</h1>
        {(coverage || status === "past") && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-ink/60">
            {coverage && <span>{coverage}</span>}
            {status === "past" && <span className="rounded-full bg-black/[0.05] px-2.5 py-0.5 text-xs font-semibold text-ink/55">Past Guide</span>}
          </p>
        )}
        {page.description && <p className="mt-3 max-w-2xl whitespace-pre-line text-base leading-relaxed text-ink/70">{page.description}</p>}
        {page.cta_label && page.cta_url && (
          <CtaLink href={page.cta_url} label={page.cta_label} external={external} className="mt-5" />
        )}
      </div>
    </header>
  );
}

function CtaLink({ href, label, external, className = "" }: { href: string; label: string; external: boolean; className?: string }) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`${className} inline-flex min-h-11 items-center justify-center rounded-full bg-findmi px-5 text-sm font-bold text-white transition hover:bg-findmi-600`}
    >
      {label}
    </a>
  );
}

const impression = (page: DiscoveryPage, row: HomepageRow, metadata: Record<string, unknown>) => ({
  event_name: "discovery_section_impression" as const,
  discovery_page_id: page.id,
  discovery_section_id: row.id,
  page_type: "guide",
  page_path: guidePath(page.slug),
  metadata,
});

function FeedSection({ page, feed, titleClassName }: { page: DiscoveryPage; feed: ResolvedFeed; titleClassName: string }) {
  const { row, resolved } = feed;
  const analytics = (position: number, id: string): AnalyticsPlacementContext => ({
    pageType: "guide",
    pagePath: guidePath(page.slug),
    placement: "guide_section",
    discoveryPageId: page.id,
    discoverySectionId: row.id,
    sectionContentType: row.content_type ?? undefined,
    sectionMode: row.mode,
    origin: row.mode === "hybrid" ? (row.pinned_ids.includes(id) ? "pinned" : "auto") : undefined,
    position,
  });
  return (
    <Section
      title={row.title}
      subtitle={row.subtitle ?? undefined}
      titleClassName={titleClassName}
      subtitleClassName={SECTION_SUBTITLE}
      impressionPayload={impression(page, row, { content_type: row.content_type, mode: row.mode })}
    >
      <HorizontalScroller>
        {resolved.contentType === "events" &&
          resolved.items.map((e, i) => (
            <div key={e.id} className="w-[74vw] max-w-[320px] shrink-0 sm:w-72">
              <HomeEventCard event={e} analyticsContext={analytics(i + 1, e.id)} />
            </div>
          ))}
        {resolved.contentType === "businesses" &&
          resolved.items.map((b, i) => (
            <div key={b.id} className="w-[76vw] max-w-[340px] shrink-0 sm:w-96">
              <BusinessLogoCard
                business={b}
                upcomingAppearances={feed.hints[b.id] as Parameters<typeof BusinessLogoCard>[0]["upcomingAppearances"]}
                totalUpcomingAppearances={feed.counts[b.id]}
                galleryImages={feed.galleries[b.id]}
                analyticsContext={analytics(i + 1, b.id)}
              />
            </div>
          ))}
        {resolved.contentType === "products" &&
          resolved.items.map((p, i) => (
            <div key={p.id} className="w-[62vw] max-w-[250px] shrink-0 sm:w-60">
              <ProductCard product={p} analyticsContext={analytics(i + 1, p.id)} />
            </div>
          ))}
      </HorizontalScroller>
    </Section>
  );
}

function ResultsSection({ page, results, titleClassName }: { page: DiscoveryPage; results: ResolvedResults; titleClassName: string }) {
  const { row, config, items } = results;
  const tiles = items.flatMap((i) => (i.entity.type === "item" ? [i.entity.item] : []));
  const products = items.flatMap((i) => (i.entity.type === "product" ? [{ product: i.entity.product, origin: i.origin }] : []));
  const analytics = (position: number, origin: string): AnalyticsPlacementContext => ({
    pageType: "guide",
    pagePath: guidePath(page.slug),
    placement: "guide_section",
    discoveryPageId: page.id,
    discoverySectionId: row.id,
    sectionContentType: config.scope,
    sectionMode: config.mode,
    // Included picks carry no origin (the shared vocabulary is pinned / auto).
    origin: origin === "pinned" ? "pinned" : origin === "auto" ? "auto" : undefined,
    position,
  });
  return (
    <Section
      title={row.title}
      subtitle={row.subtitle ?? undefined}
      titleClassName={titleClassName}
      subtitleClassName={SECTION_SUBTITLE}
      impressionPayload={impression(page, row, { content_type: "entity_results", scope: config.scope, mode: config.mode, count: items.length })}
    >
      {tiles.length > 0 && <div className="px-4 sm:px-6">{config.layout === "grid" ? <DiscoveryGrid items={tiles} /> : <DiscoveryRail items={tiles} />}</div>}
      {products.length > 0 &&
        (config.layout === "grid" ? (
          <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 sm:px-6 lg:grid-cols-4">
            {products.map(({ product, origin }, i) => (
              <ProductCard key={product.id} product={product} analyticsContext={analytics(i + 1, origin)} />
            ))}
          </div>
        ) : (
          <HorizontalScroller>
            {products.map(({ product, origin }, i) => (
              <div key={product.id} className="w-[62vw] max-w-[250px] shrink-0 sm:w-60">
                <ProductCard product={product} analyticsContext={analytics(i + 1, origin)} />
              </div>
            ))}
          </HorizontalScroller>
        ))}
    </Section>
  );
}

function Spans({ spans }: { spans: RichSpan[] }) {
  return (
    <>
      {spans.map((s, i) =>
        s.href ? (
          <a key={i} href={s.href} {...(/^https:\/\//i.test(s.href) ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="font-semibold text-findmi-700 underline decoration-findmi/40 underline-offset-2 hover:decoration-findmi-700">
            {s.text}
          </a>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </>
  );
}

function TextSection({ page, text, titleClassName }: { page: DiscoveryPage; text: ResolvedText; titleClassName: string }) {
  const { row, config, blocks } = text;
  return (
    <Section title={row.title} subtitle={row.subtitle ?? undefined} titleClassName={titleClassName} subtitleClassName={SECTION_SUBTITLE} impressionPayload={impression(page, row, { content_type: "rich_text" })}>
      <div className="px-4 sm:px-6">
        {config.image_url && (
          <div className="relative mb-4 aspect-[16/9] w-full max-w-3xl overflow-hidden rounded-2xl bg-black/[0.04]">
            <SupabaseImage src={config.image_url} alt={config.image_alt ?? ""} fill sizes="(min-width: 768px) 768px, 100vw" className="object-cover" />
          </div>
        )}
        <div className="flex max-w-2xl flex-col gap-3 text-base leading-relaxed text-ink/75">
          {blocks.map((b, i) =>
            b.type === "h3" ? (
              <h3 key={i} className="pt-1 font-display text-lg font-bold tracking-tight text-ink">
                {b.text}
              </h3>
            ) : b.type === "ul" ? (
              <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
                {b.items.map((spans, j) => (
                  <li key={j}>
                    <Spans spans={spans} />
                  </li>
                ))}
              </ul>
            ) : (
              <p key={i} className="whitespace-pre-line">
                <Spans spans={b.spans} />
              </p>
            )
          )}
        </div>
        {config.cta_label && config.cta_url && <CtaLink href={config.cta_url} label={config.cta_label} external={/^https:\/\//i.test(config.cta_url)} className="mt-4" />}
      </div>
    </Section>
  );
}

function MapSection({ page, map, titleClassName }: { page: DiscoveryPage; map: ResolvedMap; titleClassName: string }) {
  const { row } = map;
  return (
    <Section title={row.title} subtitle={row.subtitle ?? undefined} titleClassName={titleClassName} subtitleClassName={SECTION_SUBTITLE} impressionPayload={impression(page, row, { content_type: "map", count: map.results.length })}>
      <div className="px-4 sm:px-6">
        <ContextMap results={map.results} label={`Map of ${row.title}`} tall />
      </div>
    </Section>
  );
}
