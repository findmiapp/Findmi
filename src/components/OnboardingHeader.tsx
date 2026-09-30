"use client";

import { useRouter } from "next/navigation";
import Logo from "./Logo";

/** /Join Visual Convergence pass — a focused onboarding header, scoped to
 * the `/join` entry screen only (see SiteChrome's own route check). The
 * full public header (search/bag/quick-create/hamburger) creates
 * unnecessary exits on an account-creation screen; this is just the
 * wordmark and a back control, same back-button treatment MobileHeader
 * already uses elsewhere. Doesn't touch MobileHeader/NavDesktop/
 * HamburgerMenu/DrawerUtilityStrip at all — those keep rendering
 * unchanged on every other route. */
export default function OnboardingHeader() {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-40 border-b border-black/5 bg-paper/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-lg items-center gap-1 px-3 pt-[env(safe-area-inset-top)] sm:px-6">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink transition active:scale-90"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <Logo heightClassName="h-7" />
      </div>
    </header>
  );
}
