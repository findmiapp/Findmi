"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BusinessCard from "@/components/BusinessCard";
import CompactCard from "@/components/CompactCard";
import ProductCard from "@/components/ProductCard";
import { getSupabase } from "@/lib/supabase";
import { getSavedSlugs, getSavedEventSlugs, getSavedProductSlugs } from "@/lib/saved";
import { cityState, formatDateRange } from "@/lib/format";
import type { BusinessWithCategories, FindmiEvent, Product } from "@/lib/types";

type SavedProduct = Product & {
  business: { name: string; slug: string; logo_url: string | null; commerce_enabled: boolean } | null;
};

export default function SavedPage() {
  const [businesses, setBusinesses] = useState<BusinessWithCategories[] | null>(null);
  const [events, setEvents] = useState<FindmiEvent[] | null>(null);
  const [products, setProducts] = useState<SavedProduct[] | null>(null);

  useEffect(() => {
    const supabase = getSupabase();

    const businessSlugs = getSavedSlugs();
    if (businessSlugs.length === 0 || !supabase) {
      setBusinesses([]);
    } else {
      supabase
        .from("businesses")
        .select("*")
        .in("slug", businessSlugs)
        .eq("is_demo", false)
        .then(({ data }) => {
          setBusinesses((data ?? []).map((b) => ({ ...b, categories: [] })));
        });
    }

    const eventSlugs = getSavedEventSlugs();
    if (eventSlugs.length === 0 || !supabase) {
      setEvents([]);
    } else {
      supabase
        .from("events")
        .select("*")
        .in("slug", eventSlugs)
        .eq("is_demo", false)
        .then(({ data }) => {
          setEvents((data as FindmiEvent[]) ?? []);
        });
    }

    const productSlugs = getSavedProductSlugs();
    if (productSlugs.length === 0 || !supabase) {
      setProducts([]);
    } else {
      supabase
        .from("products")
        .select("*, business:businesses(name, slug, logo_url, commerce_enabled)")
        .in("slug", productSlugs)
        .eq("is_active", true)
        .then(({ data }) => {
          const rows = ((data ?? []) as never[]).map((row: unknown) => {
            const r = row as Product & { business: SavedProduct["business"] | SavedProduct["business"][] };
            const business = Array.isArray(r.business) ? (r.business[0] ?? null) : r.business;
            return { ...r, business };
          });
          setProducts(rows);
        });
    }
  }, []);

  const loading = businesses === null || events === null || products === null;
  const empty = !loading && businesses.length === 0 && events.length === 0 && products.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Saved</h1>
      <p className="mt-2 text-ink/60">
        Kept on this device — tap the bookmark on a business, event, or product to save it here.
      </p>

      {loading ? null : empty ? (
        <p className="mt-10 text-sm text-ink/50">
          Nothing saved yet.{" "}
          <Link href="/discover" className="font-medium text-ink underline underline-offset-2">
            Start exploring
          </Link>
          .
        </p>
      ) : (
        <>
          {businesses.length > 0 && (
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {businesses.map((b) => (
                <BusinessCard key={b.id} business={b} />
              ))}
            </div>
          )}

          {events.length > 0 && (
            <div className="mt-10">
              <h2 className="text-lg font-semibold tracking-tight text-ink">Events</h2>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
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
              <h2 className="text-lg font-semibold tracking-tight text-ink">Products</h2>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
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
