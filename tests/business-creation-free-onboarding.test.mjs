// Business Creation UX Cleanup pass — Findmi Business Pages are free
// right now, so Add A Business no longer asks the visitor to choose a
// plan: the former Free/Pro radio, $20/month Pro, $49/month Managed Pro,
// annual pricing, "Want more?"/"Choose a paid plan after creation", and
// the manual "Have a Pro Invite Code?" entry are all gone from the
// creation UI. Subscription/billing infrastructure (Stripe, /upgrade/pro,
// plan_choice handling in createMemberBusiness, invite redemption) is
// completely untouched — this is a front-end onboarding change only.
// Source-level guards over the real JSX/server action (no rendering
// harness, no database), same convention as every other test in this
// suite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
// Strips /* */ and {/* */} comments so a doc comment mentioning a
// removed phrase (to explain the removal) never falsely trips a
// doesNotMatch assertion against the rendered page.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const NEW_PAGE_PATH = "src/app/(public)/account/business/new/page.tsx";
const NEW_PAGE = code(read(NEW_PAGE_PATH));
const BIZ_GEO = code(read("src/components/BusinessGeographyFields.tsx"));
const CREATE = read("src/app/(public)/account/business/actions.ts");
const ENTITLEMENTS = read("src/lib/entitlements.ts");
const LOCATION_ACTIONS = read("src/app/(public)/account/business/location-actions.ts");
const QR_MANAGER_ACTIONS = read("src/app/(public)/account/business/qr-manager-actions.ts");
const PUBLIC_VIEW = read("src/app/(public)/business/[slug]/BusinessPublicView.tsx");

// Isolate the Free-value-section render (the hasInvite ternary's "else"
// branch) so "Pro"/"Managed Pro" absence is checked against the actual
// normal-creation UI, not the separate, legitimate hasInvite banner.
const freeSectionStart = NEW_PAGE.indexOf('<div className="relative flex flex-col gap-2.5 rounded-3xl');
const freeSectionEnd = NEW_PAGE.indexOf("Have a Referral Code?");
const FREE_SECTION = NEW_PAGE.slice(freeSectionStart, freeSectionEnd);

test("1. Business creation never asks the visitor to select Free vs paid — no plan_choice field anywhere on the page", () => {
  assert.doesNotMatch(NEW_PAGE, /name="plan_choice"/);
  assert.doesNotMatch(NEW_PAGE, /type="radio"/);
});

test("2/3. Pro and Managed Pro are absent from the Free value section (the normal creation UI)", () => {
  assert.ok(freeSectionStart > -1 && freeSectionEnd > freeSectionStart, "Free section located");
  assert.doesNotMatch(FREE_SECTION, /\bPro\b/);
  assert.doesNotMatch(FREE_SECTION, /Managed Pro/);
});

test("4/5/6. $20/month, $49/month and annual paid pricing are absent from the page", () => {
  assert.doesNotMatch(NEW_PAGE, /\$20\/month/);
  assert.doesNotMatch(NEW_PAGE, /\$49\/month/);
  assert.doesNotMatch(NEW_PAGE, /annual/i);
  assert.doesNotMatch(NEW_PAGE, /Want more\?/);
  assert.doesNotMatch(NEW_PAGE, /Choose a paid plan after creation/);
  assert.doesNotMatch(NEW_PAGE, /Choose your plan/);
});

test("7/8. Free/$0 and 'Forever free' remain visible in a two-column header", () => {
  assert.match(FREE_SECTION, /Get Started Free/);
  assert.match(FREE_SECTION, /\$0/);
  assert.match(FREE_SECTION, /Forever free/);
  assert.match(FREE_SECTION, /Everything you need to show up on Findmi\./);
  assert.match(FREE_SECTION, /items-end text-right/);
  assert.match(FREE_SECTION, /Free\. No trial\. No credit card\./);
});

