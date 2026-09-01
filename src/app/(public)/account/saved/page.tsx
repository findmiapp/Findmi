"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BusinessCard from "@/components/BusinessCard";
import CompactCard from "@/components/CompactCard";
import ProductCard from "@/components/ProductCard";
import { getSavedSlugs, getSavedEventSlugs, getSavedProductSlugs } from "@/lib/saved";
import { cityState, formatDateRange } from "@/lib/format";
import type { BusinessWithCategories, FindmiEvent, Product } from "@/lib/types";
import AccountNav from "../AccountNav";

type SavedProduct = Product & {
  business: { name: string; slug: string; logo_url: string | null; commerce_enabled: boolean } | null;
};

/** Same per-device saved list and /api/saved lookup the public /saved page
 * uses (see that page/route) — reused here, not re-architected, just
 * presented inside the account shell. Saved items still aren't tied to
 * the signed-in account; the copy below stays honest about that. */
export default function AccountSavedPage() {
  const [businesses, setBusinesses] = useState<BusinessWithCategories[] | null>(null);
  const [events, setEvents] = useState<FindmiEvent[] | null>(null);
  const [products, setProducts] = useState<SavedProduct[] | null>(null);

  useEffect(() => {
    const businessSlugs = getSavedSlugs();
    const eventSlugs = getSavedEventSlugs();
    const productSlugs = getSavedProductSlugs();

    if (businessSlugs.length === 0 && eventSlugs.length === 0 && productSlugs.length === 0) {
      setBusinesses([]);
      setEvents([]);
      setProducts([]);
      return;
    }

    const params = new URLSearchParams();
    if (businessSlugs.length) params.set("business", businessSlugs.join(","));
    if (eventSlugs.length) params.set("event", eventSlugs.join(","));
    if (productSlugs.length) params.set("product", productSlugs.join(","));

    fetch(`/api/saved?${params.toString()}`)
      .then((res) => res.json())
      .then((data: { businesses: BusinessWithCategories[]; events: FindmiEvent[]; products: SavedProduct[] }) => {
        setBusinesses(data.businesses ?? []);
        setEvents(data.events ?? []);
        setProducts(data.products ?? []);
      })
      .catch(() => {
        setBusinesses([]);
        setEvents([]);
        setProducts([]);
      });
  }, []);

  const loading = businesses === null || events === null || products === null;
  const empty = !loading && businesses.length === 0 && events.length === 0 && products.length === 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Saved</h1>
      <p className="mt-1.5 text-sm text-ink/50">
        Kept on this device — tap the bookmark on a business, event, or product to save it here.
      </p>

      {loading ? null : empty ? (
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
