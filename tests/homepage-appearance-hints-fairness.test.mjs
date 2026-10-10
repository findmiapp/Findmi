// Homepage Appearance Hints Fairness pass — regression coverage for the
// fix to the second Fox Den LeatherCraft bug: getUpcomingAppearanceHints
// used one SHARED, GLOBAL query limit across every business in a row,
// ordered by start_at across all of them combined, so a high-volume
// business (e.g. 20 earlier appearances) could fully consume that budget
// before a lower-volume business's own later-but-real appearance was ever
// fetched. Fixed by giving each business its own independent, bounded
// query (resolveUpcomingAppearanceHints + AppearanceHintFetcher DI — same
// pattern as signed-image-urls.ts's Signer / media-variants-registry.ts's
// Fetcher) so correctness for one business never depends on any other
// business's appearance volume. No network, no production DB — pure
// function + a fake fetcher simulating the real SQL filter/order/limit.
// Run with `npm test`.
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

/** A fake "appearances" table: rows keyed by business_id, with realistic
 * start_at/end_at/status. Returns an AppearanceHintFetcher that mimics
 * the REAL SQL query's own behavior exactly (per-business .eq() scope,
 * status<>'canceled', end_at>now, order by start_at asc, then .limit) —
 * so this test proves the fetcher's CALLER (resolveUpcomingAppearanceHints)
 * is correct, given a fetcher that behaves like the real one. */
function fakeAppearancesTable(rows) {
  let calls = 0;
  const fetch = async (businessId, limit) => {
    calls++;
    return rows
      .filter((r) => r.business_id === businessId)
      .filter((r) => r.status !== "canceled")
      .filter((r) => new Date(r.end_at).getTime() > NOW)
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
  };
  return { fetch, callCount: () => calls };
}

/** Builds `count` future, non-canceled, qualifying appearances for one
 * business, starting `startOffsetDays` from NOW and spaced a day apart —
 * used to construct the 20/11/7/5 "high volume" businesses. */
function manyAppearances(businessId, count, startOffsetDays) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const start = new Date(NOW + (startOffsetDays + i) * 86400000);
    const end = new Date(start.getTime() + 4 * 3600000);
    rows.push({ business_id: businessId, title: `${businessId} appearance ${i + 1}`, status: "confirmed", start_at: start.toISOString(), end_at: end.toISOString() });
  }
  return rows;
}

// ── The exact production scenario ─────────────────────────────────────────
test("fairness: a business with a single LATER qualifying Appearance is never starved by businesses with many EARLIER ones (the Fox Den case)", async () => {
  const A = manyAppearances("business-a", 20, 1); // earliest: day+1 .. day+20
  const B = manyAppearances("business-b", 11, 2);
  const C = manyAppearances("business-c", 7, 3);
  const Dd = manyAppearances("business-d", 5, 4);
  // Fox Den: exactly 1 appearance, dated AFTER all 43 of the above.
  const foxDenStart = new Date(NOW + 30 * 86400000);
  const E = [
    {
      business_id: "fox-den",
      title: "Heroes vs. Villains",
      status: "confirmed",
      start_at: foxDenStart.toISOString(),
      end_at: new Date(foxDenStart.getTime() + 5 * 3600000).toISOString(),
    },
  ];

  const { fetch } = fakeAppearancesTable([...A, ...B, ...C, ...Dd, ...E]);
  const businessIds = ["business-a", "business-b", "business-c", "business-d", "fox-den"];
  const hints = await D.resolveUpcomingAppearanceHints(businessIds, 4, fetch);

  assert.ok(hints.has("fox-den"), "Fox Den must still receive its qualifying Appearance");
  assert.equal(hints.get("fox-den").length, 1);
  assert.equal(hints.get("fox-den")[0].venue, "Heroes vs. Villains");

  for (const id of ["business-a", "business-b", "business-c", "business-d"]) {
    assert.ok(hints.get(id).length <= 4, `${id} must never return more than 4 hints`);
  }
});

