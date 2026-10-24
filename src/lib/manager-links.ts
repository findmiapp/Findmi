// Business Manager — the ONE place that knows where things live. Every
// cross-link inside the Manager (Home, More, Search, Inbox, deep screens)
// builds its href here so a label always lands on its exact destination,
// always carries the active Business, and a "Back" can only ever point at a
// known Manager destination (never an arbitrary URL). Pure (client + server).

export const managerBase = (businessId: string) => `/account/business/${businessId}`;

export type ManagerDestination =
  | "home"
  | "profile"
  | "public-actions"
  | "announcement"
  | "gallery"
  | "inquiry-settings"
  | "products"
  | "add-product"
  | "findmi-here"
  | "add-event"
  | "our-locations"
  | "schedule"
  | "find-us"
  | "where-ill-be"
  | "add-location"
  | "moments"
  | "performance"
  | "qr"
  | "new-qr"
  | "growth"
  | "goals"
  | "targets"
  | "add-target"
  | "discover"
  | "opportunities"
  | "ideas"
  | "orders"
  | "settings"
  | "inbox"
  | "search"
  | "more";

/** The exact href for a Manager destination of one Business. */
export function managerHref(businessId: string, d: ManagerDestination): string {
  const b = managerBase(businessId);
  switch (d) {
    case "home":
      return b;
    case "profile":
      return `${b}?tab=profile`;
    case "public-actions":
      return `${b}?tab=profile#public-actions`;
    case "announcement":
      return `${b}?tab=profile#announcement`;
    case "gallery":
      return `${b}?tab=profile#gallery`;
    case "inquiry-settings":
      return `${b}?tab=inquiries`;
    case "products":
      return `${b}?tab=products`;
    case "add-product":
      return `${b}?tab=products&compose=1`;
    case "findmi-here":
      return `${b}?tab=findmi-here`;
    case "add-event":
      // Findmi Here → Events with "What Are You Adding?" open (Hosting /
      // Appearing At) — the one Event entry point.
      return `${b}?tab=findmi-here&add=event`;
    case "our-locations":
      return `${b}?tab=findmi-here&view=locations`;
    case "schedule":
      return `${b}?tab=findmi-here&view=upcoming`;
    case "find-us":
      return `${b}?tab=findmi-here&view=find-us`;
    case "where-ill-be":
      return `${b}?tab=findmi-here&compose=1`;
    case "add-location":
      return `${b}?tab=findmi-here&view=locations&add=1`;
    case "moments":
      return `${b}?tab=moments`;
    case "performance":
      return `${b}?tab=performance`;
    case "qr":
      return `${b}?tab=qr`;
    case "new-qr":
      return `${b}/qr/new`;
    case "growth":
      return `${b}?tab=growth`;
    case "goals":
      return `${b}/brand-audit?step=goals`;
    case "targets":
      return `${b}?tab=growth&view=targets`;
    case "add-target":
      return `${b}?tab=growth&view=targets&add=1`;
    case "discover":
      return `${b}?tab=growth&view=discover`;
    case "opportunities":
      return `${b}?tab=opportunities`;
    case "ideas":
      return `${b}?tab=growth&view=ideas`;
    case "orders":
      return `${b}?tab=orders`;
    case "settings":
      return `${b}?tab=settings`;
    case "inbox":
      return `${b}/inbox`;
    case "search":
      return `${b}/search`;
    case "more":
      return `${b}?tab=more`;
  }
}

/** One Conversation, opened inside this Business's Manager. */
export const managerThreadHref = (businessId: string, conversationId: string) => `${managerBase(businessId)}/inbox/${conversationId}`;

/** A product's row in the catalog, opened for editing. */
export const managerProductHref = (businessId: string, productId: string) => `${managerBase(businessId)}?tab=products&editing=${productId}#product-${productId}`;

/** An Appearance (Where I'll Be) row, opened for editing. */
export const managerAppearanceHref = (businessId: string, appearanceId: string) => `${managerBase(businessId)}?tab=findmi-here&editing=${appearanceId}`;

// ── Origin-aware Back ──────────────────────────────────────────────────────

/** Where a deep screen may have been opened from. Only these are honored, and
 * each resolves to a fixed Manager destination of the SAME Business — so a
 * `from` value can never redirect anywhere else (no open redirect). */
export const MANAGER_ORIGINS = ["targets", "discover", "inbox", "findmi-here", "markets", "home", "opportunities", "search"] as const;
export type ManagerOrigin = (typeof MANAGER_ORIGINS)[number];

export const isManagerOrigin = (v: unknown): v is ManagerOrigin => typeof v === "string" && (MANAGER_ORIGINS as readonly string[]).includes(v);

const ORIGIN_BACK: Record<ManagerOrigin, { d: ManagerDestination | null; label: string }> = {
  targets: { d: "targets", label: "Targets" },
  discover: { d: "discover", label: "Discover" },
  inbox: { d: "inbox", label: "Inbox" },
  "findmi-here": { d: null, label: "Findmi Here" },
  markets: { d: null, label: "By Market" },
  home: { d: "home", label: "Home" },
  opportunities: { d: "opportunities", label: "Opportunities" },
  search: { d: "search", label: "Search" },
};

/** The Back link for a screen opened from `from` (null when it isn't a known
 * origin — the screen then uses its own default). */
export function originBack(businessId: string, from: unknown): { href: string; label: string } | null {
  if (!isManagerOrigin(from)) return null;
  const o = ORIGIN_BACK[from];
  const b = managerBase(businessId);
  // Targets live in Growth (their canonical owner) — Findmi Here's Find Us
  // Here is current presence only, so its Back lands on that list.
  const href = o.d ? managerHref(businessId, o.d) : `${b}?tab=findmi-here&view=find-us${from === "markets" ? "&fv=markets" : ""}`;
  return { href, label: o.label };
}

/** Tag a Manager href with where it was opened from (keeps any #anchor). */
export function withOrigin(href: string, from: ManagerOrigin): string {
  const [path, hash] = href.split("#");
  return `${path}${path.includes("?") ? "&" : "?"}from=${from}${hash ? `#${hash}` : ""}`;
}

// ── Switching Business ─────────────────────────────────────────────────────

/** Manager sub-routes that make sense for ANY Business (no record id). */
const PORTABLE_SUBPATHS = new Set(["inbox", "search", "qr/new", "brand-audit"]);
/** Query keys that describe a destination (not a record of one Business). */
const PORTABLE_PARAMS = ["tab", "view", "fv", "range", "step"];

/** Switching Business keeps the logical destination when it can apply to the
 * other Business (Home, a tab, a Growth view, Inbox, Search…) and drops every
 * record-specific part (a Target, a thread, an Inquiry, an edit form). Anything
 * else lands on that Business's Home. */
export function switchBusinessHref(pathname: string, search: string, fromBusinessId: string, toBusinessId: string): string {
  const fromBase = managerBase(fromBusinessId);
  const toBase = managerBase(toBusinessId);
  if (!(pathname === fromBase || pathname.startsWith(`${fromBase}/`))) return toBase;
  const sub = pathname.slice(fromBase.length).replace(/^\/+/, "");
  if (sub && !PORTABLE_SUBPATHS.has(sub)) return toBase;
  const params = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const k of PORTABLE_PARAMS) {
    const v = params.get(k);
    if (v && /^[a-z0-9_-]{1,40}$/i.test(v)) kept.set(k, v);
  }
  const q = kept.toString();
  return `${toBase}${sub ? `/${sub}` : ""}${q ? `?${q}` : ""}`;
}
