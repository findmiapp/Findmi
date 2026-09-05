// Join page — founder-editable content layer. Reuses the existing
// site_sections table (see lib/site-sections.ts / lib/types.ts's
// SiteSection) with page_key "join" — no new schema. Each Join concept
// (hero, global settings, each of the three cards, the "What you get"
// section) is one section_key row. Free-form per-card data (price,
// billing suffix, feature bullets, emphasis) that doesn't fit the
// table's fixed eyebrow/heading/body/cta columns lives in config_json,
// the same JSONB column the homepage editor already uses for its image
// slots.
//
// Fallback convention (matches lib/site-sections.ts exactly): a missing
// row, or a blank field within an existing row, falls back to the
// hardcoded defaults below — the current live copy. /join never renders
// blank just because this table is empty or unreachable.
import { getSupabase } from "./supabase";
import type { SiteSection } from "./types";

const PAGE_KEY = "join";

/** The single fallback CTA URL every card uses when it has no override
 * of its own. Defined once here — nowhere else in the app should
 * hardcode the Tally URL. */
export const JOIN_FORM_URL_DEFAULT = "https://tally.so/r/0QR7LN";

export const JOIN_CARD_KEYS = ["card_discovery_pro", "card_events_markets", "card_multi_region"] as const;
export type JoinCardKey = (typeof JOIN_CARD_KEYS)[number];

export interface JoinCardDefaults {
  label: string; // admin-facing card title, orientation only
  eyebrow: string;
  title: string;
  price: string;
  priceSuffix: string | null;
  tagline: string;
  features: string[];
  ctaLabel: string;
  emphasis: boolean;
}

export const JOIN_CARD_DEFAULTS: Record<JoinCardKey, JoinCardDefaults> = {
  card_discovery_pro: {
    label: "Card 1 — FindMi Pro",
    eyebrow: "For businesses",
    title: "FindMi Pro",
    // Admin Join Page Editor pass — synced to match the current live
    // site_sections override exactly (was stale from an earlier $20/90-day
    // offer that no longer renders anywhere in code). This fallback only
    // renders if the live DB row is ever missing, so it must reflect
    // today's real $99/year offer, never a retired one. ctaLabel now
    // matches PRO_CTA_LABEL in join/page.tsx — see this pass's report:
    // the CTA label is admin-editable again (the CTA URL itself stays
    // server-controlled, see that file's PRO_NATIVE_CTA_URL).
    price: "$99",
    priceSuffix: "/year",
    tagline:
      "Built for independent businesses, makers, vendors and brands that want to be discovered wherever they show up.\n\n$99 for one year of FindMi Pro.",
    features: [
      "Full business profile",
      "Photos, About & links",
      "Manage Products / Bookings / Inquiries",
      "Add & manage appearances",
      "Connect with FindMi events",
      "Business updates",
      "Enhanced discovery",
    ],
    ctaLabel: "Get FindMi Pro",
    emphasis: true,
  },
  card_events_markets: {
    label: "Card 2 — Events & Markets",
    eyebrow: "For events",
    title: "Events & Markets",
    price: "Partner Listing",
    priceSuffix: null,
    tagline:
      "Hosting something people should discover? List your event, connect participating businesses, and help people discover what's happening and who's going to be there.",
    features: [
      "FindMi Event page",
      "Event discovery",
      "Participating businesses/vendors",
      "Vendor Appearance connections",
      "Event details and links",
      "Visibility within FindMi discovery",
    ],
    ctaLabel: "List an Event",
    emphasis: false,
  },
  card_multi_region: {
    label: "Card 3 — Multi-Region / National",
    eyebrow: "For larger brands",
    title: "Multi-Region / National",
    price: "Custom",
    priceSuffix: null,
    tagline:
      "For larger brands, touring businesses, organizations, and multi-location concepts that need broader coverage.",
    features: [
      "Multiple regions/markets",
      "Multi-location support",
      "Touring / traveling brand support",
      "Expanded FindMi presence",
      "Event/campaign opportunities",
      "Custom onboarding and support",
    ],
    ctaLabel: "Talk to FindMi",
    emphasis: false,
  },
};

