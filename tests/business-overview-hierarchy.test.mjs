// Business Overview Information-Hierarchy pass — the focused Overview
// audit found the generic Opportunities module (and its large Explore
// Opportunities / Tell Findmi What You Need empty state) rendering BEFORE
// the business's own operational state (Happening Now, Needs Attention,
// Coming Up, pending Invitation/Order tiles, Performance). This pass is
// pure JSX reordering inside BusinessHome.tsx: the same sections, same
// conditions, same data, same props, only moved so Opportunities now
// renders after Performance instead of right after Quick Actions. No
// query, metric, entitlement, or business-logic change.
//
// This suite follows this repo's own established convention for this
// kind of pass (see journal-section-carousel.test.mjs, business-dashboard
// coverage in opportunity-goals.test.mjs): no JSX rendering harness exists
// in this plain node:test suite, so the render order is proven via
// source-level static guards (indexOf position comparisons) rather than
// component mounting. No network, no database. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HOME = readFileSync("src/app/(public)/account/business/[id]/v2/BusinessHome.tsx", "utf8");

function indexOfAll(markers) {
  return markers.map((m) => {
    const i = HOME.indexOf(m);
    assert.ok(i !== -1, `expected to find marker: ${m}`);
    return i;
  });
}

// ── 1/2. Greeting first, Quick Actions near the top ───────────────────────
test("Greeting renders first, before any operational section", () => {
  const [greeting, quickActions, happeningNow] = indexOfAll(['<Greeting />', 'aria-label="Quick actions"', 'aria-labelledby="happening-now"']);
  assert.ok(greeting < quickActions, "Greeting must render before Quick Actions");
  assert.ok(quickActions < happeningNow, "Quick Actions must render before the first operational section");
});

test("Quick Actions row is unchanged: AddToPresence chip + Product action, no new actions added", () => {
  const navStart = HOME.indexOf('aria-label="Quick actions"');
  const navEnd = HOME.indexOf("</nav>", navStart);
  const nav = HOME.slice(navStart, navEnd);
  assert.match(nav, /<AddToPresence basePath=\{basePath\} businessId=\{businessId\} variant="chip" \/>/);
  assert.match(nav, /<QuickAction href=\{`\$\{basePath\}\?tab=products&compose=1`\}/);
  // Explicitly NOT added in this pass (Section 4/5 of the task).
  assert.doesNotMatch(nav, /View Public Profile|tab=qr|\/account\/messages/i, "no new quick actions were added in this presentation-only pass");
});

// ── 3. HomeOpportunities no longer renders before operational sections ───
test("HomeOpportunities (generic Opportunities module) no longer renders before the business's own operational sections", () => {
  const opportunities = HOME.indexOf("<HomeOpportunities");
  const happeningNow = HOME.indexOf('aria-labelledby="happening-now"');
  const needsAttention = HOME.indexOf('needsAttention.length > 0 &&');
  const comingUp = HOME.indexOf('aria-labelledby="coming-up"');
  const invitationOrderTiles = HOME.indexOf("pendingInvitationCount > 0 || newOrderCount > 0");
  const performance = HOME.indexOf('aria-labelledby="performance-snapshot"');
  for (const [label, i] of [
    ["Happening Now", happeningNow],
    ["Needs Attention", needsAttention],
    ["Coming Up", comingUp],
    ["Invitation/Order tiles", invitationOrderTiles],
    ["Performance", performance],
  ]) {
    assert.ok(i < opportunities, `${label} must render before Opportunities (was: Opportunities first)`);
  }
});

// ── 4/5/6/7/8/9. Exact operational render order ───────────────────────────
test("the full Overview operational render order is exactly: Happening Now, Needs Attention, Coming Up, Invitation/Order tiles, Performance, Opportunities, Findmi Link", () => {
  const order = indexOfAll([
    'aria-label="Quick actions"',
    'aria-labelledby="happening-now"',
    'needsAttention.length > 0 &&',
    'aria-labelledby="coming-up"',
    "pendingInvitationCount > 0 || newOrderCount > 0",
    'aria-labelledby="performance-snapshot"',
    "<HomeOpportunities",
    'aria-labelledby="findmi-link"',
  ]);
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i - 1] < order[i], `expected marker #${i} to come after marker #${i - 1} (actual positions: ${order.join(", ")})`);
  }
});

