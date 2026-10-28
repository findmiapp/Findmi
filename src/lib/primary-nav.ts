// Pass A — Navigation Shell. The CODE-OWNED parts of the public
// navigation, shared by the desktop account menu and the mobile drawer:
// personal destinations, the one compact Manage entry and the signed-out
// Business link. Discovery navigation itself comes from nav_items (Admin →
// Site → Navigation; see lib/navigation publicDiscoveryNav). Client-safe.
import type { NavIconKey } from "./navigation";

export interface PrimaryNavItem {
  href: string;
  label: string;
  icon?: NavIconKey;
  /** Path prefixes that count as "inside" this destination ("=" prefix:
   * exact path only). */
  match: string[];
}

/** YOUR FINDMI — personal destinations (signed in only). */
export const YOUR_FINDMI_NAV: PrimaryNavItem[] = [
  // ONE personal library: Things I Want, Want To Do / Go, Following,
  // Saved and Collections all live at /account/saved (signed-in /saved and
  // /my-world redirect there).
  { href: "/account/saved", label: "Your Library", icon: "bookmark", match: ["/account/saved", "/saved", "=/my-world"] },
  { href: "/my-world/journal", label: "My Moments", icon: "moments", match: ["/my-world/journal"] },
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
