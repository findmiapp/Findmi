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
import { COLLECTION_ENTITY_TYPES, SAVED_COLLECTIONS, collectionCounts, collectionMembers, parseCollection, withCanonicalProductWants, type LibraryEntityType, type RelationRow } from "@/lib/save-organization";
import { getAccountWantedProductIds } from "@/lib/product-wants";
import { annotateMarketplaceEligibility } from "@/lib/commerce/marketplace-readiness-server";
import { getCollectionMembers, listCollections } from "@/lib/collections";
import CollectionActions from "./CollectionActions";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Personal Library — the ONE signed-in library (signed-in /saved and
 * /my-world route here). Everything reads the account, RLS-scoped to the
 * viewer:
 *   Relationships  product_wants (Things I Want) + user_entity_relationships
 *   Saves          account_saved_* (plain bookmarks)
 *   Following      account_followed_*
 *   Collections    user_collections (optional organization; hidden until
 *                  that migration exists)
 * Filters (?collection=) show one slice; a Collection (?list=<id>) shows
 * its items. One grid per entity type, never one giant stacked page of
 * every section. */
export default async function AccountSavedPage({ searchParams }: { searchParams: Promise<{ collection?: string; list?: string }> }) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/saved");
  const sp = await searchParams;
  const listId = typeof sp.list === "string" && UUID.test(sp.list) ? sp.list : null;
  const collection = parseCollection(sp.collection);

  const [
    { data: savedBizRows },
    { data: savedEventRows },
    { data: savedProductRows },
    { data: savedLocationRows },
    { data: followedBizRows },
    { data: followedEventRows },
    { data: followedLocationRows },
    { data: relationRows },
    wantedProductIds,
    collectionsResult,
    openList,
    displayName,
  ] = await Promise.all([
    supabase.from("account_saved_businesses").select("business_id").eq("user_id", user.id),
    supabase.from("account_saved_events").select("event_id").eq("user_id", user.id),
    supabase.from("account_saved_products").select("product_id").eq("user_id", user.id),
    supabase.from("account_saved_locations").select("location_id").eq("user_id", user.id),
    supabase.from("account_followed_businesses").select("business_id").eq("user_id", user.id),
    supabase.from("account_followed_events").select("event_id").eq("user_id", user.id),
    supabase.from("account_followed_locations").select("location_id").eq("user_id", user.id),
    supabase.from("user_entity_relationships").select("entity_type, entity_id, relation").eq("user_id", user.id).in("entity_type", [...COLLECTION_ENTITY_TYPES]),
    // Things I Want's Products: the canonical Product Want relationship.
    getAccountWantedProductIds(supabase, user.id),
    listCollections(supabase, user.id),
    listId ? getCollectionMembers(supabase, user.id, listId) : Promise.resolve(null),
    getPersonalDisplayName(supabase, user.id),
  ]);
  const ids = <K extends string>(rows: unknown, col: K) => ((rows ?? []) as Record<K, string>[]).map((r) => r[col]);
  const saved = {
    business: ids(savedBizRows, "business_id"),
    event: ids(savedEventRows, "event_id"),
    product: ids(savedProductRows, "product_id"),
    location: ids(savedLocationRows, "location_id"),
  };
  const followed = {
    business: ids(followedBizRows, "business_id"),
    event: ids(followedEventRows, "event_id"),
    location: ids(followedLocationRows, "location_id"),
  };
  const relations = withCanonicalProductWants((relationRows ?? []) as RelationRow[], wantedProductIds);
  const counts = collectionCounts(relations, saved, followed);
  const members: Record<LibraryEntityType, string[]> = openList ? openList.members : collectionMembers(collection, relations, saved, followed);

  const none = Promise.resolve({ data: [] as never[] });
  const [{ data: businessRows }, { data: eventRows }, { data: productRows }, { data: locationRows }] = await Promise.all([
    members.business.length ? supabase.from("businesses").select(PUBLIC_BUSINESS_COLUMNS).in("id", members.business) : none,
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
  const heading = openList ? openList.name : current.label;
  const empty = businesses.length === 0 && events.length === 0 && products.length === 0 && locations.length === 0;
  const chip = (active: boolean) =>
    `h-8 shrink-0 rounded-full px-3.5 text-metadata font-semibold leading-8 ${active ? "bg-findmi-600 text-white" : "border border-black/10 bg-white text-ink/65 hover:text-ink"}`;

  return (
    <PersonalAppShell displayName={displayName}>
      <h1 className="font-display text-page-title font-bold text-primary">Saved</h1>
      <p className="mt-1.5 text-body text-muted">What you want, what you&rsquo;ve saved, who you follow, and how you&rsquo;ve organized it.</p>

      {/* Library filters — only ones that hold something (plus All and the
          current one). */}
      <nav aria-label="Saved filters" className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SAVED_COLLECTIONS.filter((c) => c.key === "all" || counts[c.key] > 0 || (!openList && c.key === collection)).map((c) => {
          const active = !openList && c.key === collection;
          return (
            <Link key={c.key} href={c.key === "all" ? "/account/saved" : `/account/saved?collection=${c.key}`} aria-current={active ? "page" : undefined} className={chip(active)}>
              {c.label} · {counts[c.key]}
            </Link>
          );
        })}
      </nav>

      {/* Collections — the person's own organization, separate from the
          filters above. Hidden until Collections exist (or are available). */}
      {collectionsResult.available && collectionsResult.collections.length > 0 && (
        <section aria-label="Collections" className="mt-4">
          <p className="text-label font-semibold uppercase text-subtle">Collections</p>
          <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {collectionsResult.collections.map((c) => (
              <Link key={c.id} href={`/account/saved?list=${c.id}`} aria-current={listId === c.id ? "page" : undefined} className={`${chip(listId === c.id)} max-w-[14rem] truncate`}>
                {c.name} · {c.itemCount}
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        <h2 className="font-display text-section-title font-semibold text-primary">{heading}</h2>
        {openList && listId && <CollectionActions collectionId={listId} name={openList.name} />}
      </div>

      {empty ? (
        <div className="mt-4 rounded-3xl border border-black/5 bg-white p-6 text-center shadow-sm">
          <p className="text-body font-semibold text-primary">{openList ? "This Collection is empty" : collection === "all" ? "Nothing saved yet" : `Nothing in ${current.label} yet`}</p>
          <p className="mt-1 text-body text-muted">
            {openList ? (
              "Add things to it from the Want or Save sheet."
            ) : (
              <>
                <Link href="/discover" className="font-medium text-accent underline underline-offset-2">
                  Start exploring
                </Link>{" "}
                — Want, Save or Follow anything you want to come back to.
              </>
            )}
          </p>
        </div>
      ) : (
        <>
          {products.length > 0 && (
            <LibrarySection title="Products">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </LibrarySection>
          )}
          {events.length > 0 && (
            <LibrarySection title="Events">
              {events.map((e) => (
                <CompactCard key={e.id} href={`/event/${e.slug}`} image={e.cover_image_url} title={e.name} meta={[formatEventRange(e), cityState(e.city, e.state)].filter(Boolean).join(" · ")} />
              ))}
            </LibrarySection>
          )}
          {locations.length > 0 && (
            <LibrarySection title="Places">
              {locations.map((l) => (
                <LocationCard key={l.id} location={l} />
              ))}
            </LibrarySection>
          )}
          {businesses.length > 0 && (
            <LibrarySection title="Businesses">
              {businesses.map((b) => (
                <BusinessCard key={b.id} business={b} />
              ))}
            </LibrarySection>
          )}
        </>
      )}
    </PersonalAppShell>
  );
}

function LibrarySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="text-label font-semibold uppercase text-subtle">{title}</h3>
      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">{children}</div>
    </section>
  );
}
