// Founder homepage feed builder — data layer. See migration
// create_homepage_rows. Unlike site_sections (a fixed set of TypeScript-
// defined keys — see lib/site-sections.ts), homepage_rows is a real,
// founder-managed LIST: rows can be created, renamed, reordered, hidden,
// and deleted from /admin without a code change. This file owns: the
// admin (all rows) and public (visible rows only) fetches, and the single
// dispatcher that turns one row's configuration into real content by
// calling the same query functions every other part of the app already
// uses (lib/data.ts) — never a parallel content system.
import { getSupabase } from "./supabase";
import { getAdminSupabase } from "./admin/supabase-admin";
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
import type { BusinessWithCategories, EventWithCategories } from "./types";

export type HomepageRowContentType = "businesses" | "events" | "products" | "business_showcase";
export type HomepageRowMode = "dynamic" | "curated";
export type HomepageRowTimeWindow = "now" | "weekend" | "anytime";

export interface HomepageRow {
  id: string;
  title: string;
  subtitle: string | null;
  content_type: HomepageRowContentType;
  mode: HomepageRowMode;
  category_slug: string | null;
  featured_only: boolean;
  time_window: HomepageRowTimeWindow | null;
  item_limit: number;
  curated_ids: string[];
  is_visible: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** All rows (visible or not), for the admin Homepage Rows editor — service
 * role, bypasses RLS.
 *
 * Security Pass 4 note: deliberately NOT switched to requireAdminSupabase()
 * — same reasoning as lib/navigation.ts's getAdminNavItems(): this file is
 * shared with public code paths (getSupabase()-based public fetches below),
 * and requireAdminSupabase() transitively importing next/headers risks
 * tainting the whole module for any Client Component that ever imports a
 * type or public helper from here. This function's only caller is the
 * middleware-gated /admin/site/homepage/rows Server Component page
 * (verified — see this pass's report), which remains its protection. */
export async function getAdminHomepageRows(): Promise<HomepageRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase.from("homepage_rows").select("*").order("sort_order", { ascending: true });
  return (data as HomepageRow[]) ?? [];
}

/** Public homepage fetch — visible rows only (RLS enforces this too; the
 * explicit filter here just avoids depending on RLS alone). */
export async function getVisibleHomepageRows(): Promise<HomepageRow[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("homepage_rows")
    .select("*")
    .eq("is_visible", true)
    .order("sort_order", { ascending: true });
  return (data as HomepageRow[]) ?? [];
}

export type ResolvedHomepageRow =
  | { contentType: "businesses"; items: BusinessWithCategories[] }
  | { contentType: "events"; items: EventWithCategories[] }
  | { contentType: "products"; items: FeaturedProduct[] }
  | { contentType: "business_showcase"; items: [] };

/** Turns one row's configuration into real content. Dynamic mode calls the
 * same shared query functions every other feed on the site uses (with the
 * row's own filters); curated mode fetches the founder's hand-picked
 * records, in the order the founder chose (see getBusinessesByIds et al —
 * a deleted/unpublished curated record just drops out, never errors). The
 * business_showcase content type has no queryable content of its own —
 * it's the existing BusinessShowcaseCarousel, just hideable/reorderable
 * through this same row system now instead of a fixed page position.
 *
 * Homepage Market Filtering V1 — `marketSlug` is ONLY ever applied to a
 * DYNAMIC "businesses" row (see getHomepageRowBusinesses). Curated rows
 * are a founder's exact editorial selection — LOCKED V1 policy is that
 * they ignore Market entirely, so `marketSlug` is never passed to
 * getBusinessesByIds, and business_showcase/events/products branches
 * never receive it at all (Market controls general BUSINESS discovery
 * only). */
export async function resolveHomepageRowItems(row: HomepageRow, marketSlug?: string): Promise<ResolvedHomepageRow> {
  if (row.content_type === "business_showcase") {
    return { contentType: "business_showcase", items: [] };
  }

  if (row.content_type === "businesses") {
    const items =
      row.mode === "curated"
        ? await getBusinessesByIds(row.curated_ids)
        : await getHomepageRowBusinesses({
            categorySlug: row.category_slug ?? undefined,
            featuredOnly: row.featured_only,
            limit: row.item_limit,
            marketSlug,
          });
    return { contentType: "businesses", items };
  }

  if (row.content_type === "events") {
    const raw =
      row.mode === "curated"
        ? await getEventsByIds(row.curated_ids)
        : await getEventsDiscovery({
            when: row.time_window ?? "anytime",
            categorySlug: row.category_slug ?? undefined,
            limit: row.item_limit,
          });
    const items = await attachEventCategories(raw);
    return { contentType: "events", items };
  }

  // products
  const items =
    row.mode === "curated"
      ? await getProductsByIds(row.curated_ids)
      : await getHomepageRowProducts({
          categorySlug: row.category_slug ?? undefined,
          featuredOnly: row.featured_only,
          limit: row.item_limit,
        });
  return { contentType: "products", items };
}
