// Taxonomy V2 — Pass 3B: the server-only compatibility / query layer.
// Live-derived V1 compatibility (migration rows never durable truth),
// provenance, primary Category, Event orthogonality and Format
// compatibility, Topics (explicit / implied / broader), Appearance own vs
// context, services excluded, suggestions excluded, reverse lookup bounded
// by `within`, batching, aliases, and the boundaries that keep every live
// surface on V1. No network, no database.
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
const R = await import("../src/lib/taxonomy/reference-server.ts");
const C = await import("../src/lib/taxonomy/classifications-server.ts");
const A = await import("../src/lib/taxonomy/aliases-server.ts");
const L = await import("../src/lib/taxonomy/v2-legacy.ts");

const ROOT = process.cwd();
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const NEW_MODULES = ["compat-policy", "reference-server", "classifications-server", "aliases-server"];

// ------------------------------------------------------------ fixture

let n = 0;
const id = () => `${String(++n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const cat = (kind, slug, name, status = "active") => ({ id: id(), kind, slug, name, status });

const CAT = {
  // V1 (active) rows
  b_coffee: cat("business", "coffee", "Coffee, Tea & Beverages"),
  b_bakery: cat("business", "bakery-sweets", "Bakery & Sweets"),
  b_retail: cat("business", "retail", "Retail"),
  b_agency: cat("business", "agency", "Agency"),
  b_other: cat("business", "other", "Other"),
  b_fashion: cat("business", "fashion-apparel", "Fashion & Apparel"),
  b_makers: cat("business", "makers-goods", "Makers & Goods"),
  e_food: cat("event", "food-drink", "Food & Drink"),
  e_arts: cat("event", "arts-culture", "Arts & Culture"),
  e_artex: cat("event", "art-exhibitions", "Art & Exhibitions"),
  e_samples: cat("event", "sample-sales", "Sample Sales"),
  e_biz: cat("event", "business-tech", "Business & Tech"),
  e_community: cat("event", "community-social", "Community & Social"),
  e_seasonal: cat("event", "seasonal-holiday", "Seasonal & Holiday"),
  f_market: cat("event_format", "market", "Market"),
  f_sampling: cat("event_format", "sampling", "Sampling"),
  f_exhibition: cat("event_format", "exhibition", "Exhibition"),
  f_conference: cat("event_format", "conference", "Conference"),
  f_networking: cat("event_format", "networking", "Networking"),
  f_party: cat("event_format", "party-social", "Party & Social"),
  l_cafe: cat("location", "cafe-coffee-shop", "Cafe / Coffee Shop"),
  l_brewery: cat("location", "brewery-taproom", "Brewery / Taproom"),
  p_coffee: cat("product", "coffee", "Coffee"),
  p_clothing: cat("product", "clothing", "Clothing"),
  // V2 (staged) rows
  sb_food: cat("business", "food-beverage", "Food & Beverage", "staged"),
  sb_coffee: cat("business", "coffee-tea", "Coffee & Tea", "staged"),
  sb_bakery: cat("business", "bakery-desserts", "Bakery & Desserts", "staged"),
  sb_services: cat("business", "services", "Services", "staged"),
  sb_arts: cat("business", "arts-makers", "Arts & Makers", "staged"),
  sb_makers: cat("business", "makers", "Makers", "staged"),
  se_shopping: cat("event", "shopping-style", "Shopping & Style", "staged"),
  sl_food: cat("location", "food-drink", "Food & Drink", "staged"),
  sp_bev: cat("product", "beverages", "Beverages", "staged"),
  sp_apparel: cat("product", "apparel", "Apparel", "staged"),
};

const node = (c, parent = null, depth = 1, display = null) => ({ category_id: c.id, kind: c.kind, parent_category_id: parent?.id ?? null, depth, display_name: display, sort_order: 0 });
const TREE = [
  node(CAT.sb_food), node(CAT.sb_coffee, CAT.sb_food, 2), node(CAT.sb_bakery, CAT.sb_food, 2), node(CAT.sb_services),
  node(CAT.b_fashion), node(CAT.sb_arts), node(CAT.sb_makers, CAT.sb_arts, 2),
  node(CAT.e_food), node(CAT.e_arts), node(CAT.e_biz), node(CAT.se_shopping),
  node(CAT.sl_food), node(CAT.l_cafe, CAT.sl_food, 2, "Café & Coffee Shop"),
  node(CAT.sp_bev), node(CAT.p_coffee, CAT.sp_bev, 2), node(CAT.sp_apparel),
];

const term = (vocabulary, slug, name) => ({ id: id(), vocabulary, slug, name, status: "active" });
const TERM = {
  market: term("event_type", "market", "Market"),
  exhibition: term("event_type", "exhibition", "Exhibition"),
  conference: term("event_type", "conference", "Conference"),
  networking: term("event_type", "networking", "Networking"),
  shopping: term("event_type", "shopping-event", "Shopping Event"),
  party: term("event_type", "party", "Party"),
  sampling: term("experience_mechanic", "sampling", "Sampling"),
  samplesale: term("experience_mechanic", "sample-sale", "Sample Sale"),
  popupMech: term("experience_mechanic", "pop-up", "Pop-Up"),
  booth: term("appearance_type", "vendor-booth", "Vendor Booth"),
  popupApp: term("appearance_type", "pop-up", "Pop-Up"),
  oppAct: term("opportunity_category", "activation-sampling", "Activation & Sampling"),
  oppRetail: term("opportunity_category", "retail-vending", "Retail & Vending"),
};

const topic = (slug, name, broader = null) => ({ id: id(), slug, name, kind: "subject", broader_topic_id: broader?.id ?? null, applies_to: ["business", "location", "event", "product", "appearance"], status: "active" });
const T_FOOD = topic("food", "Food");
const TOPIC = { food: T_FOOD, coffee: topic("coffee", "Coffee", T_FOOD), art: topic("art", "Art"), fashion: topic("fashion", "Fashion"), retired: { ...topic("old", "Old"), status: "retired" } };

const CAT_TOPICS = [
  { category_id: CAT.sb_food.id, topic_id: TOPIC.food.id },
  { category_id: CAT.sb_coffee.id, topic_id: TOPIC.coffee.id },
  { category_id: CAT.l_cafe.id, topic_id: TOPIC.coffee.id },
  { category_id: CAT.p_coffee.id, topic_id: TOPIC.coffee.id },
];

const MAPPINGS = L.LEGACY_MAPPINGS.map((m) => ({ legacy_source: "category", legacy_kind: m.kind, legacy_slug: m.slug, targets: m.targets, mapping_confidence: L.mappingStatus(m), status: "draft" }));

const ent = () => id();
const B = { mixed: ent(), models: ent(), removed: ent(), explicit: ent(), several: ent() };
const E = { foodMarket: ent(), shopping: ent(), arts: ent(), conf: ent(), nothing: ent(), primary: ent() };
const LOC = { cafe: ent(), brewery: ent(), admin: ent() };
const PR = { coffee: ent(), service: ent(), clothing: ent() };
const AP = { linked: ent(), standalone: ent(), bare: ent() };
const OP = { act: ent(), changed: ent(), admin: ent(), other: ent() };

function tables() {
  return {
    categories: Object.values(CAT),
    category_tree_v2: TREE,
    taxonomy_terms: Object.values(TERM),
    topics: Object.values(TOPIC),
    category_topics: CAT_TOPICS,
    taxonomy_legacy_mappings: [...MAPPINGS, { legacy_source: "discovery_topic", legacy_kind: "", legacy_slug: "pop-ups", targets: [], mapping_confidence: null, status: "draft" }],
    // ---- Businesses
    businesses: [
      { id: B.mixed, business_models: [] },
      { id: B.models, business_models: ["retailer", "agency"] },
      { id: B.removed, business_models: ["agency"] },
      { id: B.explicit, business_models: [] },
      { id: B.several, business_models: [] },
    ],
    business_categories: [
      { business_id: B.mixed, category_id: CAT.b_coffee.id },
      { business_id: B.mixed, category_id: CAT.b_bakery.id },
      { business_id: B.models, category_id: CAT.b_retail.id },
      { business_id: B.removed, category_id: CAT.b_other.id },
      { business_id: B.explicit, category_id: CAT.b_coffee.id },
      { business_id: B.several, category_id: CAT.b_fashion.id },
      { business_id: B.several, category_id: CAT.b_makers.id },
    ],
    business_category_assignments: [
      // Pass 2 snapshot rows: food-beverage (still derivable) and a STALE
      // Services row (its V1 'agency' link was removed after the migration).
      { business_id: B.mixed, category_id: CAT.sb_food.id, is_primary: false, source: "migration" },
      { business_id: B.removed, category_id: CAT.sb_services.id, is_primary: true, source: "migration" },
      { business_id: B.explicit, category_id: CAT.sb_coffee.id, is_primary: true, source: "admin" },
    ],
    business_topics: [
      { business_id: B.explicit, topic_id: TOPIC.coffee.id, source: "owner" },
      { business_id: B.removed, topic_id: TOPIC.art.id, source: "migration" },
    ],
    classification_field_sources: [
      { entity_type: "business", entity_id: B.models, field: "business_models", source: "migration" },
      { entity_type: "business", entity_id: B.removed, field: "business_models", source: "migration" },
      { entity_type: "opportunity_listing", entity_id: OP.act, field: "opportunity_category", source: "migration" },
      { entity_type: "opportunity_listing", entity_id: OP.changed, field: "opportunity_category", source: "migration" },
      { entity_type: "opportunity_listing", entity_id: OP.admin, field: "opportunity_category", source: "admin" },
    ],
    // ---- Events
    events: [
      { id: E.foodMarket, benefits: ["free_admission"], audience: ["family", "kids"], entry_modes: ["rsvp", "registration"], setting: "outdoor", price_kind: null, price_min_cents: null, price_max_cents: null, currency: null, is_free: null, family_friendly: null, min_age: null, max_age: null },
      { id: E.shopping, benefits: [], audience: [], entry_modes: [], setting: null, price_kind: "paid", price_min_cents: 500, price_max_cents: 2500, currency: "USD", is_free: true, family_friendly: true, min_age: 21, max_age: null },
      { id: E.arts, benefits: ["free_samples"], audience: [], entry_modes: [], setting: null, price_kind: null, is_free: false, family_friendly: null, min_age: null, max_age: null },
      { id: E.conf, benefits: [], audience: [], entry_modes: [], setting: "bogus", price_kind: null, is_free: null, family_friendly: null, min_age: null, max_age: null },
      { id: E.nothing, benefits: [], audience: [], entry_modes: [], setting: null, price_kind: null, is_free: null, family_friendly: null, min_age: null, max_age: null },
      { id: E.primary, benefits: [], audience: [], entry_modes: [], setting: null, price_kind: null, is_free: null, family_friendly: null, min_age: null, max_age: null },
    ],
    event_categories: [
      { event_id: E.foodMarket, category_id: CAT.e_food.id },
      { event_id: E.shopping, category_id: CAT.e_samples.id },
      { event_id: E.arts, category_id: CAT.e_artex.id },
      { event_id: E.conf, category_id: CAT.e_biz.id },
      { event_id: E.nothing, category_id: CAT.e_community.id },
      { event_id: E.nothing, category_id: CAT.e_seasonal.id },
    ],
    event_formats: [
      { event_id: E.foodMarket, category_id: CAT.f_market.id },
      { event_id: E.foodMarket, category_id: CAT.f_sampling.id },
      { event_id: E.arts, category_id: CAT.f_exhibition.id },
      { event_id: E.conf, category_id: CAT.f_conference.id },
      { event_id: E.conf, category_id: CAT.f_networking.id },
      { event_id: E.nothing, category_id: CAT.f_party.id },
      { event_id: E.primary, category_id: CAT.f_market.id },
    ],
    event_category_assignments: [{ event_id: E.foodMarket, category_id: CAT.e_food.id, is_primary: true, source: "migration" }],
    event_type_assignments: [
      // Stale: the conference Event lost its V1 'market' Format after the migration.
      { event_id: E.conf, term_id: TERM.market.id, is_primary: true, source: "migration" },
      { event_id: E.primary, term_id: TERM.market.id, is_primary: true, source: "admin" },
      { event_id: E.primary, term_id: TERM.exhibition.id, is_primary: false, source: "admin" },
      // Unverifiable 'suggestion' provenance: never counts.
      { event_id: E.nothing, term_id: TERM.party.id, is_primary: true, source: "suggestion" },
    ],
    event_mechanic_assignments: [],
    event_topics: [],
    // ---- Locations
    locations: [
      { id: LOC.cafe, category_id: CAT.l_cafe.id, attributes: { wifi: true, seating: ["indoor", "patio"] } },
      { id: LOC.brewery, category_id: CAT.l_brewery.id, attributes: {} },
      { id: LOC.admin, category_id: null, attributes: {} },
    ],
    location_categories: [
      { location_id: LOC.cafe, category_id: CAT.l_cafe.id, is_primary: true, source: "migration" },
      { location_id: LOC.admin, category_id: CAT.l_cafe.id, is_primary: false, source: "admin" },
    ],
    location_topics: [],
    // ---- Products (one Service)
    products: [
      { id: PR.coffee, product_type: "product", attributes: {}, audience: ["adults"] },
      { id: PR.service, product_type: "service", attributes: {}, audience: [] },
      { id: PR.clothing, product_type: "product", attributes: {}, audience: [] },
    ],
    product_categories: [
      { product_id: PR.coffee, category_id: CAT.p_coffee.id },
      { product_id: PR.service, category_id: CAT.p_clothing.id },
      { product_id: PR.clothing, category_id: CAT.p_clothing.id },
    ],
    product_category_assignments: [{ product_id: PR.service, category_id: CAT.sp_apparel.id, is_primary: true, source: "admin" }],
    product_topics: [],
    // ---- Appearances
    appearances: [
      { id: AP.linked, event_id: E.foodMarket, business_id: B.explicit, appearance_type_id: TERM.booth.id, benefits: ["free_samples"] },
      { id: AP.standalone, event_id: null, business_id: null, appearance_type_id: null, benefits: [] },
      { id: AP.bare, event_id: E.foodMarket, business_id: null, appearance_type_id: null, benefits: [] },
    ],
    appearance_topics: [{ appearance_id: AP.linked, topic_id: TOPIC.fashion.id, source: "admin" }],
    // ---- Opportunity Listings
    opportunity_listings: [
      { id: OP.act, opportunity_type: "activation", opportunity_category_id: TERM.oppAct.id },
      { id: OP.changed, opportunity_type: "vending", opportunity_category_id: TERM.oppAct.id },
      { id: OP.admin, opportunity_type: "sponsorship", opportunity_category_id: TERM.oppRetail.id },
      { id: OP.other, opportunity_type: "other", opportunity_category_id: null },
    ],
    // ---- Open suggestions — must never be read.
    classification_suggestions: [
      { entity_type: "event", entity_id: E.nothing, dimension: "event_type", value: "party", status: "suggested" },
      { entity_type: "appearance", entity_id: AP.bare, dimension: "appearance_type", value: "vendor-booth", status: "suggested" },
      { entity_type: "business", entity_id: B.removed, dimension: "category", value: "services", status: "suggested" },
    ],
    // ---- Aliases + V1 Discovery Topics
    taxonomy_aliases: [
      { phrase: "pop up", dimension: "experience_mechanic", target_id: TERM.popupMech.id, target_code: null, entity_types: ["event"], priority: 0, status: "active", source: "migration" },
      { phrase: "pop up", dimension: "appearance_type", target_id: TERM.popupApp.id, target_code: null, entity_types: ["appearance"], priority: 1, status: "active", source: "migration" },
      { phrase: "kids", dimension: "audience", target_id: null, target_code: "kids", entity_types: null, priority: 0, status: "active", source: "migration" },
      { phrase: "food and beverage", dimension: "category", target_id: CAT.sb_food.id, target_code: null, entity_types: ["business"], priority: 0, status: "active", source: "admin" },
      { phrase: "fashion", dimension: "topic", target_id: TOPIC.fashion.id, target_code: null, entity_types: null, priority: 0, status: "active", source: "migration" },
      { phrase: "espresso", dimension: "topic", target_id: TOPIC.coffee.id, target_code: null, entity_types: null, priority: 0, status: "active", source: "migration" },
      { phrase: "kids", dimension: "audience", target_id: null, target_code: "family", entity_types: null, priority: 0, status: "inactive", source: "admin" },
    ],
    discovery_topics: [
      { slug: "pop-ups", name: "Pop-Ups", aliases: ["pop up", "pop ups", "popup"], is_active: true },
      { slug: "family-friendly", name: "Family Friendly", aliases: ["family", "kids"], is_active: true },
      { slug: "fashion", name: "Fashion", aliases: ["style"], is_active: true },
    ],
  };
}

async function setup() {
  const db = fakeDb(tables());
  const reference = await R.buildTaxonomyReference(db);
  return { db, reference, opts: { client: db, reference } };
}
const slugs = (xs) => xs.map((x) => x.value.slug);
const kinds = (c) => c.provenance.map((p) => p.kind);

// ------------------------------------------------------------ policy

test("policy: every dimension has one central mode; shared Event columns stay V1; V1-backed dims never trust migration rows", () => {
  assert.deepEqual(Object.keys(P.COMPAT_POLICY).sort(), [...P.COMPAT_DIMENSIONS].sort());
  for (const d of ["business_category", "location_category", "event_domain", "product_category", "event_type", "experience_mechanic", "topic", "business_model"]) assert.equal(P.COMPAT_POLICY[d].mode, "union_live", d);
  assert.equal(P.COMPAT_POLICY.opportunity_category.mode, "v2_first_v1_fallback");
  assert.equal(P.COMPAT_POLICY.price.mode, "v2_first_v1_fallback");
  for (const d of ["appearance_type", "benefit", "setting", "attribute"]) assert.equal(P.COMPAT_POLICY[d].mode, "v2_only", d);
  assert.equal(P.COMPAT_POLICY.audience.mode, "v1_only");
  assert.equal(P.COMPAT_POLICY.entry_mode.mode, "v1_only");
  assert.equal(P.isDurableFor("event_type", "migration"), false);
  assert.equal(P.isDurableFor("business_category", "admin"), true);
  assert.equal(P.isDurableFor("topic", "owner"), true);
  assert.equal(P.isDurableFor("event_type", "importer"), true);
  assert.equal(P.isDurableFor("opportunity_category", null), true, "a column with no recorded source is an explicit value");
  assert.equal(P.isDurableFor("event_type", "nonsense"), false);
  // 'suggestion' has no persisted review proof → never confirmed, for any
  // dimension (V1-backed or V2-only), until an acceptance workflow exists.
  for (const d of P.COMPAT_DIMENSIONS) assert.equal(P.isDurableFor(d, "suggestion"), false, d);
  assert.deepEqual([...P.DURABLE_SOURCES], ["admin", "owner", "importer"]);
  assert.equal(C.policyFor("product", "audience").mode, "v2_only", "Product Audience is its own V2 column");
  assert.equal(C.policyFor("event", "audience").mode, "v1_only");
});

test("legacy derivation: only deterministic targets; review_required, intentionally unmapped and retired prove nothing", () => {
  const map = new Map(MAPPINGS.map((m) => [`${m.legacy_kind}:${m.legacy_slug}`, { legacyKind: m.legacy_kind, legacySlug: m.legacy_slug, targets: m.targets, mappingConfidence: m.mapping_confidence, status: m.status }]));
  const of = (k, s) => map.get(`${k}:${s}`);
  // Mixed row: V1 "Coffee" proves Food & Beverage but not Coffee & Tea or the Topic.
  assert.deepEqual(P.deterministicTargets(of("business", "coffee")).map((t) => `${t.dimension}:${t.value}`), ["category:food-beverage"]);
  assert.deepEqual(P.deterministicTargets(of("event", "community-social")), [], "review-required row");
  assert.deepEqual(P.deterministicTargets(of("event", "seasonal-holiday")), [], "intentionally unmapped");
  assert.deepEqual(P.deterministicTargets(of("event_format", "party-social")), [], "party-social stays review-required");
  assert.deepEqual(P.deterministicTargets({ ...of("event_format", "market"), status: "retired" }), []);
  const d = P.deriveFromLegacy([{ entityId: "e1", legacyKind: "event_format", legacySlug: "market", store: "event_formats" }], of);
  assert.deepEqual(d.map((t) => [t.dimension, t.value, t.categoryKind, t.provenance.kind, t.provenance.store]), [["event_type", "market", "event", "legacy", "event_formats"]]);
});

test("opportunity_type → Opportunity Category mirrors the Pass 2 migration (7i)", () => {
  const sql = read("supabase/migrations/20261117000000_taxonomy_v2_staged_categories.sql");
  for (const [type, slug] of Object.entries(P.OPPORTUNITY_TYPE_CATEGORY)) assert.ok(sql.includes(`('${type}', '${slug}')`), `${type} → ${slug}`);
  assert.equal(P.OPPORTUNITY_TYPE_CATEGORY.other, undefined);
});

test("merge: one value, every provenance; primary explicit, single, or none", () => {
  const a = { id: "a" }, b = { id: "b" };
  const legacy = { kind: "legacy", store: "event_formats", legacy: "market" };
  const assigned = { kind: "assigned", source: "admin", store: "event_type_assignments" };
  const merged = P.mergeClassified([{ value: a, provenance: [legacy] }, { value: a, provenance: [assigned, legacy] }, { value: b, provenance: [legacy] }], (x) => x.id);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].provenance, [legacy, assigned]);
  assert.equal(P.choosePrimary(merged, new Set(["b"])).value.id, "b", "explicit primary");
  assert.equal(P.choosePrimary(merged, new Set()), null, "never an arbitrary pick among several");
  assert.equal(P.choosePrimary([merged[0]], new Set()).value.id, "a", "exactly one → primary");
  assert.equal(P.choosePrimary([merged[0]], new Set(["zzz"])).value.id, "a", "an explicit primary that is not effective is ignored");
});

// ------------------------------------------------------------ reference + staged

test("reference: staged Categories resolve internally with their status; V2 tree ≠ V1 parent_id; public label refuses staged", async () => {
  const { reference: ref } = await setup();
  const food = ref.categoryBySlug("business", "food-beverage");
  assert.equal(food.status, "staged");
  assert.equal(food.label, "Food & Beverage");
  assert.equal(P.publicCategoryLabel(food), null, "staged label never public");
  const cafe = ref.categoryBySlug("location", "cafe-coffee-shop");
  assert.equal(cafe.status, "active");
  assert.equal(P.publicCategoryLabel(cafe), "Café & Coffee Shop", "V2 display name for an active row");
  assert.deepEqual(cafe.ancestorIds, [CAT.sl_food.id], "V2 parent from category_tree_v2");
  assert.equal(ref.categoryBySlug("business", "coffee"), undefined, "V1-only rows are not V2 tree members");
  assert.equal(ref.v1Category(CAT.b_coffee.id).slug, "coffee");
  assert.deepEqual(ref.withDescendants(CAT.sb_food.id).sort(), [CAT.sb_food.id, CAT.sb_coffee.id, CAT.sb_bakery.id].sort());
  assert.equal(ref.topicBySlug("old"), undefined, "retired Topics never classify");
  assert.equal(ref.mapping("discovery_topic", "pop-ups"), undefined, "only category mappings are loaded");
});

// ------------------------------------------------------------ Businesses

test("Business: live V1 derivation, stale migration rows ignored, redundant derived ancestor pruned, inferred primary", async () => {
  const { opts } = await setup();
  const m = await C.loadClassifications("business", Object.values(B), opts);
  const mixed = m.get(B.mixed);
  // V1 Coffee → Food & Beverage, V1 Bakery & Sweets → Bakery & Desserts; the
  // derived ancestor is implied by its descendant.
  assert.deepEqual(slugs(mixed.categories), ["bakery-desserts"]);
  assert.equal(mixed.primaryCategory.value.slug, "bakery-desserts", "inferred from exactly one");
  assert.deepEqual(kinds(mixed.categories[0]), ["legacy"]);
  assert.deepEqual(mixed.topics.implied.map((t) => [t.value.slug, t.provenance[0].viaCategoryId]), [["food", CAT.sb_food.id]], "implied through V2 ancestry");
  assert.deepEqual(mixed.topics.explicit, [], "the review-required Coffee Topic is not confirmed");

  const removed = m.get(B.removed);
  assert.deepEqual(removed.categories, [], "the stale migration Services row does not survive its V1 link's removal");
  assert.equal(removed.primaryCategory, null);
  assert.deepEqual(removed.businessModels, [], "migration-written business_models are re-derived, not trusted");
  assert.deepEqual(removed.topics.explicit, [], "migration Topic rows are not durable either");

  const models = m.get(B.models);
  assert.deepEqual(models.businessModels.map((x) => x.value), ["retailer"], "only what CURRENT V1 proves");
  assert.equal(models.businessModels[0].provenance[0].legacy, "retail");
});

test("Business: durable assignment + explicit primary; explicit and implied Topic keep both provenances; several Categories → no primary", async () => {
  const { opts } = await setup();
  const m = await C.loadClassifications("business", [B.explicit, B.several], opts);
  const ex = m.get(B.explicit);
  assert.deepEqual(slugs(ex.categories), ["coffee-tea"], "derived Food & Beverage pruned below the assigned Coffee & Tea");
  assert.deepEqual(ex.categories[0].provenance, [{ kind: "assigned", source: "admin", store: "business_category_assignments" }]);
  assert.equal(ex.primaryCategory.value.slug, "coffee-tea");
  const eff = P.effectiveTopics(ex.topics);
  const coffee = eff.find((t) => t.value.slug === "coffee");
  assert.deepEqual(kinds(coffee).sort(), ["assigned", "implied"], "one Topic, both reasons");
  assert.equal(eff.filter((t) => t.value.slug === "coffee").length, 1);
  assert.ok(eff.some((t) => t.value.slug === "food"), "ancestor-implied Food");
  const sev = m.get(B.several);
  assert.deepEqual(slugs(sev.categories).sort(), ["fashion-apparel", "makers"]);
  assert.equal(sev.primaryCategory, null);
  assert.deepEqual(sev.businessModels.map((x) => x.value), ["maker_artist"]);
});

// ------------------------------------------------------------ Events

test("Event: Domain / Type / Mechanic orthogonal; Formats compatible; Food & Drink + Market + Sampling", async () => {
  const { opts } = await setup();
  const m = await C.loadClassifications("event", Object.values(E), opts);
  const fm = m.get(E.foodMarket);
  assert.deepEqual(slugs(fm.domains), ["food-drink"]);
  assert.deepEqual(kinds(fm.domains[0]), ["legacy"], "the migration Domain row is re-derived, not read");
  assert.deepEqual(slugs(fm.types), ["market"]);
  assert.equal(fm.types[0].provenance[0].store, "event_formats");
  assert.deepEqual(slugs(fm.mechanics), ["sampling"]);
  assert.deepEqual(fm.legacy.formats.sort(), ["market", "sampling"]);
  assert.deepEqual(fm.legacy.categories, ["food-drink"]);
  // A Mechanic never creates a Benefit: Sampling ≠ Free Samples.
  assert.deepEqual(fm.benefits, [], "'free_admission' is a V1 Benefit, not V2; Sampling adds nothing");
  assert.equal(fm.price.kind.value, "free", "V1 free_admission → Price free (fallback)");
  assert.equal(fm.price.kind.provenance[0].kind, "legacy");
  assert.deepEqual(fm.audience.map((a) => a.value), ["family", "kids"]);
  assert.deepEqual(fm.entryModes.map((a) => a.value), ["rsvp", "registration"], "RSVP and Registration stay distinct");
  assert.equal(fm.audience[0].provenance[0].store, "events.audience");
  assert.equal(fm.setting.value, "outdoor");
});

test("Event: Shopping & Style (staged) + Shopping Event + Sample Sale; Arts & Culture + Exhibition; Business & Tech + Conference + Networking", async () => {
  const { opts } = await setup();
  const m = await C.loadClassifications("event", [E.shopping, E.arts, E.conf], opts);
  const sh = m.get(E.shopping);
  assert.deepEqual([slugs(sh.domains), slugs(sh.types), slugs(sh.mechanics)], [["shopping-style"], ["shopping-event"], ["sample-sale"]]);
  assert.equal(sh.domains[0].value.status, "staged");
  assert.equal(P.publicCategoryLabel(sh.domains[0].value), null);
  assert.equal(sh.price.kind.value, "paid", "V2 price_kind wins over V1 is_free");
  assert.deepEqual([sh.price.minCents, sh.price.maxCents, sh.price.currency, sh.age.min], [500, 2500, "USD", 21]);
  assert.equal(sh.legacy.familyFriendly, true);

  const ar = m.get(E.arts);
  assert.deepEqual(slugs(ar.domains), ["arts-culture"]);
  assert.deepEqual(slugs(ar.types), ["exhibition"], "proved by the Exhibition Format, not by the review-required category target");
  assert.deepEqual(ar.types[0].provenance.map((p) => p.store), ["event_formats"]);
  assert.deepEqual(ar.topics.explicit.map((t) => t.value.slug), ["art"]);
  assert.deepEqual(ar.benefits.map((b) => b.value), ["free_samples"], "an explicitly stored Benefit");
  assert.equal(ar.price.kind.value, "paid");

  const cf = m.get(E.conf);
  assert.deepEqual(slugs(cf.domains), ["business-tech"]);
  assert.deepEqual(slugs(cf.types).sort(), ["conference", "networking"], "several Event Types");
  assert.equal(cf.primaryType, null, "no arbitrary primary; the stale migration 'market' primary is ignored");
  assert.equal(cf.setting, null, "unknown stored values are dropped");
});

test("Event: party-social / review / unmapped contribute nothing; durable admin Types keep their explicit primary and add V1 provenance", async () => {
  const { opts } = await setup();
  const m = await C.loadClassifications("event", [E.nothing, E.primary], opts);
  const no = m.get(E.nothing);
  assert.deepEqual([no.domains, no.types, no.mechanics, no.topics.explicit], [[], [], [], []]);
  assert.deepEqual(no.legacy.formats, ["party-social"]);
  const pr = m.get(E.primary);
  assert.deepEqual(slugs(pr.types).sort(), ["exhibition", "market"]);
  assert.equal(pr.primaryType.value.slug, "market");
  assert.deepEqual(kinds(pr.types.find((t) => t.value.slug === "market")).sort(), ["assigned", "legacy"]);
});

test("V1 changes supersede the snapshot: a new V1 value after the migration appears without any V2 row", async () => {
  const t = tables();
  const fresh = ent();
  t.events.push({ id: fresh, benefits: [], audience: [], entry_modes: [] });
  t.event_formats.push({ event_id: fresh, category_id: CAT.f_market.id });
  const db = fakeDb(t);
  const m = await C.loadClassifications("event", [fresh], { client: db, reference: await R.buildTaxonomyReference(db) });
  assert.deepEqual(slugs(m.get(fresh).types), ["market"]);
});

// ------------------------------------------------------------ Locations / Products

test("Location: V1 category_id derivation, durable assignment, implied Topic, stored attributes; no hours", async () => {
  const { opts, db } = await setup();
  const m = await C.loadClassifications("location", Object.values(LOC), opts);
  assert.deepEqual(slugs(m.get(LOC.cafe).categories), ["cafe-coffee-shop"]);
  assert.equal(m.get(LOC.cafe).primaryCategory.value.slug, "cafe-coffee-shop");
  assert.deepEqual(kinds(m.get(LOC.cafe).categories[0]), ["legacy"]);
  assert.deepEqual(m.get(LOC.cafe).topics.implied.map((t) => t.value.slug), ["coffee"]);
  assert.deepEqual(m.get(LOC.cafe).attributes, { wifi: true, seating: ["indoor", "patio"] });
  assert.deepEqual(slugs(m.get(LOC.brewery).categories), ["food-drink"], "Brewery proves Food & Drink, not Bar");
  assert.deepEqual(kinds(m.get(LOC.admin).categories[0]), ["assigned"]);
  assert.ok(!db.calls.some((c) => /location_hours|hours/.test(c.table)), "hours are a temporal concern");
});

test("Product: classification for Products; Services excluded entirely", async () => {
  const { opts } = await setup();
  const m = await C.loadClassifications("product", Object.values(PR), opts);
  assert.deepEqual([...m.keys()].sort(), [PR.coffee, PR.clothing].sort(), "the Service has no V2 Product classification");
  assert.deepEqual(slugs(m.get(PR.coffee).categories), ["coffee"]);
  assert.deepEqual(m.get(PR.coffee).topics.implied.map((t) => t.value.slug), ["coffee"]);
  assert.deepEqual(m.get(PR.coffee).audience.map((a) => a.value), ["adults"]);
  assert.deepEqual(slugs(m.get(PR.clothing).categories), ["apparel"]);
  const ids = await C.findEntityIds({ entity: "product", dimension: "product_category", values: ["apparel"], within: Object.values(PR) }, opts);
  assert.deepEqual([...ids], [PR.clothing], "even an admin assignment on a Service is never a Product match");
});

// ------------------------------------------------------------ Appearances

test("Appearance: own classification separate from contextual Event / Brand; standalone works", async () => {
  const { opts } = await setup();
  const m = await C.loadClassifications("appearance", Object.values(AP), opts);
  const ln = m.get(AP.linked);
  assert.equal(ln.own.appearanceType.value.slug, "vendor-booth");
  assert.deepEqual(ln.own.appearanceType.provenance, [{ kind: "assigned", source: "unrecorded", store: "appearances.appearance_type_id" }]);
  assert.deepEqual(ln.own.topics.map((t) => t.value.slug), ["fashion"]);
  assert.deepEqual(ln.own.benefits.map((b) => b.value), ["free_samples"]);
  assert.deepEqual(slugs(ln.context.event.domains), ["food-drink"]);
  assert.deepEqual(slugs(ln.context.event.mechanics), ["sampling"]);
  for (const x of [...ln.context.event.domains, ...ln.context.event.types, ...ln.context.event.mechanics, ...ln.context.brand.categories]) {
    assert.ok(x.provenance.every((p) => p.kind === "context"), "context is always labelled context");
  }
  assert.equal(ln.context.event.domains[0].provenance[0].from, "event");
  assert.equal(ln.context.brand.categories[0].provenance[0].from, "brand");
  assert.ok(ln.own.topics.every((t) => t.provenance.every(P.isOwnProvenance)));
  const bare = m.get(AP.bare);
  assert.equal(bare.own.appearanceType, null, "never inherited from the Event (nor from an open suggestion)");
  assert.deepEqual(bare.own.topics, []);
  assert.ok(bare.context.event, "the Event context is still available as context");
  const st = m.get(AP.standalone);
  assert.deepEqual(st.context, { event: null, brand: null });
  const types = await C.findEntityIds({ entity: "appearance", dimension: "appearance_type", values: ["vendor-booth"], within: Object.values(AP) }, opts);
  assert.deepEqual([...types], [AP.linked]);
});

// ------------------------------------------------------------ Opportunities

test("Opportunity Category: durable V2 first, else CURRENT opportunity_type; a migration copy never outlives a type change", async () => {
  const { opts } = await setup();
  const m = await C.loadClassifications("opportunity", Object.values(OP), opts);
  assert.equal(m.get(OP.act).category.value.slug, "activation-sampling");
  assert.equal(m.get(OP.act).category.provenance[0].kind, "legacy");
  assert.equal(m.get(OP.changed).category.value.slug, "retail-vending", "stale migration value superseded");
  assert.equal(m.get(OP.admin).category.value.slug, "retail-vending");
  assert.equal(m.get(OP.admin).category.provenance[0].kind, "assigned");
  assert.equal(m.get(OP.other).category, null);
});

// ------------------------------------------------------------ suggestions

test("suggestions: never read, never classify", async () => {
  const { opts, db } = await setup();
  for (const e of ["business", "location", "event", "product", "appearance", "opportunity"]) {
    const ids = { business: B, location: LOC, event: E, product: PR, appearance: AP, opportunity: OP }[e];
    await C.loadClassifications(e, Object.values(ids), opts);
  }
  await C.findEntityIds({ entity: "event", dimension: "event_type", values: ["party"], within: Object.values(E) }, opts);
  await A.resolveTaxonomyAliases(["pop up"], opts);
  assert.ok(!db.calls.some((c) => c.table === "classification_suggestions"));
  for (const f of NEW_MODULES) assert.ok(!/from\(\s*["']classification_suggestions/.test(read(`src/lib/taxonomy/${f}.ts`)), f);
  assert.ok(!/suggests_benefits/.test(read("src/lib/taxonomy/reference-server.ts")), "Mechanic → Benefit hints are not even loaded");
  const party = await C.findEntityIds({ entity: "event", dimension: "event_type", values: ["party"], within: Object.values(E) }, opts);
  assert.equal(party.size, 0);
});

// ------------------------------------------------------------ reverse lookup

test("findEntityIds: requires `within`, stays inside it, any/all, live V1 + durable V2, refuses V1-only dims", async () => {
  const { opts } = await setup();
  await assert.rejects(C.findEntityIds({ entity: "event", dimension: "event_type", values: ["market"] }, opts), /within/);
  await assert.rejects(C.findEntityIds({ entity: "event", dimension: "event_type", values: ["market"], within: Array.from({ length: C.MAX_WITHIN + 1 }, (_, i) => String(i)) }, opts), /limited/);
  await assert.rejects(C.findEntityIds({ entity: "event", dimension: "audience", values: ["family"], within: [E.foodMarket] }, opts), /stays V1/);
  await assert.rejects(C.findEntityIds({ entity: "location", dimension: "event_type", values: ["market"], within: [LOC.cafe] }, opts), /has no/);

  const all = Object.values(E);
  const market = await C.findEntityIds({ entity: "event", dimension: "event_type", values: ["market"], within: all }, opts);
  assert.deepEqual([...market].sort(), [E.foodMarket, E.primary].sort(), "V1 Format + durable admin row; the stale migration row on E.conf is not a match");
  const bounded = await C.findEntityIds({ entity: "event", dimension: "event_type", values: ["market"], within: [E.primary, E.conf] }, opts);
  assert.deepEqual([...bounded], [E.primary], "never outside the candidate set");
  const any = await C.findEntityIds({ entity: "event", dimension: "event_type", values: ["conference", "exhibition"], match: "any", within: all }, opts);
  assert.deepEqual([...any].sort(), [E.arts, E.conf, E.primary].sort());
  const both = await C.findEntityIds({ entity: "event", dimension: "event_type", values: ["conference", "networking"], match: "all", within: all }, opts);
  assert.deepEqual([...both], [E.conf]);
  const none = await C.findEntityIds({ entity: "event", dimension: "event_type", values: ["market"], within: [] }, opts);
  assert.equal(none.size, 0);
  const free = await C.findEntityIds({ entity: "event", dimension: "price", values: ["free"], within: all }, opts);
  assert.deepEqual([...free], [E.foodMarket]);
});

test("findEntityIds: Category descendants, duplicate suppression, Topic scope and query-time broader expansion", async () => {
  const { opts } = await setup();
  const bizAll = Object.values(B);
  const parent = await C.findEntityIds({ entity: "business", dimension: "business_category", values: ["food-beverage"], within: bizAll }, opts);
  assert.deepEqual([...parent].sort(), [B.mixed, B.explicit].sort(), "a parent matches its V2 descendants");
  const exact = await C.findEntityIds({ entity: "business", dimension: "business_category", values: ["food-beverage"], within: bizAll, descendants: false }, opts);
  assert.equal(exact.size, 0, "the derived ancestor was pruned");
  const twice = await C.findEntityIds({ entity: "business", dimension: "business_category", values: ["coffee-tea", "coffee-tea"], within: bizAll }, opts);
  assert.deepEqual([...twice], [B.explicit]);
  const locs = Object.values(LOC);
  const food = await C.findEntityIds({ entity: "location", dimension: "topic", values: ["food"], within: locs }, opts);
  assert.equal(food.size, 0, "Coffee is not Food unless the query expands");
  const wide = await C.findEntityIds({ entity: "location", dimension: "topic", values: ["food"], within: locs, includeNarrower: true }, opts);
  assert.deepEqual([...wide].sort(), [LOC.cafe, LOC.admin].sort());
  const explicitOnly = await C.findEntityIds({ entity: "location", dimension: "topic", values: ["coffee"], within: locs, topicScope: "explicit" }, opts);
  assert.equal(explicitOnly.size, 0, "implied Topics are separable");
  const wifi = await C.findEntityIds({ entity: "location", dimension: "attribute", values: ["wifi", "seating:patio"], match: "all", within: locs }, opts);
  assert.deepEqual([...wifi], [LOC.cafe]);
  // Broader expansion is query-time only: the stored classification is untouched.
  const m = await C.loadClassifications("location", [LOC.cafe], opts);
  assert.deepEqual(P.effectiveTopics(m.get(LOC.cafe).topics).map((t) => t.value.slug), ["coffee"]);
});

// ------------------------------------------------------------ batching

test("batching: a bounded number of reads per table, independent of entity count", async () => {
  const t = tables();
  const many = Array.from({ length: 450 }, () => ent());
  for (const e of many) {
    t.events.push({ id: e, benefits: [], audience: [], entry_modes: [] });
    t.event_formats.push({ event_id: e, category_id: CAT.f_market.id });
  }
  const db = fakeDb(t);
  const reference = await R.buildTaxonomyReference(db);
  const before = db.calls.length;
  const m = await C.loadClassifications("event", many, { client: db, reference });
  assert.equal(m.size, 450);
  const calls = db.calls.slice(before);
  const perTable = {};
  for (const c of calls) perTable[c.table] = (perTable[c.table] ?? 0) + 1;
  const chunks = Math.ceil(450 / C.ID_CHUNK);
  for (const [table, count] of Object.entries(perTable)) assert.equal(count, chunks, `${table}: one read per ${C.ID_CHUNK} ids`);
  assert.deepEqual(Object.keys(perTable).sort(), ["event_categories", "event_category_assignments", "event_formats", "event_mechanic_assignments", "event_topics", "event_type_assignments", "events"]);
  // Narrowed dimensions read fewer tables.
  const narrow = fakeDb(t);
  await C.loadClassifications("event", many.slice(0, 10), { client: narrow, reference, dimensions: ["experience_mechanic"] });
  assert.deepEqual([...new Set(narrow.calls.map((c) => c.table))].sort(), ["event_categories", "event_formats", "event_mechanic_assignments"]);
});

// ------------------------------------------------------------ aliases

test("aliases: every reading returned, V1 Discovery Topic collisions surfaced, nothing chosen, staged labels withheld", async () => {
  const { opts } = await setup();
  const r = await A.resolveTaxonomyAliases(["Pop  Up", "kids", "food and beverage", "fashion", "espresso", "nothing here"], opts);
  const pop = r.get("pop up");
  assert.deepEqual(pop.candidates.map((c) => [c.dimension, c.targetSlug, c.priority, c.scope]), [["appearance_type", "pop-up", 1, ["appearance"]], ["experience_mechanic", "pop-up", 0, ["event"]]]);
  assert.deepEqual(pop.discoveryTopics, [{ slug: "pop-ups", name: "Pop-Ups" }]);
  assert.equal(pop.ambiguous, true);
  const kids = r.get("kids");
  assert.deepEqual(kids.candidates.map((c) => [c.dimension, c.targetCode]), [["audience", "kids"]], "inactive aliases are ignored");
  assert.deepEqual(kids.discoveryTopics.map((t) => t.slug), ["family-friendly"]);
  assert.equal(kids.ambiguous, true);
  const fb = r.get("food and beverage").candidates[0];
  assert.equal(fb.label, "Food & Beverage");
  assert.equal(fb.publicLabel, null, "a staged Category's label is never public");
  const fashion = r.get("fashion");
  assert.deepEqual(fashion.topicSlugCollisions, ["fashion"], "V2 Topic slug equals a V1 Discovery Topic slug");
  assert.equal(fashion.ambiguous, true);
  assert.equal(r.get("espresso").ambiguous, false);
  assert.deepEqual(r.get("nothing here"), { phrase: "nothing here", candidates: [], discoveryTopics: [], topicSlugCollisions: [], ambiguous: false });
});

// ------------------------------------------------------------ boundaries

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const SRC = walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f));

test("boundaries: server-only modules; no live surface imports the layer yet; no client import", () => {
  for (const f of ["reference-server", "classifications-server", "aliases-server"]) assert.match(read(`src/lib/taxonomy/${f}.ts`), /^import "server-only";/, f);
  assert.ok(!/from "@\/lib\/admin|server-only|supabase/.test(read("src/lib/taxonomy/compat-policy.ts")), "the policy is pure");
  const importers = SRC.filter((f) => !f.includes("/src/lib/taxonomy/") && /taxonomy\/(compat-policy|reference-server|classifications-server|aliases-server)/.test(readFileSync(f, "utf8")));
  assert.deepEqual(importers, [], "Pass 3B wires nothing into existing surfaces");
  const client = SRC.filter((f) => /^\s*["']use client["']/m.test(readFileSync(f, "utf8")) && /taxonomy\/(reference|classifications|aliases)-server/.test(readFileSync(f, "utf8")));
  assert.deepEqual(client, []);
  assert.ok(!/admin-suggestions/.test(SRC.join("\n")), "no suggestions reader in Pass 3B");
});

test("boundaries: V1 readers, parser and URL semantics untouched; staged leak protection intact", () => {
  for (const f of ["src/lib/discovery/parse.ts", "src/lib/discovery/server.ts", "src/lib/discovery/map-server.ts", "src/lib/discovery/query.ts", "src/lib/data.ts"]) {
    assert.ok(!/taxonomy\//.test(read(f)), `${f} does not read Taxonomy V2`);
  }
  assert.match(read("src/lib/discovery/server.ts"), /from\("discovery_topics"\)/, "?topic= still means V1 Discovery Topics");
  assert.match(read("src/lib/discovery/query.ts"), /topics: "topic"/);
  for (const f of ["src/lib/admin/queries.ts", "src/lib/admin/categoryForm.ts", "src/lib/discovery/commercial-server.ts", "src/lib/event-categories-server.ts", "src/lib/event-formats-server.ts", "src/app/(public)/account/business/actions.ts"]) {
    assert.match(read(f), /\.neq\("status", STAGED_CATEGORY_STATUS\)/, `${f} still excludes staged rows`);
  }
  assert.match(read("src/lib/discovery/attributes.ts"), /ENTRY_MODES = \["walk_in", "rsvp", "ticket", "reservation", "invite"\]/, "V1 normalization unchanged");
});
