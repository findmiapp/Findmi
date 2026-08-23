import Link from "next/link";
import { getAdminBusinesses } from "@/lib/admin/queries";

export const dynamic = "force-dynamic";

export default async function AdminBusinessesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const businesses = await getAdminBusinesses(q);

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

      <form method="get" className="mt-4">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by name…"
          className="w-full max-w-sm rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
        />
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
                  b.is_demo ? "bg-black/[0.06] text-ink/50" : "bg-findmi-50 text-findmi-700"
                }`}
              >
                {b.is_demo ? "Demo" : "Public"}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
