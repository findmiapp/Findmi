// Account/Billing Copy Truth Pass — three narrow owner/admin-facing
// copy corrections identified by a business-owner product audit:
//   1. The Business Manager's "Customer Inquiries" nav label implied an
//      inbox; the surface is actually settings-only configuration.
//   2. Admin's "Plan Expires" helper text claimed the field is "not
//      currently enforced anywhere" — false, isBusinessPro() enforces it.
//   3. /upgrade/pro's Pro feature list advertised Enhanced Links &
//      Contact, Multi-image Gallery, and Vanity Findmi URL as
//      Pro-exclusive — all three are Free today.
// This is a copy-only pass: no entitlement logic, no database schema, no
// Stripe config changed. This suite follows this repo's own established
// convention for this kind of pass (see journal-section-carousel.test.mjs
// and others): no JSX rendering harness exists in this plain node:test
// suite, so behavior is proven via source-level static guards. No
// network, no database. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MORE_MENU = readFileSync("src/app/(public)/account/business/[id]/v2/MoreMenu.tsx", "utf8");
const BUSINESS_PAGE = readFileSync("src/app/(public)/account/business/[id]/page.tsx", "utf8");
const ADMIN_BUSINESS_FORM = readFileSync("src/app/admin/(protected)/businesses/BusinessForm.tsx", "utf8");
const ADMIN_BUSINESS_DETAIL = readFileSync("src/app/admin/(protected)/businesses/[id]/page.tsx", "utf8");
const PLANS = readFileSync("src/lib/commerce/plans.ts", "utf8");
const ENTITLEMENTS = readFileSync("src/lib/entitlements.ts", "utf8");
const INQUIRIES_ACTIONS = readFileSync("src/app/(public)/account/business/inquiries-actions.ts", "utf8");

// ── 1. The Business Manager no longer labels the settings-only surface ───
// ── as though it were the inquiry inbox itself. ──────────────────────────
test("the More menu's inquiry-settings nav entry is labeled accurately, not as an inbox", () => {
  assert.match(MORE_MENU, /label: "Inquiry Settings"/, "the ?tab=inquiries nav entry must describe itself as settings, not as an inbox destination");
  assert.doesNotMatch(MORE_MENU, /label: "Customer Inquiries"/, "the misleading inbox-sounding label must be gone");
  // The real inbox destination, right alongside it, is untouched.
  assert.match(MORE_MENU, /href: "\/account\/messages", label: "Inbox"/);
});

test("the Business Overview status row for inquiry settings is labeled accurately", () => {
  assert.match(BUSINESS_PAGE, /<Row\s*\n\s*label="Inquiry Settings"/, "the Overview panel's status row must match the corrected label");
  assert.doesNotMatch(BUSINESS_PAGE, /label="Customer Inquiries"/, "no remaining nav/status label should still say the misleading name");
});

test("the ?tab=inquiries surface still links out to the real Inbox at /account/messages, unchanged", () => {
  const tabStart = BUSINESS_PAGE.indexOf('activeTab === "inquiries"');
  assert.ok(tabStart !== -1, "expected the inquiries tab render block");
  const tabBlock = BUSINESS_PAGE.slice(tabStart, tabStart + 2000);
  assert.match(tabBlock, /href="\/account\/messages"/, "must still point the owner at the real Inbox for actual conversations");
  assert.match(tabBlock, /View customer conversations in your Inbox/);
});

// ── 2. /account/messages itself (the real unified Inbox) was not touched ─
test("the unified Inbox route still exists and was not touched by this pass", () => {
  const messages = readFileSync("src/app/(public)/account/messages/page.tsx", "utf8");
  assert.match(messages, /listConversationsForUser|getPendingInvitationsForBusiness|getApplicationsForBusiness/, "the real Inbox data-loading code must still be present, unmodified by a copy-only pass");
});

test("legacy /account/inquiries* redirect stubs still exist and still redirect to /account/messages", () => {
  const legacy = readFileSync("src/app/(public)/account/inquiries/page.tsx", "utf8");
  assert.match(legacy, /redirect\("\/account\/messages"\)/, "the legacy stub must keep redirecting exactly as before -- this pass must not remove or alter it");
});

// ── 3. The admin Plan Expires helper no longer claims unenforced. ────────
test("admin Plan Expires helper text no longer falsely claims the field is unenforced", () => {
  for (const [name, src] of [["BusinessForm.tsx", ADMIN_BUSINESS_FORM], ["businesses/[id]/page.tsx", ADMIN_BUSINESS_DETAIL]]) {
    assert.doesNotMatch(src, /not currently enforced/i, `${name} must not still claim plan_expires_at is unenforced`);
    const hintMatch = src.match(/name="plan_expires_at"[\s\S]{0,200}?hint="([^"]+)"/);
    assert.ok(hintMatch, `${name}: expected to find the Plan Expires field's hint text`);
    const hint = hintMatch[1];
    assert.match(hint, /expired|expire/i, `${name}: corrected hint should explain the expiration actually takes effect`);
    assert.match(hint, /Pro/, `${name}: corrected hint should name what the expiration actually affects (Pro access)`);
  }
});

