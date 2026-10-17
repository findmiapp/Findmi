"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AdminEditThisPageLink from "./AdminEditThisPageLink";
import { ADMIN_TOOLBAR_GROUPS, isActive } from "./admin/adminNavItems";
import { ADMIN_CREATE_OPTIONS } from "./admin/shell/AdminQuickCreate";

type MenuKey = "content" | "import" | "requests" | "create" | "mobile";

/** The black Admin toolbar's client half (AdminToolbar gates it on the
 * real Admin session). Desktop (lg+, matching the public header): Admin · Content ▾ · Import ▾ · Requests ▾
 * … Edit This Page · + Create ▾ · View Findmi (inside /admin). Mobile: one
 * "Admin ▾" menu holding the same groups, plus + Create. Menus close on
 * outside tap, Escape and navigation. Height stays 1.75rem (h-7) — the
 * value --admin-bar-h mirrors in globals.css. */
export default function AdminToolbarBar({ placement }: { placement: "public" | "static" }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<MenuKey | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  useEffect(() => setOpen(null), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (key: MenuKey) => setOpen((prev) => (prev === key ? null : key));
  const close = () => setOpen(null);

  return (
    <div
      id="findmi-admin-bar"
      ref={rootRef}
      data-placement={placement}
      className={`z-50 h-7 border-b border-white/10 bg-ink pt-[env(safe-area-inset-top)] ${
        placement === "public" ? "fixed inset-x-0 top-0 lg:relative lg:inset-auto" : "relative"
      }`}
    >
      <div className="mx-auto flex h-7 max-w-6xl items-center gap-0.5 px-2 sm:px-4">
        {/* Mobile: one Admin menu */}
        <MenuButton label="Admin" open={open === "mobile"} onClick={() => toggle("mobile")} className="lg:hidden" />

        {/* Desktop: Admin + grouped menus */}
        <Link href="/admin" className={`${barItem} hidden lg:flex ${pathname === "/admin" ? "text-white" : ""}`}>
          Admin
        </Link>
        {ADMIN_TOOLBAR_GROUPS.map((group) => (
          <div key={group.key} className="relative hidden lg:block">
            <MenuButton
              label={group.label}
              open={open === group.key}
              active={group.items.some((i) => isActive(pathname, i.href))}
              onClick={() => toggle(group.key)}
            />
            {open === group.key && (
              <MenuPanel>
                {group.items.map((item) => (
                  <MenuLink key={item.href} href={item.href} label={item.label} active={isActive(pathname, item.href)} onClick={close} />
                ))}
              </MenuPanel>
            )}
          </div>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <AdminEditThisPageLink />
          {/* Inside /admin the shell already has its own Create. */}
          {!inAdmin && (
          <div className="relative">
            <button type="button" onClick={() => toggle("create")} aria-expanded={open === "create"} aria-haspopup="menu" className={`${barItem} gap-1 text-white`}>
              <span aria-hidden="true" className="text-[13px] leading-none">+</span> Create
            </button>
            {open === "create" && (
              <MenuPanel align="right">
                {ADMIN_CREATE_OPTIONS.map((o) => (
                  <MenuLink key={o.href} href={o.href} label={o.label} onClick={close} />
                ))}
              </MenuPanel>
            )}
          </div>
          )}
          {inAdmin && (
            <Link href="/" className={`${barItem} hidden lg:flex`}>
              View Findmi
            </Link>
          )}
        </div>
      </div>

      {/* Mobile Admin menu: full-width sheet under the bar */}
      {open === "mobile" && (
        <div role="menu" className="absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-white/10 bg-ink px-3 pb-3 pt-1 shadow-xl lg:hidden">
          <div className="grid grid-cols-2 gap-1.5 py-1.5">
            <SheetLink href="/admin" label="Admin Home" active={pathname === "/admin"} onClick={close} />
            {inAdmin && <SheetLink href="/" label="View Findmi" onClick={close} />}
          </div>
          {ADMIN_TOOLBAR_GROUPS.map((group) => (
            <div key={group.key} className="pt-2">
              <p className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wide text-white/40">{group.label}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {group.items.map((item) => (
                  <SheetLink key={item.href} href={item.href} label={item.label} active={isActive(pathname, item.href)} onClick={close} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const barItem = "flex h-7 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-[11px] font-medium text-white/70 transition hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/60";

function MenuButton({ label, open, active = false, onClick, className = "" }: { label: string; open: boolean; active?: boolean; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} aria-haspopup="menu" className={`${barItem} gap-0.5 ${open || active ? "text-white" : ""} ${className}`}>
      {label}
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}>
        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function MenuPanel({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <div role="menu" className={`absolute top-full mt-1 min-w-[200px] rounded-xl border border-black/10 bg-white p-1 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}>
      {children}
    </div>
  );
}

function MenuLink({ href, label, active = false, onClick }: { href: string; label: string; active?: boolean; onClick: () => void }) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${active ? "bg-findmi-50 text-findmi-700" : "text-ink hover:bg-black/[0.04]"}`}
    >
      {label}
    </Link>
  );
}

function SheetLink({ href, label, active = false, onClick }: { href: string; label: string; active?: boolean; onClick: () => void }) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className={`flex min-h-10 items-center rounded-lg px-3 text-[13px] font-semibold transition active:scale-[0.98] ${
        active ? "bg-findmi text-white" : "bg-white/[0.07] text-white/90 hover:bg-white/[0.12]"
      }`}
    >
      {label}
    </Link>
  );
}
