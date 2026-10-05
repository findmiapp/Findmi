"use client";

import { usePathname } from "next/navigation";
import OwnerHeader from "./OwnerHeader";
import OnboardingHeader from "./OnboardingHeader";

/** Owner Command Center V4.1 — root cause fix for the "three stacked
 * navigation systems" problem: (public)/layout.tsx is the ONE shared
 * layout for every public AND /account/* route, and it used to render
 * AdminToolbar + MobileHeader + NavDesktop unconditionally above
 * whatever page followed — on /account that meant the founder Admin bar,
 * the full public commerce/discovery header, AND AccountNav (rendered by
 * the page itself) all stacking before any real Owner content. Next.js
 * layouts don't receive the current pathname as a prop, so this one
 * client boundary (the same "use client" + usePathname() pattern
 * MobileHeader/NavDesktop already use) is the smallest way to make the
 * ALREADY-SERVER-RENDERED chrome route-aware without duplicating the
 * data-fetching in (public)/layout.tsx or touching any of the 13
 * individual /account/* page files: Server Components (AdminToolbar) can
 * be passed in as props and conditionally rendered by a Client Component
 * without ever being imported into the client bundle — the officially
 * supported composition pattern. Public routes are completely
 * unaffected: `isOwner` is false there, so the exact same three
 * components render in the exact same order as before this pass. */
export default function SiteChrome({
  adminToolbar,
  mobileHeader,
  navDesktop,
  footer,
  isAdmin,
  children,
}: {
  adminToolbar: React.ReactNode;
  mobileHeader: React.ReactNode;
  navDesktop: React.ReactNode;
  footer: React.ReactNode;
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isOwner = pathname === "/account" || pathname.startsWith("/account/");
  // /Join Visual Convergence pass, extended by the Auth Returning-User +
  // Onboarding Shell Correction pass — the focused pre-authentication
  // auth/onboarding journey: the universal entry screen plus every
  // account-creation/login/recovery screen a visitor in that journey can
  // land on. Exact path matches only, never prefixes/subroutes — /join's
  // own subroutes (/join/start, /join/passbook, /join/welcome,
  // /join/business) are deliberately NOT included here (unchanged from
  // the prior pass: only /join's own presentation was ever flagged as
  // noisy) and keep the normal public header, same as every other
  // authenticated/account route.
  const AUTH_JOURNEY_ROUTES = new Set([
    "/join",
    "/signup",
    "/signup/check-email",
    "/signup/confirm-failed",
    "/signup/account-exists",
    "/login",
    "/forgot-password",
    "/reset-password",
  ]);
  const isOnboardingEntry = AUTH_JOURNEY_ROUTES.has(pathname);

  // Contextual Moment Composer V1 — the focused Journal/Moment create and
  // edit surfaces (never the archive/index at /my-world/journal itself,
  // which stays a normal browsing page). Live mobile QA found the full
  // public footer (About/For Business/Privacy/Terms/©) rendering directly
  // beneath a sparse wizard step, making a focused creation flow read like
  // an ordinary webpage. The public header/nav is deliberately preserved
  // here (unlike the /account branch below) — the QA finding was about the
  // footer and lost Moment context, not the header, and this route isn't
  // an app shell with its own nav to avoid doubling up with.
  const isJournalComposer = pathname === "/my-world/journal/new" || /^\/my-world\/journal\/[^/]+\/edit$/.test(pathname);
  if (isJournalComposer) {
    return (
      <>
        {adminToolbar}
        {mobileHeader}
        {navDesktop}
        <div className={`flex-1 ${isAdmin ? "pt-[calc(3.5rem+1.75rem)]" : "pt-14"} md:pt-0`}>{children}</div>
      </>
    );
  }

  if (isOwner) {
    // /account V2 — the Business app shell has a fixed bottom tab bar on
    // mobile (/account/business/<id>), so the footer gets matching bottom
    // room there and is never hidden behind it.
    const hasBusinessTabBar = /^\/account\/business\/(?!new$)[^/]+$/.test(pathname);
    // Account Shell Pass 1 — the new Personal/shared account shell
    // (PersonalAppShell) has the exact same fixed mobile bottom tab bar,
    // on every route it wraps. Listed explicitly (not a broad /^\/account/
    // match) so this never accidentally covers a route PersonalAppShell
    // doesn't actually render on (e.g. Event/Location Managers, still on
    // legacy AccountNav with no fixed bottom nav of their own).
    const PERSONAL_SHELL_ROUTES = new Set([
      "/account",
      "/account/schedule",
      "/account/saved",
      "/account/following",
      "/account/orders",
      "/account/profile",
      "/account/messages",
      "/account/business",
    ]);
    const hasPersonalShellTabBar =
      PERSONAL_SHELL_ROUTES.has(pathname) || pathname.startsWith("/account/orders/") || pathname.startsWith("/account/messages/");
    const hasFixedBottomNav = hasBusinessTabBar || hasPersonalShellTabBar;
    // Global Account Context Switcher V1, Section 25 footer audit — Event
    // and Location Manager (EntityManagerContextBar, no fixed bottom nav
    // of their own) had the exact same stray public footer problem as the
    // Business shell above, just never addressed when that pass scoped
    // itself to Business only. Plain suppression, no bottom-clearance div
    // needed — unlike hasBusinessTabBar, there's no fixed nav here to clear.
    const isEntityManager = /^\/account\/(event|location)\/[^/]+$/.test(pathname);
    // Business Account Correction Pass (#10) — the public About/For
    // Business/Privacy/Terms footer was rendering inside BusinessAppShell
    // destinations too, sitting right above the fixed bottom tab bar
    // (just padded to clear it, never actually suppressed) — a stray
    // piece of the public marketing site inside what's meant to be a
    // focused app shell. Suppressed ONLY for the Business shell
    // specifically (hasBusinessTabBar); Personal shell routes are
    // untouched here — out of this pass's scope. The bottom clearance
    // div stays either way so content never sits under the fixed nav.
    return (
      <>
        <OwnerHeader isAdmin={isAdmin} />
        <div className="flex-1">{children}</div>
        {hasBusinessTabBar ? (
          <div className="pb-[calc(56px+env(safe-area-inset-bottom))] lg:pb-0" />
        ) : isEntityManager ? null : (
          <div className={hasFixedBottomNav ? "pb-[calc(56px+env(safe-area-inset-bottom))] lg:pb-0" : undefined}>{footer}</div>
        )}
      </>
    );
  }

  if (isOnboardingEntry) {
    return (
      <>
        <OnboardingHeader />
        <div className="flex-1">{children}</div>
        {footer}
      </>
    );
  }

  return (
    <>
      {adminToolbar}
      {mobileHeader}
      {navDesktop}
      <div className={`flex-1 ${isAdmin ? "pt-[calc(3.5rem+1.75rem)]" : "pt-14"} md:pt-0`}>{children}</div>
      {footer}
    </>
  );
}
