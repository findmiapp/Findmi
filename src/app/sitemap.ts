import { applyLocationDiscoveryFilter } from "@/lib/location-eligibility";
import type { MetadataRoute } from "next";
import { getSupabase } from "@/lib/supabase";
import { guideSitemapEntries, getPublishedGuideSlugs } from "@/lib/guides";
import { applyCatalogProductFilter, isCatalogBusinessPublic } from "@/lib/product-catalog";
import { getVocabulary } from "@/lib/discovery/server";
import { SITEMAP_STATIC_PATHS, canonicalEntityPath } from "@/lib/seo/sitemap-policy";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://findmi.app";

/** Only canonical URLs we want indexed (Google index hygiene, Nov 2026 —
 * policy in lib/seo/indexing.ts). Every entity URL here is the SAME URL its
 * page declares as canonical: a Business/Event/Location with a public handle
 * is listed at /<handle>, not /business/<slug>. Never listed: search,
 * filtered listings, account/manager/admin, creation/edit, checkout, and any
 * other noindex family. The gates below mirror each page's own visibility
 * rule, so nothing listed here 404s or carries noindex. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = SITEMAP_STATIC_PATHS.map((path) => ({ url: `${siteUrl}${path}`, lastModified: now }));

  const supabase = getSupabase();
  if (!supabase) return staticRoutes;

  const [{ data: businesses }, { data: events }, { data: locations }, { data: products }, { data: moments }, { data: handles }, guides, vocab] = await Promise.all([
    supabase.from("businesses").select("id, slug, updated_at").eq("is_demo", false).eq("publication_status", "live").is("archived_at", null).is("trashed_at", null),
    supabase.from("events").select("id, slug").eq("is_demo", false).eq("publication_status", "live").is("archived_at", null).is("trashed_at", null),
    // Same rule the Location page uses for robots (isLocationDiscoverable).
    applyLocationDiscoveryFilter(supabase.from("locations").select("id, slug")),
    // Catalog rule (lib/product-catalog) — exactly what /product/[slug] serves.
    applyCatalogProductFilter(supabase.from("products").select("slug, business:businesses(is_demo, publication_status)")),
    // Published public Moments only (the anon RLS rule; /journal/[id] noindexes anything else).
    supabase.from("journal_entries").select("id, updated_at").eq("visibility", "public").eq("status", "published"),
    supabase.from("public_handles").select("handle, entity_type, entity_id"),
    // Pages + Sections V1A — published, non-system Guide Pages only.
    getPublishedGuideSlugs(supabase),
    getVocabulary().catch(() => null),
  ]);

  const handleOf = new Map<string, string>(
    ((handles ?? []) as { handle: string; entity_type: string; entity_id: string }[]).map((h) => [`${h.entity_type}:${h.entity_id}`, h.handle])
  );
  const entity = (type: "business" | "event" | "location", id: string, slug: string) => `${siteUrl}${canonicalEntityPath(type, slug, handleOf.get(`${type}:${id}`))}`;

  const businessRoutes: MetadataRoute.Sitemap = ((businesses ?? []) as { id: string; slug: string; updated_at: string | null }[]).map((b) => ({
    url: entity("business", b.id, b.slug),
    lastModified: b.updated_at ? new Date(b.updated_at) : now,
  }));
  const eventRoutes: MetadataRoute.Sitemap = ((events ?? []) as { id: string; slug: string }[]).map((e) => ({ url: entity("event", e.id, e.slug) }));
  const locationRoutes: MetadataRoute.Sitemap = ((locations ?? []) as { id: string; slug: string }[]).map((l) => ({ url: entity("location", l.id, l.slug) }));

  type ProductRow = { slug: string; business: { is_demo: boolean | null; publication_status: string | null } | { is_demo: boolean | null; publication_status: string | null }[] | null };
  const productRoutes: MetadataRoute.Sitemap = ((products ?? []) as ProductRow[])
    .filter((p) => isCatalogBusinessPublic(Array.isArray(p.business) ? (p.business[0] ?? null) : p.business))
    .map((p) => ({ url: `${siteUrl}/product/${p.slug}` }));

  const momentRoutes: MetadataRoute.Sitemap = ((moments ?? []) as { id: string; updated_at: string | null }[]).map((m) => ({
    url: `${siteUrl}/journal/${m.id}`,
    ...(m.updated_at ? { lastModified: new Date(m.updated_at) } : {}),
  }));

  // Curated Area landing pages — the same consumer-visible rule as the page.
  const areaRoutes: MetadataRoute.Sitemap = vocab
    ? vocab.areaRows
        .filter((a) => a.consumer_visible && vocab.marketRows.some((m) => m.slug === a.market && m.consumer_visible))
        .map((a) => ({ url: `${siteUrl}/explore/${a.market}/${a.slug}` }))
    : [];

  return [
    ...staticRoutes,
    ...businessRoutes,
    ...eventRoutes,
    ...locationRoutes,
    ...productRoutes,
    ...momentRoutes,
    ...areaRoutes,
    ...guideSitemapEntries(guides, siteUrl),
  ];
}
