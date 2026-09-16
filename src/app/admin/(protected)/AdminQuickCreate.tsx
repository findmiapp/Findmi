"use client";

import { useState } from "react";
import Link from "next/link";

interface CreateOption {
  href: string;
  label: string;
}

// Command Center V5 pass — the exact same creation routes Command Center
// V1/V4 already offered (Business/Event/Location/Product), plus
// Appearance: /admin/appearances/new is an existing canonical Admin
// create route (AppearanceForm via saveAppearance), not a new one built
// for this pass. No new creation flow, just one compact entry point
// instead of four separate outline buttons.
const OPTIONS: CreateOption[] = [
  { href: "/admin/businesses/new", label: "Business" },
  { href: "/admin/events/new", label: "Event" },
  { href: "/admin/locations/new", label: "Location" },
  { href: "/admin/products/new", label: "Product" },
  { href: "/admin/appearances/new", label: "Appearance" },
];

/** Command Center V5 pass — Quick Create moves from a row of four
 * generic outline buttons into one primary control living right beside
 * Global Search in the command band, since creating an entity is a
 * frequent, everyday Admin action that deserves the same prominence as
 * search rather than its own separate section further down the page.
 * Same overlay-click-outside-to-close pattern AdminNav's own mobile
 * dropdown already uses — not a new interaction model. */
export default function AdminQuickCreate() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-11 items-center gap-1.5 rounded-xl bg-findmi px-4 text-sm font-semibold text-white transition hover:bg-findmi-600"
      >
        <span aria-hidden className="text-base leading-none">
          +
        </span>
        Create
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="absolute right-0 top-full z-30 mt-1.5 w-48 overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-lg"
          >
            {OPTIONS.map((option) => (
              <Link
                key={option.href}
                href={option.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-3.5 py-2 text-sm text-ink transition hover:bg-black/[0.03]"
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
