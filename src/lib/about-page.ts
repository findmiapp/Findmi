// About page — founder-editable content, Menu Polish + Editable About
// pass. Reuses the existing generic site_sections table (page_key
// "about") — the same mechanism already powering the homepage, /join,
// and global Contact Info — rather than a new table or a heavier
// resolveSection()/HOMEPAGE_SECTIONS-style registry, which is sized for
// the homepage's multi-section reorderable system and would be overkill
// for About's two sections.
//
// Two sections: "hero" (heading/intro/highlight/body/CTAs) and "contact"
// (heading/copy/action label — the actual email destination is NOT
// stored here, see resolveAboutContact below). Every default value below
// is the exact current live About copy, so an unconfigured/absent row
// renders byte-identical to today (Section 4's field-by-field fallback
// pattern, same as resolveSection()).
import type { SiteSection } from "./types";

export interface AboutHero {
  eyebrow: string | null;
  heading: string;
  intro: string;
  highlight: string;
  /** Additional body paragraphs, one string per paragraph — stored as a
   * single textarea in admin with a blank line between paragraphs, split
   * here so the public page can render each as its own <p> (preserves
   * paragraph breaks without arbitrary HTML). */
  bodyParagraphs: string[];
  ctaLabel: string;
  ctaUrl: string;
  secondaryCtaLabel: string;
  secondaryCtaUrl: string;
}

export interface AboutContact {
  visible: boolean;
  heading: string;
  body: string;
  ctaLabel: string;
}

const DEFAULT_HERO: AboutHero = {
  eyebrow: null,
  heading: "About Findmi",
  intro:
    "Findmi helps you discover brands, vendors, mobile businesses, products, events, pop-ups, markets, and places — with one question always in mind:",
  highlight: "Where can I find this business next?",
  bodyParagraphs: [
    "A lot of the best businesses don't sit still. Coffee carts, food trucks, flower stands, and small makers move between markets, pop-ups, and events every week. Findmi connects the dots: browse a business and see where they'll be next, or browse an event and see who's going to be there.",
    "For businesses, Findmi is one home for what you sell, where you'll be next, and how customers can reach you — instead of juggling five different social posts to announce a location.",
  ],
  ctaLabel: "Explore Findmi",
  ctaUrl: "/discover",
  secondaryCtaLabel: "List Your Business",
  secondaryCtaUrl: "/account/business/new",
};

const DEFAULT_CONTACT: AboutContact = {
  visible: true,
  heading: "Questions, partnerships, or feedback?",
  body: "We'd love to hear from you.",
  ctaLabel: "Contact Findmi",
};

export function resolveAboutHero(overrides: Map<string, SiteSection>): AboutHero {
  const row = overrides.get("hero");
  const config = (row?.config_json ?? {}) as {
    highlight?: unknown;
    bodyExtra?: unknown;
    secondaryCtaLabel?: unknown;
    secondaryCtaUrl?: unknown;
  };
  const highlight =
    typeof config.highlight === "string" && config.highlight.trim() ? config.highlight.trim() : DEFAULT_HERO.highlight;
  const bodyExtra = typeof config.bodyExtra === "string" ? config.bodyExtra : null;
  const bodyParagraphs = bodyExtra
    ? bodyExtra
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
    : DEFAULT_HERO.bodyParagraphs;
  const secondaryCtaLabel = typeof config.secondaryCtaLabel === "string" ? config.secondaryCtaLabel : null;
  const secondaryCtaUrl = typeof config.secondaryCtaUrl === "string" ? config.secondaryCtaUrl : null;

  return {
    eyebrow: row?.eyebrow ?? DEFAULT_HERO.eyebrow,
    heading: row?.heading ?? DEFAULT_HERO.heading,
    intro: row?.body ?? DEFAULT_HERO.intro,
    highlight,
    bodyParagraphs: bodyParagraphs.length > 0 ? bodyParagraphs : DEFAULT_HERO.bodyParagraphs,
    ctaLabel: row?.cta_label ?? DEFAULT_HERO.ctaLabel,
    ctaUrl: row?.cta_url ?? DEFAULT_HERO.ctaUrl,
    secondaryCtaLabel: secondaryCtaLabel ?? DEFAULT_HERO.secondaryCtaLabel,
    secondaryCtaUrl: secondaryCtaUrl ?? DEFAULT_HERO.secondaryCtaUrl,
  };
}

/** The Contact section's own editable copy — heading, body, action label,
 * and enabled/disabled (reusing the existing is_visible column rather
 * than a new boolean). The actual mailto: destination is deliberately
 * NOT stored here — it comes from the existing, already-founder-editable
 * global contact email (getSiteContactInfo(), Admin → Site → Contact
 * Info) so there's exactly one place that configures the real email,
 * never two that could drift out of sync. Callers combine this with
 * getSiteContactInfo() and hide the section entirely when no email is
 * configured (see about/page.tsx). */
export function resolveAboutContact(overrides: Map<string, SiteSection>): AboutContact {
  const row = overrides.get("contact");
  return {
    visible: row?.is_visible ?? DEFAULT_CONTACT.visible,
    heading: row?.heading ?? DEFAULT_CONTACT.heading,
    body: row?.body ?? DEFAULT_CONTACT.body,
    ctaLabel: row?.cta_label ?? DEFAULT_CONTACT.ctaLabel,
  };
}
