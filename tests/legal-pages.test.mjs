// Legal content pass (Oct 2026): the public Terms, Privacy Policy and About
// pages, the footer's legal links, and Privacy Choices behavior that the
// pages describe. Source-level checks (the pages are server components);
// the interactive behavior is exercised in the browser QA for this pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const TERMS = read("src/app/(public)/terms/page.tsx");
const PRIVACY = read("src/app/(public)/privacy/page.tsx");
const ABOUT = read("src/app/(public)/about/page.tsx");
const ABOUT_DEFAULTS = read("src/lib/about-page.ts");
const FOOTER = read("src/components/Footer.tsx");
const PANEL = read("src/components/privacy/PrivacyChoicesPanel.tsx");
const ROOT = read("src/components/privacy/PrivacyChoicesRoot.tsx");
const PUBLISHED = read("src/lib/legal/published.ts");

/** User-facing text only: drop // and block comments. */
const copyOf = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

const sectionTitles = (src) => [...src.matchAll(/title: "([^"]+)",\n\s+blocks:/g)].map((m) => m[1]);

test("Terms is the substantive rewrite, with every required section", () => {
  const titles = sectionTitles(TERMS);
  for (const t of [
    "What Findmi Is",
    "Your Responsibilities And Due Diligence",
    "Eligibility And Accounts",
    "Business Pages, Claims And Authority",
    "Listings And Page Information",
    "Events, Appearances And Locations",
    "Opportunities, Inquiries And Commercial Connections",
    "Fees And How Findmi Earns Money",
    "Marketplace Purchases",
    "Messages And Communications",
    "Your Content And Moments",
    "Findmi's Intellectual Property",
    "Copyright And Trademark Complaints",
    "Acceptable Use",
    "Third-Party Services",
    "Availability And Changes To Findmi",
    "Disclaimers",
    "Limitation Of Liability",
    "Indemnity",
    "Ending Your Use Of Findmi",
    "Disputes",
    "Changes To These Terms",
    "General",
    "Contact",
  ]) {
    assert.ok(titles.includes(t), `missing Terms section: ${t}`);
  }
  assert.match(TERMS, /lastUpdated=\{TERMS_LAST_UPDATED\}/);
  assert.doesNotMatch(TERMS, /Last updated September 2026/);
  // Platform role, no-guarantee and no-ownership statements.
  assert.match(TERMS, /is not the organizer, venue, seller, employer, agent, representative, sponsor, producer or contracting party/);
  assert.match(TERMS, /doesn't guarantee any acceptance, response, placement, booking, sponsorship, employment, sale, distribution, partnership, payment, performance or other result/);
  assert.match(TERMS, /You own the content you post on Findmi/);
  assert.match(TERMS, /Findmi receiving compensation doesn't, by itself, make Findmi responsible/);
  assert.match(TERMS, /Not every page on Findmi is managed by the business/);
});

test("Terms invents no venue, governing law, arbitration, entity or DMCA agent", () => {
  const copy = copyOf(TERMS);
  for (const banned of [/arbitrat/i, /class action/i, /governing law/i, /courts? (located )?in/i, /Delaware/, /\bInc\.?\b/, /LLC/, /Full Circle/i, /designated agent/i, /DMCA agent/i]) {
    assert.doesNotMatch(copy, banned, String(banned));
  }
});

test("Privacy Policy is the substantive rewrite and describes the system that exists", () => {
  const titles = sectionTitles(PRIVACY);
  for (const t of [
    "Information You Provide",
    "Information Collected Automatically",
    "Information From Other Sources",
    "How Findmi Uses Information",
    "Analytics And Privacy Choices",
    "Global Privacy Control",
    "What's Public On Findmi",
    "Photos And Image Data",
    "Automated And AI-Assisted Tools",
    "Where Pages Come From",
    "How Information Is Shared",
    "How Long Findmi Keeps Information",
    "Your Choices And Rights",
    "Emails From Findmi",
    "Children",
    "Security",
    "Where Information Is Processed",
    "Changes To This Policy",
    "Contact",
  ]) {
    assert.ok(titles.includes(t), `missing Privacy section: ${t}`);
  }
  // The analytics lifetime comes from the same constant the cookies use.
  assert.match(PRIVACY, /ANALYTICS_IDENTIFIER_MAX_AGE_DAYS/);
  assert.match(PRIVACY, /Findmi doesn't sell personal information/);
  assert.match(PRIVACY, /Findmi doesn't send marketing emails today/);
  // Retention is described truthfully: no fixed deletion schedule.
  assert.match(PRIVACY, /doesn't currently delete them on a fixed schedule/);
  assert.doesNotMatch(copyOf(PRIVACY), /deleted after \d+ days|retained for \d+ (days|months)/i);
  // The old false claim stays gone.
  assert.doesNotMatch(PRIVACY, /notify you when a business you follow posts a new appearance/);
  // Only processors confirmed in the codebase are named.
  for (const name of ["Vercel", "Supabase", "Stripe", "Resend", "Anthropic", "Tally"]) assert.match(PRIVACY, new RegExp(name));
  for (const name of ["Google Analytics", "Meta", "Facebook", "Mixpanel", "Segment", "Hotjar", "Amplitude"]) assert.doesNotMatch(copyOf(PRIVACY), new RegExp(`\\b${name}\\b`));
});

test("Terms, Privacy and About copy: Findmi casing, no em dashes, no legal entity", () => {
  for (const [name, src] of [
    ["terms", TERMS],
    ["privacy", PRIVACY],
    ["about", ABOUT],
    ["about defaults", ABOUT_DEFAULTS],
    ["panel", PANEL],
  ]) {
    const copy = copyOf(src);
    assert.doesNotMatch(copy, /\b(FindMi|FINDMI|FindMI)\b/, name);
    assert.doesNotMatch(copy, /—/, `${name}: no em dashes in copy`);
    assert.doesNotMatch(copy, /Full Circle|Delaware|Findmi,? Inc\.|Findmi,? Inc\b(?!lu)/i, name);
  }
  assert.match(PUBLISHED, /TERMS_LAST_UPDATED = "/);
  assert.match(PUBLISHED, /PRIVACY_LAST_UPDATED = "/);
});

test("About explains Findmi today, without becoming Terms", () => {
  assert.match(ABOUT_DEFAULTS, /Findmi connects the things you discover online with the places you can experience them in the real world/);
  assert.match(ABOUT, /title: "For People"/);
  assert.match(ABOUT, /title: "For Businesses"/);
  assert.match(ABOUT, /About The Pages On Findmi/);
  assert.match(ABOUT, /compiled by Findmi from publicly available information/);
  for (const href of ["/terms", "/privacy", "/privacy-choices"]) assert.match(ABOUT, new RegExp(`href="${href}"`));
  assert.doesNotMatch(ABOUT, /Limitation Of Liability|Indemn/);
});

test("Footer: About, Terms, Privacy and Privacy Choices on desktop and on mobile", () => {
  const desktop = FOOTER.slice(FOOTER.indexOf("hidden md:flex"), FOOTER.indexOf("md:hidden"));
  const mobile = FOOTER.slice(FOOTER.indexOf("md:hidden"));
  for (const block of [desktop, mobile]) {
    for (const href of ["/about", "/terms", "/privacy", "/privacy-choices"]) assert.match(block, new RegExp(`href="${href}"`), href);
  }
});

test("Privacy Choices: the Privacy Policy link closes the sheet and any route change closes it", () => {
  assert.match(PANEL, /<Link href="\/privacy" onClick=\{\(\) => onNavigate\?\.\(\)\}/);
  assert.match(ROOT, /usePathname\(\)/);
  assert.match(ROOT, /useEffect\(\(\) => \{\s*setSheetOpen\(false\);\s*\}, \[pathname\]\);/);
  assert.match(ROOT, /<PrivacyChoicesPanel onSaved=\{onClose\} onCancel=\{onClose\} onNavigate=\{onNavigate\} \/>/);
});

test("Privacy Choices: Analytics works signed out; account-only and nonexistent programs are truthful", () => {
  // Analytics is never gated on sign-in.
  const analyticsRow = PANEL.slice(PANEL.indexOf('title="Analytics"'), PANEL.indexOf('title="Personalized Discovery"'));
  assert.doesNotMatch(analyticsRow, /signedIn/);
  // Personalized Discovery signed out: a plain label, not a disabled switch.
  const personalRow = PANEL.slice(PANEL.indexOf('title="Personalized Discovery"'));
  assert.match(personalRow, /unavailable=\{state && !signedIn \? "When Signed In" : undefined\}/);
  assert.doesNotMatch(personalRow.slice(0, personalRow.indexOf("/>")), /disabled=\{!signedIn\}/);
  // No Marketing Emails switch: Findmi doesn't run a marketing program.
  assert.doesNotMatch(PANEL, /title="Marketing Emails"/);
  assert.doesNotMatch(PANEL, /marketingEmail:/);
  assert.match(PANEL, /Findmi doesn&rsquo;t send marketing emails/);
});
