"use client";

import { useState } from "react";
import Link from "next/link";

interface CreateOption {
  href: string;
  label: string;
}

// The existing canonical Admin create routes — no new creation flow.
const OPTIONS: CreateOption[] = [
  { href: "/admin/businesses/new", label: "Business" },
  { href: "/admin/events/new", label: "Event" },
  { href: "/admin/locations/new", label: "Location" },
  { href: "/admin/appearances/new", label: "Appearance" },
  { href: "/admin/products/new", label: "Product" },
];

/** Admin V2 — Quick Create, available everywhere in the shell (sidebar on
 * desktop, top bar on mobile) and full-size on Admin Home. Same
 * overlay-click-outside-to-close menu as before. */
export default function AdminQuickCreate({
  compact = false,
  align = "right",
}: {
  compact?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={compact ? "Create" : undefined}
        className={
          compact
            ? "flex h-9 items-center gap-1 rounded-full bg-findmi pl-2.5 pr-3 text-metadata font-bold text-white transition hover:bg-findmi-600"
            : "flex h-11 items-center gap-1.5 rounded-xl bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600"
        }
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={compact ? "h-4 w-4" : "h-[18px] w-[18px]"}>
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        Create
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className={`absolute top-full z-50 mt-1.5 w-48 overflow-hidden rounded-xl border border-black/10 bg-white p-1 shadow-lg ${
              align === "left" ? "left-0" : "right-0"
            }`}
          >
            <p className="px-3 pb-1 pt-1.5 text-label font-bold uppercase text-subtle">Create</p>
            {OPTIONS.map((option) => (
              <Link
                key={option.href}
                href={option.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-2 text-body font-medium text-primary transition hover:bg-black/[0.04]"
              >
                {option.label}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
