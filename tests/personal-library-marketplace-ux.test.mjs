// Personal Library + Marketplace UX pass — regression gates.
//   Relationship (product_wants / user_entity_relationships), Save
//   (account_saved_*) and Collection (user_collections) are independent;
//   ONE signed-in library; owner/admin Marketplace wording is a reading of
//   the canonical readiness engine, which is unchanged.
// In-memory fakes and source guards only — no network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fakeDb } from "./helpers/fake-postgrest.mjs";

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

const S = await import("../src/lib/save-organization.ts");
const W = await import("../src/lib/product-wants.ts");
const COL = await import("../src/lib/collections.ts");
const CD = await import("../src/lib/collections-domain.ts");
const M = await import("../src/lib/commerce/marketplace-eligibility.ts");
const P = await import("../src/lib/commerce/marketplace-presentation.ts");
const read = (p) => readFileSync(p, "utf8");
const code = (p) => read(p).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const PROD = "p-1";
const CTX = { source: "product_page", sourceChannel: null };

// ── Personal library: Relationship vs Save vs Collection ────────────────────
test("Product Want is the canonical product_wants relationship — never a Save classification", () => {
  assert.deepEqual(S.SAVE_CLASSIFICATIONS.product.map((c) => c.relation), ["have"], "the Save sheet offers Have only for Products");
  const rel = read("src/app/api/relationships/route.ts");
  assert.match(rel, /if \(v\.entityType === "product" && v\.relation === "want"\) \{\n\s+const result = await setAccountWant\(/, "any legacy Product Want write lands in product_wants");
  const sheet = read("src/components/SaveOrganizeSheet.tsx");
  assert.match(sheet, />Mark As</, "relationships are presented as relationships, not Save sub-types");
  assert.match(sheet, /<CollectionPicker entityType=\{organize\.type\} entityId=\{organize\.id\} \/>/);
});

test("Wanting alone makes a Product discoverable (Things I Want, All) — no Save needed", () => {
  const rels = S.withCanonicalProductWants([], [PROD]);
  assert.deepEqual(S.collectionMembers("want", rels).product, [PROD]);
  assert.deepEqual(S.collectionMembers("all", rels).product, [PROD]);
  assert.deepEqual(S.collectionMembers("saved", rels).product, [], "a Want is not a Save");
});

test("a plain Save is discoverable under Saved and All, without a Want", () => {
  const saved = { product: [PROD] };
  assert.deepEqual(S.collectionMembers("saved", [], saved).product, [PROD]);
  assert.deepEqual(S.collectionMembers("all", [], saved).product, [PROD]);
  assert.deepEqual(S.collectionMembers("want", [], saved).product, [], "a Save is not a Want");
});

test("removing the Save keeps the Want; un-Want keeps the Save", () => {
  const both = S.withCanonicalProductWants([], [PROD]);
  // Save removed, Want kept
  assert.deepEqual(S.collectionMembers("want", both, { product: [] }).product, [PROD]);
  // Want removed, Save kept
  assert.deepEqual(S.collectionMembers("saved", S.withCanonicalProductWants([], []), { product: [PROD] }).product, [PROD]);
});

test("Want writes never touch Saves; Save writes never touch Wants", async () => {
  const d = fakeDb({ product_wants: [], account_saved_products: [] });
  await W.setAccountWant(d, "u1", PROD, true, CTX);
  await W.setAccountWant(d, "u1", PROD, false, CTX);
  assert.ok(d.calls.every((c) => c.table === "product_wants"));
  assert.doesNotMatch(read("src/app/api/account/save/route.ts"), /product_wants|setAccountWant|user_collection/);
});

test("Collections never change relationship or Save state", async () => {
  const src = code("src/lib/collections.ts");
  assert.doesNotMatch(src, /product_wants|user_entity_relationships|account_saved_/);
  const d = fakeDb({ user_collection_items: [] });
  assert.equal(await COL.setCollectionItem(d, "c1", { type: "product", id: PROD }, true), true);
  assert.equal(await COL.setCollectionItem(d, "c1", { type: "product", id: PROD }, false), true);
  assert.ok(d.calls.every((c) => c.table === "user_collection_items"));
  assert.equal(CD.normalizeCollectionName("  Christmas   Gifts "), "Christmas Gifts");
  assert.equal(CD.normalizeCollectionName(" "), null);
  assert.equal(CD.normalizeCollectionName("x".repeat(61)), null);
  assert.equal(CD.isCollectionEntityType("product"), true);
  assert.equal(CD.isCollectionEntityType("appearance"), false);
});

test("Collections migration: additive, private, independent", () => {
  const sql = read("supabase/migrations/20261125000000_user_collections.sql");
  const body = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(body, /\b(drop table|delete from|truncate|alter table public\.(products|product_wants|user_entity_relationships|account_saved_\w+))\b/i);
  assert.match(body, /revoke all on public\.user_collections from anon, authenticated;/);
  assert.match(body, /using \(auth\.uid\(\) = user_id\) with check \(auth\.uid\(\) = user_id\)/);
  assert.match(body, /c\.user_id = auth\.uid\(\)/, "items only through a Collection the caller owns");
  assert.match(body, /user_collections_user_name_unique on public\.user_collections \(user_id, lower\(btrim\(name\)\)\)/);
  assert.match(body, /primary key \(collection_id, entity_type, entity_id\)/, "an item appears once per Collection");
});

test("Collections degrade gracefully before the migration exists", async () => {
  const missing = { from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: null, error: { code: "42P01" } }) }) }) }) };
  assert.deepEqual(await COL.listCollections(missing, "u1"), { available: false, collections: [] });
  assert.match(read("src/components/CollectionPicker.tsx"), /if \(!available\) return null;/);
});

