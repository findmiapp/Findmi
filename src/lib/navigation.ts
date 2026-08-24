// Founder-managed public navigation — data layer. See migrations
// create_nav_items / add_nav_items_parent_id. Same founder-control
// philosophy as homepage_rows (lib/homepage-rows.ts): a real, orderable,
// founder-editable list instead of a hardcoded array, with a safe
// code-level fallback so an empty table never breaks navigation
// (Part A10). One level of parent/child nesting (Part 6 of the 2026 QA
// pass) replaces the earlier plain-text `group_label` heading concept —
// group_label stays in the schema (harmless, unread) rather than being
// dropped, but the admin/frontend now use parent_id exclusively.
import { getSupabase } from "./supabase";
import { getAdminSupabase } from "./admin/supabase-admin";
import { findPublicRoute } from "./public-routes";

export type NavDestinationType = "route" | "custom";

/** Small, curated icon set (Part A6: "do not overengineer icons") — the
 * single list both the admin picker and NavIcon.tsx render from, so a key
 * saved in admin always resolves to a real icon on the frontend. */
export const NAV_ICON_KEYS = [
  "compass",
  "pin",
  "target",
  "bookmark",
  "person",
  "tag",
  "calendar",
  "storefront",
  "home",
  "cart",
] as const;
export type NavIconKey = (typeof NAV_ICON_KEYS)[number];

export interface NavItem {
  id: string;
  label: string;
  destination_type: NavDestinationType;
  route_key: string | null;
  custom_href: string | null;
  group_label: string | null;
  icon_key: string | null;
  is_visible: boolean;
  is_highlight: boolean;
  sort_order: number;
  /** Top-level item when null. A child (parent_id set) is never itself a
   * parent — enforced at write time in the admin actions, not just by
   * convention — so the tree is always exactly one level deep. */
  parent_id: string | null;
}

export interface ResolvedNavItem {
  id: string;
  label: string;
  /** Null for a parent-with-children row — that row exists purely to
   * expand/collapse its children in the drawer (see the worked examples
   * in the report: "Events" itself isn't a real page, "All Events" is
   * the child that is). A parent with no children still needs a real
   * href and behaves as an ordinary link (unchanged from before). */
  href: string | null;
  external: boolean;
  icon: NavIconKey | null;
  highlight: boolean;
  children: ResolvedNavItem[];
}

/** Resolves one row's destination, or null when a "route" item's
 * route_key no longer matches PUBLIC_ROUTES, or when it's a parent-role
 * row with no destination configured. */
function resolveHref(item: Pick<NavItem, "destination_type" | "route_key" | "custom_href">): string | null {
  return item.destination_type === "route" ? (findPublicRoute(item.route_key ?? "")?.path ?? null) : item.custom_href;
}

function toResolvedLeaf(item: NavItem): Omit<ResolvedNavItem, "children"> | null {
  const icon = NAV_ICON_KEYS.includes(item.icon_key as NavIconKey) ? (item.icon_key as NavIconKey) : null;
  const href = resolveHref(item);
  return {
    id: item.id,
    label: item.label,
    href,
    external: href ? /^https?:\/\//i.test(href) : false,
    icon,
    highlight: item.is_highlight,
  };
}

/** Builds the one-level tree the drawer/desktop nav actually render:
 * top-level items (parent_id null) in order, each carrying its own
 * visible children (also in order). A child with no resolvable href is
 * dropped; a top-level item is dropped only if it has neither a
 * resolvable href NOR any children (nothing to show/expand into either
 * way — dead row otherwise). */
function buildNavTree(rows: NavItem[]): ResolvedNavItem[] {
  const byParent = new Map<string, NavItem[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const list = byParent.get(row.parent_id) ?? [];
    list.push(row);
    byParent.set(row.parent_id, list);
  }

  const tree: ResolvedNavItem[] = [];
  for (const row of rows) {
    if (row.parent_id) continue; // handled as a child below
    const leaf = toResolvedLeaf(row);
    if (!leaf) continue;
    const children = (byParent.get(row.id) ?? [])
      .map(toResolvedLeaf)
      .filter((c): c is Omit<ResolvedNavItem, "children"> => Boolean(c && c.href))
      .map((c) => ({ ...c, children: [] as ResolvedNavItem[] }));
    if (!leaf.href && children.length === 0) continue; // nothing to link to or expand
    tree.push({ ...leaf, children });
  }
  return tree;
}

