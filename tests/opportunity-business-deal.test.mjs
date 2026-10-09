// Opportunities — first Business UX pass: "The Deal". Live tests of the
// import-free Deal view model (src/lib/opportunity-business-deal.ts) with
// the REAL domain formatters injected, plus static page guards (hierarchy,
// response placement, multi-package gate, forbidden schema words). No
// database, no production writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  IN_KIND_CATEGORY_LABELS,
  calculateInKindEstimatedValueCents,
  formatMonetaryPerUnitEquivalent,
  formatQuantityUnit,
} from "../src/lib/opportunity-commercial-terms-domain.ts";
import {
  attributionFor,
  buildBusinessDeal,
  buildDealHeadline,
  buildLegacyDealHeadline,
  businessDealSummary,
  derivedPackageHeading,
  packageHeadings,
  splitDealItems,
} from "../src/lib/opportunity-business-deal.ts";

const FMT = {
  quantityUnit: formatQuantityUnit,
  perUnitEquivalent: formatMonetaryPerUnitEquivalent,
  estimatedValueCents: calculateInKindEstimatedValueCents,
  categoryLabel: (c) => IN_KIND_CATEGORY_LABELS[c],
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");
const DETAIL = read("src/app/(public)/account/business/[id]/opportunities/[recipientId]/page.tsx");
const EXPLORE = read("src/app/(public)/account/business/[id]/opportunities/explore/[listingId]/page.tsx");
const PRESENTATION = read("src/components/opportunities/OpportunityPresentation.tsx");
const CARD = read("src/components/opportunities/BusinessOpportunityCard.tsx");

// ---------------------------------------------------------------- fixtures

const comp = (over) => ({
  component_type: "in_kind",
  amount_mode: null,
  amount_min_cents: null,
  amount_max_cents: null,
  currency: null,
  in_kind_category: null,
  in_kind_description: null,
  in_kind_provider: null,
  in_kind_required: true,
  estimated_value_cents: null,
  quantity: null,
  unit: null,
  custom_unit_label: null,
  unit_value_cents: null,
  ...over,
});
const money = (type, amount_mode, min, max = null, over = {}) => comp({ component_type: type, amount_mode, amount_min_cents: min, amount_max_cents: max, currency: "USD", in_kind_required: true, ...over });
const opt = (components, over = {}) => ({ name: null, description: null, commercial_mode: "structured", custom_terms_note: null, components, ...over });
const listing = (over = {}) => ({ pricing_mode: "custom", price_cents: null, currency: "USD", host_name: null, whats_included: null, requirements: null, ...over });

const samples = comp({ in_kind_category: "product_samples", in_kind_description: "Product Samples", in_kind_provider: "recipient_business", quantity: 200, unit: "samples" });
const ambassador = comp({ in_kind_category: "staffing", in_kind_description: "Brand Ambassador", in_kind_provider: "findmi", quantity: 1, unit: "staff" });
const space = comp({ in_kind_category: "space_venue", in_kind_description: "Sampling Space", in_kind_provider: "organizer" });
const lavazza = opt([money("participation_fee", "fixed", 75000), samples, ambassador, space]);

// ---------------------------------------------------------------- headline: monetary forms

test("D / 1. Participation Fee in every amount form", () => {
  assert.equal(buildDealHeadline(opt([money("participation_fee", "fixed", 75000)]), FMT).text, "$750 Participation Fee");
  assert.equal(buildDealHeadline(opt([money("participation_fee", "starting_at", 75000)]), FMT).text, "Participation Fee from $750");
  assert.equal(buildDealHeadline(opt([money("participation_fee", "range", 50000, 100000)]), FMT).text, "$500–$1,000 Participation Fee");
  assert.equal(buildDealHeadline(opt([money("participation_fee", "undisclosed", null)]), FMT).text, "Participation Fee: Contact Findmi");
  assert.equal(buildDealHeadline(opt([money("participation_fee", "fixed", 75000)]), FMT).kind, "participation_fee");
});

test("D / 2. Compensation reads as You Receive, in every amount form", () => {
  assert.equal(buildDealHeadline(opt([money("compensation", "fixed", 150000)]), FMT).text, "You Receive $1,500");
  assert.equal(buildDealHeadline(opt([money("compensation", "starting_at", 150000)]), FMT).text, "You Receive from $1,500");
  assert.equal(buildDealHeadline(opt([money("compensation", "range", 100000, 200000)]), FMT).text, "You Receive $1,000–$2,000");
  assert.equal(buildDealHeadline(opt([money("compensation", "undisclosed", null)]), FMT).text, "You Receive: Contact Findmi");
});

test("D / 3. Project Budget is never presented as money the Business receives", () => {
  assert.equal(buildDealHeadline(opt([money("project_budget", "fixed", 500000)]), FMT).text, "Project Budget: $5,000");
  assert.equal(buildDealHeadline(opt([money("project_budget", "starting_at", 500000)]), FMT).text, "Project Budget: from $5,000");
  assert.equal(buildDealHeadline(opt([money("project_budget", "range", 500000, 1000000)]), FMT).text, "Project Budget: $5,000–$10,000");
  assert.equal(buildDealHeadline(opt([money("project_budget", "undisclosed", null)]), FMT).text, "Project Budget: Contact Findmi");
  assert.equal(/Receive/.test(buildDealHeadline(opt([money("project_budget", "fixed", 500000)]), FMT).text), false);
});

test("D / 4. a monetary quantity is descriptive: 'Covers 3 Appearances · Equivalent to $250 / appearance'", () => {
  const h = buildDealHeadline(opt([money("participation_fee", "fixed", 75000, null, { quantity: 3, unit: "appearances" })]), FMT);
  assert.equal(h.text, "$750 Participation Fee");
  assert.equal(h.detail, "Covers 3 Appearances · Equivalent to $250 / appearance");
});

test("D / 5. Custom: 'Terms Discussed With Findmi', the stored note only, never an amount", () => {
  const h = buildDealHeadline(opt([], { commercial_mode: "custom", custom_terms_note: "Rev share, details by call" }), FMT);
  assert.deepEqual(h, { kind: "terms_discussed", text: "Terms Discussed With Findmi", detail: "Contact Findmi for details.", note: "Rev share, details by call" });
  assert.equal(buildDealHeadline(opt([], { commercial_mode: "custom" }), FMT).note, null);
});

// ---------------------------------------------------------------- Free vs No Participation Fee

test("D / 6. Free to Participate: no money and nothing REQUIRED from the Business", () => {
  assert.equal(buildDealHeadline(opt([], { commercial_mode: "complimentary" }), FMT).text, "Free to Participate");
  assert.equal(buildDealHeadline(opt([ambassador, space], { commercial_mode: "complimentary" }), FMT).text, "Free to Participate", "Findmi/host items never change it");
  assert.equal(buildDealHeadline(opt([{ ...samples, in_kind_required: false }], { commercial_mode: "complimentary" }), FMT).text, "Free to Participate", "an OPTIONAL Business item never changes it");
  const valued = { ...ambassador, estimated_value_cents: 50000 };
  assert.equal(buildDealHeadline(opt([valued], { commercial_mode: "complimentary" }), FMT).text, "Free to Participate", "estimated values never change it");
});

test("D / 7. No Participation Fee: no money, but something REQUIRED from the Business — never 'Free'", () => {
  for (const provider of ["recipient_business", null]) {
    const h = buildDealHeadline(opt([{ ...samples, in_kind_provider: provider }]), FMT);
    assert.equal(h.text, "No Participation Fee", String(provider));
    assert.equal(/Free/.test(h.text), false);
  }
  // Inclusions alongside a required Business item don't make it Free either.
  assert.equal(buildDealHeadline(opt([samples, ambassador, space]), FMT).text, "No Participation Fee");
});

test("D / 8. prose never affects the headline", () => {
  const d1 = buildBusinessDeal(listing({ whats_included: "Free drinks for everyone!", requirements: "Nothing at all" }), [opt([samples])], FMT);
  assert.equal(d1.package.headline.text, "No Participation Fee");
});

// ---------------------------------------------------------------- You Provide / Included

test("D / 9. You Provide = required + optional Business items (required first); a missing provider counts as the Business", () => {
  const optionalBanner = comp({ in_kind_category: "promotion", in_kind_description: "Signage", in_kind_provider: "recipient_business", in_kind_required: false });
  const noProvider = comp({ in_kind_category: "equipment", in_kind_description: "Table", in_kind_provider: null });
  const { youProvide } = splitDealItems(opt([optionalBanner, samples, noProvider]), null, FMT);
  assert.deepEqual(youProvide.map((i) => [i.title, i.optional]), [["Product Samples", false], ["Table", false], ["Signage", true]]);
  assert.equal(youProvide[0].detail, "200 Samples");
});

test("D / 10. Included = Findmi, host and partner items in ONE list, attribution as secondary metadata", () => {
  const partner = comp({ in_kind_category: "services", in_kind_description: "Photography", in_kind_provider: "other" });
  const { included } = splitDealItems(opt([ambassador, space, partner]), "URBY", FMT);
  assert.deepEqual(included.map((i) => [i.title, i.detail]), [
    ["Brand Ambassador", "1 Staff · Provided by Findmi"],
    ["Sampling Space", "Provided by URBY"],
    ["Photography", "Provided by a Partner"],
  ]);
});

test("D / 11. organizer attribution with and without host_name", () => {
  assert.equal(attributionFor("organizer", "URBY"), "Provided by URBY");
  assert.equal(attributionFor("organizer", null), "Provided by the Host");
  assert.equal(attributionFor("organizer", "   "), "Provided by the Host");
  assert.equal(attributionFor("findmi", "URBY"), "Provided by Findmi");
  assert.equal(attributionFor("other", "URBY"), "Provided by a Partner");
});

test("D / 12. item title: description, else quantity+unit, else category; quantity never merged into a description", () => {
  const custom = comp({ in_kind_category: "product_samples", in_kind_description: "Tost", in_kind_provider: "recipient_business", quantity: 24, unit: "custom", custom_unit_label: "Bottles" });
  const qtyOnly = comp({ in_kind_category: "product_samples", in_kind_provider: "recipient_business", quantity: 200, unit: "samples" });
  const bare = comp({ in_kind_category: "space_venue", in_kind_provider: "findmi" });
  const { youProvide, included } = splitDealItems(opt([custom, qtyOnly, bare]), null, FMT);
  assert.deepEqual(youProvide.map((i) => [i.title, i.detail]), [["Tost", "24 Bottles"], ["200 Samples", null]]);
  assert.deepEqual(included.map((i) => [i.title, i.detail]), [["Space / Venue", "Provided by Findmi"]]);
});

test("D / 13. estimated value is a quiet secondary line", () => {
  const valued = comp({ in_kind_category: "product_samples", in_kind_description: "Samples", in_kind_provider: "recipient_business", quantity: 24, unit: "units", unit_value_cents: 600 });
  assert.equal(splitDealItems(opt([valued]), null, FMT).youProvide[0].detail, "24 Units · Est. value $144");
});

// ---------------------------------------------------------------- the Lavazza example

test("D / 14. single package (Lavazza / URBY): headline, You Provide, ONE Included list", () => {
  const deal = buildBusinessDeal(listing({ host_name: "URBY" }), [lavazza], FMT);
  assert.equal(deal.kind, "single");
  assert.equal(deal.package.headline.text, "$750 Participation Fee");
  assert.deepEqual(deal.package.youProvide.map((i) => [i.title, i.detail]), [["Product Samples", "200 Samples"]]);
  assert.deepEqual(deal.package.included.map((i) => [i.title, i.detail]), [["Brand Ambassador", "1 Staff · Provided by Findmi"], ["Sampling Space", "Provided by URBY"]]);
});

// ---------------------------------------------------------------- prose (no data loss)

test("D / 15. requirements -> You Provide note; whats_included -> Included note; always kept, verbatim (trimmed only)", () => {
  const deal = buildBusinessDeal(listing({ requirements: "  Bring a 6ft table.\nPower not provided.  ", whats_included: "Social shout-out" }), [lavazza], FMT);
  assert.equal(deal.provideNote, "Bring a 6ft table.\nPower not provided.");
  assert.equal(deal.includedNote, "Social shout-out");
  const blank = buildBusinessDeal(listing({ requirements: "   ", whats_included: null }), [lavazza], FMT);
  assert.equal(blank.provideNote, null);
  assert.equal(blank.includedNote, null);
});

test("D / 16. legacy zero-package listings stay readable: legacy price (direction never assumed) + their prose", () => {
  assert.equal(buildLegacyDealHeadline({ pricing_mode: "fixed", price_cents: 75000, currency: "USD" }).text, "$750 to Participate");
  assert.equal(buildLegacyDealHeadline({ pricing_mode: "starting_at", price_cents: 75000, currency: "USD" }).text, "From $750 to Participate");
  assert.equal(buildLegacyDealHeadline({ pricing_mode: "complimentary", price_cents: null, currency: "USD" }).text, "Free to Participate");
  assert.equal(buildLegacyDealHeadline({ pricing_mode: "custom", price_cents: null, currency: "USD" }).text, "Terms Discussed With Findmi");
  const deal = buildBusinessDeal(listing({ pricing_mode: "fixed", price_cents: 75000, requirements: "Samples", whats_included: "Space" }), [], FMT);
  assert.deepEqual([deal.kind, deal.headline.text, deal.provideNote, deal.includedNote], ["legacy", "$750 to Participate", "Samples", "Space"]);
  assert.equal(/Participation Fee/.test(deal.headline.text), false);
});

// ---------------------------------------------------------------- packages

test("D / 17. named packages always use their stored names", () => {
  const deal = buildBusinessDeal(listing(), [opt([money("participation_fee", "fixed", 75000)], { name: "Resident Demo" }), opt([money("participation_fee", "fixed", 150000)], { name: "Demo + Content" })], FMT);
  assert.deepEqual(deal.packages.map((p) => p.heading), ["Resident Demo", "Demo + Content"]);
});

test("D / 18. unnamed packages get a derived headline from their primary term", () => {
  assert.equal(derivedPackageHeading(buildDealHeadline(opt([money("participation_fee", "fixed", 75000)]), FMT)), "$750 Participation");
  assert.equal(derivedPackageHeading(buildDealHeadline(opt([money("participation_fee", "starting_at", 150000)]), FMT)), "From $1,500 Participation");
  assert.equal(derivedPackageHeading(buildDealHeadline(opt([], { commercial_mode: "complimentary" }), FMT)), "Free to Participate");
  assert.equal(derivedPackageHeading(buildDealHeadline(opt([], { commercial_mode: "custom" }), FMT)), "Terms Discussed With Findmi");
  assert.equal(derivedPackageHeading(buildDealHeadline(opt([money("participation_fee", "undisclosed", null)]), FMT)), null, "nothing distinguishing to say");
  // The existing 3-package production listing ("Test"):
  const test3 = [
    opt([money("participation_fee", "fixed", 250000, null, { quantity: 2, unit: "staff" })]),
    opt([money("participation_fee", "fixed", 25000, null, { quantity: 50, unit: "photos" })]),
    opt([comp({ in_kind_category: "product_samples", in_kind_provider: "recipient_business", quantity: 24, unit: "units", unit_value_cents: 600 })]),
  ];
  const packages = buildBusinessDeal(listing(), test3, FMT).packages;
  assert.deepEqual(packages.map((p) => p.heading), ["$2,500 Participation", "$250 Participation", "No Participation Fee"]);
  assert.deepEqual(packages.map((p) => p.headingFromTerms), [true, true, true], "the card shows its headline as its title — never the same words twice");
  assert.match(PRESENTATION, /\{!pkg\.headingFromTerms && <h3/);
});

test("D / 19. 'Package N' only as the final fallback: undisclosed, or a derived heading that isn't unique", () => {
  const h = (o) => ({ name: o.name, headline: buildDealHeadline(o, FMT) });
  assert.deepEqual(
    packageHeadings([h(opt([money("participation_fee", "fixed", 75000)])), h(opt([money("participation_fee", "fixed", 75000)])), h(opt([money("participation_fee", "undisclosed", null)]))]),
    ["Package 1", "Package 2", "Package 3"]
  );
  assert.deepEqual(packageHeadings([h(opt([], { name: "VIP", commercial_mode: "complimentary" })), h(opt([], { commercial_mode: "complimentary" }))]), ["VIP", "Free to Participate"]);
  const deal = buildBusinessDeal(listing(), [opt([money("participation_fee", "fixed", 75000)], { name: "VIP" }), opt([money("participation_fee", "fixed", 75000)]), opt([money("participation_fee", "fixed", 75000)])], FMT);
  assert.deepEqual(deal.packages.map((p) => [p.heading, p.headingFromTerms]), [["VIP", false], ["$750 Participation", true], ["$750 Participation", true]].map((x, i) => (i === 0 ? x : [`Package ${i + 1}`, false])));
});

test("D / 20. each package card carries its own headline / You Provide / Included; prose renders once for the listing", () => {
  const deal = buildBusinessDeal(listing({ host_name: "URBY", requirements: "R", whats_included: "W" }), [lavazza, opt([money("participation_fee", "fixed", 150000), samples])], FMT);
  assert.equal(deal.kind, "packages");
  assert.equal(deal.packages[0].included.length, 2);
  assert.equal(deal.packages[1].included.length, 0);
  assert.deepEqual([deal.provideNote, deal.includedNote], ["R", "W"]);
});

// ---------------------------------------------------------------- card summary

test("D / 21. card summary: legacy / single / 'Packages from $X' / all free / 'N Packages'", () => {
  assert.equal(businessDealSummary(listing({ pricing_mode: "fixed", price_cents: 75000 }), [], FMT), "$750 to Participate");
  assert.equal(businessDealSummary(listing(), [lavazza], FMT), "$750 Participation Fee");
  assert.equal(businessDealSummary(listing(), [opt([money("participation_fee", "fixed", 150000)]), opt([money("participation_fee", "starting_at", 75000)])], FMT), "Packages from $750");
  assert.equal(businessDealSummary(listing(), [opt([], { commercial_mode: "complimentary" }), opt([ambassador], { commercial_mode: "complimentary" })], FMT), "Free to Participate");
  assert.equal(businessDealSummary(listing(), [opt([money("compensation", "fixed", 150000)]), opt([money("compensation", "fixed", 100000)])], FMT), "2 Packages", "never 'from $X' for money the Business receives");
  assert.equal(businessDealSummary(listing(), [opt([money("participation_fee", "fixed", 75000)]), opt([samples])], FMT), "2 Packages");
  assert.equal(businessDealSummary(listing(), [opt([money("participation_fee", "range", 50000, 90000)]), opt([money("participation_fee", "fixed", 75000)])], FMT), "2 Packages");
});

// ---------------------------------------------------------------- forbidden schema words

test("D / 22. no Business-facing output ever contains schema vocabulary", () => {
  const FORBIDDEN = /Structured|structured|commercial_mode|Commercial Terms|In-Kind|in_kind|recipient_business|component|Option \d|\bOptions?\b|organizer|Complimentary|Custom Terms/;
  const shapes = [
    [lavazza],
    [opt([], { commercial_mode: "complimentary" })],
    [opt([], { commercial_mode: "custom", custom_terms_note: "Call us" })],
    [opt([samples])],
    [opt([money("compensation", "range", 1, 2)]), opt([money("project_budget", "undisclosed", null)]), opt([ambassador, space], { commercial_mode: "complimentary" })],
    [],
  ];
  for (const options of shapes) {
    const deal = buildBusinessDeal(listing({ host_name: "URBY" }), options, FMT);
    const text = JSON.stringify(deal).replace(/"kind":"[a-z_]+"/g, "");
    assert.equal(FORBIDDEN.test(text), false, text);
    assert.equal(FORBIDDEN.test(businessDealSummary(listing(), options, FMT)), false);
  }
});

test("D / 23. the Business presentation JSX shows none of the schema words either", () => {
  const business = PRESENTATION.slice(PRESENTATION.indexOf("// ---------------------------------------------------------------- Business: The Deal"), PRESENTATION.indexOf("/** Structured facts:"));
  for (const src of [strip(business), strip(DETAIL), strip(EXPLORE), strip(CARD)]) {
    const jsxText = [...src.matchAll(/>\s*([^<>{}\n]{2,200})\s*</g)].map((m) => m[1]).join(" | ");
    assert.equal(/Commercial Terms|In-Kind|Structured|Option \d|Not Interested\b/.test(jsxText), false, jsxText);
  }
});

// ---------------------------------------------------------------- page hierarchy + response

test("D / 24. both pages: introduction, then The Deal, then the response section, then details", () => {
  for (const page of [DETAIL, EXPLORE]) {
    const hero = page.indexOf("<OpportunityHero");
    const deal = page.indexOf("<OpportunityDeal");
    const response = page.indexOf("<OpportunityResponseSection");
    const details = page.indexOf("<OpportunityMainSections");
    assert.ok(hero > -1 && hero < deal && deal < response && response < details, "Hero < Deal < Response < Details");
    assert.match(page, /<OpportunityMainSections o=\{o\} includeDealProse=\{false\} \/>/, "the two prose fields render inside The Deal instead");
  }
});

test("D / 25. no response controls in the introduction", () => {
  for (const page of [DETAIL, EXPLORE]) {
    const hero = page.slice(page.indexOf("<OpportunityHero"), page.indexOf("/>", page.indexOf("<OpportunityHero")) + 2);
    assert.equal(/actions=|DecisionArea|I&rsquo;m Interested|expressInterestFromExplore/.test(hero), false, hero);
  }
});

test("D / 26. response copy and labels: 'Interested?', not-a-confirmation copy, 'Not for Us'", () => {
  assert.match(DETAIL, /title=\{view\.state\.choices\.length === 2 \? "Interested\?" : "Your Response"\}/);
  assert.match(EXPLORE, /title="Interested\?"/);
  assert.match(read("src/lib/opportunity-listings-domain.ts"), /This lets Findmi know you'd like to discuss participating\. It is not a confirmation\./);
  assert.match(EXPLORE, /This lets Findmi know you&rsquo;d like to discuss participating\. It is not a confirmation\./);
  assert.match(DETAIL, />\s*Not for Us\s*</);
  assert.match(DETAIL, /"I'm Interested" : "Not for Us"/);
});

test("D / 27. multiple packages: the temporary gate stays — no generic Interested action, Contact Findmi instead, Not for Us kept", () => {
  // Invited page: Interested only when there is no package choice to make.
  assert.match(DETAIL, /\{choosePackageHref \? \(\s*<a href=\{choosePackageHref\}[\s\S]*?Contact Findmi to Choose a Package[\s\S]*?\) : \(\s*<form action=\{action\("interested"\)\}>/);
  assert.match(DETAIL, /choosePackageHref && state\.choices\[0\] === "interested"/, "the changed-mind link is the contact action too");
  assert.match(DETAIL, /action\("not_interested"\)/);
  // Explore: same gate.
  assert.match(EXPLORE, /\(choosePackageHref \? \(\s*<a href=\{choosePackageHref\}[\s\S]*?Contact Findmi to Choose a Package[\s\S]*?\) : \(\s*<form action=\{expressInterestFromExplore/);
  for (const page of [DETAIL, EXPLORE]) assert.match(page, /requiresPackageChoice\((options|item\.options)\.length\)/);
  // The server-side refusal is untouched (tests/opportunity-package-policy.test.mjs P/10).
});

test("D / 28. cards use the Business Deal summary; Admin call sites never opt in", () => {
  assert.match(CARD, /commercialCardLine\(commercialOptions, price, o\)/);
  assert.match(PRESENTATION, /businessDealSummary\(listing, commercialOptions\.map\(asOptionFields\), DEAL_FORMATTERS\)/);
  const admin = read("src/app/admin/(protected)/opportunities/[id]/page.tsx");
  for (const tag of ["OpportunityHero", "OpportunityAsideSections"]) {
    const call = admin.match(new RegExp(`<${tag}[\\s\\S]*?/>`))[0];
    assert.equal(/commercialOptions|showInvestment=\{false\}|showCommercialFact=\{false\}/.test(call), false, tag);
  }
});
