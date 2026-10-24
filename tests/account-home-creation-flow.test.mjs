// /account Home + creation completion revision — SUBMISSION -> ACCOUNT HOME
// -> CLEAR STATUS -> NEXT ACTION. Source guards for the wiring and pure
// behavior for which Business the completion card may reveal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const { resolveCreatedBusiness } = await import("../src/lib/account-created-business.ts");
const CA = await import("../src/app/(public)/account/business/[id]/v2/createActions.ts");
const ACTIONS = read("src/app/(public)/account/business/actions.ts");
const HOME = read("src/app/(public)/account/page.tsx");
const CARD = read("src/app/(public)/account/CreatedBusinessCard.tsx");
const ADD = read("src/app/(public)/account/business/[id]/v2/AddToPresence.tsx");

test("a successful new Business submission lands on Account Home (never the Business editor)", () => {
  const start = ACTIONS.indexOf("export async function createMemberBusiness");
  const next = ACTIONS.indexOf("\nexport async function", start + 10);
  const fn = ACTIONS.slice(start, next).replace(/\s*\/\*\*[\s\S]*$/, "");
  assert.match(fn, /redirect\(`\/account\?created=\$\{businessId\}`\);\s*\}\s*$/, "the normal path ends on /account?created=<id>");
  assert.doesNotMatch(fn.slice(fn.lastIndexOf("if (planChoiceRaw")), /redirect\(`\/account\/business\/\$\{businessId\}`\)/);
});

test("the completion card is validated against the user's own pending Businesses", () => {
  const own = [
    { id: "a", pendingReview: true },
    { id: "b", pendingReview: false },
    { id: "c", pendingReview: true },
  ];
  assert.equal(resolveCreatedBusiness("a", []), null, "a user with no managed Businesses reveals nothing");
  assert.equal(resolveCreatedBusiness("a", own)?.id, "a", "newly submitted → pending Business shown");
  assert.equal(resolveCreatedBusiness("c", own)?.id, "c", "multiple Businesses: the created one is picked");
  assert.equal(resolveCreatedBusiness("b", own), null, "an approved (live) Business is not 'pending'");
  for (const bad of [undefined, "", "zzz", 7, null, ["a"]]) assert.equal(resolveCreatedBusiness(bad, own), null, String(bad));
});

test("Account Home shows the real status: Pending Review chip, supporting copy, top-of-page arrival", () => {
  assert.match(HOME, /const createdBusiness = resolveCreatedBusiness\(created, myBusinesses\);/);
  assert.match(HOME, /pendingReview: business\.publication_status === "pending_review"/, "status comes from the real publication_status");
  assert.match(CARD, /<Chip tone="amber">Pending Review<\/Chip>/);
  assert.match(CARD, /Your Business has been submitted\./);
  assert.match(CARD, /visible to you now and will appear in discovery after Findmi reviews it/);
  assert.match(CARD, /<ScrollToTopOnArrival \/>/);
  assert.ok(HOME.indexOf("<CreatedBusinessCard") < HOME.indexOf('id="pages-i-manage"'), "the card sits at the top, above every section");
  // The pending Business also stays visible under Pages I Manage on every later visit.
  assert.match(HOME, /b\.pendingReview \? \{ label: "Pending Review", tone: "warning" as const \} : null/);
});

test("the completion card leads with the one Create on Findmi entry (existing sheet), then Manage and Preview", () => {
  assert.match(CARD, /<AddToPresence[^>]*variant="primary" label="Create on Findmi"/);
  assert.ok(CARD.indexOf("<AddToPresence") < CARD.indexOf("Manage {business.name}") && CARD.indexOf("Manage {business.name}") < CARD.indexOf(">\n            Preview"));
  assert.match(ADD, /label = "Add",/);
  assert.match(ADD, /\{label\}\s*<\/button>/);
});

