"use client";

import { usePathname, useRouter } from "next/navigation";
import CartBadge from "./CartBadge";
import HamburgerMenu from "./HamburgerMenu";
import HeaderSearch from "./HeaderSearch";
import Logo from "./Logo";
import type { ResolvedNavItem } from "@/lib/navigation";

export default function MobileHeader({
  navItems,
  adminToolbar = false,
  authenticated,
  contactEmail,
  contactPhone,
}: {
  navItems: ResolvedNavItem[];
  /** True only when the server-verified admin session gates AdminToolbar
   * into rendering above this header on mobile (see (public)/layout.tsx) —
   * shifts this header down by its 1.75rem height so the two stack
   * instead of overlapping. Never itself a source of truth for admin
   * status; just a layout offset the layout hands down. */
  adminToolbar?: boolean;
  /** Passed straight through to HamburgerMenu's drawer utility strip —
   * see that component and DrawerUtilityStrip for what each drives. */
  authenticated: boolean;
  contactEmail: string | null;
  contactPhone: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isHome = pathname === "/";

  return (
    <header
      className={`fixed inset-x-0 ${adminToolbar ? "top-7" : "top-0"} z-40 flex h-14 items-center justify-between border-b border-black/5 bg-paper/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden`}
    >
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
        <HeaderSearch variant="icon" />
        <CartBadge />
        <HamburgerMenu
          items={navItems}
          authenticated={authenticated}
          contactEmail={contactEmail}
          contactPhone={contactPhone}
        />
      </div>
    </header>
  );
}
