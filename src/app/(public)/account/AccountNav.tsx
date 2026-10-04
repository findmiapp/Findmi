"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { syncLocalToAccountOnce } from "@/lib/accountSync";
import SignOutConfirm from "@/components/SignOutConfirm";
import NavIcon from "@/components/NavIcon";
import { useBusinesses } from "@/components/BusinessesContext";
import { resolveBusinessScopedHref } from "./businessScope";
import { PlusGlyph, WhichBusinessPanel } from "./BusinessScopedAction";
import { signOut } from "./profile/actions";

/** Launch V2 Pass 1.1 — live mobile QA fix. A `grid grid-cols-4` row
 * structurally GUARANTEES all four primary destinations are visible with
 * no horizontal scroll at any width (four equal columns, never an
 * overflowing row of pills) — Pass 1's `overflow-x-auto` pill strip was
 * mobile-SAFE (nothing broke) but not mobile-CORRECT (Inbox was clipped
 * off-screen at ~390px, per live QA). This grid is load-bearing — keep it
 * even as the cell content itself changes (Visual System Pass 2 switched
 * each cell from a tall icon-above-label tile to a compact icon+label
 * pair to reduce nav height; the 4-column guarantee is unrelated to that
 * and must survive future passes too). */
const PRIMARY_TABS: { href: string; label: string; match: (pathname: string) => boolean; icon: React.ReactNode }[] = [
  { href: "/account", label: "Home", match: (p) => p === "/account", icon: <HomeGlyph /> },
  { href: "/account/schedule", label: "Schedule", match: (p) => p.startsWith("/account/schedule"), icon: <CalendarGlyph /> },
  { href: "/account/business", label: "Business", match: (p) => p.startsWith("/account/business"), icon: <StorefrontGlyph /> },
  { href: "/account/messages", label: "Inbox", match: (p) => p.startsWith("/account/messages"), icon: <MessageGlyph /> },
];

/** Saved/Following/Orders/Profile — real, unchanged destinations, just no
 * longer competing with the four operational jobs above. One tap ("More")
 * away, never removed or buried behind a settings maze. */
