// Missing-functionality pass — pure rules for the contextual anchor nav,
// multi-relationship Find Us Here, Product Sets, Moment display preferences
// and the Locator (CSV) import, plus source checks that the two schema
// migrations exist, are additive, and were NOT wired to anything that applies
// them. No network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const read = (p) => readFileSync(p, "utf8");
const ANCH = await import("../src/lib/section-anchors.ts");
const DOM = await import("../src/lib/business-availability-domain.ts");
const SETS = await import("../src/lib/business-product-sets-domain.ts");
const CSV = await import("../src/lib/locator-import/csv.ts");
const FIELDS = await import("../src/lib/locator-import/fields.ts");
const MATCH = await import("../src/lib/locator-import/match.ts");
const SRC = await import("../src/lib/locator-import/source.ts");

// ── Contextual anchor nav ──────────────────────────────────────────────────

test("anchor nav is derived from sections that rendered, in page order, with an Overview first", () => {
  const items = ANCH.buildSectionAnchors([
    { id: "gallery", label: "Photos", present: true },
    { id: "moments", label: "Moments", present: false },
    { id: "about", label: "About", present: true },
    { id: "people", label: "People", present: true },
  ]);
  assert.deepEqual(items.map((i) => i.label), ["Overview", "Photos", "About", "People"]);
  assert.equal(items[0].id, ANCH.OVERVIEW_ANCHOR_ID);
});

test("one meaningful section gets no nav; two (Overview + one real) get it; duplicates collapse", () => {
  assert.deepEqual(ANCH.buildSectionAnchors([]), []);
  assert.deepEqual(ANCH.buildSectionAnchors([{ id: "a", label: "A", present: false }]), [], "an absent section never counts");
  assert.deepEqual(ANCH.buildSectionAnchors([{ id: "a", label: "A", present: true }]).map((i) => i.id), [ANCH.OVERVIEW_ANCHOR_ID, "a"], "2 sections is enough");
  const dup = ANCH.buildSectionAnchors([
    { id: "a", label: "A", present: true },
    { id: "a", label: "A again", present: true },
    { id: "b", label: "B", present: true },
    { id: "c", label: "C", present: true },
  ]);
  assert.deepEqual(dup.map((i) => i.id), [ANCH.OVERVIEW_ANCHOR_ID, "a", "b", "c"]);
});

test("Business, Location, Event and Person pages all render the one shared SectionAnchorNav", () => {
  for (const f of [
    "src/app/(public)/people/[slug]/page.tsx",
    "src/app/(public)/business/[slug]/BusinessPublicView.tsx",
    "src/app/(public)/location/[slug]/LocationPublicView.tsx",
    "src/app/(public)/event/[slug]/EventPublicView.tsx",
  ]) assert.match(read(f), /<SectionAnchorNav /, f);
});

// ── Multi-relationship ─────────────────────────────────────────────────────

test("relationships normalize to canonical order, unique, known values only", () => {
  assert.deepEqual(DOM.normalizeAvailabilityRelationships(["sampled", "stocked", "stocked", "bogus"]), ["stocked", "sampled"]);
});

test("one place with several relationships reads as ONE phrase", () => {
  assert.equal(DOM.availabilityRelationshipsPhrase(["stocked"]), "Stocked Here");
  assert.equal(DOM.availabilityRelationshipsPhrase(["sampled", "served", "sold"]), "Sold, Served & Sampled Here");
  assert.equal(DOM.availabilityRelationshipsPhrase([]), "");
});

test("a request needs at least one valid relationship; the legacy single value still works", () => {
  const base = { locationId: "L", productIds: [], timing: "ongoing", startsOn: null, endsOn: null, note: null };
  assert.equal(DOM.validateAvailabilityRequest({ ...base, relationships: [] }).ok, false);
  assert.equal(DOM.validateAvailabilityRequest({ ...base, relationships: ["nope"] }).ok, false);
  const multi = DOM.validateAvailabilityRequest({ ...base, relationships: ["featured", "stocked"] });
  assert.deepEqual(multi.ok && multi.value.relationships, ["stocked", "featured"]);
  const legacy = DOM.validateAvailabilityRequest({ ...base, relationship: "served" });
  assert.deepEqual(legacy.ok && legacy.value.relationships, ["served"]);
});

