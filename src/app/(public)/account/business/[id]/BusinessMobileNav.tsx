"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { NavIconKey } from "@/lib/navigation";

/** Mobile Navigation Fix, revised by the Stable Primary Nav pass —
 * Business Manager has more destinations than fit on a phone screen
 * (Overview/Where I'll Be/Analytics/Profile/Products/Orders/Settings).
 * The old horizontally-scrolling tab strip had no affordance that more
 * destinations existed off-screen (live QA: "Couldn't even tell I had
 * to scroll to get to products" — Products was completely
 * undiscoverable). Replaced with a deliberately finite 4-control row:
 * Overview, Where I'll Be, and Analytics stay directly tappable and
 * ALWAYS present (real-device QA found the original 3-control version
 * let Analytics disappear into the "More ▾" relabel the moment it
 * wasn't the active tab — the primary nav's own shape changed depending
 * on where the owner was, and Analytics, a major Pro conversion
 * surface, needs a permanent slot); a fourth control opens every
 * remaining destination and relabels itself to the current one
 * ("Products ▾") whenever the owner is inside one of THOSE, so the
 * active location is never ambiguous.
 *
 * Items size to their own label's content (no icons, no forced
 * equal-width columns) rather than four identical wide columns — four
 * full, un-abbreviated labels ("Overview"/"Where I'll Be"/"Analytics"/
 * "More") genuinely don't fit at 360-390px as equal-width columns with
 * icons (confirmed empirically: real Playwright renders at 360/390px
 * truncated "Where I'll Be" under the old equal-width+icon treatment);
 * dropping the leading icon and letting each label claim only the width
 * it needs (via `justify-between`, not `flex-1`) recovers exactly
 * enough room for every label to render in full, unclipped, un-
 * abbreviated, at both widths — verified via real rendered screenshots,
 * not estimated.
 *
 * Same outside-click/Escape-to-close interaction as AccountNav's own
 * "More" popover (this file's closest existing analog) — a real client
 * component rather than a bare <details>, since this specific menu
 * (unlike the page's own Business-switcher <details>) needs that
 * behavior per this pass's own requirement, unchanged by this revision.
 * Desktop never renders this — the sidebar in page.tsx already shows
 * every destination. */
export default function BusinessMobileNav({
  basePath,
  primaryTabs,
  moreTabs,
  activeTab,
}: {
  basePath: string;
  primaryTabs: { key: string; label: string; icon: NavIconKey }[];
  moreTabs: { key: string; label: string }[];
  activeTab: string;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeMoreTab = moreTabs.find((t) => t.key === activeTab) ?? null;

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <nav
      aria-label="Business sections"
      className="mt-4 flex items-stretch justify-between gap-1 rounded-xl bg-black/[0.03] p-1 lg:hidden"
    >
      {primaryTabs.map((t) => {
        const active = t.key === activeTab;
        return (
          <Link
            key={t.key}
            href={`${basePath}?tab=${t.key}`}
            aria-current={active ? "page" : undefined}
            className={`flex items-center justify-center whitespace-nowrap rounded-lg px-2 py-2 text-[12px] font-bold transition ${
              active ? "bg-findmi text-white shadow-sm" : "text-ink/45 hover:text-ink/70"
            }`}
          >
            {t.label}
          </Link>
        );
      })}

      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={activeMoreTab ? `${activeMoreTab.label} — Business sections menu` : "More Business sections"}
          className={`flex h-full items-center justify-center gap-0.5 whitespace-nowrap rounded-lg px-2 py-2 text-[12px] font-bold transition ${
            activeMoreTab ? "bg-findmi text-white shadow-sm" : "text-ink/45 hover:text-ink/70"
          }`}
        >
          <span className="max-w-[15vw] truncate">{activeMoreTab ? activeMoreTab.label : "More"}</span>
          <ChevronGlyph className={`h-2.5 w-2.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div
            role="menu"
            aria-label="More Business sections"
            className="absolute right-0 top-full z-20 mt-1 w-48 max-w-[calc(100vw-2rem)] rounded-xl border border-black/[0.07] bg-white p-1.5 shadow-lg"
          >
            {moreTabs.map((t) => {
              const active = t.key === activeTab;
              return (
                <Link
                  key={t.key}
                  href={`${basePath}?tab=${t.key}`}
                  role="menuitem"
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={`block truncate rounded-lg px-2.5 py-2 text-sm font-semibold transition ${
                    active ? "bg-findmi-50 text-findmi-700" : "text-ink hover:bg-black/[0.03]"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
