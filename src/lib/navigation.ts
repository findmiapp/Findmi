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

/** Founder-editable audience gate (Navigation Information Architecture +
 * Founder-Editable Audience pass). "everyone" (the default every existing
 * row got via the additive migration, so production navigation never
 * silently disappears) always renders; "logged_out"/"logged_in" render
 * only for that specific viewer state. This is the ONE source of truth
 * for which items a viewer sees — see filterNavItemsForAudience below,
 * the only function that ever reads it. */
export const NAV_AUDIENCES = ["everyone", "logged_out", "logged_in"] as const;
export type NavAudience = (typeof NAV_AUDIENCES)[number];

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
  audience: NavAudience;
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
  audience: NavAudience;
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
    audience: NAV_AUDIENCES.includes(item.audience) ? item.audience : "everyone",
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
  return resolveNavTree((data as NavItem[] | null) ?? []);
}

/** Visible rows (already in sort order) → the rendered tree, or the
 * default IA when nothing renderable remains. Pure — tests exercise the
 * exact path a saved Admin edit takes to the public menu. */
export function resolveNavTree(rows: NavItem[]): ResolvedNavItem[] {
  const visible = rows.filter((r) => r.is_visible);
  if (visible.length === 0) return FALLBACK_NAV_ITEMS;
  const tree = buildNavTree(visible);
  return tree.length > 0 ? tree : FALLBACK_NAV_ITEMS;
}

/** All items (visible or not), for the admin Menu Builder — service role,
 * bypasses RLS.
 *
 * Security Pass 4 note: deliberately NOT switched to requireAdminSupabase()
 * — this file is shared with a Client Component (AppearanceCard.tsx uses
 * other exports from it), and requireAdminSupabase() transitively imports
 * next/headers, which taints the whole module for every importer and
 * breaks the build. This function's only caller is the middleware-gated
 * /admin/site/navigation Server Component page (verified — see this
 * pass's report), which remains its protection; it is not an independent
 * Server Action/API route boundary the way the actions.ts files are. */
export async function getAdminNavItems(): Promise<NavItem[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase.from("nav_items").select("*").order("sort_order", { ascending: true });
  return (data as NavItem[]) ?? [];
}

/** Safe fallback navigation — shown only when nav_items has no visible,
 * renderable row (empty/unreachable table). Pass A — the approved
 * consumer discovery IA: Discover · Events · Places · Brands · Moments. */
export const FALLBACK_NAV_ITEMS: ResolvedNavItem[] = [
  { id: "fallback-discover", label: "Discover", href: "/discover", external: false, icon: "compass", highlight: false, audience: "everyone", children: [] },
  { id: "fallback-events", label: "Events", href: "/events", external: false, icon: "calendar", highlight: false, audience: "everyone", children: [] },
  { id: "fallback-places", label: "Places", href: "/locations", external: false, icon: "pin", highlight: false, audience: "everyone", children: [] },
  { id: "fallback-brands", label: "Brands", href: "/businesses", external: false, icon: "storefront", highlight: false, audience: "everyone", children: [] },
  { id: "fallback-moments", label: "Moments", href: "/moments", external: false, icon: "target", highlight: false, audience: "everyone", children: [] },
];

// ── Public discovery navigation contract ─────────────────────────────────
// nav_items drives the public DISCOVERY navigation (desktop bar + the
// mobile drawer's Discover section). Account, authentication, Cart and
// Admin controls are code-owned (account menu, auth row, Cart, Admin
// toolbar), so a row pointing at one of these destinations is RESERVED:
// it never renders in the public menu (it would duplicate the code-owned
// control), the Admin editor marks it read-only, and saving a new
// reserved destination is rejected.

export interface ReservedNavDestination {
  prefix: string;
  /** Which code-owned control already provides it (shown in Admin). */
  owner: string;
}

export const RESERVED_NAV_DESTINATIONS: ReservedNavDestination[] = [
  { prefix: "/login", owner: "the Log In button" },
  { prefix: "/join", owner: "Join For Free and the For Business link" },
  { prefix: "/account", owner: "the account menu" },
  { prefix: "/my-world", owner: "the account menu" },
  { prefix: "/saved", owner: "the account menu" },
  { prefix: "/you", owner: "the account menu" },
  { prefix: "/cart", owner: "the Cart button" },
  { prefix: "/admin", owner: "the Admin toolbar" },
];

/** The code-owned control a destination belongs to, or null. External
 * links are never reserved. */
