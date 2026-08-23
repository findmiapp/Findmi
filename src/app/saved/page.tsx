"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BusinessCard from "@/components/BusinessCard";
import { getSupabase } from "@/lib/supabase";
import { getSavedSlugs } from "@/lib/saved";
import type { BusinessWithCategories } from "@/lib/types";

export default function SavedPage() {
  const [businesses, setBusinesses] = useState<BusinessWithCategories[] | null>(null);

  useEffect(() => {
    const slugs = getSavedSlugs();
    if (slugs.length === 0) {
      setBusinesses([]);
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      setBusinesses([]);
      return;
    }
    supabase
      .from("businesses")
      .select("*")
      .in("slug", slugs)
      .eq("is_demo", false)
      .then(({ data }) => {
        setBusinesses((data ?? []).map((b) => ({ ...b, categories: [] })));
      });
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Saved</h1>
      <p className="mt-2 text-ink/60">
        Kept on this device — tap the bookmark on a business profile to save it here.
      </p>

      {businesses === null ? null : businesses.length === 0 ? (
        <p className="mt-10 text-sm text-ink/50">
          Nothing saved yet.{" "}
          <Link href="/discover" className="font-medium text-ink underline underline-offset-2">
            Start exploring
          </Link>
          .
        </p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {businesses.map((b) => (
            <BusinessCard key={b.id} business={b} />
          ))}
        </div>
      )}
    </div>
  );
}