test("fairness invariant: a business's own result is identical whether queried alone or alongside a 20-appearance business", async () => {
  const A = manyAppearances("business-a", 20, 1);
  const foxDenStart = new Date(NOW + 30 * 86400000);
  const E = [{ business_id: "fox-den", title: "Heroes vs. Villains", status: "confirmed", start_at: foxDenStart.toISOString(), end_at: new Date(foxDenStart.getTime() + 5 * 3600000).toISOString() }];
  const { fetch } = fakeAppearancesTable([...A, ...E]);

  const alone = await D.resolveUpcomingAppearanceHints(["fox-den"], 4, fetch);
  const withCrowd = await D.resolveUpcomingAppearanceHints(["business-a", "fox-den"], 4, fetch);

  assert.deepEqual(withCrowd.get("fox-den"), alone.get("fox-den"), "correctness for fox-den must not depend on who else is in the batch");
});

// ── Public contract: status/date filter, ordering, per-business cap ───────
test("canceled appearances remain excluded even when otherwise the soonest", async () => {
  const rows = [
    { business_id: "b1", title: "Canceled but soon", status: "canceled", start_at: new Date(NOW + 1 * 86400000).toISOString(), end_at: new Date(NOW + 1.2 * 86400000).toISOString() },
    { business_id: "b1", title: "Real upcoming", status: "confirmed", start_at: new Date(NOW + 5 * 86400000).toISOString(), end_at: new Date(NOW + 5.2 * 86400000).toISOString() },
  ];
  const { fetch } = fakeAppearancesTable(rows);
  const hints = await D.resolveUpcomingAppearanceHints(["b1"], 4, fetch);
  assert.equal(hints.get("b1").length, 1);
  assert.equal(hints.get("b1")[0].venue, "Real upcoming");
});

test("past appearances remain excluded", async () => {
  const rows = [
    { business_id: "b1", title: "Already over", status: "confirmed", start_at: new Date(NOW - 5 * 86400000).toISOString(), end_at: new Date(NOW - 4 * 86400000).toISOString() },
  ];
  const { fetch } = fakeAppearancesTable(rows);
  const hints = await D.resolveUpcomingAppearanceHints(["b1"], 4, fetch);
  assert.equal(hints.has("b1"), false, "a business with only a past appearance gets no entry at all");
});

test("ordering remains chronological per business", async () => {
  const rows = manyAppearances("b1", 4, 1);
  // Shuffle the fixture input order to prove the OUTPUT order comes from
  // the fetcher's own ordering, not fixture insertion order.
  const shuffled = [rows[2], rows[0], rows[3], rows[1]];
  const { fetch } = fakeAppearancesTable(shuffled);
  const hints = await D.resolveUpcomingAppearanceHints(["b1"], 4, fetch);
  const startTimes = hints.get("b1").map((h) => new Date(h.startAt).getTime());
  const sorted = [...startTimes].sort((a, b) => a - b);
  assert.deepEqual(startTimes, sorted);
});

test("never more than limitPerBusiness hints, regardless of how many qualifying appearances exist", async () => {
  const rows = manyAppearances("b1", 20, 1);
  const { fetch } = fakeAppearancesTable(rows);
  const hints = await D.resolveUpcomingAppearanceHints(["b1"], 4, fetch);
  assert.equal(hints.get("b1").length, 4);
});

test("a business with no qualifying appearances gets no Map entry (not an empty array)", async () => {
  const { fetch } = fakeAppearancesTable([]);
  const hints = await D.resolveUpcomingAppearanceHints(["b1"], 4, fetch);
  assert.equal(hints.has("b1"), false);
});