test("pending Claims read as Pending Review with a useful next action (no Pro upsell)", () => {
  const claims = HOME.slice(HOME.indexOf('id="pending-claims"'));
  assert.match(claims, /<Chip tone="amber">Pending Review<\/Chip>/);
  assert.match(claims, /Findmi is reviewing your claim/);
  assert.match(claims, />\s*View Page\s*</);
  assert.doesNotMatch(claims.slice(0, 2500), /Upgrade to Pro/);
});

test("Create on Findmi: five owner-facing actions — ONE Event entry (Hosting / Appearing At chosen next), no Appearance; each maps to an existing flow", () => {
  const actions = CA.orderedCreateActions("/account/business/biz", "biz");
  assert.deepEqual(actions.map((a) => a.label), ["Add An Event", "At a Location", "Add To Product Catalog", "Add a Moment", "Create A QR Code"]);
  assert.ok(!actions.some((a) => /Appearance/i.test(a.label)), "Appearance is never a Create on Findmi label");
  // Add a Moment routes into the one existing composer (no second composer).
  assert.equal(CA.businessCreateActions("/account/business/biz", "biz").moment.href, "/my-world/journal/new?business=biz&postAs=biz");
  assert.ok(existsSync("src/app/(public)/my-world/journal/new/page.tsx") && existsSync("src/app/(public)/my-world/journal/page.tsx"));
  const by = Object.fromEntries(actions.map((a) => [a.key, a.href]));
  // UX consolidation: Where I'll Be and Host an Event became ONE Event entry
  // that asks Hosting / Appearing At first. The participation composer
  // definition is kept (reached as "Appearing At An Event").
  assert.equal(CA.businessCreateActions("/account/business/biz", "biz").where.href, "/account/business/biz?tab=findmi-here&compose=1");
  assert.equal(by.event, "/account/business/biz?tab=findmi-here&add=event");
  assert.equal(by.location, "/account/business/biz?tab=findmi-here&view=locations&add=1");
  assert.equal(by.product, "/account/business/biz?tab=products&compose=1");
  assert.equal(by.moment, "/my-world/journal/new?business=biz&postAs=biz");
  assert.equal(by.qr, "/account/business/biz/qr/new");
});

test("Account Home terminology: From Pages You Follow, Your Recent Moments, Pages I Manage; My World is not a heading", () => {
  assert.match(HOME, /title="From Pages You Follow"/);
  assert.match(HOME, /title="Your Recent Moments" href="\/my-world\/journal"/, "the /my-world route itself is unchanged");
  assert.match(HOME, /title="Pages I Manage"/);
  assert.doesNotMatch(HOME, /title="[^"]*My World[^"]*"|title="From Brands You Follow"|title="Your Moments"/);
  assert.doesNotMatch(HOME, />\s*(Must Have|Must Do|Want|Have|Done)\s*</, "the old intent taxonomy is not surfaced");
});

test("the sheet renders every action from the shared definitions; Home's Quick Actions rail is a separate compact selection; the completion card opens that same sheet", () => {
  assert.match(ADD, /orderedCreateActions\(basePath, businessId\)\.map\(/);
  // Business Manager Flow pass: Home's Quick Create became the Quick Actions
  // rail — still the same shared definitions (businessCreateActions).
  const home = read("src/app/(public)/account/business/[id]/v2/BusinessHome.tsx");
  assert.match(home, /<QuickActionsRail businessId=\{businessId\} \/>/);
  assert.match(read("src/app/(public)/account/business/[id]/v2/quickActions.ts"), /businessCreateActions\(`\/account\/business\/\$\{businessId\}`, businessId\)/);
  assert.match(CARD, /<AddToPresence[^>]*label="Create on Findmi"/);
  assert.equal(CA.BUSINESS_CREATE_ORDER.length, 5);
  assert.deepEqual(CA.BUSINESS_CREATE_ORDER, ["event", "location", "product", "moment", "qr"]);
});
