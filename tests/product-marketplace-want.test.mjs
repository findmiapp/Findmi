// Product Catalog + Marketplace + Want / Demand pass — regression gates.
//   Catalog visibility never depends on commerce; Marketplace = catalog +
//   approval + commerce readiness (one rule, shared by queries, cards,
//   Product page, checkout, Business Manager, Admin); Want is its own
//   canonical relationship (product_wants), never Save.
// In-memory fakes and source guards only — no network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fakeDb } from "./helpers/fake-postgrest.mjs";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "./supabase" && context.parentURL?.endsWith("/src/lib/data.ts"))
      return { url: "data:text/javascript,export function getSupabase(){return globalThis.__DB}", shortCircuit: true };
    if (specifier === "@/lib/admin/supabase-admin")
      return { url: "data:text/javascript,export function getAdminSupabase(){return globalThis.__DB}", shortCircuit: true };
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
const C = await import("../src/lib/product-catalog.ts");
const Q = await import("../src/lib/commerce/quote.ts");
const W = await import("../src/lib/product-wants.ts");
const WD = await import("../src/lib/product-wants-domain.ts");
const S = await import("../src/lib/save-organization.ts");
const read = (p) => readFileSync(p, "utf8");

// ── fixtures ────────────────────────────────────────────────────────────────
const SHOP = { id: "b-shop", name: "Shop", slug: "shop", logo_url: null, commerce_enabled: true, is_demo: false, publication_status: "live", marketplace_fee_percent: null, processing_fee_payer: null };
const NOCHECKOUT = { ...SHOP, id: "b-cat", slug: "cat", commerce_enabled: false };
const product = (id, over = {}) => ({
  id, business_id: "b-shop", name: id, slug: id, description: null, image_url: null, price: 20, price_label: null, product_type: "product",
  external_purchase_url: null, is_featured: true, is_active: true, purchasable: true, inventory_status: null, home_sort_order: 1, profile_sort_order: 1,
  marketplace_status: "approved", moderation_status: "live", archived_at: null, trashed_at: null,
  marketplace_fee_override_percent: null, processing_fee_payer_override: null, ...over,
});
const PICKUP = [{ method: "pickup", enabled: true }];
const future = new Date(Date.now() + 7 * 864e5).toISOString();
const past = new Date(Date.now() - 7 * 864e5).toISOString();

function db() {
  const products = [
    product("ready"),
    product("approved-not-purchasable", { purchasable: false }), // the 22 production rows
    product("catalog-purchasable", { marketplace_status: "catalog_only" }), // the 1 production row
    product("pending", { marketplace_status: "submitted" }),
    product("rejected", { marketplace_status: "rejected" }),
    product("no-price", { price: null }),
    product("sold-out", { inventory_status: "out_of_stock" }),
    product("shipping-only"),
    product("expired-pickup"),
    product("future-pickup"),
    product("no-checkout-biz", { business_id: "b-cat" }),
  ];
  const fo = (pid, method, appearance_id = null) => ({ id: `fo-${pid}-${method}`, product_id: pid, method, price: 0, enabled: true, appearance_id });
  return fakeDb({
    businesses: [SHOP, NOCHECKOUT],
    products,
    appearances: [
      { id: "ap-past", business_id: "b-shop", start_at: past, end_at: past, status: "scheduled", venue_name: "Old Market", title: "Old", description: null, event_id: null },
      { id: "ap-future", business_id: "b-shop", start_at: future, end_at: future, status: "scheduled", venue_name: "New Market", title: "New", description: null, event_id: null },
    ],
    product_fulfillment_options: [
      ...products.filter((p) => !["shipping-only", "expired-pickup", "future-pickup"].includes(p.id)).map((p) => fo(p.id, "pickup")),
      fo("shipping-only", "shipping"),
      fo("expired-pickup", "event_pickup", "ap-past"),
      fo("future-pickup", "event_pickup", "ap-future"),
    ],
  });
}

