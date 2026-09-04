import Link from "next/link";
import { getAdminBusinesses, getAllCategories } from "@/lib/admin/queries";

export const dynamic = "force-dynamic";

const selectClass =
  "rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink focus:border-ink/30 focus:outline-none";

export default async function AdminBusinessesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; published?: string }>;
}) {
  const { q, category, published } = await searchParams;
  const publishedFilter =
    published === "public" || published === "demo" || published === "pending_review" ? published : undefined;

  const [businesses, categories] = await Promise.all([
    getAdminBusinesses({ q, categoryId: category, published: publishedFilter }),
    getAllCategories("business"),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Businesses</h1>
        <Link
          href="/admin/businesses/new"
          className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:bg-findmi-600"
        >
          Add Business
        </Link>
      </div>

      <form method="get" className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by name, slug, or city…"
          className="w-full min-w-0 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none sm:max-w-xs sm:flex-1"
        />
        <div className="flex flex-wrap gap-2">
          <select name="category" defaultValue={category ?? ""} className={selectClass}>
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select name="published" defaultValue={published ?? ""} className={selectClass}>
            <option value="">Published: All</option>
            <option value="public">Public only</option>
            <option value="pending_review">Pending Review only</option>
            <option value="demo">Demo/hidden only</option>
          </select>
          <button
            type="submit"
            className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-black/[0.03]"
          >
            Filter
          </button>
        </div>
      </form>

      <div className="mt-4 flex flex-col gap-2">
        {businesses.length === 0 ? (
          <p className="text-sm text-ink/50">No businesses found.</p>
        ) : (
          businesses.map((b) => (
            <Link
              key={b.id}
              href={`/admin/businesses/${b.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{b.name}</p>
                <p className="truncate text-xs text-ink/45">
                  {[b.city, b.state].filter(Boolean).join(", ") || b.slug}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                  b.is_demo
                    ? "bg-black/[0.06] text-ink/50"
                    : b.publication_status === "pending_review"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-findmi-50 text-findmi-700"
                }`}
              >
                {b.is_demo ? "Demo" : b.publication_status === "pending_review" ? "Pending Review" : "Public"}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
