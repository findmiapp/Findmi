// Consolidated Finish pass — the consumer mental model (lib/personal-model.ts):
// RELATIONSHIP = what it means to me; COLLECTION = how I organize it. Generic
// Save is not a primary action on Product / Event / Location / Business detail
// pages; legacy Saves are never deleted and stay reachable in Your Library.
// Pure modules + static source guards; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const M = await import("../src/lib/personal-model.ts");
const R = await import("../src/lib/discovery/relationships.ts");
const S = await import("../src/lib/save-organization.ts");
const read = (p) => readFileSync(p, "utf8");
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const PRODUCT = "src/app/(public)/product/[slug]/page.tsx";
const EVENT = "src/app/(public)/event/[slug]/EventPublicView.tsx";
const LOCATION = "src/app/(public)/location/[slug]/LocationPublicView.tsx";
const BUSINESS = "src/app/(public)/business/[slug]/BusinessPublicView.tsx";
const LIBRARY = "src/app/(public)/account/saved/page.tsx";
const ACTIONS = "src/components/EntityPersonalActions.tsx";

test("model: per-type relationships — Product Have, Event Want To Do/Been, Location Want To Go/Been, Business none (Follow)", () => {
  const labels = (t) => M.PERSONAL_RELATION_ACTIONS[t].map((a) => `${a.label}=${a.relation}`);
  assert.deepEqual(labels("product"), ["I Have This=have"]);
  assert.deepEqual(labels("event"), ["Want To Do=want", "Been=been"]);
  assert.deepEqual(labels("location"), ["Want To Go=want", "Been Here=been"]);
  assert.deepEqual(labels("business"), []);
});

test("model: every offered relation is one the API accepts for that entity type", () => {
  for (const type of ["product", "event", "location"]) {
    for (const a of M.PERSONAL_RELATION_ACTIONS[type]) assert.ok(R.ALLOWED_RELATIONSHIPS[type].includes(a.relation), `${type}:${a.relation}`);
  }
});

test("model: Product Want is never offered through the generic relationship path (it is product_wants)", () => {
  assert.ok(!M.PERSONAL_RELATION_ACTIONS.product.some((a) => a.relation === "want"));
  assert.match(code(PRODUCT), /<ProductWantButton /);
});

test("detail pages: no generic Save control on Product, Event, Location or Business", () => {
  for (const [file, save] of [
    [PRODUCT, /ProductSaveButton/],
    [EVENT, /EventSaveButton/],
    [LOCATION, /LocationSaveButton/],
    [BUSINESS, /<SaveButton\b|import SaveButton/],
  ]) {
    assert.doesNotMatch(code(file), save, file);
  }
});

test("detail pages: relationships + Add to Collection render in place of Save", () => {
  assert.match(code(PRODUCT), /<EntityPersonalActions entityType="product" entityId=\{product\.id\} entityName=\{product\.name\} \/>/);
  assert.match(code(EVENT), /<EntityPersonalActions entityType="event" entityId=\{event\.id\} entityName=\{event\.name\} \/>/);
  assert.match(code(LOCATION), /<EntityPersonalActions entityType="location" entityId=\{location\.id\} entityName=\{location\.name\} \/>/);
  // Business: Follow stays its own control; organizing is Add to Collection.
  assert.match(code(BUSINESS), /<FollowButton /);
  assert.match(code(BUSINESS), /<AddToCollectionButton entityType="business" entityId=\{business\.id\} entityName=\{business\.name\} \/>/);
});

test("Event page: both layouts render the personal row once (single- and multi-date)", () => {
  const src = code(EVENT);
  assert.match(src, /const actions = \(\s*<div className="flex flex-col gap-3">\s*\{coreActions\}\s*\{personalActions\}/);
  assert.equal(src.split("{personalActions}").length - 1, 1);
});

test("Product cards: no Save overlay competing with the Want pill", () => {
  assert.doesNotMatch(code("src/components/ProductCard.tsx"), /SaveIconButton/);
});

test("Add to Collection: Collection membership only — never a relationship, Want or Save write", () => {
  const src = code(ACTIONS);
  assert.match(src, /<CollectionPicker entityType=\{entityType\} entityId=\{entityId\} \/>/);
  assert.doesNotMatch(src, /\/api\/relationships|\/api\/product-want|account_saved|toggleSaved|useAccountSaved/);
  const picker = code("src/components/CollectionPicker.tsx");
  assert.doesNotMatch(picker, /\/api\/relationships|\/api\/product-want|toggleSaved/);
  // Signed out → sign in (never a local-only, silently-lost Collection).
  assert.match(src, /window\.location\.href = `\/login\?next=\$\{encodeURIComponent\(pathname \|\| "\/"\)\}`/);
});

test("relationship toggles never touch Collections (the API writes only relationship rows)", () => {
  const api = code("src/app/api/relationships/route.ts");
  assert.doesNotMatch(api, /user_collection/);
  assert.doesNotMatch(code("src/app/api/product-want/route.ts"), /user_collection/);
});

test("Your Library: renamed destination, two visually distinct tiers, legacy Saved reachable", () => {
  assert.equal(M.PERSONAL_DESTINATION_NAME, "Your Library");
  const page = code(LIBRARY);
  assert.match(page, /title: PERSONAL_DESTINATION_NAME/);
  assert.match(page, /\{PERSONAL_DESTINATION_NAME\}<\/h1>/);
  assert.match(page, /id="library-lists-heading"[\s\S]*Your Lists/);
  assert.match(page, /id="library-collections-heading"[\s\S]*Collections/);
  // Lists are chips; Collections are folder tiles with a create action.
  assert.match(page, /<FolderGlyph /);
  assert.match(page, /<NewCollectionButton \/>/);
  const order = S.SAVED_COLLECTIONS.map((c) => c.label);
  assert.deepEqual(order, ["All", "Things I Want", "Want To Do", "Want To Go", "Have & Been", "Following", "Must Do", "Saved"]);
  // Primary nav label follows the destination name; the route is unchanged.
  assert.match(read("src/lib/primary-nav.ts"), /\{ href: "\/account\/saved", label: "Your Library"/);
});

test("Your Library: Collections section shows even with zero Collections (so one can be created)", () => {
  assert.match(code(LIBRARY), /\{collectionsResult\.available && \(\s*<section aria-labelledby="library-collections-heading"/);
});

test("New Collection creates an EMPTY Collection — no entity attached, no relationship", () => {
  const src = code("src/app/(public)/account/saved/NewCollectionButton.tsx");
  assert.match(src, /JSON\.stringify\(\{ action: "create", name \}\)/);
  assert.doesNotMatch(src, /entityType|\/api\/relationships/);
});

test("legacy Saved data is never deleted by this pass", () => {
  for (const file of [ACTIONS, LIBRARY, "src/app/(public)/account/saved/NewCollectionButton.tsx", "src/app/(public)/account/saved/CollectionActions.tsx"]) {
    const src = code(file);
    assert.doesNotMatch(src, /account_saved_\w+"\)\.delete|localStorage\.(removeItem|clear)/, file);
  }
  // Collection delete removes the folder only — copy says items stay.
  assert.match(read("src/app/(public)/account/saved/CollectionActions.tsx"), /stay in Your Library/);
});

test("Save sheet (cards) speaks the same vocabulary: Event Want is 'Want To Do'", () => {
  assert.deepEqual(S.SAVE_CLASSIFICATIONS.event.map((c) => c.label), ["Want To Do", "Must Do"]);
});
