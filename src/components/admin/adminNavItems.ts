/** Admin V2, Pass 1 — the ONE route model every piece of Admin navigation
 * renders from (desktop rail, mobile bottom bar, section hubs, breadcrumb
 * context). It organizes the EXISTING admin routes by job — nothing here
 * is a new destination except the four section hubs themselves, which
 * are just indexes of these same links.
 *
 *   Home       /admin                — command center
 *   Directory  /admin/directory      — the structural graph (who/what/where)
 *   Activity   /admin/activity       — real-world, time-based activity
 *   Requests   /admin/requests       — inbound things waiting on Findmi
 *   More       /admin/more           — accounts, commerce, growth, site, legacy
 *
 * Opportunities has no dedicated Admin surface of its own (opportunity
 * threads live inside Communications), so it isn't a primary section;
 * Requests is the truthful fourth tab. Journal entries are edited at
 * /admin/journal/[id] (reached from the public entry) — there is no
 * Admin Journal list, so none is linked here. */

export type AdminSectionKey = "home" | "directory" | "activity" | "requests" | "more";

export interface AdminNavItem {
  href: string;
  label: string;
  hint?: string;
}

export interface AdminNavGroup {
  label?: string;
  items: AdminNavItem[];
}

export interface AdminSection {
  key: AdminSectionKey;
  label: string;
  href: string;
  /** Hub subtitle. */
  description?: string;
  groups: AdminNavGroup[];
}

export const ADMIN_SECTIONS: AdminSection[] = [
  { key: "home", label: "Home", href: "/admin", groups: [] },
  {
    key: "directory",
    label: "Directory",
    href: "/admin/directory",
    description: "Businesses, places, products and the taxonomy that connects them.",
    groups: [
      {
        items: [
          { href: "/admin/businesses", label: "Businesses", hint: "Profiles, review, ownership, locations" },
          { href: "/admin/locations", label: "Locations", hint: "Venues & places" },
          { href: "/admin/products", label: "Products", hint: "Catalog & marketplace review" },
          { href: "/admin/people", label: "People", hint: "Directory people" },
        ],
      },
      {
        label: "Structure",
        items: [
          { href: "/admin/categories", label: "Categories", hint: "Discovery taxonomy" },
          { href: "/admin/markets", label: "Markets & Areas", hint: "Findmi Markets and their Areas" },
        ],
      },
    ],
  },
  {
    key: "activity",
    label: "Activity",
    href: "/admin/activity",
    description: "What's happening in the real world, and when.",
    groups: [
      {
        items: [
          { href: "/admin/events", label: "Events", hint: "Events, dates & participating businesses" },
          { href: "/admin/appearances", label: "Appearances", hint: "Where businesses will be" },
          { href: "/admin/activations", label: "Activations", hint: "Experiences Findmi produces" },
        ],
      },
      {
        label: "Tools",
        items: [{ href: "/admin/appearances/import", label: "Import Appearances", hint: "Paste or upload a schedule" }],
      },
    ],
  },
  {
    key: "requests",
    label: "Requests",
    href: "/admin/requests",
    description: "Claims, requests and conversations waiting on Findmi.",
    groups: [
      {
        items: [
          { href: "/admin/claims", label: "Claims", hint: "Ownership claims" },
          { href: "/admin/market-requests", label: "Market Requests", hint: "Geography requested but not yet a Market" },
          { href: "/admin/conversations", label: "Communications", hint: "Inquiries, direct & opportunity messages, sales" },
        ],
      },
      {
        label: "Inquiries",
        items: [
          { href: "/admin/inquiries", label: "Inquiries", hint: "Native Findmi inquiry threads" },
          { href: "/admin/sales-inquiries", label: "Sales Inquiries", hint: "Multi-Region/National leads" },
        ],
      },
    ],
  },
  {
    key: "more",
    label: "More",
    href: "/admin/more",
    groups: [
      { label: "Accounts", items: [{ href: "/admin/users", label: "Users", hint: "Findmi accounts & access" }] },
      {
        label: "Commerce",
        items: [
          { href: "/admin/orders", label: "Orders", hint: "Marketplace orders" },
          { href: "/admin/settlements", label: "Settlements", hint: "Seller payouts" },
        ],
      },
      {
        label: "Growth",
        items: [
          { href: "/admin/pro-invites", label: "Pro Invites", hint: "Complimentary Pro access codes" },
          { href: "/admin/referrals", label: "Referrals", hint: "Referral partners & commissions" },
          { href: "/admin/qr-campaigns", label: "QR Campaigns", hint: "Physical QR scan attribution" },
        ],
      },
      {
        label: "Site",
        items: [
          { href: "/admin/site", label: "Site Editor", hint: "Site content & settings" },
          { href: "/admin/bulletins", label: "Homepage Bulletins", hint: "Editorial homepage announcement" },
        ],
      },
      {
        label: "Legacy",
        items: [
          { href: "/admin/onboarding", label: "Onboarding", hint: "Legacy onboarding" },
          { href: "/admin/plans", label: "Plans", hint: "Legacy plan configuration" },
          { href: "/admin/forms", label: "Forms", hint: "Legacy form system" },
        ],
      },
    ],
  },
];

/** Routes that belong to a section without being listed in it (sub-tools
 * reached from their own parent pages). Checked after the listed items. */
const EXTRA_SECTION_PREFIXES: { prefix: string; section: AdminSectionKey; label: string; listHref: string }[] = [
  { prefix: "/admin/journal", section: "activity", label: "Journal", listHref: "/admin/activity" },
  { prefix: "/admin/email-test", section: "more", label: "Email Test", listHref: "/admin/more" },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export interface AdminRouteContext {
  section: AdminSectionKey;
  /** The listed destination this path is inside of, if any. */
  item: AdminNavItem | null;
  /** True below a destination's own list page (a detail/new/edit route). */
  isDetail: boolean;
}

/** Which section + destination a pathname belongs to — longest matching
 * href wins (so /admin/appearances/import beats /admin/appearances). */
export function resolveAdminRoute(pathname: string): AdminRouteContext {
  let best: { section: AdminSectionKey; item: AdminNavItem } | null = null;
  for (const section of ADMIN_SECTIONS) {
    if (section.key !== "home" && isActive(pathname, section.href)) {
      return { section: section.key, item: null, isDetail: false };
    }
    for (const group of section.groups) {
      for (const item of group.items) {
        if (isActive(pathname, item.href) && (!best || item.href.length > best.item.href.length)) {
          best = { section: section.key, item };
        }
      }
    }
  }
  if (best) return { section: best.section, item: best.item, isDetail: pathname !== best.item.href };
  for (const extra of EXTRA_SECTION_PREFIXES) {
    if (isActive(pathname, extra.prefix)) {
      return { section: extra.section, item: { href: extra.listHref, label: extra.label }, isDetail: true };
    }
  }
  return { section: "home", item: null, isDetail: false };
}

export function getAdminSection(key: AdminSectionKey): AdminSection {
  return ADMIN_SECTIONS.find((s) => s.key === key)!;
}
