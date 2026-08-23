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
          <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-findmi px-1 text-[10px] font-bold text-ink">
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
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <path
          d="M4 6h2l1.2 10.4A2 2 0 009.2 18h7.6a2 2 0 002-1.7L20 8H7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="21" r="1.4" fill="currentColor" />
        <circle cx="17" cy="21" r="1.4" fill="currentColor" />
      </svg>
      {count > 0 && (
        <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-findmi px-0.5 text-[9px] font-bold text-ink">
          {count}
        </span>
      )}
    </Link>
  );
}
