// Pass A — Navigation Shell. The ONE consumer navigation model the
// desktop header and the mobile menu both render, so the two can never
// drift. Discovery is a fixed product structure (it mirrors what Findmi
// IS — Events, Places, Brands, Moments — never the database). Client-safe.
import type { NavIconKey } from "./navigation";

export interface PrimaryNavItem {
  href: string;
  label: string;
  icon?: NavIconKey;
  /** Path prefixes that count as "inside" this destination ("=" prefix:
   * exact path only). */
  match: string[];
}

/** DISCOVER — consumer discovery, always first. "Places" is the public
 * name for /locations; "Brands" for /businesses. */
export const DISCOVER_NAV: PrimaryNavItem[] = [
  { href: "/discover", label: "Discover", icon: "compass", match: ["/discover", "/find"] },
  { href: "/events", label: "Events", icon: "calendar", match: ["/events", "/event/"] },
  { href: "/locations", label: "Places", icon: "pin", match: ["/locations", "/location/"] },
  { href: "/businesses", label: "Brands", icon: "storefront", match: ["/businesses", "/business/"] },
  { href: "/moments", label: "Moments", icon: "target", match: ["/moments", "/journal"] },
];

/** YOUR FINDMI — personal destinations (signed in only). */
export const YOUR_FINDMI_NAV: PrimaryNavItem[] = [
  { href: "/my-world", label: "My World", icon: "home", match: ["=/my-world"] },
  { href: "/saved", label: "Saved", icon: "bookmark", match: ["/saved"] },
  { href: "/my-world/journal", label: "My Moments", icon: "target", match: ["/my-world/journal"] },
  { href: "/my-world/journal/new", label: "Add Moment", match: [] },
  { href: "/account/messages", label: "Messages", match: ["/account/messages"] },
  { href: "/account", label: "Account", icon: "person", match: [] },
];

/** The one Business call-to-action for signed-out visitors. */
export const FOR_BUSINESS_NAV: PrimaryNavItem = { href: "/join/business", label: "Findmi For Business", icon: "storefront", match: ["/join/business"] };

export function isPrimaryNavActive(pathname: string, item: PrimaryNavItem): boolean {
  return item.match.some((m) =>
    m.startsWith("=") ? pathname === m.slice(1) : m.endsWith("/") ? pathname.startsWith(m) : pathname === m || pathname.startsWith(`${m}/`)
  );
}

/** MANAGE — one compact entry, never a list of Businesses: one managed
 * Business → its manager; several → the existing Businesses chooser. */
export function manageNavEntry(businesses: { id: string; name: string }[]): PrimaryNavItem | null {
  if (businesses.length === 0) return null;
  if (businesses.length === 1) {
    const b = businesses[0];
    return { href: `/account/business/${b.id}`, label: b.name, icon: "storefront", match: [`/account/business/${b.id}`] };
  }
  return { href: "/account/business", label: `Manage Businesses (${businesses.length})`, icon: "storefront", match: ["/account/business"] };
}
