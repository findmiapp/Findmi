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

/** Final Action-Bar Polish pass — Analytics' own zero/one/many resolver,
 * deliberately NOT reusing resolveBusinessScopedHref above: that
 * function's zero case always routes to Add Business, which is correct
 * for a CREATE action but would be a fabricated "Analytics" destination
 * for an account with no business to show analytics for. Zero returns
 * null here — the caller (AnalyticsAction) is expected to simply not
 * render the action in that case, never fall back to a fake route.
 * One business routes straight to the canonical Analytics destination
 * Business Manager already uses everywhere else (`?tab=performance` —
 * see PRIMARY_TABS and the Overview tab's own "Analytics" Row in
 * account/business/[id]/page.tsx). That page's own existing pro/
 * UpgradeLockedTab gate is what decides whether real Analytics or the
 * locked Pro explanation renders there — nothing here re-implements or
 * duplicates that entitlement check. Many businesses also returns null,
 * same as resolveBusinessScopedHref's own many-case — the caller renders
 * a chooser instead. */
export function resolveAnalyticsHref(businesses: BusinessOption[]): string | null {
  if (businesses.length !== 1) return null;
  return `/account/business/${businesses[0].id}?tab=performance`;
}
