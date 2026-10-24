// Business Manager — the ONE definition of its tab keys, nav labels and
// legacy redirects. The shell (rail + bottom bar), the More menu and the
// page's own tab validation all read this, so a label or key can't drift
// between them. Pure data (no JSX); icons stay with the components that
// render them. Every destination is still an existing `?tab=` view of
// /account/business/[id].

export type BusinessSection = "home" | "presence" | "moments" | "performance" | "products" | "growth" | "more";

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
  { section: "moments", label: "Moments", tab: "moments" },
  // Findmi Here is the CENTER slot of the five-item mobile bar.
  { section: "presence", label: "Findmi Here", tab: "findmi-here" },
  { section: "performance", label: "Performance", tab: "performance" },
  // Products and Growth keep full destinations but not a bottom-bar slot:
  // phones reach them from Home / More; the desktop rail lists them.
  { section: "products", label: "Products", tab: "products", desktopOnly: true },
  { section: "growth", label: "Growth", tab: "growth", desktopOnly: true },
  { section: "more", label: "More", tab: "more" },
];

/** The tab a `?tab=` value actually renders: an unknown key falls back to
 * Overview, and `referral` (which only exists for a referral partner, who is
 * redirected to Settings) renders Overview for everyone else. The page and the
 * client navigation share this so the highlighted item always matches. */
export function canonicalTab(tab: string | null | undefined): string {
  if (!tab || tab === "referral" || !VALID_BUSINESS_TAB_KEYS.has(tab)) return "overview";
  return LEGACY_TAB_REDIRECTS[tab] ?? tab;
}

/** Which destination a tab belongs to for the purpose of "am I entering a new
 * view or moving within one?". Growth's Goals / Opportunities / Ideas are one
 * destination, and so are Performance and its QR Codes view; every other tab
 * is its own. Moving WITHIN a destination keeps the current view on screen
 * until the next is ready; entering a new one shows its skeleton at once. */
export function destinationGroup(tab: string | null | undefined): string {
  const t = canonicalTab(tab);
  return t === "opportunities" ? "growth" : t === "qr" ? "performance" : t;
}

/** Existing tab key -> V2 section. Anything not promoted to primary
 * navigation (Profile, QR, Settings, Inquiries, Orders, Referral) lives
 * under More, so its section highlights there. Pure, so the server shell and
 * the client navigation share one answer. */
export function sectionForTab(tab: string): BusinessSection {
  switch (tab) {
    case "overview":
      return "home";
    case "findmi-here":
      return "presence";
    case "moments":
      return "moments";
    case "products":
      return "products";
    case "growth":
    case "opportunities":
      return "growth";
    case "performance":
    case "qr":
      return "performance";
    default:
      return "more";
  }
}

const navLabel = (tab: string): string => BUSINESS_NAV.find((n) => n.tab === tab)?.label ?? tab;

/** Destinations listed in the More menu (everything not in the primary
 * navigation), with their existing labels. */
export const BUSINESS_MORE_TABS = {
  profile: { label: "Public Profile", description: "What people see: details, photos, Public Actions and Announcement" },
  performance: { label: navLabel("performance"), description: "Views, actions and how people find you" },
  products: { label: "Products", description: "Your catalog, and where each product is available" },
  growth: { label: "Growth", description: "Goals, Targets, Opportunities and Ideas" },
  qr: { label: "QR Codes", description: "Create, manage and track QR codes" },
  inquiries: { label: "Inquiry Settings", description: "How customer inquiries work: on or off, and topics" },
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
  "opportunities",
  "qr",
  "profile",
  "orders",
  "settings",
  "inquiries",
  "referral",
  ...Object.keys(LEGACY_TAB_REDIRECTS),
]);
