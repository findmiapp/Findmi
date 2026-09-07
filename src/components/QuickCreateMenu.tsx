"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import NavIcon from "./NavIcon";
import {
  PlusGlyph,
  resolveBusinessScopedHref,
  WhichBusinessPanel,
  type BusinessOption,
} from "@/app/(public)/account/BusinessScopedAction";

// Business-scoped actions (FindMi Here, Product) can't know a signed-out
// visitor's real business count in advance — sending them straight to
// "/account/business/new" would be wrong for someone who already has
// businesses. /account already shows the same Business-scoped actions,
// correctly resolved against the real (now-known) list, the moment
// they're back — so that's the one continuation target for both.
const LOGIN_CONTINUE_HREF = `/login?next=${encodeURIComponent("/account")}`;

/**
 * Global Quick-Create pass — a small sitewide "+" control surfacing the
 * same five creation actions already on /account's own "Create on
 * Findmi" strip, reachable from normal navigation. Purely an additional
 * fast-access entry point — /account keeps its own strip unchanged.
 *
 * Business/Venue/Event route straight to their existing /account/*
 * creation pages: those already sit behind the /account middleware gate
 * (see middleware.ts), which redirects a signed-out visitor to
 * /login?next=<that route> and sends them back there after signing in —
 * so a plain Link is the correct, non-duplicated continuation for all
 * three, signed in or out, with zero extra logic here.
 *
 * FindMi Here/Product are Business-scoped (see BusinessScopedAction on
 * /account): signed in, this reuses that component's own zero/one/many
 * routing decision (resolveBusinessScopedHref) and chooser
 * (WhichBusinessPanel) instead of re-deciding either.
 */
export default function QuickCreateMenu({
  authenticated,
  businesses,
}: {
  authenticated: boolean;
  businesses: BusinessOption[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [chooserTab, setChooserTab] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setChooserTab(null);
  }

  // This header persists across navigations (it lives in the shared
  // (public) layout, not any one page), so a chosen action must close
  // the menu itself — nothing unmounts it for us the way a page-level
  // component like the /account strip gets unmounted by its own route
  // change.
  function handleNavigate() {
    close();
  }

  // Auth-flow pages already show their own sign-in/sign-up UI — a create
  // shortcut that would just bounce back to an equivalent page is dead
  // weight there, not a genuine shortcut (and risks reading as circular).
  if (pathname === "/login" || pathname.startsWith("/signup")) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Create on Findmi"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-findmi text-white transition active:scale-90"
      >
        <PlusGlyph className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Create on Findmi"
          className="absolute right-0 top-full z-50 mt-2 w-60 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-black/10 bg-white p-1.5 shadow-lg"
        >
          <BusinessScopedRow
            label="FindMi Here"
            tab="findmi-here"
            icon={<PlusGlyph className="h-4 w-4" />}
            authenticated={authenticated}
            businesses={businesses}
            open={chooserTab === "findmi-here"}
            onToggleChooser={() => setChooserTab((t) => (t === "findmi-here" ? null : "findmi-here"))}
            onNavigate={handleNavigate}
          />
          <MenuLink
            href="/account/business/new"
            label="Business"
            icon={<NavIcon name="storefront" className="h-4 w-4" />}
            onNavigate={handleNavigate}
          />
          <MenuLink
            href="/account/location/new"
            label="Venue"
            icon={<NavIcon name="pin" className="h-4 w-4" />}
            onNavigate={handleNavigate}
          />
          <BusinessScopedRow
            label="Product"
            tab="products"
            icon={<NavIcon name="tag" className="h-4 w-4" />}
            authenticated={authenticated}
            businesses={businesses}
            open={chooserTab === "products"}
            onToggleChooser={() => setChooserTab((t) => (t === "products" ? null : "products"))}
            onNavigate={handleNavigate}
          />
          <MenuLink
            href="/account/event/new"
            label="Event"
            icon={<NavIcon name="calendar" className="h-4 w-4" />}
            onNavigate={handleNavigate}
          />
        </div>
      )}
    </div>
  );
}

const menuRowClass =
  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink transition hover:bg-black/[0.03]";

function MenuLink({
  href,
  label,
  icon,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  onNavigate: () => void;
}) {
  return (
    <Link href={href} role="menuitem" onClick={onNavigate} className={menuRowClass}>
      <span className="shrink-0 text-ink/50">{icon}</span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

/** One Business-scoped menu row (FindMi Here / Product) — reuses
 * resolveBusinessScopedHref/WhichBusinessPanel from BusinessScopedAction
 * rather than re-deciding the zero/one/many routing itself. Signed out,
 * this always routes through login (see LOGIN_CONTINUE_HREF's own note
 * above) since the real business count isn't known until then. */
function BusinessScopedRow({
  label,
  tab,
  icon,
  authenticated,
  businesses,
  open,
  onToggleChooser,
  onNavigate,
}: {
  label: string;
  tab: string;
  icon: ReactNode;
  authenticated: boolean;
  businesses: BusinessOption[];
  open: boolean;
  onToggleChooser: () => void;
  onNavigate: () => void;
}) {
  if (!authenticated) {
    return <MenuLink href={LOGIN_CONTINUE_HREF} label={label} icon={icon} onNavigate={onNavigate} />;
  }

  const href = resolveBusinessScopedHref(businesses, tab);
  if (href) {
    return <MenuLink href={href} label={label} icon={icon} onNavigate={onNavigate} />;
  }

  return (
    <div className="relative">
      <button
        type="button"
        role="menuitem"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={onToggleChooser}
        className={menuRowClass}
      >
        <span className="shrink-0 text-ink/50">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
      {/* WhichBusinessPanel itself has no onNavigate hook (its only other
          caller, the /account strip, gets closed for free by that page's
          own unmount on navigation) — wrapping it here closes THIS menu
          on any bubbled click from one of its business links, since this
          menu lives in the persistent header and nothing else would. */}
      {open && (
        <div onClick={onNavigate}>
          <WhichBusinessPanel businesses={businesses} tab={tab} className="left-0 right-0" />
        </div>
      )}
    </div>
  );
}
