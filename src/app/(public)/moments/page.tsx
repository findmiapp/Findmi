import type { Metadata } from "next";
import BrandHeading from "@/components/BrandHeading";
import MomentsDiscovery from "@/components/moments/MomentsDiscovery";
import { getMomentFeed } from "@/lib/moment-discovery";
import { isMomentFilterKey } from "@/lib/moment-filters";

/** Findmi Moments — the cross-entity discovery feed (homepage "See All").
 * Every public, published Moment, newest experience first, keyset-paginated
 * with the same "Older Moments" / "Newest" convention as /journal. The
 * per-subject collections stay at /journal?business=… etc. */

const PAGE_SIZE = 24;

export const metadata: Metadata = {
  title: "Findmi Moments",
  description: "Real experiences at Findmi Businesses, Events and Locations, shared by people who were there.",
};

export default async function MomentsPage({ searchParams }: { searchParams: Promise<{ cursor?: string; filter?: string }> }) {
  const params = await searchParams;
  const cursor = params.cursor ?? null;
  const filter = isMomentFilterKey(params.filter) ? params.filter : "for-you";
  const page = await getMomentFeed({ limit: PAGE_SIZE, cursor });

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      <BrandHeading as="h1" accent="Moments" size="home" />
      <p className="mt-1 text-sm text-ink/60">Real experiences, shared by people who were there.</p>
      <div className="mt-5">
        {page.cards.length > 0 || cursor ? (
          <MomentsDiscovery
            cards={page.cards}
            layout="grid"
            initialFilter={filter}
            pagination={{ basePath: "/moments", cursor, nextCursor: page.nextCursor }}
          />
        ) : (
          <p className="rounded-2xl bg-black/[0.03] px-4 py-6 text-sm text-ink/55">No public Moments yet — check back soon.</p>
        )}
      </div>
    </div>
  );
}
