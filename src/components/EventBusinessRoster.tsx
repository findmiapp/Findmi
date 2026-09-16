"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import BusinessLogoCard from "./BusinessLogoCard";
import SupabaseImage from "./SupabaseImage";
import { HorizontalScroller } from "./Section";
import { cityState } from "@/lib/format";
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

      {/* Event Roster Micro UX Polish pass — marks where the Featured
          Vendors carousel ends and the complete roster/category-filter
          section begins, so the pills directly below don't read as
          filtering the carousel above them. Belongs to the full-roster
          section, not Featured Vendors — renders unconditionally
          (independent of the category pills' own >1-category gate), same
          as the complete roster grid below it. */}
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink/40">
        View All Vendors by Category
      </p>

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

      {/* Density pass (Public Experience V5) — the complete roster used the
          same rich vertical BusinessLogoCard (16:10 photo + overlapping
          logo) the Featured Vendors rail above uses, which reads great for
          a small curated set but got extremely tall on mobile once an
          event confirms a real-sized roster (grid-cols-1 stacking N full
          photo cards). Featured Vendors keeps that richer treatment (it's
          a small, curated highlight set); the full A-Z roster below uses
          RosterListItem instead — still genuinely image-led (a real
          logo/cover thumbnail, never a bare gray row) but compact enough
          that several businesses can be scanned without each consuming a
          near-full viewport. */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((b) => (
          <RosterListItem key={b.id} business={b} />
        ))}
      </div>
    </div>
  );
}

// UI cleanup pass item 11: reuses the same cover+overlapping-logo brand-
// preview card as Brands We Love / Discover More Like This, rather than
// CompactCard's small generic image tile — "Find Them" is passed through
// as the roster's own CTA copy via BusinessLogoCard's now-configurable
// ctaLabel (item 6). Still used for the Featured Vendors rail above.
function RosterCard({ business }: { business: EventBusinessListing }) {
  return <BusinessLogoCard business={business} ctaLabel="Find Them" />;
}

/** Compact, image-led roster row — Public Experience V5 (see the grid's
 * own comment above). A real logo/cover thumbnail keeps this from reading
 * as a plain directory row, at a fraction of BusinessLogoCard's height. */
function RosterListItem({ business }: { business: EventBusinessListing }) {
  const meta = [business.categories[0]?.name, cityState(business.city, business.state)].filter(Boolean).join(" · ");
  const thumb = business.logo_url ?? business.cover_image_url;

  return (
    <Link
      href={`/business/${business.slug}`}
      className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-3 transition active:scale-[0.99] hover:border-black/10 hover:shadow-sm"
    >
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-black/[0.04] sm:h-16 sm:w-16">
        {thumb ? (
          <SupabaseImage
            src={thumb}
            alt=""
            fill
            sizes="64px"
            className={business.logo_url ? "object-contain p-1.5" : "object-cover"}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-stone to-ink">
            <StorefrontGlyph className="h-6 w-6 text-white/25" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm font-bold text-ink">{business.name}</p>
        {meta && <p className="mt-0.5 truncate text-xs text-ink/55">{meta}</p>}
      </div>
      <span className="shrink-0 rounded-full bg-findmi-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-findmi-700">
        Find Them
      </span>
    </Link>
  );
}

function StorefrontGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M4 9.5L5 4h14l1 5.5M4 9.5a2.2 2.2 0 004.3.7M4 9.5a2.2 2.2 0 004.3.7m0 0a2.2 2.2 0 004.4 0m0 0a2.2 2.2 0 004.4 0m0 0a2.2 2.2 0 004.3-.7M5 10v9.5a1 1 0 001 1h5v-6h2v6h5a1 1 0 001-1V10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
