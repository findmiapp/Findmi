"use client";

import { useMemo, useState } from "react";
import BusinessLogoCard from "./BusinessLogoCard";
import { HorizontalScroller } from "./Section";
import type { EventBusinessListing } from "@/lib/data";

export default function EventBusinessRoster({
  businesses,
  eventName,
}: {
  businesses: EventBusinessListing[];
  /** Featured Vendors + Full Roster Correction pass — used only for the
   * "Featured Vendors at {eventName}" heading below; this component never
   * fetches the Event itself, so both callers (EventPublicView.tsx for a
   * legacy event, EventOccurrenceBusinessRoster.tsx for a recurring one)
   * just pass through the event.name they already have in hand. */
  eventName: string;
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
  // "Featured Vendors" deliberately keeps deriving from the raw incoming
  // order (display_order for a legacy event, or featured-first-then-name
  // from getOccurrenceBusinessRosters for a recurring one) — never
  // touched by the A-Z sort below, so featured prioritization/order is
  // unaffected by this change either way.
  const featured = businesses.filter((b) => b.featured);
  // Featured Vendors + Full Roster Correction pass — the previous pass's
  // fix for the Donna/Fox double-render bug went a step too far: it
  // excluded featured businesses from "Who You'll Find Here" entirely,
  // but Featured is additive editorial prominence, not a separate
  // participation tier — a featured business is still a confirmed
  // participant and belongs in the complete roster too. The real bug was
  // never "featured businesses show up in two places" (that's correct,
  // intentional) — it was the main grid rendering the SAME "Featured
  // Vendors" section's businesses a second time with no visual
  // distinction, back when Featured had no rail of its own. Now that
  // Featured Vendors is its own clearly-labeled horizontal rail (below),
  // the complete roster is free to include every confirmed business
  // again, featured or not — see this pass's own report for the intended
  // Perk Up Fest presentation (Donna/Fox in both sections, Viktor in the
  // full roster only).
  // A–Z Public Display pass — the main roster grid sorts alphabetically by
  // business name, case-insensitive/natural, regardless of how
  // `businesses` arrived (admin display_order for event-level, or the
  // occurrence-level query's own ordering) — that source order is never
  // mutated, only this rendering copy.
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
      {/* Featured Vendors — a horizontal swipeable rail, not a stacked
          grid (mobile: one card mostly visible with the next peeking in,
          matching the "Upcoming Dates" carousel just above this section
          on the same page — same -mx-4/px-4 edge-bleed idiom, same
          BusinessLogoCard rail width HomepageBusinessRow's own "Brands We
          Love" row already uses). Renders nothing at all when no
          confirmed business is featured — never an empty section. */}
      {featured.length > 0 && (
        <div className="mb-6 -mx-4 sm:mx-0">
          <p className="px-4 font-display text-lg font-bold tracking-tight text-findmi-700 sm:px-0">
            Featured Vendors at {eventName}
          </p>
          <HorizontalScroller className="mt-3">
            {featured.map((b) => (
              <div key={b.id} className="w-[80vw] max-w-sm shrink-0 sm:w-96">
                <RosterCard business={b} />
              </div>
            ))}
          </HorizontalScroller>
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