export const JOIN_HERO_DEFAULTS = {
  heading: "Get discovered on FindMi.",
  body: "Choose how you’d like to join, tell us a bit about you, and we’ll follow up to get you set up.",
};

export const JOIN_GLOBAL_DEFAULTS = {
  message:
    "No payment today. Tell us about your business or event and we’ll contact you to complete your FindMi setup.",
  supportingText: "",
  ctaUrl: JOIN_FORM_URL_DEFAULT,
};

export const JOIN_WHAT_YOU_GET_DEFAULTS = {
  eyebrow: "What you get",
  heading: "One FindMi page. Everything a customer needs.",
  body: "",
  ctaLabel: "See a real FindMi profile: The Native Rose",
  ctaUrl: "/business/the-native-rose",
};

/** One query for every Join section — never one request per section. */
export async function getJoinPageSections(): Promise<Map<string, SiteSection>> {
  const map = new Map<string, SiteSection>();
  const supabase = getSupabase();
  if (!supabase) return map;
  const { data } = await supabase.from("site_sections").select("*").eq("page_key", PAGE_KEY);
  for (const row of (data ?? []) as SiteSection[]) map.set(row.section_key, row);
  return map;
}

export function resolveJoinHero(overrides: Map<string, SiteSection>) {
  const row = overrides.get("hero");
  return {
    heading: row?.heading ?? JOIN_HERO_DEFAULTS.heading,
    body: row?.body ?? JOIN_HERO_DEFAULTS.body,
  };
}

export interface ResolvedJoinGlobal {
  message: string;
  supportingText: string | null;
  ctaUrl: string;
}

export function resolveJoinGlobal(overrides: Map<string, SiteSection>): ResolvedJoinGlobal {
  const row = overrides.get("global");
  const cfg = (row?.config_json ?? {}) as Record<string, unknown>;
  const supportingText = typeof cfg.supportingText === "string" && cfg.supportingText.trim() ? cfg.supportingText : null;
  return {
    message: row?.body ?? JOIN_GLOBAL_DEFAULTS.message,
    supportingText,
    ctaUrl: row?.cta_url ?? JOIN_GLOBAL_DEFAULTS.ctaUrl,
  };
}

export interface ResolvedJoinCard {
  key: JoinCardKey;
  visible: boolean;
  eyebrow: string;
  title: string;
  price: string;
  priceSuffix: string | null;
  tagline: string;
  features: string[];
  ctaLabel: string;
  ctaUrl: string; // already resolved: this card's override, else the global URL
  emphasis: boolean;
}

export function resolveJoinCard(
  overrides: Map<string, SiteSection>,
  key: JoinCardKey,
  globalCtaUrl: string
): ResolvedJoinCard {
  const defaults = JOIN_CARD_DEFAULTS[key];
  const row = overrides.get(key);
  const cfg = (row?.config_json ?? {}) as Record<string, unknown>;

  const features = Array.isArray(cfg.features)
    ? (cfg.features.filter((f): f is string => typeof f === "string" && f.trim().length > 0))
    : defaults.features;

  return {
    key,
    visible: row?.is_visible ?? true,
    eyebrow: row?.eyebrow ?? defaults.eyebrow,
    title: row?.heading ?? defaults.title,
    price: typeof cfg.price === "string" && cfg.price ? cfg.price : defaults.price,
    priceSuffix: typeof cfg.priceSuffix === "string" && cfg.priceSuffix ? cfg.priceSuffix : defaults.priceSuffix,
    tagline: row?.body ?? defaults.tagline,
    features: features.length > 0 ? features : defaults.features,
    ctaLabel: row?.cta_label ?? defaults.ctaLabel,
    ctaUrl: row?.cta_url ?? globalCtaUrl,
    emphasis: typeof cfg.emphasis === "boolean" ? cfg.emphasis : defaults.emphasis,
  };
}

export interface JoinTile {
  label: string;
  detail: string;
}

// The four "Show the product" preview tiles — previously hardcoded JSX in
// join/page.tsx, now founder-editable (config_json.tiles on the existing
// what_you_get row) while keeping the exact current copy as the fallback.
export const JOIN_WHAT_YOU_GET_TILE_DEFAULTS: JoinTile[] = [
  { label: "Business Profile", detail: "Your story, photos, categories, and contact info in one place." },
  { label: "Products & Services", detail: "A real catalog customers can browse — and buy, where you enable it." },
  { label: "FindMi Here", detail: "Appearance cards so customers always know where you'll be next." },
  { label: "Events", detail: "Join markets and pop-ups as a participating, featured vendor." },
];

