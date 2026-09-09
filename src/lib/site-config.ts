// Highperlocal Prep, Pass 1 — Brand Configuration Foundation V1.
//
// One centralized, environment-driven switch (NEXT_PUBLIC_SITE_BRAND)
// selecting between two statically-defined configs below, rather than a
// dozen separate env vars. Findmi is the default whenever the env var is
// unset, blank, or unrecognized — so a deployment that never sets
// NEXT_PUBLIC_SITE_BRAND (every existing FindMi deployment, today) gets
// byte-for-byte the same values that were previously hardcoded inline at
// each call site. This file does NOT attempt to replace every occurrence
// of "FindMi"/"Findmi" across the app (170+ files, much of it page copy)
// — only the small set of central, shared surfaces (root metadata,
// robots, sitemap, Logo, Footer, the Tailwind brand color token, and a
// support-email fallback) that a second, isolated deployment actually
// needs to look and resolve correctly on its own. See CLAUDE.md §2 for
// the locked FindMi brand values the `findmi` entry below preserves
// exactly.
//
// Also carries ONE central, server-safe capability flag —
// `commerceEnabled` — for Highperlocal's "no Stripe processing, no
// cannabis product checkout" requirement. Every Stripe-initiating server
// action/route and the Stripe webhook route check this before doing
// anything else; see lib/commerce/membershipCheckout.ts,
// lib/commerce/businessProCheckout.ts, (public)/cart/actions.ts, and
// app/api/webhooks/stripe/route.ts. Deliberately tied to `brand` rather
// than a separate env var: there is no scenario yet where a `findmi`
// deployment should have commerce disabled or a `highperlocal` one
// enabled, and a single source of truth is safer than two switches that
// could drift out of sync.
//
// Deliberately NOT "server-only" — NEXT_PUBLIC_SITE_BRAND is meant to be
// public (same posture as NEXT_PUBLIC_SITE_URL), and this module is
// imported from client components too (Logo.tsx, the cart page) as well
// as tailwind.config.ts at build time. Nothing in here is a secret.

export type SiteBrand = "findmi" | "highperlocal";

// A plain string-keyed record (not a stricter named-shade interface) so
// this assigns directly into Tailwind's own color-scale type in
// tailwind.config.ts, which expects exactly this shape (an index
// signature, not fixed named keys).
type BrandColorScale = Record<string, string>;

export interface SiteConfig {
  brand: SiteBrand;
  /** Short, URL/env-safe identifier — same value as `brand` today, kept as
   * its own field since a future third brand could theoretically want a
   * display name that differs from its identifier. */
  siteId: string;
  siteName: string;
  /** Short tagline used in shared chrome (currently: Footer). */
  tagline: string;
  /** Used only when NEXT_PUBLIC_SITE_URL and VERCEL_URL are both unset —
   * see lib/site-url.ts's own precedence, and app/layout.tsx / robots.ts /
   * sitemap.ts, which previously hardcoded "https://findmi.app" inline for
   * this exact same fallback case. */
  publicUrlFallback: string;
  /** Deployment Readiness Fixes, Pass 8 — the bare public-facing brand
   * domain (no protocol, no trailing slash): "findmi.app" /
   * "highperlocal.com". This is a DISPLAY LABEL only — the profile-URL
   * prefix (UsernameField.tsx, handle-availability.ts, FindmiUrlCard.tsx),
   * the admin join-page invite-link hint, and the .ics calendar UID
   * suffix (AddToCalendarButton.tsx). It is NOT the runtime redirect/auth
   * origin — that stays exactly getPublicOrigin()'s own
   * NEXT_PUBLIC_SITE_URL -> VERCEL_URL -> localhost precedence
   * (lib/site-url.ts), unchanged by this field, so preview auth links
   * keep resolving to the actual preview deployment even before
   * highperlocal.com is connected. */
  domain: string;
  /** Fallback shown/used only when the founder-configured contact email
   * (Admin → Site → Contact Info, lib/contact-info.ts) is unset. `null`
   * for findmi preserves that page's exact existing behavior (unset ->
   * hidden action, never a fabricated address). Distinct from
   * legalPrivacyEmail/legalContactEmail below — this one fallback for a
   * founder-editable business-contact field, those two are the fixed
   * addresses printed on the static Privacy/Terms pages. */
  supportEmail: string | null;
  /** Deployment Readiness Fixes, Pass 8 — the two static legal-page
   * contact addresses (Privacy's "Contact" section / Terms' "Contact"
   * section). These establish the INTENDED address only; for highperlocal
   * neither inbox is provisioned yet (see BRAND_CONFIG entry below). */
  legalPrivacyEmail: string;
  legalContactEmail: string;
  metadataTitleDefault: string;
  metadataTitleTemplate: string;
  metadataDescription: string;
  ogSiteName: string;
  logoSrc: string;
  logoAlt: string;
  brandColor: BrandColorScale;
  commerceEnabled: boolean;
}

