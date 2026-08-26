"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Logo from "./Logo";
import NavIcon from "./NavIcon";
import type { ResolvedNavItem } from "@/lib/navigation";

// Header hamburger trigger + mobile nav drawer (2026 navigation pass,
// extended in the live-QA follow-up pass with one level of expandable
// submenus). `items` comes from getVisibleNavItems() (founder-managed
// tree, with a safe real-route fallback — see lib/navigation.ts), fetched
// once by the server layout and passed down, so this stays a plain
// client island rather than fetching its own data.
export default function HamburgerMenu({ items }: { items: ResolvedNavItem[] }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      // Multiple sections can stay open at once — a founder-organized
      // menu is short enough that forcing an accordion (auto-collapsing
      // siblings) would just cost an extra tap for no real benefit.
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink transition active:scale-90"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      {/* Always mounted (not conditionally rendered) so open/close animate
          via CSS transform/opacity instead of a mount/unmount jump.
          z-[60] — one tier above every transient header popover (e.g.
          HeaderSearch's mobile results panel, which is z-50) so a modal
          drawer can never end up stacking-ambiguous with, or hidden
          behind, another same-z-index overlay opened in the same header
          row; same-z-index elements paint in DOM order, which is normally
          fine, but a modal has no business depending on sibling order to
          stay on top. */}
      <div
        className={`fixed inset-0 z-[60] ${open ? "pointer-events-auto" : "pointer-events-none"}`}
        aria-hidden={!open}
      >
        <div
          onClick={close}
          className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={`absolute inset-y-0 right-0 flex w-[82%] max-w-xs flex-col bg-white pt-[env(safe-area-inset-top)] shadow-xl transition-transform duration-200 ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          {/* Compact drawer header — logo + close only, no repeated site
              chrome (Part 20 of the live-QA pass). */}
          <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 py-2.5">
            <Logo heightClassName="h-7" />
            <button
              type="button"
              onClick={close}
              aria-label="Close menu"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink transition active:scale-90"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-2">
            {items.length > 0 ? (
              items.map((item) => (
                <NavEntry
                  key={item.id}
                  item={item}
                  expanded={expanded.has(item.id)}
                  onToggle={() => toggleExpanded(item.id)}
                  onNavigate={close}
                />
              ))
            ) : (
              // Defensive only — getVisibleNavItems() already guarantees a
              // non-empty tree (falling back to FALLBACK_NAV_ITEMS itself
              // when nav_items resolves to nothing), so `items` reaching
              // here should never actually be empty. Still: a drawer that
              // opens to a blank body is exactly the failure mode this
              // audit was called in for, so this never silently renders
              // nothing — it always leaves at least a real way back to the
              // site instead.
              <Link
                href="/"
                onClick={close}
                className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-ink transition hover:bg-black/[0.03]"
              >
                Browse FindMi
              </Link>
            )}
          </nav>
        </div>
      </div>
    </>
  );
}

const linkRowClass = (highlight: boolean) =>
  `flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition ${
    highlight
      ? "bg-findmi font-bold uppercase tracking-wide text-white hover:bg-findmi-600"
      : "font-medium text-ink hover:bg-black/[0.03]"
  }`;

/** One top-level row — either a plain link (no children) or an
 * expand/collapse toggle for its submenu (has children; its own href, if
 * any, is intentionally not used as a destination — see lib/navigation's
 * buildNavTree note). Children render as plain indented links, one level
 * only. */
function NavEntry({
  item,
  expanded,
  onToggle,
  onNavigate,
}: {
  item: ResolvedNavItem;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  if (item.children.length === 0) {
    return <NavLink item={item} onNavigate={onNavigate} className={linkRowClass(item.highlight)} />;
  }

  const panelId = `nav-submenu-${item.id}`;
  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-ink transition hover:bg-black/[0.03]"
      >
        {item.icon && <NavIcon name={item.icon} className="h-5 w-5 shrink-0" />}
        <span className="flex-1 truncate">{item.label}</span>
        <svg viewBox="0 0 24 24" fill="none" className={`h-4 w-4 shrink-0 text-ink/40 transition-transform ${expanded ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {expanded && (
        <div id={panelId} className="ml-4 flex flex-col gap-0.5 border-l-2 border-black/5 pl-3">
          {item.children.map((child) => (
            <NavLink key={child.id} item={child} onNavigate={onNavigate} className={linkRowClass(child.highlight)} />
          ))}
        </div>
      )}
    </div>
  );
}

function NavLink({
  item,
  onNavigate,
  className,
}: {
  item: ResolvedNavItem;
  onNavigate: () => void;
  className: string;
}) {
  if (!item.href) return null; // defensive — buildNavTree already drops hrefless leaves

  const content = (
    <>
      {item.icon && <NavIcon name={item.icon} className="h-5 w-5 shrink-0" />}
      <span className="truncate">{item.label}</span>
    </>
  );

  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" onClick={onNavigate} className={className}>
        {content}
      </a>
    );
  }
  return (
    <Link href={item.href} onClick={onNavigate} className={className}>
      {content}
    </Link>
  );
}
