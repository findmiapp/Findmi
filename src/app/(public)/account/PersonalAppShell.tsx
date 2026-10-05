"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBusinesses } from "@/components/BusinessesContext";
import NavIcon from "@/components/NavIcon";
import SignOutConfirm from "@/components/SignOutConfirm";
import AccountContextSwitcher from "@/components/account/AccountContextSwitcher";
import type { AccountBusinessContext } from "@/lib/accountContext";
import { signOut } from "./profile/actions";

/** Global Account Context Switcher V1 — useBusinesses() already carries
 * slug/logoUrl/role now that (public)/layout.tsx feeds it via the shared
 * getAccountContexts helper; BusinessOption's fields stay optional so
 * every other existing consumer of that context keeps compiling, so this
 * is just a narrowing map, never a second Supabase read. */
function toSwitcherBusinesses(businesses: { id: string; name: string; slug?: string | null; logoUrl?: string | null; role?: AccountBusinessContext["role"] }[]): AccountBusinessContext[] {
  return businesses.map((b) => ({ id: b.id, name: b.name, slug: b.slug ?? null, logoUrl: b.logoUrl ?? null, role: b.role ?? "owner" }));
}

/** Account Shell Pass 1 — the Personal/shared account shell. Same
 * product family as Business V2's BusinessAppShell (compact nav, filled-
 * Aqua active state, a context bar above the content), but a genuinely
 * different context: PERSONAL (the signed-in person — My World, Journal,
 * Saved, Following, Schedule, Inbox, Purchases, Profile), never Business
 * management. A person managing a Business does not stop being a person —
 * this shell is what every /account/* page renders when it's showing that
 * person's own stuff, not a specific Business's workspace.
 *
 * One canonical nav-item list (NAV_ITEMS below) drives both the mobile
 * bottom bar (its `primary` items, plus a More trigger) and the desktop
 * rail (every item) — no second, divergent definition. Active state is
 * derived from the real pathname (usePathname), not a prop a caller could
 * get wrong — every migrated page only has to wrap its existing content in
 * <PersonalAppShell>, nothing else to configure.
 *
 * My World is a real nav item here but links to /my-world — a route
 * outside /account entirely, with its own existing public-site chrome.
 * This shell never absorbs or duplicates it, only links to it (see
 * CLAUDE.md pass notes); because the shell only ever renders under
 * /account/*, that tab is simply never the active one, which is correct. */

type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: ReactNode;
  /** Exact-match active test (Home only) vs. prefix match (every other
   * real /account/* destination). My World never matches — the shell
   * never renders on that route. */
  match: (pathname: string) => boolean;
  /** Shown in the mobile bottom bar's 4 data-driven slots (the 5th is the
   * More trigger). Every item still renders in the desktop rail either
   * way — desktop has room for all of them, no desktop "More" needed. */
  primary: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { key: "home", label: "Home", href: "/account", icon: <NavIcon name="home" className="h-[22px] w-[22px]" />, match: (p) => p === "/account", primary: true },
  { key: "myworld", label: "My World", href: "/my-world", icon: <WorldGlyph className="h-[22px] w-[22px]" />, match: () => false, primary: true },
  { key: "schedule", label: "Schedule", href: "/account/schedule", icon: <NavIcon name="calendar" className="h-[22px] w-[22px]" />, match: (p) => p.startsWith("/account/schedule"), primary: true },
  { key: "inbox", label: "Inbox", href: "/account/messages", icon: <InboxGlyph className="h-[22px] w-[22px]" />, match: (p) => p.startsWith("/account/messages"), primary: true },
  { key: "saved", label: "Saved", href: "/account/saved", icon: <NavIcon name="bookmark" className="h-[22px] w-[22px]" />, match: (p) => p.startsWith("/account/saved"), primary: false },
  { key: "following", label: "Following", href: "/account/following", icon: <NavIcon name="person" className="h-[22px] w-[22px]" />, match: (p) => p.startsWith("/account/following"), primary: false },
  { key: "orders", label: "Purchases", href: "/account/orders", icon: <NavIcon name="cart" className="h-[22px] w-[22px]" />, match: (p) => p.startsWith("/account/orders"), primary: false },
  { key: "profile", label: "Profile", href: "/account/profile", icon: <NavIcon name="person" className="h-[22px] w-[22px]" />, match: (p) => p.startsWith("/account/profile"), primary: false },
];

