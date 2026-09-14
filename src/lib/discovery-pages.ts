// Discovery Page Builder — Page-level data layer (Phase 1: Canonical Page +
// Section Foundation). Sibling to lib/homepage-rows.ts, which owns
// section-ROW content/resolution; this file owns Page IDENTITY: internal
// name, public title, slug, description, publication state, and optional
// Category/Market/Area context. See lib/site-sections.ts for the OTHER,
// still-untouched homepage structural-funnel system (Hero/Search/category
// pills/closing CTA) — this is a different, new concept, not a rename of
// that one.
//
// Migration: discovery_pages_foundation. Row zero (is_system=true) is the
// reserved Homepage page — its public route stays "/" and it is protected
// from delete/unpublish/slug-change by DB triggers (defense in depth on
// top of the admin-layer checks below).
import { getAdminSupabase } from "./admin/supabase-admin";

export interface DiscoveryPage {
  id: string;
  internal_name: string;
  title: string;
  slug: string;
  description: string | null;
  is_published: boolean;
  is_system: boolean;
  category_slug: string | null;
  market_slug: string | null;
  area_slug: string | null;
  created_at: string;
  updated_at: string;
}

/** All Discovery Pages, for the admin list — service role, bypasses RLS.
 * Same reasoning as getAdminHomepageRows/getAdminNavItems: this file is
 * shared with public code (lib/homepage-rows.ts imports getHomepagePageId
 * below for the public homepage's own fetch), so it stays off
 * requireAdminSupabase() to avoid tainting that module graph with
 * next/headers. Its only privileged caller is the middleware-gated
 * /admin/site/pages route tree — that gate is this function's protection. */
export async function getAdminDiscoveryPages(): Promise<DiscoveryPage[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("discovery_pages")
    .select("*")
    .order("is_system", { ascending: false }) // Homepage always first
    .order("created_at", { ascending: true });
  return (data as DiscoveryPage[]) ?? [];
}

export async function getAdminDiscoveryPage(id: string): Promise<DiscoveryPage | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("discovery_pages").select("*").eq("id", id).maybeSingle();
  return (data as DiscoveryPage | null) ?? null;
}

/** The reserved Homepage system page's id — a cheap, tiny-table lookup so
 * every existing homepage_rows call site (the public homepage render,
 * /admin/site/homepage/rows) can keep working with NO signature change at
 * their call sites even though homepage_rows is now page-scoped. Cached
 * per server instance: the system page's id is permanent once created
 * (protected by DB trigger — it can never be deleted or recreated). */
let cachedHomepagePageId: string | null = null;

export async function getHomepageDiscoveryPageId(): Promise<string | null> {
  if (cachedHomepagePageId) return cachedHomepagePageId;
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("discovery_pages").select("id").eq("is_system", true).limit(1).maybeSingle();
  cachedHomepagePageId = data?.id ?? null;
  return cachedHomepagePageId;
}

/** Effective Category/Market/Area context for a section: its own override
 * wins, otherwise its page's context, otherwise none. Pure/no I/O — exact
 * shape the audit's Data Model Recommendation specified (section override
 * ?? page context ?? null), mirroring resolveSection's per-field fallback
 * in lib/site-sections.ts. Not yet wired into any public route in Phase 1
 * (the only page with content today, Homepage, has no context configured,
 * and the Phase 1 test page has no public route) — ready for Phase 3 to
 * consume once a page-context-aware public renderer exists. */
export function resolveEffectiveSectionContext(
  page: Pick<DiscoveryPage, "category_slug" | "market_slug" | "area_slug">,
  section: { category_slug?: string | null; market_slug?: string | null; area_slug?: string | null }
): { categorySlug?: string; marketSlug?: string; areaSlug?: string } {
  const categorySlug = section.category_slug ?? page.category_slug ?? undefined;
  const marketSlug = section.market_slug ?? page.market_slug ?? undefined;
  // Area only ever accompanies Market — same convention as every existing
  // Market/Area caller on the site (see /find, homepage-rows.ts).
  const areaSlug = marketSlug ? (section.area_slug ?? page.area_slug ?? undefined) : undefined;
  return { categorySlug, marketSlug, areaSlug };
}
