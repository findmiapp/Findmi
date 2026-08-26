"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
//
// Drawer-shell rebuild pass — the backdrop + drawer are now rendered via
// a React portal straight into document.body instead of as DOM
// descendants of MobileHeader's own <header> (a `fixed`, `backdrop-blur`
// element). Static inspection alone couldn't prove that ancestor was
// responsible for the reported "drawer collapses to header height" bug,
// but a portal makes the drawer's geometry unambiguous — its containing
// block is the viewport, full stop, with no possible interaction with
// any parent's backdrop-filter/transform/overflow ever again, regardless
// of what MobileHeader (or anything wrapping it) does or changes to
// later. Only mounted after the client hydrates (`mounted` state) since
// document.body doesn't exist during SSR — before that, the trigger
// button alone renders, same as any other client-only overlay.
export default function HamburgerMenu({ items }: { items: ResolvedNavItem[] }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

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

      {mounted &&
        createPortal(
          <>
            {/* BACKDROP — its own independent fixed layer, always mounted
                (not conditionally rendered) so open/close animate via
                opacity instead of a mount/unmount jump. z-[60]. */}
            <div
              onClick={close}
              aria-hidden={!open}
              className={`fixed inset-0 z-[60] bg-black/40 transition-opacity duration-200 ${
                open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
              }`}
            />

            {/* DRAWER — top-0/right-0/bottom-0 alone already pins it to
                the full viewport height regardless of dvh support;
                h-[100dvh] layers on top as the modern-browser refinement
                (correctly excludes a mobile browser's collapsing address
                bar from "100%"). Whichever the browser honors, the drawer
                cannot end up sized to its own content/header — it is
                never anything other than an explicit viewport-height box.
                z-[61] — one above the backdrop, both already above every
                other transient header popover (e.g. HeaderSearch's
                results panel, z-50). */}
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              aria-hidden={!open}
              className={`fixed right-0 top-0 bottom-0 z-[61] flex h-[100dvh] w-[min(88vw,360px)] flex-col bg-white shadow-xl transition-transform duration-200 ${
                open ? "translate-x-0 pointer-events-auto" : "translate-x-full pointer-events-none"
              }`}
            >
              {/* Drawer header — compact, shrink-0, safe-area aware. The
                  duplicated logo is intentional (Part 20 of the live-QA
                  pass) — no repeated site chrome, just logo + close. */}
              <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.625rem)]">
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

              {/* Nav body — flex-1 + min-h-0 (belt-and-suspenders with
                  overflow-y-auto, which already exempts a flex item from
                  the default min-height:auto shrink trap) is what makes
                  this scroll internally instead of ever being able to
                  push the drawer's own box taller than the viewport. */}
              <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2">
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
                  // Defensive only — getVisibleNavItems() already
                  // guarantees a non-empty tree (falling back to
                  // FALLBACK_NAV_ITEMS itself whenever nav_items resolves
                  // to nothing), so `items` reaching here should never
                  // actually be empty. Still: a drawer that opens to a
                  // blank body is exactly the failure mode this pass
                  // exists to rule out, so it never silently renders
                  // nothing — it always leaves a real way back to the
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
          </>,
          document.body
        )}
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
