// Pages + Sections V1A — public Guide Pages (/guides/[slug]).
//
// A Guide is a non-system discovery_pages row (Discovery Page Builder
// Phase 1) rendered publicly with its Page-level hero and its existing
// Sections (homepage_rows, legacy name). This module owns: the public and
// Admin-preview reads, the Section tree a Guide renders, Page-detail
// validation, publication timestamps, coverage dates, metadata, JSON-LD and
// sitemap entries. Pure helpers take their inputs; reads take an optional
// client (the anon client by default — RLS only returns published Pages and
// visible Sections of published Pages).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import { getSupabase } from "./supabase";
import { validateCustomDestination } from "./navigation";
import { isLegacyFeedRow, isPageSectionKind } from "./section-types";
import { parseSectionConfig, type SectionConfig } from "./page-sections";
import type { DiscoveryPage } from "./discovery-pages";
import type { HomepageRow } from "./homepage-rows";

export const GUIDES_PATH = "/guides";
export const guidePath = (slug: string) => `${GUIDES_PATH}/${slug}`;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ------------------------------------------------------------ reads

/** A published, non-system Page by slug — null for a draft, the system
 * Homepage, a missing slug or a malformed one. Public (anon) by default. */
export async function getPublishedGuide(slug: string, client: SupabaseClient | null = getSupabase()): Promise<DiscoveryPage | null> {
  if (!client || !SLUG.test(slug) || slug.length > 120) return null;
  const { data } = await client.from("discovery_pages").select("*").eq("slug", slug).eq("is_published", true).eq("is_system", false).maybeSingle();
  const page = (data as DiscoveryPage | null) ?? null;
  // Defense in depth on top of the query filters.
  return page && page.is_published && !page.is_system ? page : null;
}

/** Every visible Section row of a Page (both levels), in sort order. */
export async function getGuideSectionRows(pageId: string, client: SupabaseClient | null = getSupabase()): Promise<HomepageRow[]> {
  if (!client) return [];
  const { data } = await client.from("homepage_rows").select("*").eq("page_id", pageId).eq("is_visible", true).order("sort_order", { ascending: true });
  return (data as HomepageRow[] | null) ?? [];
}

/** Published Guides for the sitemap. */
export async function getPublishedGuideSlugs(client: SupabaseClient | null = getSupabase()): Promise<{ slug: string; updated_at: string | null }[]> {
  if (!client) return [];
  const { data } = await client.from("discovery_pages").select("slug, updated_at").eq("is_published", true).eq("is_system", false);
  return ((data as { slug: string; updated_at: string | null }[] | null) ?? []).filter((r) => SLUG.test(r.slug));
}

/** Sitemap entries for published Guides (lastModified from updated_at). */
export function guideSitemapEntries(rows: readonly { slug: string; updated_at: string | null }[], siteUrl: string): { url: string; lastModified?: Date }[] {
  return rows.map((r) => ({ url: `${siteUrl}${guidePath(r.slug)}`, ...(r.updated_at ? { lastModified: new Date(r.updated_at) } : {}) }));
}

// ------------------------------------------------------------ sections

/** The content types a Guide renders. business_showcase (the homepage's
 * business-acquisition pitch) has no content of its own and stays a
 * homepage-only row. */
export const GUIDE_FEED_TYPES = ["businesses", "events", "products"] as const;

export type GuideSectionNode =
  | { kind: "feed"; row: HomepageRow }
  | { kind: "block"; row: HomepageRow; section: SectionConfig }
  | { kind: "group"; row: HomepageRow; children: HomepageRow[] };

const renderableFeed = (r: HomepageRow) => r.is_visible && isLegacyFeedRow(r) && (GUIDE_FEED_TYPES as readonly string[]).includes(r.content_type ?? "");

/** Pages + Sections V1B — a visible Entity Results / Text & Editorial /
 * Map Section with a VALID config, parsed; null for anything else (an
 * invalid or missing config fails closed, never guessed). */
