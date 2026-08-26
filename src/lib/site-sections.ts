// Founder Site Editor — data layer. See migration create_site_sections and
// lib/types.ts's SiteSection. This file owns: (1) the one-query fetch used
// by public pages, (2) the per-field fallback merge, and (3) the homepage's
// section defaults/registry — shared by the public homepage (as fallback
// copy) and the admin editor (as placeholder text + field visibility), so
// the two never drift out of sync.
import { getSupabase } from "./supabase";
import type { SiteSection } from "./types";

export interface ResolvedSection {
  eyebrow: string | null;
  heading: string | null;
  body: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  visible: boolean;
  order: number;
  /** Founder-configured image URLs (stored in site_sections.config_json,
   * the column that's existed since this table's original migration —
   * not a new one) for sections with imageSlots set (see SectionDefaults).
   * Falls back to defaults.images when nothing's configured yet, then to
   * an empty array — never fabricated, see each caller's own fallback. */
  images: string[];
}

export interface SectionDefaults {
  label: string; // admin-facing card title — never edited, just orientation
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  images?: string[];
  order: number;
  fields: ("eyebrow" | "heading" | "body" | "cta")[];
  /** Renders this many admin ImageField slots (image_1..N) for the
   * section, saved into config_json.images — see actions.ts's
   * saveSiteSection. Omit/0 for sections with no editable imagery. */
  imageSlots?: number;
  /** Excluded from the Move Up/Down reordering system — pinned first,
   * same spirit as header/footer staying outside it (see hero/doorway). */
  orderable?: boolean;
}

/** One query for every section on a page — never one request per section
 * (Part 8: performance). Fails soft to an empty map when Supabase isn't
 * configured/reachable, so resolveSection() below falls back entirely to
 * hardcoded defaults — the homepage never renders blank because this
 * table is empty or unreachable. */
export async function getSiteSections(pageKey: string): Promise<Map<string, SiteSection>> {
  const map = new Map<string, SiteSection>();
  const supabase = getSupabase();
  if (!supabase) return map;
  const { data } = await supabase.from("site_sections").select("*").eq("page_key", pageKey);
  for (const row of (data ?? []) as SiteSection[]) map.set(row.section_key, row);
  return map;
}

/** Merges one section's DB override (if any) onto its hardcoded defaults —
 * per FIELD, not all-or-nothing: changing only a heading in admin leaves
 * every other field on its default. A missing row falls back the same way
 * a null field does. */
export function resolveSection(
  overrides: Map<string, SiteSection>,
  sectionKey: string,
  defaults: SectionDefaults
): ResolvedSection {
  const row = overrides.get(sectionKey);
  const configuredImages = row?.config_json?.images;
  return {
    eyebrow: row?.eyebrow ?? defaults.eyebrow ?? null,
    heading: row?.heading ?? defaults.heading ?? null,
    body: row?.body ?? defaults.body ?? null,
    ctaLabel: row?.cta_label ?? defaults.ctaLabel ?? null,
    ctaUrl: row?.cta_url ?? defaults.ctaUrl ?? null,
    visible: row?.is_visible ?? true,
    order: row?.sort_order ?? defaults.order,
    images: Array.isArray(configuredImages)
      ? (configuredImages.filter((s): s is string => typeof s === "string" && s.length > 0) as string[])
      : defaults.images ?? [],
  };
}

// ---------------------------------------------------------------------
// Homepage registry — the single source of truth for section keys,
// default copy, which fields each section exposes, and default order.
// Adding a page later means adding a sibling registry, not touching this.
// ---------------------------------------------------------------------