// ── Hint structure: the full field set BusinessLogoCard expects ──────────
test("each hint carries the full field set BusinessLogoCard consumes (venue, startAt, href, imageUrl, venueName, city, state, description)", async () => {
  const rows = [{ business_id: "b1", title: "Real upcoming", status: "confirmed", start_at: new Date(NOW + 2 * 86400000).toISOString(), end_at: new Date(NOW + 2.2 * 86400000).toISOString() }];
  const { fetch } = fakeAppearancesTable(rows);
  const hints = await D.resolveUpcomingAppearanceHints(["b1"], 4, fetch);
  const hint = hints.get("b1")[0];
  for (const field of ["venue", "startAt", "href", "imageUrl", "venueName", "city", "state", "description"]) {
    assert.ok(field in hint, `hint is missing "${field}"`);
  }
});

// ── Query shape: each business gets its own bounded query, never a global one ──
test("one fetch call per unique business id, never a shared/global fetch", async () => {
  const rows = [...manyAppearances("business-a", 20, 1), ...manyAppearances("fox-den", 1, 30)];
  const { fetch, callCount } = fakeAppearancesTable(rows);
  await D.resolveUpcomingAppearanceHints(["business-a", "fox-den", "business-a"], 4, fetch); // duplicate id in input
  assert.equal(callCount(), 2, "exactly one call per UNIQUE business id — duplicates never double-query");
});

// ── Static guards: the shared-limit bug cannot silently come back ────────
test("static guard: the shared-limit starvation bug cannot come back — business-card activity is read exhaustively, never under a shared .limit()", () => {
  const src = readFileSync("src/lib/data.ts", "utf8");
  assert.doesNotMatch(src, /UPCOMING_APPEARANCE_FETCH_PER_BUSINESS/, "the old over-fetch-multiplier constant must be removed, not just unused");
  assert.doesNotMatch(src, /UPCOMING_APPEARANCE_CANDIDATE_ROWS/, "no fixed candidate cap a busy business could exhaust");
  assert.match(src, /export type AppearanceHintFetcher/);
  assert.match(src, /export (?:async )?function resolveUpcomingAppearanceHints/);

  // The batched read (one set-based query per table for the whole list)
  // is starvation-free only because every query pages to exhaustion —
  // a shared .limit() is exactly the Fox Den bug.
  const start = src.indexOf("async function getUpcomingBusinessActivity");
  assert.ok(start !== -1, "getUpcomingBusinessActivity exists");
  const fnSrc = src.slice(start, src.indexOf("export async function getUpcomingAppearanceSummaries", start));
  assert.doesNotMatch(fnSrc, /\.limit\(/, "no shared row limit anywhere in the batched read");
  const reads = fnSrc.match(/fetchAllPages</g) ?? [];
  assert.ok(reads.length >= 5, "every batched query pages through fetchAllPages");
  assert.match(fnSrc, /\.range\(from, to\)/);
});

test("static guard: both the initial server render and the category-chip API route still consume the same Map<string, NextAppearanceHint[]> contract via Object.fromEntries", () => {
  const page = readFileSync("src/app/(public)/page.tsx", "utf8");
  assert.match(page, /getUpcomingAppearanceSummaries\(businessIds\)/);
  assert.match(page, /Object\.fromEntries\(appearanceHintsMap\)/);

  const route = readFileSync("src/app/api/homepage-business-row/route.ts", "utf8");
  assert.match(route, /getUpcomingAppearanceSummaries\(/);
  assert.match(route, /Object\.fromEntries\(appearanceHintsMap\)/);
});

test("static guard: eligibility, Fox Den's own data, and BusinessLogoCard presentation are untouched by this pass", () => {
  const homepageRows = readFileSync("src/lib/homepage-rows.ts", "utf8");
  assert.match(homepageRows, /findPrimaryBusinessesRowId/, "the eligibility fix from the prior pass is still in place");
  const card = readFileSync("src/components/BusinessLogoCard.tsx", "utf8");
  assert.match(card, /const upcoming = upcomingAppearances \?\? \[\];/, "BusinessLogoCard's own logic is unchanged");
  const calibration = readFileSync("src/lib/admin/media-calibration.ts", "utf8");
  assert.match(calibration, /MEDIA_CALIBRATION_ENABLED/);
});
