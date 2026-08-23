import Link from "next/link";
import { getAdminProducts } from "@/lib/admin/queries";
import { formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  const products = await getAdminProducts();

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
