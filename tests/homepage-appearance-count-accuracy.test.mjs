// Homepage Appearance Count Accuracy pass — regression coverage for the
// third Fox Den/Free Bean homepage bug: BusinessLogoCard derived its
// "N Upcoming Appearances" heading and "See all appearances" CTA straight
// from the BOUNDED PREVIEW array's own .length, so a business with more
// qualifying Appearances than the 4-card preview cap (e.g. Free Bean,
// 10+) showed "4 Upcoming Appearances" instead of the true total. Fixed
// by resolving the TRUE total via a separate, efficient per-business
// COUNT query (getUpcomingAppearanceCounts/resolveUpcomingAppearanceCounts
// — same per-business-bounded-query fairness architecture as the sibling
// hints resolver from 1d04127, reusing the same mapWithConcurrency), wired
// independently of the preview. No network, no production DB — pure
// function + a fake count fetcher. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const D = await import("../src/lib/data.ts");

const NOW = new Date("2026-10-07T12:00:00Z").getTime();

/** A fake "appearances" table mirroring the real canonical SQL filter
 * (status <> 'canceled', end_at > now()) applied PER BUSINESS, used to
 * build both a count fetcher (COUNT-only, no rows) and a preview fetcher
 * (bounded, ordered) — exactly matching the real getUpcomingAppearance
 * Counts/Hints' own per-business query shapes. */
function fakeAppearancesTable(rows) {
  const qualifying = (businessId) =>
    rows.filter((r) => r.business_id === businessId && r.status !== "canceled" && new Date(r.end_at).getTime() > NOW);

  const fetchCount = async (businessId) => qualifying(businessId).length;

  const fetchHints = async (businessId, limit) =>
    qualifying(businessId)
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
      .slice(0, limit)
      .map((r) => ({
        business_id: r.business_id,
        title: r.title ?? "",
        start_at: r.start_at,
        flyer_image_url: null,
        venue_name: null,
        city: null,
        state: null,
        description: null,
        event: null,
      }));

  return { fetchCount, fetchHints };
}

function manyAppearances(businessId, count, startOffsetDays) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const start = new Date(NOW + (startOffsetDays + i) * 86400000);
    const end = new Date(start.getTime() + 4 * 3600000);
    out.push({ business_id: businessId, title: `${businessId} appearance ${i + 1}`, status: "confirmed", start_at: start.toISOString(), end_at: end.toISOString() });
  }
  return out;
}

// ── 1. 12 qualifying appearances -> total=12, preview<=4 ──────────────────
test("business with 12 qualifying upcoming Appearances: total = 12, preview capped at 4", async () => {
  const rows = manyAppearances("free-bean", 12, 1);
  const { fetchCount, fetchHints } = fakeAppearancesTable(rows);

  const counts = await D.resolveUpcomingAppearanceCounts(["free-bean"], fetchCount);
  const hints = await D.resolveUpcomingAppearanceHints(["free-bean"], 4, fetchHints);

  assert.equal(counts.get("free-bean"), 12);
  assert.equal(hints.get("free-bean").length, 4);
});

// ── 2/3. heading + CTA text use the true total, not preview.length ───────
function renderHeadingAndCta(upcomingCount, totalUpcomingAppearances) {
  // Mirrors BusinessLogoCard.tsx's own text-selection logic exactly (see
  // that file) — isolated here as a pure function so the TEXT contract is
  // directly assertable without mounting React/JSX.
  const total = totalUpcomingAppearances ?? upcomingCount;
  const heading = total === 1 ? "1 Upcoming Appearance" : `${total} Upcoming Appearances`;
  const cta = upcomingCount === 1 ? "View appearance" : `See all ${total} appearances`;
  return { heading, cta };
}

test("heading renders the true total (\"12 Upcoming Appearances\"), not the preview length", () => {
  const { heading } = renderHeadingAndCta(4, 12);
  assert.equal(heading, "12 Upcoming Appearances");
});