export const HOMEPAGE_SECTIONS: Record<string, SectionDefaults> = {
  hero: {
    // Discovery/Archive V2 Part 18: the heading became founder-editable
    // too, on the same generic heading-field machinery every other
    // section already uses — HomeHero now actually consumes
    // `heroSec.heading` (it didn't before; this default sat unused).
    // Newlines control the three visual lines, and the LAST line keeps
    // the established teal-accent/no-wrap treatment regardless of how
    // many lines are entered (see HomeHero's own note). This default is
    // the exact current copy, so an unconfigured hero renders byte-
    // identical to before. The collage imagery is separately founder-
    // editable here too. HomeHero falls back to real, non-fabricated
    // business/appearance photos already being fetched for other
    // sections when no image slot is configured — see the homepage's own
    // hero-image fallback logic. The description line under the headline
    // (`body`) was made founder-editable in the UI cleanup pass — same
    // generic body-field machinery every other section already used.
    label: "Hero",
    heading: "Find what's\naround you.\nGet discovered.",
    body: "Discover local businesses, events, pop-ups, products, and more — all in one place.",
    order: 0,
    fields: ["heading", "body"],
    imageSlots: 3,
    orderable: false,
  },
  // business_doorway: SUPERSEDED (2026 feed-builder pass) — the Business
  // Showcase is now a founder-managed Homepage Row
  // (content_type: "business_showcase"), hideable/reorderable there
  // instead of pinned at a fixed site_sections position. Registry entry
  // kept (harmless, unread) rather than deleted.
  business_doorway: {
    // Repurposed (2026 discovery-marketplace redesign) as the homepage's
    // Business Showcase — a compact swipeable carousel demonstrating real
    // FindMi UI patterns (profile/events/products/discovery), not the
    // one-line masthead link this used to be. Key/admin card kept as-is
    // so this stays founder-editable; the 4 slide captions themselves are
    // fixed copy in BusinessShowcaseCarousel.tsx, not a new per-slide CMS.
    label: "Business Showcase",
    heading: "Have a business or brand?",
    body: "Get discovered on FindMi.",
    ctaLabel: "Join FindMi →",
    ctaUrl: "/join",
    order: 45,
    fields: ["heading", "body", "cta"],
    // No longer pinned "always first" — it renders further down the page
    // now (after Featured Brands), same reasoning as the note on
    // HOMEPAGE_ORDERABLE_KEYS below: making it orderable=true here at
    // least keeps admin's grouping honest, even though Move Up/Down still
    // can't change its actual position (see that note).
  },
  brand_spotlight: {
    label: "Brand Spotlight",
    eyebrow: "Brand Spotlight",
    order: 10,
    fields: ["eyebrow"],
  },
  featured_events: {
    // Homepage's first live feed. Heading is exactly "Upcoming Events Near
    // You" per the 2026 feed-builder pass — the primary time filter
    // (Up Next/Today/This Weekend/All Events) and secondary category chips
    // live in HomeEventDiscovery, not here.
    label: "Featured Events",
    heading: "Upcoming Events Near You",
    body: "Markets, pop-ups, and festivals coming up",
    ctaLabel: "View all",
    ctaUrl: "/events",
    order: 20,
    fields: ["heading", "body", "cta"],
  },
  // shop_findmi: SUPERSEDED (2026 feed-builder pass) — Shop Local is now a
  // founder-managed Homepage Row (content_type: "products"), not a fixed
  // site_sections entry. Kept in the registry (harmless, unread by
  // page.tsx/the admin editor) rather than deleted, since deleting a
  // registry key isn't a data operation this pass needs to make.
  shop_findmi: {
    label: "Shop FindMi",
    heading: "Shop Local",
    body: "Real products from FindMi businesses",
    ctaLabel: "View all",
    ctaUrl: "/marketplace",
    order: 30,
    fields: ["heading", "body", "cta"],
  },
  findmi_here: {
    // Repurposed as "Around You Right Now", the homepage's second live
    // feed — same underlying appearances/FindMi Here concept, new
    // copy/position (was previously further down the page).
    label: "FindMi Here",
    heading: "Around You Right Now",
    body: "Vendors, pop-ups, and businesses showing up nearby",
    ctaLabel: "View all",
    ctaUrl: "/find",
    order: 40,
    fields: ["heading", "body", "cta"],
  },
  // featured_brands: SUPERSEDED (2026 feed-builder pass) — Featured Brands
  // is now a founder-managed Homepage Row (content_type: "businesses"),
  // not a fixed site_sections entry. Registry entry kept (harmless,
  // unread) rather than deleted.
  featured_brands: {
    label: "Featured Brands",
    heading: "Featured Brands",
    body: "Discover businesses on FindMi",
    ctaLabel: "View all",
    ctaUrl: "/businesses",
    order: 50,
    fields: ["heading", "body", "cta"],
  },
  category_feeds: {
    label: "Curated Category Feeds",
    order: 60,
    fields: [],
  },
  explore_by_category: {
    label: "Explore By Category",
    heading: "Explore By Category",
    order: 65,
    fields: ["heading"],
  },
  brands_on_the_move: {
    label: "Brands On The Move",
    heading: "Brands On The Move",
    body: "Mobile businesses that come to you",
    order: 70,
    fields: ["heading", "body"],
  },
  findmi_for_business: {
    label: "FindMi For Business",
    eyebrow: "FindMi For Business",
    heading: "Ready to be found?",
    body: "FindMi gives your business one presence for discovery, products, appearances, events, and staying connected with customers who follow you. We help with setup, so joining doesn't feel like another platform you have to build and maintain from scratch.",
    ctaLabel: "Join FindMi",
    ctaUrl: "/join",
    order: 80,
    fields: ["eyebrow", "heading", "body", "cta"],
  },
  one_profile: {
    label: "One Profile",
    eyebrow: "For Businesses",
    heading: "One profile. Everywhere you go.",
    order: 90,
    fields: ["eyebrow", "heading"],
  },
  popular_locations: {
    label: "Popular Locations",
    heading: "Popular Locations",
    body: "See who's showing up next at each spot",
    ctaLabel: "View all",
    ctaUrl: "/locations",
    order: 100,
    fields: ["heading", "body", "cta"],
  },
  closing_cta: {
    label: "Closing CTA",
    eyebrow: "Founding 500 · $99/year",
    heading: "More visibility.\nMore customers.\nMore growth.",
    body: "List your business, promote events, sell products, and connect with your community.",
    ctaLabel: "Join FindMi →",
    ctaUrl: "/join",
    order: 110,
    fields: ["eyebrow", "heading", "body", "cta"],
  },
};