export function guideBlockOf(r: HomepageRow): SectionConfig | null {
  if (!r.is_visible || !isPageSectionKind(r.section_type) || r.content_type !== null) return null;
  const parsed = parseSectionConfig(r.section_type, r.config);
  return parsed.ok ? parsed.value : null;
}

const renderableChild = (r: HomepageRow) => renderableFeed(r) || guideBlockOf(r) !== null;

/** The Section tree a Guide renders, from a Page's rows: visible top-level
 * Sections in sort_order; a Group with its visible renderable children (in
 * their own order). Unknown / unsupported rows are skipped (fail closed); a
 * Group with nothing renderable is dropped. */
export function buildGuideSections(rows: readonly HomepageRow[]): GuideSectionNode[] {
  const bySort = (a: HomepageRow, b: HomepageRow) => a.sort_order - b.sort_order;
  const out: GuideSectionNode[] = [];
  for (const row of rows.filter((r) => r.parent_id === null && r.is_visible).sort(bySort)) {
    if (row.section_type === "group") {
      const children = rows.filter((r) => r.parent_id === row.id && renderableChild(r)).sort(bySort);
      if (children.length) out.push({ kind: "group", row, children });
    } else if (renderableFeed(row)) {
      out.push({ kind: "feed", row });
    } else {
      const section = guideBlockOf(row);
      if (section) out.push({ kind: "block", row, section });
    }
  }
  return out;
}