// ── Catalog ─────────────────────────────────────────────────────────────────
test("catalog Product stays publicly visible when it is not Marketplace-purchasable", async () => {
  globalThis.__DB = db();
  const catalog = await D.getProductsForBusiness("b-shop");
  const byId = new Map(catalog.map((p) => [p.id, p]));
  for (const id of ["approved-not-purchasable", "catalog-purchasable", "pending", "rejected", "no-price", "sold-out", "shipping-only"]) {
    assert.ok(byId.has(id), `${id} listed in its Business catalog`);
    assert.equal(byId.get(id).marketplace_eligible, false, `${id} is catalog-only`);
  }
  assert.equal(byId.get("ready").marketplace_eligible, true);
  globalThis.__DB = db();
  const page = await D.getProductBySlug("approved-not-purchasable");
  assert.equal(page?.id, "approved-not-purchasable", "its own page still resolves");
  assert.equal(page.marketplace_eligible, false, "…without commerce UI");
});

test("the catalog rule never looks at commerce fields", () => {
  assert.equal(C.isCatalogVisible(product("x", { purchasable: false, marketplace_status: "catalog_only" }), SHOP), true);
  assert.equal(C.isCatalogVisible(product("x", { moderation_status: "pending_review" }), SHOP), false);
  assert.equal(C.isCatalogVisible(product("x", { archived_at: past }), SHOP), false);
  assert.equal(C.isCatalogVisible(product("x"), { ...SHOP, is_demo: true }), false);
  const src = read("src/lib/product-catalog.ts").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.doesNotMatch(src, /purchasable|marketplace_status|commerce_enabled/);
});

// ── Marketplace eligibility (one rule) ──────────────────────────────────────
test("approved + purchasable=false is NOT Marketplace-eligible", () => {
  assert.deepEqual(M.marketplaceIneligibility(product("x", { purchasable: false }), SHOP, PICKUP), ["not_purchasable"]);
});

test("catalog_only + purchasable=true is NOT Marketplace-eligible", () => {
  assert.deepEqual(M.marketplaceIneligibility(product("x", { marketplace_status: "catalog_only" }), SHOP, PICKUP), ["not_approved"]);
});

test("pending (submitted) Marketplace Product is NOT eligible even when purchasable", () => {
  const r = M.marketplaceReadiness(product("x", { marketplace_status: "submitted" }), SHOP, PICKUP);
  assert.equal(r.eligible, false);
  assert.equal(r.approved, false);
  assert.equal(r.commerceReady, true, "commerce readiness is a separate gate");
});

test("approved + purchasable + valid commerce configuration IS eligible", () => {
  assert.equal(M.isMarketplaceEligible(product("x"), SHOP, PICKUP), true);
  assert.equal(M.isMarketplaceEligible(product("x"), SHOP, [{ method: "event_pickup", enabled: true, appearance: { start_at: future } }]), true);
});

test("commerce readiness: price, stock, checkout-completable fulfillment, Business checkout", () => {
  assert.deepEqual(M.marketplaceIneligibility(product("x", { price: null }), SHOP, PICKUP), ["no_price"]);
  assert.deepEqual(M.marketplaceIneligibility(product("x", { price: 0 }), SHOP, PICKUP), ["no_price"]);
  assert.deepEqual(M.marketplaceIneligibility(product("x", { inventory_status: "out_of_stock" }), SHOP, PICKUP), ["sold_out"]);
  assert.deepEqual(M.marketplaceIneligibility(product("x"), SHOP, [{ method: "shipping", enabled: true }, { method: "local_delivery", enabled: true }]), ["no_checkout_fulfillment"]);
  assert.deepEqual(M.marketplaceIneligibility(product("x"), SHOP, [{ method: "event_pickup", enabled: true, appearance: { start_at: past, end_at: past } }]), ["no_checkout_fulfillment"]);
  assert.deepEqual(M.marketplaceIneligibility(product("x"), SHOP, [{ method: "event_pickup", enabled: true, appearance: null }]), ["no_checkout_fulfillment"]);
  assert.deepEqual(M.marketplaceIneligibility(product("x"), SHOP, [{ method: "pickup", enabled: false }]), ["no_checkout_fulfillment"]);
  assert.deepEqual(M.marketplaceIneligibility(product("x"), NOCHECKOUT, PICKUP), ["commerce_disabled"]);
  for (const b of M.COMMERCE_BLOCKERS) assert.ok(M.MARKETPLACE_INELIGIBILITY_COPY[b], b);
});

