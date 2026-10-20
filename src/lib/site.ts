// Site configuration — one codebase, two consumer sites.
//
// Findmi (findmi.app) and JerseyCity.guide render the SAME pages and
// components; only what's in this file differs: brand, metadata, the
// geographic scope a site is locked to, its navigation, footer links,
// editorial page and which Findmi-wide features it exposes. The site is
// chosen at build time by the SITE environment variable (unset = Findmi),
// inlined by next.config.mjs as NEXT_PUBLIC_SITE so server and client
// components always agree. Pure and dependency-free.
//
// Findmi's entries below are exactly the values its components hard-coded
// before this file existed, so Findmi renders unchanged.

import type { ResolvedNavItem } from "./navigation";

export type SiteId = "findmi" | "jc";

export interface SiteFooterColumn {
  title: string;
  links: { href: string; label: string }[];
}

export interface SiteConfig {
  id: SiteId;
  name: string;
  url: string;
  /** Header/footer brand mark. */
  logo: { kind: "image"; src: string; alt: string } | { kind: "wordmark"; primary: string; secondary: string };
  metadata: { defaultTitle: string; titleTemplate: string; description: string; ogTitle: string; ogDescription: string; siteName: string };
  /** Geographic lock: every discovery query on this site is confined to
   * this Market/Area (and the Area's child neighborhoods). Null = the
   * national Findmi experience with free market/area choice. */
  scope: { market: string; area: string; geoPlaceKey: string } | null;
  /** Public discovery nav. Null = the founder-managed nav_items table. */
  nav: ResolvedNavItem[] | null;
  footer: { tagline: string; columns: SiteFooterColumn[]; mobileLinks: { href: string; label: string }[]; legalName: string };
  /** discovery_pages.slug for this site's editorial homepage rows/lanes.
   * Null = the system (Findmi Home) page. A site whose page doesn't exist
   * yet falls back to the system page, still confined to its scope. */
  discoveryPageSlug: string | null;
  /** site_sections.page_key for founder-editable homepage copy. */
  homeSectionsKey: string;
  /** Section copy defaults that differ from Findmi's (hero, CTA…). */
  homeSectionDefaults: Record<string, { heading?: string; body?: string }>;
  features: {
    /** Sign in / Join, personal menus, Create, account-only nav rows. */
    accounts: boolean;
    /** Findmi For Business acquisition links. */
    business: boolean;
    /** Marketplace products, cart and checkout. */
    commerce: boolean;
    /** Findmi-wide editorial that isn't geo-scoped yet. */
    moments: boolean;
    bulletins: boolean;
    /** Search-engine indexing. */
    indexable: boolean;
  };
  /** Where account, commerce and admin routes live when this site
   * doesn't host them (null = this site hosts them). */
  accountsOrigin: string | null;
}

const nav = (id: string, label: string, href: string, icon: ResolvedNavItem["icon"]): ResolvedNavItem => ({
  id: `site-${id}`,
  label,
  href,
  external: false,
  icon,
  highlight: false,
  audience: "everyone",
  children: [],
});

const FINDMI: SiteConfig = {
  id: "findmi",
  name: "Findmi",
  url: "https://findmi.app",
  logo: { kind: "image", src: "/logo-lockup.png", alt: "Findmi" },
  metadata: {
    defaultTitle: "Findmi: Find what you're looking for. And where it'll be next.",
    titleTemplate: "%s · Findmi",
    description: "Findmi helps you discover brands, vendors, mobile businesses, and events, and always know where they'll be next.",
    ogTitle: "Findmi",
    ogDescription: "Find what you're looking for. And where it'll be next.",
    siteName: "Findmi",
  },
  scope: null,
  nav: null,
  footer: {
    tagline: "Find what you’re looking for. And where it’ll be next.",
    columns: [
      {
        title: "Discover",
        links: [
          { href: "/discover", label: "Discover" },
          { href: "/businesses", label: "Businesses" },
          { href: "/events", label: "Events" },
          { href: "/marketplace", label: "Marketplace" },
          { href: "/people", label: "People" },
        ],
      },
      { title: "Business", links: [{ href: "/join/business", label: "Join Findmi" }, { href: "/about", label: "About" }] },
      { title: "Legal", links: [{ href: "/privacy", label: "Privacy" }, { href: "/terms", label: "Terms" }] },
    ],
    mobileLinks: [
      { href: "/about", label: "About" },
      { href: "/join/business", label: "For Business" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
    legalName: "Findmi",
  },
  discoveryPageSlug: null,
  homeSectionsKey: "homepage",
  homeSectionDefaults: {},
  features: { accounts: true, business: true, commerce: true, moments: true, bulletins: true, indexable: true },
  accountsOrigin: null,
};

const JC: SiteConfig = {
  id: "jc",
  name: "JerseyCity.guide",
  url: "https://jerseycity.guide",
  logo: { kind: "wordmark", primary: "JerseyCity", secondary: ".guide" },
  metadata: {
    defaultTitle: "JerseyCity.guide: What's happening in Jersey City right now",
    titleTemplate: "%s · JerseyCity.guide",
    description: "Events, places and local brands across Jersey City's neighborhoods, today, this weekend and next.",
    ogTitle: "JerseyCity.guide",
    ogDescription: "What's happening in Jersey City right now.",
    siteName: "JerseyCity.guide",
  },
  scope: { market: "north-jersey", area: "jersey-city", geoPlaceKey: "place:3436000" },
  nav: [
    nav("discover", "Discover", "/discover", "compass"),
    nav("events", "Events", "/events", "calendar"),
    nav("places", "Places", "/locations", "pin"),
    nav("brands", "Brands", "/businesses", "storefront"),
  ],
  footer: {
    tagline: "What's happening in Jersey City right now. Powered by Findmi.",
    columns: [
      {
        title: "Discover",
        links: [
          { href: "/discover", label: "Discover" },
          { href: "/events", label: "Events" },
          { href: "/locations", label: "Places" },
          { href: "/businesses", label: "Brands" },
        ],
      },
      { title: "Findmi", links: [{ href: "https://findmi.app", label: "Findmi" }, { href: "https://findmi.app/join/business", label: "List Your Business" }] },
      { title: "Legal", links: [{ href: "https://findmi.app/privacy", label: "Privacy" }, { href: "https://findmi.app/terms", label: "Terms" }] },
    ],
    mobileLinks: [
      { href: "https://findmi.app", label: "Findmi" },
      { href: "https://findmi.app/privacy", label: "Privacy" },
      { href: "https://findmi.app/terms", label: "Terms" },
    ],
    legalName: "Findmi",
  },
  discoveryPageSlug: "jerseycity-guide",
  homeSectionsKey: "jc_homepage",
  homeSectionDefaults: {
    hero: {
      heading: "What's on in\nJersey City,\nright now.",
      body: "Events, pop-ups, places and local brands across every Jersey City neighborhood.",
    },
  },
  features: { accounts: false, business: false, commerce: false, moments: false, bulletins: false, indexable: false },
  accountsOrigin: "https://findmi.app",
};

const SITES: Record<SiteId, SiteConfig> = { findmi: FINDMI, jc: JC };

/** The site this build serves. NEXT_PUBLIC_SITE is inlined at build time
 * from SITE (next.config.mjs); anything other than "jc" is Findmi. */
export function getSite(): SiteConfig {
  return process.env.NEXT_PUBLIC_SITE === "jc" ? SITES.jc : SITES.findmi;
}
