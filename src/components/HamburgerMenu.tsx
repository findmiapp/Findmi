"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Logo from "./Logo";
import NavIcon from "./NavIcon";
import SignOutConfirm from "./SignOutConfirm";
import DrawerUtilityStrip from "./DrawerUtilityStrip";
import DrawerSearch from "./DrawerSearch";
import { stripAcquisitionNavItems, type NavIconKey, type ResolvedNavItem } from "@/lib/navigation";
import { resolveBusinessScopedHref, type BusinessOption } from "@/app/(public)/account/BusinessScopedAction";
import { signOut } from "@/app/(public)/account/profile/actions";

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
export default function HamburgerMenu({
  items,
  authenticated,
  businesses,
  contactEmail,
  contactPhone,
}: {
  items: ResolvedNavItem[];
  /** Server-resolved (see (public)/layout.tsx) — drives the utility
   * strip's Login/Logout action, and (Authenticated Menu Cleanup pass)
   * which nav sections render below: signed out, this drawer is
   * completely unchanged from before; signed in, it gains the Your
   * Findmi/Manage/Create sections and drops any acquisition CTA from the
   * founder-configured tree. Never determined client-side. */
  authenticated: boolean;
  /** Same already-loaded list MobileHeader already hands QuickCreateMenu
   * — reused here (not re-fetched) so the Create section below can reuse
   * resolveBusinessScopedHref's exact zero/one/many routing instead of
   * re-deciding it. Always [] when signed out. */
  businesses: BusinessOption[];
  /** Founder-editable (Admin → Site → Contact Info); null hides that
   * utility-strip action entirely rather than showing a dead link. */
  contactEmail: string | null;
  contactPhone: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  // Authenticated Menu Cleanup pass — the founder-configured browse tree
  // (Discover/Brands/Marketplace/etc.) stays for a signed-in visitor too
  // (they still want to browse), just with any acquisition/plan CTA
  // stripped (Locked Rule — Section 3) and the plain "Account" row
  // dropped since Your Findmi below already covers it more prominently.
  // A signed-out visitor's tree is untouched, in the exact original
  // order (Section 8 — never damage visitor acquisition).
  const browseItems = authenticated ? stripAcquisitionNavItems(items).filter((i) => i.href !== "/account") : items;

  // Create section — reuses the exact same resolveBusinessScopedHref
  // QuickCreateMenu already calls for these two Business-scoped actions,
  // never a second routing decision. Its only three outcomes: zero
  // businesses -> the existing creation page, one -> straight into that
  // Business's own Manager tab, more than one -> null, which falls back
  // to /account (the existing "Manage on Findmi" chooser) rather than
  // rebuilding WhichBusinessPanel's picker a second time in this drawer.
  const whereIllBeHref = resolveBusinessScopedHref(businesses, "findmi-here") ?? "/account";
  const productHref = resolveBusinessScopedHref(businesses, "products") ?? "/account";

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

              {/* Utility strip + live search — top-of-drawer pass. Both
                  shrink-0, sitting above the scrollable nav body below
                  them; DrawerSearch's own results list scrolls inside
                  itself (max-h-[45vh]) rather than growing the drawer, so
                  the existing nav underneath is never pushed out of
                  reach. */}
              <DrawerUtilityStrip
                authenticated={authenticated}
                email={contactEmail}
                phone={contactPhone}
                onNavigate={close}
              />
              <DrawerSearch onNavigate={close} />

              {/* Nav body — flex-1 + min-h-0 (belt-and-suspenders with
                  overflow-y-auto, which already exempts a flex item from
                  the default min-height:auto shrink trap) is what makes
                  this scroll internally instead of ever being able to
                  push the drawer's own box taller than the viewport. */}
              <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2">
                {authenticated ? (
                  <>
                    {/* Authenticated Menu Cleanup pass — Section 2's
                        priority/order: Your Findmi (Account/Messages,
                        both immediately discoverable near the top) ->
                        Manage -> Create -> the founder's own browse tree
                        (acquisition CTAs stripped) -> Profile/Settings +
                        Sign Out, clearly separated at the very bottom. */}
                    <SectionHeading>Your Findmi</SectionHeading>
                    <DrawerLink href="/account" icon="person" label="Account" onNavigate={close} />
                    <DrawerLink href="/account/messages" iconNode={<MessageGlyph className="h-5 w-5 shrink-0" />} label="Messages" onNavigate={close} />

                    <SectionHeading>Manage</SectionHeading>
                    <DrawerLink href="/account?manage=business" icon="storefront" label="Businesses" onNavigate={close} />
                    <DrawerLink href="/account?manage=event" icon="calendar" label="Events" onNavigate={close} />
                    <DrawerLink href="/account?manage=location" icon="pin" label="Locations" onNavigate={close} />

                    <SectionHeading>Create</SectionHeading>
                    <DrawerLink href={whereIllBeHref} icon="target" label="Where I'll Be" onNavigate={close} />
                    <DrawerLink href="/account/business/new" icon="storefront" label="Business" onNavigate={close} />
                    <DrawerLink href="/account/event/new" icon="calendar" label="Event" onNavigate={close} />
                    <DrawerLink href="/account/location/new" icon="pin" label="Location" onNavigate={close} />
                    <DrawerLink href={productHref} icon="tag" label="Product" onNavigate={close} />

                    {browseItems.length > 0 && (
                      <>
                        <SectionHeading>Discover</SectionHeading>
                        {browseItems.map((item) => (
                          <NavEntry
                            key={item.id}
                            item={item}
                            expanded={expanded.has(item.id)}
                            onToggle={() => toggleExpanded(item.id)}
                            onNavigate={close}
                          />
                        ))}
                      </>
                    )}

                    <div className="mt-3 flex flex-col gap-0.5 border-t border-black/5 pt-2">
                      <DrawerLink href="/account/profile" icon="person" label="Profile / Settings" onNavigate={close} />
                      <SignOutConfirm
                        action={signOut}
                        ariaLabel="Sign out"
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-ink/50 transition hover:bg-black/[0.03]"
                      >
                        Sign Out
                      </SignOutConfirm>
                    </div>
                  </>
                ) : items.length > 0 ? (
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
                    Browse Findmi
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

/** Small uppercase micro-heading for the authenticated drawer's own
 * sections (Your Findmi/Manage/Create/Discover) — same treatment
 * /account already uses for "Manage on Findmi"/"Your Activity", not a
 * new heading style invented for this drawer. First one gets no top
 * margin (sits flush under the drawer's own padding); every other one
 * gets a small gap from the section above it. */
function SectionHeading({ children }: { children: ReactNode }) {
  return <p className="mb-1 mt-4 px-3 text-[10px] font-bold uppercase tracking-wide text-ink/40 first:mt-0">{children}</p>;
}

/** One plain authenticated-drawer row — same visual language as a
 * founder-configured NavLink (NavIcon + label, linkRowClass(false)), but
 * for the hardcoded Your Findmi/Manage/Create/Account destinations this
 * pass adds, which aren't ResolvedNavItem rows. `iconNode` overrides
 * `icon` for the one row (Messages) with no matching NAV_ICON_KEYS
 * entry. */
function DrawerLink({
  href,
  icon,
  iconNode,
  label,
  onNavigate,
}: {
  href: string;
  icon?: NavIconKey;
  iconNode?: ReactNode;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link href={href} onClick={onNavigate} className={linkRowClass(false)}>
      {iconNode ?? (icon && <NavIcon name={icon} className="h-5 w-5 shrink-0" />)}
      <span className="truncate">{label}</span>
    </Link>
  );
}

// Messages has no matching entry in NAV_ICON_KEYS (a small, curated,
// founder-admin-facing set this hardcoded row deliberately doesn't
// extend) — same chat-bubble glyph already used for the Messages tile on
// /account, reused here for visual consistency rather than inventing a
// second icon for the same concept.
function MessageGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M4 5.5h16a1 1 0 011 1V15a1 1 0 01-1 1H9l-4 3.5V16H4a1 1 0 01-1-1V6.5a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
