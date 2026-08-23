import type { Metadata } from "next";
import Link from "next/link";
import BusinessCard from "@/components/BusinessCard";
import { getCategories, searchBusinesses } from "@/lib/data";

export const metadata: Metadata = {
  title: "Businesses",
  description: "Search and browse businesses and vendors on FindMi.",
};
export const revalidate = 60;

export default async function BusinessesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; city?: string }>;
}) {
  const params = await searchParams;
  const [categories, businesses] = await Promise.all([
    getCategories(),
    searchBusinesses({ q: params.q, categorySlug: params.category, city: params.city }),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Businesses</h1>
      <p className="mt-2 text-ink/60">Search FindMi&rsquo;s directory of vendors and brands.</p>

      <form method="get" className="mt-6 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          name="q"
          defaultValue={params.q}
          placeholder="Search by name or description"
          className="flex-1 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-ink placeholder:text-ink/40 focus:border-ink/30 focus:outline-none"
        />
        <input
          type="text"
          name="city"
          defaultValue={params.city}
          placeholder="City"
          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-ink placeholder:text-ink/40 focus:border-ink/30 focus:outline-none sm:w-40"
        />
        <select
          name="category"
          defaultValue={params.category ?? ""}
          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-ink focus:border-ink/30 focus:outline-none sm:w-48"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-findmi px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Search
        </button>
      </form>

      {(params.q || params.category || params.city) && (
        <p className="mt-4 text-sm text-ink/50">
          {businesses.length} result{businesses.length === 1 ? "" : "s"}
          {params.category && (
            <>
              {" "}
              in <span className="font-medium text-ink">{params.category.replace(/-/g, " ")}</span>
            </>
          )}
        </p>
      )}

      {businesses.length === 0 ? (
        <p className="mt-10 text-sm text-ink/50">
          No businesses matched your search.{" "}
          <Link href="/businesses" className="font-medium text-ink underline underline-offset-2">
            Clear filters
          </Link>
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
