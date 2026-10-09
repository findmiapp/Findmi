// Opportunities — temporary single-package policy (Phase 2). Live tests of
// src/lib/opportunity-package-policy.ts and the builder chrome, plus
// static guards that the restriction is enforced SERVER-side for saves and
// for both Business response paths (invited + Explore). No database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHOOSE_PACKAGE_MESSAGE,
  FINDMI_CONTACT_EMAIL_FALLBACK,
  PACKAGES_ENABLED,
  PACKAGE_ADD_BLOCKED_MESSAGE,
  PACKAGE_RESPONSES_ENABLED,
  choosePackageMailto,
  packageEditError,
  requiresPackageChoice,
} from "../src/lib/opportunity-package-policy.ts";
import { optionChrome } from "../src/lib/opportunity-commercial-terms-builder.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ACTIONS = read("src/app/admin/(protected)/opportunities/actions.ts");
const BUILDER = read("src/app/admin/(protected)/opportunities/CommercialTermsBuilder.tsx");
const LISTINGS_LIB = read("src/lib/opportunity-listings.ts");
const DETAIL = read("src/app/(public)/account/business/[id]/opportunities/[recipientId]/page.tsx");
const EXPLORE = read("src/app/(public)/account/business/[id]/opportunities/explore/[listingId]/page.tsx");
const fn = (src, name) => src.match(new RegExp(`export async function ${name}[\\s\\S]*?\\n}\\n`))[0];

const TEST_LISTING = ["9a525163-1902-4291-8f72-cb2833652fb1", "fd0c6916-7eec-43f3-a098-8b8ee19402ee", "d1128176-b47b-48aa-acc1-adf2bc7f5db6"];

test("P / 1. both switches are off until package-specific responses exist", () => {
  assert.equal(PACKAGES_ENABLED, false);
  assert.equal(PACKAGE_RESPONSES_ENABLED, false);
});

test("P / 2. a NEW Opportunity may have exactly one package", () => {
  assert.equal(packageEditError([], [{ id: null }]), null);
  assert.equal(packageEditError([], [{ id: null }, { id: null }]), PACKAGE_ADD_BLOCKED_MESSAGE);
});

test("P / 3. a single-package listing can't gain a second package", () => {
  assert.equal(packageEditError(["a"], [{ id: "a" }]), null);
  assert.equal(packageEditError(["a"], [{ id: "a" }, { id: null }]), PACKAGE_ADD_BLOCKED_MESSAGE);
});

test("P / 4. the existing 3-package listing stays editable as-is, and packages may be removed — never forced to delete", () => {
  const all = TEST_LISTING.map((id) => ({ id }));
  assert.equal(packageEditError(TEST_LISTING, all), null, "editing all three in place is allowed");
  assert.equal(packageEditError(TEST_LISTING, [...all].reverse()), null, "reordering is allowed");
  assert.equal(packageEditError(TEST_LISTING, all.slice(0, 2)), null, "removing one is allowed");
  assert.equal(packageEditError(TEST_LISTING, all.slice(0, 1)), null);
});

test("P / 5. nothing can ADD to an existing multi-package listing — not a 4th, not a duplicate, not a swap-in, not a foreign id", () => {
  const all = TEST_LISTING.map((id) => ({ id }));
  assert.equal(packageEditError(TEST_LISTING, [...all, { id: null }]), PACKAGE_ADD_BLOCKED_MESSAGE);
  assert.equal(packageEditError(TEST_LISTING, [all[0], all[1], { id: null }]), PACKAGE_ADD_BLOCKED_MESSAGE, "remove one + add a new one");
  assert.equal(packageEditError(TEST_LISTING, [all[0], { id: "someone-elses-package" }]), PACKAGE_ADD_BLOCKED_MESSAGE);
});

test("P / 6. with packages enabled later, the gate steps aside entirely", () => {
  assert.equal(packageEditError([], [{ id: null }, { id: null }, { id: null }], true), null);
});

