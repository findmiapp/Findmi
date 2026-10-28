// Findmi Consolidation pass — Batch A domain foundation regression gates.
//   M  a user managing Business A is NOT offered Business B's Locations
//   N  pending Business absent from public discovery
//   O  pending Event absent from public discovery
//   P  pending Location absent from public discovery
//   Q  non-Marketplace Product absent from Marketplace, still contextual
//   R  approved, purchasable Marketplace Product appears in Marketplace
//   S  an Appearance never needs approval
//   I/J/K  Location exact / ambiguous / new matching
// In-memory fakes and source guards only — no network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { fakeDb } from "./helpers/fake-postgrest.mjs";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    // lib/data.ts reads through getSupabase(): hand it the in-memory fake.
    if (specifier === "./supabase" && context.parentURL?.endsWith("/src/lib/data.ts"))
      return { url: "data:text/javascript,export function getSupabase(){return globalThis.__DB}", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const D = await import("../src/lib/data.ts");
const M = await import("../src/lib/commerce/marketplace-eligibility.ts");
const LM = await import("../src/lib/location-matching.ts");
const LR = await import("../src/lib/location-review.ts");
const LE = await import("../src/lib/location-eligibility.ts");
const PUB = await import("../src/lib/event-publication.ts");
const read = (p) => readFileSync(p, "utf8");
const MIGRATION = read("supabase/migrations/20261121000000_consolidation_publication_rules.sql");
const HOTFIX = read("supabase/migrations/20261121010000_hotfix_event_visibility_policy_grants.sql");

// ── Q / R: the Marketplace boundary, at the data layer ─────────────────────
const BIZ_SHOP = { id: "b-shop", name: "Shop Co", slug: "shop-co", logo_url: null, commerce_enabled: true, is_demo: false, publication_status: "live" };
const BIZ_NOCOMMERCE = { id: "b-cat", name: "Catalog Co", slug: "catalog-co", logo_url: null, commerce_enabled: false, is_demo: false, publication_status: "live" };
const product = (id, over) => ({
  id, business_id: "b-shop", name: id, slug: id, description: null, image_url: null, price: 10, price_label: null, product_type: "product",
  external_purchase_url: null, is_featured: true, is_active: true, purchasable: true, inventory_status: null, home_sort_order: 1, profile_sort_order: 1,
  marketplace_status: "approved", moderation_status: "live", archived_at: null, trashed_at: null, ...over,
});
function marketplaceDb() {
  return fakeDb({
    businesses: [BIZ_SHOP, BIZ_NOCOMMERCE],
    products: [
      product("approved-purchasable"),
      product("catalog-only", { marketplace_status: "catalog_only" }),
      product("submitted", { marketplace_status: "submitted" }),
      product("approved-not-purchasable", { purchasable: false }),
      product("approved-commerce-off", { business_id: "b-cat" }),
      product("approved-inactive", { is_active: false }),
      product("approved-pending-moderation", { moderation_status: "pending_review" }),
    ],
  });
}

test("R + Q. /marketplace returns ONLY approved + active + purchasable Products of commerce-enabled live Businesses", async () => {
  globalThis.__DB = marketplaceDb();
  const ids = (await D.getMarketplaceProducts({ limit: 40 })).map((p) => p.id);
  assert.deepEqual(ids, ["approved-purchasable"]);
});

test("R + Q. every Marketplace surface applies the same rule (Featured, homepage rows, curated ids, search)", async () => {
  globalThis.__DB = marketplaceDb();
  assert.deepEqual((await D.getFeaturedProducts(10)).map((p) => p.id), ["approved-purchasable"]);
  globalThis.__DB = marketplaceDb();
  assert.deepEqual((await D.getHomepageRowProducts({ limit: 10 })).map((p) => p.id), ["approved-purchasable"]);
  globalThis.__DB = marketplaceDb();
  const all = ["approved-purchasable", "catalog-only", "submitted", "approved-not-purchasable", "approved-commerce-off"];
  assert.deepEqual((await D.getProductsByIds(all)).map((p) => p.id), ["approved-purchasable"]);
  globalThis.__DB = marketplaceDb();
  assert.deepEqual((await D.getMarketplaceProducts({ q: "approved", limit: 10 })).map((p) => p.id), ["approved-purchasable"], "search too");
  // Every Marketplace query goes through the one database form of the rule.
  const src = read("src/lib/data.ts");
  for (const fn of ["getProductsByIds", "getFeaturedProducts", "getMarketplaceProducts", "getHomepageRowProducts"]) {
    const body = src.slice(src.indexOf(`export async function ${fn}(`), src.indexOf("\nexport ", src.indexOf(`export async function ${fn}(`) + 10));
    assert.match(body, /applyMarketplaceProductFilter\(/, fn);
    assert.match(body, /isMarketplaceBusinessEligible\(item\.business\)/, fn);
  }
});

test("Q. a non-Marketplace Product is still shown contextually (its Business catalog, its own page)", async () => {
  globalThis.__DB = marketplaceDb();
  const catalog = (await D.getProductsForBusiness("b-shop")).map((p) => p.id);
  for (const id of ["catalog-only", "submitted", "approved-not-purchasable"]) assert.ok(catalog.includes(id), id);
  globalThis.__DB = marketplaceDb();
  assert.equal((await D.getProductBySlug("catalog-only"))?.id, "catalog-only", "its own page still resolves");
});

test("Q. the pure rule names every reason; checkout and the product page use the same rule", () => {
  assert.equal(M.isMarketplaceEligible(product("x"), BIZ_SHOP), true);
  assert.deepEqual(M.marketplaceIneligibility(product("x", { marketplace_status: "catalog_only", purchasable: false }), BIZ_NOCOMMERCE), ["not_approved", "not_purchasable", "commerce_disabled"]);
  assert.deepEqual(M.marketplaceIneligibility(product("x"), { ...BIZ_SHOP, publication_status: "pending_review" }), ["business_not_live"]);
  assert.match(read("src/lib/commerce/quote.ts"), /if \(!isMarketplaceEligible\(product as/, "server-side checkout quote re-checks the rule");
  assert.match(read("src/app/(public)/product/[slug]/page.tsx"), /const canAddToCart = isMarketplaceEligible\(/, "Add to Cart only for Marketplace-eligible Products");
});

// ── M: relationship scoping (Babylist Soho / Shopify) ───────────────────────
test("M. managing Shopify AND Babylist never suggests Babylist Soho for Shopify", () => {
  const managed = [
    { id: "loc-babylist-soho", name: "Babylist Soho" },
    { id: "loc-shopify-ny", name: "Shopify New York" },
    { id: "loc-popup", name: "Spring Pop-Up Space" },
  ];
  const forShopify = LM.scopeLocationSuggestions({ businessName: "Shopify", managed, evidenceLocationIds: new Set(), linkedIds: new Set() });
  assert.deepEqual(forShopify.map((l) => l.id), ["loc-shopify-ny"], "only Shopify-named / evidenced Locations");
  const forBabylist = LM.scopeLocationSuggestions({ businessName: "Babylist", managed, evidenceLocationIds: new Set(["loc-popup"]), linkedIds: new Set() });
  assert.deepEqual(forBabylist.map((l) => l.id).sort(), ["loc-babylist-soho", "loc-popup"], "Babylist's own + where Babylist actually appears");
  const linked = LM.scopeLocationSuggestions({ businessName: "Babylist", managed, evidenceLocationIds: new Set(), linkedIds: new Set(["loc-babylist-soho"]) });
  assert.deepEqual(linked, [], "already connected → never offered again");
});

test("M. the Business Manager's suggestions are scoped through that rule, with this Business's own evidence", () => {
  const page = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
  assert.match(page, /connectable: scopeLocationSuggestions\(\{\s*businessName: business\.name,\s*managed,\s*evidenceLocationIds: evidence,/);
  assert.doesNotMatch(page, /connectable: managed\.filter/, "the user-level pool is never offered as-is");
  const helper = read("src/lib/business-locations.ts");
  assert.match(helper, /export async function getBusinessLocationEvidence[\s\S]*?\.from\("appearances"\)\.select\("location_id"\)\.eq\("business_id", businessId\)/);
  assert.match(helper, /\.eq\("events\.host_business_id", businessId\)/);
});

// ── N / O / P: pending entities are absent from public discovery ────────────
test("N. a pending Business is hidden below the UI (restrictive anon RLS: live only) and is created pending", () => {
  const boundary = read("supabase/migrations/20261012020000_business_select_privacy_boundary.sql");
  assert.match(boundary, /create policy "Anon sees only live businesses"[\s\S]*?as restrictive[\s\S]*?publication_status = 'live'/);
  // Every member-created Business starts pending (create_owned_business).
  const all = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort().map((f) => read(`supabase/migrations/${f}`)).join("\n");
  const latestRpc = all.slice(all.lastIndexOf("create or replace function public.create_owned_business"));
  assert.match(latestRpc, /'free', 'pending_review'/);
});

test("O. a pending Event is hidden at the database for everyone but its managers, and the app gate agrees", () => {
  assert.match(MIGRATION, /create policy "Hide unpublished events"[\s\S]*?as restrictive[\s\S]*?for select/);
  assert.match(HOTFIX, /using \(\s*publication_status = 'live'\s*or public\.viewer_manages_event\(id, host_business_id\)\s*\)/);
  assert.match(HOTFIX, /security definer\s*set search_path = ''/);
  // Dates follow their Event with allow semantics (fail closed).
  assert.match(MIGRATION, /create policy "Occurrences follow their Event's visibility"[\s\S]*?using \(public\.can_view_event\(event_id\)\)/);
  assert.match(MIGRATION, /e\.publication_status = 'live'\s*or exists/);
  // A Business submission starts pending; the app-level predicate rejects it.
  const pending = PUB.eventPublicationFor("business");
  assert.equal(PUB.isEventPublic(pending), false);
  assert.match(read("src/lib/data.ts"), /export async function getEventBySlug\(slug: string\)[\s\S]{0,260}\.eq\("is_demo", false\)/);
});

test("P. a submitted Location is unlisted AND pending review; discovery requires a listed Location", () => {
  const created = LR.newLocationModeration("member");
  assert.deepEqual(created, { is_demo: true, review_status: "pending_review" });
  assert.equal(LE.isLocationDiscoverable({ ...created, logo_url: "/logo.png", cover_image_url: "/cover.png" }), false, "even fully imaged, never discoverable while pending");
  assert.deepEqual(LR.newLocationModeration("admin"), { is_demo: true, review_status: null }, "Admin drafts never enter the member review queue");
  assert.deepEqual(LR.locationReviewDecision("approve"), { is_demo: false, review_status: "approved" });
  assert.deepEqual(LR.locationReviewDecision("reject"), { is_demo: true, review_status: "rejected" });
  // review_status is the canonical moderation state — never derived from is_demo.
  assert.equal(LR.isLocationPendingReview({ is_demo: true, review_status: null }), false);
  assert.doesNotMatch(MIGRATION, /update public\.locations/, "no existing row is reinterpreted as pending");
  // Every member creation path writes it.
  assert.match(read("src/app/(public)/account/location/actions.ts"), /\.\.\.newLocationModeration\("member"\),/);
  assert.match(read("src/lib/places/inline-place.ts"), /\.\.\.newLocationModeration\(input\.submitter \?\? "member"\),/);
});

// ── S: Appearances never need approval ─────────────────────────────────────
test("S. an Appearance is a relationship/activity record — no approval state is introduced for it", () => {
  for (const sql of [MIGRATION, HOTFIX]) assert.doesNotMatch(sql, /appearances/i, "the publication rules never touch appearances");
  for (const f of ["src/lib/event-publication.ts", "src/lib/location-review.ts", "src/lib/commerce/marketplace-eligibility.ts"]) {
    assert.doesNotMatch(read(f), /from\("appearances"\)|appearances\./, f);
  }
  // Participation on a pending Event still realizes the Business's per-date schedule items.
  assert.match(read("src/lib/event-import/persist.ts"), /await deps\.propagateDates\(created\.eventId, created\.occurrenceIds\);/);
});

// ── I / J / K: Location matching ──────────────────────────────────────────
const LOCS = [
  { id: "sephora-557", name: "Sephora", address: "557 Broadway", city: "New York", state: "NY", postal_code: "10012" },
  { id: "sephora-34th", name: "Sephora", address: "112 W 34th St", city: "New York", state: "NY", postal_code: "10120" },
  { id: "dua-410", name: "410 West 13th Street", address: "410 West 13th Street", city: "New York", state: "NY", postal_code: "10014" },
  { id: "canvas", name: "The Canvas", address: "335 W 35th St", city: "New York", state: "NY", postal_code: "10001" },
];

test("I. exact / strong Location match", () => {
  const exact = LM.classifyLocationMatches({ name: "Sephora", address: "557 Broadway", city: "New York", state: "NY", postalCode: "10012" }, LOCS);
  assert.deepEqual([exact.kind, exact.matches[0].id], ["exact", "sephora-557"]);
  // The DUA source names a venue, but its street address IS an existing place.
  const strong = LM.classifyLocationMatches({ name: "DUA by AB Pop-Up", address: "410 W. 13th St", city: "New York", state: "NY", postalCode: "10014" }, LOCS);
  assert.deepEqual([strong.kind, strong.matches[0].id], ["strong", "dua-410"]);
});

test("J. ambiguous Location match — several plausible candidates, the person picks", () => {
  const r = LM.classifyLocationMatches({ name: "Sephora", city: "New York", state: "NY" }, LOCS);
  assert.equal(r.kind, "ambiguous");
  assert.deepEqual(r.matches.map((m) => m.id).sort(), ["sephora-34th", "sephora-557"]);
});

test("K. no match → Create New Location (and a different city never matches)", () => {
  assert.equal(LM.classifyLocationMatches({ name: "Brand New Gallery", address: "1 Main St", city: "Hudson", state: "NY" }, LOCS).kind, "none");
  assert.equal(LM.classifyLocationMatches({ name: "Sephora", address: "557 Broadway", city: "Boston", state: "MA" }, LOCS).kind, "none");
});

test("typeahead stays index-backed and bounded (trigram GIN indexes; ≤20 rows)", () => {
  for (const idx of ["locations_name_trgm_idx", "locations_address_trgm_idx", "events_name_trgm_idx", "businesses_name_trgm_idx"]) assert.match(MIGRATION, new RegExp(`create index if not exists ${idx}`));
  assert.match(read("src/app/api/account/search/route.ts"), /\.limit\(20\)/);
});
