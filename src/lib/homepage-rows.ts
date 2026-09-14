// Founder homepage feed builder — data layer. See migration
// create_homepage_rows. Unlike site_sections (a fixed set of TypeScript-
// defined keys — see lib/site-sections.ts), homepage_rows is a real,
// founder-managed LIST: rows can be created, renamed, reordered, hidden,
// and deleted from /admin without a code change. This file owns: the
// admin (all rows) and public (visible rows only) fetches, and the single
// dispatcher that turns one row's configuration into real content by
// calling the same query functions every other part of the app already
// uses (lib/data.ts) — never a parallel content system.
//
// Discovery Page Builder Phase 1 — this table (still named homepage_rows;
// deliberately not renamed, see migration discovery_pages_foundation) is
// now PAGE-SCOPED: every row belongs to a discovery_pages row via page_id.
// Every existing call site below keeps its original zero-argument shape —
// omitting pageId resolves to the reserved Homepage system page — so the
// public homepage render and the existing /admin/site/homepage/rows editor
// are both untouched by this generalization. A NEW page (see
// lib/discovery-pages.ts + /admin/site/pages) passes its own pageId
// explicitly. Rows also now support one level of parent/child grouping
// (section_type: "feed" | "group", parent_id) and a third "hybrid" curation
// mode (pinned_ids, founder-ordered, rendered first, with the automatic
// query filling the remainder) — see resolveHomepageRowItems below.
import { getSupabase } from "./supabase";
import { getAdminSupabase } from "./admin/supabase-admin";
import { getHomepageDiscoveryPageId } from "./discovery-pages";
import {
  attachEventCategories,
  getBusinessesByIds,
  getEventsByIds,
  getEventsDiscovery,
  getHomepageRowBusinesses,
  getHomepageRowProducts,
  getProductsByIds,
  type FeaturedProduct,
} from "./data";
import type { BusinessWithCategories, EventWithCategories, FindmiEvent } from "./types";

export type HomepageRowContentType = "businesses" | "events" | "products" | "business_showcase";
export type HomepageRowMode = "dynamic" | "curated" | "hybrid";
export type HomepageRowTimeWindow = "now" | "weekend" | "anytime";
/** "feed" = renders real content (the only kind that existed before Phase
 * 1). "group" = an explicit heading/description wrapper around up to one
 * level of child feed sections — never itself a feed, never nested under
 * another group (enforced by DB trigger, see the migration). */
export type HomepageRowSectionType = "feed" | "group";

export interface HomepageRow {
  id: string;
  title: string;
  subtitle: string | null;
  /** Null only for a Group section (section_type === "group") — a Group
   * has no content type of its own. */
  content_type: HomepageRowContentType | null;
  mode: HomepageRowMode;
  category_slug: string | null;
  featured_only: boolean;
  time_window: HomepageRowTimeWindow | null;
  item_limit: number;
  curated_ids: string[];
  /** Hybrid mode only — founder-ordered pinned ids, rendered first; the
   * automatic query then fills the row's remaining capacity, excluding
   * whatever is pinned. Ignored in dynamic/curated modes. */
  pinned_ids: string[];
  is_visible: boolean;
  sort_order: number;
  page_id: string;
  /** Non-null only for a child of a top-level Group on the same page. */
  parent_id: string | null;
  section_type: HomepageRowSectionType;
  /** Section-level Market/Area override — falls back to the section's
   * page context when null (see resolveEffectiveSectionContext in
   * lib/discovery-pages.ts). Not yet consumed by any public route in
   * Phase 1; storage + resolution only, ready for a future page-aware
   * renderer. */
  market_slug: string | null;
  area_slug: string | null;
  created_at: string;
  updated_at: string;
}

/** All rows for one page (visible or not), for the admin editor — service
 * role, bypasses RLS. `pageId` defaults to the reserved Homepage page, so
 * the existing /admin/site/homepage/rows editor's `getAdminHomepageRows()`
 * call keeps working unchanged and keeps showing only Homepage's own rows
 * even though other pages' rows now live in the same table.
 *
 * Security Pass 4 note: deliberately NOT switched to requireAdminSupabase()
 * — same reasoning as lib/navigation.ts's getAdminNavItems(): this file is
 * shared with public code paths (getSupabase()-based public fetches below),
 * and requireAdminSupabase() transitively importing next/headers risks
 * tainting the whole module for any Client Component that ever imports a
 * type or public helper from here. This function's only callers are
 * middleware-gated /admin/site/** Server Components — that gate is its
 * protection. */