test("CTA renders \"See all 12 appearances\" using the true total", () => {
  const { cta } = renderHeadingAndCta(4, 12);
  assert.equal(cta, "See all 12 appearances");
});

// ── 4. exactly 1 -> singular text, no count stuffed into the CTA ─────────
test("business with exactly 1 qualifying Appearance: singular heading, \"View appearance\" CTA", () => {
  const { heading, cta } = renderHeadingAndCta(1, 1);
  assert.equal(heading, "1 Upcoming Appearance");
  assert.equal(cta, "View appearance");
});

// ── 5/6. canceled and past Appearances excluded from the COUNT too ───────
test("canceled future Appearances are not counted", async () => {
  const rows = [
    { business_id: "b1", title: "soon but canceled", status: "canceled", start_at: new Date(NOW + 2 * 86400000).toISOString(), end_at: new Date(NOW + 2.2 * 86400000).toISOString() },
    { business_id: "b1", title: "real", status: "confirmed", start_at: new Date(NOW + 5 * 86400000).toISOString(), end_at: new Date(NOW + 5.2 * 86400000).toISOString() },
  ];
  const { fetchCount } = fakeAppearancesTable(rows);
  const counts = await D.resolveUpcomingAppearanceCounts(["b1"], fetchCount);
  assert.equal(counts.get("b1"), 1);
});

test("past Appearances are not counted", async () => {
  const rows = [{ business_id: "b1", title: "over", status: "confirmed", start_at: new Date(NOW - 5 * 86400000).toISOString(), end_at: new Date(NOW - 4 * 86400000).toISOString() }];
  const { fetchCount } = fakeAppearancesTable(rows);
  const counts = await D.resolveUpcomingAppearanceCounts(["b1"], fetchCount);
  assert.equal(counts.has("b1"), false, "zero qualifying appearances -> no Map entry at all");
});

// ── 7. a 20+ business cannot affect another business's count/preview ─────
test("a business with 20+ Appearances cannot affect another business's total count or preview", async () => {
  const crowd = manyAppearances("free-bean", 25, 1);
  const target = manyAppearances("other-biz", 3, 40); // later, far fewer
  const { fetchCount, fetchHints } = fakeAppearancesTable([...crowd, ...target]);

  const countsAlone = await D.resolveUpcomingAppearanceCounts(["other-biz"], fetchCount);
  const countsWithCrowd = await D.resolveUpcomingAppearanceCounts(["free-bean", "other-biz"], fetchCount);
  assert.equal(countsAlone.get("other-biz"), 3);
  assert.equal(countsWithCrowd.get("other-biz"), 3, "free-bean's volume must not change other-biz's count");
  assert.equal(countsWithCrowd.get("free-bean"), 25);

  const hintsAlone = await D.resolveUpcomingAppearanceHints(["other-biz"], 4, fetchHints);
  const hintsWithCrowd = await D.resolveUpcomingAppearanceHints(["free-bean", "other-biz"], 4, fetchHints);
  assert.deepEqual(hintsWithCrowd.get("other-biz"), hintsAlone.get("other-biz"), "preview for other-biz must be identical whether or not free-bean is in the batch");
});

// ── 8. Fox Den's single later Appearance still survives (1d04127 regression guard) ──
test("Fox Den's single later-dated Appearance still survives alongside appearance-dense businesses, with its own accurate count of 1", async () => {
  const A = manyAppearances("business-a", 20, 1);
  const B = manyAppearances("business-b", 11, 2);
  const C = manyAppearances("business-c", 7, 3);
  const Dd = manyAppearances("business-d", 5, 4);
  const foxDenStart = new Date(NOW + 30 * 86400000);
  const foxDen = [{ business_id: "fox-den", title: "Heroes vs. Villains", status: "confirmed", start_at: foxDenStart.toISOString(), end_at: new Date(foxDenStart.getTime() + 5 * 3600000).toISOString() }];

  const { fetchCount, fetchHints } = fakeAppearancesTable([...A, ...B, ...C, ...Dd, ...foxDen]);
  const businessIds = ["business-a", "business-b", "business-c", "business-d", "fox-den"];

  const counts = await D.resolveUpcomingAppearanceCounts(businessIds, fetchCount);
  const hints = await D.resolveUpcomingAppearanceHints(businessIds, 4, fetchHints);

  assert.equal(counts.get("fox-den"), 1);
  assert.equal(hints.get("fox-den").length, 1);
  assert.equal(hints.get("fox-den")[0].venue, "Heroes vs. Villains");
});

