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
    label: "Card 1 — Findmi Pro",
    eyebrow: "For businesses",
    title: "Findmi Pro",
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
    // Join Page Conversion Rebuild pass — this general description line is
    // no longer rendered on the Pro card at all (it duplicated the price,
    // which the rebuilt card already states once — see ProCard's own
    // comment). Left as admin-editable legacy content (still shown in
    // /admin/site/join's Pro tab) purely so nothing is deleted; harmless
    // either way since it has no public rendering path anymore.
    tagline:
      "Built for independent businesses, makers, vendors and brands that want to be discovered wherever they show up.\n\n$99 for one year of Findmi Pro.",
    // Join Page Conversion Rebuild pass — replaces the prior list: drops
    // "Connect with Findmi events" (Events are open to Free businesses
    // too — this must never read as Pro-exclusive) and "Bookings" (no
    // complete booking system exists to claim). See this pass's own
    // report for the exact requested wording.
    features: [
      "Complete business profile",
      "Full Findmi Here schedule",
      "Gallery, About & contact links",
      "Products & services",
      "Customer inquiries",
      "Business updates",
      "Expanded discovery across Findmi",
    ],
    ctaLabel: "Get Findmi Pro",
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
      "Findmi Event page",
      "Event discovery",
      "Participating businesses/vendors",
      "Vendor Appearance connections",
      "Event details and links",
      "Visibility within Findmi discovery",
    ],
    ctaLabel: "List an Event",
    emphasis: false,
  },
  // Join Page Conversion Rebuild pass — this card no longer renders through
  // the generic PlanCard/CardGrid mechanism (see join/page.tsx); it now has
  // its own bespoke "Regional / National" section per the locked structure.
  // Still resolved through the exact same resolveJoinCard()/admin form as
  // before — only the PUBLIC presentation changed, not how it's edited.
  card_multi_region: {
    label: "Card 3 — Multi-Region / National",
    eyebrow: "For regional & national brands",
    title: "Take Findmi across markets.",
    // No longer rendered publicly (the rebuilt section deliberately shows
    // no price/title tile — see join/page.tsx's RegionalSection) — left in
    // place as harmless legacy admin content, same as card_discovery_pro's
    // now-unrendered tagline above.
    price: "Custom",
    priceSuffix: null,
    tagline:
      "For brands operating across multiple cities, regions or locations, we’ll build a Findmi presence around your footprint.",
    features: [
      "Multiple Findmi areas",
      "Multi-location support",
      "Expanded discovery",
      "Dedicated onboarding",
      "Campaign and activation support",
    ],
    ctaLabel: "Talk to Findmi Sales",
    emphasis: false,
  },
};

export const JOIN_HERO_DEFAULTS = {
  heading: "Get discovered on Findmi.",
  body: "Where you’ll be, what you sell, and how customers can find you. All in one place.",
};

export const JOIN_GLOBAL_DEFAULTS = {
  message:
    "No payment today. Tell us about your business or event and we’ll contact you to complete your Findmi setup.",
  supportingText: "",
  ctaUrl: JOIN_FORM_URL_DEFAULT,
};

