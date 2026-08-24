// Founder-managed public navigation — data layer. See migration
// create_nav_items. Same founder-control philosophy as homepage_rows
// (lib/homepage-rows.ts): a real, orderable, founder-editable list
// instead of a hardcoded array, with a safe code-level fallback so an
// empty table never breaks navigation (Part A10).
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
}

export interface ResolvedNavItem {
  id: string;
  label: string;
  href: string;
  external: boolean;
  group: string | null;
  icon: NavIconKey | null;
  highlight: boolean;
}

/** Turns one stored nav item into a renderable link, or null when a
 * "route" item's route_key no longer resolves (a route was retired from
 * PUBLIC_ROUTES after the item was saved) — dropped rather than rendering
 * a dead link. */
function resolveNavItem(item: NavItem): ResolvedNavItem | null {
  const href =
    item.destination_type === "route" ? (findPublicRoute(item.route_key ?? "")?.path ?? null) : item.custom_href;
  if (!href) return null;
  const icon = NAV_ICON_KEYS.includes(item.icon_key as NavIconKey) ? (item.icon_key as NavIconKey) : null;
  return {
    id: item.id,
    label: item.label,
    href,
    external: /^https?:\/\//i.test(href),
    group: item.group_label,
    icon,
    highlight: item.is_highlight,
  };
}

/** Public fetch — visible items only, in founder-chosen order. Falls back
 * to FALLBACK_NAV_ITEMS (below) when the table is empty or unreachable —
 * see that constant's own note. */
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
  const resolved = rows.map(resolveNavItem).filter((i): i is ResolvedNavItem => Boolean(i));
  return resolved.length > 0 ? resolved : FALLBACK_NAV_ITEMS;
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
 * has added at least one visible nav item, at which point founder-managed
 * items become the sole source of truth (Part A10). Content mirrors the
 * previous hardcoded NavDesktop links (Discover/FindMi Here/Events/
 * Businesses/Marketplace/People/Join FindMi) so switching NavDesktop over
 * to the shared managed-nav source (Part A11) doesn't remove any link a
 * visitor could reach today. */
export const FALLBACK_NAV_ITEMS: ResolvedNavItem[] = [
  { id: "fallback-discover", label: "Discover", href: "/discover", external: false, group: null, icon: "compass", highlight: false },
  { id: "fallback-find", label: "FindMi Here", href: "/find", external: false, group: null, icon: "target", highlight: false },
  { id: "fallback-events", label: "Events", href: "/events", external: false, group: null, icon: "calendar", highlight: false },
  { id: "fallback-businesses", label: "Businesses", href: "/businesses", external: false, group: null, icon: "pin", highlight: false },
  { id: "fallback-marketplace", label: "Marketplace", href: "/marketplace", external: false, group: null, icon: "tag", highlight: false },
  { id: "fallback-people", label: "People", href: "/people", external: false, group: null, icon: "person", highlight: false },
  { id: "fallback-saved", label: "Saved", href: "/saved", external: false, group: null, icon: "bookmark", highlight: false },
  { id: "fallback-join", label: "Join FindMi", href: "/join", external: false, group: null, icon: null, highlight: true },
];

/** Groups items by consecutive `group` value — one-level grouping only
 * (Part A4.3: "Do NOT build nested menu trees"). Assumes the founder
 * orders same-group items adjacently via sort_order; items with no group
 * render as their own ungrouped section. */
export function groupNavItems(items: ResolvedNavItem[]): { label: string | null; items: ResolvedNavItem[] }[] {
  const groups: { label: string | null; items: ResolvedNavItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.label === item.group) last.items.push(item);
    else groups.push({ label: item.group, items: [item] });
  }
  return groups;
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
