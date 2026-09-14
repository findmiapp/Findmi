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
 * off-screen at ~390px, per live QA). Icon-above-label per cell so a
 * label never competes with the icon for the column's own width. */
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
    <nav aria-label="Account" className="mb-6">
      <div className="grid grid-cols-4 gap-1.5">
        {PRIMARY_TABS.map((tab) => {
          const active = tab.match(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-xl py-2.5 text-center transition ${
                active ? "bg-findmi text-white" : "bg-black/[0.04] text-ink/60 hover:bg-black/[0.07]"
              }`}
            >
              {tab.icon}
              <span className="text-[10px] font-bold uppercase tracking-wide">{tab.label}</span>
            </Link>
          );
        })}
      </div>

      <div className="mt-1.5 flex items-center justify-between">
        <div ref={moreRef} className="relative">
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            className="flex items-center gap-1 rounded-full bg-black/[0.04] px-3.5 py-2 text-xs font-semibold text-ink/60 transition hover:bg-black/[0.07]"
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
            wrapped in a confirm step. */}
        <SignOutConfirm
          action={signOut}
          className="shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold text-ink/40 transition hover:bg-black/[0.04] hover:text-ink/70"
        >
          Sign Out
        </SignOutConfirm>
      </div>
    </nav>
  );
}

function HomeGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path d="M4 11l8-7 8 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 9.5V20a1 1 0 001 1h10a1 1 0 001-1V9.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function StorefrontGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
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
 * already used (Public Messaging V1), sized up to match the other three
 * primary-nav icons — duplicated here (not imported) since it's a small,
 * fixed, single-use icon, same convention as PlusGlyph/ChevronGlyph
 * elsewhere in this app rather than a new shared icon module. */
function MessageGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
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
