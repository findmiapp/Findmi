import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getBusinessesByIds, getHomepageRowBusinesses } from "@/lib/data";
import type { HomepageRow } from "@/lib/homepage-rows";

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
 */
export async function GET(request: NextRequest) {
  const rowId = request.nextUrl.searchParams.get("rowId");
  const category = request.nextUrl.searchParams.get("category")?.trim() || null;
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

  if (typedRow.mode === "curated") {
    const curated = await getBusinessesByIds(typedRow.curated_ids);
    const filtered = category ? curated.filter((b) => b.categories.some((c) => c.slug === category)) : curated;
    return NextResponse.json({ businesses: filtered });
  }

  const businesses = await getHomepageRowBusinesses({
    categorySlug: category ?? typedRow.category_slug ?? undefined,
    featuredOnly: typedRow.featured_only,
    limit: typedRow.item_limit,
  });
  return NextResponse.json({ businesses });
}
