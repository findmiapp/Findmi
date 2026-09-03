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
    label: "Card 1 — Discovery Pro",
    eyebrow: "For businesses",
    title: "Discovery Pro",
    // Pro Upgrade — Internal Checkout Handoff Foundation pass: this
    // fallback only renders if the live site_sections DB override (the
    // real, currently-shown $20/90-day content) is ever missing — it must
    // match the current real offer, not the old $99/year one, so losing
    // that override can never silently put stale pricing back in front of
    // a real customer. Matches the live override's price/priceSuffix/
    // no-auto-renewal wording/CTA label exactly; DB content itself is
    // untouched by this pass.
    price: "$20",
    priceSuffix: "/intro price for first 90 days.",
    tagline:
      "Your FindMi presence for local discovery. $20 for your first 90 days — no automatic renewal during the introductory period.",
    features: [
      "Full FindMi Business Profile",
      "Products & offerings",
      "Unlimited upcoming Appearances / “FindMi Here”",
      "Local discovery visibility",
      "Event and market connections",
      "Business gallery",
      "Follow + Save",
      "Business bulletin / updates",
      "Smart schedule importing & setup support",
      "Profile updates and support",
    ],
    ctaLabel: "Join FindMi Pro - $20",
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

export function resolveJoinWhatYouGet(overrides: Map<string, SiteSection>) {
  const row = overrides.get("what_you_get");
  return {
    visible: row?.is_visible ?? true,
    eyebrow: row?.eyebrow ?? JOIN_WHAT_YOU_GET_DEFAULTS.eyebrow,
    heading: row?.heading ?? JOIN_WHAT_YOU_GET_DEFAULTS.heading,
    body: row?.body ?? (JOIN_WHAT_YOU_GET_DEFAULTS.body || null),
    ctaLabel: row?.cta_label ?? JOIN_WHAT_YOU_GET_DEFAULTS.ctaLabel,
    ctaUrl: row?.cta_url ?? JOIN_WHAT_YOU_GET_DEFAULTS.ctaUrl,
  };
}