test("ONE signed-in library: /saved and /my-world send signed-in people to /account/saved", () => {
  assert.match(read("src/app/(public)/saved/page.tsx"), /if \(authed\) router\.replace\("\/account\/saved"\);/);
  assert.match(read("src/app/(public)/my-world/page.tsx"), /syncLocalToAccountOnce\(\);\n\s+router\.replace\("\/account\/saved"\);/);
  const nav = read("src/lib/primary-nav.ts");
  assert.match(nav, /\{ href: "\/account\/saved", label: "Your Library", icon: "bookmark"/);
  assert.doesNotMatch(nav, /label: "Saved & Following"/);
  assert.deepEqual(S.SAVED_COLLECTIONS.map((c) => c.key), ["all", "want", "want-to-do", "want-to-go", "have-been", "following", "must-do", "saved"]);
  const page = read("src/app/(public)/account/saved/page.tsx");
  assert.match(page, /SAVED_COLLECTIONS\.filter\(\(c\) => c\.key === "all" \|\| counts\[c\.key\] > 0/, "empty filters stay hidden — no manufactured taxonomy");
  assert.doesNotMatch(page, /My Moments/, "My Moments stays its own concept");
});

test("signed-out device Save still works; local → account import is idempotent and non-destructive", async () => {
  const saved = read("src/app/(public)/saved/page.tsx");
  assert.match(saved, /getSavedSlugs\(\)/);
  assert.match(saved, /fetch\(`\/api\/saved\?\$\{params\.toString\(\)\}`\)/);
  const AS = await import("../src/lib/accountSync.ts");
  const a = AS.localListsFingerprint({ productSlugs: ["b", "a"], businessSlugs: [] });
  const b = AS.localListsFingerprint({ businessSlugs: [], productSlugs: ["a", "b"] });
  assert.equal(a, b, "order-independent fingerprint");
  assert.notEqual(a, AS.localListsFingerprint({ productSlugs: ["a", "b", "c"], businessSlugs: [] }), "a new local Save re-triggers the import");
  const sync = code("src/lib/accountSync.ts");
  assert.doesNotMatch(sync, /localStorage\.(removeItem|clear)\(/, "never clears local data");
  assert.match(read("src/app/api/account/sync/route.ts"), /ignoreDuplicates: true/, "server import is idempotent");
});

// ── Signed-out Want ─────────────────────────────────────────────────────────
test("signed-out Want: one vocabulary, selected tap explains and never deletes", () => {
  const btn = read("src/components/ProductWantButton.tsx");
  assert.match(btn, /"You Want This"\) : variant === "pill" \? "Want" : "Want This"/);
  assert.match(btn, />Want This\?</);
  assert.match(btn, /Enter your email and we&rsquo;ll remember that you want this\./);
  assert.match(btn, />\s*I Want This\s*</);
  assert.match(btn, /Your email isn&rsquo;t shared with the business\./);
  assert.doesNotMatch(btn, /I&rsquo;m Interested|I'm Interested/);
  assert.match(btn, /setSheet\(want\.wanted \? "already" : "email"\);/, "selected signed-out tap opens feedback, not a delete");
  assert.match(btn, /You already told us you want this\./);
  assert.match(btn, /to manage your Things I Want\./);
  // The server refuses an anonymous un-Want outright.
  assert.match(read("src/app/api/product-want/route.ts"), /if \(!on\) return NextResponse\.json\(\{ error: "Sign in to manage this\." \}, \{ status: 401 \}\);/);
  // Signed-in: organizing is offered only when THIS tap created the Want.
  assert.match(btn, /if \(!wasWanted && now === true\) setSheet\("organize"\);/);
  assert.match(btn, /Added to Things I Want ✓/);
});

// ── Marketplace ─────────────────────────────────────────────────────────────
test("Marketplace: zero global inventory ≠ zero search matches; the strict rule is unchanged", () => {
  const page = read("src/app/(public)/marketplace/page.tsx");
  assert.match(page, /const hasInventory = filtering \? \(await getMarketplaceProducts\(\{ limit: 1 \}\)\)\.length > 0 : results\.length > 0 \|\| featured\.length > 0;/);
  assert.match(page, /\{!hasInventory \? \(/);
  assert.match(page, /Marketplace is getting ready\./);
  assert.match(page, /href="\/businesses"/, "a real discovery destination, not a dead route");
  assert.match(page, /No matches found/);
  assert.ok(page.indexOf("Marketplace is getting ready.") < page.indexOf('<form method="get"'), "search/category controls only render with inventory");
  const filter = code("src/lib/commerce/marketplace-eligibility.ts");
  for (const gate of ['.eq("marketplace_status", "approved")', '.eq("purchasable", true)', '.gt("price", 0)', '.eq("moderation_status", "live")']) assert.ok(filter.includes(gate), gate);
});

// ── Business Manager state machine ─────────────────────────────────────────
const BIZ = { commerce_enabled: true, is_demo: false, publication_status: "live" };
const PICKUP = [{ method: "pickup", enabled: true }];
const prod = (over = {}) => ({ is_active: true, moderation_status: "live", marketplace_status: "catalog_only", purchasable: true, price: 20, inventory_status: null, archived_at: null, trashed_at: null, ...over });
const owner = (p, b = BIZ, f = PICKUP) => P.ownerMarketplaceState(M.marketplaceReadiness(p, b, f));

test("owner state machine: the next step is named, and an impossible request is never offered", () => {
  const inactive = owner(prod({ is_active: false }));
  assert.equal(inactive.step, "activate");
  assert.equal(inactive.canRequest, false);
  assert.equal(inactive.headline, "Not Ready to Submit");
  assert.deepEqual(inactive.rows.map((r) => `${r.label}:${r.value}`), ["Product Profile:Not Live", "Checkout:Ready", "Marketplace Review:Not Requested"]);
  assert.equal(owner(prod({ price: null })).step, "add_price");
  assert.equal(owner(prod({ price: null })).canRequest, false);
  const ready = owner(prod());
  assert.equal(ready.step, "request");
  assert.equal(ready.canRequest, true);
  assert.equal(owner(prod({ marketplace_status: "rejected" })).step, "rerequest");
  assert.equal(owner(prod({ marketplace_status: "submitted" })).step, "pending");
  assert.equal(owner(prod({ marketplace_status: "submitted" })).canRequest, false);
  const approvedNotReady = owner(prod({ marketplace_status: "approved", purchasable: false }));
  assert.equal(approvedNotReady.step, "complete_checkout");
  assert.equal(approvedNotReady.headline, "Approved · Complete Checkout Setup");
  assert.equal(owner(prod({ marketplace_status: "approved" })).step, "live");
  assert.equal(owner(prod({ marketplace_status: "approved" })).headline, "Available in Marketplace ✓");
  assert.equal(owner(prod({ marketplace_status: "paused" })).step, "paused");
  // The Business Manager only renders the Request form for request steps.
  const manager = read("src/app/(public)/account/business/[id]/(manager)/page.tsx");
  assert.match(manager, /step === "request" \|\| step === "rerequest" \? \(/);
  assert.doesNotMatch(manager, /from\("product_wants"\)/, "the Business never receives Want identities");
  // Valid request still works server-side (and still validates).
  const actions = read("src/app/(public)/account/business/actions.ts");
  assert.match(actions, /marketplace_status: "submitted", marketplace_submitted_at: new Date\(\)\.toISOString\(\)/);
  assert.match(actions, /if \(!isCatalogProductPublic\(existing\)\)/);
});

// ── Admin semantics ─────────────────────────────────────────────────────────
test("Admin: Review, Checkout and Listing are separate; approved-but-not-ready is never 'live'", () => {
  const notReady = P.adminMarketplaceSummary(M.marketplaceReadiness(prod({ marketplace_status: "approved", purchasable: false }), BIZ, PICKUP));
  assert.equal(notReady.listingLive, false);
  assert.deepEqual(notReady.rows.map((r) => `${r.label}:${r.value}`), ["Marketplace Review:Approved ✓", "Checkout:Not Ready", "Marketplace Listing:Not Live"]);
  assert.equal(notReady.summary, "This product is approved for Findmi Marketplace. Complete checkout setup before it can appear in Marketplace shopping surfaces.");
  const live = P.adminMarketplaceSummary(M.marketplaceReadiness(prod({ marketplace_status: "approved" }), BIZ, PICKUP));
  assert.equal(live.listingLive, true);
  const panel = read("src/app/admin/(protected)/products/[id]/MarketplaceReviewPanel.tsx");
  assert.match(panel, /\{listingLive \? "Pause Marketplace Listing" : "Pause Marketplace Approval"\}/);
  assert.doesNotMatch(panel, /Pause Marketplace Visibility|may appear in broader Findmi Marketplace\/discovery surfaces/);
  // Pause/Revoke still write exactly what they always did.
  const adminActions = code("src/app/admin/(protected)/products/actions.ts");
  assert.match(adminActions, /update\(\{ marketplace_status: "paused" \}\)/);
  assert.match(adminActions, /update\(\{ marketplace_status: "catalog_only" \}\)/);
  // Detailed blockers stay in Admin; commission display stays.
  assert.match(read("src/components/MarketplaceReadinessPanel.tsx"), /MARKETPLACE_INELIGIBILITY_COPY\[b\]/);
  assert.match(panel, /Marketplace Commission/);
  assert.match(read("src/app/admin/(protected)/products/[id]/page.tsx"), /listingLive=\{readiness\?\.eligible \?\? false\}/, "listing = the canonical engine's eligibility");
});
