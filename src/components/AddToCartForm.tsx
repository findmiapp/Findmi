"use client";

import Link from "next/link";
import { useState } from "react";
import { addToCart } from "@/lib/cart";
import type { FulfillmentOptionDisplay } from "@/lib/data";

export default function AddToCartForm({
  productId,
  options,
  sourceChannel,
}: {
  productId: string;
  options: FulfillmentOptionDisplay[];
  sourceChannel?: string | null;
}) {
  const [selectedKey, setSelectedKey] = useState(() => optionKey(options[0]));
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  if (options.length === 0) {
    return (
      <p className="text-sm text-ink/50">
        This item isn&rsquo;t available for checkout right now — check back soon.
      </p>
    );
  }

  const selected = options.find((o) => optionKey(o) === selectedKey) ?? options[0];

  return (
    <div className="flex flex-col gap-3">
      {options.length > 1 && (
        <div>
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/50">
            Fulfillment
          </span>
          <div className="flex flex-col gap-1.5">
            {options.map((o) => {
              const key = optionKey(o);
              return (
                <label
                  key={key}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm ${
                    selectedKey === key ? "border-ink/40 bg-ink/[0.03]" : "border-black/10"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="fulfillment"
                      checked={selectedKey === key}
                      onChange={() => setSelectedKey(key)}
                      className="h-4 w-4 accent-findmi"
                    />
                    {o.label}
                  </span>
                  <span className="shrink-0 text-ink/60">{o.price > 0 ? `$${o.price.toFixed(2)}` : "Free"}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            aria-label="Decrease quantity"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 text-ink"
          >
            −
          </button>
          <span className="w-6 text-center text-sm text-ink">{quantity}</span>
          <button
            type="button"
            onClick={() => setQuantity((q) => q + 1)}
            aria-label="Increase quantity"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 text-ink"
          >
            +
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            addToCart({
              productId,
              quantity,
              fulfillmentMethod: selected.method,
              appearanceId: selected.appearanceId,
              sourceChannel: sourceChannel ?? null,
            });
            setAdded(true);
          }}
          className="rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Add to Cart
        </button>
      </div>

      {added && (
        <p className="text-sm text-findmi-700">
          Added to cart —{" "}
          <Link href="/cart" className="font-semibold underline underline-offset-2">
            view cart
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function optionKey(o: FulfillmentOptionDisplay | undefined): string {
  if (!o) return "";
  return `${o.method}:${o.appearanceId ?? ""}`;
}
