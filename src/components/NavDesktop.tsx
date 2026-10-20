"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import CartBadge from "./CartBadge";
import HeaderSearch from "./HeaderSearch";
import Logo from "./Logo";
import NavIcon from "./NavIcon";
import QuickCreateMenu from "./QuickCreateMenu";
import SignOutConfirm from "./SignOutConfirm";
import { signOut } from "@/app/(public)/account/profile/actions";
import { YOUR_FINDMI_NAV, isPrimaryNavActive, manageNavEntry } from "@/lib/primary-nav";
import { getSite } from "@/lib/site";
import { navChildActive, navChildrenWithLanding, navHrefActive, navItemActive, splitDesktopNav, type ResolvedNavItem } from "@/lib/navigation";
import type { BusinessOption } from "@/app/(public)/account/BusinessScopedAction";

const site = getSite();

/** Discovery links/dropdowns come from nav_items (Admin → Site →
 * Navigation); at most DESKTOP_NAV_MAX_ITEMS sit in the bar and the rest
 * move into "More ▾" — never horizontal scrolling.
 *
 * Desktop header (lg+ — the full nav needs ~830px with signed-out
 * controls, so tablets below 1024px keep the compact header + drawer). Pass A — Navigation Shell: consumer
 * discovery first (Discover · Events · Places · Brands · Moments, from
 * lib/primary-nav — the same model as the mobile drawer), then Search,
 * Cart, the global "+" Create (which holds Add Moment) and the account
 * menu (Your Findmi, Manage, Admin, Sign Out) — or Log In / Join For Free
 * when signed out. */