// ── 10. Existing conditional rendering behavior is unchanged ──────────────
test("every section's own conditional guard is byte-identical to before this pass", () => {
  // Happening Now: still gated on liveNow.length, never rendered empty.
  assert.match(HOME, /\{liveNow\.length > 0 && \(\s*\n\s*<section aria-labelledby="happening-now">/);
  // Needs Attention: still gated on needsAttention.length, never rendered empty.
  assert.match(HOME, /\{needsAttention\.length > 0 && \(\s*\n\s*<section aria-labelledby="needs-attention">/);
  // Coming Up: still unconditional (always renders, with its own internal
  // empty-state text) -- this pass must not add a placeholder/empty card
  // for Happening Now or Needs Attention to match it.
  assert.match(HOME, /<section aria-labelledby="coming-up">/);
  assert.doesNotMatch(HOME, /liveNow\.length === 0|needsAttention\.length === 0/, "must not add empty-state branches for Happening Now/Needs Attention");
  // Invitation/Order tiles: still gated on the same OR condition.
  assert.match(HOME, /\{\(pendingInvitationCount > 0 \|\| newOrderCount > 0\) && \(/);
  // Performance: still gated on `metrics` (null for an unloaded/absent case).
  assert.match(HOME, /\{metrics && \(\s*\n\s*<section aria-labelledby="performance-snapshot">/);
  // Opportunities: still an unconditional call into HomeOpportunities,
  // which internally decides its own recommendation-vs-empty-state branch
  // (untouched -- see the opportunity-goals.test.mjs suite for that).
  assert.match(HOME, /<HomeOpportunities basePath=\{basePath\} items=\{opportunityItems\} \/>/);
});

test("Coming Up's later-today + upcoming composition and cap are unchanged", () => {
  assert.match(HOME, /const comingUp = \[\.\.\.laterToday, \.\.\.upcomingAppearances\]\.slice\(0, 4\);/);
});

test("Performance's metric set, Free/Pro trend gating, and link label are unchanged", () => {
  const perfStart = HOME.indexOf('aria-labelledby="performance-snapshot"');
  const perfEnd = HOME.indexOf("</section>", perfStart);
  const perf = HOME.slice(perfStart, perfEnd);
  assert.match(perf, /<MetricTile label="Profile Views" metric=\{metrics\.profileViews\} pro=\{pro\} \/>/);
  assert.match(perf, /<MetricTile label="Actions" metric=\{metrics\.actionsTaken\} pro=\{pro\} \/>/);
  assert.match(perf, /<MetricTile label="QR Scans" metric=\{metrics\.qrScans\} pro=\{pro\} \/>/);
  assert.match(perf, /<MetricTile label="Followers" metric=\{\{ value: metrics\.followers, changeLabel: null \}\} pro=\{pro\} \/>/);
  assert.match(perf, /linkLabel=\{pro \? "View Performance" : "Unlock Full Analytics"\}/);
});

test("MetricTile still suppresses changeLabel (trend) for a non-Pro business, unchanged", () => {
  assert.match(HOME, /const change = pro \? metric\.changeLabel : null;/);
});

// ── 11. No data-fetching or entitlement logic changed ─────────────────────
test("static guard: no new props, data fetching, or entitlement checks were introduced", () => {
  const propsMatch = HOME.match(/export default function BusinessHome\(\{([\s\S]*?)\}:\s*\{/);
  assert.ok(propsMatch, "expected BusinessHome's destructured props list");
  const propNames = ["basePath", "businessId", "businessName", "pro", "todayAppearances", "upcomingAppearances", "needsAttention", "metrics", "metricsRangeLabel", "pendingInvitationCount", "newOrderCount", "businessHandle", "updateHandleAction", "opportunityItems"];
  for (const name of propNames) assert.match(propsMatch[1], new RegExp(`\\b${name}\\b`), `expected existing prop "${name}" to still be destructured`);
  // This is a client-presentation component -- it must still receive
  // every value as a prop rather than fetching anything itself.
  assert.doesNotMatch(HOME, /\bawait\b|\bfetch\(|\bsupabase\b|createClient/i, "BusinessHome must remain a pure presentation component with no data fetching of its own");
  assert.doesNotMatch(HOME, /isBusinessPro|plan_tier|plan_expires_at/, "no entitlement logic was added -- `pro` is still received as a plain boolean prop");
});
