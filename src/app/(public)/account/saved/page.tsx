import type { Metadata } from "next";
import { formatEventRange } from "@/lib/event-time";
import Link from "next/link";
import { redirect } from "next/navigation";
import BusinessCard from "@/components/BusinessCard";
import CompactCard from "@/components/CompactCard";
import ProductCard from "@/components/ProductCard";
import LocationCard from "@/components/LocationCard";
import { getServerSupabase } from "@/lib/supabase/server";
import { cityState } from "@/lib/format";
import { PUBLIC_BUSINESS_COLUMNS, PUBLIC_PRODUCT_COLUMNS, type LocationWithCategory } from "@/lib/data";
import type { BusinessWithCategories, FindmiEvent, Product } from "@/lib/types";
import { getPersonalDisplayName } from "@/lib/personalGraph";
import PersonalAppShell from "../PersonalAppShell";
import { COLLECTION_ENTITY_TYPES, SAVED_COLLECTIONS, collectionCounts, collectionMembers, parseCollection, withCanonicalProductWants, type RelationRow } from "@/lib/save-organization";
import { getAccountWantedProductIds } from "@/lib/product-wants";
import { annotateMarketplaceEligibility } from "@/lib/commerce/marketplace-readiness-server";

export const metadata: Metadata = {
  title: "Saved",
  robots: { index: false },
};
// Authenticated, per-user content — must never be statically or
// ISR-cached; every response here is specific to whoever is signed in.
export const dynamic = "force-dynamic";

type SavedProduct = Product & {
  business: { name: string; slug: string; logo_url: string | null; commerce_enabled: boolean; is_demo?: boolean; publication_status?: string } | null;
};

/** Account-backed Saved — every visitor here is already authenticated
 * (middleware gates all of /account/*), so unlike the public /saved page
 * this reads directly from account_saved_businesses/events/products
 * (RLS-scoped to auth.uid()) instead of localStorage + /api/saved. Public
 * Save controls (SaveButton/EventSaveButton/ProductSaveButton, via
 * lib/useAccountSaved.ts) write to these same tables once a visitor is
 * signed in, so what shows here is exactly what those buttons show as
 * saved everywhere else. */
