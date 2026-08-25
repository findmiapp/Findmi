"use client";

import { useMemo, useState } from "react";
import ProductCard from "./ProductCard";
import type { Product } from "@/lib/types";

type ShopFilter = "all" | "shop" | "catalog";

const TABS: { key: ShopFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "shop", label: "For Sale" },
  { key: "catalog", label: "Catalog" },
];

/**
 * Business Profile V2 polish pass, item 6 — Shop [Business] now
 * distinguishes purchasable products from view-only catalog/menu items
 * (products.purchasable — no new schema) instead of showing everything as
 * one undifferentiated grid. The filter tabs only render when a business
 * genuinely has BOTH kinds; a business with just one never sees a filter
 * with nothing to filter. Purely a client-side split of props already
 * fetched server-side (getProductsForBusiness) — no re-fetch, no URL
 * state, matching the scale of this in-page toggle rather than the
 * archive pages' server-driven filtering.
 *
 * `business` is passed through to ProductCard so its canAddToCart gate can
 * check the real businesses.commerce_enabled flag — the business's own
 * product list previously called ProductCard with no `business` prop at
 * all, which fell back to trusting `purchasable` alone (see ProductCard's
 * own comment on that fallback). A business with commerce disabled but a
 * stale purchasable=true product would have incorrectly shown "Add to
 * Cart" here; this closes that gap using the same real field.
 */
export default function BusinessShopSection({
  businessName,
  products,
  business,
}: {
  businessName: string;
  products: Product[];
  business: { name: string; slug: string; logo_url: string | null; commerce_enabled: boolean };
}) {
  const showFilter = useMemo(
    () => products.some((p) => p.purchasable) && products.some((p) => !p.purchasable),
    [products]
  );
  const [filter, setFilter] = useState<ShopFilter>("all");
  const filtered = useMemo(() => {
    if (filter === "shop") return products.filter((p) => p.purchasable);
    if (filter === "catalog") return products.filter((p) => !p.purchasable);
    return products;
  }, [filter, products]);

  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-bold tracking-tight text-ink">Shop {businessName}</h2>

      {showFilter && (
        <div className="mt-3 flex gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
                filter === t.key ? "bg-findmi text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="mt-4 text-sm text-ink/45">Nothing here yet.</p>
      ) : (
        <div className="mt-4 -mx-4 flex gap-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:grid-cols-3 md:grid-cols-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {filtered.map((p) => (
            <div key={p.id} className="w-40 shrink-0 sm:w-auto sm:shrink">
              <ProductCard product={{ ...p, business }} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
