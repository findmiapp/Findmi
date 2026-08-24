"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Logo from "./Logo";
import NavIcon from "./NavIcon";
import { groupNavItems, type ResolvedNavItem } from "@/lib/navigation";

// Header hamburger trigger + mobile nav drawer (2026 navigation pass,
// Part A). `items` comes from getVisibleNavItems() (founder-managed, with
// a safe real-route fallback — see lib/navigation.ts), fetched once by
// the server layout and passed down, so this stays a plain client island
// rather than fetching its own data.
export default function HamburgerMenu({ items }: { items: ResolvedNavItem[] }) {
  const [open, setOpen] = useState(false);
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

  const groups = groupNavItems(items);

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
          via CSS transform/opacity instead of a mount/unmount jump. */}
      <div
        className={`fixed inset-0 z-50 ${open ? "pointer-events-auto" : "pointer-events-none"}`}
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
          <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 py-3">
            <Logo heightClassName="h-8" />
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

          <nav className="flex-1 overflow-y-auto px-3 py-3">
            {groups.map((group, i) => (
              <div key={i} className="mb-4 last:mb-0">
                {group.label && (
                  <p className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-ink/40">{group.label}</p>
                )}
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <NavRow key={item.id} item={item} onNavigate={close} />
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}

function NavRow({ item, onNavigate }: { item: ResolvedNavItem; onNavigate: () => void }) {
  const rowClass = `flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition ${
    item.highlight
      ? "bg-findmi font-bold uppercase tracking-wide text-white hover:bg-findmi-600"
      : "font-medium text-ink hover:bg-black/[0.03]"
  }`;

  const content = (
    <>
      {item.icon && <NavIcon name={item.icon} className="h-5 w-5 shrink-0" />}
      <span className="truncate">{item.label}</span>
    </>
  );

  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" onClick={onNavigate} className={rowClass}>
        {content}
      </a>
    );
  }

  return (
    <Link href={item.href} onClick={onNavigate} className={rowClass}>
      {content}
    </Link>
  );
}