// FindMi Aqua — sampled from the real logo asset (public/logo-lockup.png),
// exactly as already defined in tailwind.config.ts. Copied here verbatim,
// never re-derived, so `findmi`'s rendered color is provably unchanged.
const FINDMI_AQUA: BrandColorScale = {
  DEFAULT: "#14B0BC",
  50: "#EDFBFC",
  100: "#D3F5F6",
  200: "#A8ECEE",
  300: "#7FE1E3",
  400: "#3FC7CE",
  500: "#14B0BC",
  600: "#0F8E98",
  700: "#0C6F77",
  800: "#0A575D",
  900: "#08454A",
};

const BRAND_CONFIG: Record<SiteBrand, SiteConfig> = {
  findmi: {
    brand: "findmi",
    siteId: "findmi",
    siteName: "Findmi",
    tagline: "Find what you're looking for. And where it'll be next.",
    publicUrlFallback: "https://findmi.app",
    domain: "findmi.app",
    supportEmail: null,
    legalPrivacyEmail: "privacy@findmi.app",
    legalContactEmail: "hello@findmi.app",
    metadataTitleDefault: "Findmi — Find what you're looking for. And where it'll be next.",
    metadataTitleTemplate: "%s · Findmi",
    metadataDescription:
      "Findmi helps you discover brands, vendors, mobile businesses, and events — and always know where they'll be next.",
    ogSiteName: "Findmi",
    logoSrc: "/logo-lockup.png",
    logoAlt: "Findmi",
    brandColor: FINDMI_AQUA,
    commerceEnabled: true,
  },
  highperlocal: {
    brand: "highperlocal",
    siteId: "highperlocal",
    siteName: "Highperlocal",
    tagline: "Brand activations, pop-ups, and events — wherever they show up next.",
    // Placeholder only — highperlocal.com is NOT connected by this pass
    // (out of scope per this pass's own instructions). Same role as
    // findmi.app above: a last-resort fallback if NEXT_PUBLIC_SITE_URL is
    // ever left unset in a real deployment, never contacted by this code.
    publicUrlFallback: "https://highperlocal.com",
    // The canonical brand domain — used as a display label (profile URLs,
    // the join-page invite hint, calendar UIDs) even before DNS/highperlocal.com
    // is actually connected to a deployment (see this field's own doc
    // comment on SiteConfig above: this is never the runtime redirect
    // origin, which stays getPublicOrigin()'s own precedence).
    domain: "highperlocal.com",
    // Placeholder address — no inbox is provisioned for this domain yet.
    // Real contact info should be set per-deployment via Admin → Site →
    // Contact Info (lib/contact-info.ts) once Highperlocal's own Supabase
    // project exists; this is only the fallback for when that's unset.
    supportEmail: "hello@highperlocal.com",
    // Placeholder addresses — same "not provisioned yet" caveat as
    // supportEmail above; this establishes the intended address only.
    legalPrivacyEmail: "privacy@highperlocal.com",
    legalContactEmail: "hello@highperlocal.com",
    metadataTitleDefault: "Highperlocal — Brand activations, pop-ups, and events near you.",
    metadataTitleTemplate: "%s · Highperlocal",
    metadataDescription:
      "Highperlocal helps you discover brand activations, pop-ups, and events — and follow the brands you love wherever they show up next.",
    ogSiteName: "Highperlocal",
    // Placeholder path — no Highperlocal logo asset has been supplied yet;
    // see this pass's final report for the remaining step of adding a real
    // /public/logo-lockup-highperlocal.png.
    logoSrc: "/logo-lockup-highperlocal.png",
    logoAlt: "Highperlocal",
    // No Highperlocal brand color has been supplied/approved yet (see
    // CLAUDE.md §2 — never invent one). Reusing FindMi Aqua's exact values
    // as a neutral placeholder keeps this visually identical to FindMi
    // until a real Highperlocal color is provided; swap the values in this
    // one object when it is.
    brandColor: FINDMI_AQUA,
    commerceEnabled: false,
  },
};

function resolveBrand(): SiteBrand {
  const raw = (process.env.NEXT_PUBLIC_SITE_BRAND ?? "").trim().toLowerCase();
  return raw === "highperlocal" ? "highperlocal" : "findmi";
}

export const SITE_BRAND: SiteBrand = resolveBrand();

export const siteConfig: SiteConfig = BRAND_CONFIG[SITE_BRAND];

/** Central resolver for the Stripe/commerce-checkout capability flag —
 * every Stripe-initiating server action/route should call this (or read
 * siteConfig.commerceEnabled directly) before doing anything else, INCLUDING
 * before calling getStripe()/reading Stripe env vars, so the refusal is a
 * deliberate, documented product decision rather than an incidental
 * side-effect of a missing key. */
export function isCommerceEnabled(): boolean {
  return siteConfig.commerceEnabled;
}
