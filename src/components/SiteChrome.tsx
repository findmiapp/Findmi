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

  if (isOwner) {
    return (
      <>
        <OwnerHeader isAdmin={isAdmin} />
        <div className="flex-1">{children}</div>
        {footer}
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
