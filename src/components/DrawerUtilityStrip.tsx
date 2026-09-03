"use client";

import Link from "next/link";
import CartBadge from "./CartBadge";
import { signOut } from "@/app/(public)/account/profile/actions";

const iconButtonClass =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink transition active:scale-90";

/**
 * Thin utility icon row at the very top of the mobile drawer — Email,
 * Phone, Cart, Login/Logout, Account. Reuses existing routes/actions/
 * data rather than inventing any of its own:
 *   - Cart is the exact same CartBadge already used in MobileHeader (icon
 *     variant, same live localStorage count) — not a second cart icon.
 *   - Login/Logout is state-aware off `authenticated`, which the layout
 *     resolves server-side via the same /account auth Supabase already
 *     uses everywhere else (see (public)/layout.tsx) — logged out links
 *     to the existing /login route; logged in submits the exact same
 *     signOut() Server Action account/profile's own "Sign Out" button
 *     already calls. No new auth check, no new sign-out mechanism.
 *   - Email/Phone come from the founder-editable site_sections "contact"
 *     row (Admin → Site → Contact Info — see lib/contact-info.ts) and are
 *     simply absent (not a dead icon) when that field is blank.
 * `onNavigate` closes the drawer — every action here either leaves the
 * page (Cart/Account/Login/Logout) or opens an external app (mailto:/
 * tel:), so every icon closes the drawer the same way every other drawer
 * link already does.
 */
export default function DrawerUtilityStrip({
  authenticated,
  email,
  phone,
  onNavigate,
}: {
  authenticated: boolean;
  email: string | null;
  phone: string | null;
  onNavigate: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 py-2">
      {email && (
        <a href={`mailto:${email}`} onClick={onNavigate} aria-label="Email FindMi" className={iconButtonClass}>
          <EmailGlyph className="h-5 w-5" />
        </a>
      )}
      {phone && (
        <a href={`tel:${phone}`} onClick={onNavigate} aria-label="Call FindMi" className={iconButtonClass}>
          <PhoneGlyph className="h-5 w-5" />
        </a>
      )}
      <span onClick={onNavigate}>
        <CartBadge />
      </span>
      {authenticated ? (
        <form action={signOut} onSubmit={onNavigate}>
          <button type="submit" aria-label="Log out" className={iconButtonClass}>
            <LogoutGlyph className="h-5 w-5" />
          </button>
        </form>
      ) : (
        <Link href="/login" onClick={onNavigate} aria-label="Log in" className={iconButtonClass}>
          <LoginGlyph className="h-5 w-5" />
        </Link>
      )}
      <Link href="/account" onClick={onNavigate} aria-label="Account" className={iconButtonClass}>
        <AccountGlyph className="h-5 w-5" />
      </Link>
    </div>
  );
}

function EmailGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 6.5l8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PhoneGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M6.5 3.5h2.3l1.4 4.3-2 1.6a11.5 11.5 0 006.4 6.4l1.6-2 4.3 1.4v2.3a1.5 1.5 0 01-1.6 1.5A16 16 0 015 5.1a1.5 1.5 0 011.5-1.6z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LoginGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M11 3.5H6a1.5 1.5 0 00-1.5 1.5v14A1.5 1.5 0 006 20.5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.5 8l4 4-4 4M18.3 12H9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LogoutGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M13 3.5h5A1.5 1.5 0 0119.5 5v14a1.5 1.5 0 01-1.5 1.5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 8l-4 4 4 4M5.7 12h8.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AccountGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 20c1.3-3.5 4.3-5.5 7.5-5.5s6.2 2 7.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
