"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import type { NavIconKey } from "@/lib/navigation";

/** Mobile Navigation Fix — Business Manager has more destinations than
 * fit on a phone screen (Overview/Where I'll Be/Analytics/Profile/
 * Products/Orders/Settings). The old horizontally-scrolling tab strip
 * had no affordance that more destinations existed off-screen (live QA:
 * "Couldn't even tell I had to scroll to get to products" — Products was
 * completely undiscoverable). Replaced with a deliberately finite
 * 3-control row: Overview and Where I'll Be stay directly tappable, a
 * third control opens every other destination and relabels itself to
 * the current one ("Products ▾") whenever the owner is inside it, so
 * the active location is never ambiguous.
 *
 * Same outside-click/Escape-to-close interaction as AccountNav's own
 * "More" popover (this file's closest existing analog) — a real client
 * component rather than a bare <details>, since this specific menu
 * (unlike the page's own Business-switcher <details>) needs that
 * behavior per this pass's own requirement. Desktop never renders this
 * — the sidebar in page.tsx already shows every destination. */
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
    <nav aria-label="Business sections" className="mt-4 flex items-stretch gap-1.5 rounded-xl bg-black/[0.03] p-1 lg:hidden">
      {primaryTabs.map((t) => {
        const active = t.key === activeTab;
        return (
          <Link
            key={t.key}
            href={`${basePath}?tab=${t.key}`}
            aria-current={active ? "page" : undefined}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[13px] font-bold transition ${
              active ? "bg-findmi text-white shadow-sm" : "text-ink/45 hover:text-ink/70"
            }`}
          >
            <NavIcon name={t.icon} className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t.label}</span>
          </Link>
        );
      })}

      <div ref={menuRef} className="relative min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={activeMoreTab ? `${activeMoreTab.label} — Business sections menu` : "More Business sections"}
          className={`flex h-full w-full min-w-0 items-center justify-center gap-1 rounded-lg px-2 py-2 text-[13px] font-bold transition ${
            activeMoreTab ? "bg-findmi text-white shadow-sm" : "text-ink/45 hover:text-ink/70"
          }`}
        >
          <span className="truncate">{activeMoreTab ? activeMoreTab.label : "More"}</span>
          <ChevronGlyph className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
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
