/** Admin V2, Pass 1 — the ONE route model every piece of Admin navigation
 * renders from (desktop rail, mobile bottom bar, section hubs, breadcrumb
 * context). It organizes the EXISTING admin routes by job — nothing here
 * is a new destination except the four section hubs themselves, which
 * are just indexes of these same links.
 *
 *   Admin Home /admin                — command center (distinct from
 *              "View Findmi", which leaves Admin for the public site, /)
 *   Directory  /admin/directory      — the structural graph (who/what/where)
 *   Activity   /admin/activity       — real-world, time-based activity
 *   Requests   /admin/requests       — inbound things waiting on Findmi
 *   More       /admin/more           — accounts, commerce, growth, site, legacy
 *
 * Commercial Opportunities (Findmi-authored, sent to Businesses) live
 * under Activity at /admin/opportunities. Event participation opportunity
 * threads still live inside Communications. Neither is a primary section;
 * Requests is the truthful fourth tab. Journal entries are edited at
 * /admin/journal/[id] (reached from the public entry) — there is no
 * Admin Journal list, so none is linked here. */

export type AdminSectionKey = "home" | "directory" | "activity" | "requests" | "more";

export interface AdminNavItem {
  href: string;
  label: string;
  hint?: string;
  /** false = not listed in the desktop rail (the route still resolves, so
   * breadcrumbs and active states keep working). */
  sidebar?: boolean;
  /** false = not listed in its section hub either (it lives behind another
   * destination, e.g. the Import hub). */
  hub?: boolean;
  /** The listed destination this one lives behind — active states and
   * breadcrumbs resolve to it. */
  parent?: string;
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

/** The five existing import/convert tools. One list: the Import hub page
 * (/admin/import), the toolbar's Import menu and route resolution all read
 * it. Every route stays exactly where it was. */
export const IMPORT_TOOLS: AdminNavItem[] = [
  { href: "/admin/events/import", label: "Import Events", hint: "Paste an Event listing or flyer" },
  { href: "/admin/locations/import", label: "Import Locations", hint: "Paste places to create Locations" },
  { href: "/admin/businesses/import", label: "Import Brands", hint: "Read a Brand from its website" },
  { href: "/admin/appearances/import", label: "Import Appearances", hint: "Paste or upload a schedule" },
  { href: "/admin/appearances/convert", label: "Convert To Events", hint: "Turn Appearances into Events" },
];

export const ADMIN_SECTIONS: AdminSection[] = [
  { key: "home", label: "Admin Home", href: "/admin", groups: [] },
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
        ],
      },
      {
        label: "Opportunities",
        items: [
          { href: "/admin/opportunities", label: "Opportunities", hint: "Commercial Opportunities Findmi recommends" },
          { href: "/admin/opportunities/intelligence", label: "Opportunity Intelligence", hint: "New Brand signals across Businesses" },
          { href: "/admin/opportunities/ideas", label: "Opportunity Ideas", hint: "Ideas Brands can respond to" },
          { href: "/admin/activations", label: "Activations", hint: "Experiences Findmi produces" },
        ],
      },
      {
        label: "Import",
        items: [
          { href: "/admin/import", label: "Import", hint: "Events, Locations, Brands & Appearances — and Convert To Events" },
          ...IMPORT_TOOLS.map((t) => ({ ...t, sidebar: false, hub: false, parent: "/admin/import" })),
        ],
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
        ],
      },
      {
        label: "Communications",
        items: [
          { href: "/admin/conversations", label: "Communications", hint: "Direct & opportunity messages — Inquiries and Sales Inquiries below" },
          { href: "/admin/inquiries", label: "Inquiries", hint: "Native Findmi inquiry threads", sidebar: false, parent: "/admin/conversations" },
          { href: "/admin/sales-inquiries", label: "Sales Inquiries", hint: "Multi-Region/National leads", sidebar: false, parent: "/admin/conversations" },
        ],
      },
      {
        label: "Pro Access",
        items: [
          { href: "/admin/pro-requests", label: "Pro Requests", hint: "Pro access requested without payment" },
          { href: "/admin/pro-invites", label: "Pro Invites", hint: "Complimentary Pro access codes" },
          { href: "/admin/plans", label: "Plans", hint: "Plan configuration" },
        ],
      },
    ],
  },
  {
    key: "more",
    label: "More",
    href: "/admin/more",
    groups: [
      {
        label: "Business Development · Private",
        items: [
          { href: "/admin/bd", label: "Business Development", hint: "Internal BD records — never public" },
          { href: "/admin/bd/organizations", label: "Organizations", hint: "Private BD Organizations, not public Businesses" },
          { href: "/admin/bd/contacts", label: "Contacts", hint: "People at private BD Organizations" },
        ],
      },
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
          { href: "/admin/referrals", label: "Referrals", hint: "Referral partners & commissions" },
          { href: "/admin/qr-campaigns", label: "QR Campaigns", hint: "Physical QR scan attribution" },
        ],
      },
      {
        label: "Site",
        items: [
          { href: "/admin/site", label: "Site Editor", hint: "Homepage, bulletins, pages, navigation & discovery" },
        ],
      },
      {
        label: "Legacy",
        items: [
          { href: "/admin/onboarding", label: "Onboarding", hint: "Legacy onboarding" },
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
  { prefix: "/admin/bulletins", section: "more", label: "Homepage Bulletins", listHref: "/admin/site" },
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
  if (best) {
    const owner = best.item.parent ? findAdminItem(best.item.parent) : null;
    const item = owner ?? best.item;
    return { section: best.section, item, isDetail: pathname !== item.href };
  }
  for (const extra of EXTRA_SECTION_PREFIXES) {
    if (isActive(pathname, extra.prefix)) {
      return { section: extra.section, item: { href: extra.listHref, label: extra.label }, isDetail: true };
    }
  }
  return { section: "home", item: null, isDetail: false };
}

function findAdminItem(href: string): AdminNavItem | null {
  for (const section of ADMIN_SECTIONS) for (const group of section.groups) for (const item of group.items) if (item.href === href) return item;
  return null;
}

export function getAdminSection(key: AdminSectionKey): AdminSection {
  return ADMIN_SECTIONS.find((s) => s.key === key)!;
}

// ── Black Admin toolbar ────────────────────────────────────────────────
// The compact operator menus, built FROM the route model above (one
// source of truth): Content (the entities), Import (the import tools) and
// Requests (everything waiting on Findmi).
const ALL_ITEMS = ADMIN_SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items));
const pick = (hrefs: string[]): AdminNavItem[] =>
  hrefs.map((href) => ALL_ITEMS.find((i) => i.href === href)).filter((i): i is AdminNavItem => Boolean(i));

export interface AdminToolbarGroup {
  key: "content" | "import" | "requests";
  label: string;
  items: AdminNavItem[];
}

export const ADMIN_TOOLBAR_GROUPS: AdminToolbarGroup[] = [
  {
    key: "content",
    label: "Content",
    items: pick([
      "/admin/businesses",
      "/admin/events",
      "/admin/locations",
      "/admin/appearances",
      "/admin/products",
      "/admin/people",
      "/admin/users",
      "/admin/categories",
      "/admin/markets",
    ]),
  },
  {
    key: "import",
    label: "Import",
    items: IMPORT_TOOLS,
  },
  {
    key: "requests",
    label: "Requests",
    // Pro Invites and Plans are configuration, not requests waiting on
    // Findmi — they stay out of this quick menu (as before).
    items: [
      { href: "/admin/requests", label: "All Requests" },
      ...getAdminSection("requests")
        .groups.flatMap((g) => g.items)
        .filter((i) => i.href !== "/admin/pro-invites" && i.href !== "/admin/plans"),
    ],
  },
];
