"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "./Logo";
import NavIcon from "./NavIcon";
import SignOutConfirm from "./SignOutConfirm";
import DrawerSearch from "./DrawerSearch";
import { navChildActive, navChildrenWithLanding, navHrefActive, navItemActive, type ResolvedNavItem } from "@/lib/navigation";
import { FOR_BUSINESS_NAV, YOUR_FINDMI_NAV, isPrimaryNavActive, manageNavEntry, type PrimaryNavItem } from "@/lib/primary-nav";
import { signOut } from "@/app/(public)/account/profile/actions";
import { getSite } from "@/lib/site";

const site = getSite();

// Header hamburger trigger + mobile nav drawer. Pass A — Navigation
// Shell: the drawer is the product's mobile information architecture:
// Search, DISCOVER first (nav_items — Admin → Site → Navigation, the same
// rows as the desktop bar; parents expand one level), then the code-owned
// sections from lib/primary-nav: FOR BUSINESS (signed out) or YOUR FINDMI ·
// MANAGE (one compact entry, never a list of Businesses), ADMIN when
// authorized, and ONE auth row (Log In / Join For Free, or Sign Out).
// Create stays the global "+" control in MobileHeader.
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
export default function HamburgerMenu({
  items,
  authenticated,
  isAdmin = false,
  businesses = [],
}: {
  /** Public discovery navigation — nav_items (Admin → Site → Navigation),
   * audience-filtered, reserved account/auth destinations removed. */
  items: ResolvedNavItem[];
  /** Server-resolved (see (public)/layout.tsx). Never determined client-side. */
  authenticated: boolean;
  /** Server-verified Admin session — adds the one Admin entry. */
  isAdmin?: boolean;
  /** The viewer's managed Businesses — one compact MANAGE entry. */
  businesses?: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const manage = authenticated ? manageNavEntry(businesses) : null;
  const [mounted, setMounted] = useState(false);
  // Accordion: at most one nav_items group open; all collapse on open.
  const [expanded, setExpanded] = useState<string | null>(null);
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

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setExpanded(null);
          setOpen(true);
        }}
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

              {/* Search first, then DISCOVER (always), then the viewer's
                  own sections: FOR BUSINESS (signed out) or YOUR FINDMI ·
                  MANAGE · ADMIN (signed in / authorized), then ONE auth
                  row. Built from lib/primary-nav, the same model the
                  desktop header uses. */}
              <DrawerSearch onNavigate={close} />

              <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-1">
                <DrawerSection title="Discover">
                  {items.map((item) =>
                    item.children.length > 0 ? (
                      <DrawerGroup
                        key={item.id}
                        item={item}
                        pathname={pathname}
                        expanded={expanded === item.id}
                        onToggle={() => setExpanded((prev) => (prev === item.id ? null : item.id))}
                        onNavigate={close}
                      />
                    ) : (
                      <NavItemLink key={item.id} item={item} active={navHrefActive(pathname, item.href)} onNavigate={close} />
                    )
                  )}
                </DrawerSection>

                {authenticated ? (
                  <>
                    <DrawerSection title="Your Findmi">
                      {YOUR_FINDMI_NAV.map((item) => (
                        <DrawerLink key={item.href} item={item} active={isPrimaryNavActive(pathname, item)} onNavigate={close} />
                      ))}
                    </DrawerSection>
                    {manage && (
                      <DrawerSection title="Manage">
                        <DrawerLink item={manage} active={isPrimaryNavActive(pathname, manage)} onNavigate={close} />
                      </DrawerSection>
                    )}
                  </>
                ) : site.features.business ? (
                  <DrawerSection title="For Business">
                    <DrawerLink item={FOR_BUSINESS_NAV} active={isPrimaryNavActive(pathname, FOR_BUSINESS_NAV)} onNavigate={close} />
                  </DrawerSection>
                ) : null}

                {isAdmin && (
                  <DrawerSection title="Admin">
                    <DrawerLink item={{ href: "/admin", label: "Findmi Admin", match: [] }} active={false} onNavigate={close} />
                  </DrawerSection>
                )}

                {/* Auth row only on a site with accounts (lib/site.ts). */}
                {site.features.accounts && <div className="mt-4 flex items-center gap-2 border-t border-black/5 pt-4">
                  {authenticated ? (
                    <SignOutConfirm action={signOut} ariaLabel="Sign out" className={`${pillClass} border border-black/10 text-ink/70 hover:bg-black/[0.03]`}>
                      Sign Out
                    </SignOutConfirm>
                  ) : (
                    <>
                      <Link href="/login" onClick={close} className={`${pillClass} border border-black/10 text-ink hover:bg-black/[0.03]`}>
                        Log In
                      </Link>
                      <Link href="/join" onClick={close} className={`${pillClass} flex-[1.3] bg-findmi text-white hover:bg-findmi-600`}>
                        Join For Free
                      </Link>
                    </>
                  )}
                </div>}
              </nav>
            </div>
          </>,
          document.body
        )}
    </>
  );
}

