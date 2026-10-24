import type { Metadata } from "next";
import Link from "next/link";
import BrandHeading from "@/components/BrandHeading";
import NavIcon from "@/components/NavIcon";
import MomentsDiscovery from "@/components/moments/MomentsDiscovery";
import { getMomentFeed } from "@/lib/moment-discovery";
import { parseMomentFeedState } from "@/lib/moment-filters";

/** Findmi Moments — the general network Moments destination (homepage
 * Moments action and "See All"). ONE canonical Moments feed with two modes,
 * Explore and For You (see MomentsDiscovery), each with its own category;
 * public browsing needs no account. Every public, published Moment, newest
 * experience first, keyset-paginated with the same "Older Moments" /
 * "Newest" convention as /journal. The per-subject collections stay at
 * /journal?business=… etc. Add Moment opens the one Moment composer
 * (signed-out visitors can start a Moment there too). */

const PAGE_SIZE = 24;

export const metadata: Metadata = {
  title: "Findmi Moments",
  description: "Real experiences at Findmi Businesses, Events and Locations, shared by people who were there.",
};

const ADD_MOMENT_HREF = "/my-world/journal/new";

export default async function MomentsPage({ searchParams }: { searchParams: Promise<{ cursor?: string; filter?: string; mode?: string; cat?: string }> }) {
  const params = await searchParams;
  const cursor = params.cursor ?? null;
  const feedState = parseMomentFeedState(params);
  const page = await getMomentFeed({ limit: PAGE_SIZE, cursor });

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      <BrandHeading
        as="h1"
        accent="Moments"
        size="home"
        trailing={
          <Link
            href={ADD_MOMENT_HREF}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-findmi-200 bg-white pl-1.5 pr-3.5 text-[13px] font-bold text-primary transition hover:border-findmi-300 hover:bg-findmi-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
          >
            <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-findmi text-white">
              <NavIcon name="moments" className="h-3.5 w-3.5" />
            </span>
            Add Moment
          </Link>
        }
      />
      <p className="mt-1 text-sm text-ink/60">Real experiences, shared by people who were there.</p>
      <div className="mt-5">
        {page.cards.length > 0 || cursor ? (
          <MomentsDiscovery cards={page.cards} layout="grid" initialState={feedState} pagination={{ basePath: "/moments", cursor, nextCursor: page.nextCursor }} />
        ) : (
          <p className="rounded-2xl bg-black/[0.03] px-4 py-6 text-sm text-ink/55">
            No public Moments yet.{" "}
            <Link href={ADD_MOMENT_HREF} className="font-semibold text-findmi-700 hover:underline">
              Add the first one
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