/** Public fetch — visible items only, in founder-chosen order, resolved
 * into a tree. Falls back to FALLBACK_NAV_ITEMS (below) when the table is
 * empty/unreachable or resolves to nothing renderable. */
export async function getVisibleNavItems(): Promise<ResolvedNavItem[]> {
  const supabase = getSupabase();
  if (!supabase) return FALLBACK_NAV_ITEMS;
  const { data } = await supabase
    .from("nav_items")
    .select("*")
    .eq("is_visible", true)
    .order("sort_order", { ascending: true });
  const rows = (data as NavItem[] | null) ?? [];
  if (rows.length === 0) return FALLBACK_NAV_ITEMS;
  const tree = buildNavTree(rows);
  return tree.length > 0 ? tree : FALLBACK_NAV_ITEMS;
}

/** All items (visible or not), for the admin Menu Builder — service role,
 * bypasses RLS. */
export async function getAdminNavItems(): Promise<NavItem[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase.from("nav_items").select("*").order("sort_order", { ascending: true });
  return (data as NavItem[]) ?? [];
}

/** Safe fallback navigation — real routes only, shown until the founder
 * has added at least one visible nav item. Restructured (Part 19/6 of the
 * live-QA pass) into genuinely useful top-level entries, some with real
 * children, rather than a flat list — Events/Brands/Marketplace/FindMi
 * for Business/About cover the site's real sections, plus a standalone
 * "You" account entry (see the report's note on why this isn't real
 * login/logout — FindMi has no account system to reflect). */
export const FALLBACK_NAV_ITEMS: ResolvedNavItem[] = [
  {
    id: "fallback-events",
    label: "Events",
    href: null,
    external: false,
    icon: "calendar",
    highlight: false,
    children: [
      { id: "fallback-events-all", label: "All Events", href: "/events", external: false, icon: null, highlight: false, children: [] },
      { id: "fallback-events-discover", label: "Discover", href: "/discover", external: false, icon: null, highlight: false, children: [] },
    ],
  },
  {
    id: "fallback-brands",
    label: "Brands",
    href: null,
    external: false,
    icon: "storefront",
    highlight: false,
    children: [
      { id: "fallback-brands-all", label: "Discover Brands", href: "/businesses", external: false, icon: null, highlight: false, children: [] },
      { id: "fallback-brands-people", label: "People", href: "/people", external: false, icon: null, highlight: false, children: [] },
      { id: "fallback-brands-locations", label: "Locations", href: "/locations", external: false, icon: null, highlight: false, children: [] },
    ],
  },
  { id: "fallback-marketplace", label: "Marketplace", href: "/marketplace", external: false, icon: "tag", highlight: false, children: [] },
  {
    id: "fallback-for-business",
    label: "FindMi for Business",
    href: null,
    external: false,
    icon: null,
    highlight: false,
    children: [
      { id: "fallback-fb-join", label: "Join FindMi", href: "/join", external: false, icon: null, highlight: true, children: [] },
    ],
  },
  { id: "fallback-about", label: "About", href: "/about", external: false, icon: null, highlight: false, children: [] },
  { id: "fallback-you", label: "You", href: "/you", external: false, icon: "person", highlight: false, children: [] },
];

/** Validates a founder-entered Custom Link destination (Part A4.2). Only
 * two shapes are accepted: an internal path starting with "/", or an
 * absolute https:// URL — anything else (javascript:, data:, vbscript:,
 * protocol-relative //host tricks, admin/private paths, bare text) is
 * rejected with a plain-language reason. */
export function validateCustomDestination(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value) return { ok: false, error: "Enter a destination." };
  if (/\s/.test(value) || value.includes("\\")) {
    return { ok: false, error: "That doesn't look like a valid link." };
  }

  if (/^https:\/\//i.test(value)) {
    try {
      new URL(value);
    } catch {
      return { ok: false, error: "That doesn't look like a valid link." };
    }
    return { ok: true, value };
  }
  if (/^https?:\/\//i.test(value)) {
    return { ok: false, error: "External links must start with https://." };
  }

  if (value.startsWith("/")) {
    if (value.startsWith("//")) return { ok: false, error: "That doesn't look like a valid link." };
    if (value.toLowerCase().startsWith("/admin")) {
      return { ok: false, error: "Admin pages can't be added to public navigation." };
    }
    return { ok: true, value };
  }

  return { ok: false, error: "Enter an internal path starting with / or a link starting with https://." };
}
