// Canonical Entity Geography — IDEMPOTENCY CLOSURE. Post-Apply verification
// found that candidateRows() and the Apply write guard checked only
// geo_place_key/geo_state_key for null, never geo_zcta_key — so a
// ZCTA-only resolution (events/event_occurrences/businesses/locations)
// never actually left the candidate pool, even though it already carries a
// real, correct canonical key. This file proves the closure: the fix adds
// exactly one missing null-check for the four ZCTA-capable tables, leaves
// appearances (no geo_zcta_key column) untouched, and changes nothing else
// in this file (resolver precedence, hasAnyKey, Location-linked exclusion).
// Same no-database convention as the rest of this suite (CLAUDE.md §4):
// candidateRows()/runOne() build a chained Supabase query this suite can't
// execute without a live client, so the generated shape is verified by
// reading the real source — the same way this exact file's other guards
// are already verified in canonical-entity-geography.test.mjs (tests
// 12/13) and canonical-entity-geography-completion.test.mjs (test 25-27).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const BACKFILL = read("src/lib/geo/entity-geo-backfill.ts");

const candidateFn = BACKFILL.slice(BACKFILL.indexOf("async function candidateRows"), BACKFILL.indexOf("async function runOne"));
const applyBranch = BACKFILL.slice(BACKFILL.indexOf("if (apply &&"), BACKFILL.indexOf("return { table, scanned"));

// ── A/B/C/D. candidateRows() excludes a ZCTA-only row ────────────────────

test("A/B/C/D. candidateRows() now additionally requires geo_zcta_key IS NULL for every ZCTA-capable table (events, event_occurrences, businesses, locations) — driven by the existing HAS_ZCTA_COLUMN map, not new per-table branches", () => {
  assert.match(candidateFn, /if \(HAS_ZCTA_COLUMN\[table\]\) query = query\.is\("geo_zcta_key", null\);/);
  assert.doesNotMatch(candidateFn, /table === "events"|table === "businesses"|table === "locations"|table === "event_occurrences"/, "one shared check keyed off the existing map, not four special cases");
});

// ── E/F. Place-only / State-only rows were already excluded, still are ──

test("E/F. The pre-existing geo_place_key/geo_state_key null checks (which already excluded a Place-only or State-only row) are untouched — this fix adds a missing leg, it never loosens the other two", () => {
  assert.match(candidateFn, /\.is\("geo_place_key", null\)\s*\.is\("geo_state_key", null\)\s*\.not\("city", "is", null\)\s*\.not\("state", "is", null\);/);
});

// ── G/J. A fully-unresolved row remains eligible ─────────────────────────

test("G/J. A completely-null-canonical-geography row (and so, by the same logic, an existing partial/unresolved EMPTY_KEYS row) still matches every IS NULL condition and remains a candidate — the fix is exactly one additional null-check, nothing broader", () => {
  const isCalls = candidateFn.match(/\.is\("[a-z_]+", null\)/g) ?? [];
  assert.deepEqual(isCalls, ['.is("geo_place_key", null)', '.is("geo_state_key", null)', '.is("geo_zcta_key", null)', '.is("location_id", null)'], "exactly these four null-checks exist (two unconditional, two gated by HAS_ZCTA_COLUMN/HAS_LOCATION_ID_COLUMN) — a fully-null row satisfies all of them");
});

// ── H. Appearances keeps its pre-existing Place/State-only semantics ────

test("H. Appearances — which has no geo_zcta_key column — is untouched: HAS_ZCTA_COLUMN.appearances stays false, so the new check never applies to it; no geo_zcta_key concept is added for this table", () => {
  assert.match(BACKFILL, /const HAS_ZCTA_COLUMN: Record<BackfillTable, boolean> = \{\n  events: true,\n  event_occurrences: true,\n  locations: true,\n  businesses: true,\n  appearances: false,\n\};/);
  assert.doesNotMatch(candidateFn, /appearances.*geo_zcta_key|geo_zcta_key.*appearances/s);
});

// ── I. Apply re-checks geo_zcta_key immediately before writing ──────────

test("I. The Apply write guard re-checks geo_zcta_key immediately before writing, for the same ZCTA-capable tables — a row that gained a canonical key (via this runner, a concurrent edit, or an import) between the candidate read and the write can never be reprocessed/overwritten", () => {
  assert.match(applyBranch, /if \(HAS_ZCTA_COLUMN\[table\]\) updateQuery = updateQuery\.is\("geo_zcta_key", null\);/);
  // The pre-existing re-check of the other two columns is still there too — this adds a leg, it doesn't replace the guard.
  assert.match(applyBranch, /\.is\("geo_place_key", null\)\s*\.is\("geo_state_key", null\);/);
});

// ── K. Location-linked exclusion is completely unchanged ────────────────

test("K. Location-linked occurrence/appearance exclusion (candidate read AND the pre-write re-check) is untouched by this fix", () => {
  assert.match(candidateFn, /if \(HAS_LOCATION_ID_COLUMN\[table\]\) query = query\.is\("location_id", null\);/);
  assert.match(applyBranch, /if \(HAS_LOCATION_ID_COLUMN\[table\]\) updateQuery = updateQuery\.is\("location_id", null\);/);
});

// ── Nothing else in this file changed ────────────────────────────────────

test("Resolver precedence (ZIP input) and the hasAnyKey write invariant from the precision-fix pass are untouched by this closure", () => {
  assert.match(BACKFILL, /resolveEntityGeography\(\{ zip: HAS_POSTAL_COLUMN\[table\] \? row\.postal_code : null, city: row\.city, state: row\.state \}\)/);
  assert.match(applyBranch, /if \(apply && \(geo\.status === "resolved" \|\| geo\.status === "partial"\) && hasAnyKey\(geo\.keys\)\) \{/);
});

test("Still never touches city/state/postal_code/market_id/market_area_id, never creates a Market/Area/Market Request, only ever updates existing rows", () => {
  assert.doesNotMatch(BACKFILL, /\.update\(\{[^}]*(city|state|postal_code|market_id|market_area_id)/);
  assert.doesNotMatch(BACKFILL, /\bmarket_requests\b|markets\.insert|business_markets/);
  assert.doesNotMatch(BACKFILL, /\.insert\(/);
});
