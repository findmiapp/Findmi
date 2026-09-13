import Link from "next/link";
import { getAdminBusinesses, getAllCategories } from "@/lib/admin/queries";
import BusinessesFilterBar from "./BusinessesFilterBar";

export const dynamic = "force-dynamic";

export default async function AdminBusinessesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; published?: string; decided?: string }>;
}) {
  const { q, category, published, decided } = await searchParams;
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

      {/* Admin Pending Review Decision UX pass — the "return naturally to
          the review queue" success state after Approve/Reject on the edit
          page. The decided business itself is already gone from this list
          by the time this renders (published=pending_review filter, same
          authoritative query the decision panel wrote to). */}
      {(decided === "approved" || decided === "rejected") && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          {decided === "approved" ? "Business approved and now live." : "Business rejected."}
        </p>
      )}

      <BusinessesFilterBar
        categories={categories}
        initialQ={q ?? ""}
        initialCategory={category ?? ""}
        initialPublished={published ?? ""}
      >
        <div className="flex flex-col gap-2">
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
      </BusinessesFilterBar>
    </div>
  );
}
