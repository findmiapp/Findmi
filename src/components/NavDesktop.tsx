"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import CartBadge from "./CartBadge";
import HeaderSearch from "./HeaderSearch";
import Logo from "./Logo";
import NavIcon from "./NavIcon";
import type { ResolvedNavItem } from "@/lib/navigation";

// Desktop/tablet horizontal nav (Tailwind's md: breakpoint and up, so this
// is also what a real tablet renders — there's no separate tablet
// component). Same founder-managed source as the mobile hamburger drawer
// (getVisibleNavItems(), fetched once in the public layout and passed
// down as a prop to both) — this pass fixes how that shared data
// RENDERS here, not the data itself.
//
// A top-level item WITH its own destination is a plain link, same as the
// drawer. A top-level item with children but no destination of its own
// (a "Discover"/"Events"-style grouping row) is now a click-to-open
// dropdown — the desktop/tablet equivalent of the drawer's expand/
// collapse. Previously this flattened every child straight into the
// top-level row instead, which threw away the grouping entirely on
// desktop (a parent's children looked like unrelated top-level links) and
// could crowd/overflow the bar once a parent had more than one or two
// children — the actual "tablet/desktop nav looks different and broken"
// symptom this pass exists to fix. Any item marked Highlight (top-level
// or nested) is still always pulled out as its own CTA button regardless
// of nesting — a highlighted item's whole purpose is staying visible, not
// being buried one click deep in a dropdown.
export default function NavDesktop({ navItems }: { navItems: ResolvedNavItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!openId) return;
    function onPointerDown(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenId(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenId(null);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openId]);

  const allItems = navItems.flatMap((item) => [item, ...item.children]);
  const highlighted = allItems.filter(
    (item): item is ResolvedNavItem & { href: string } => Boolean(item.href) && item.highlight
  );
  const highlightedIds = new Set(highlighted.map((i) => i.id));

  return (
    <header className="sticky top-0 z-40 hidden border-b border-black/5 bg-paper/90 backdrop-blur md:block">
      <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-4">
        <Logo heightClassName="h-10" />
        <nav ref={navRef} className="flex flex-1 items-center gap-6">
          {navItems.map((item) => {
            if (highlightedIds.has(item.id)) return null; // rendered as a CTA button below instead

            if (item.href) {
              return <NavLink key={item.id} item={item as ResolvedNavItem & { href: string }} className={linkClass} />;
            }

            const dropdownChildren = item.children.filter(
              (c): c is ResolvedNavItem & { href: string } => Boolean(c.href) && !highlightedIds.has(c.id)
            );
            if (dropdownChildren.length === 0) return null; // nothing to expand into — dead row

            return (
              <NavDropdown
                key={item.id}
                item={item}
                childItems={dropdownChildren}
                open={openId === item.id}
                onToggle={() => setOpenId((prev) => (prev === item.id ? null : item.id))}
                onNavigate={() => setOpenId(null)}
              />
            );
          })}
        </nav>
        <HeaderSearch variant="text" />
        <CartBadge variant="text" />
        {highlighted.map((item) => (
          <NavLink
            key={item.id}
            item={item}
            className="rounded-full bg-findmi px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          />
        ))}
      </div>
    </header>
  );
}

const linkClass = "text-sm font-medium text-ink/70 transition hover:text-ink";

function NavDropdown({
  item,
  childItems,
  open,
  onToggle,
  onNavigate,
}: {
  item: ResolvedNavItem;
  childItems: (ResolvedNavItem & { href: string })[];
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const panelId = `nav-desktop-${item.id}`;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={panelId}
        className={`flex items-center gap-1 ${linkClass}`}
      >
        {item.label}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={`h-3.5 w-3.5 text-ink/40 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          id={panelId}
          role="menu"
          className="absolute left-0 top-full z-30 mt-2 min-w-[190px] rounded-2xl border border-black/10 bg-white p-1.5 shadow-lg"
        >
          {childItems.map((child) => (
            <Link
              key={child.id}
              href={child.href}
              onClick={onNavigate}
              role="menuitem"
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink/80 transition hover:bg-black/[0.03] hover:text-ink"
            >
              {child.icon && <NavIcon name={child.icon} className="h-4 w-4 shrink-0" />}
              {child.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NavLink({ item, className }: { item: ResolvedNavItem & { href: string }; className: string }) {
  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className={className}>
        {item.label}
      </a>
    );
  }
  return (
    <Link href={item.href} className={className}>
      {item.label}
    </Link>
  );
}