// ------------------------------------------------------------ coverage dates

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function isDateKey(v: string): boolean {
  const m = DATE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

const parts = (v: string) => {
  const m = DATE.exec(v)!;
  return { y: +m[1], mo: +m[2] - 1, d: +m[3] };
};

/** "Oct 26 – Nov 2, 2026", "Oct 26 – 30, 2026", "From Oct 26, 2026",
 * "Through Nov 2, 2026"; null without valid dates. Calendar dates only —
 * no time zone conversion. */
export function formatCoverage(startsOn: string | null | undefined, endsOn: string | null | undefined): string | null {
  const s = startsOn && isDateKey(startsOn) ? parts(startsOn) : null;
  const e = endsOn && isDateKey(endsOn) ? parts(endsOn) : null;
  const md = (p: { mo: number; d: number }) => `${MONTHS[p.mo]} ${p.d}`;
  if (s && e) {
    if (s.y === e.y && s.mo === e.mo && s.d === e.d) return `${md(s)}, ${s.y}`;
    if (s.y === e.y && s.mo === e.mo) return `${md(s)} – ${e.d}, ${e.y}`;
    if (s.y === e.y) return `${md(s)} – ${md(e)}, ${e.y}`;
    return `${md(s)}, ${s.y} – ${md(e)}, ${e.y}`;
  }
  if (s) return `From ${md(s)}, ${s.y}`;
  if (e) return `Through ${md(e)}, ${e.y}`;
  return null;
}

/** Where today (YYYY-MM-DD, the app time zone) sits relative to the
 * coverage dates. "past" never hides the Page — it only labels it. */
export function coverageStatus(startsOn: string | null | undefined, endsOn: string | null | undefined, today: string): "upcoming" | "current" | "past" | null {
  const s = startsOn && isDateKey(startsOn) ? startsOn : null;
  const e = endsOn && isDateKey(endsOn) ? endsOn : null;
  if (!s && !e) return null;
  if (e && e < today) return "past";
  if (s && s > today) return "upcoming";
  return "current";
}

// ------------------------------------------------------------ Page details

export interface GuideDetailsInput {
  hero_image_url: string | null;
  hero_image_alt: string | null;
  cta_label: string | null;
  cta_url: string | null;
  seo_title: string | null;
  seo_description: string | null;
  og_image_url: string | null;
  starts_on: string | null;
  ends_on: string | null;
}

const httpsImage = (v: string) => /^https:\/\/\S+$/i.test(v) && v.length <= 2048;

/** Validates the Guide fields of a Page (mirrors the migration's CHECKs, with
 * readable errors). Returns the normalized values to store. */
export function validateGuideDetails(input: GuideDetailsInput): { ok: true; value: GuideDetailsInput } | { ok: false; error: string } {
  const v = { ...input };
  for (const [key, label] of [["hero_image_url", "Hero image"], ["og_image_url", "Share image"]] as const) {
    if (v[key] && !httpsImage(v[key]!)) return { ok: false, error: `${label} must be an uploaded image or an https:// link.` };
  }
  if (v.hero_image_alt && v.hero_image_alt.length > 200) return { ok: false, error: "Hero alt text must be 200 characters or fewer." };
  if (Boolean(v.cta_label) !== Boolean(v.cta_url)) return { ok: false, error: "A call to action needs both a label and a destination." };
  if (v.cta_label && v.cta_label.length > 40) return { ok: false, error: "CTA label must be 40 characters or fewer." };
  if (v.cta_url) {
    const dest = validateCustomDestination(v.cta_url);
    if (!dest.ok) return { ok: false, error: `CTA destination: ${dest.error}` };
    v.cta_url = dest.value;
  }
  if (v.seo_title && v.seo_title.length > 120) return { ok: false, error: "SEO title must be 120 characters or fewer." };
  if (v.seo_description && v.seo_description.length > 300) return { ok: false, error: "SEO description must be 300 characters or fewer." };
  for (const [key, label] of [["starts_on", "Coverage start"], ["ends_on", "Coverage end"]] as const) {
    if (v[key] && !isDateKey(v[key]!)) return { ok: false, error: `${label} must be a valid date.` };
  }
  if (v.starts_on && v.ends_on && v.ends_on < v.starts_on) return { ok: false, error: "Coverage end can't be before coverage start." };
  return { ok: true, value: v };
}

/** published_at records the FIRST publication: set when a Page is
 * published without one; kept as-is otherwise (including after an
 * unpublish, so a re-publish keeps the original date). */
export function nextPublishedAt(current: string | null | undefined, publishing: boolean, now: string): string | null {
  if (current) return current;
  return publishing ? now : null;
}

// ------------------------------------------------------------ SEO

export interface GuideItemRef {
  name: string;
  path: string;
}

export function guideTitle(page: Pick<DiscoveryPage, "title" | "seo_title">): string {
  return page.seo_title?.trim() || page.title;
}
export function guideDescription(page: Pick<DiscoveryPage, "description" | "seo_description">): string | undefined {
  return page.seo_description?.trim() || page.description?.trim() || undefined;
}
export function guideShareImage(page: Pick<DiscoveryPage, "og_image_url" | "hero_image_url">): string | undefined {
  return page.og_image_url || page.hero_image_url || undefined;
}

/** Next.js metadata for a published Guide. */
export function guideMetadata(page: DiscoveryPage, origin: string): Metadata {
  const title = guideTitle(page);
  const description = guideDescription(page);
  const image = guideShareImage(page);
  const url = `${origin}${guidePath(page.slug)}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website", images: image ? [image] : undefined },
    twitter: { card: image ? "summary_large_image" : "summary", title, description, images: image ? [image] : undefined },
  };
}

/** schema.org CollectionPage, with an ItemList of the entities the Guide
 * actually renders (in render order, de-duplicated). */
export function guideJsonLd(page: DiscoveryPage, origin: string, items: readonly GuideItemRef[]): Record<string, unknown> {
  const url = `${origin}${guidePath(page.slug)}`;
  const seen = new Set<string>();
  const unique = items.filter((i) => (seen.has(i.path) ? false : (seen.add(i.path), true)));
  const image = guideShareImage(page);
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: guideTitle(page),
    ...(guideDescription(page) ? { description: guideDescription(page) } : {}),
    url,
    ...(image ? { image } : {}),
    ...(page.published_at ? { datePublished: page.published_at } : {}),
    dateModified: page.updated_at,
    ...(unique.length
      ? {
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: unique.length,
            itemListElement: unique.map((i, n) => ({ "@type": "ListItem", position: n + 1, name: i.name, url: `${origin}${i.path}` })),
          },
        }
      : {}),
  };
}
