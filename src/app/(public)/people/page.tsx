import type { Metadata } from "next";
import PersonCard from "@/components/PersonCard";
import Section, { HorizontalScroller } from "@/components/Section";
import { getFeaturedPeople, getPublicPeople } from "@/lib/data";

export const metadata: Metadata = {
  title: "People",
  description: "Meet the founders, owners, makers, and creators behind FindMi brands.",
};
export const revalidate = 60;

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const [featured, people] = await Promise.all([getFeaturedPeople(10), getPublicPeople(q)]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">People</h1>
      <p className="mt-2 text-ink/60">The founders, owners, makers, and creators behind FindMi brands.</p>

      <form method="get" className="mt-6 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by name, bio, or location"
          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-ink placeholder:text-ink/40 focus:border-ink/30 focus:outline-none sm:max-w-sm"
        />
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-findmi px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Search
        </button>
      </form>

      {!q && featured.length > 0 && (
        <div className="-mx-6 mt-6">
          <Section title="Featured People" subtitle="People to know on FindMi">
            <HorizontalScroller>
              {featured.map((p) => (
                <div key={p.id} className="w-44 shrink-0">
                  <PersonCard person={p} />
                </div>
              ))}
            </HorizontalScroller>
          </Section>
        </div>
      )}

      <div className="mt-8">
        <h2 className="font-display text-xl font-bold tracking-tight text-ink">
          {q ? "Search results" : "People Behind the Brands"}
        </h2>
        {people.length === 0 ? (
          <p className="mt-6 text-sm text-ink/50">
            {q ? "No one matched your search." : "No public profiles yet — check back soon."}
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {people.map((p) => (
              <PersonCard key={p.id} person={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