// ── Product Sets ───────────────────────────────────────────────────────────

test("Product Sets validate, apply as a union, and toggle off when fully selected", () => {
  assert.equal(SETS.validateProductSet({ name: "  ", productIds: ["a"] }).ok, false);
  assert.equal(SETS.validateProductSet({ name: "Core", productIds: [] }).ok, false);
  const ok = SETS.validateProductSet({ name: " Core  Range ", productIds: ["a", "a", "b"] });
  assert.deepEqual(ok.ok && ok.value, { name: "Core Range", productIds: ["a", "b"] });
  assert.deepEqual(SETS.applyProductSet(["z"], { productIds: ["a", "b"] }), ["z", "a", "b"]);
  assert.deepEqual(SETS.applyProductSet(["z", "a", "b"], { productIds: ["a", "b"] }), ["z"]);
  assert.equal(SETS.isProductSetFullySelected(["a"], { productIds: [] }), false);
});

// ── CSV import: parsing ────────────────────────────────────────────────────

test("CSV: quotes, embedded commas/newlines, BOM, CRLF and blank lines", () => {
  const r = CSV.parseCsv('﻿Name,Address,City\r\n"Joe\'s, Cafe","1 Main St\nRear",Newark\r\n\r\nB,2 Elm St,Jersey City\r\n');
  assert.equal(r.ok, true);
  assert.deepEqual(r.csv.headers, ["Name", "Address", "City"]);
  assert.deepEqual(r.csv.rows, [["Joe's, Cafe", "1 Main St\nRear", "Newark"], ["B", "2 Elm St", "Jersey City"]]);
});

test("CSV: semicolon/tab delimiters are detected; short rows are padded", () => {
  assert.equal(CSV.parseCsv("a;b;c\n1;2;3").csv.delimiter, ";");
  assert.equal(CSV.parseCsv("a\tb\n1\t2").csv.delimiter, "\t");
  assert.deepEqual(CSV.parseCsv("a,b,c\n1").csv.rows, [["1", "", ""]]);
});

test("CSV: unclosed quote, empty, header-only and oversized input are refused with a reason", () => {
  assert.equal(CSV.parseCsv('a,b\n"x,1').ok, false);
  assert.equal(CSV.parseCsv("   ").ok, false);
  assert.equal(CSV.parseCsv("a,b").ok, false);
  assert.equal(CSV.CSV_MAX_BYTES, 10_000_000);
  const tooBig = CSV.parseCsv("a".repeat(CSV.CSV_MAX_BYTES + 1));
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.error, /under 10 MB/);
});

test("CSV: the cap is 10,000 rows; larger files are truncated and counted, never silently dropped", () => {
  assert.equal(CSV.CSV_MAX_ROWS, 10_000);
  const body = Array.from({ length: CSV.CSV_MAX_ROWS + 5 }, (_, i) => `x${i},y`).join("\n");
  const r = CSV.parseCsv(`a,b\n${body}`);
  assert.equal(r.csv.rows.length, CSV.CSV_MAX_ROWS);
  assert.equal(r.csv.truncated, 5);
  const full = CSV.parseCsv(`a,b\n${Array.from({ length: 10_000 }, (_, i) => `x${i},y`).join("\n")}`);
  assert.equal(full.csv.rows.length, 10_000);
  assert.equal(full.csv.truncated, 0);
});

test("a 10,000-row import is not capped by client loop counters; chunking, the 150-new-Location cap and review protections are unchanged", () => {
  const wizard = read("src/app/(public)/account/business/[id]/import-locations/ImportLocationsWizard.tsx");
  assert.doesNotMatch(wizard, /guard < \d+/);
  assert.match(wizard, /stopped making progress/);
  assert.match(wizard, /limit is 10,000 per import/);
  const server = read("src/lib/locator-import/server.ts");
  assert.match(server, /IMPORT_MATCH_CHUNK = 30;/);
  assert.match(server, /IMPORT_COMMIT_CHUNK = 15;/);
  assert.match(server, /IMPORT_NEW_LOCATION_MAX = 150;/);
  assert.match(server, /Too many new Locations in one import/);
});

// ── CSV import: mapping ────────────────────────────────────────────────────

