"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { syncLocalToAccountOnce } from "@/lib/accountSync";
import SignOutConfirm from "@/components/SignOutConfirm";
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

export default function AccountNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

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
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  return (
    <nav aria-label="Account" className="mb-4">
      {/* Visual System Pass 2 — chrome, not page content. Four equal
          columns (grid, never overflow-x-auto — see the Pass 1.1 note
          above) but each cell is now a compact icon+label PAIR, not a
          tall icon-above-label tile: no background fill, no filled Aqua
          block. Selection reads through color+weight (and a quiet Aqua
          tint) alone — deliberately NOT the same underline mechanism
          Business Manager's own tabs use (page.tsx's "Business sections"
          nav), so an owner can tell OWNER NAV and BUSINESS NAV apart at a
          glance even though both borrow the same restrained Aqua/
          typography language. */}
      <div className="grid grid-cols-4 gap-1">
        {PRIMARY_TABS.map((tab) => {
          const active = tab.match(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center justify-center gap-1 rounded-lg px-1 py-2 text-center transition ${
                active ? "bg-findmi-50 text-findmi-700" : "text-ink/45 hover:text-ink/70"
              }`}
            >
              {tab.icon}
              <span className={`whitespace-nowrap text-xs ${active ? "font-bold" : "font-semibold"}`}>{tab.label}</span>
            </Link>
          );
        })}
      </div>

      {/* More/Sign Out demoted to plain quiet text links (no pill
          backgrounds) — same restrained style as the Business Manager's
          own "Settings" link — with a hairline divider marking them as a
          secondary row beneath the four primary destinations. */}
      <div className="mt-2 flex items-center justify-between border-t border-black/5 pt-2">
        <div ref={moreRef} className="relative">
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            className="flex items-center gap-1 text-xs font-semibold text-ink/50 transition hover:text-ink"
          >
            More
            <ChevronGlyph className={`h-3 w-3 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
          </button>
          {moreOpen && (
            <div role="menu" className="absolute left-0 top-full z-20 mt-2 w-44 rounded-2xl border border-black/10 bg-white p-1.5 shadow-lg">
              {SECONDARY_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  role="menuitem"
                  onClick={() => setMoreOpen(false)}
                  className="block rounded-xl px-2.5 py-2 text-sm font-semibold text-ink transition hover:bg-black/[0.04]"
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
          className="shrink-0 text-xs font-semibold text-ink/35 transition hover:text-ink/60"
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
