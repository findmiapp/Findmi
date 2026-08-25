"use client";

import { useState } from "react";
import { Avatar, EntitySearchAdd, type SearchResult } from "./RelationPicker";
import type { EventFeaturedProduct } from "@/lib/admin/queries";

const inputClass =
  "rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none";

interface Row {
  product_id: string;
  product_name: string;
  image_url: string | null;
  display_order: string;
}

function toRow(p: EventFeaturedProduct): Row {
  return {
    product_id: p.product_id,
    product_name: p.product_name,
    image_url: p.image_url,
    display_order: p.display_order != null ? String(p.display_order) : "",
  };
}

/** Event Detail V2 polish pass, item 15 — search-and-add editor for a
 * small, founder-picked set of EXISTING products to feature on one event
 * (event_products). Mirrors ParticipationRoster's exact pattern (bounded
 * search via EntitySearchAdd, removed rows tracked separately so the
 * server never has to diff against the full products table). No
 * automatic vendor-product merchandising — every row here was manually
 * added by the founder. */
export default function EventProductsRoster({
  initialProducts,
}: {
  initialProducts: EventFeaturedProduct[];
}) {
  const [rows, setRows] = useState<Row[]>(initialProducts.map(toRow));
  const [removedIds, setRemovedIds] = useState<string[]>([]);

  const addProduct = (r: SearchResult) => {
    setRows((prev) => [
      ...prev,
      { product_id: r.value, product_name: r.label, image_url: r.image_url ?? null, display_order: "" },
    ]);
    setRemovedIds((prev) => prev.filter((id) => id !== r.value));
  };

  const removeProduct = (productId: string) => {
    setRows((prev) => prev.filter((row) => row.product_id !== productId));
    setRemovedIds((prev) => [...prev, productId]);
  };

  const updateRow = (productId: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((row) => (row.product_id === productId ? { ...row, ...patch } : row)));
  };

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink">Featured Products</span>
      <p className="mb-2 text-xs text-ink/45">
        Shown as a &ldquo;Featured at This Event&rdquo; row on the public event page. Leave empty to
        omit the section entirely.
      </p>

      <EntitySearchAdd
        entity="products"
        placeholder="Search and add product…"
        excludeIds={new Set(rows.map((r) => r.product_id))}
        onAdd={addProduct}
      />

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink/45">No products added yet — search above to add one.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.product_id} className="flex items-center gap-2.5 rounded-xl border border-black/10 bg-white p-3">
              <input type="hidden" name="featured_product_id" value={row.product_id} />
              <Avatar url={row.image_url} label={row.product_name} />
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{row.product_name}</p>
              <label className="flex shrink-0 items-center gap-1.5">
                <span className="text-xs font-medium text-ink/60">Order</span>
                <input
                  type="number"
                  name={`product_display_order_${row.product_id}`}
                  value={row.display_order}
                  onChange={(e) => updateRow(row.product_id, { display_order: e.target.value })}
                  className={`${inputClass} w-16`}
                />
              </label>
              <button
                type="button"
                onClick={() => removeProduct(row.product_id)}
                className="shrink-0 text-xs font-semibold text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {removedIds.map((id) => (
        <input key={id} type="hidden" name="removed_product_id" value={id} />
      ))}
    </div>
  );
}
