import type { NavIconKey } from "@/lib/navigation";

/** Admin Command Center V5 pass — PRIMARY/MORE_GROUPS extracted out of
 * AdminNav.tsx (unchanged content — same routes/labels/hints, same
 * priority order) so the new desktop AdminSidebar and the existing
 * mobile/tablet AdminNav render from ONE route list instead of two that
 * could silently drift apart. isActive is the same single rule both use
 * for "is this the current admin route." */

export interface NavItem {
  href: string;
  label: string;
  /** More menu / sidebar secondary group only — short line under the label. */
  hint?: string;
  /** Sidebar-only — PRIMARY items get a recognizable glyph; secondary
   * groups intentionally don't (icons on every one of 14 destinations
   * would be decorative, not recognition). */
  icon?: NavIconKey;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// Exact conceptual priority order the original Command Center V1 pass specified.
export const PRIMARY: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: "compass" },
  { href: "/admin/businesses", label: "Businesses", icon: "storefront" },
  { href: "/admin/events", label: "Events", icon: "calendar" },
  { href: "/admin/appearances", label: "Appearances", icon: "pin" },
  { href: "/admin/claims", label: "Claims", icon: "bookmark" },
  { href: "/admin/users", label: "Users", icon: "person" },
];

export const MORE_GROUPS: NavGroup[] = [
  {
    label: "Manage",
    items: [
      { href: "/admin/people", label: "People", hint: "Directory people" },
      { href: "/admin/locations", label: "Locations", hint: "Venues & places" },
      { href: "/admin/markets", label: "Markets", hint: "Findmi Markets & Area presentation" },
      { href: "/admin/market-requests", label: "Market Requests", hint: "Geography requested but not yet a Market" },
      { href: "/admin/products", label: "Products", hint: "Business products" },
      { href: "/admin/categories", label: "Categories", hint: "Discovery taxonomy" },
      { href: "/admin/pro-invites", label: "Pro Invites", hint: "Complimentary Pro access codes" },
      { href: "/admin/referrals", label: "Referrals", hint: "Referral partners & commissions" },
      { href: "/admin/qr-campaigns", label: "QR Campaigns", hint: "Physical QR scan attribution" },
      { href: "/admin/inquiries", label: "Inquiries", hint: "Native Findmi inquiry threads" },
      {
        href: "/admin/sales-inquiries",
        label: "Sales Inquiries",
        hint: "Multi-Region/National leads from Join's Talk to Sales",
      },
      {
        href: "/admin/conversations",
        label: "Communications",
        hint: "All platform communications — inquiries, direct messages, and sales",
      },
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
export function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}
