"use client";

import { useState } from "react";
import ProductCard from "./ProductCard";
import SectionHeading from "./SectionHeading";
import { HorizontalScroller } from "./Section";
import type { Product } from "@/lib/types";

const PREVIEW_COUNT = 8;

/**
 * Public Business V2 — Products as a compact preview, not a catalog: one
 * rail of the first PREVIEW_COUNT products (getProductsForBusiness's own
 * owner-set order), with a lightweight "Show all N" that widens the same
 * rail — no new shop route. ProductCard is unchanged (its analytics,
 * Want/Save, Add to Cart gating and availability states all still apply).
 *
 * `business` is passed through to ProductCard so its canAddToCart gate
 * checks the real businesses.commerce_enabled flag rather than trusting
 * `purchasable` alone (see ProductCard's own comment on that fallback).
 */
export default function BusinessShopSection({
  products,
  business,
}: {
  products: Product[];
  business: { name: string; slug: string; logo_url: string | null; commerce_enabled: boolean };
}) {
  const [expanded, setExpanded] = useState(false);
  if (products.length === 0) return null;
  const hasMore = products.length > PREVIEW_COUNT;
  const visible = expanded || !hasMore ? products : products.slice(0, PREVIEW_COUNT);

  return (
    <section id="products" className="scroll-mt-24">
      <SectionHeading
        trailing={
          hasMore ? (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="text-metadata font-semibold text-findmi-700 hover:underline">
              {expanded ? "Show fewer" : `Show all ${products.length}`}
            </button>
          ) : null
        }
      >
        Products
      </SectionHeading>
      <div className="-mx-4 mt-3 sm:-mx-6 lg:mx-0">
        <HorizontalScroller className="snap-x snap-mandatory scroll-px-4 sm:scroll-px-6 lg:scroll-px-0 lg:px-0">
          {visible.map((p) => (
            <div key={p.id} className="w-[42%] min-w-[150px] max-w-[176px] shrink-0 snap-start sm:w-44">
              <ProductCard product={{ ...p, business }} />
            </div>
          ))}
          <span aria-hidden="true" className="w-px shrink-0" />
        </HorizontalScroller>
      </div>
    </section>
  );
}