export default async function AccountSavedPage({ searchParams }: { searchParams: Promise<{ collection?: string }> }) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/saved");
  const collection = parseCollection((await searchParams).collection);

  // Save rows + the viewer's own classifications (Save organization), all
  // RLS-scoped to this user, in one parallel batch.
  const [{ data: savedBizRows }, { data: savedEventRows }, { data: savedProductRows }, { data: savedLocationRows }, { data: relationRows }, wantedProductIds, displayName] =
    await Promise.all([
      supabase.from("account_saved_businesses").select("business_id").eq("user_id", user.id),
      supabase.from("account_saved_events").select("event_id").eq("user_id", user.id),
      supabase.from("account_saved_products").select("product_id").eq("user_id", user.id),
      // account_saved_locations: the public LocationSaveButton writes here.
      supabase.from("account_saved_locations").select("location_id").eq("user_id", user.id),
      supabase.from("user_entity_relationships").select("entity_type, entity_id, relation").eq("user_id", user.id).in("entity_type", [...COLLECTION_ENTITY_TYPES]),
      // Things I Want's Products: the canonical Product Want relationship.
      getAccountWantedProductIds(supabase, user.id),
      getPersonalDisplayName(supabase, user.id),
    ]);
  const saved = {
    business: ((savedBizRows ?? []) as { business_id: string }[]).map((r) => r.business_id),
    event: ((savedEventRows ?? []) as { event_id: string }[]).map((r) => r.event_id),
    product: ((savedProductRows ?? []) as { product_id: string }[]).map((r) => r.product_id),
    location: ((savedLocationRows ?? []) as { location_id: string }[]).map((r) => r.location_id),
  };
  const relations = withCanonicalProductWants((relationRows ?? []) as RelationRow[], wantedProductIds);
  // A collection is its classification rows — never dependent on a Save
  // row still existing (Have / Been are history). "All" adds every Save.
  const members = collectionMembers(collection, relations, saved);
  const counts = collectionCounts(relations, saved);
  const businessIds = collection === "all" ? saved.business : [];

  const none = Promise.resolve({ data: [] as never[] });
  const [{ data: businessRows }, { data: eventRows }, { data: productRows }, { data: locationRows }] = await Promise.all([
    businessIds.length ? supabase.from("businesses").select(PUBLIC_BUSINESS_COLUMNS).in("id", businessIds) : none,
    members.event.length ? supabase.from("events").select("*").in("id", members.event) : none,
    members.product.length
      ? supabase.from("products").select(`${PUBLIC_PRODUCT_COLUMNS}, business:businesses(name, slug, logo_url, commerce_enabled, is_demo, publication_status)`).in("id", members.product)
      : none,
    members.location.length ? supabase.from("locations").select("*, category:categories(id, name, slug)").in("id", members.location) : none,
  ]);

  const businesses = ((businessRows ?? []) as unknown as (BusinessWithCategories | null)[])
    .filter((b): b is BusinessWithCategories => Boolean(b))
    .map((b) => ({ ...b, categories: [] }));
  const events = (eventRows ?? []) as unknown as FindmiEvent[];
  // Each card shows commerce UI only when the canonical Marketplace rule
  // says the Product is genuinely buyable.
  const products = await annotateMarketplaceEligibility(
    supabase,
    ((productRows ?? []) as unknown as (SavedProduct & { business: SavedProduct["business"] | SavedProduct["business"][] })[]).map((p) => ({
      ...p,
      business: Array.isArray(p.business) ? (p.business[0] ?? null) : p.business,
    })),
    (p) => p.business
  );
  const locations = (locationRows ?? []) as unknown as LocationWithCategory[];
  const current = SAVED_COLLECTIONS.find((c) => c.key === collection)!;

  const empty = businesses.length === 0 && events.length === 0 && products.length === 0 && locations.length === 0;

  return (
    <PersonalAppShell displayName={displayName}>
      <h1 className="font-display text-page-title font-bold text-primary">Saved</h1>
      <p className="mt-1.5 text-body text-muted">Businesses, events, products, and locations you&rsquo;ve saved to your account.</p>

      {/* Personal collections — only lists that hold something (plus All). */}
      <nav aria-label="Saved lists" className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SAVED_COLLECTIONS.filter((c) => c.key === "all" || counts[c.key] > 0 || c.key === collection).map((c) => {
          const active = c.key === collection;
          return (
            <Link
              key={c.key}
              href={c.key === "all" ? "/account/saved" : `/account/saved?collection=${c.key}`}
              aria-current={active ? "page" : undefined}
              className={`h-8 shrink-0 rounded-full px-3.5 text-metadata font-semibold leading-8 ${active ? "bg-findmi-600 text-white" : "border border-black/10 bg-white text-ink/65 hover:text-ink"}`}
            >
              {c.label} · {counts[c.key]}
            </Link>
          );
        })}
      </nav>

      {empty ? (
        <div className="mt-8 rounded-3xl border border-black/5 bg-white p-6 text-center shadow-sm">
          <p className="text-body font-semibold text-primary">{collection === "all" ? "Nothing saved yet" : `Nothing in ${current.label} yet`}</p>
          <p className="mt-1 text-body text-muted">
            <Link href="/discover" className="font-medium text-accent underline underline-offset-2">
              Start exploring
            </Link>{" "}
            and tap the bookmark on anything you want to come back to.
          </p>
        </div>
      ) : (
        <>
          {businesses.length > 0 && (
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {businesses.map((b) => (
                <BusinessCard key={b.id} business={b} />
              ))}
            </div>
          )}

          {events.length > 0 && (
            <div className="mt-10">
              <h2 className="font-display text-section-title font-semibold text-primary">Events</h2>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {events.map((e) => (
                  <CompactCard
                    key={e.id}
                    href={`/event/${e.slug}`}
                    image={e.cover_image_url}
                    title={e.name}
                    meta={[formatEventRange(e), cityState(e.city, e.state)]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                ))}
              </div>
            </div>
          )}

          {products.length > 0 && (
            <div className="mt-10">
              <h2 className="font-display text-section-title font-semibold text-primary">Products</h2>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {products.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            </div>
          )}

          {locations.length > 0 && (
            <div className="mt-10">
              <h2 className="font-display text-section-title font-semibold text-primary">Locations</h2>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {locations.map((l) => (
                  <LocationCard key={l.id} location={l} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </PersonalAppShell>
  );
}
