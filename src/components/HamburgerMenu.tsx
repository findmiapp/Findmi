"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Logo from "./Logo";
import NavIcon from "./NavIcon";
import SignOutConfirm from "./SignOutConfirm";
import DrawerUtilityStrip, { pillClass } from "./DrawerUtilityStrip";
import DrawerSearch from "./DrawerSearch";
import type { ResolvedNavItem } from "@/lib/navigation";
import { signOut } from "@/app/(public)/account/profile/actions";

// Mobile Drawer Bottom Auth Cleanup pass — Log In/Join for Free now have
// a dedicated two-up row at the bottom of the drawer (below, mirroring
// the top DrawerUtilityStrip), so the SAME destinations must not also
// show up a second time as ordinary stacked nav_items rows (live QA
// found both a stacked "Log In"/"Join for Free" pair from the regular
// nav list AND a redundant "Join Findmi" child under "For Business").
// Matched by href — these are real routes, not labels a founder might
// reword — same convention NavLink's own isMessages check already uses.
// This is a presentational dedup local to the drawer's own rendering,
// never a change to the founder-editable audience system itself
// (filterNavItemsForAudience in lib/navigation.ts remains the one real
// filtering mechanism) — any other business/nav_items row (List Your
// Business, Create an Event, List a Location, etc.) is untouched.
const ACQUISITION_HREFS = new Set(["/login", "/join"]);

function stripAcquisitionItems(items: ResolvedNavItem[]): ResolvedNavItem[] {
  return items
    .filter((item) => !ACQUISITION_HREFS.has(item.href ?? ""))
    .map((item) => ({
      ...item,
      children: item.children.filter((child) => !ACQUISITION_HREFS.has(child.href ?? "")),
    }));
}