test("9. Every displayed Free benefit corresponds to a real, currently-Free capability — none claim a genuinely Pro-only feature", () => {
  for (const bullet of [
    "Your complete Business Page",
    "Products, photos, links &amp; contact info",
    "Events &amp; your upcoming schedule",
    "Locations, stockists &amp; where to find you",
    "Moments from your real-world activity",
    "Findmi search &amp; discovery",
  ]) {
    assert.ok(FREE_SECTION.includes(bullet), `benefit present: ${bullet}`);
  }
  // Business Page, Links & Contact, Products, Appearances (schedule) and
  // the FindMi handle are explicitly no longer Pro-gated.
  assert.match(
    CREATE,
    /Links\/Gallery\/Products\/the FindMi handle are no\s*\* longer Pro-only \(locked rule now matches Appearances\/Locations/
  );
  // Our Locations / Find Us At (location-actions.ts) and QR creation
  // (qr-manager-actions.ts) never gate on isBusinessPro.
  assert.doesNotMatch(LOCATION_ACTIONS, /isBusinessPro/);
  assert.doesNotMatch(QR_MANAGER_ACTIONS, /isBusinessPro/);
  // Weak/internal/SaaS marketing language is never used.
  for (const weak of [
    "Business profile",
    "Unlimited relevant markets",
    "Access to platform features",
    "growth tools",
    "AI-powered",
    "boost engagement",
    "maximize reach",
    "unlock your potential",
  ]) {
    assert.doesNotMatch(FREE_SECTION, new RegExp(weak, "i"), `no weak marketing phrase: ${weak}`);
  }
  // Genuinely Pro-only features are never claimed as Free benefits here.
  assert.doesNotMatch(FREE_SECTION, /Performance analytics|Discovery source|QR attribution|Follower insights|Customer Inquiries/);
  assert.match(PUBLIC_VIEW, /const canInquire = pro && business\.accepts_inquiries/, "Customer Inquiries really is Pro-only — confirms it's correctly excluded above");
});

test("10. Exact Place is gone from Business creation — the CanonicalGeographyPicker disclosure was redundant right after City/State", () => {
  assert.doesNotMatch(BIZ_GEO, /CanonicalGeographyPicker/);
  assert.doesNotMatch(BIZ_GEO, /Set an exact place/);
  assert.doesNotMatch(BIZ_GEO, /name="explicit_geo_key"/);
});

test("11. No Findmi Market/Area selector remains on Business creation — createMemberBusiness's own canonical-geography auto-assignment replaces it", () => {
  assert.doesNotMatch(BIZ_GEO, /Findmi area/);
  assert.doesNotMatch(BIZ_GEO, /Choose an area/);
  assert.doesNotMatch(BIZ_GEO, /markets:/);
  assert.doesNotMatch(NEW_PAGE, /getActiveMarkets\(\)/);
  // The server action's own best-effort Market auto-assignment from
  // canonical geography (untouched) is still exactly how a Market gets
  // attached now that the form never submits market_id/requested_market_text.
  assert.match(CREATE, /if \(!effectiveMarketId && geo\.marketSuggestion\?\.type === "findmi"\)/);
});

test("12. Legitimate factual Business fields remain: name, category, city/state, website, Instagram, short description", () => {
  for (const name of ["name", "category_id", "website_url", "instagram_url", "short_description"]) {
    assert.match(NEW_PAGE, new RegExp(`name="${name}"`), `field present: ${name}`);
  }
  for (const name of ["city", "state"]) {
    assert.match(BIZ_GEO, new RegExp(`name="${name}"`), `field present: ${name}`);
  }
});

test("13. The authorization confirmation remains required, client- and server-side", () => {
  assert.match(NEW_PAGE, /name="authorized"[\s\S]{0,40}required/);
  assert.match(NEW_PAGE, /I confirm that I am authorized to create and manage this business on Findmi\./);
  assert.match(CREATE, /if \(!authorized\) \{\s*fail\("Please confirm you're authorized to create and manage this business\."\);/);
});

test("14. createMemberBusiness still establishes the same ownership/membership via the unchanged RPC, with no plan_choice-driven branching removed", () => {
  assert.match(CREATE, /admin\.rpc\("create_owned_business"/);
  assert.match(CREATE, /const planChoiceRaw = brandOnboarding \? null : str\(formData, "plan_choice"\);/, "server still tolerates a plan_choice value — just never submitted by this form anymore");
  assert.match(CREATE, /if \(planChoiceRaw === "pro"\) \{/, "Pro-checkout branch untouched, simply unreachable from the new UI");
});

test("15. Guest-First Creation pass — every normal creation now lands on Account Home (never the Business workspace/profile editor mid-page)", () => {
  assert.match(CREATE, /redirect\(`\/account\?created=\$\{businessId\}`\);/);
  assert.doesNotMatch(CREATE, /redirect\(`\/account\/business\/\$\{businessId\}\?created=1`\);/);
});

test("16/17. Subscription/billing infrastructure and existing entitlements are untouched", () => {
  assert.match(CREATE, /createBusinessProCheckoutSession/);
  assert.match(CREATE, /createRecurringSubscriptionCheckoutSession|isRecurringCheckoutConfigured/);
  assert.match(ENTITLEMENTS, /export function isBusinessPro\(/);
  assert.match(ENTITLEMENTS, /export function isPlanTierPro\(/);
});

test("18. Add A Business and For Business (/join/business) don't contradict each other: both ultimately lead to the same plan-free creation form", () => {
  const joinBusiness = read("src/app/(public)/join/business/page.tsx");
  assert.match(joinBusiness, /freeCtaHref = ref \? `\/account\/business\/new\?ref=\$\{encodeURIComponent\(ref\)\}` : "\/account\/business\/new"/);
  // The dominant/first CTA on /join/business is the Free one, not Pro.
  assert.match(joinBusiness, /Get Started Free/);
});

test("19. The manual 'Have a Pro Invite Code?' control is gone from normal creation; the separate ?invite=CODE redemption hand-off is untouched", () => {
  assert.doesNotMatch(NEW_PAGE, /Have a Pro Invite Code\?/);
  assert.doesNotMatch(NEW_PAGE, /Enter Invite Code/);
  // The hasInvite banner (reached via /redeem/[code]?...) is unaffected.
  assert.match(read(NEW_PAGE_PATH), /Your Findmi Pro invite is ready\./);
  assert.match(CREATE, /if \(inviteRaw\) \{\s*redirect\(`\/redeem\/\$\{encodeURIComponent\(inviteRaw\)\}\?business=\$\{businessId\}`\);/);
});

test("20. The Referral Code field remains, visually secondary (collapsed by default) — it serves independent attribution, not just paid-plan upsell", () => {
  assert.match(NEW_PAGE, /name="ref"/);
  assert.match(NEW_PAGE, /Have a Referral Code\?/);
  assert.match(NEW_PAGE, /<details className="group mt-1" open=\{Boolean\(ref\)\}>/, "collapsed unless a code was already carried through a link");
  assert.match(CREATE, /attributeReferral\(admin, businessId, referralCodeRaw/, "attribution happens regardless of plan — never gated on a paid conversion");
});