const SECONDARY_LINKS = [
  { href: "/account/saved", label: "Saved" },
  { href: "/account/following", label: "Following" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/profile", label: "Profile" },
];

const menuItemClass =
  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-body font-semibold text-primary transition hover:bg-black/[0.04]";

export default function AccountNav() {
  const pathname = usePathname();
  const businesses = useBusinesses();
  const [moreOpen, setMoreOpen] = useState(false);
  // Account Create Navigation Hotfix — which Business-scoped create row
  // (Where I'll Be / Product) currently has its own "Which business?"
  // chooser open, mirroring QuickCreateMenu's identical chooserTab state.
  // Only ever non-null while `moreOpen` is also true — closeMore below
  // always resets both together.
  const [createChooserTab, setCreateChooserTab] = useState<string | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  function closeMore() {
    setMoreOpen(false);
    setCreateChooserTab(null);
  }

  // Every page that renders this tab strip is already an authenticated
  // /account/* route — piggyback the one-time local→account import here
  // (see AccountSync on the Home page, which doesn't render this nav) so
  // it also fires on every other /account/* subpage.
  useEffect(() => {
    syncLocalToAccountOnce();
  }, []);

  // Launch V2 Pass 1.1 — live mobile QA fix for "More does nothing." The
  // popover's own JS always worked (state toggled fine); it was
  // invisible because its old `position: absolute` panel lived inside a
  // row with `overflow-x-auto` — the exact clipping failure mode
  // BusinessScopedAction.tsx's own StripChooser comment already documents
  // for this codebase. The secondary row below now holds only two items
  // (More, Sign Out) and never scrolls, so the panel is never clipped —
  // no portal needed for a fix this contained. Escape closes it too, for
  // basic keyboard support.
  useEffect(() => {
    if (!moreOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) closeMore();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeMore();
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  return (
    <nav aria-label="Account" className="mb-5">
      {/* Findmi Owner Product visual system (Sept 2026) — four equal
          columns (grid, never overflow-x-auto — see the Pass 1.1 note
          above), now a genuinely filled Aqua active state (solid bg,
          white icon+label) instead of a pale tint: the same confident
          "selected = filled" language the redesigned Business Manager
          sidebar uses, so Owner-level nav and Business-level nav now
          read as ONE visual system instead of two different eras of
          Findmi UI. */}
      <div className="grid grid-cols-4 gap-1.5 rounded-xl bg-black/[0.03] p-1">
        {PRIMARY_TABS.map((tab) => {
          const active = tab.match(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-1 py-2 text-center transition ${
                active ? "bg-findmi text-white shadow-sm" : "text-ink/45 hover:text-ink/70"
              }`}
            >
              {tab.icon}
              <span className="whitespace-nowrap text-metadata font-semibold">{tab.label}</span>
            </Link>
          );
        })}
      </div>

      {/* More/Sign Out — plain quiet text links, no hairline divider
          needed now that the primary row above has its own bounded
          background to separate from. */}
      <div className="mt-2 flex items-center justify-between px-1">
        <div ref={moreRef} className="relative">
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            className="flex items-center gap-1 text-metadata font-semibold text-muted transition hover:text-ink"
          >
            More
            <ChevronGlyph className={`h-3 w-3 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
          </button>
          {moreOpen && (
            <div
              role="menu"
              className="absolute left-0 top-full z-20 mt-2 w-56 max-w-[calc(100vw-1.5rem)] rounded-xl border border-black/[0.07] bg-white p-1.5 shadow-lg"
            >
              {/* Account Create Navigation Hotfix — the account-level
                  creation launcher: the same five actions the public
                  header's QuickCreateMenu already offers, surfaced here
                  since SiteChrome swaps that header out for OwnerHeader on
                  every /account/* route (QuickCreateMenu never reaches
                  this surface). Where I'll Be / Product reuse
                  resolveBusinessScopedHref's existing zero/one/many
                  routing (same as every other Business-scoped action on
                  this page) rather than a new decision; Business/Event/
                  Location route straight to their existing canonical
                  creation pages. */}
              <p className="px-2.5 pb-1 pt-1 text-label font-bold text-subtle">
                Create on Findmi
              </p>
              <BusinessScopedMenuItem
                label="Findmi Here"
                tab="findmi-here"
                icon={<PlusGlyph className="h-4 w-4" />}
                businesses={businesses}
                open={createChooserTab === "findmi-here"}
                onToggle={() => setCreateChooserTab((t) => (t === "findmi-here" ? null : "findmi-here"))}
                onNavigate={closeMore}
              />
              <CreateLinkItem
                href="/account/business/new"
                label="Business"
                icon={<NavIcon name="storefront" className="h-4 w-4" />}
                onNavigate={closeMore}
              />
              {/* Event's own page enforces canCurrentUserManageEvents()
                  itself — this is just a link to it, nothing duplicated
                  here; an ineligible account lands on that page's existing
                  eligibility screen, same as every other entry point into
                  Add Event. */}
              <CreateLinkItem
                href="/account/event/new"
                label="Event"
                icon={<NavIcon name="calendar" className="h-4 w-4" />}
                onNavigate={closeMore}
              />
              <CreateLinkItem
                href="/account/location/new"
                label="Location / Venue"
                icon={<NavIcon name="pin" className="h-4 w-4" />}
                onNavigate={closeMore}
              />
              <BusinessScopedMenuItem
                label="Product"
                tab="products"
                icon={<NavIcon name="tag" className="h-4 w-4" />}
                businesses={businesses}
                open={createChooserTab === "products"}
                onToggle={() => setCreateChooserTab((t) => (t === "products" ? null : "products"))}
                onNavigate={closeMore}
              />

              <div className="my-1.5 border-t border-black/[0.06]" />

              {SECONDARY_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  role="menuitem"
                  onClick={closeMore}
                  className="block rounded-lg px-2.5 py-2 text-body font-semibold text-primary transition hover:bg-black/[0.04]"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Account Hub V1 — Sign Out must always be reachable without a
            trip through More first; same signOut action as before, still
            wrapped in a confirm step. Quieter than More (no icon, lower
            opacity) so it stays visually secondary to core navigation. */}
        <SignOutConfirm
          action={signOut}
          className="shrink-0 text-metadata font-semibold text-subtle transition hover:text-ink/60"
        >
          Sign Out
        </SignOutConfirm>
      </div>
    </nav>
  );
}

function HomeGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0">
      <path d="M4 11l8-7 8 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 9.5V20a1 1 0 001 1h10a1 1 0 001-1V9.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function StorefrontGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0">
      <path
        d="M4 9.5L5 4h14l1 5.5M4 9.5a2.2 2.2 0 004.3.7M4 9.5a2.2 2.2 0 004.3.7m0 0a2.2 2.2 0 004.4 0m0 0a2.2 2.2 0 004.4 0m0 0a2.2 2.2 0 004.3-.7M5 10v9.5a1 1 0 001 1h5v-6h2v6h5a1 1 0 001-1V10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Same speech-bubble glyph account/page.tsx's own Messages utility tile
 * already used (Public Messaging V1), sized to match the other three
 * primary-nav icons — duplicated here (not imported) since it's a small,
 * fixed, single-use icon, same convention as PlusGlyph/ChevronGlyph
 * elsewhere in this app rather than a new shared icon module. */
function MessageGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0">
      <path
        d="M4 5.5h16a1 1 0 011 1V15a1 1 0 01-1 1H9l-4 3.5V16H4a1 1 0 01-1-1V6.5a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Account Create Navigation Hotfix — one plain "Create on Findmi" menu
 * row (Business/Event/Location). */
function CreateLinkItem({
  href,
  label,
  icon,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  onNavigate: () => void;
}) {
  return (
    <Link href={href} role="menuitem" onClick={onNavigate} className={menuItemClass}>
      <span className="shrink-0 text-ink/50">{icon}</span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

/** Account Create Navigation Hotfix — the Business-scoped "Create on
 * Findmi" rows (Where I'll Be / Product), mirroring QuickCreateMenu's own
 * BusinessScopedRow: reuses resolveBusinessScopedHref's existing zero/one/
 * many decision (zero -> Add Business, one -> straight into that
 * Business's Manager tab) rather than re-deciding it, and falls back to
 * the same WhichBusinessPanel chooser several managed businesses already
 * use elsewhere on /account. */
function BusinessScopedMenuItem({
  label,
  tab,
  icon,
  businesses,
  open,
  onToggle,
  onNavigate,
}: {
  label: string;
  tab: string;
  icon: React.ReactNode;
  businesses: { id: string; name: string }[];
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const href = resolveBusinessScopedHref(businesses, tab);
  if (href) {
    return <CreateLinkItem href={href} label={label} icon={icon} onNavigate={onNavigate} />;
  }
  return (
    <div className="relative">
      <button type="button" role="menuitem" aria-haspopup="true" aria-expanded={open} onClick={onToggle} className={menuItemClass}>
        <span className="shrink-0 text-ink/50">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
      {open && (
        <div onClick={onNavigate}>
          <WhichBusinessPanel businesses={businesses} tab={tab} className="left-0 right-0" />
        </div>
      )}
    </div>
  );
}
