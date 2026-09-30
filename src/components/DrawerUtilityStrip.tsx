"use client";

import Link from "next/link";
import CartBadge from "./CartBadge";
import SignOutConfirm from "./SignOutConfirm";
import { signOut } from "@/app/(public)/account/profile/actions";

const pillClass =
  "flex h-9 flex-1 shrink-0 items-center justify-center whitespace-nowrap rounded-xl text-[11px] font-bold uppercase tracking-wide transition active:scale-95";

/**
 * Thin utility row at the very top of the mobile drawer — Cart only
 * (Menu Polish + Editable About pass), extended in the Mobile Menu Auth
 * pass into one 3-item Bag/account-state row:
 *   logged out -> [ Bag ] [ Log In ] [ Join for Free ]
 *   logged in  -> [ Bag ] [ Account ] [ Sign Out ]
 * `authenticated` is the same server-resolved boolean HamburgerMenu
 * already threads down for its own bottom Sign Out row — never
 * determined client-side, no second auth mechanism. Log In/Join for
 * Free/Account link to the site's existing real /login, /join, /account
 * routes; Sign Out reuses the exact same signOut Server Action +
 * SignOutConfirm confirmation dialog the drawer's bottom Sign Out row
 * (and /account/profile) already use — not a second logout
 * implementation. Cart is the exact same CartBadge already used in
 * MobileHeader (icon variant, same live localStorage count), unchanged.
 * `onNavigate` closes the drawer, same as every other drawer control.
 */
export default function DrawerUtilityStrip({
  onNavigate,
  authenticated,
}: {
  onNavigate: () => void;
  authenticated: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-black/5 px-4 py-2">
      <span onClick={onNavigate}>
        <CartBadge />
      </span>
      {authenticated ? (
        <>
          <Link
            href="/account"
            onClick={onNavigate}
            className={`${pillClass} border border-findmi/30 bg-findmi-50 text-findmi-700 hover:bg-findmi-100`}
          >
            Account
          </Link>
          <SignOutConfirm
            action={signOut}
            ariaLabel="Sign out"
            className={`${pillClass} border border-black/10 text-ink/60 hover:bg-black/[0.03]`}
          >
            Sign Out
          </SignOutConfirm>
        </>
      ) : (
        <>
          <Link
            href="/login"
            onClick={onNavigate}
            className={`${pillClass} border border-black/10 text-ink/70 hover:bg-black/[0.03]`}
          >
            Log In
          </Link>
          <Link
            href="/join"
            onClick={onNavigate}
            className={`${pillClass} flex-[1.3] bg-findmi text-white hover:bg-findmi-600`}
          >
            Join for Free
          </Link>
        </>
      )}
    </div>
  );
}