test("mapping is detected from common locator headers and uses each column once", () => {
  const m = FIELDS.detectMapping(["Store ID", "Store Name", "Address 1", "City", "State/Province", "Zip Code", "Phone Number", "Website"]);
  assert.deepEqual(m, { externalId: 0, name: 1, address: 2, city: 3, state: 4, postalCode: 5, phone: 6, website: 7 });
});

test("a generic 'ID'/'Name' export still maps; missing required fields are named", () => {
  const m = FIELDS.detectMapping(["id", "name", "street", "city"]);
  assert.deepEqual(FIELDS.missingRequiredMapping(m), ["State"]);
});

test("a client mapping is sanitized against the real columns", () => {
  assert.deepEqual(FIELDS.cleanMapping({ name: 0, address: 0, city: 99, state: -1, bogus: 1, phone: "2" }, 3), { name: 0 });
});

test("rows normalize: state names → codes, ZIP trimmed, relationships parsed", () => {
  const mapping = { name: 0, address: 1, city: 2, state: 3, postalCode: 4, relationship: 5, externalId: 6 };
  const row = FIELDS.rowFromCells(["  Corner  Shop ", "5 Elm St", "Newark", "New Jersey", "07102-1234", "Carries, tastings", " S-9 "], mapping);
  assert.equal(row.name, "Corner Shop");
  assert.equal(row.state, "NJ");
  assert.equal(row.postalCode, "07102-1234");
  assert.deepEqual(row.relationships, ["stocked", "sampled"]);
  assert.equal(row.externalId, "S-9");
  assert.equal(FIELDS.rowFromCells(["x", "", "", "", "", "", ""], mapping).relationships, null);
});

// ── CSV import: matching buckets ───────────────────────────────────────────

const row = (o = {}) => ({ externalId: null, name: "Corner Shop", address: "5 Elm Street", city: "Newark", state: "NJ", postalCode: "07102", website: null, phone: null, relationships: null, ...o });
const existing = (o = {}) => ({ id: "L1", slug: "corner-shop", name: "Corner Shop", address: "5 Elm St", city: "Newark", state: "NJ", postal_code: "07102", is_demo: false, category: null, ...o });

test("a repeat source id is an update of its entry — addresses are not even consulted", () => {
  const m = MATCH.classifyImportRow(row({ externalId: "S-1", address: "" }), 1, { known: { availabilityId: "A", locationId: "L9" }, candidates: [] });
  assert.deepEqual([m.status, m.matchedLocationId, m.repeat], ["existing", "L9", true]);
});

test("same street + similar name on Findmi → confident match; different street → not a candidate", () => {
  assert.equal(MATCH.classifyImportRow(row(), 1, { known: null, candidates: [existing()] }).status, "existing");
  assert.equal(MATCH.classifyImportRow(row(), 1, { known: null, candidates: [existing({ address: "99 Other Rd" })] }).status, "new");
});

test("a same-name place without a confirmed street is a POSSIBLE match, never guessed", () => {
  const m = MATCH.classifyImportRow(row(), 1, { known: null, candidates: [existing({ address: null })] });
  assert.equal(m.status, "possible");
  assert.deepEqual(m.candidateLocationIds, ["L1"]);
});

test("vague places are invalid with a reason; nothing creatable is 'new'", () => {
  const m = MATCH.classifyImportRow(row({ address: "Corner of 5th and Main" }), 1, { known: null, candidates: [] });
  assert.equal(m.status, "invalid");
  assert.ok(m.problem);
  assert.equal(MATCH.preMatchProblem(row({ name: null })) !== null, true);
  assert.equal(MATCH.preMatchProblem(row()), null);
});

test("file duplicates: the same source id or street twice in one file → later rows point at the first", () => {
  const dupes = MATCH.findFileDuplicates([row({ externalId: "a" }), row({ externalId: "b", address: "9 Oak" }), row({ externalId: "A", address: "1 Z St" }), row({ externalId: null, address: "9 Oak Street" }), row({ externalId: null, address: "9 oak st." })]);
  assert.equal(dupes.get(3), 1);
  assert.equal(dupes.has(2), false);
  assert.equal(dupes.get(5), 4);
});

