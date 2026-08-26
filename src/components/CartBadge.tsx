"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getCartCount, onCartChange } from "@/lib/cart";

/** Small cart-access icon + item-count badge — the only nav change this
 * pass makes (Part 17: "Add visible cart access... do not radically
 * redesign the navigation"). Reads localStorage, so it's a client island
 * even when embedded in an otherwise server-rendered header. */
export default function CartBadge({ variant = "icon" }: { variant?: "icon" | "text" }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(getCartCount());
    return onCartChange(() => setCount(getCartCount()));
  }, []);

  if (variant === "text") {
    return (
      <Link href="/cart" className="relative text-sm font-medium text-ink/70 transition hover:text-ink">
        Cart
        {count > 0 && (
          <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-findmi px-1 text-[10px] font-bold text-white">
            {count}
          </span>
        )}
      </Link>
    );
  }

  return (
    <Link
      href="/cart"
      aria-label="Cart"
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink transition active:scale-90"
    >
      {/* UI polish pass — swapped the handle+basket+wheels cart glyph for
          a minimal shopping-bag outline (rounded handle + simple body,
          no wheels/dots) to match the cleaner Search/Hamburger icons
          beside it. Same tap target (h-9 w-9, unchanged) — only the
          visible artwork changed. */}
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
        <path
          d="M9 7.5V6a3 3 0 116 0v1.5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M6.2 7.5h11.6l1 12.3a1.5 1.5 0 01-1.5 1.6H6.7a1.5 1.5 0 01-1.5-1.6l1-12.3z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {count > 0 && (
        <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-findmi px-0.5 text-[9px] font-bold text-white">
          {count}
        </span>
      )}
    </Link>
  );
}