export default function NavDesktop({
  navItems,
  authenticated,
  isAdmin,
  businesses,
}: {
  /** Public discovery navigation (nav_items, audience-filtered, reserved
   * account/auth destinations already removed). */
  navItems: ResolvedNavItem[];
  authenticated: boolean;
  isAdmin: boolean;
  businesses: BusinessOption[];
}) {
  const pathname = usePathname();
  const [openId, setOpenId] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const { bar, more } = splitDesktopNav(navItems);

  useEffect(() => setOpenId(null), [pathname]);
  useEffect(() => {
    if (!openId) return;
    const onDown = (e: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId]);
  const toggle = (id: string) => setOpenId((prev) => (prev === id ? null : id));

  return (
    <header className="sticky top-0 z-40 hidden border-b border-black/5 bg-paper/90 backdrop-blur lg:block">
      <div className="mx-auto flex max-w-6xl items-center gap-5 px-6 py-3 lg:gap-8">
        <Logo heightClassName="h-10" />
        <nav ref={navRef} aria-label="Discover" className="flex flex-1 items-center gap-1">
          {bar.map((item) =>
            item.children.length > 0 ? (
              <NavDropdown
                key={item.id}
                label={item.label}
                active={navItemActive(pathname, item)}
                open={openId === item.id}
                onToggle={() => toggle(item.id)}
                groups={[{ label: null, href: item.href, items: navChildrenWithLanding(item) }]}
                pathname={pathname}
              />
            ) : (
              <NavBarLink key={item.id} item={item} active={navHrefActive(pathname, item.href)} />
            )
          )}
          {more.length > 0 && (
            <NavDropdown
              label="More"
              active={more.some((i) => navItemActive(pathname, i))}
              open={openId === "__more"}
              onToggle={() => toggle("__more")}
              groups={more.map((i) => ({ label: i.children.length > 0 ? i.label : null, href: i.href, items: i.children.length > 0 ? navChildrenWithLanding(i) : [i] }))}
              pathname={pathname}
            />
          )}
        </nav>
        <div className="flex shrink-0 items-center gap-3">
          <HeaderSearch variant="text" />
          {/* Cart, Create and account controls exist only on a site with
              accounts (lib/site.ts); JerseyCity.guide is discovery only. */}
          {site.features.accounts && <CartBadge variant="text" />}
          {site.features.accounts && <QuickCreateMenu authenticated={authenticated} businesses={businesses} />}
          {!site.features.accounts ? null : authenticated ? (
            <AccountMenu isAdmin={isAdmin} businesses={businesses} />
          ) : (
            <>
              <Link href="/login" className="text-sm font-semibold text-ink/70 transition hover:text-ink">
                Log In
              </Link>
              <Link href="/join" className="rounded-full bg-findmi px-4 py-2 text-sm font-bold text-white transition hover:bg-findmi-600">
                Join For Free
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

const barItemClass = (active: boolean, highlight = false) =>
  `flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold transition lg:px-3.5 ${
    highlight
      ? "bg-findmi text-white hover:bg-findmi-600"
      : active
        ? "bg-harbor-50 text-harbor-700"
        : "text-ink/70 hover:bg-black/[0.04] hover:text-ink"
  }`;

function NavBarLink({ item, active }: { item: ResolvedNavItem; active: boolean }) {
  if (!item.href) return null;
  const className = barItemClass(active, item.highlight);
  return item.external ? (
    <a href={item.href} target="_blank" rel="noopener noreferrer" className={className}>
      {item.label}
    </a>
  ) : (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={className}>
      {item.label}
    </Link>
  );
}

/** A nav_items group (or the More overflow) as a dropdown. */
function NavDropdown({
  label,
  active,
  open,
  onToggle,
  groups,
  pathname,
}: {
  label: string;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  groups: { label: string | null; href: string | null; items: ResolvedNavItem[] }[];
  pathname: string;
}) {
  return (
    <div className="relative">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-haspopup="menu" className={barItemClass(active || open)}>
        {label}
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`h-3.5 w-3.5 opacity-60 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-50 mt-2 min-w-[220px] rounded-2xl border border-black/10 bg-white p-1.5 shadow-lg">
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.label && <p className="px-3 pb-0.5 pt-2 text-[11px] font-bold uppercase tracking-wide text-ink/40">{g.label}</p>}
              {g.items.map((child) => (
                <DropdownLink key={child.id} item={child} active={navChildActive(pathname, child.href)} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DropdownLink({ item, active }: { item: ResolvedNavItem; active: boolean }) {
  if (!item.href) return null;
  const className = `flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
    item.highlight ? "text-findmi-700 hover:bg-findmi-50" : active ? "bg-harbor-50 text-harbor-700" : "text-ink hover:bg-black/[0.04]"
  }`;
  const content = (
    <>
      {item.icon && <NavIcon name={item.icon} className="h-4 w-4 shrink-0 opacity-70" />}
      {item.label}
    </>
  );
  return item.external ? (
    <a href={item.href} target="_blank" rel="noopener noreferrer" role="menuitem" className={className}>
      {content}
    </a>
  ) : (
    <Link href={item.href} role="menuitem" aria-current={active ? "page" : undefined} className={className}>
      {content}
    </Link>
  );
}

/** The signed-in account menu: personal destinations, one compact Manage
 * entry, Admin when authorized, Sign Out once. Add Moment lives in "+". */
function AccountMenu({ isAdmin, businesses }: { isAdmin: boolean; businesses: BusinessOption[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const manage = manageNavEntry(businesses);
  const personal = YOUR_FINDMI_NAV.filter((i) => i.href !== "/my-world/journal/new");

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Your Findmi"
        className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
          open ? "border-findmi bg-findmi-50 text-findmi-700" : "border-black/10 text-ink hover:border-black/20"
        }`}
      >
        <NavIcon name="person" className="h-5 w-5" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-60 rounded-2xl border border-black/10 bg-white p-1.5 shadow-lg">
          <MenuHeading>Your Findmi</MenuHeading>
          {personal.map((item) => (
            <MenuItem key={item.href} href={item.href} label={item.label} active={isPrimaryNavActive(pathname, item)} />
          ))}
          {manage && (
            <>
              <MenuHeading>Manage</MenuHeading>
              <MenuItem href={manage.href} label={manage.label} active={isPrimaryNavActive(pathname, manage)} />
            </>
          )}
          {isAdmin && (
            <>
              <MenuHeading>Admin</MenuHeading>
              <MenuItem href="/admin" label="Findmi Admin" active={false} />
            </>
          )}
          <div className="mt-1 border-t border-black/5 pt-1">
            <SignOutConfirm
              action={signOut}
              ariaLabel="Sign out"
              className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-medium text-ink/70 transition hover:bg-black/[0.04] hover:text-ink"
            >
              Sign Out
            </SignOutConfirm>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuHeading({ children }: { children: React.ReactNode }) {
  return <p className="px-3 pb-0.5 pt-2 text-[11px] font-bold uppercase tracking-wide text-ink/40">{children}</p>;
}

function MenuItem({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      role="menuitem"
      aria-current={active ? "page" : undefined}
      className={`block truncate rounded-xl px-3 py-2 text-sm font-medium transition ${
        active ? "bg-harbor-50 text-harbor-700" : "text-ink hover:bg-black/[0.04]"
      }`}
    >
      {label}
    </Link>
  );
}