const pillClass =
  "flex h-11 flex-1 shrink-0 items-center justify-center whitespace-nowrap rounded-xl text-sm font-bold transition active:scale-[0.98]";

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pt-3">
      <h2 className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-ink/40">{title}</h2>
      <div className="flex flex-col gap-0.5">{children}</div>
    </section>
  );
}

/** One nav_items row as a drawer link (founder label, icon, highlight). */
function NavItemLink({ item, active, onNavigate, nested = false, grow = false }: { item: ResolvedNavItem; active: boolean; onNavigate: () => void; nested?: boolean; grow?: boolean }) {
  if (!item.href) return null;
  const className = `flex min-h-11 items-center gap-3 rounded-xl px-3 font-semibold transition ${grow ? "min-w-0 flex-1" : ""} active:scale-[0.99] ${nested ? "text-sm" : "text-[15px]"} ${
    item.highlight ? "bg-findmi text-white hover:bg-findmi-600" : active ? "bg-findmi-50 text-findmi-700" : "text-ink hover:bg-black/[0.03]"
  }`;
  const content = (
    <>
      {item.icon ? (
        <NavIcon name={item.icon} className={`h-5 w-5 shrink-0 ${item.highlight ? "text-white" : active ? "text-findmi-700" : "text-ink/55"}`} />
      ) : (
        !nested && <span aria-hidden="true" className="h-5 w-5 shrink-0" />
      )}
      <span className="truncate">{item.label}</span>
    </>
  );
  return item.external ? (
    <a href={item.href} target="_blank" rel="noopener noreferrer" onClick={onNavigate} className={className}>
      {content}
    </a>
  ) : (
    <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={className}>
      {content}
    </Link>
  );
}

/** A nav_items parent row: expands to its children (one level). */
function DrawerGroup({
  item,
  pathname,
  expanded,
  onToggle,
  onNavigate,
}: {
  item: ResolvedNavItem;
  pathname: string;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const active = navItemActive(pathname, item);
  const panelId = `drawer-group-${item.id}`;
  const icon = item.icon ? (
    <NavIcon name={item.icon} className={`h-5 w-5 shrink-0 ${active ? "text-findmi-700" : "text-ink/55"}`} />
  ) : (
    <span aria-hidden="true" className="h-5 w-5 shrink-0" />
  );
  const chevron = (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`h-4 w-4 shrink-0 text-ink/40 transition-transform ${expanded ? "rotate-180" : ""}`}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return (
    <div>
      {item.href ? (
        // The label navigates to the item's own page; the chevron is a
        // separate control that only expands/collapses the submenu.
        <div className="flex items-center">
          <NavItemLink item={{ ...item, highlight: false }} active={active} onNavigate={onNavigate} grow />
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${item.label}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition hover:bg-black/[0.03]"
          >
            {chevron}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-semibold transition ${
            active ? "text-findmi-700" : "text-ink hover:bg-black/[0.03]"
          }`}
        >
          {icon}
          <span className="flex-1 truncate">{item.label}</span>
          {chevron}
        </button>
      )}
      {expanded && (
        <div id={panelId} className="ml-5 flex flex-col gap-0.5 border-l-2 border-black/5 pl-3">
          {navChildrenWithLanding(item).map((child) => (
            <NavItemLink key={child.id} item={child} active={navChildActive(pathname, child.href)} onNavigate={onNavigate} nested />
          ))}
        </div>
      )}
    </div>
  );
}

function DrawerLink({ item, active, onNavigate }: { item: PrimaryNavItem; active: boolean; onNavigate: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold transition active:scale-[0.99] ${
        active ? "bg-findmi-50 text-findmi-700" : "text-ink hover:bg-black/[0.03]"
      }`}
    >
      {item.icon ? <NavIcon name={item.icon} className={`h-5 w-5 shrink-0 ${active ? "text-findmi-700" : "text-ink/55"}`} /> : <span aria-hidden="true" className="h-5 w-5 shrink-0" />}
      <span className="truncate">{item.label}</span>
    </Link>
  );
}