export const JOIN_WHAT_YOU_GET_DEFAULTS = {
  eyebrow: "What you get",
  heading: "One Findmi page. Everything a customer needs.",
  body: "",
  ctaLabel: "See a real Findmi profile: The Native Rose",
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
  { label: "Business Profile", detail: "Your story, photos, categories and contact information in one place." },
  { label: "Products & Services", detail: "A catalog customers can browse — and buy where enabled." },
  { label: "Findmi Here", detail: "Your upcoming appearances so customers always know where you'll be next." },
  {
    label: "Events",
    detail: "Connect your business to the markets, pop-ups and events where you're participating.",
  },
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

// Join Page Conversion Rebuild pass — `price`, `disclosureLabel` and
// `requiresProFeatures` are no longer rendered on the public page at all
// (the expandable "View what's included" / crossed-out "Requires Pro" list
// is removed per the locked structure — Free must read as positive and
// legitimate, not visually punished). Left in place as harmless legacy
// admin content, same convention as the now-unrendered Pro `tagline`
// above — nothing is deleted, only presentation changed.
export const JOIN_FREE_CARD_DEFAULTS = {
  title: "Want to start free?",
  price: "$0",
  shortTagline: "Get your business on Findmi.",
  description: "Create a basic Findmi presence today. No payment or credit card required.",
  disclosureLabel: "View What's Included",
  includedFeatures: [
    "Basic business profile",
    "Logo + cover image",
    "Your next upcoming appearance",
    "Participate on Findmi event pages",
    "Findmi search & discovery",
  ],
  requiresProFeatures: ["Full Upcoming Schedule", "Gallery", "Products & Services", "Website & Social Links", "Full Business Profile"],
  ctaLabel: "Start free",
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
  billingLabel: "Your complete Findmi presence.",
  // Join Page Conversion Rebuild pass — new field: the one-line description
  // shown right under the price ("Everything you need to get discovered
  // wherever you show up."). Added rather than repurposing an existing
  // field so `noRenewalNote` below keeps its own literal, unambiguous
  // meaning ("No automatic renewal.") in its existing spot further down.
  descriptionLine: "Everything you need to get discovered wherever you show up.",
  noRenewalNote: "No automatic renewal.",
  highlightHeading: "Findmi Here",
  highlightSubheading: "Show customers where you’ll be next.",
  highlightBody: "Your complete upcoming schedule lives right on your Findmi profile.",
  // Display copy only — see this pass's own report / the admin field's own
  // hint. The actual charged amount always comes from
  // BUSINESS_PRO_INTRO_PRICE_CENTS (businessProCheckout.ts), never from
  // this text, no matter what an admin types here. Join Page Conversion
  // Rebuild pass — no longer restates the price (already shown once,
  // directly above) per that pass's own anti-redundancy instruction.
  priceFootnote: "One year · No automatic renewal",
};

export interface ResolvedJoinProExtra {
  billingLabel: string;
  descriptionLine: string;
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
    descriptionLine: pick("descriptionLine"),
    noRenewalNote: pick("noRenewalNote"),
    highlightHeading: pick("highlightHeading"),
    highlightSubheading: pick("highlightSubheading"),
    highlightBody: pick("highlightBody"),
    priceFootnote: pick("priceFootnote"),
  };
}

// ── Invite/referral presentation ─────────────────────────────────────────

export const JOIN_INVITE_SECTION_DEFAULTS = {
  heading: "Have a Findmi Pro invite code?",
  helperText: "",
};

export interface ResolvedJoinInviteSection {
  visible: boolean;
  heading: string;
  helperText: string | null;
}

export function resolveJoinInviteSection(overrides: Map<string, SiteSection>): ResolvedJoinInviteSection {
  const row = overrides.get("invite_section");
  const d = JOIN_INVITE_SECTION_DEFAULTS;
  return {
    visible: row?.is_visible ?? true,
    heading: row?.heading ?? d.heading,
    helperText: row?.body ?? (d.helperText || null),
  };
}

// ── "Already listed on FindMi? Claim your business" line ────────────────

// Join Page Conversion Rebuild pass — this is no longer a standalone
// mid-page paragraph; `body`+`ctaLabel` are now composed inline as a
// secondary action in the Hero ("Already listed? Claim your business")
// and `ctaLabel` alone is reused again in the Final Conversion section
// ("Claim your business") — see join/page.tsx. Shortened/de-arrowed to
// read naturally in both spots; `ctaUrl` (the actual claim destination)
// is unchanged.
export const JOIN_CLAIM_BUSINESS_DEFAULTS = {
  body: "Already listed?",
  ctaLabel: "Claim your business",
  ctaUrl: "/businesses",
};

export interface ResolvedJoinClaimBusiness {
  visible: boolean;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
}

export function resolveJoinClaimBusiness(overrides: Map<string, SiteSection>): ResolvedJoinClaimBusiness {
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

export const JOIN_MORE_WAYS_DEFAULT = "More Ways To Join Findmi";

export function resolveJoinMoreWays(overrides: Map<string, SiteSection>) {
  const row = overrides.get("more_ways");
  return { heading: row?.heading ?? JOIN_MORE_WAYS_DEFAULT };
}