// ---------------------------------------------------------------------
// Discovery Topics — a compact homepage navigation row (Homepage Hero
// Polish pass), sitting between Search and "Upcoming Events Near You".
// These are NAVIGATION ITEMS ONLY: no cross-content Discovery taxonomy
// exists yet, so a topic is nothing more than a founder-configured label
// + destination URL — the same shape as a Custom Link nav item, not a
// category filter that understands events/products/appearances. Stored
// as one more site_sections row (page_key "homepage", section_key
// "discovery_topics"), reusing the config_json column every imaged
// section already writes to rather than a new table. Defaults below only
// point at real, currently-existing destinations (an actual business
// category filter, or /discover) — any topic with no honest destination
// yet ships hidden, per the explicit "do not create dead links" rule,
// until the founder configures one in /admin/site/homepage.
// ---------------------------------------------------------------------

export interface DiscoveryTopic {
  label: string;
  url: string;
  visible: boolean;
  order: number;
}

export const DEFAULT_DISCOVERY_TOPICS: DiscoveryTopic[] = [
  // "Food & Drink" is a real business category (slug "food-drink").
  { label: "Food + Drink", url: "/businesses?category=food-drink", visible: true, order: 0 },
  // No "Workshops" category exists yet — hidden by default rather than
  // linking somewhere dishonest.
  { label: "Workshops", url: "", visible: false, order: 1 },
  // "Markets & Pop-Ups" is the closest real business category.
  { label: "Markets + Fairs", url: "/businesses?category=markets-pop-ups", visible: true, order: 2 },
  // No "Apparel" category exists yet.
  { label: "Apparel", url: "", visible: false, order: 3 },
  // No "Kids" category exists yet.
  { label: "Kids", url: "", visible: false, order: 4 },
  // /discover is FindMi's existing general mixed-discovery page — the
  // most honest "View All" destination available today.
  { label: "View All", url: "/discover", visible: true, order: 5 },
];

/** Raw, admin-facing list — every configured (or default) topic
 * regardless of visibility, so the editor can still show and re-enable a
 * hidden one. Always returns exactly DEFAULT_DISCOVERY_TOPICS.length rows,
 * position-matched to the defaults, since the admin form edits fixed
 * slots rather than adding/removing rows. */
export function getDiscoveryTopicsRaw(overrides: Map<string, SiteSection>): DiscoveryTopic[] {
  const row = overrides.get("discovery_topics");
  const configured = row?.config_json?.topics;
  if (!Array.isArray(configured)) return DEFAULT_DISCOVERY_TOPICS;
  return DEFAULT_DISCOVERY_TOPICS.map((def, i) => {
    const t = configured[i] as Record<string, unknown> | undefined;
    if (!t || typeof t !== "object") return def;
    return {
      label: typeof t.label === "string" && t.label.trim() ? t.label : def.label,
      url: typeof t.url === "string" ? t.url : "",
      visible: typeof t.visible === "boolean" ? t.visible : def.visible,
      order: typeof t.order === "number" && Number.isFinite(t.order) ? t.order : def.order,
    };
  });
}

/** Public-facing list — visible topics with a real destination only,
 * sorted by founder-controlled order. A topic with an empty URL never
 * renders regardless of its visible flag (no dead links). */
export function resolveDiscoveryTopics(overrides: Map<string, SiteSection>): DiscoveryTopic[] {
  return getDiscoveryTopicsRaw(overrides)
    .filter((t) => t.visible && t.url.trim().length > 0)
    .sort((a, b) => a.order - b.order);
}

// KNOWN LIMITATION (updated — 2026 feed-builder pass): the homepage's
// structural funnel (Hero, Search, Category pills, "Upcoming Events Near
// You") still renders in a fixed sequence, not by reading `order` — that
// part is intentionally protected (see the feed-builder report). What
// used to also be fixed here — Featured Brands, Business Showcase, Shop
// Local — is no longer part of this limitation at all: those are now
// founder-managed Homepage Rows (see lib/homepage-rows.ts and
// /admin/site/homepage/rows), fully reorderable/hideable/deletable, along
// with any new row the founder adds. Explore By Category and the closing
// CTA remain fixed-position site_sections entries below the row list;
// Move Up/Down here still has no visible effect on those two specifically
// (same disclosed tradeoff as before, just a smaller surface now).
export const HOMEPAGE_ORDERABLE_KEYS = Object.entries(HOMEPAGE_SECTIONS)
  .filter(([, def]) => def.orderable !== false)
  .map(([key]) => key);