test("P / 7. builder: no Add and no Duplicate while packages are off; an existing multi-package listing keeps naming, Move and Remove", () => {
  assert.deepEqual(optionChrome(1, false), { showHeader: false, showMove: false, showDuplicate: false, showRemove: false, showAdd: false, addLabel: "+ Add Another Option" });
  assert.deepEqual(optionChrome(3, false), { showHeader: true, showMove: true, showDuplicate: false, showRemove: true, showAdd: false, addLabel: "+ Add Option" });
  assert.match(BUILDER, /optionChrome\(options\.length, PACKAGES_ENABLED\)/);
  assert.match(BUILDER, /optionChrome\(total, PACKAGES_ENABLED\)/);
  assert.match(BUILDER, /\{chrome\.showAdd &&/);
});

test("P / 8. SERVER enforcement on save: create and save both run packageEditError before anything is written; save reads ALL existing package ids from the database", () => {
  const create = fn(ACTIONS, "createOpportunity");
  assert.ok(create.indexOf("packageEditError([], options)") > -1);
  assert.ok(create.indexOf("packageEditError(") < create.indexOf(".insert("));
  const save = fn(ACTIONS, "saveOpportunity");
  assert.match(save, /from\("opportunity_options"\)\.select\("id"\)\.eq\("listing_id", id\);/, "no .limit(1) — every existing id");
  assert.ok(save.indexOf("packageEditError(") > -1 && save.indexOf("packageEditError(") < save.indexOf(".update(fields)"));
});

test("P / 9. ambiguous interest is a single-package rule: one package (or a legacy listing with none) keeps today's Interested", () => {
  assert.equal(requiresPackageChoice(0), false, "legacy listings like Tabli");
  assert.equal(requiresPackageChoice(1), false);
  assert.equal(requiresPackageChoice(3), true);
  assert.equal(requiresPackageChoice(3, true), false, "once package responses exist");
});

test("P / 10. SERVER enforcement on response: invited Interested and Explore interest are both refused for a multi-package listing, from a fail-closed database count", () => {
  const invited = fn(LISTINGS_LIB, "respondToOpportunityListing");
  assert.match(invited, /if \(args\.response === "interested"\) \{\s*const packages = await countOpportunityPackages\(admin, row\.listing_id\);\s*if \(packages == null\) return \{ ok: false[\s\S]*?if \(requiresPackageChoice\(packages\)\) return \{ ok: false, error: CHOOSE_PACKAGE_MESSAGE \}/);
  assert.ok(invited.indexOf("requiresPackageChoice(") < invited.indexOf(".update("), "checked before the write");
  const explore = fn(LISTINGS_LIB, "expressExploreInterest");
  assert.match(explore, /const packageCount = await countOpportunityPackages\(admin, args\.listingId\);\s*if \(packageCount == null\) return \{ ok: false[\s\S]*?if \(requiresPackageChoice\(packageCount\)\) return \{ ok: false, error: CHOOSE_PACKAGE_MESSAGE \}/);
  const countFn = LISTINGS_LIB.match(/async function countOpportunityPackages[\s\S]*?\n}\n/)[0];
  assert.match(countFn, /return error \? null : \(count \?\? 0\);/, "a read error is null (fail-closed), never zero");
  assert.ok(explore.indexOf("requiresPackageChoice(") < explore.indexOf(".insert("), "checked before the write");
  // Not Interested is never blocked.
  assert.equal(/not_interested[\s\S]{0,80}requiresPackageChoice/.test(invited), false);
});

test("P / 11. UI: the Interested button is replaced by a working contact action only where a package choice is needed", () => {
  for (const page of [DETAIL, EXPLORE]) {
    assert.match(page, /requiresPackageChoice\((options|item\.options)\.length\)/);
    assert.match(page, /choosePackageMailto\(\{ email: \(await getSiteContactInfo\(\)\)\.email, opportunityTitle: o\.title, businessName: shell\.business\.name \}\)/);
    assert.match(page, />\s*Contact Findmi to Choose a Package\s*</);
    assert.match(page, /I&rsquo;m Interested/, "the normal Interested path is still there for everything else");
  }
  // Not Interested stays available on the invited page.
  assert.match(DETAIL, /action\("not_interested"\)/);
});

test("P / 12. the contact action is a real, prefilled mailto (site contact email, else hello@findmi.app)", () => {
  const href = choosePackageMailto({ email: "team@example.com", opportunityTitle: "Test", businessName: "Mocktail Mart" });
  assert.ok(href.startsWith("mailto:team@example.com?subject="));
  assert.ok(decodeURIComponent(href).includes("Package choice: Test"));
  assert.ok(decodeURIComponent(href).includes("Business: Mocktail Mart"));
  assert.ok(choosePackageMailto({ email: null, opportunityTitle: "X", businessName: null }).startsWith(`mailto:${FINDMI_CONTACT_EMAIL_FALLBACK}?`));
  assert.ok(choosePackageMailto({ email: "  ", opportunityTitle: "X", businessName: null }).startsWith(`mailto:${FINDMI_CONTACT_EMAIL_FALLBACK}?`));
  assert.match(CHOOSE_PACKAGE_MESSAGE, /Contact Findmi/);
});

test("P / 13. no existing record is touched: the policy only gates writes; nothing deletes, collapses or converts packages or rewrites recipients", () => {
  const policy = read("src/lib/opportunity-package-policy.ts");
  assert.equal(/\.delete\(|\.update\(|\.insert\(|from\(/.test(policy), false);
  assert.equal(/selected_option_id|option_id/.test(LISTINGS_LIB), false, "no package is ever assigned to a recipient in this phase");
});