export async function getAdminHomepageRows(pageId?: string): Promise<HomepageRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const resolvedPageId = pageId ?? (await getHomepageDiscoveryPageId());
  if (!resolvedPageId) return [];
  const { data } = await supabase
    .from("homepage_rows")
    .select("*")
    .eq("page_id", resolvedPageId)
    .order("sort_order", { ascending: true });
  return (data as HomepageRow[]) ?? [];
}

/** Public fetch — visible, TOP-LEVEL rows for one page only (RLS enforces
 * both visibility and page-publication too; the explicit filters here just
 * avoid depending on RLS alone). `pageId` defaults to the reserved
 * Homepage page — the public homepage's existing `getVisibleHomepageRows()`
 * call is unchanged. Scoped to `parent_id IS NULL`: the public homepage has
 * no concept of section groups (Phase 1 doesn't touch its rendering), and
 * no page has a public renderer that understands children yet — this stays
 * a defensive guarantee that a future group/child row can never silently
 * appear flattened into the homepage's row list. */
export async function getVisibleHomepageRows(pageId?: string): Promise<HomepageRow[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  let resolvedPageId = pageId;
  if (!resolvedPageId) {
    const { data } = await supabase.from("discovery_pages").select("id").eq("is_system", true).limit(1).maybeSingle();
    resolvedPageId = data?.id;
  }
  if (!resolvedPageId) return [];

  const { data } = await supabase
    .from("homepage_rows")
    .select("*")
    .eq("page_id", resolvedPageId)
    .eq("is_visible", true)
    .is("parent_id", null)
    .order("sort_order", { ascending: true });
  return (data as HomepageRow[]) ?? [];
}

export type ResolvedHomepageRow =
  | { contentType: "businesses"; items: BusinessWithCategories[] }
  | { contentType: "events"; items: EventWithCategories[] }
  | { contentType: "products"; items: FeaturedProduct[] }
  | { contentType: "business_showcase"; items: [] }
  /** A Group section has no content of its own — its children (resolved
   * separately by the caller, one resolveHomepageRowItems call per child)
   * are the content. See the doc comment on this function. */
  | { contentType: "group"; items: [] };

/** Turns one row's configuration into real content. Dynamic mode calls the
 * same shared query functions every other feed on the site uses (with the
 * row's own filters); curated mode fetches the founder's hand-picked
 * records, in the order the founder chose (see getBusinessesByIds et al —
 * a deleted/unpublished curated record just drops out, never errors).
 * Hybrid mode (Phase 1) renders the founder's ordered pinned records first,
 * then fills the row's remaining capacity with the same automatic query
 * dynamic mode uses, excluding anything already pinned — see
 * resolveHybridBusinesses/Events/Products below. Duplicate suppression is
 * SECTION-SCOPED ONLY: an entity pinned in one section can still appear in
 * another section's automatic fill on the same page — that's intentional,
 * not a bug (a Business may legitimately appear in more than one
 * discovery section). The business_showcase content type has no queryable
 * content of its own — it's the existing BusinessShowcaseCarousel, just
 * hideable/reorderable through this same row system now instead of a
 * fixed page position. A Group section (section_type "group") short-
 * circuits before any content_type branch — see the "group" case below.
 *
 * Homepage Market Filtering V1 — `marketSlug` is ONLY ever applied to a
 * DYNAMIC or HYBRID "businesses" row (see getHomepageRowBusinesses).
 * Curated rows are a founder's exact editorial selection — LOCKED V1
 * policy is that they ignore Market entirely, so `marketSlug` is never
 * passed to getBusinessesByIds, and business_showcase/products branches
 * never receive it at all (Market controls general BUSINESS discovery
 * only).
 *
 * Consumer Event Market Filtering V1 — a DYNAMIC or HYBRID "events" row
 * also receives `marketSlug` (forwarded into getEventsDiscovery, which
 * scopes by each occurrence's EFFECTIVE physical Market — see
 * lib/event-markets.ts — never business Market entitlement). A CURATED
 * events row stays exactly like curated businesses: the founder's
 * editorial selection ignores Market entirely.
 *
 * Browse Mode + Area-Aware Discovery pass — `areaSlug` follows the exact
 * same rule as `marketSlug` above: only ever applied to a DYNAMIC or
 * HYBRID "businesses" row (getHomepageRowBusinesses), never to curated
 * rows, business_showcase, events, or products in this pass. Omitted
 * preserves exact prior (Market-only, or unfiltered) behavior. */