test("Marketplace queries return ONLY canonically eligible Products", async () => {
  for (const fn of [() => D.getMarketplaceProducts({ limit: 40 }), () => D.getFeaturedProducts(40), () => D.getHomepageRowProducts({ limit: 40 })]) {
    globalThis.__DB = db();
    const ids = (await fn()).map((p) => p.id).sort();
    assert.deepEqual(ids, ["future-pickup", "ready"]);
  }
  globalThis.__DB = db();
  const all = ["ready", "approved-not-purchasable", "catalog-purchasable", "pending", "sold-out", "shipping-only", "expired-pickup", "future-pickup", "no-price"];
  assert.deepEqual((await D.getProductsByIds(all)).map((p) => p.id).sort(), ["future-pickup", "ready"]);
});

test("Product cards and the Product page show commerce UI only from the rule", () => {
  const card = read("src/components/ProductCard.tsx");
  assert.match(card, /const marketplace = product\.marketplace_eligible === true;/);
  assert.doesNotMatch(card.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n"), /product\.purchasable/);
  const page = read("src/app/(public)/product/[slug]/page.tsx");
  assert.match(page, /const canAddToCart = product\.marketplace_eligible === true;/);
  assert.match(page, /variant="primary" source="product_page"/, "catalog Product leads with Want");
  assert.match(page, /Not available to buy on Findmi yet\./);
  assert.doesNotMatch(page, /Marketplace (pending|rejected)|awaiting review/i, "no internal moderation language publicly");
});

// ── Checkout ───────────────────────────────────────────────────────────────
const line = (productId, fulfillmentMethod = "pickup", appearanceId = null) => ({ lineId: `l-${productId}`, productId, quantity: 1, fulfillmentMethod, appearanceId });

test("checkout refuses every ineligible Product (hand-built cart / stale tab)", async () => {
  for (const id of ["approved-not-purchasable", "catalog-purchasable", "pending", "no-price", "sold-out", "no-checkout-biz"]) {
    globalThis.__DB = db();
    const { quote, items } = await Q.computeOrderDraft([line(id)]);
    assert.equal(quote.hasUnavailable, true, id);
    assert.equal(quote.lines[0].available, false, id);
    assert.equal(items.length, 0, `${id} produces no order item`);
  }
  globalThis.__DB = db();
  const expired = await Q.computeOrderDraft([line("expired-pickup", "event_pickup", "ap-past")]);
  assert.equal(expired.quote.hasUnavailable, true, "expired event pickup");
});

test("existing order behavior intact: an eligible line snapshots the default 5% fee and vendor net", async () => {
  globalThis.__DB = db();
  const { quote, items } = await Q.computeOrderDraft([line("ready")]);
  assert.equal(quote.hasUnavailable, false);
  assert.equal(items.length, 1);
  assert.equal(items[0].unitPrice, 20);
  assert.equal(items[0].marketplaceFeePercent, 5);
  assert.equal(items[0].marketplaceFeeAmount, 1);
  assert.equal(items[0].appliedFeeSource, "marketplace_default");
  assert.equal(items[0].processingFeePayer, "vendor");
  globalThis.__DB = db();
  const ev = await Q.computeOrderDraft([line("future-pickup", "event_pickup", "ap-future")]);
  assert.equal(ev.quote.hasUnavailable, false, "upcoming event pickup still sells");
  // No migration in this pass touches orders / order_items / allocations.
  for (const f of ["supabase/migrations/20261123000000_hotfix_products_moderation_status_grant.sql", "supabase/migrations/20261124000000_product_wants.sql"]) {
    assert.doesNotMatch(read(f).replace(/--.*$/gm, ""), /\border(s|_items)\b|vendor_order_allocations/, f);
  }
});

// ── Want / Demand ───────────────────────────────────────────────────────────
function wantDb() {
  const d = fakeDb({ product_wants: [], account_saved_products: [] });
  d.rpc = async (name, args) => {
    assert.equal(name, "product_want_counts");
    const rows = (globalThis.__WANTS ?? []).filter((r) => args.p_product_ids.includes(r.product_id) && r.removed_at == null);
    const by = new Map();
    for (const r of rows) by.set(r.product_id, (by.get(r.product_id) ?? 0) + 1);
    return { data: [...by].map(([product_id, n]) => ({ product_id, want_count: n, recent_count: n })), error: null };
  };
  return d;
}
const CTX = { source: "product_page", sourceChannel: null };

test("authenticated Want dedupes: repeated taps → one row; un-Want removes it from the set", async () => {
  const d = wantDb();
  assert.deepEqual(await W.setAccountWant(d, "u1", "p1", true, CTX), { ok: true, wanted: true });
  assert.deepEqual(await W.setAccountWant(d, "u1", "p1", true, CTX), { ok: true, wanted: true });
  const rows = () => d.calls.filter((c) => c.table === "product_wants" && c.op === "insert");
  assert.equal(rows().length, 1, "only one insert");
  assert.deepEqual(await W.getAccountWantedProductIds(d, "u1"), ["p1"]);
  assert.deepEqual(await W.setAccountWant(d, "u1", "p1", false, CTX), { ok: true, wanted: false });
  assert.deepEqual(await W.getAccountWantedProductIds(d, "u1"), [], "un-Want");
  assert.deepEqual(await W.setAccountWant(d, "u1", "p1", true, CTX), { ok: true, wanted: true }, "re-Want reactivates");
  assert.equal(rows().length, 1, "still the same row");
});

test("signed-out Want dedupes on Product + normalized email", async () => {
  const d = wantDb();
  const a = WD.normalizeWantEmail("  Bob@Example.COM ");
  const b = WD.normalizeWantEmail("bob@example.com");
  assert.equal(a, "bob@example.com");
  assert.equal(a, b);
  assert.equal(WD.normalizeWantEmail("not-an-email"), null);
  assert.equal(await W.recordEmailWant(d, "p1", a, CTX), true);
  assert.equal(await W.recordEmailWant(d, "p1", b, CTX), true);
  assert.equal(d.calls.filter((c) => c.table === "product_wants" && c.op === "insert").length, 1);
});

test("Save does not create Want, and Want does not create Save", async () => {
  const d = wantDb();
  await W.setAccountWant(d, "u1", "p1", true, CTX);
  await W.recordEmailWant(d, "p1", "a@b.co", CTX);
  assert.ok(d.calls.every((c) => c.table !== "account_saved_products"), "Want never touches Save");
  const save = read("src/app/api/account/save/route.ts");
  assert.doesNotMatch(save, /product_wants|setAccountWant/, "Save never writes Want");
  const wantRoute = read("src/app/api/product-want/route.ts");
  assert.doesNotMatch(wantRoute, /account_saved/, "Want route never writes Save");
});

test("Business aggregate demand exposes counts only — never identities", async () => {
  const d = wantDb();
  globalThis.__WANTS = [
    { product_id: "p1", user_id: "u1", email: null, removed_at: null },
    { product_id: "p1", user_id: null, email: "x@y.co", removed_at: null },
    { product_id: "p1", user_id: "u2", email: null, removed_at: past },
  ];
  const counts = await W.getProductWantCounts(d, ["p1", "p2"]);
  assert.deepEqual(Object.keys(counts.get("p1")).sort(), ["recentCount", "wantCount"]);
  assert.equal(counts.get("p1").wantCount, 2);
  assert.equal(counts.has("p2"), false);
  const sql = read("supabase/migrations/20261124000000_product_wants.sql");
  assert.match(sql, /returns table \(product_id uuid, want_count bigint, recent_count bigint\)/);
  assert.match(sql, /revoke all on function public\.product_want_counts\(uuid\[\]\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.product_want_counts\(uuid\[\]\) to service_role;/);
  assert.match(sql, /revoke all on public\.product_wants from anon, authenticated;/);
  assert.match(sql, /using \(auth\.uid\(\) = user_id\)/);
  const manager = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
  assert.doesNotMatch(manager, /from\("product_wants"\)/, "Business Manager never reads Want rows");
  assert.match(manager, /getProductWantCounts\(admin, productIds\)/);
  assert.equal(WD.demandSentence(37, false), "37 people want this product. Complete Marketplace setup to let customers purchase it through Findmi.");
  assert.equal(WD.demandSentence(1, true), "1 person wants this product.");
  assert.equal(WD.demandSentence(0, true), null);
});

test("Things I Want reads the canonical Product Want relationship", () => {
  const legacy = [
    { entity_type: "product", entity_id: "p-legacy", relation: "want" },
    { entity_type: "product", entity_id: "p-have", relation: "have" },
    { entity_type: "event", entity_id: "e1", relation: "want" },
  ];
  const rels = S.withCanonicalProductWants(legacy, ["p-new", "p-new"]);
  // Things I Want = Products only (Personal Library pass); Event Want is "Want To Do".
  assert.deepEqual(S.collectionMembers("want", rels), { product: ["p-new"], event: [], location: [], business: [] });
  assert.deepEqual(S.collectionMembers("want-to-do", rels).event, ["e1"]);
  assert.deepEqual(S.collectionMembers("have-been", rels).product, ["p-have"], "Have untouched");
  assert.equal(S.SAVED_COLLECTIONS.find((c) => c.key === "want").label, "Things I Want");
  const saved = read("src/app/(public)/account/saved/page.tsx");
  assert.match(saved, /withCanonicalProductWants\(\(relationRows \?\? \[\]\) as RelationRow\[\], wantedProductIds\)/);
  assert.match(saved, /getAccountWantedProductIds\(supabase, user\.id\)/);
  const rel = read("src/app/api/relationships/route.ts");
  assert.match(rel, /if \(v\.entityType === "product" && v\.relation === "want"\) \{\n\s+const result = await setAccountWant\(/, "the Save sheet's Product Want writes the canonical row");
  const sql = read("supabase/migrations/20261124000000_product_wants.sql");
  assert.match(sql, /where r\.entity_type = 'product' and r\.relation = 'want'/, "legacy rows copied");
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /delete from|drop table|truncate/i, "nothing removed");
});

// ── Marketplace request / approval ─────────────────────────────────────────
test("Marketplace request validates, and approval alone never bypasses checkout readiness", () => {
  const actions = read("src/app/(public)/account/business/actions.ts");
  const submit = actions.slice(actions.indexOf("export async function submitProductToMarketplace"), actions.indexOf("export async function updateMemberProductCommerce"));
  assert.match(submit, /if \(!isCatalogProductPublic\(existing\)\)/);
  assert.match(submit, /Add a price before requesting Marketplace review\./);
  assert.match(submit, /marketplace_status: "submitted", marketplace_submitted_at: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(submit, /"approved"\s*\}/, "owners never approve");
  // Owner checkout setup never touches approval, Business checkout, or fees.
  const commerce = actions.slice(actions.indexOf("export async function updateMemberProductCommerce"), actions.indexOf("/** Withdraws the owner's own"));
  assert.doesNotMatch(commerce, /marketplace_status|commerce_enabled|fee_/);
  assert.match(commerce, /\.in\("method", \["pickup", "event_pickup"\]\)/, "shipping/delivery config kept");
  const approvedNotReady = M.marketplaceReadiness(product("x", { purchasable: false }), SHOP, []);
  assert.equal(approvedNotReady.approved, true);
  assert.equal(approvedNotReady.eligible, false);
  assert.deepEqual(approvedNotReady.commerceBlockers, ["not_purchasable", "no_checkout_fulfillment"]);
});

test("WantHeartButton is gone — Save is SaveIconButton; Want is ProductWantButton", () => {
  assert.throws(() => read("src/components/WantHeartButton.tsx"));
  assert.match(read("src/components/SaveIconButton.tsx"), /useAccountSaved/);
  assert.match(read("src/components/ProductWantButton.tsx"), /useProductWant/);
});