test("effective action: defaults, decisions and unresolved possibles", () => {
  const base = { matched_location_id: null, candidate_location_ids: ["L1", "L2"], decision: null, chosen_location_id: null, problem: null };
  assert.deepEqual(MATCH.effectiveAction({ ...base, match_status: "existing", matched_location_id: "L1" }), { kind: "link", locationId: "L1" });
  assert.deepEqual(MATCH.effectiveAction({ ...base, match_status: "new" }), { kind: "create" });
  assert.equal(MATCH.effectiveAction({ ...base, match_status: "possible" }).kind, "unresolved");
  assert.deepEqual(MATCH.effectiveAction({ ...base, match_status: "possible", decision: "use_match", chosen_location_id: "L2" }), { kind: "link", locationId: "L2" });
  // A "chosen" id the matcher never offered is not honoured.
  assert.equal(MATCH.effectiveAction({ ...base, match_status: "possible", decision: "use_match", chosen_location_id: "EVIL" }).kind, "unresolved");
  assert.deepEqual(MATCH.effectiveAction({ ...base, match_status: "possible", decision: "create_new" }), { kind: "create" });
  assert.equal(MATCH.effectiveAction({ ...base, match_status: "new", decision: "skip" }).kind, "skip");
  assert.equal(MATCH.effectiveAction({ ...base, match_status: "invalid", problem: "x" }).kind, "skip");
  assert.equal(MATCH.effectiveAction({ ...base, match_status: "duplicate" }).kind, "skip");
});

test("adapters: only CSV is registered — Sync Existing Locator is not a working source", () => {
  assert.deepEqual(Object.keys(SRC.LOCATOR_SOURCES), ["csv"]);
  assert.equal(SRC.csvSource.read("a,b\n1,2").ok, true);
  assert.equal(SRC.csvSource.read("").ok, false);
  const view = read("src/app/(public)/account/business/[id]/v2/AvailableAtView.tsx");
  assert.match(view, /Sync Existing Locator/);
  assert.match(view, /Coming Soon/);
  const wizard = read("src/app/(public)/account/business/[id]/import-locations/ImportLocationsWizard.tsx");
  assert.match(wizard, /aria-disabled="true"/);
  assert.doesNotMatch(wizard, /syncAction|sync(Locator)?Action/i);
});

test("import actions authorize an owner/manager (or elevated admin) on every call and never trust the batch id alone", () => {
  const actions = read("src/app/(public)/account/business/[id]/import-locations/actions.ts");
  assert.equal((actions.match(/await authorize\(businessId\)/g) ?? []).length, 6);
  const server = read("src/lib/locator-import/server.ts");
  assert.match(server, /\.eq\("business_id", businessId\)/);
  // New Locations only go through the one unlisted creator.
  assert.match(server, /createImportedLocation/);
  assert.doesNotMatch(server, /from\("locations"\)\s*\.insert/);
});

// ── Migrations: present, additive, not applied by anything in the repo ─────

const MIGRATIONS = ["supabase/migrations/20261101000000_findmi_here_relationships_sets_import.sql", "supabase/migrations/20261101000100_entity_moment_display.sql"];

test("both migrations exist and are additive (no drop table/column, no truncate, no delete)", () => {
  for (const f of MIGRATIONS) {
    assert.ok(existsSync(f), f);
    const sql = read(f).replace(/--.*$/gm, "");
    assert.doesNotMatch(sql, /\bdrop\s+(table|column|schema)\b/i, f);
    assert.doesNotMatch(sql, /\btruncate\b/i, f);
    assert.doesNotMatch(sql, /\bdelete\s+from\b/i, f);
  }
});

test("new tables are service-role only; the display table is public-read only", () => {
  const a = read(MIGRATIONS[0]);
  for (const t of ["business_product_sets", "business_product_set_items", "location_import_batches", "location_import_rows"]) {
    assert.match(a, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(a, new RegExp(`revoke all on public\\.${t} from anon, authenticated`));
  }
  const b = read(MIGRATIONS[1]);
  assert.match(b, /enable row level security/);
  assert.doesNotMatch(b, /grant (insert|update|delete|all)[^;]*to (anon|authenticated)/i);
});

test("the two newest migrations are the only ones this pass added", () => {
  const names = readdirSync("supabase/migrations").filter((f) => f >= "20261101");
  assert.deepEqual(names.sort(), MIGRATIONS.map((m) => m.split("/").pop()).sort());
});