export async function resolveHomepageRowItems(
  row: HomepageRow,
  marketSlug?: string,
  areaSlug?: string
): Promise<ResolvedHomepageRow> {
  if (row.section_type === "group") {
    return { contentType: "group", items: [] };
  }

  if (row.content_type === "business_showcase") {
    return { contentType: "business_showcase", items: [] };
  }

  if (row.content_type === "businesses") {
    const items =
      row.mode === "curated"
        ? await getBusinessesByIds(row.curated_ids)
        : row.mode === "hybrid"
          ? await resolveHybridBusinesses(row, marketSlug, areaSlug)
          : await getHomepageRowBusinesses({
              categorySlug: row.category_slug ?? undefined,
              featuredOnly: row.featured_only,
              limit: row.item_limit,
              marketSlug,
              areaSlug,
            });
    return { contentType: "businesses", items };
  }

  if (row.content_type === "events") {
    const raw =
      row.mode === "curated"
        ? await getEventsByIds(row.curated_ids)
        : row.mode === "hybrid"
          ? await resolveHybridEvents(row, marketSlug)
          : await getEventsDiscovery({
              when: row.time_window ?? "anytime",
              categorySlug: row.category_slug ?? undefined,
              limit: row.item_limit,
              marketSlug,
            });
    const items = await attachEventCategories(raw);
    return { contentType: "events", items };
  }

  // products (the only remaining content_type; content_type is guaranteed
  // non-null here since section_type "group" already returned above)
  const items =
    row.mode === "curated"
      ? await getProductsByIds(row.curated_ids)
      : row.mode === "hybrid"
        ? await resolveHybridProducts(row)
        : await getHomepageRowProducts({
            categorySlug: row.category_slug ?? undefined,
            featuredOnly: row.featured_only,
            limit: row.item_limit,
          });
  return { contentType: "products", items };
}

async function resolveHybridBusinesses(
  row: HomepageRow,
  marketSlug?: string,
  areaSlug?: string
): Promise<BusinessWithCategories[]> {
  const pinned = await getBusinessesByIds(row.pinned_ids);
  const remaining = Math.max(0, row.item_limit - pinned.length);
  if (remaining === 0) return pinned;
  const pinnedIdSet = new Set(row.pinned_ids);
  // Fetched at the full item_limit as a buffer (not the reduced remaining
  // count) since some of what comes back may need filtering out below —
  // requesting fewer up front could under-fill after the pinned exclusion.
  const auto = await getHomepageRowBusinesses({
    categorySlug: row.category_slug ?? undefined,
    featuredOnly: row.featured_only,
    limit: row.item_limit,
    marketSlug,
    areaSlug,
  });
  const fill = auto.filter((b) => !pinnedIdSet.has(b.id)).slice(0, remaining);
  return [...pinned, ...fill];
}

async function resolveHybridEvents(row: HomepageRow, marketSlug?: string): Promise<FindmiEvent[]> {
  const pinned = await getEventsByIds(row.pinned_ids);
  const remaining = Math.max(0, row.item_limit - pinned.length);
  if (remaining === 0) return pinned;
  const pinnedIdSet = new Set(row.pinned_ids);
  const auto = await getEventsDiscovery({
    when: row.time_window ?? "anytime",
    categorySlug: row.category_slug ?? undefined,
    limit: row.item_limit,
    marketSlug,
  });
  const fill = auto.filter((e) => !pinnedIdSet.has(e.id)).slice(0, remaining);
  return [...pinned, ...fill];
}

async function resolveHybridProducts(row: HomepageRow): Promise<FeaturedProduct[]> {
  const pinned = await getProductsByIds(row.pinned_ids);
  const remaining = Math.max(0, row.item_limit - pinned.length);
  if (remaining === 0) return pinned;
  const pinnedIdSet = new Set(row.pinned_ids);
  const auto = await getHomepageRowProducts({
    categorySlug: row.category_slug ?? undefined,
    featuredOnly: row.featured_only,
    limit: row.item_limit,
  });
  const fill = auto.filter((p) => !pinnedIdSet.has(p.id)).slice(0, remaining);
  return [...pinned, ...fill];
}
