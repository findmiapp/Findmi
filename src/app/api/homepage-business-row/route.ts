import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import {
  filterBusinessesWithUpcomingAppearance,
  getBusinessesByIds,
  getBusinessGalleryImagesMap,
  getHomepageRowBusinesses,
  getUpcomingAppearanceCounts,
  getUpcomingAppearanceHints,
} from "@/lib/data";
import { isPrimaryBusinessesRow, type HomepageRow } from "@/lib/homepage-rows";

export const dynamic = "force-dynamic";

/**
 * Live business-category filter for a "businesses" Homepage Row (e.g.
 * Brands We Love) — Part 11/12 of the live-QA pass. Same pattern as
 * /api/homepage-events: the default (no category selected) case is
 * already server-rendered on page load, this only gets called once a
 * category chip is picked, and it reuses the exact same query functions
 * the row's own initial render used — never a parallel search index.
 *
 * Curated rows stay curated: filtering narrows WITHIN the founder's
 * chosen business set (checked against each business's real categories,
 * already attached by getBusinessesByIds), it never expands out to the
 * global businesses table. Dynamic rows re-query normally, with the
 * picked category overriding the row's own configured category (if any)
 * — combining two single-category filters would almost always yield
 * nothing, since a business typically carries one category.
 *
 * Homepage Market Filtering V1 — optional `market` query param, forwarded
 * into getHomepageRowBusinesses for a DYNAMIC row only. A curated row's
 * `mode === "curated"` branch never reads it at all — curated rows ignore
 * Market entirely (LOCKED V1 policy, same as the initial server render).
 */
export async function GET(request: NextRequest) {
  const rowId = request.nextUrl.searchParams.get("rowId");
  const category = request.nextUrl.searchParams.get("category")?.trim() || null;
  const marketSlug = request.nextUrl.searchParams.get("market")?.trim() || undefined;
  if (!rowId) return NextResponse.json({ error: "rowId is required" }, { status: 400 });

  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ businesses: [] });

  const { data: row } = await supabase
    .from("homepage_rows")
    .select("*")
    .eq("id", rowId)
    .eq("is_visible", true)
    .eq("content_type", "businesses")
    .maybeSingle();
  if (!row) return NextResponse.json({ businesses: [] });

  const typedRow = row as HomepageRow;
  // Homepage Appearance Eligibility pass — same rule as the initial
  // server render (page.tsx): only the homepage's PRIMARY businesses row
  // requires a qualifying current/upcoming Appearance. Re-derived here
  // (rather than trusting a client-supplied flag) via the identical
  // "first visible top-level businesses row" predicate, so this can never
  // be requested out of sync with what actually rendered.
  const requireUpcomingAppearance = await isPrimaryBusinessesRow(typedRow);

  if (typedRow.mode === "curated") {
    const curated = await getBusinessesByIds(typedRow.curated_ids);
    const eligible = requireUpcomingAppearance ? await filterBusinessesWithUpcomingAppearance(curated) : curated;
    const filtered = category ? eligible.filter((b) => b.categories.some((c) => c.slug === category)) : eligible;
    const filteredIds = filtered.map((b) => b.id);
    const [appearanceHintsMap, appearanceCountsMap, galleriesMap] = await Promise.all([
      getUpcomingAppearanceHints(filteredIds),
      getUpcomingAppearanceCounts(filteredIds),
      getBusinessGalleryImagesMap(filteredIds),
    ]);
    return NextResponse.json({
      businesses: filtered,
      appearanceHints: Object.fromEntries(appearanceHintsMap),
      appearanceCounts: Object.fromEntries(appearanceCountsMap),
      businessGalleries: Object.fromEntries(galleriesMap),
    });
  }

  const businesses = await getHomepageRowBusinesses({
    categorySlug: category ?? typedRow.category_slug ?? undefined,
    featuredOnly: typedRow.featured_only,
    limit: typedRow.item_limit,
    marketSlug,
    requireUpcomingAppearance,
  });
  // Bulk-fetched here too (not per card) so BusinessLogoCard's appearance
  // module keeps working after a live category-chip re-fetch, not just on
  // the initial server-rendered load (visual polish pass item 2).
  // Gallery-Image Fallback experiment — same bulk-fetched-once discipline.
  const businessIds = businesses.map((b) => b.id);
  const [appearanceHintsMap, appearanceCountsMap, galleriesMap] = await Promise.all([
    getUpcomingAppearanceHints(businessIds),
    getUpcomingAppearanceCounts(businessIds),
    getBusinessGalleryImagesMap(businessIds),
  ]);
  return NextResponse.json({
    businesses,
    appearanceHints: Object.fromEntries(appearanceHintsMap),
    appearanceCounts: Object.fromEntries(appearanceCountsMap),
    businessGalleries: Object.fromEntries(galleriesMap),
  });
}
