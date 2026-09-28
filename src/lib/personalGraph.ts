import type { SupabaseClient } from "@supabase/supabase-js";

// Universal Account V1 foundation — one shared, lightweight read of a
// signed-in person's durable account relationships (account_saved_*/
// account_followed_*), reused by both /account's Home (Personal Upcoming
// input + Personal Collections teaser) and, in principle, any future
// caller that only needs compact display fields (id/slug/name/image/
// start-end) rather than a full public-page entity object. /my-world's
// own authenticated read is intentionally separate (see
// /api/account/world/route.ts) — that page reuses existing card
// components (ProductCard/BusinessCard/LocationCard/CompactCard) that
// expect the FULL public entity shape those components already render
// elsewhere, so it fetches full rows via the same column constants
// /api/saved already uses rather than this slim shape.
//
// Every query here goes through the session-scoped client (RLS
// auth.uid() = user_id on every account_saved_*/account_followed_* table
// — see the Phase 0 audit), never the admin client: reading a person's
// own saved/followed rows needs no elevation.

export interface PersonalEntityRef {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
}
export interface PersonalEventRef extends PersonalEntityRef {
  startAt: string;
  endAt: string | null;
}

export interface PersonalGraphSummary {
  savedBusinesses: PersonalEntityRef[];
  savedProducts: PersonalEntityRef[];
  savedEvents: PersonalEventRef[];
  savedLocations: PersonalEntityRef[];
  followedBusinesses: PersonalEntityRef[];
  followedEvents: PersonalEventRef[];
  followedLocations: PersonalEntityRef[];
}

type Embedded<T> = T | T[] | null;
function one<T>(v: Embedded<T>): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

interface BusinessEmbed {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  cover_image_url: string | null;
}
interface ProductEmbed {
  id: string;
  slug: string;
  name: string;
  image_url: string | null;
}
interface EventEmbed {
  id: string;
  slug: string;
  name: string;
  start_at: string;
  end_at: string | null;
  cover_image_url: string | null;
}
interface LocationEmbed {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  cover_image_url: string | null;
}

/** A person's real, durable account-bound Saves/Follows — the empty
 * result for every category is a genuinely empty array (a signed-in
 * visitor with nothing saved/followed yet gets back all-empty arrays,
 * never an error), matching the same "truthful, no fabricated data"
 * contract the rest of this pass follows. */
export async function getPersonalGraphSummary(supabase: SupabaseClient, userId: string): Promise<PersonalGraphSummary> {
  const [savedBiz, savedProd, savedEvt, savedLoc, followedBiz, followedEvt, followedLoc] = await Promise.all([
    supabase
      .from("account_saved_businesses")
      .select("business:businesses(id, slug, name, logo_url, cover_image_url)")
      .eq("user_id", userId),
    supabase.from("account_saved_products").select("product:products(id, slug, name, image_url)").eq("user_id", userId),
    supabase
      .from("account_saved_events")
      .select("event:events(id, slug, name, start_at, end_at, cover_image_url)")
      .eq("user_id", userId),
    supabase
      .from("account_saved_locations")
      .select("location:locations(id, slug, name, logo_url, cover_image_url)")
      .eq("user_id", userId),
    supabase
      .from("account_followed_businesses")
      .select("business:businesses(id, slug, name, logo_url, cover_image_url)")
      .eq("user_id", userId),
    supabase
      .from("account_followed_events")
      .select("event:events(id, slug, name, start_at, end_at, cover_image_url)")
      .eq("user_id", userId),
    supabase
      .from("account_followed_locations")
      .select("location:locations(id, slug, name, logo_url, cover_image_url)")
      .eq("user_id", userId),
  ]);

  const businesses = (rows: { business: Embedded<BusinessEmbed> }[] | null): PersonalEntityRef[] =>
    ((rows ?? []) as { business: Embedded<BusinessEmbed> }[])
      .map((r) => one(r.business))
      .filter((b): b is BusinessEmbed => Boolean(b))
      .map((b) => ({ id: b.id, slug: b.slug, name: b.name, imageUrl: b.logo_url ?? b.cover_image_url }));

  const locations = (rows: { location: Embedded<LocationEmbed> }[] | null): PersonalEntityRef[] =>
    ((rows ?? []) as { location: Embedded<LocationEmbed> }[])
      .map((r) => one(r.location))
      .filter((l): l is LocationEmbed => Boolean(l))
      .map((l) => ({ id: l.id, slug: l.slug, name: l.name, imageUrl: l.logo_url ?? l.cover_image_url }));

  const events = (rows: { event: Embedded<EventEmbed> }[] | null): PersonalEventRef[] =>
    ((rows ?? []) as { event: Embedded<EventEmbed> }[])
      .map((r) => one(r.event))
      .filter((e): e is EventEmbed => Boolean(e))
      .map((e) => ({ id: e.id, slug: e.slug, name: e.name, imageUrl: e.cover_image_url, startAt: e.start_at, endAt: e.end_at }));

  const products = ((savedProd.data ?? []) as { product: Embedded<ProductEmbed> }[])
    .map((r) => one(r.product))
    .filter((p): p is ProductEmbed => Boolean(p))
    .map((p) => ({ id: p.id, slug: p.slug, name: p.name, imageUrl: p.image_url }));

  return {
    savedBusinesses: businesses(savedBiz.data as { business: Embedded<BusinessEmbed> }[] | null),
    savedProducts: products,
    savedEvents: events(savedEvt.data as { event: Embedded<EventEmbed> }[] | null),
    savedLocations: locations(savedLoc.data as { location: Embedded<LocationEmbed> }[] | null),
    followedBusinesses: businesses(followedBiz.data as { business: Embedded<BusinessEmbed> }[] | null),
    followedEvents: events(followedEvt.data as { event: Embedded<EventEmbed> }[] | null),
    followedLocations: locations(followedLoc.data as { location: Embedded<LocationEmbed> }[] | null),
  };
}