// ── 4. No entitlement logic changed -- isBusinessPro/isPlanExpirationActive ─
// ── keep their exact existing behavior; this pass is copy-only. ──────────
test("isBusinessPro's expiration enforcement logic is unchanged by this copy-only pass", () => {
  assert.match(ENTITLEMENTS, /export function isBusinessPro\(business: Pick<Business, "plan_tier" \| "plan_expires_at">\): boolean \{\s*\n\s*return isPlanTierPro\(business\.plan_tier\) && isPlanExpirationActive\(business\.plan_expires_at\);/);
  assert.match(ENTITLEMENTS, /function isPlanExpirationActive\(planExpiresAt: string \| null \| undefined\): boolean \{\s*\n\s*if \(!planExpiresAt\) return true;\s*\n\s*return new Date\(planExpiresAt\)\.getTime\(\) > Date\.now\(\);/, "null/undefined must still mean permanent Pro, and a past/now timestamp must still mean expired -- this pass only corrects copy describing this behavior, never the behavior itself");
});

test("the Pro gate on Customer Inquiries (server-enforced) is unchanged", () => {
  assert.match(INQUIRIES_ACTIONS, /isBusinessPro\(/, "setBusinessInquirySettings must still re-verify Pro server-side, exactly as before");
});

// ── 5. /upgrade/pro no longer advertises now-Free Gallery/Links/Vanity ───
// ── URL as Pro-exclusive. ─────────────────────────────────────────────────
test("the Pro plan's feature list no longer claims now-Free capabilities as Pro-exclusive", () => {
  const proPlanMatch = PLANS.match(/export const PRO_PLAN: PlanDefinition = \{[\s\S]*?\n\};/);
  assert.ok(proPlanMatch, "expected the PRO_PLAN definition");
  const proPlan = proPlanMatch[0];
  assert.doesNotMatch(proPlan, /Enhanced Links & Contact/, "Links & Contact was moved to Free and must not be claimed as a Pro benefit");
  assert.doesNotMatch(proPlan, /Multi-image Gallery/, "Gallery was moved to Free and must not be claimed as a Pro benefit");
  assert.doesNotMatch(proPlan, /Vanity Findmi URL/, "the vanity URL/handle was moved to Free and must not be claimed as a Pro benefit");
});

// ── 6. Every remaining Pro feature claim traces to real current gating. ──
test("every remaining PRO_PLAN feature claim corresponds to something genuinely Pro-gated in code today", () => {
  const proPlanBlockMatch = PLANS.match(/export const PRO_PLAN: PlanDefinition = \{[\s\S]*?\n\};/);
  assert.ok(proPlanBlockMatch, "expected the PRO_PLAN definition");
  const featuresMatch = proPlanBlockMatch[0].match(/features:\s*\[([\s\S]*?)\]/);
  assert.ok(featuresMatch, "expected PRO_PLAN's own features array");
  const features = featuresMatch[1];
  // Performance/Analytics claims -> the Performance tab is genuinely
  // Pro-gated (query-level, not just UI) -- confirmed directly against
  // the Business Manager's own tab-gating code.
  if (/Analytics|Performance|Discovery-source|Audience insights/.test(features)) {
    assert.match(BUSINESS_PAGE, /activeTab === "performance" && pro/, "Performance/Analytics claims require the Performance tab's query itself to be pro-gated, not just its UI");
  }
  // Customer Inquiries claim -> re-checked just above (server-enforced).
  assert.match(features, /Customer Inquiries/);
  assert.match(INQUIRIES_ACTIONS, /isBusinessPro\(/);
  // Nothing dormant/aspirational (recurring billing, Managed services,
  // Opportunities matching/credits, QR) is claimed as a current benefit.
  for (const forbidden of ["Managed", "Opportunity Credits", "QR & Tools", "Matching"]) {
    assert.doesNotMatch(features, new RegExp(forbidden), `"${forbidden}" must not be claimed as a current Pro benefit -- it is dormant/aspirational, not shipped`);
  }
  // QR stays in upcomingFeatures (never rendered as a current benefit by
  // UpgradePricingPicker.tsx), not in features -- unchanged by this pass.
  assert.match(PLANS, /upcomingFeatures: \["QR & Tools"\]/);
});

// ── No pricing/checkout/Stripe behavior touched by this pass ─────────────
test("static guard: no pricing or direct Stripe API usage was touched by this copy-only pass", () => {
  assert.doesNotMatch(PLANS, /\bcents:\s*(?!2000|14900|4900|39900)\d+/, "no price in cents should have changed from the existing four values");
  // The file's own header comment legitimately NAMES Stripe/checkout
  // modules in prose (pre-existing, unrelated to this pass) -- the real
  // guard is that this presentation-only module never calls a Stripe SDK
  // or imports a Stripe client directly.
  assert.doesNotMatch(PLANS, /from ["']stripe["']|new Stripe\(|stripe\.checkout|stripe\.prices|STRIPE_[A-Z_]*KEY/, "this file models commercial presentation only -- it must never call into the Stripe SDK directly");
});
