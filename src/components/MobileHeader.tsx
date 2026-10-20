"use client";

import { usePathname, useRouter } from "next/navigation";
import CartBadge from "./CartBadge";
import HamburgerMenu from "./HamburgerMenu";
import HeaderSearch from "./HeaderSearch";
import Logo from "./Logo";
import QuickCreateMenu from "./QuickCreateMenu";
import type { ResolvedNavItem } from "@/lib/navigation";
import type { BusinessOption } from "@/app/(public)/account/BusinessScopedAction";
import { getSite } from "@/lib/site";

const site = getSite();

export default function MobileHeader({
  navItems,
  authenticated,
  isAdmin,
  businesses,
}: {
  /** Public discovery navigation (nav_items, audience-filtered). */
  navItems: ResolvedNavItem[];
  /** Server-resolved; passed through to HamburgerMenu. */
  authenticated: boolean;
  /** Server-verified Admin session — HamburgerMenu's Admin entry. */
  isAdmin: boolean;
  /** Global Quick-Create pass — the signed-in visitor's managed
   * Businesses, for QuickCreateMenu's Business-scoped rows. Always []
   * when signed out (see (public)/layout.tsx). */
  businesses: BusinessOption[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isHome = pathname === "/";

  return (
    <header
      className="fixed inset-x-0 top-[var(--admin-bar-h)] z-40 flex h-14 items-center justify-between border-b border-black/5 bg-paper/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden"
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
        {site.features.accounts && <CartBadge />}
        {site.features.accounts && <QuickCreateMenu authenticated={authenticated} businesses={businesses} />}
        <HamburgerMenu items={navItems} authenticated={authenticated} isAdmin={isAdmin} businesses={businesses} />
      </div>
    </header>
  );
}