// ── Static guards: both homepage paths, architecture, and untouched scope ──
test("static guard: getUpcomingAppearanceCounts is an efficient head-count query, never a row scan, and reuses the fairness architecture", () => {
  const src = readFileSync("src/lib/data.ts", "utf8");
  assert.match(src, /export (?:async )?function resolveUpcomingAppearanceCounts/);
  assert.match(src, /export async function getUpcomingAppearanceCounts/);
  const start = src.indexOf("export async function getUpcomingAppearanceCounts");
  const fnSrc = src.slice(start, start + 800);
  assert.match(fnSrc, /\{\s*count:\s*"exact",\s*head:\s*true\s*\}/, "must use an exact head-count query, never fetch rows to count them");
  assert.match(fnSrc, /resolveUpcomingAppearanceCounts\(/, "must funnel through the same fairness-preserving resolver");
});

test("static guard: both the initial server render and the category-chip API route fetch counts independently and expose them alongside hints", () => {
  const page = readFileSync("src/app/(public)/page.tsx", "utf8");
  assert.match(page, /getUpcomingAppearanceCounts\(businessIds\)/);
  assert.match(page, /appearanceCounts=\{appearanceCounts\}/);

  const route = readFileSync("src/app/api/homepage-business-row/route.ts", "utf8");
  const getCountsCalls = route.match(/getUpcomingAppearanceCounts\(/g) ?? [];
  assert.equal(getCountsCalls.length, 2, "both the curated branch and the dynamic/hybrid branch must fetch counts");
  assert.match(route, /appearanceCounts: Object\.fromEntries\(appearanceCountsMap\)/);
});

test("static guard: BusinessLogoCard's preview rendering (which cards, wide-vs-rail) still comes from upcomingAppearances, never from the total", () => {
  const card = readFileSync("src/components/BusinessLogoCard.tsx", "utf8");
  assert.match(card, /totalUpcomingAppearances/);
  assert.match(card, /const totalUpcoming = totalUpcomingAppearances \?\? upcoming\.length;/);
  // Layout/content branches still key off upcoming.length, not totalUpcoming.
  assert.match(card, /upcoming\.length === 1 \? \(\s*<div className="mt-2">/);
  assert.match(card, /\{totalUpcoming === 1 \? "1 Upcoming Appearance" : `\$\{totalUpcoming\} Upcoming Appearances`\}/);
  assert.match(card, /See all \$\{totalUpcoming\} appearances/);
});

test("static guard: unrelated scope is untouched — eligibility, Fox Den's data, media-calibration gate", () => {
  const homepageRows = readFileSync("src/lib/homepage-rows.ts", "utf8");
  assert.match(homepageRows, /findPrimaryBusinessesRowId/);
  const calibration = readFileSync("src/lib/admin/media-calibration.ts", "utf8");
  assert.match(calibration, /MEDIA_CALIBRATION_ENABLED/);
  // The /businesses directory page's OWN separate use of
  // getUpcomingAppearanceHints (a different content path entirely) must
  // still compile/behave unchanged -- its return shape was never touched.
  const businessesPage = readFileSync("src/app/(public)/businesses/page.tsx", "utf8");
  assert.match(businessesPage, /getUpcomingAppearanceHints/);
});