function resolveTiles(cfg: Record<string, unknown>): JoinTile[] {
  if (!Array.isArray(cfg.tiles)) return JOIN_WHAT_YOU_GET_TILE_DEFAULTS;
  const tiles = cfg.tiles
    .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
    .map((t) => ({
      label: typeof t.label === "string" ? t.label : "",
      detail: typeof t.detail === "string" ? t.detail : "",
    }))
    .filter((t) => t.label || t.detail);
  return tiles.length > 0 ? tiles : JOIN_WHAT_YOU_GET_TILE_DEFAULTS;
}

export function resolveJoinWhatYouGet(overrides: Map<string, SiteSection>) {
  const row = overrides.get("what_you_get");
  const cfg = (row?.config_json ?? {}) as Record<string, unknown>;
  return {
    visible: row?.is_visible ?? true,
    eyebrow: row?.eyebrow ?? JOIN_WHAT_YOU_GET_DEFAULTS.eyebrow,
    heading: row?.heading ?? JOIN_WHAT_YOU_GET_DEFAULTS.heading,
    body: row?.body ?? (JOIN_WHAT_YOU_GET_DEFAULTS.body || null),
    ctaLabel: row?.cta_label ?? JOIN_WHAT_YOU_GET_DEFAULTS.ctaLabel,
    ctaUrl: row?.cta_url ?? JOIN_WHAT_YOU_GET_DEFAULTS.ctaUrl,
    tiles: resolveTiles(cfg),
  };
}

// ── Free plan card (previously static JSX, never founder-editable) ──────

export const JOIN_FREE_CARD_DEFAULTS = {
  title: "Free",
  price: "$0",
  shortTagline: "Get Your Business On FindMi.",
  description: "Create Your Basic Profile And Appear On Event Pages When Participating Organizers Add Your Business.",
  disclosureLabel: "View What's Included",
  includedFeatures: [
    "Logo + Cover Image & Basic Profile",
    "Show Your Next Upcoming Appearance",
    "Appear On Participating Event/Vendor Rosters",
    "FindMi Search & Discovery",
  ],
  requiresProFeatures: ["Full Upcoming Schedule", "Gallery", "Products & Services", "Website & Social Links", "Full Business Profile"],
  ctaLabel: "Start with Basic",
};

export interface ResolvedJoinFreeCard {
  visible: boolean;
  title: string;
  price: string;
  shortTagline: string;
  description: string;
  disclosureLabel: string;
  includedFeatures: string[];
  requiresProFeatures: string[];
  ctaLabel: string;
}

function stringList(cfg: Record<string, unknown>, key: string, fallback: string[]): string[] {
  if (!Array.isArray(cfg[key])) return fallback;
  const list = (cfg[key] as unknown[]).filter((f): f is string => typeof f === "string" && f.trim().length > 0);
  return list.length > 0 ? list : fallback;
}

export function resolveJoinFreeCard(overrides: Map<string, SiteSection>): ResolvedJoinFreeCard {
  const row = overrides.get("card_free");
  const cfg = (row?.config_json ?? {}) as Record<string, unknown>;
  const d = JOIN_FREE_CARD_DEFAULTS;
  return {
    visible: row?.is_visible ?? true,
    title: row?.heading ?? d.title,
    price: typeof cfg.price === "string" && cfg.price ? cfg.price : d.price,
    shortTagline: typeof cfg.shortTagline === "string" && cfg.shortTagline ? cfg.shortTagline : d.shortTagline,
    description: row?.body ?? d.description,
    disclosureLabel: typeof cfg.disclosureLabel === "string" && cfg.disclosureLabel ? cfg.disclosureLabel : d.disclosureLabel,
    includedFeatures: stringList(cfg, "includedFeatures", d.includedFeatures),
    requiresProFeatures: stringList(cfg, "requiresProFeatures", d.requiresProFeatures),
    ctaLabel: row?.cta_label ?? d.ctaLabel,
  };
}

