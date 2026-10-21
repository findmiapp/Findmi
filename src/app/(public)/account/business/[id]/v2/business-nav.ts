// Business Manager — the ONE definition of its tab keys, nav labels and
// legacy redirects. The shell (rail + bottom bar), the More menu and the
// page's own tab validation all read this, so a label or key can't drift
// between them. Pure data (no JSX); icons stay with the components that
// render them. Every destination is still an existing `?tab=` view of
// /account/business/[id].

export type BusinessSection = "home" | "presence" | "products" | "opportunities" | "performance" | "more";

export interface BusinessNavEntry {
  section: BusinessSection;
  label: string;
  tab: string;
  /** Shown in the desktop rail only; mobile keeps five bottom-bar slots. */
  desktopOnly?: boolean;
}

/** The persistent navigation: mobile bottom bar (minus desktopOnly) and
 * the desktop rail. */
export const BUSINESS_NAV: BusinessNavEntry[] = [
  { section: "home", label: "Home", tab: "overview" },
  { section: "presence", label: "Findmi Here", tab: "findmi-here" },
  { section: "products", label: "Products", tab: "products" },
  { section: "opportunities", label: "Opportunities", tab: "opportunities" },
  { section: "performance", label: "Performance", tab: "performance", desktopOnly: true },
  { section: "more", label: "More", tab: "more" },
];

const navLabel = (tab: string): string => BUSINESS_NAV.find((n) => n.tab === tab)?.label ?? tab;

/** Destinations listed in the More menu (everything not in the primary
 * navigation), with their existing labels. */
export const BUSINESS_MORE_TABS = {
  profile: { label: "Business Profile", description: "Identity, photos, contact & links" },
  performance: { label: navLabel("performance"), description: "Views, actions and how people find you" },
  qr: { label: "QR Campaigns", description: "Create and track QR codes" },
  inquiries: { label: "Inquiry Settings", description: "How customers can contact you" },
  orders: { label: "Orders", description: "Marketplace orders to fulfill" },
  settings: { label: "Plan & Settings", description: "Findmi Pro, areas and business settings" },
} as const;

/** Old tab key -> new canonical destination. A visit to any of these keys
 * redirects immediately (before the page's heavier data fetching) rather
 * than rendering a second, now-dead copy of content that moved. */
export const LEGACY_TAB_REDIRECTS: Record<string, string> = {
  gallery: "profile",
  links: "profile",
  plan: "settings",
  market: "settings",
  followers: "performance",
};

/** Every reachable tab key — primary navigation, More destinations, the
 * independent Customer Inquiries workflow, the referral-partner-only tab,
 * and every redirect-only legacy key (including "opportunities", which
 * redirects to the canonical Inbox filter) so the param is recognized
 * long enough to redirect instead of silently falling back to Overview. */
export const VALID_BUSINESS_TAB_KEYS: ReadonlySet<string> = new Set<string>([
  ...BUSINESS_NAV.map((n) => n.tab),
  "qr",
  "profile",
  "orders",
  "settings",
  "inquiries",
  "referral",
  ...Object.keys(LEGACY_TAB_REDIRECTS),
]);
