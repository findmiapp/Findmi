import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import BusinessCard from "@/components/BusinessCard";
import CompactCard from "@/components/CompactCard";
import ProductCard from "@/components/ProductCard";
import { getServerSupabase } from "@/lib/supabase/server";
import { cityState, formatDateRange } from "@/lib/format";
import { PUBLIC_BUSINESS_COLUMNS, PUBLIC_PRODUCT_COLUMNS } from "@/lib/data";
import type { BusinessWithCategories, FindmiEvent, Product } from "@/lib/types";
import AccountNav from "../AccountNav";

export const metadata: Metadata = {
  title: "Saved",
  robots: { index: false },
};
// Authenticated, per-user content — must never be statically or
// ISR-cached; every response here is specific to whoever is signed in.
export const dynamic = "force-dynamic";

type SavedProduct = Product & {
  business: { name: string; slug: string; logo_url: string | null; commerce_enabled: boolean } | null;
};

/** Account-backed Saved — every visitor here is already authenticated
 * (middleware gates all of /account/*), so unlike the public /saved page
 * this reads directly from account_saved_businesses/events/products
 * (RLS-scoped to auth.uid()) instead of localStorage + /api/saved. Public
 * Save controls (SaveButton/EventSaveButton/ProductSaveButton, via
 * lib/useAccountSaved.ts) write to these same tables once a visitor is
 * signed in, so what shows here is exactly what those buttons show as
 * saved everywhere else. */
export default async function AccountSavedPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/saved");

  const [{ data: savedBusinesses }, { data: savedEvents }, { data: savedProducts }] = await Promise.all([
    supabase.from("account_saved_businesses").select(`business:businesses(${PUBLIC_BUSINESS_COLUMNS})`).eq("user_id", user.id),
    supabase.from("account_saved_events").select("event:events(*)").eq("user_id", user.id),
    supabase
      .from("account_saved_products")
      .select(`product:products(${PUBLIC_PRODUCT_COLUMNS}, business:businesses(name, slug, logo_url, commerce_enabled))`)
      .eq("user_id", user.id),
  ]);

  const businesses = ((savedBusinesses ?? []) as unknown as { business: BusinessWithCategories | null }[])
    .map((row) => row.business)
    .filter((b): b is BusinessWithCategories => Boolean(b))
    .map((b) => ({ ...b, categories: [] }));

  const events = ((savedEvents ?? []) as unknown as { event: FindmiEvent | null }[])
    .map((row) => row.event)
    .filter((e): e is FindmiEvent => Boolean(e));

  const products = ((savedProducts ?? []) as unknown as { product: SavedProduct | null }[])
    .map((row) => row.product)
    .filter((p): p is SavedProduct => Boolean(p));

  const empty = businesses.length === 0 && events.length === 0 && products.length === 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Saved</h1>
      <p className="mt-1.5 text-sm text-ink/50">Businesses, events, and products you&rsquo;ve saved to your account.</p>

      {empty ? (
        <div className="mt-8 rounded-3xl border border-black/5 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-ink">Nothing saved yet</p>
          <p className="mt-1 text-sm text-ink/50">
            <Link href="/discover" className="font-medium text-findmi-700 underline underline-offset-2">
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
              <h2 className="text-base font-semibold tracking-tight text-ink">Events</h2>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {events.map((e) => (
                  <CompactCard
                    key={e.id}
                    href={`/event/${e.slug}`}
                    image={e.cover_image_url}
                    title={e.name}
                    meta={[formatDateRange(e.start_at, e.end_at), cityState(e.city, e.state)]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                ))}
              </div>
            </div>
          )}

          {products.length > 0 && (
            <div className="mt-10">
              <h2 className="text-base font-semibold tracking-tight text-ink">Products</h2>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {products.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
