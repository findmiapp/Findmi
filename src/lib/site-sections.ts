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
}

export interface SectionDefaults {
  label: string; // admin-facing card title — never edited, just orientation
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  order: number;
  fields: ("eyebrow" | "heading" | "body" | "cta")[];
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
  return {
    eyebrow: row?.eyebrow ?? defaults.eyebrow ?? null,
    heading: row?.heading ?? defaults.heading ?? null,
    body: row?.body ?? defaults.body ?? null,
    ctaLabel: row?.cta_label ?? defaults.ctaLabel ?? null,
    ctaUrl: row?.cta_url ?? defaults.ctaUrl ?? null,
    visible: row?.is_visible ?? true,
    order: row?.sort_order ?? defaults.order,
  };
}

// ---------------------------------------------------------------------
// Homepage registry — the single source of truth for section keys,
// default copy, which fields each section exposes, and default order.
// Adding a page later means adding a sibling registry, not touching this.
// ---------------------------------------------------------------------

export const HOMEPAGE_SECTIONS: Record<string, SectionDefaults> = {
  hero: {
    label: "Hero",
    heading: "What's around you right now?",
    order: 0,
    fields: ["heading"],
    orderable: false,
  },
  business_doorway: {
    // Repurposed (2026 discovery-marketplace redesign) as the homepage's
    // Primary Join Banner, right after the first two discovery feeds — was
    // previously a one-line masthead link. Key/admin card kept as-is so
    // this stays founder-editable; only the default copy and field set
    // changed (added body).
    label: "Business Doorway",
    heading: "Have a business or brand?",
    body: "Get discovered on FindMi.",
    ctaLabel: "Join FindMi →",
    ctaUrl: "/join",
    order: 1,
    fields: ["heading", "body", "cta"],
    orderable: false,
  },
  brand_spotlight: {
    label: "Brand Spotlight",
    eyebrow: "Brand Spotlight",
    order: 10,
    fields: ["eyebrow"],
  },
  featured_events: {
    // Repurposed as "Upcoming Near You", the homepage's first live feed —
    // same underlying upcoming-events concept as before, new copy/position.
    label: "Featured Events",
    heading: "Upcoming Near You",
    body: "Markets, pop-ups, and festivals coming up",
    ctaLabel: "View all",
    ctaUrl: "/events",
    order: 20,
    fields: ["heading", "body", "cta"],
  },
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

export const HOMEPAGE_ORDERABLE_KEYS = Object.entries(HOMEPAGE_SECTIONS)
  .filter(([, def]) => def.orderable !== false)
  .map(([key]) => key);
