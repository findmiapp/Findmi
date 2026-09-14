/** Launch V2 Pass 1.1 — extracted out of BusinessScopedAction.tsx (a
 * "use client" module) so a plain SERVER Component can call it directly.
 * Next.js/React Server Components treat every export of a "use client"
 * file as a client reference when imported from server code — a Server
 * Component can render that file's default-exported component as JSX,
 * but calling one of its named exports as an ordinary function throws at
 * request time (this was the exact P0 crash on /account/business: it
 * called resolveBusinessScopedHref, imported from BusinessScopedAction.tsx,
 * directly in a Server Component). This module has no "use client"
 * directive, so it's safe to import from either side — BusinessScopedAction.tsx
 * re-exports these for its existing client callers (e.g. QuickCreateMenu),
 * and any Server Component (e.g. account/business/page.tsx) imports
 * straight from here instead. */
export interface BusinessOption {
  id: string;
  name: string;
}

/** Zero/one/many routing decision for every Business-scoped action on
 * /account (and the site-wide QuickCreateMenu): zero managed businesses
 * → Add Business; exactly one → straight into that Business Manager;
 * several → null, meaning the caller must render its own chooser (see
 * WhichBusinessPanel in BusinessScopedAction.tsx, or the compact list on
 * /account/business). */
export function resolveBusinessScopedHref(businesses: BusinessOption[], tab: string): string | null {
  if (businesses.length === 0) return "/account/business/new";
  if (businesses.length === 1) return `/account/business/${businesses[0].id}?tab=${tab}`;
  return null;
}