export default function PersonalAppShell({ displayName, children }: { displayName: string | null; children: ReactNode }) {
  const pathname = usePathname();
  const businesses = useBusinesses();
  const [moreOpen, setMoreOpen] = useState(false);

  const primaryItems = NAV_ITEMS.filter((i) => i.primary);
  const secondaryItems = NAV_ITEMS.filter((i) => !i.primary);
  const moreActive = secondaryItems.some((i) => i.match(pathname));

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-4 sm:px-6 lg:pb-10 lg:pt-6">
      <PersonalContextBar displayName={displayName} businesses={toSwitcherBusinesses(businesses)} />

      <div className="mt-5 lg:grid lg:grid-cols-[192px_1fr] lg:items-start lg:gap-10">
        {/* Desktop rail — every item, no desktop "More" (8 short labels
            fits a sidebar cleanly; see BusinessAppShell's own rail for the
            same filled-Aqua active-state language). */}
        <nav aria-label="Personal account" className="hidden lg:sticky lg:top-[4.25rem] lg:flex lg:flex-col lg:gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-button font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40 ${
                  active ? "bg-findmi-50 text-accent" : "text-muted hover:bg-black/[0.03] hover:text-primary"
                }`}
              >
                <span className={active ? "text-findmi-700" : "text-ink/40"}>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
          <div className="mt-2 border-t border-black/[0.06] pt-2">
            <SignOutConfirm
              action={signOut}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-button font-semibold text-subtle transition hover:bg-black/[0.03] hover:text-primary"
            >
              Sign Out
            </SignOutConfirm>
          </div>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>

      {/* Mobile bottom tab bar — same fixed/safe-area/thumb-reachable
          treatment as Business V2's own bottom bar (BusinessAppShell),
          but the PERSONAL information architecture: Home, My World,
          Schedule, Inbox, and More (Saved/Following/Purchases/Profile +
          Businesses switcher + Sign Out). */}
      <nav
        aria-label="Personal account"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-black/[0.07] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {primaryItems.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 pt-1.5 text-[10.5px] font-semibold leading-tight transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-findmi/40 ${
                  active ? "text-accent" : "text-ink/45 hover:text-ink/70"
                }`}
              >
                <span className={`flex h-7 w-12 items-center justify-center rounded-full transition ${active ? "bg-findmi-50" : ""}`}>{item.icon}</span>
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 pt-1.5 text-[10.5px] font-semibold leading-tight transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-findmi/40 ${
              moreActive ? "text-accent" : "text-ink/45 hover:text-ink/70"
            }`}
          >
            <span className={`flex h-7 w-12 items-center justify-center rounded-full transition ${moreActive ? "bg-findmi-50" : ""}`}>
              <MoreGlyph className="h-[22px] w-[22px]" />
            </span>
            <span className="max-w-full truncate">More</span>
          </button>
        </div>
      </nav>

      {moreOpen && (
        <MorePanel items={secondaryItems} pathname={pathname} onClose={() => setMoreOpen(false)} />
      )}
    </div>
  );
}

function PersonalContextBar({
  displayName,
  businesses,
}: {
  displayName: string | null;
  businesses: AccountBusinessContext[];
}) {
  const label = displayName || "Your Findmi Account";
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-label font-bold uppercase text-subtle">Personal</p>
        <p className="mt-0.5 truncate font-display text-section-title-lg font-bold text-primary">{label}</p>
      </div>
      <AccountContextSwitcher current={{ kind: "personal" }} personalLabel={label} businesses={businesses} />
    </div>
  );
}

/** Mobile "More" — same bottom-sheet/centered-dialog convention as
 * Business V2's own AddToPresence composer (fixed inset-0 backdrop,
 * rounded sheet on mobile, Esc/backdrop closes). Lists the nav items that
 * don't fit the primary bottom row, the Businesses switcher (same
 * destinations as the desktop context bar — never a second routing
 * decision), and Sign Out. */
function MorePanel({
  items,
  pathname,
  onClose,
}: {
  items: NavItem[];
  pathname: string;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4" role="presentation">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="More"
        className="relative w-full max-w-md rounded-t-3xl bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-xl sm:rounded-3xl sm:p-5"
      >
        <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-black/10 sm:hidden" />
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="font-display text-section-title font-bold text-primary">More</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition hover:bg-black/[0.04] hover:text-primary"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <ul className="mt-2 flex flex-col gap-1">
          {items.map((item) => {
            const active = item.match(pathname);
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-body font-semibold transition hover:bg-black/[0.04] ${
                    active ? "text-accent" : "text-primary"
                  }`}
                >
                  <span className={active ? "text-findmi-700" : "text-ink/50"}>{item.icon}</span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-1 border-t border-black/[0.06] pt-1">
          <SignOutConfirm
            action={signOut}
            className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-body font-semibold text-subtle transition hover:bg-black/[0.04] hover:text-primary"
          >
            Sign Out
          </SignOutConfirm>
        </div>
      </div>
    </div>
  );
}

function WorldGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <ellipse cx="12" cy="12" rx="3.4" ry="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 12h17" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function InboxGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M4 13l2.5-7.5h11L20 13v5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18v-5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function MoreGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

