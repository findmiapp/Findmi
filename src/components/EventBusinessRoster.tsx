"use client";

import { useMemo, useState } from "react";
import BusinessLogoCard from "./BusinessLogoCard";
import type { EventBusinessListing } from "@/lib/data";

export default function EventBusinessRoster({
  businesses,
}: {
  businesses: EventBusinessListing[];
}) {
  // Filters derive from the categories actually represented here — never a
  // fixed list, so an event never shows a filter with nothing behind it.
  const categoryNames = useMemo(() => {
    const set = new Set<string>();
    businesses.forEach((b) => {
      if (b.categories[0]) set.add(b.categories[0].name);
    });
    return Array.from(set).sort();
  }, [businesses]);

  const [active, setActive] = useState<string>("All");
  // "Featured Here" deliberately keeps deriving from the raw incoming
  // order (display_order for a legacy event, or featured-first-then-name
  // from getOccurrenceBusinessRosters for a recurring one) — never
  // touched by the A-Z sort below, so featured prioritization/order is
  // unaffected by this change either way.
  const featured = businesses.filter((b) => b.featured);
  // A–Z Public Display pass — the main roster grid (below, and everything
  // the category filter narrows down to) sorts alphabetically by business
  // name, case-insensitive/natural, regardless of how `businesses` arrived
  // (admin display_order for event-level, or the occurrence-level query's
  // own ordering) — that source order is never mutated, only this
  // rendering copy.
  const sortedByName = useMemo(
    () =>
      [...businesses].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
      ),
    [businesses]
  );
  const filtered = active === "All" ? sortedByName : sortedByName.filter((b) => b.categories[0]?.name === active);

  if (businesses.length === 0) {
    return (
      <p className="mt-6 text-sm text-ink/50">
        Businesses for this event haven&rsquo;t been confirmed yet — check back soon.
      </p>
    );
  }

  return (
    <div className="mt-4">
      {featured.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Featured Here</p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((b) => (
              <RosterCard key={b.id} business={b} />
            ))}
          </div>
        </div>
      )}

      {categoryNames.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {["All", ...categoryNames].map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActive(cat)}
              className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
                active === cat
                  ? "bg-findmi text-white"
                  : "border border-black/10 text-ink/60 hover:border-black/20"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((b) => (
          <RosterCard key={b.id} business={b} />
        ))}
      </div>
    </div>
  );
}

// UI cleanup pass item 11: reuses the same cover+overlapping-logo brand-
// preview card as Brands We Love / Discover More Like This, rather than
// CompactCard's small generic image tile — "Find Them" is passed through
// as the roster's own CTA copy via BusinessLogoCard's now-configurable
// ctaLabel (item 6).
function RosterCard({ business }: { business: EventBusinessListing }) {
  return <BusinessLogoCard business={business} ctaLabel="Find Them" />;
}
