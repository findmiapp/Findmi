import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { PUBLIC_BUSINESS_COLUMNS, PUBLIC_PRODUCT_COLUMNS } from "@/lib/data";
import type { Business, FindmiEvent, Product } from "@/lib/types";

export const dynamic = "force-dynamic";

function parseSlugs(param: string | null): string[] {
  if (!param) return [];
  return param
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);
}

type SavedProductBusiness = { name: string; slug: string; logo_url: string | null; commerce_enabled: boolean } | null;

/**
 * Production regression fix (Sept 1) companion — /saved (lib/saved.ts's
 * localStorage-kept slug lists) used to call Supabase directly from the
 * browser via a "use client" component's useEffect. That was never
 * actually reachable under the CSP's connect-src 'self' (Security Pass
 * 2), which was written on the explicit assumption that Supabase is
 * "only ever called server-side... never from the browser" — this was
 * the one caller that didn't follow that. Rather than loosen the CSP to
 * accommodate it, this route moves the read server-side (the same
 * pattern /api/homepage-search already uses for browser-driven,
 * localStorage/state-dependent lookups): the browser sends its saved
 * slug lists here via an ordinary same-origin fetch, and the actual
 * Supabase reads happen here, using the same public, grant-safe column
 * constants every other public page now uses.
 */
export async function GET(request: NextRequest) {
  const businessSlugs = parseSlugs(request.nextUrl.searchParams.get("business"));
  const eventSlugs = parseSlugs(request.nextUrl.searchParams.get("event"));
  const productSlugs = parseSlugs(request.nextUrl.searchParams.get("product"));

  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ businesses: [], events: [], products: [] });

  const [businessResult, eventResult, productResult] = await Promise.all([
    businessSlugs.length
      ? supabase.from("businesses").select(PUBLIC_BUSINESS_COLUMNS).in("slug", businessSlugs).eq("is_demo", false)
      : Promise.resolve({ data: [] as Business[], error: null }),
    eventSlugs.length
      ? supabase.from("events").select("*").in("slug", eventSlugs).eq("is_demo", false)
      : Promise.resolve({ data: [] as FindmiEvent[], error: null }),
    productSlugs.length
      ? supabase
          .from("products")
          .select(`${PUBLIC_PRODUCT_COLUMNS}, business:businesses(name, slug, logo_url, commerce_enabled)`)
          .in("slug", productSlugs)
          .eq("is_active", true)
      : Promise.resolve({ data: [] as never[], error: null }),
  ]);

  if (businessResult.error) {
    console.error("[api/saved] businesses query failed", { message: businessResult.error.message });
  }
  if (eventResult.error) {
    console.error("[api/saved] events query failed", { message: eventResult.error.message });
  }
  if (productResult.error) {
    console.error("[api/saved] products query failed", { message: productResult.error.message });
  }

  const businesses = ((businessResult.data ?? []) as Business[]).map((b) => ({ ...b, categories: [] }));
  const events = (eventResult.data ?? []) as FindmiEvent[];
  const products = ((productResult.data ?? []) as never[]).map((row: unknown) => {
    const r = row as Product & { business: SavedProductBusiness | SavedProductBusiness[] };
    const business = Array.isArray(r.business) ? (r.business[0] ?? null) : r.business;
    return { ...r, business };
  });

  return NextResponse.json({ businesses, events, products });
}
