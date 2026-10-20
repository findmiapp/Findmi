import type { Metadata } from "next";
import Link from "next/link";
import { EventRow, NeighborhoodCard, PlaceRow } from "@/components/jc/Cards";
import { EmptyState, Module, PageTitle } from "@/components/jc/Layout";
import { EVENT_WINDOWS, PLACE_FILTERS, jcHref } from "@/lib/jc/config";
import { getJcEvents, getJcNeighborhoods, getJcPlaces } from "@/lib/jc/data";

export const revalidate = 60;
export const metadata: Metadata = { title: "Discover" };

const BROWSE = [
  ...EVENT_WINDOWS.filter((w) => w.slug).map((w) => ({ label: w.label, href: jcHref(`/events?when=${w.slug}`) })),
  ...PLACE_FILTERS.filter((f) => f.slug).map((f) => ({ label: f.label, href: jcHref(`/places?type=${f.slug}`) })),
];

export default async function JcDiscover({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);
  const [events, places, neighborhoods] = await Promise.all([
    getJcEvents({ q: q || undefined, limit: q ? 20 : 6 }),
    q ? getJcPlaces({ q, limit: 20 }) : Promise.resolve([]),
    getJcNeighborhoods(),
  ]);
  const hoods = q ? neighborhoods.filter((n) => n.name.toLowerCase().includes(q.toLowerCase())) : neighborhoods;

  return (
    <div>
      <PageTitle title="Discover" />
      <form action={jcHref("/discover")} className="px-4 md:px-8">
        <label className="flex h-12 items-center gap-2.5 rounded-2xl bg-neutral-100 px-4 focus-within:bg-neutral-50 focus-within:ring-2 focus-within:ring-neutral-950/80">
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 text-neutral-500" aria-hidden>
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth={1.9} />
            <path d="m16 16 4 4" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" />
          </svg>
          <input autoCapitalize="none" name="q" defaultValue={q} placeholder="Coffee, live music, markets…" autoComplete="off" enterKeyHint="search" className="h-full w-full bg-transparent text-[16px] outline-none placeholder:text-neutral-400" />
        </label>
      </form>

      {q ? (
        events.length + places.length + hoods.length === 0 ? (
          <EmptyState title={`Nothing for “${q}” yet`} body="Try a broader word, a neighborhood or a kind of place." />
        ) : (
          <div className="px-4 pt-4 md:grid md:grid-cols-2 md:gap-10 md:px-8">
            {places.length > 0 && (
              <section className="pt-4">
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-neutral-500">Places</h2>
                {places.map((p) => (
                  <PlaceRow key={p.id} p={p} />
                ))}
              </section>
            )}
            {events.length > 0 && (
              <section className="pt-4">
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-neutral-500">Upcoming</h2>
                {events.map((e) => (
                  <EventRow key={e.id} e={e} />
                ))}
              </section>
            )}
          </div>
        )
      ) : (
        <>
          <div className="flex flex-wrap gap-2 px-4 pt-5 md:px-8">
            {BROWSE.map((b) => (
              <Link key={b.href} href={b.href} className="rounded-full bg-neutral-100 px-3.5 py-[7px] text-[13.5px] font-medium text-neutral-700 hover:bg-neutral-200">
                {b.label}
              </Link>
            ))}
          </div>
          <Module title="Neighborhoods" items={hoods} size="sm" render={(n) => <NeighborhoodCard n={n} />} />
          {events.length > 0 && (
            <section className="px-4 pt-8 md:px-8">
              <h2 className="text-[20px] font-semibold tracking-[-0.025em]">Coming Up Soon</h2>
              <div className="mt-1 md:grid md:grid-cols-2 md:gap-x-10">
                {events.map((e) => (
                  <EventRow key={e.id} e={e} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
