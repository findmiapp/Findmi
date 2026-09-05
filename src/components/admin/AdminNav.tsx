"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Admin Navigation Simplify + Organize pass — replaces the old flat,
// 16-item horizontally-scrolling nav (every route at equal visual
// weight) with a small primary set (everyday destinations) plus a
// compact "More" dropdown for everything else. No routes removed,
// renamed, or behavior-changed — this is purely the nav's own
// presentation/organization.

interface NavItem {
  href: string;
  label: string;
  /** More menu only — short secondary line under the label. */
  hint?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// Exact conceptual priority order the pass specified.
const PRIMARY: NavItem[] = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/businesses", label: "Businesses" },
  { href: "/admin/events", label: "Events" },
  { href: "/admin/appearances", label: "Appearances" },
  { href: "/admin/claims", label: "Claims" },
  { href: "/admin/users", label: "Users" },
];

const MORE_GROUPS: NavGroup[] = [
  {
    label: "Manage",
    items: [
      { href: "/admin/people", label: "People", hint: "Directory people" },
      { href: "/admin/locations", label: "Locations", hint: "Venues & places" },
      { href: "/admin/products", label: "Products", hint: "Business products" },
      { href: "/admin/categories", label: "Categories", hint: "Discovery taxonomy" },
      { href: "/admin/pro-invites", label: "Pro Invites", hint: "Complimentary Pro access codes" },
      { href: "/admin/referrals", label: "Referrals", hint: "Referral partners & commissions" },
      { href: "/admin/site", label: "Site Editor", hint: "Site content & settings" },
    ],
  },
  {
    label: "Legacy & Operations",
    items: [
      { href: "/admin/onboarding", label: "Onboarding", hint: "Legacy onboarding" },
      { href: "/admin/plans", label: "Plans", hint: "Legacy plan configuration" },
      { href: "/admin/forms", label: "Forms", hint: "Legacy form system" },
      { href: "/admin/orders", label: "Orders", hint: "Commerce orders" },
      { href: "/admin/settlements", label: "Settlements", hint: "Seller payouts" },
    ],
  },
];

/** Dashboard (/admin) only matches itself — every other admin route also
 * starts with "/admin", so an exact match there is required; every other
 * item matches its own sub-routes too (e.g. /admin/businesses/[id]). */
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

const pillBase = "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition";
const pillInactive = "text-ink/60 hover:bg-black/[0.04] hover:text-ink";
const pillActive = "bg-findmi-50 text-findmi-700";

export default function AdminNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const moreActive = MORE_GROUPS.some((g) => g.items.some((item) => isActive(pathname, item.href)));

  return (
    <nav className="relative mx-auto flex max-w-5xl items-center px-4 pb-2 sm:px-6">
      {/* Primary set only — the restrained horizontal scroll this pass
          asks for applies just to these six, never to the whole nav. */}
      <div className="flex flex-1 gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PRIMARY.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`${pillBase} ${isActive(pathname, item.href) ? pillActive : pillInactive}`}
          >
            {item.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          className={`${pillBase} ${open || moreActive ? pillActive : pillInactive}`}
        >
          More
        </button>
      </div>

      {open && (
        <>
          {/* Transparent, full-viewport — closes the menu on any outside
              click/tap without a ref/effect-based listener. */}
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="absolute right-4 top-full z-30 mt-1 w-72 max-w-[90vw] overflow-hidden rounded-2xl border border-black/10 bg-white py-1 shadow-lg sm:right-6"
          >
            {MORE_GROUPS.map((group) => (
              <div key={group.label} className="border-b border-black/5 p-2 last:border-b-0">
                <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-ink/40">{group.label}</p>
                {group.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      onClick={() => setOpen(false)}
                      className={`flex flex-col rounded-lg px-2 py-1.5 transition hover:bg-black/[0.03] ${
                        active ? "bg-findmi-50" : ""
                      }`}
                    >
                      <span className={`text-sm font-medium ${active ? "text-findmi-700" : "text-ink"}`}>
                        {item.label}
                      </span>
                      {item.hint && <span className="text-[11px] text-ink/45">{item.hint}</span>}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </nav>
  );
}
