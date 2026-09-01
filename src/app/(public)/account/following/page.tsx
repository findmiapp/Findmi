"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BusinessCard from "@/components/BusinessCard";
import { getFollowedSlugs } from "@/lib/followed";
import type { BusinessWithCategories } from "@/lib/types";
import AccountNav from "../AccountNav";

/** Reuses the existing /api/saved route rather than a new endpoint — it
 * already resolves a `business` slug list to public, grant-safe business
 * records (see that route), which is exactly what the per-device followed
 * list (lib/followed.ts) needs here too. No new architecture, no
 * migration of the follow list into an account-backed table. */
export default function AccountFollowingPage() {
  const [businesses, setBusinesses] = useState<BusinessWithCategories[] | null>(null);

  useEffect(() => {
    const slugs = getFollowedSlugs();
    if (slugs.length === 0) {
      setBusinesses([]);
      return;
    }

    fetch(`/api/saved?business=${encodeURIComponent(slugs.join(","))}`)
      .then((res) => res.json())
      .then((data: { businesses: BusinessWithCategories[] }) => setBusinesses(data.businesses ?? []))
      .catch(() => setBusinesses([]));
  }, []);

  const loading = businesses === null;
  const empty = !loading && businesses.length === 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Following</h1>
      <p className="mt-1.5 text-sm text-ink/50">Businesses you&rsquo;ve followed on this device.</p>

      {loading ? null : empty ? (
        <div className="mt-8 rounded-3xl border border-black/5 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-ink">Not following anyone yet</p>
          <p className="mt-1 text-sm text-ink/50">
            <Link href="/businesses" className="font-medium text-findmi-700 underline underline-offset-2">
              Browse businesses
            </Link>{" "}
            and follow the ones you want to hear from.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {businesses.map((b) => (
            <BusinessCard key={b.id} business={b} />
          ))}
        </div>
      )}
    </div>
  );
}
