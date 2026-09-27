"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ProductCard from "@/components/ProductCard";
import BusinessCard from "@/components/BusinessCard";
import LocationCard from "@/components/LocationCard";
import CompactCard from "@/components/CompactCard";
import {
  getSavedSlugs,
  getSavedEventSlugs,
  getSavedProductSlugs,
  getSavedLocationSlugs,
} from "@/lib/saved";
import { getFollowedSlugs } from "@/lib/followed";
import { cityState, formatDateRange } from "@/lib/format";
import type { BusinessWithCategories, FindmiEvent, Product } from "@/lib/types";
import type { LocationWithCategory } from "@/lib/data";

type SavedProduct = Product & {
  business: { name: string; slug: string; logo_url: string | null; commerce_enabled: boolean } | null;
};

type MyWorldData = {
  wantProducts: SavedProduct[];
  wantToDoEvents: FindmiEvent[];
  followingBusinesses: BusinessWithCategories[];
  savedBusinesses: BusinessWithCategories[];
  savedLocations: LocationWithCategory[];
};

/** Consumer Experience V1 — "My World": a minimum, truthful personal
 * collection, not a dashboard. Reads exactly the real, already-persisted
 * per-device lists FindMi already keeps (lib/saved.ts's Saved
 * businesses/events/products/locations, lib/followed.ts's guest-followed
 * businesses) — no new schema, no fabricated DONE/LOVED/journal/photo
 * data. Resolved through the same /api/saved server route the existing
 * /saved page already uses (browser localStorage -> same-origin fetch ->
 * Supabase reads), extended this pass with `location` and
 * `followedBusiness` params rather than a parallel endpoint.
 *
 * Known V1 gap (see this pass's report): once someone is actually signed
 * in, their real Saves/Follows live server-side in the account_saved and
 * account_followed tables — not merged into this page yet.
 * Reading those here too would mean adding an authenticated data path to
 * a page that's deliberately just resolving existing local device state,
 * which this pass treats as a reportable follow-up rather than something
 * to improvise now. */
export default function MyWorldPage() {
  const [data, setData] = useState<MyWorldData | null>(null);

  useEffect(() => {
    const businessSlugs = getSavedSlugs();
    const eventSlugs = getSavedEventSlugs();
    const productSlugs = getSavedProductSlugs();
    const locationSlugs = getSavedLocationSlugs();
    const followedBusinessSlugs = getFollowedSlugs();

    if (
      businessSlugs.length === 0 &&
      eventSlugs.length === 0 &&
      productSlugs.length === 0 &&
      locationSlugs.length === 0 &&
      followedBusinessSlugs.length === 0
    ) {
      setData({ wantProducts: [], wantToDoEvents: [], followingBusinesses: [], savedBusinesses: [], savedLocations: [] });
      return;
    }

    const params = new URLSearchParams();
    if (businessSlugs.length) params.set("business", businessSlugs.join(","));
    if (eventSlugs.length) params.set("event", eventSlugs.join(","));
    if (productSlugs.length) params.set("product", productSlugs.join(","));
    if (locationSlugs.length) params.set("location", locationSlugs.join(","));
    if (followedBusinessSlugs.length) params.set("followedBusiness", followedBusinessSlugs.join(","));

    fetch(`/api/saved?${params.toString()}`)
      .then((res) => res.json())
      .then(
        (result: {
          businesses: BusinessWithCategories[];
          events: FindmiEvent[];
          products: SavedProduct[];
          locations: LocationWithCategory[];
          followedBusinesses: BusinessWithCategories[];
        }) => {
          setData({
            wantProducts: result.products ?? [],
            wantToDoEvents: result.events ?? [],
            followingBusinesses: result.followedBusinesses ?? [],
            savedBusinesses: result.businesses ?? [],
            savedLocations: result.locations ?? [],
          });
        }
      )
      .catch(() => {
        setData({ wantProducts: [], wantToDoEvents: [], followingBusinesses: [], savedBusinesses: [], savedLocations: [] });
      });
  }, []);

  const loading = data === null;
  const empty =
    !loading &&
    data.wantProducts.length === 0 &&
    data.wantToDoEvents.length === 0 &&
    data.followingBusinesses.length === 0 &&
    data.savedBusinesses.length === 0 &&
    data.savedLocations.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Your world</h1>
      <p className="mt-2 max-w-md text-sm text-ink/60">
        Everything you&rsquo;ve wanted, wanted to do, followed, and saved, kept right on this
        device.
      </p>

      {loading ? null : empty ? (
        <p className="mt-10 text-sm text-ink/50">
          Nothing here yet.{" "}
          <Link href="/discover" className="font-medium text-ink underline underline-offset-2">
            Start discovering
          </Link>
          .
        </p>
      ) : (
        <div className="mt-10 flex flex-col gap-12">
          {data.wantProducts.length > 0 && (
            <section>
              <h2 className="text-xs font-bold uppercase tracking-wide text-findmi-700">Want</h2>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {data.wantProducts.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            </section>
          )}

          {data.wantToDoEvents.length > 0 && (
            <section>
              <h2 className="text-xs font-bold uppercase tracking-wide text-findmi-700">Want to do</h2>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {data.wantToDoEvents.map((e) => (
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
            </section>
          )}

          {data.followingBusinesses.length > 0 && (
            <section>
              <h2 className="text-xs font-bold uppercase tracking-wide text-findmi-700">Following</h2>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {data.followingBusinesses.map((b) => (
                  <BusinessCard key={b.id} business={b} />
                ))}
              </div>
            </section>
          )}

          {(data.savedBusinesses.length > 0 || data.savedLocations.length > 0) && (
            <section>
              <h2 className="text-xs font-bold uppercase tracking-wide text-findmi-700">Saved</h2>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {data.savedBusinesses.map((b) => (
                  <BusinessCard key={b.id} business={b} />
                ))}
                {data.savedLocations.map((l) => (
                  <LocationCard key={l.id} location={l} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
