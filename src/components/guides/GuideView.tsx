import SupabaseImage from "@/components/SupabaseImage";
import Section, { HorizontalScroller } from "@/components/Section";
import HomeEventCard from "@/components/HomeEventCard";
import BusinessLogoCard from "@/components/BusinessLogoCard";
import ProductCard from "@/components/ProductCard";
import { getBusinessGalleryImagesMap, getUpcomingAppearanceSummaries } from "@/lib/data";
import { resolveEffectiveSectionContext, type DiscoveryPage } from "@/lib/discovery-pages";
import { resolveHomepageRowItems, type HomepageRow, type ResolvedHomepageRow } from "@/lib/homepage-rows";
import { coverageStatus, formatCoverage, guidePath, type GuideItemRef, type GuideSectionNode } from "@/lib/guides";
import type { AnalyticsPlacementContext } from "@/lib/analytics/context";

// Pages + Sections V1A — one renderer for a Guide Page: the public
// /guides/[slug] route and the Admin preview both render exactly this, so
// a preview never drifts from what goes live. Page-level hero, then the
// Page's existing Sections (feed rows resolved by the same
// resolveHomepageRowItems every homepage row uses; Groups as a heading over
// their feed children). Unsupported / empty Sections render nothing.

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
export type ResolvedGuideSection = { kind: "feed"; feed: ResolvedFeed } | { kind: "group"; row: HomepageRow; children: ResolvedFeed[] };

async function resolveFeed(page: DiscoveryPage, row: HomepageRow): Promise<ResolvedFeed | null> {
  const ctx = resolveEffectiveSectionContext(page, row);
  const resolved = await resolveHomepageRowItems(row, ctx.marketSlug, ctx.areaSlug);
  if (!["businesses", "events", "products"].includes(resolved.contentType) || resolved.items.length === 0) return null;
  if (resolved.contentType !== "businesses") return { row, resolved, hints: {}, counts: {}, galleries: {} };
  const ids = resolved.items.map((b) => b.id);
  const [{ hints, counts }, galleries] = await Promise.all([getUpcomingAppearanceSummaries(ids), getBusinessGalleryImagesMap(ids)]);
  return { row, resolved, hints: Object.fromEntries(hints), counts: Object.fromEntries(counts), galleries: Object.fromEntries(galleries) };
}

/** Resolves every Section of a Guide in parallel; empty ones drop out, and
 * the entities that will render are returned for structured data. */
export async function resolveGuide(page: DiscoveryPage, nodes: readonly GuideSectionNode[]): Promise<{ sections: ResolvedGuideSection[]; items: GuideItemRef[] }> {
  const resolvedNodes = await Promise.all(
    nodes.map(async (n): Promise<ResolvedGuideSection | null> => {
      if (n.kind === "feed") {
        const feed = await resolveFeed(page, n.row);
        return feed ? { kind: "feed", feed } : null;
      }
      const children = (await Promise.all(n.children.map((c) => resolveFeed(page, c)))).filter((c): c is ResolvedFeed => c !== null);
      return children.length ? { kind: "group", row: n.row, children } : null;
    })
  );
  const sections = resolvedNodes.filter((s): s is ResolvedGuideSection => s !== null);
  const items: GuideItemRef[] = [];
  const add = (f: ResolvedFeed) => {
    const r = f.resolved;
    if (r.contentType === "events") for (const e of r.items) items.push({ name: e.name, path: `/event/${e.slug}` });
    if (r.contentType === "businesses") for (const b of r.items) items.push({ name: b.name, path: `/business/${b.slug}` });
    if (r.contentType === "products") for (const p of r.items) items.push({ name: p.name, path: `/product/${p.slug}` });
  };
  for (const s of sections) (s.kind === "feed" ? [s.feed] : s.children).forEach(add);
  return { sections, items };
}

export default function GuideView({ page, sections, today }: { page: DiscoveryPage; sections: ResolvedGuideSection[]; today: string }) {
  return (
    <article className="bg-white pb-10">
      <GuideHero page={page} today={today} />
      <div className="mx-auto max-w-6xl">
        {sections.map((s) =>
          s.kind === "feed" ? (
            <FeedSection key={s.feed.row.id} page={page} feed={s.feed} titleClassName={SECTION_TITLE} />
          ) : (
            <section key={s.row.id} className="pt-6" aria-labelledby={`guide-group-${s.row.id}`}>
              <div className="px-4 sm:px-6">
                <h2 id={`guide-group-${s.row.id}`} className={SECTION_TITLE}>
                  {s.row.title}
                </h2>
                {s.row.subtitle && <p className={SECTION_SUBTITLE}>{s.row.subtitle}</p>}
              </div>
              {s.children.map((c) => (
                <FeedSection key={c.row.id} page={page} feed={c} titleClassName={CHILD_TITLE} />
              ))}
            </section>
          )
        )}
        {sections.length === 0 && <p className="px-4 py-10 text-sm text-ink/50 sm:px-6">More is coming to this guide soon.</p>}
      </div>
    </article>
  );
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
          <a
            href={page.cta_url}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-findmi px-5 text-sm font-bold text-white transition hover:bg-findmi-600"
          >
            {page.cta_label}
          </a>
        )}
      </div>
    </header>
  );
}

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
      impressionPayload={{
        event_name: "discovery_section_impression",
        discovery_page_id: page.id,
        discovery_section_id: row.id,
        page_type: "guide",
        page_path: guidePath(page.slug),
        metadata: { content_type: row.content_type, mode: row.mode },
      }}
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
