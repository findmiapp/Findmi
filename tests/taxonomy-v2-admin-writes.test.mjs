// Taxonomy V2 — Pass 4A: the classification foundation for Admin editing.
// The cardinality contract, per entity + dimension CURATION (V1 inference
// can't resurrect a removed / replaced value; the first curation keeps every
// effective value), explicit empty, SINGLE / MULTI + primary, retired
// vocabulary, suggestion Accept / Dismiss, audit, failure-safe ordering, and
// the boundaries that keep V1 / public / owner / importer behavior unchanged.
// In-memory PostgREST fake; no network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { registerHooks } from "node:module";
import { fakeDb } from "./helpers/fake-postgrest.mjs";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "react") return { url: "data:text/javascript,export const cache=(f)=>f", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const P = await import("../src/lib/taxonomy/compat-policy.ts");
const K = await import("../src/lib/taxonomy/cardinality.ts");
const R = await import("../src/lib/taxonomy/reference-server.ts");
const C = await import("../src/lib/taxonomy/classifications-server.ts");
const W = await import("../src/lib/taxonomy/admin-writes-server.ts");
const L = await import("../src/lib/taxonomy/v2-legacy.ts");

const ROOT = process.cwd();
const read = (f) => readFileSync(join(ROOT, f), "utf8");

// ------------------------------------------------------------ fixture

let n = 0;
const id = () => `${String(++n).padStart(8, "0")}-0000-4000-8000-0000000000aa`;
const cat = (kind, slug, name, status = "active") => ({ id: id(), kind, slug, name, status });
const CAT = {
  b_coffee: cat("business", "coffee", "Coffee"),
  b_bakery: cat("business", "bakery-sweets", "Bakery & Sweets"),
  b_retail: cat("business", "retail", "Retail"),
  b_fashion: cat("business", "fashion-apparel", "Fashion & Apparel"),
  b_makers: cat("business", "makers-goods", "Makers & Goods"),
  sb_food: cat("business", "food-beverage", "Food & Beverage", "staged"),
  sb_coffee: cat("business", "coffee-tea", "Coffee & Tea", "staged"),
  sb_bakery: cat("business", "bakery-desserts", "Bakery & Desserts", "staged"),
  sb_arts: cat("business", "arts-makers", "Arts & Makers", "staged"),
  sb_makers: cat("business", "makers", "Makers", "staged"),
  sb_old: cat("business", "old-category", "Old Category", "deprecated"),
  e_food: cat("event", "food-drink", "Food & Drink"),
  e_arts: cat("event", "arts-culture", "Arts & Culture"),
  se_shopping: cat("event", "shopping-style", "Shopping & Style", "staged"),
  f_market: cat("event_format", "market", "Market"),
  f_sampling: cat("event_format", "sampling", "Sampling"),
  f_exhibition: cat("event_format", "exhibition", "Exhibition"),
  sl_food: cat("location", "food-drink", "Food & Drink", "staged"),
  l_cafe: cat("location", "cafe-coffee-shop", "Cafe / Coffee Shop"),
  sp_bev: cat("product", "beverages", "Beverages", "staged"),
  p_coffee: cat("product", "coffee", "Coffee"),
  sp_apparel: cat("product", "apparel", "Apparel", "staged"),
  p_clothing: cat("product", "clothing", "Clothing"),
};
const node = (c, parent = null) => ({ category_id: c.id, kind: c.kind, parent_category_id: parent?.id ?? null, depth: parent ? 2 : 1, display_name: null, sort_order: 0 });
const TREE = [
  node(CAT.sb_food), node(CAT.sb_coffee, CAT.sb_food), node(CAT.sb_bakery, CAT.sb_food), node(CAT.b_fashion), node(CAT.sb_arts), node(CAT.sb_makers, CAT.sb_arts), node(CAT.sb_old),
  node(CAT.e_food), node(CAT.e_arts), node(CAT.se_shopping),
  node(CAT.sl_food), node(CAT.l_cafe, CAT.sl_food),
  node(CAT.sp_bev), node(CAT.p_coffee, CAT.sp_bev), node(CAT.sp_apparel),
];
const term = (vocabulary, slug, status = "active") => ({ id: id(), vocabulary, slug, name: slug, status });
const TERM = {
  market: term("event_type", "market"),
  exhibition: term("event_type", "exhibition"),
  festival: term("event_type", "festival"),
  oldType: term("event_type", "old-type", "deprecated"),
  sampling: term("experience_mechanic", "sampling"),
  popup: term("experience_mechanic", "pop-up"),
  booth: term("appearance_type", "vendor-booth"),
  oppAct: term("opportunity_category", "activation-sampling"),
  oppRetail: term("opportunity_category", "retail-vending"),
};
const topic = (slug, o = {}) => ({ id: id(), slug, name: slug, kind: "subject", broader_topic_id: null, applies_to: ["business", "location", "event", "product", "appearance"], status: "active", ...o });
const TOPIC = { food: topic("food"), coffee: topic("coffee"), art: topic("art"), old: topic("old-topic", { status: "retired" }), eventOnly: topic("festival-season", { applies_to: ["event"] }) };
const MAPPINGS = L.LEGACY_MAPPINGS.map((m) => ({ legacy_source: "category", legacy_kind: m.kind, legacy_slug: m.slug, targets: m.targets, mapping_confidence: L.mappingStatus(m), status: "draft" }));

const B = { several: id(), empty: id(), bakery: id(), retired: id() };
const E = { food: id(), market: id() };
const LOC = { cafe: id() };
const PR = { coffee: id(), service: id() };
const AP = { own: id() };
const OP = { act: id() };
const SG = { coffeeTea: id(), exhibition: id(), registration: id(), dismissMe: id(), coffeeTopic: id() };

function tables() {
  return {
    categories: Object.values(CAT),
    category_tree_v2: TREE,
    taxonomy_terms: Object.values(TERM),
    topics: Object.values(TOPIC),
    category_topics: [{ category_id: CAT.sb_food.id, topic_id: TOPIC.food.id }, { category_id: CAT.sb_coffee.id, topic_id: TOPIC.coffee.id }],
    taxonomy_legacy_mappings: MAPPINGS,
    businesses: [
      { id: B.several, business_models: [] },
      { id: B.empty, business_models: [] },
      { id: B.bakery, business_models: [] },
      { id: B.retired, business_models: [] },
    ],
    business_categories: [
      { business_id: B.several, category_id: CAT.b_fashion.id },
      { business_id: B.several, category_id: CAT.b_makers.id },
      { business_id: B.bakery, category_id: CAT.b_bakery.id },
    ],
    business_category_assignments: [
      { business_id: B.several, category_id: CAT.b_fashion.id, is_primary: true, source: "migration" },
      { business_id: B.retired, category_id: CAT.sb_old.id, is_primary: true, source: "admin" },
    ],
    business_topics: [
      { business_id: B.empty, topic_id: TOPIC.art.id, source: "suggestion" },
      { business_id: B.retired, topic_id: TOPIC.old.id, source: "admin" },
    ],
    classification_field_sources: [],
    events: [
      { id: E.food, benefits: [], audience: [], entry_modes: [], setting: null },
      { id: E.market, benefits: [], audience: [], entry_modes: [], setting: null },
    ],
    event_categories: [{ event_id: E.food, category_id: CAT.e_food.id }],
    event_formats: [
      { event_id: E.food, category_id: CAT.f_market.id },
      { event_id: E.food, category_id: CAT.f_exhibition.id },
      { event_id: E.food, category_id: CAT.f_sampling.id },
      { event_id: E.market, category_id: CAT.f_market.id },
    ],
    event_category_assignments: [],
    event_type_assignments: [],
    event_mechanic_assignments: [],
    event_topics: [],
    locations: [{ id: LOC.cafe, category_id: CAT.l_cafe.id, attributes: {} }],
    location_categories: [],
    location_topics: [],
    products: [
      { id: PR.coffee, product_type: "product", attributes: {}, audience: [] },
      { id: PR.service, product_type: "service", attributes: {}, audience: [] },
    ],
    product_categories: [{ product_id: PR.coffee, category_id: CAT.p_coffee.id }, { product_id: PR.service, category_id: CAT.p_clothing.id }],
    product_category_assignments: [],
    product_topics: [],
    appearances: [{ id: AP.own, event_id: null, business_id: null, appearance_type_id: null, benefits: [] }],
    appearance_topics: [],
    opportunity_listings: [{ id: OP.act, opportunity_type: "activation", opportunity_category_id: null }],
    classification_suggestions: [
      { id: SG.coffeeTea, entity_type: "business", entity_id: B.empty, dimension: "category", value: "coffee-tea", source: "migration", status: "suggested", reviewed_at: null, reviewed_by: null },
      { id: SG.exhibition, entity_type: "event", entity_id: E.market, dimension: "event_type", value: "exhibition", source: "migration", status: "suggested", reviewed_at: null, reviewed_by: null },
      { id: SG.registration, entity_type: "event", entity_id: E.market, dimension: "entry_mode", value: "registration", source: "migration", status: "suggested", reviewed_at: null, reviewed_by: null },
      { id: SG.dismissMe, entity_type: "business", entity_id: B.empty, dimension: "topic", value: "coffee", source: "migration", status: "suggested", reviewed_at: null, reviewed_by: null },
      { id: SG.coffeeTopic, entity_type: "event", entity_id: E.market, dimension: "topic", value: "coffee", source: "migration", status: "suggested", reviewed_at: null, reviewed_by: null },
    ],
    admin_audit_events: [],
  };
}

const NOW = "2026-10-27T12:00:00.000Z";
async function setup(mutate) {
  // A deep copy per test: a test may change rows (e.g. retire a term).
  const t = structuredClone(tables());
  if (mutate) mutate(t);
  const db = fakeDb(t);
  const reference = await R.buildTaxonomyReference(db);
  return { t, db, reference, opts: { client: db, reference, now: () => NOW } };
}
const load = async (s, entity, entityId) => (await C.loadClassifications(entity, [entityId], s.opts)).get(entityId);
const slugs = (xs) => xs.map((x) => x.value.slug);
const target = (entity, entityId, dimension) => ({ entity, entityId, dimension });
const primaries = (rows, key, entityId) => rows.filter((r) => r[key] === entityId && r.is_primary === true);
const marker = (s, entity, entityId, field) => s.t.classification_field_sources.find((r) => r.entity_type === entity && r.entity_id === entityId && r.field === field);
const V1_TABLES = ["business_categories", "event_categories", "event_formats", "product_categories"];
const v1Writes = (db) => db.calls.filter((c) => c.op !== "select" && (V1_TABLES.includes(c.table) || (c.table === "locations" && c.op === "update") || (c.table === "events" && c.payload && ["audience", "entry_modes", "benefits", "is_free"].some((k) => k in c.payload))));

/** A client that fails the first call matching `match` (checked when the
 * request runs, i.e. once its op / filters are known). */
function failOnce(db, match) {
  let failed = false;
  return {
    calls: db.calls,
    from(table) {
      const chain = db.from(table);
      const call = db.calls[db.calls.length - 1];
      const proxy = new Proxy(chain, {
        get(target, key) {
          if (key === "then") {
            return (resolve, reject) => {
              if (!failed && match(call)) {
                failed = true;
                return resolve({ data: null, error: { message: "simulated failure" } });
              }
              return target.then(resolve, reject);
            };
          }
          const v = target[key];
          return typeof v === "function" ? (...a) => (v.apply(target, a) === target ? proxy : v.apply(target, a)) : v;
        },
      });
      return proxy;
    },
  };
}

// ------------------------------------------------------------ A. the contract

test("contract: every approved entity × dimension, SINGLE / MULTI, required, primary, write mode — nothing invented", () => {
  const rows = K.CLASSIFICATION_RULES.map((r) => [r.entity, r.dimension, r.cardinality, r.required, r.primary, r.write]);
  assert.deepEqual(rows, [
    ["business", "category", "multi", false, true, "admin"],
    ["business", "business_model", "multi", false, false, "admin"],
    ["business", "topic", "multi", false, false, "admin"],
    ["location", "category", "multi", false, true, "admin"],
    ["location", "topic", "multi", false, false, "admin"],
    ["location", "attribute", "multi", false, false, "deferred"],
    ["event", "category", "single", false, false, "admin"],
    ["event", "event_type", "single", false, false, "admin"],
    ["event", "experience_mechanic", "multi", false, false, "admin"],
    ["event", "topic", "multi", false, false, "admin"],
    ["event", "audience", "multi", false, false, "live_v1"],
    ["event", "entry_mode", "multi", false, false, "live_v1"],
    ["event", "benefit", "multi", false, false, "live_v1"],
    ["event", "setting", "single", false, false, "admin"],
    ["product", "category", "multi", false, true, "admin"],
    ["product", "topic", "multi", false, false, "admin"],
    ["product", "audience", "multi", false, false, "admin"],
    ["product", "attribute", "multi", false, false, "deferred"],
    ["appearance", "appearance_type", "single", false, false, "admin"],
    ["appearance", "topic", "multi", false, false, "admin"],
    ["appearance", "benefit", "multi", false, false, "admin"],
    ["opportunity", "opportunity_category", "single", true, false, "admin"],
  ]);
  for (const r of K.CLASSIFICATION_RULES) {
    if (r.cardinality === "single") assert.equal(r.primary, false, `${r.entity}.${r.dimension}: primary is a MULTI concept`);
    if (r.cardinality === "multi") assert.equal(r.required, false, `${r.entity}.${r.dimension}`);
  }
  assert.equal(K.ruleFor("business", "attribute"), undefined, "no Business Attributes");
  assert.equal(K.ruleFor("opportunity", "topic"), undefined, "nothing invented for symmetry");
  // Curation markers: only where V1 inference exists.
  assert.deepEqual(K.CLASSIFICATION_RULES.filter((r) => r.curationField).map((r) => `${r.entity}.${r.dimension}=${r.curationField}`), [
    "business.category=categories", "business.business_model=business_models", "business.topic=topics",
    "location.category=categories", "location.topic=topics",
    "event.category=categories", "event.event_type=event_type", "event.experience_mechanic=experience_mechanics", "event.topic=topics",
    "product.category=categories", "product.topic=topics",
  ]);
  const curatedCompat = Object.keys(K.CURATION_FIELD).sort();
  assert.deepEqual(curatedCompat, Object.entries(P.COMPAT_POLICY).filter(([, p]) => p.mode === "union_live").map(([d]) => d).sort(), "exactly the dimensions V1 re-derives");
});

test("migration: only widens classification_field_sources.field with the four curation fields — no table, no data", () => {
  const sql = read("supabase/migrations/20261118000000_taxonomy_v2_admin_curation.sql");
  const body = sql.replace(/--.*$/gm, "");
  assert.match(body, /^\s*begin;/m);
  assert.match(body, /commit;\s*$/);
  const statements = body.split(";").map((x) => x.trim()).filter((x) => x && x !== "begin" && x !== "commit");
  assert.equal(statements.length, 2);
  assert.match(statements[0], /^alter table public\.classification_field_sources drop constraint if exists classification_field_sources_field_check$/);
  assert.match(statements[1], /^alter table public\.classification_field_sources add constraint classification_field_sources_field_check check \(field in \(/);
  const values = [...statements[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const pass1 = read("supabase/migrations/20261116000000_taxonomy_v2_foundation.sql").match(/field text not null check \(field in \(([\s\S]*?)\)\)/)[1];
  const before = [...pass1.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(values.slice(0, before.length), before, "a strict superset: every existing value kept");
  assert.deepEqual(values.slice(before.length), ["categories", "topics", "event_type", "experience_mechanics"]);
  assert.doesNotMatch(body, /create table|insert into|update |delete from|drop table|grant |policy/i);
  const needed = new Set(Object.values(K.CURATION_FIELD));
  for (const f of needed) assert.ok(values.includes(f), `${f} allowed`);
});

// ------------------------------------------------------------ B. curation

test("1 + 17. an uncurated entity keeps deriving from current V1, exactly as Pass 3B", async () => {
  const s = await setup();
  const b = await load(s, "business", B.several);
  assert.deepEqual(slugs(b.categories).sort(), ["fashion-apparel", "makers"]);
  assert.ok(b.categories.every((x) => x.provenance.every((p) => p.kind === "legacy")), "the migration row is not trusted");
  assert.deepEqual(b.curated, []);
  const e = await load(s, "event", E.food);
  assert.deepEqual(slugs(e.types).sort(), ["exhibition", "market"], "two V1 Formats → two inferred Types");
  assert.equal(e.primaryType, null);
  assert.deepEqual(slugs(e.mechanics), ["sampling"]);
  assert.deepEqual(slugs(e.domains), ["food-drink"]);
});

test("2. adding an explicit value keeps V1 inference (no curation)", async () => {
  const s = await setup();
  const r = await W.addAssignment(target("business", B.several, "category"), CAT.sb_food.id, s.opts);
  assert.deepEqual(r, { ok: true, changed: true });
  const b = await load(s, "business", B.several);
  assert.deepEqual(slugs(b.categories).sort(), ["fashion-apparel", "food-beverage", "makers"]);
  assert.deepEqual(b.curated, []);
  assert.equal(marker(s, "business", B.several, "categories"), undefined);
  const added = s.t.business_category_assignments.find((x) => x.business_id === B.several && x.category_id === CAT.sb_food.id);
  assert.equal(added.source, "admin");
  assert.equal(added.is_primary, false, "several effective Categories: no automatic primary");
  // Same for Topics and Mechanics.
  await W.addAssignment(target("event", E.food, "experience_mechanic"), TERM.popup.id, s.opts);
  const e = await load(s, "event", E.food);
  assert.deepEqual(slugs(e.mechanics).sort(), ["pop-up", "sampling"]);
  assert.deepEqual(e.curated, []);
  // Idempotent.
  assert.deepEqual(await W.addAssignment(target("business", B.several, "category"), CAT.sb_food.id, s.opts), { ok: true, changed: false });
});

test("3 + 4 + 5. the first removal curates; V1 can't resurrect it; every other effective value survives", async () => {
  const s = await setup();
  const r = await W.removeAssignment(target("business", B.several, "category"), CAT.b_fashion.id, s.opts);
  assert.deepEqual(r, { ok: true, changed: true });
  assert.equal(marker(s, "business", B.several, "categories").source, "admin");
  const b = await load(s, "business", B.several);
  assert.deepEqual(b.curated, ["business_category"]);
  assert.deepEqual(slugs(b.categories), ["makers"], "Fashion stays removed although V1 still links it");
  assert.deepEqual(b.categories[0].provenance, [{ kind: "assigned", source: "admin", store: "business_category_assignments" }], "kept as an explicit value");
  assert.equal(b.primaryCategory.value.slug, "makers");
  assert.deepEqual(s.t.business_categories.filter((x) => x.business_id === B.several).map((x) => x.category_id).sort(), [CAT.b_fashion.id, CAT.b_makers.id].sort(), "V1 untouched");
  // Curation is per dimension: Business Model is still inferred.
  assert.deepEqual(b.businessModels.map((m) => m.value), ["maker_artist"]);
  assert.equal(b.businessModels[0].provenance[0].kind, "legacy");
  // A later V1 edit no longer flows into the curated dimension.
  s.t.business_categories.push({ business_id: B.several, category_id: CAT.b_bakery.id });
  assert.deepEqual(slugs((await load(s, "business", B.several)).categories), ["makers"]);
  // Repeating the removal is harmless.
  assert.deepEqual(await W.removeAssignment(target("business", B.several, "category"), CAT.b_fashion.id, s.opts), { ok: true, changed: false });
});

test("5. Topic curation keeps implied Topics (snapshot) and drops implication afterwards", async () => {
  const s = await setup();
  const before = await load(s, "business", B.bakery);
  assert.deepEqual(before.topics.implied.map((t) => t.value.slug), ["food"], "Bakery & Desserts implies Food");
  await W.addAssignment(target("business", B.bakery, "topic"), TOPIC.art.id, s.opts);
  await W.removeAssignment(target("business", B.bakery, "topic"), TOPIC.art.id, s.opts);
  const after = await load(s, "business", B.bakery);
  assert.deepEqual(after.topics.implied, [], "no implication once curated");
  assert.deepEqual(after.topics.explicit.map((t) => [t.value.slug, t.provenance[0].source]), [["food", "admin"]], "the implied Topic survived as an explicit one");
  assert.deepEqual(slugs(after.categories), ["bakery-desserts"], "Categories not curated, still inferred");
});

test("6. explicit empty survives for optional SINGLE dimensions; required ones refuse to clear", async () => {
  const s = await setup();
  assert.deepEqual(await W.clearSingle(target("event", E.food, "event_type"), s.opts), { ok: true, changed: true });
  const e = await load(s, "event", E.food);
  assert.deepEqual(e.types, [], "two inferred Types, cleared on purpose");
  assert.equal(e.primaryType, null);
  assert.deepEqual(e.curated, ["event_type"]);
  assert.equal(s.t.event_formats.filter((x) => x.event_id === E.food).length, 3, "V1 Formats untouched");
  assert.deepEqual(slugs(e.mechanics), ["sampling"], "Mechanics still inferred");
  // Column-stored optional singles.
  await W.replaceSingle(target("event", E.food, "setting"), "outdoor", s.opts);
  assert.equal((await load(s, "event", E.food)).setting.value, "outdoor");
  await W.clearSingle(target("event", E.food, "setting"), s.opts);
  assert.equal((await load(s, "event", E.food)).setting, null);
  assert.equal(marker(s, "event", E.food, "setting").source, "admin");
  await W.replaceSingle(target("appearance", AP.own, "appearance_type"), TERM.booth.id, s.opts);
  await W.removeAssignment(target("appearance", AP.own, "appearance_type"), TERM.booth.id, s.opts);
  assert.equal((await load(s, "appearance", AP.own)).own.appearanceType, null);
  // Required.
  assert.equal((await W.clearSingle(target("opportunity", OP.act, "opportunity_category"), s.opts)).code, "required");
  // Two inferred Types can't be curated as-is: choose one.
  const s2 = await setup();
  assert.equal((await W.curateDimension(target("event", E.food, "event_type"), s2.opts)).code, "ambiguous");
});

test("7. SINGLE dimensions return one canonical value after replace — never several", async () => {
  const s = await setup();
  assert.deepEqual(await W.replaceSingle(target("event", E.food, "event_type"), TERM.festival.id, s.opts), { ok: true, changed: true });
  const e = await load(s, "event", E.food);
  assert.deepEqual(slugs(e.types), ["festival"], "the inferred Market and Exhibition are gone");
  assert.equal(e.primaryType.value.slug, "festival");
  assert.deepEqual(s.t.event_type_assignments.filter((x) => x.event_id === E.food).map((x) => [x.term_id, x.is_primary, x.source]), [[TERM.festival.id, true, "admin"]]);
  await W.replaceSingle(target("event", E.food, "event_type"), TERM.market.id, s.opts);
  assert.deepEqual(slugs((await load(s, "event", E.food)).types), ["market"]);
  assert.equal(s.t.event_type_assignments.filter((x) => x.event_id === E.food).length, 1);
  // Event Category: V1 has Food & Drink; replaced with a staged V2 Category.
  await W.replaceSingle(target("event", E.food, "category"), CAT.se_shopping.id, s.opts);
  const after = await load(s, "event", E.food);
  assert.deepEqual(slugs(after.domains), ["shopping-style"]);
  assert.equal(after.primaryDomain.value.slug, "shopping-style");
  assert.deepEqual(s.t.event_categories.filter((x) => x.event_id === E.food).map((x) => x.category_id), [CAT.e_food.id], "V1 event_categories untouched");
  // Add on a SINGLE dimension is a replace.
  await W.addAssignment(target("opportunity", OP.act, "opportunity_category"), TERM.oppRetail.id, s.opts);
  assert.equal((await load(s, "opportunity", OP.act)).category.value.slug, "retail-vending", "explicit admin value beats the V1 opportunity_type");
  assert.deepEqual(await W.replaceSingle(target("opportunity", OP.act, "opportunity_category"), TERM.oppRetail.id, s.opts), { ok: true, changed: false });
});

test("8 + 9. MULTI Categories: several values, exactly one primary when non-empty; primary changes safely", async () => {
  const s = await setup();
  // First Category on an empty entity becomes primary.
  await W.addAssignment(target("business", B.empty, "category"), CAT.sb_coffee.id, s.opts);
  assert.equal(primaries(s.t.business_category_assignments, "business_id", B.empty).length, 1);
  assert.equal((await load(s, "business", B.empty)).primaryCategory.value.slug, "coffee-tea");
  await W.addAssignment(target("business", B.empty, "category"), CAT.sb_bakery.id, s.opts);
  let b = await load(s, "business", B.empty);
  assert.deepEqual(slugs(b.categories).sort(), ["bakery-desserts", "coffee-tea"]);
  assert.equal(b.primaryCategory.value.slug, "coffee-tea", "still exactly one primary");
  assert.equal(primaries(s.t.business_category_assignments, "business_id", B.empty).length, 1);

  assert.deepEqual(await W.setPrimary(target("business", B.empty, "category"), CAT.sb_bakery.id, s.opts), { ok: true, changed: true });
  b = await load(s, "business", B.empty);
  assert.equal(b.primaryCategory.value.slug, "bakery-desserts");
  assert.deepEqual(primaries(s.t.business_category_assignments, "business_id", B.empty).map((x) => x.category_id), [CAT.sb_bakery.id]);
  assert.deepEqual(await W.setPrimary(target("business", B.empty, "category"), CAT.sb_bakery.id, s.opts), { ok: true, changed: false });
  assert.equal((await W.setPrimary(target("business", B.empty, "category"), CAT.sb_makers.id, s.opts)).code, "not_effective");
  assert.equal((await W.setPrimary(target("event", E.food, "category"), CAT.e_food.id, s.opts)).code, "unsupported", "SINGLE dims have no primary designation");

  // Removing the primary in a curated set promotes another: never zero.
  await W.removeAssignment(target("business", B.empty, "category"), CAT.sb_bakery.id, s.opts);
  b = await load(s, "business", B.empty);
  assert.deepEqual(slugs(b.categories), ["coffee-tea"]);
  assert.equal(b.primaryCategory.value.slug, "coffee-tea");
  assert.equal(primaries(s.t.business_category_assignments, "business_id", B.empty).length, 1);

  // Curation of an inferred, primary-less set designates one primary; a stale
  // migration primary row is cleared (one-primary index).
  const s2 = await setup();
  await W.curateDimension(target("business", B.several, "category"), s2.opts);
  const rows = s2.t.business_category_assignments.filter((x) => x.business_id === B.several);
  assert.deepEqual(rows.map((x) => x.source), ["admin", "admin"]);
  assert.equal(rows.filter((x) => x.is_primary).length, 1);
  // A primary can also be set on an inferred value without curating.
  const s3 = await setup();
  await W.setPrimary(target("location", LOC.cafe, "category"), CAT.l_cafe.id, s3.opts);
  const loc = await load(s3, "location", LOC.cafe);
  assert.equal(loc.primaryCategory.value.slug, "cafe-coffee-shop");
  assert.deepEqual(loc.curated, []);
});

test("curation is an entity + dimension override, never a global switch", async () => {
  const s = await setup();
  await W.replaceSingle(target("event", E.food, "event_type"), TERM.festival.id, s.opts);
  const other = await load(s, "event", E.market);
  assert.deepEqual(slugs(other.types), ["market"], "another Event still infers");
  assert.deepEqual(other.curated, []);
  const same = await load(s, "event", E.food);
  assert.deepEqual(same.curated, ["event_type"]);
  assert.deepEqual(slugs(same.mechanics), ["sampling"], "another dimension of the same Event still infers");
  assert.deepEqual(slugs(same.domains), ["food-drink"]);
});

test("Business Model: the whole-set column curates on any explicit write, keeping inferred models", async () => {
  const s = await setup();
  await W.addAssignment(target("business", B.several, "business_model"), "retailer", s.opts);
  let b = await load(s, "business", B.several);
  assert.deepEqual(b.businessModels.map((m) => m.value).sort(), ["maker_artist", "retailer"]);
  assert.ok(b.businessModels.every((m) => m.provenance[0].kind === "assigned"));
  assert.deepEqual(b.curated, ["business_model"]);
  assert.deepEqual(s.t.businesses.find((x) => x.id === B.several).business_models.sort(), ["maker_artist", "retailer"]);
  await W.removeAssignment(target("business", B.several, "business_model"), "maker_artist", s.opts);
  b = await load(s, "business", B.several);
  assert.deepEqual(b.businessModels.map((m) => m.value), ["retailer"], "V1 Makers & Goods no longer re-adds it");
  assert.deepEqual(slugs(b.categories).sort(), ["fashion-apparel", "makers"], "Categories still inferred");
});

test("failure-safe order: a failure at any curation step leaves the effective set unchanged", async () => {
  const fullSet = ["fashion-apparel", "makers"];
  // a) snapshot write fails
  let s = await setup();
  let client = failOnce(s.db, (c) => c.table === "business_category_assignments" && c.op !== "select");
  let r = await W.removeAssignment(target("business", B.several, "category"), CAT.b_fashion.id, { ...s.opts, client });
  assert.equal(r.ok, false);
  assert.equal(r.code, "db");
  assert.deepEqual(slugs((await load(s, "business", B.several)).categories).sort(), fullSet);
  // b) marker write fails after the snapshot succeeded
  s = await setup();
  client = failOnce(s.db, (c) => c.table === "classification_field_sources" && c.op === "insert");
  r = await W.removeAssignment(target("business", B.several, "category"), CAT.b_fashion.id, { ...s.opts, client });
  assert.equal(r.ok, false);
  let b = await load(s, "business", B.several);
  assert.deepEqual(slugs(b.categories).sort(), fullSet, "explicit snapshot + still-inferred values: same set");
  assert.deepEqual(b.curated, []);
  // c) the delete fails after the marker: curated with the full set, nothing lost
  s = await setup();
  client = failOnce(s.db, (c) => c.table === "business_category_assignments" && c.op === "delete");
  r = await W.removeAssignment(target("business", B.several, "category"), CAT.b_fashion.id, { ...s.opts, client });
  assert.equal(r.ok, false);
  b = await load(s, "business", B.several);
  assert.deepEqual(slugs(b.categories).sort(), fullSet);
  assert.deepEqual(b.curated, ["business_category"]);
  // …and simply retrying finishes the job.
  assert.deepEqual(await W.removeAssignment(target("business", B.several, "category"), CAT.b_fashion.id, s.opts), { ok: true, changed: true });
  assert.deepEqual(slugs((await load(s, "business", B.several)).categories), ["makers"]);
  // d) SINGLE replace: the marker is written last, the old value never
  //    disappears before the new one exists.
  s = await setup();
  client = failOnce(s.db, (c) => c.table === "classification_field_sources" && c.op === "insert");
  r = await W.replaceSingle(target("event", E.food, "event_type"), TERM.festival.id, { ...s.opts, client });
  assert.equal(r.ok, false);
  const e = await load(s, "event", E.food);
  assert.equal(e.primaryType.value.slug, "festival", "the new value is already in place (explicit primary)");
  assert.ok(slugs(e.types).includes("festival"));
  assert.deepEqual(await W.replaceSingle(target("event", E.food, "event_type"), TERM.festival.id, s.opts), { ok: true, changed: true }, "retry completes");
  assert.deepEqual(slugs((await load(s, "event", E.food)).types), ["festival"]);
  // e) an error is never reported as success
  s = await setup();
  client = failOnce(s.db, (c) => c.table === "event_mechanic_assignments" && c.op === "insert");
  r = await W.addAssignment(target("event", E.food, "experience_mechanic"), TERM.popup.id, { ...s.opts, client });
  assert.equal(r.ok, false);
  assert.match(r.error, /simulated failure/);
});

test("Event Category is SINGLE + optional: an inferred Category can be cleared to an explicit empty V1 can't refill, and set again", async () => {
  const s = await setup();
  // 1. Inferred before curation (V1 Food & Drink).
  let e = await load(s, "event", E.food);
  assert.deepEqual(slugs(e.domains), ["food-drink"]);
  assert.equal(e.domains[0].provenance[0].kind, "legacy");
  assert.deepEqual(e.curated, []);
  // 2. Admin clears it (clearSingle, or removing the current value).
  assert.deepEqual(await W.clearSingle(target("event", E.food, "category"), s.opts), { ok: true, changed: true });
  // 3. Explicitly empty.
  e = await load(s, "event", E.food);
  assert.deepEqual(e.domains, []);
  assert.equal(e.primaryDomain, null);
  assert.deepEqual(e.curated, ["event_domain"]);
  assert.equal(marker(s, "event", E.food, "categories").source, "admin");
  assert.deepEqual(s.t.event_category_assignments.filter((x) => x.event_id === E.food), []);
  // 4. V1 can't resurrect it — even after another V1 edit; V1 data untouched.
  assert.deepEqual(s.t.event_categories.filter((x) => x.event_id === E.food).map((x) => x.category_id), [CAT.e_food.id]);
  s.t.event_categories.push({ event_id: E.food, category_id: CAT.e_arts.id });
  e = await load(s, "event", E.food);
  assert.deepEqual(e.domains, [], "Food & Drink / Arts & Culture stay out of the curated empty");
  assert.deepEqual(v1Writes(s.db), []);
  // 5. Other Event dimensions keep normal Pass 3B inference.
  assert.deepEqual(slugs(e.types).sort(), ["exhibition", "market"]);
  assert.deepEqual(slugs(e.mechanics), ["sampling"]);
  assert.deepEqual(slugs((await load(s, "event", E.market)).domains), [], "another Event (no V1 Category) unaffected");
  // Clearing again is a no-op.
  assert.deepEqual(await W.clearSingle(target("event", E.food, "category"), s.opts), { ok: true, changed: false });
  // 6. Explicitly assigned again later.
  assert.deepEqual(await W.replaceSingle(target("event", E.food, "category"), CAT.e_arts.id, s.opts), { ok: true, changed: true });
  e = await load(s, "event", E.food);
  assert.deepEqual(slugs(e.domains), ["arts-culture"]);
  assert.deepEqual(e.domains[0].provenance, [{ kind: "assigned", source: "admin", store: "event_category_assignments" }]);
  assert.equal(e.primaryDomain.value.slug, "arts-culture");
  // 7. Replace still works, and removing the current value clears it.
  await W.replaceSingle(target("event", E.food, "category"), CAT.se_shopping.id, s.opts);
  assert.deepEqual(slugs((await load(s, "event", E.food)).domains), ["shopping-style"]);
  assert.equal(s.t.event_category_assignments.filter((x) => x.event_id === E.food).length, 1);
  assert.deepEqual(await W.removeAssignment(target("event", E.food, "category"), CAT.se_shopping.id, s.opts), { ok: true, changed: true });
  assert.deepEqual((await load(s, "event", E.food)).domains, []);
  // Removing the inferred value directly also curates to empty.
  const s2 = await setup();
  assert.deepEqual(await W.removeAssignment(target("event", E.food, "category"), CAT.e_food.id, s2.opts), { ok: true, changed: true });
  assert.deepEqual((await load(s2, "event", E.food)).domains, []);
});

// ------------------------------------------------------------ E. retired vocabulary

test("13. retired / deprecated vocabulary can't be newly assigned", async () => {
  const s = await setup();
  assert.equal((await W.addAssignment(target("business", B.empty, "category"), CAT.sb_old.id, s.opts)).code, "not_assignable");
  assert.equal((await W.replaceSingle(target("event", E.market, "event_type"), TERM.oldType.id, s.opts)).code, "not_assignable");
  assert.equal((await W.addAssignment(target("business", B.empty, "topic"), TOPIC.old.id, s.opts)).code, "not_assignable");
  assert.equal((await W.addAssignment(target("business", B.empty, "topic"), TOPIC.eventOnly.id, s.opts)).code, "invalid_value", "Topic scope respected");
  assert.equal((await W.addAssignment(target("business", B.empty, "category"), CAT.e_food.id, s.opts)).code, "invalid_value", "wrong Category tree");
  assert.equal((await W.addAssignment(target("business", B.empty, "business_model"), "nonsense", s.opts)).code, "invalid_value");
  assert.ok(K.isAssignable("category", "staged"), "staged V2 Categories are assignable (V2-only)");
  assert.ok(!K.isAssignable("category", "deprecated"));
  assert.ok(!K.isAssignable("term", "deprecated"));
  assert.ok(!K.isAssignable("topic", "retired"));
  assert.ok(!K.isAssignable("topic", "draft"));
});

test("14. an explicit assignment of a later-retired value stays visible with its status until deliberately removed", async () => {
  const s = await setup();
  const b = await load(s, "business", B.retired);
  assert.deepEqual(b.categories.map((x) => [x.value.slug, x.value.status]), [["old-category", "deprecated"]]);
  assert.equal(P.publicCategoryLabel(b.categories[0].value), null);
  assert.deepEqual(b.topics.explicit.map((x) => [x.value.slug, x.value.status]), [["old-topic", "retired"]]);
  assert.equal(s.reference.topicBySlug("old-topic"), undefined, "never offered for selection / inference");
  assert.ok(!s.reference.topics().some((t) => t.slug === "old-topic"));
  // Deliberate removal works.
  await W.removeAssignment(target("business", B.retired, "topic"), TOPIC.old.id, s.opts);
  assert.deepEqual((await load(s, "business", B.retired)).topics.explicit, []);
  // Inference never produces a retired term: a deprecated Exhibition stops being inferred.
  const s2 = await setup((t) => (t.taxonomy_terms.find((x) => x.id === TERM.exhibition.id).status = "deprecated"));
  assert.deepEqual(slugs((await load(s2, "event", E.food)).types), ["market"]);
});

// ------------------------------------------------------------ F. suggestions

test("10. Accept writes the canonical explicit value (source='admin') and only then confirms; re-running is safe", async () => {
  const s = await setup();
  assert.deepEqual(await W.acceptSuggestion(SG.coffeeTea, s.opts), { ok: true, changed: true });
  const row = s.t.business_category_assignments.find((x) => x.business_id === B.empty && x.category_id === CAT.sb_coffee.id);
  assert.equal(row.source, "admin");
  const sug = s.t.classification_suggestions.find((x) => x.id === SG.coffeeTea);
  assert.equal(sug.status, "confirmed");
  assert.equal(sug.reviewed_at, NOW);
  assert.equal(sug.reviewed_by, null);
  assert.deepEqual(slugs((await load(s, "business", B.empty)).categories), ["coffee-tea"]);
  assert.deepEqual(await W.acceptSuggestion(SG.coffeeTea, s.opts), { ok: true, changed: false }, "already confirmed");

  // Partial failure: the assignment landed, the confirmation didn't.
  const s2 = await setup();
  const client = failOnce(s2.db, (c) => c.table === "classification_suggestions" && c.op === "update");
  const first = await W.acceptSuggestion(SG.exhibition, { ...s2.opts, client });
  assert.equal(first.ok, false);
  assert.equal(s2.t.classification_suggestions.find((x) => x.id === SG.exhibition).status, "suggested");
  assert.deepEqual(slugs((await load(s2, "event", E.market)).types), ["exhibition"], "SINGLE accept = replace");
  assert.deepEqual(await W.acceptSuggestion(SG.exhibition, s2.opts), { ok: true, changed: true }, "re-run completes");
  assert.equal(s2.t.event_type_assignments.filter((x) => x.event_id === E.market).length, 1, "no duplicate");
  assert.equal(s2.t.classification_suggestions.find((x) => x.id === SG.exhibition).status, "confirmed");

  // Accepted Topic on an Event.
  await W.acceptSuggestion(SG.coffeeTopic, s2.opts);
  assert.deepEqual((await load(s2, "event", E.market)).topics.explicit.map((t) => t.value.slug), ["coffee"]);
});

test("11. Dismiss marks rejected with a review time and writes no assignment", async () => {
  const s = await setup();
  const before = JSON.stringify(s.t.business_topics);
  assert.deepEqual(await W.dismissSuggestion(SG.dismissMe, s.opts), { ok: true, changed: true });
  const sug = s.t.classification_suggestions.find((x) => x.id === SG.dismissMe);
  assert.equal(sug.status, "rejected");
  assert.equal(sug.reviewed_at, NOW);
  assert.equal(sug.reviewed_by, null);
  assert.equal(JSON.stringify(s.t.business_topics), before);
  assert.deepEqual(await W.dismissSuggestion(SG.dismissMe, s.opts), { ok: true, changed: false });
  assert.equal((await W.acceptSuggestion(SG.dismissMe, s.opts)).code, "already_reviewed");
  await W.acceptSuggestion(SG.coffeeTea, s.opts);
  assert.equal((await W.dismissSuggestion(SG.coffeeTea, s.opts)).code, "already_reviewed");
});

test("12. source='suggestion' never becomes effective, and nothing writes it; live-V1 suggestions are not accepted here", async () => {
  const s = await setup();
  const b = await load(s, "business", B.empty);
  assert.deepEqual(b.topics.explicit, [], "a 'suggestion'-sourced row is ignored");
  for (const sg of [SG.coffeeTea, SG.exhibition, SG.coffeeTopic]) await W.acceptSuggestion(sg, s.opts);
  await W.addAssignment(target("product", PR.coffee, "audience"), "adults", s.opts);
  const written = s.db.calls.filter((c) => c.op === "insert" || c.op === "update").flatMap((c) => (Array.isArray(c.payload) ? c.payload : [c.payload]));
  assert.ok(written.length > 0);
  assert.ok(written.every((p) => p.source === undefined || p.source === "admin"), "every explicit write is source='admin'");
  const live = await W.acceptSuggestion(SG.registration, s.opts);
  assert.equal(live.code, "not_writable", "Access is a live public field — Discovery Details stays its editor");
  assert.equal(s.t.classification_suggestions.find((x) => x.id === SG.registration).status, "suggested");
  assert.deepEqual(s.t.events.find((x) => x.id === E.market).entry_modes, []);
  for (const dim of ["audience", "entry_mode", "benefit"]) assert.equal((await W.addAssignment(target("event", E.market, dim), "kids", s.opts)).code, "not_writable", dim);
  assert.equal((await W.addAssignment(target("location", LOC.cafe, "attribute"), "wifi", s.opts)).code, "not_writable", "Attributes deferred");
});

// ------------------------------------------------------------ audit

test("audit: every mutation is recorded as the shared admin actor; no-ops are not", async () => {
  const s = await setup();
  await W.removeAssignment(target("business", B.several, "category"), CAT.b_fashion.id, s.opts);
  await W.removeAssignment(target("business", B.several, "category"), CAT.b_fashion.id, s.opts);
  await W.acceptSuggestion(SG.coffeeTea, s.opts);
  await W.dismissSuggestion(SG.dismissMe, s.opts);
  const actions = s.t.admin_audit_events.map((a) => a.action);
  assert.deepEqual(actions, ["taxonomy_dimension_curate", "taxonomy_assign_remove", "taxonomy_assign_add", "taxonomy_suggestion_accept", "taxonomy_suggestion_dismiss"]);
  assert.ok(s.t.admin_audit_events.every((a) => a.actor_kind === "admin" && a.actor_user_id === null));
  const remove = s.t.admin_audit_events[1];
  assert.equal(remove.target_type, "business");
  assert.equal(remove.target_id, B.several);
  assert.deepEqual(remove.detail, { dimension: "category", value: CAT.b_fashion.id });
});

// ------------------------------------------------------------ boundaries

test("15. staged Categories stay V2-only: writes never touch V1 joins / columns, and staged labels are never public", async () => {
  const s = await setup();
  await W.addAssignment(target("business", B.empty, "category"), CAT.sb_coffee.id, s.opts);
  await W.removeAssignment(target("business", B.several, "category"), CAT.b_fashion.id, s.opts);
  await W.replaceSingle(target("event", E.food, "category"), CAT.se_shopping.id, s.opts);
  await W.replaceSingle(target("event", E.food, "event_type"), TERM.festival.id, s.opts);
  await W.addAssignment(target("location", LOC.cafe, "topic"), TOPIC.coffee.id, s.opts);
  await W.removeAssignment(target("location", LOC.cafe, "category"), CAT.l_cafe.id, s.opts);
  await W.addAssignment(target("product", PR.coffee, "category"), CAT.sp_apparel.id, s.opts);
  assert.deepEqual(v1Writes(s.db), [], "no V1 table or live public column written");
  assert.equal(s.t.locations.find((x) => x.id === LOC.cafe).category_id, CAT.l_cafe.id);
  const shopping = (await load(s, "event", E.food)).domains[0].value;
  assert.equal(shopping.status, "staged");
  assert.equal(P.publicCategoryLabel(shopping), null);
  const src = read("src/lib/taxonomy/admin-writes-server.ts");
  for (const t of V1_TABLES) assert.doesNotMatch(src, new RegExp(`"${t}"`), `${t} never named by the write library`);
  assert.match(src, /location: "locations",/, "locations is only read, to check the entity exists");
});

test("16. Services are not Products", async () => {
  const s = await setup();
  for (const dim of ["category", "topic", "audience"]) {
    const r = await W.addAssignment(target("product", PR.service, dim), dim === "category" ? CAT.sp_apparel.id : dim === "topic" ? TOPIC.coffee.id : "adults", s.opts);
    assert.equal(r.code, "service", dim);
  }
  assert.equal((await C.loadClassifications("product", [PR.service], s.opts)).size, 0);
  assert.equal((await W.addAssignment(target("business", "00000000-0000-4000-8000-000000000000", "category"), CAT.sb_food.id, s.opts)).code, "not_found");
});

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const SRC = walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f));

test("boundaries: server-only write library, pure contract, nothing wired into Admin / public / owner / importer", () => {
  assert.match(read("src/lib/taxonomy/admin-writes-server.ts"), /^import "server-only";/);
  assert.ok(!/server-only|supabase|@\/lib\/admin/.test(read("src/lib/taxonomy/cardinality.ts")), "the contract is pure");
  assert.ok(!/server-only|supabase|@\/lib\/admin/.test(read("src/lib/taxonomy/compat-policy.ts")), "the policy stays pure");
  const importers = SRC.filter((f) => !f.includes("/src/lib/taxonomy/") && /taxonomy\/(cardinality|admin-writes-server|compat-policy|reference-server|classifications-server|aliases-server)/.test(readFileSync(f, "utf8")));
  assert.deepEqual(importers, [], "no route, component, owner form, importer or public surface uses it yet");
  assert.doesNotMatch(read("src/lib/taxonomy/admin-writes-server.ts"), /source: "suggestion"|source: 'suggestion'/);
  for (const f of ["src/lib/discovery/server.ts", "src/lib/discovery/map-server.ts", "src/lib/data.ts"]) assert.doesNotMatch(read(f), /taxonomy\//, f);
});
