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
import { getAccountSession } from "@/lib/accountSession";
import { syncLocalToAccountOnce } from "@/lib/accountSync";
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
  followingEvents: FindmiEvent[];
  followingLocations: LocationWithCategory[];
  savedBusinesses: BusinessWithCategories[];
  savedLocations: LocationWithCategory[];
};

const EMPTY: MyWorldData = {
  wantProducts: [],
  wantToDoEvents: [],
  followingBusinesses: [],
  followingEvents: [],
  followingLocations: [],
  savedBusinesses: [],
  savedLocations: [],
};

/** Consumer Experience V1 — "My World": a minimum, truthful personal
 * collection, not a dashboard.
 *
 * Universal Account V1 foundation (Goal 2) — closes this page's own
 * previously-documented gap: for a signed-in visitor, real Saves/Follows
 * live server-side in the account_saved_* / account_followed_* tables
 * (see the Phase 0 audit), so this now reads THOSE via /api/account/world once
 * a session is confirmed — the account becomes authoritative, same
 * "guest localStorage, then account once signed in" rule every Save/
 * Follow control on the site already follows (useAccountSaved). Also
 * fires the same one-time local->account sync this page previously never
 * triggered (it lives outside /account/*, so AccountNav/AccountSync never
 * ran here) — the smallest safe fix for a newly-authenticated visitor who
 * reaches /my-world without ever visiting /account first: without it,
 * this page could show an emptier World than the visitor's own device
 * actually has, until they happened to hit an /account/* page once.
 *
 * A signed-OUT visitor's behavior is completely unchanged: same
 * localStorage reads, same /api/saved call, same response shape. */
export default function MyWorldPage() {
  const [data, setData] = useState<MyWorldData | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAccountSession().then((isAuthed) => {
      if (cancelled) return;
      setAuthed(isAuthed);

      if (isAuthed) {
        syncLocalToAccountOnce();
        fetch("/api/account/world")
          .then((res) => (res.ok ? res.json() : null))
          .then(
            (
              result: {
                businesses: BusinessWithCategories[];
                events: FindmiEvent[];
                products: SavedProduct[];
                locations: LocationWithCategory[];
                followedBusinesses: BusinessWithCategories[];
                followedEvents: FindmiEvent[];
                followedLocations: LocationWithCategory[];
              } | null
            ) => {
              if (cancelled) return;
              setData(
                result
                  ? {
                      wantProducts: result.products ?? [],
                      wantToDoEvents: result.events ?? [],
                      followingBusinesses: result.followedBusinesses ?? [],
                      followingEvents: result.followedEvents ?? [],
                      followingLocations: result.followedLocations ?? [],
                      savedBusinesses: result.businesses ?? [],
                      savedLocations: result.locations ?? [],
                    }
                  : EMPTY
              );
            }
          )
          .catch(() => {
            if (!cancelled) setData(EMPTY);
          });
        return;
      }

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
        setData(EMPTY);
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
            if (cancelled) return;
            setData({
              wantProducts: result.products ?? [],
              wantToDoEvents: result.events ?? [],
              followingBusinesses: result.followedBusinesses ?? [],
              followingEvents: [],
              followingLocations: [],
              savedBusinesses: result.businesses ?? [],
              savedLocations: result.locations ?? [],
            });
          }
        )
        .catch(() => {
          if (!cancelled) setData(EMPTY);
        });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = data === null;
  const empty =
    !loading &&
    data.wantProducts.length === 0 &&
    data.wantToDoEvents.length === 0 &&
    data.followingBusinesses.length === 0 &&
    data.followingEvents.length === 0 &&
    data.followingLocations.length === 0 &&
    data.savedBusinesses.length === 0 &&
    data.savedLocations.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Your world</h1>
      <p className="mt-2 max-w-md text-sm text-ink/60">
        {authed
          ? "Everything you've wanted, wanted to do, followed, and saved."
          : "Everything you've wanted, wanted to do, followed, and saved, kept right on this device."}
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

          {(data.followingBusinesses.length > 0 || data.followingEvents.length > 0 || data.followingLocations.length > 0) && (
            <section>
              <h2 className="text-xs font-bold uppercase tracking-wide text-findmi-700">Following</h2>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {data.followingBusinesses.map((b) => (
                  <BusinessCard key={b.id} business={b} />
                ))}
                {data.followingEvents.map((e) => (
                  <CompactCard
                    key={e.id}
                    href={`/event/${e.slug}`}
                    image={e.cover_image_url}
                    title={e.name}
                    meta={[formatDateRange(e.start_at, e.end_at), cityState(e.city, e.state)].filter(Boolean).join(" · ")}
                  />
                ))}
                {data.followingLocations.map((l) => (
                  <LocationCard key={l.id} location={l} />
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
