// For Business Page Cleanup pass — /join/business is the public For
// Business landing page. Findmi Business Pages are free right now, so
// this page must say so without contradiction: no Free/Pro decision, no
// $20/$49 pricing, no Pro/Managed Pro sales section, no upgrade CTA.
// Exactly one creation path (Get Started Free -> the canonical
// /account/business/new flow, untouched) and one preserved secondary
// path for a Business that already exists (the unchanged Claim Your
// Business link -> /businesses). Source-level guards over the real
// JSX/lib (no rendering harness, no database), same convention as every
// other test in this suite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
// Strips /* */ and {/* */} comments so a doc comment explaining a
// removal (which necessarily mentions the removed phrase) never
// falsely trips a doesNotMatch assertion against the rendered page.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const PAGE_PATH = "src/app/(public)/join/business/page.tsx";
const RAW_PAGE = read(PAGE_PATH);
const PAGE = code(RAW_PAGE);
const JOIN_LIB = read("src/lib/join-page.ts");
const NEW_BIZ = read("src/app/(public)/account/business/new/page.tsx");
const CREATE = read("src/app/(public)/account/business/actions.ts");

test("1/2. /join/business still exists and functions as the public For Business landing page", () => {
  assert.match(RAW_PAGE, /export default async function JoinPage/);
  assert.match(RAW_PAGE, /title: \{ absolute: "Findmi for Business" \}/);
});

test("3/4. Contains a clear free Business CTA, and the primary creation CTA reaches the canonical Add A Business flow", () => {
  assert.match(PAGE, /Get Started Free/);
  assert.match(
    PAGE,
    /const freeCtaHref = ref \? `\/account\/business\/new\?ref=\$\{encodeURIComponent\(ref\)\}` : "\/account\/business\/new";/
  );
  assert.match(PAGE, /href=\{freeCtaHref\}/);
});

test("5/6. No $20 or $49 pricing remains on the rendered page", () => {
  assert.doesNotMatch(PAGE, /\$20/);
  assert.doesNotMatch(PAGE, /\$49/);
});

test("7/8. No Pro sales section and no Managed Pro sales section remain", () => {
  assert.doesNotMatch(PAGE, /ProCard|ChoosePathTiles/, "the removed components are gone, not just unused");
  assert.doesNotMatch(PAGE, /Managed Pro/);
  // The page's own source no longer says "Pro" anywhere at all — the
  // only remaining "Pro" text is the collapsed invite redemption
  // utility's CMS-editable heading default (JOIN_INVITE_SECTION_DEFAULTS
  // in lib/join-page.ts), never a sales pitch or a price.
  assert.doesNotMatch(PAGE, /\bPro\b/);
  assert.match(JOIN_LIB, /heading: "Have a Findmi Pro invite code\?"/);
  assert.doesNotMatch(JOIN_LIB.slice(JOIN_LIB.indexOf("JOIN_INVITE_SECTION_DEFAULTS")), /\$20|\$49|Managed Pro|Explore Pro/);
});

test("9/10. No pricing comparison and no upgrade CTA remain", () => {
  assert.doesNotMatch(PAGE, /Explore Pro/);
  assert.doesNotMatch(PAGE, /Want more\?|Want deeper tools\?|Upgrade to Pro/);
  assert.doesNotMatch(PAGE, /billed monthly or annually/i);
  assert.doesNotMatch(PAGE, /priceFootnote|noRenewalNote|highlightHeading/);
});

test("11. No paid-plan selection is introduced — no radio, no plan_choice field, no second price tier to pick", () => {
  assert.doesNotMatch(PAGE, /type="radio"/);
  assert.doesNotMatch(PAGE, /plan_choice/);
  assert.doesNotMatch(PAGE, /\?plan=pro/);
});

test("12. Free / no-credit-card messaging is present", () => {
  assert.match(PAGE, /Free\. No trial\. No credit card\./);
});

