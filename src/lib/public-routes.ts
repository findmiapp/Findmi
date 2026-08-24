// Canonical registry of real, public, statically-linkable FindMi routes —
// the single source both the Menu Builder's "Existing FindMi Page" picker
// and the nav resolver read from, so a route can never drift between what
// admin offers and what actually exists (Part A5 of the 2026 navigation
// pass: no duplicated route mappings across admin/mobile/desktop).
//
// Deliberately excludes: admin/private routes, dynamic-slug detail pages
// (/business/[slug], /event/[slug], /product/[slug], /location/[slug],
// /people/[slug] — these need a specific record, not a nav destination),
// and /checkout (a flow step, not a page someone navigates to directly).
// Inspected against the actual src/app/(public) route tree before writing
// this list — nothing here is invented.
export interface PublicRouteOption {
  /** Stable key stored on a nav item — never the path itself, so renaming
   * a route's path later doesn't silently break saved nav items. */
  key: string;
  path: string;
  label: string;
}

export const PUBLIC_ROUTES: PublicRouteOption[] = [
  { key: "home", path: "/", label: "Home" },
  { key: "discover", path: "/discover", label: "Discover" },
  { key: "events", path: "/events", label: "Events" },
  { key: "businesses", path: "/businesses", label: "Businesses" },
  { key: "marketplace", path: "/marketplace", label: "Marketplace" },
  { key: "find", path: "/find", label: "FindMi Here" },
  { key: "people", path: "/people", label: "People" },
  { key: "locations", path: "/locations", label: "Locations" },
  { key: "join", path: "/join", label: "Join FindMi" },
  { key: "saved", path: "/saved", label: "Saved" },
  { key: "you", path: "/you", label: "Account" },
  { key: "cart", path: "/cart", label: "Cart" },
  { key: "about", path: "/about", label: "About" },
  { key: "privacy", path: "/privacy", label: "Privacy" },
  { key: "terms", path: "/terms", label: "Terms" },
];

export function findPublicRoute(key: string): PublicRouteOption | null {
  return PUBLIC_ROUTES.find((r) => r.key === key) ?? null;
}
