import type { Metadata } from "next";
import Link from "next/link";
import BusinessCard from "@/components/BusinessCard";
import EventCard from "@/components/EventCard";
import { getCategories, getUpcomingEvents, searchBusinesses } from "@/lib/data";

export const metadata: Metadata = {
  title: "Discover",
  description: "Browse businesses, vendors, and events on Findmi.",
};
export const revalidate = 60;

export default async function DiscoverPage() {
  const [categories, businesses, events] = await Promise.all([
    getCategories(),
    searchBusinesses({}),
    getUpcomingEvents(12),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Discover</h1>
      <p className="mt-2 text-ink/60">Browse everything happening on Findmi right now.</p>

      {categories.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/businesses?category=${c.slug}`}
              className="rounded-full border border-black/10 px-4 py-2 text-sm font-medium text-ink/70 transition hover:border-ink/30 hover:text-ink"
            >
              {c.name}
            </Link>
          ))}
        </div>
      )}

      {events.length > 0 && (
        <div className="mt-12">
          <div className="flex items-end justify-between">
            <h2 className="text-xl font-semibold tracking-tight text-ink">Upcoming events</h2>
            <Link href="/events" className="text-sm font-medium text-ink/60 hover:text-ink">
              View all
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {events.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-12">
        <div className="flex items-end justify-between">
          <h2 className="text-xl font-semibold tracking-tight text-ink">Businesses</h2>
          <Link href="/businesses" className="text-sm font-medium text-ink/60 hover:text-ink">
            View all
          </Link>
        </div>
        {businesses.length === 0 ? (
          <p className="mt-6 text-sm text-ink/50">
            No businesses yet — check back soon, or{" "}
            <Link href="/join" className="font-medium text-ink underline underline-offset-2">
              be the first to join
            </Link>
            .
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {businesses.map((b) => (
              <BusinessCard key={b.id} business={b} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