export function reservedNavOwner(href: string | null | undefined): string | null {
  if (!href || !href.startsWith("/")) return null;
  const path = href.split(/[?#]/)[0];
  const hit = RESERVED_NAV_DESTINATIONS.find((r) => path === r.prefix || path.startsWith(`${r.prefix}/`));
  return hit?.owner ?? null;
}

/** The public discovery tree: reserved rows removed; a group left with no
 * child and no destination of its own is removed too. */
export function publicDiscoveryNav(items: ResolvedNavItem[]): ResolvedNavItem[] {
  return items.flatMap((item) => {
    if (reservedNavOwner(item.href)) return [];
    const children = item.children.filter((c) => !reservedNavOwner(c.href));
    if (!item.href && children.length === 0) return [];
    return [{ ...item, children }];
  });
}

/** Desktop overflow strategy (no horizontal scrolling): the bar takes
 * top-level items in order while they fit BOTH limits — at most
 * DESKTOP_NAV_MAX_ITEMS items and DESKTOP_NAV_CHAR_BUDGET label characters
 * (measured: the bar has ~490px at 1024px signed out, ~8px per character
 * plus ~32px per item). Everything after moves into "More ▾", which itself
 * takes a slot. The approved five labels use 33 characters. Admin also
 * caps each top-level label at NAV_TOP_LABEL_MAX and warns when items
 * will move into More. */
export const DESKTOP_NAV_MAX_ITEMS = 5;
export const DESKTOP_NAV_CHAR_BUDGET = 36;
export const NAV_TOP_LABEL_MAX = 14;
const MORE_COST = 6; // "More" + chevron

const barCost = (item: Pick<ResolvedNavItem, "label" | "children">) => item.label.length + (item.children.length > 0 ? 2 : 0);

export function splitDesktopNav<T extends Pick<ResolvedNavItem, "label" | "children">>(items: T[]): { bar: T[]; more: T[] } {
  let used = 0;
  let count = 0;
  for (const item of items) {
    if (count >= DESKTOP_NAV_MAX_ITEMS || used + barCost(item) > DESKTOP_NAV_CHAR_BUDGET) break;
    used += barCost(item);
    count += 1;
  }
  if (count === items.length) return { bar: items, more: [] };
  // Make room for More itself.
  while (count > 0 && (count + 1 > DESKTOP_NAV_MAX_ITEMS || used + MORE_COST > DESKTOP_NAV_CHAR_BUDGET)) {
    count -= 1;
    used -= barCost(items[count]);
  }
  return { bar: items.slice(0, count), more: items.slice(count) };
}

/** Detail routes that belong to a discovery index (/location/x → Places). */
const ACTIVE_ALIASES: Record<string, string[]> = {
  "/discover": ["/find"],
  "/events": ["/event"],
  "/locations": ["/location"],
  "/businesses": ["/business"],
  "/moments": ["/journal"],
};

export function navHrefActive(pathname: string, href: string | null): boolean {
  if (!href || !href.startsWith("/") || href === "/") return href === "/" && pathname === "/";
  const path = href.split(/[?#]/)[0];
  return [path, ...(ACTIVE_ALIASES[path] ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function navItemActive(pathname: string, item: ResolvedNavItem): boolean {
  return navHrefActive(pathname, item.href) || item.children.some((c) => navHrefActive(pathname, c.href));
}

/** How a stored row behaves in the PUBLIC menu — for the Admin editor. */
export function navRowPublicStatus(row: NavItem, rows: NavItem[]): { reservedBy: string | null; hiddenGroup: boolean } {
  const reservedBy = reservedNavOwner(resolveHref(row));
  if (reservedBy || row.parent_id) return { reservedBy, hiddenGroup: false };
  const children = rows.filter((r) => r.parent_id === row.id);
  const hiddenGroup = !resolveHref(row) && children.length > 0 && children.every((c) => reservedNavOwner(resolveHref(c)));
  return { reservedBy: null, hiddenGroup };
}

function audienceMatches(audience: NavAudience, authenticated: boolean): boolean {
  if (audience === "everyone") return true;
  return authenticated ? audience === "logged_in" : audience === "logged_out";
}

/** Navigation Information Architecture + Founder-Editable Audience pass —
 * the ONE place a viewer's nav tree is narrowed by audience, replacing
 * the earlier pass's hardcoded href-based acquisition-CTA filter with a
 * real, founder-editable `audience` column (see NavItemCard in the admin
 * Navigation editor). A top-level item whose own audience excludes this
 * viewer is dropped ENTIRELY, children included, regardless of any
 * child's own audience — "a child must never render if its parent is
 * hidden for that viewer." A top-level item that DOES match is kept, but
 * its children are still independently filtered by their own audience —
 * a "logged_in"-only child inside an "everyone" parent (e.g. Discover)
 * only shows to a signed-in visitor, and vice versa. Called once, in the
 * public layout, against the same single getVisibleNavItems() fetch
 * both MobileHeader/HamburgerMenu and NavDesktop already share — never a
 * second nav_items query. */
export function filterNavItemsForAudience(items: ResolvedNavItem[], authenticated: boolean): ResolvedNavItem[] {
  return items
    .filter((item) => audienceMatches(item.audience, authenticated))
    .map((item) => ({
      ...item,
      children: item.children.filter((child) => audienceMatches(child.audience, authenticated)),
    }));
}

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