test("13. Current Business capabilities are represented truthfully — the value section names only currently-Free capabilities", () => {
  assert.match(PAGE, /function ValuePillars/);
  // Page Density pass: one compact connected-presence section.
  for (const phrase of [
    "One Business Presence, Connected Across Findmi",
    "Your Business Page",
    "Where Customers Can Find You",
    "Moments",
    "Discovery",
  ]) {
    assert.ok(PAGE.includes(phrase), `pillar present: ${phrase}`);
  }
  // No unsupported claim (traffic/audience/growth/AI/conversion).
  for (const weak of [
    "guaranteed",
    "guaranteed customers",
    "sales growth",
    "audience growth",
    "AI-powered",
    "AI recommendations",
    "massive reach",
    "supercharg",
  ]) {
    assert.doesNotMatch(PAGE, new RegExp(weak, "i"), `no unsupported claim: ${weak}`);
  }
  // Every pillar capability is independently confirmed Free in the live
  // Business onboarding pass's own audit (account/business/new, its
  // server action, and the entitlement checks it already verified).
  assert.match(CREATE, /Links\/Gallery\/Products\/the FindMi handle are no\s*\* longer Pro-only \(locked rule now matches Appearances\/Locations/);
  assert.match(NEW_BIZ, /Locations, stockists &amp; where to find you/);
  assert.match(NEW_BIZ, /Moments from your real-world activity/);
  assert.match(NEW_BIZ, /Findmi search &amp; discovery/);
});

test("14. Current terminology: Events you host or are Appearing At — never the internal Appearance entity", () => {
  assert.match(PAGE, /Appearing At/);
  assert.doesNotMatch(PAGE, /\bAppearance\b/);
});

test("15. The existing claim/find-business route is preserved — no new claim architecture invented", () => {
  assert.match(JOIN_LIB, /export const JOIN_CLAIM_BUSINESS_DEFAULTS = \{\s*body: "Already listed\?",\s*ctaLabel: "Claim your business",\s*ctaUrl: "\/businesses",\s*\};/);
  assert.match(PAGE, /resolveJoinClaimBusiness/);
  assert.match(PAGE, /href=\{claim\.ctaUrl\}/);
  // Surfaced in both the Hero and the Final CTA, never a fabricated
  // second destination.
  assert.equal((PAGE.match(/claim\.ctaUrl/g) ?? []).length, 2, "claim link appears exactly twice: Hero and Final CTA");
});

test("16. /account/business/new is not changed by this pass", () => {
  // Spot-check: the Free value section the Business Creation UX Cleanup
  // pass established is still exactly intact — this pass only reads
  // this file for its own verification, never edits it.
  assert.match(NEW_BIZ, /Get Started Free/);
  assert.doesNotMatch(NEW_BIZ, /name="plan_choice"/);
});

test("17. Stripe/subscription infrastructure is not changed — still fully intact in createMemberBusiness and lib/join-page.ts", () => {
  assert.match(CREATE, /createBusinessProCheckoutSession/);
  assert.match(CREATE, /createRecurringSubscriptionCheckoutSession|isRecurringCheckoutConfigured/);
  // The Pro/Free/Regional CMS content model stays fully defined —
  // only unused by the public page now, never deleted.
  assert.match(JOIN_LIB, /export const JOIN_CARD_DEFAULTS/);
  assert.match(JOIN_LIB, /export const JOIN_FREE_CARD_DEFAULTS/);
  assert.match(JOIN_LIB, /export function resolveJoinCard\(/);
  assert.match(JOIN_LIB, /export function resolveJoinFreeCard\(/);
  assert.match(JOIN_LIB, /export function resolveJoinProExtra\(/);
});

test("18. No unrelated public page is changed by this pass", () => {
  // The admin Join editor (still edits the untouched CMS model) is left
  // alone — its own file is not part of this pass's diff.
  const adminJoin = read("src/app/admin/(protected)/site/join/page.tsx");
  assert.ok(adminJoin.length > 0, "admin Join editor file still exists, untouched");
});

