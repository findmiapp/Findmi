import type { Metadata } from "next";

// Findmi's own public identity: the homepage title/description, the
// branded share image, and the site-level JSON-LD entities. One source so
// the root layout's defaults, the homepage's metadata and its structured
// data can't drift apart.

// `||` (not `??`) so an env var that's *set but blank* still falls back.
// Also the stable base for the entity @ids below, so they stay
// https://findmi.app/#... rather than following a preview deployment URL.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://findmi.app").replace(/\/+$/, "");

export const SITE_NAME = "Findmi";
export const SITE_DESCRIPTOR = "The Find Me Here App";
export const HOME_TITLE = `${SITE_NAME} | ${SITE_DESCRIPTOR}`;
export const HOME_DESCRIPTION =
  "Discover brands, products, places and experiences you love. See what's happening, where to find them and where they'll be next. All made simple with Findmi.";

// Static, opaque 1200x630 card (see scripts/generate-og-image.mjs). A
// plain public/ file, not an opengraph-image route, so it never cascades
// over the per-entity images Business/Event/Product pages set themselves.
export const SHARE_IMAGE = {
  url: "/og/findmi-share.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: `${SITE_NAME}: ${SITE_DESCRIPTOR}`,
};

export const HOME_METADATA: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    url: "/",
    siteName: SITE_NAME,
    type: "website",
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    images: [SHARE_IMAGE],
  },
};

const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;
const APP_ID = `${SITE_URL}/#app`;

/** Homepage JSON-LD: the organization behind findmi.app, the website and
 * the web app, linked by @id. Only facts the product itself establishes;
 * no sameAs (no official social accounts are configured anywhere). */
export function siteEntityGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORGANIZATION_ID,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        logo: { "@type": "ImageObject", url: `${SITE_URL}/logo-lockup.png`, width: 1189, height: 484 },
        description: `${SITE_NAME} is an IRL discovery platform for finding brands, products, places, experiences and events, what's happening with them, and where they'll be next.`,
      },
      {
        "@type": "WebSite",
        "@id": WEBSITE_ID,
        name: SITE_NAME,
        alternateName: HOME_TITLE,
        url: `${SITE_URL}/`,
        description: HOME_DESCRIPTION,
        inLanguage: "en-US",
        publisher: { "@id": ORGANIZATION_ID },
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/search?q={search_term_string}` },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "WebApplication",
        "@id": APP_ID,
        name: SITE_NAME,
        alternateName: SITE_DESCRIPTOR,
        url: `${SITE_URL}/`,
        description: HOME_DESCRIPTION,
        applicationCategory: "LifestyleApplication",
        operatingSystem: "Web",
        browserRequirements: "Requires a modern web browser.",
        image: `${SITE_URL}${SHARE_IMAGE.url}`,
        publisher: { "@id": ORGANIZATION_ID },
        isPartOf: { "@id": WEBSITE_ID },
      },
    ],
  };
}
