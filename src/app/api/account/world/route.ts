import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { PUBLIC_BUSINESS_COLUMNS, PUBLIC_PRODUCT_COLUMNS, normalizeCategoryEmbed, type LocationWithCategory } from "@/lib/data";
import type { Business, FindmiEvent, Product } from "@/lib/types";

export const dynamic = "force-dynamic";

type SavedProductBusiness = { name: string; slug: string; logo_url: string | null; commerce_enabled: boolean } | null;

/** Universal Account V1 foundation — the authenticated sibling of
 * /api/saved/route.ts, for /my-world's account-bound path (Goal 2). Same
 * response shape (businesses/events/products/locations/
 * followedBusinesses), plus followedEvents/followedLocations, but sourced
 * from account_saved_* / account_followed_* (this signed-in user's real,
 * durable relationships — see the Phase 0 audit) instead of resolving
 * client-submitted localStorage slugs. Deliberately mirrors /api/saved's
 * own two-step "resolve ids, then fetch full public-column rows" shape
 * (same PUBLIC_BUSINESS_COLUMNS/PUBLIC_PRODUCT_COLUMNS constants) rather
 * than a single embedded-select query, so this stays on the same proven
 * query pattern /api/saved already uses in production instead of a new,
 * unverified embed shape.
 *
 * RLS-scoped session client throughout — reading this user's own
 * account_saved_* / account_followed_* rows needs no service-role
 * elevation (same reasoning /api/account/save already documents). 401 for
 * a signed-out caller; /my-world only ever calls this after confirming a
 * session via getAccountSession(). */
export async function GET() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [
    { data: savedBizRows },
    { data: savedEventRows },
    { data: savedProductRows },
    { data: savedLocationRows },
    { data: followedBizRows },
    { data: followedEventRows },
    { data: followedLocationRows },
  ] = await Promise.all([
    supabase.from("account_saved_businesses").select("business_id").eq("user_id", user.id),
    supabase.from("account_saved_events").select("event_id").eq("user_id", user.id),
    supabase.from("account_saved_products").select("product_id").eq("user_id", user.id),
    supabase.from("account_saved_locations").select("location_id").eq("user_id", user.id),
    supabase.from("account_followed_businesses").select("business_id").eq("user_id", user.id),
    supabase.from("account_followed_events").select("event_id").eq("user_id", user.id),
    supabase.from("account_followed_locations").select("location_id").eq("user_id", user.id),
  ]);

  const businessIds = ((savedBizRows ?? []) as { business_id: string }[]).map((r) => r.business_id);
  const eventIds = ((savedEventRows ?? []) as { event_id: string }[]).map((r) => r.event_id);
  const productIds = ((savedProductRows ?? []) as { product_id: string }[]).map((r) => r.product_id);
  const locationIds = ((savedLocationRows ?? []) as { location_id: string }[]).map((r) => r.location_id);
  const followedBusinessIds = ((followedBizRows ?? []) as { business_id: string }[]).map((r) => r.business_id);
  const followedEventIds = ((followedEventRows ?? []) as { event_id: string }[]).map((r) => r.event_id);
  const followedLocationIds = ((followedLocationRows ?? []) as { location_id: string }[]).map((r) => r.location_id);

  const [businessResult, eventResult, productResult, locationResult, followedBusinessResult, followedEventResult, followedLocationResult] =
    await Promise.all([
      businessIds.length
        ? supabase.from("businesses").select(PUBLIC_BUSINESS_COLUMNS).in("id", businessIds).eq("is_demo", false)
        : Promise.resolve({ data: [] as Business[], error: null }),
      eventIds.length
        ? supabase.from("events").select("*").in("id", eventIds).eq("is_demo", false)
        : Promise.resolve({ data: [] as FindmiEvent[], error: null }),
      productIds.length
        ? supabase
            .from("products")
            .select(`${PUBLIC_PRODUCT_COLUMNS}, business:businesses(name, slug, logo_url, commerce_enabled)`)
            .in("id", productIds)
            .eq("is_active", true)
        : Promise.resolve({ data: [] as never[], error: null }),
      locationIds.length
        ? supabase.from("locations").select("*, category:categories(id, name, slug)").in("id", locationIds).eq("is_demo", false)
        : Promise.resolve({ data: [] as never[], error: null }),
      followedBusinessIds.length
        ? supabase.from("businesses").select(PUBLIC_BUSINESS_COLUMNS).in("id", followedBusinessIds).eq("is_demo", false)
        : Promise.resolve({ data: [] as Business[], error: null }),
      followedEventIds.length
        ? supabase.from("events").select("*").in("id", followedEventIds).eq("is_demo", false)
        : Promise.resolve({ data: [] as FindmiEvent[], error: null }),
      followedLocationIds.length
        ? supabase.from("locations").select("*, category:categories(id, name, slug)").in("id", followedLocationIds).eq("is_demo", false)
        : Promise.resolve({ data: [] as never[], error: null }),
    ]);

  const businesses = ((businessResult.data ?? []) as Business[]).map((b) => ({ ...b, categories: [] }));
  const events = (eventResult.data ?? []) as FindmiEvent[];
  const products = ((productResult.data ?? []) as never[]).map((row: unknown) => {
    const r = row as Product & { business: SavedProductBusiness | SavedProductBusiness[] };
    const business = Array.isArray(r.business) ? (r.business[0] ?? null) : r.business;
    return { ...r, business };
  });
  const locations = ((locationResult.data ?? []) as (LocationWithCategory & { category: unknown })[]).map((l) => ({
    ...l,
    category: normalizeCategoryEmbed(l.category),
  }));
  const followedBusinesses = ((followedBusinessResult.data ?? []) as Business[]).map((b) => ({ ...b, categories: [] }));
  const followedEvents = (followedEventResult.data ?? []) as FindmiEvent[];
  const followedLocations = ((followedLocationResult.data ?? []) as (LocationWithCategory & { category: unknown })[]).map((l) => ({
    ...l,
    category: normalizeCategoryEmbed(l.category),
  }));

  return NextResponse.json({ businesses, events, products, locations, followedBusinesses, followedEvents, followedLocations });
}