// ── Pro card — additional presentation beyond the shared card fields ────
// Lives in config_json on the SAME card_discovery_pro row as the main
// eyebrow/title/price/tagline/features/cta fields (saveJoinCard) — kept as
// its own admin form/action (saveJoinProExtra) for a focused save, but both
// actions merge into the existing config_json rather than replacing it, so
// saving one never wipes the other's fields (see actions.ts).

export const JOIN_PRO_EXTRA_DEFAULTS = {
  billingLabel: "Build Out Your Complete FindMi Presence.",
  noRenewalNote: "No Automatic Renewal.",
  highlightHeading: "FindMi Here",
  highlightSubheading: "Show Customers Where To Find You Next.",
  highlightBody: "Your Full Upcoming Schedule Shows On Your Public Profile — Not Just Your Next Appearance.",
  // Display copy only — see this pass's own report / the admin field's own
  // hint. The actual charged amount always comes from
  // BUSINESS_PRO_INTRO_PRICE_CENTS (businessProCheckout.ts), never from
  // this text, no matter what an admin types here.
  priceFootnote: "$99 For One Year Of FindMi Pro.",
};

export interface ResolvedJoinProExtra {
  billingLabel: string;
  noRenewalNote: string;
  highlightHeading: string;
  highlightSubheading: string;
  highlightBody: string;
  priceFootnote: string;
}

export function resolveJoinProExtra(overrides: Map<string, SiteSection>): ResolvedJoinProExtra {
  const row = overrides.get("card_discovery_pro");
  const cfg = (row?.config_json ?? {}) as Record<string, unknown>;
  const d = JOIN_PRO_EXTRA_DEFAULTS;
  const pick = (key: keyof typeof d) => (typeof cfg[key] === "string" && (cfg[key] as string).trim() ? (cfg[key] as string) : d[key]);
  return {
    billingLabel: pick("billingLabel"),
    noRenewalNote: pick("noRenewalNote"),
    highlightHeading: pick("highlightHeading"),
    highlightSubheading: pick("highlightSubheading"),
    highlightBody: pick("highlightBody"),
    priceFootnote: pick("priceFootnote"),
  };
}

// ── Invite/referral presentation ─────────────────────────────────────────

export const JOIN_INVITE_SECTION_DEFAULTS = {
  heading: "Have a Pro Invite Code?",
  helperText: "",
};

export function resolveJoinInviteSection(overrides: Map<string, SiteSection>) {
  const row = overrides.get("invite_section");
  const d = JOIN_INVITE_SECTION_DEFAULTS;
  return {
    visible: row?.is_visible ?? true,
    heading: row?.heading ?? d.heading,
    helperText: row?.body ?? (d.helperText || null),
  };
}

// ── "Already listed on FindMi? Claim your business" line ────────────────

export const JOIN_CLAIM_BUSINESS_DEFAULTS = {
  body: "Already listed on FindMi?",
  ctaLabel: "Claim your business →",
  ctaUrl: "/businesses",
};

export function resolveJoinClaimBusiness(overrides: Map<string, SiteSection>) {
  const row = overrides.get("claim_business");
  const d = JOIN_CLAIM_BUSINESS_DEFAULTS;
  return {
    visible: row?.is_visible ?? true,
    body: row?.body ?? d.body,
    ctaLabel: row?.cta_label ?? d.ctaLabel,
    ctaUrl: row?.cta_url ?? d.ctaUrl,
  };
}

// ── Top-of-page reassurance line ("New listings are reviewed…") ─────────

export const JOIN_REASSURANCE_DEFAULT = "New Listings Are Reviewed Before Appearing Publicly.";

export function resolveJoinReassurance(overrides: Map<string, SiteSection>) {
  const row = overrides.get("reassurance_top");
  return {
    visible: row?.is_visible ?? true,
    text: row?.body ?? JOIN_REASSURANCE_DEFAULT,
  };
}

// ── "More Ways To Join FindMi" heading above the secondary cards ────────

export const JOIN_MORE_WAYS_DEFAULT = "More Ways To Join FindMi";

export function resolveJoinMoreWays(overrides: Map<string, SiteSection>) {
  const row = overrides.get("more_ways");
  return { heading: row?.heading ?? JOIN_MORE_WAYS_DEFAULT };
}
