"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import CartBadge from "./CartBadge";
import HamburgerMenu from "./HamburgerMenu";
import Logo from "./Logo";
import type { ResolvedNavItem } from "@/lib/navigation";

export default function MobileHeader({ navItems }: { navItems: ResolvedNavItem[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const isHome = pathname === "/";

  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-black/5 bg-paper/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
      <div className="flex items-center gap-1">
        {!isHome && (
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink transition active:scale-90"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path
                d="M15 6l-6 6 6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        <Logo heightClassName="h-11" />
      </div>

      <div className="flex items-center gap-0.5">
        <Link
          href="/businesses"
          aria-label="Search"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink transition active:scale-90"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
            <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="M20 20l-4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </Link>
        <CartBadge />
        <HamburgerMenu items={navItems} />
      </div>
    </header>
  );
}
