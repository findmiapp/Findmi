import Link from "next/link";
import { getAdminProducts, getBusinessOptionById } from "@/lib/admin/queries";
import { RelationField } from "@/components/admin/RelationPicker";
import { formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; business?: string }>;
}) {
  const { q, business } = await searchParams;
  const [products, initialBusiness] = await Promise.all([
    getAdminProducts({ q, businessId: business }),
    getBusinessOptionById(business ?? null),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Products</h1>
        <Link
          href="/admin/products/new"
          className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:bg-findmi-600"
        >
          Add Product
        </Link>
      </div>

      <form method="get" className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by product name or slug…"
          className="w-full min-w-0 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none sm:max-w-xs sm:flex-1"
        />
        <div className="w-full sm:w-56">
          <RelationField
            label="Business"
            name="business"
            entity="businesses"
            initial={initialBusiness}
            clearLabel="All businesses"
            placeholder="Filter by business…"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-black/[0.03] sm:w-auto"
        >
          Filter
        </button>
      </form>

      <div className="mt-4 flex flex-col gap-2">
        {products.length === 0 ? (
          <p className="text-sm text-ink/50">No products yet.</p>
        ) : (
          products.map((p) => (
            <Link
              key={p.id}
              href={`/admin/products/${p.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                <p className="truncate text-xs text-ink/45">
                  {p.business?.name ?? "—"}
                  {formatPrice(p.price, p.price_label) ? ` · ${formatPrice(p.price, p.price_label)}` : ""}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                  p.is_active ? "bg-findmi-50 text-findmi-700" : "bg-black/[0.06] text-ink/50"
                }`}
              >
                {p.is_active ? "Active" : "Inactive"}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