// Header hamburger trigger + mobile nav drawer (2026 navigation pass,
// extended in the live-QA follow-up pass with one level of expandable
// submenus). `items` comes from getVisibleNavItems() (founder-managed
// tree), already narrowed to this viewer's audience once in the server
// layout (filterNavItemsForAudience — see (public)/layout.tsx) before it
// ever reaches this client component. Navigation Information Architecture
// + Founder-Editable Audience pass — this drawer no longer hardcodes a
// separate authenticated menu tree (Your Findmi/Manage/Discover/Create):
// every one of those destinations is now a real, founder-editable
// nav_items row with its own `audience`, rendered by the exact same
// NavEntry loop for every viewer. The things that stay hardcoded here
// are the top DrawerUtilityStrip and bottom auth row (Log In/Join for
// Free/Account/Sign Out) — see stripAcquisitionItems's own comment
// above for why the regular nav list never duplicates them. Sign Out
// itself is a Server Action, not a link, so it could never be a
// nav_items row regardless. The global aqua + QuickCreate control (unchanged,
// still in MobileHeader) remains the one authenticated Create mechanism
// — this drawer deliberately has no Create section of its own any more.
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
}: {
  items: ResolvedNavItem[];
  /** Server-resolved (see (public)/layout.tsx) — drives whether the
   * bottom Sign Out row renders. Never determined client-side. */
  authenticated: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Log In/Join Findmi are rendered exclusively via the dedicated bottom
  // auth row now — see stripAcquisitionItems's own comment above.
  const visibleItems = stripAcquisitionItems(items);
  // Every parent group starts expanded (still collapsible via its own
  // toggle) — a grouping row like "Your Findmi" or "Manage" exists for
  // scannability, not to add a second tap in front of Account/Messages/
  // Businesses/Events/Locations. Lazy-initialized once from the items
  // this component mounted with; nav_items essentially never changes
  // mid-session, so this never needs to react to `items` changing later.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(visibleItems.filter((item) => item.children.length > 0).map((item) => item.id))
  );
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

              {/* Utility strip + live search — top-of-drawer pass. Both
                  shrink-0, sitting above the scrollable nav body below
                  them; DrawerSearch's own results list scrolls inside
                  itself (max-h-[45vh]) rather than growing the drawer, so
                  the existing nav underneath is never pushed out of
                  reach. */}
              <DrawerUtilityStrip onNavigate={close} authenticated={authenticated} />
              <DrawerSearch onNavigate={close} />

              {/* Direct Homepage Intent + Global Journal Access pass —
                  Journal is now a repeated Findmi behavior (Event pages'
                  own "Document Your Experience" CTA, the homepage My
                  Journal doorway) and needs permanent, always-visible
                  navigation rather than living only on those two
                  surfaces. Placed here (shrink-0, above the scrollable
                  nav body) rather than in MobileHeader's own persistent
                  top bar — that bar is already at 4 icons (Search/Cart/
                  QuickCreate/Hamburger) on a 390px viewport, so two more
                  targets there would be real clutter; the drawer is the
                  existing "more room" surface this pass calls for
                  instead. Both destinations are the same canonical
                  Journal routes the homepage doorway and Event capture
                  flow already resolve to (/my-world/journal,
                  /my-world/journal/new) — no new Journal creation
                  architecture. Plain Links, not auth-branched: both
                  routes already sit behind middleware's own
                  /my-world/journal/:path* gate (see middleware.ts),
                  which bounces a signed-out tap to /login?next=<that
                  route> and returns them straight there after
                  authenticating — the exact same "safe next gateway"
                  pattern QuickCreateMenu's own Business/Venue/Event rows
                  already rely on, reused rather than re-decided here. */}
              <div className="flex shrink-0 items-center gap-2 border-b border-black/5 px-4 py-2.5">
                <Link
                  href="/my-world/journal"
                  onClick={close}
                  className="flex h-9 flex-1 items-center justify-center rounded-xl border border-black/10 text-[11px] font-bold uppercase tracking-wide text-ink/70 transition hover:bg-black/[0.03]"
                >
                  My Moments
                </Link>
                <Link
                  href="/my-world/journal/new"
                  onClick={close}
                  className="flex h-9 flex-[1.2] items-center justify-center gap-1.5 rounded-xl border border-findmi/30 bg-findmi-50 text-[11px] font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-100"
                >
                  <PencilGlyph className="h-3.5 w-3.5" />
                  Add Moment
                </Link>
              </div>

              {/* Nav body — flex-1 + min-h-0 (belt-and-suspenders with
                  overflow-y-auto, which already exempts a flex item from
                  the default min-height:auto shrink trap) is what makes
                  this scroll internally instead of ever being able to
                  push the drawer's own box taller than the viewport. */}
              <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2">
                {visibleItems.length > 0 ? (
                  visibleItems.map((item) => (
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
                  // to nothing), so `visibleItems` reaching here should
                  // never actually be empty. Still: a drawer that opens to a
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

                {/* Mobile Drawer Bottom Auth Cleanup pass — one 2-up row,
                    geometry matching the top DrawerUtilityStrip (same
                    pillClass): logged out -> Log In / Join for Free
                    (Log In/Join Findmi are stripped out of the regular
                    nav list above so neither shows twice); logged in ->
                    Account / Sign Out. Sign Out is the one destination
                    that can never be a nav_items row (it's a Server
                    Action, not a link) — it reuses the exact same
                    signOut Server Action + SignOutConfirm dialog the top
                    utility row already uses, never a second
                    implementation. */}
                <div className="mt-3 flex items-center gap-2 border-t border-black/5 pt-3">
                  {authenticated ? (
                    <>
                      <Link
                        href="/account"
                        onClick={close}
                        className={`${pillClass} border border-findmi/30 bg-findmi-50 text-findmi-700 hover:bg-findmi-100`}
                      >
                        Account
                      </Link>
                      <SignOutConfirm
                        action={signOut}
                        ariaLabel="Sign out"
                        className={`${pillClass} border border-black/10 text-ink/60 hover:bg-black/[0.03]`}
                      >
                        Sign Out
                      </SignOutConfirm>
                    </>
                  ) : (
                    <>
                      <Link
                        href="/login"
                        onClick={close}
                        className={`${pillClass} border border-black/10 text-ink/70 hover:bg-black/[0.03]`}
                      >
                        Log In
                      </Link>
                      <Link
                        href="/join"
                        onClick={close}
                        className={`${pillClass} flex-[1.3] bg-findmi text-white hover:bg-findmi-600`}
                      >
                        Join for Free
                      </Link>
                    </>
                  )}
                </div>
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

  // Messages has no NAV_ICON_KEYS entry (that set has no chat/message
  // glyph — see lib/navigation.ts) and its nav_items row is seeded with
  // icon_key null, so it renders no icon by default. Matched by href
  // (its one stable identifier) rather than label, so a founder renaming
  // the row's label doesn't lose the icon. Reuses the exact same
  // speech-bubble glyph already used for /account's own Messages tile
  // (see MessageGlyph in account/page.tsx) rather than a mail/envelope
  // icon, at the same h-5 w-5/stroke-1.8 size every other drawer icon
  // uses.
  const isMessages = item.href === "/account/messages";

  const content = (
    <>
      {isMessages ? (
        <MessageGlyph className="h-5 w-5 shrink-0" />
      ) : (
        item.icon && <NavIcon name={item.icon} className="h-5 w-5 shrink-0" />
      )}
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

// Same speech-bubble glyph as account/page.tsx's own MessageGlyph
// (deliberately not an envelope/mail icon), redrawn here at the drawer's
// icon size rather than shared as an import — every other glyph in the
// app (HeartGlyph, this one) already follows the same per-file pattern.
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

// Same pencil silhouette DocumentExperienceCta.tsx already uses for its
// own Journal CTA, redrawn here per-file rather than shared as an import
// — the same convention MessageGlyph above already follows.
function PencilGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M17 3a2.1 2.1 0 013 3L8.5 17.5 4 19l1.5-4.5L17 3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
