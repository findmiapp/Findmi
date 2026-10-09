// Opportunities — Business Commercial Terms Experience + Participation Cost
// Explore Semantics (Pass 3). Live tests over the zero-import Participation
// Cost predicate and the Pass 3 extension to summarizeOptionsForCard (both
// directly importable — no "@/" aliases, no extensionless relative
// imports), plus static source guards over opportunity-business-
// commercial-terms.ts, OpportunityPresentation.tsx, BusinessOpportunityCard.
// tsx, opportunity-listings.ts, OpportunitiesView.tsx and business/[id]/
// page.tsx — the same convention opportunity-commercial-terms-form.ts
// already uses for modules that import "./opportunity-commercial-terms-
// domain" with an extensionless relative specifier plain Node can't
// resolve. No database, no production writes. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  PARTICIPATION_COST_FILTERS,
  PARTICIPATION_COST_FILTER_LABELS,
  isParticipationCostFilter,
  matchesParticipationCost,
} from "../src/lib/opportunity-participation-cost.ts";
import { summarizeOptionsForCard } from "../src/lib/opportunity-commercial-terms-domain.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
// Function/interface bodies in this codebase are always followed by a blank
// line, so "\n}\n" (brace alone on its own line, then a blank line) is the
// one delimiter that can't be fooled by an interface's OWN closing brace
// being the first "\n}" encountered inside a destructured-parameter+type
// signature — the same convention tests/opportunity-business.test.mjs uses.
const fnBody = (src, marker) => {
  const at = src.indexOf(marker);
  assert.ok(at >= 0, `not found: ${marker}`);
  const end = src.indexOf("\n}\n", at);
  assert.ok(end >= 0, `unterminated: ${marker}`);
  return src.slice(at, end + 3);
};

// First Business UX pass: the Pass 3 Business module was replaced by the
// import-free Deal view model (live-tested in tests/opportunity-business-
// deal.test.mjs); its static guards below now point at that module.
const DEAL = read("src/lib/opportunity-business-deal.ts");
const PRESENTATION = read("src/components/opportunities/OpportunityPresentation.tsx");
const CARD = read("src/components/opportunities/BusinessOpportunityCard.tsx");
const LISTINGS_LIB = read("src/lib/opportunity-listings.ts");
const LISTINGS_DOMAIN = read("src/lib/opportunity-listings-domain.ts");
const VIEW = read("src/app/(public)/account/business/[id]/v2/OpportunitiesView.tsx");
const HOME = read("src/app/(public)/account/business/[id]/v2/BusinessHome.tsx");
const BUSINESS_PAGE = read("src/app/(public)/account/business/[id]/page.tsx");
const DETAIL = read("src/app/(public)/account/business/[id]/opportunities/[recipientId]/page.tsx");
const EXPLORE_DETAIL = read("src/app/(public)/account/business/[id]/opportunities/explore/[listingId]/page.tsx");
const ADMIN_DETAIL = read("src/app/admin/(protected)/opportunities/[id]/page.tsx");
const ADMIN_ACTIONS = read("src/app/admin/(protected)/opportunities/actions.ts");
const BRIDGE = read("src/lib/opportunity-commercial-terms-bridge.ts");

// ============================================================================
// SECTION A — matchesParticipationCost() (live)
// ============================================================================

const fee = (amount_mode, amount_min_cents) => ({ commercial_mode: "structured", components: [{ component_type: "participation_fee", amount_mode, amount_min_cents }] });
const comp = (amount_mode, amount_min_cents) => ({ commercial_mode: "structured", components: [{ component_type: "compensation", amount_mode, amount_min_cents }] });
const budget = (amount_mode, amount_min_cents) => ({ commercial_mode: "structured", components: [{ component_type: "project_budget", amount_mode, amount_min_cents }] });
const inKindOnly = () => ({ commercial_mode: "structured", components: [{ component_type: "in_kind", amount_mode: null, amount_min_cents: null }] });
const complimentary = () => ({ commercial_mode: "complimentary", components: [] });
const custom = () => ({ commercial_mode: "custom", components: [] });
const legacy = (pricing_mode, price_cents) => ({ pricing_mode, price_cents });

test("1. filter choices are exactly the four locked options — no 'No Maximum' / '$2,500+'", () => {
  assert.deepEqual([...PARTICIPATION_COST_FILTERS], ["complimentary", "up_to_500", "up_to_1000", "up_to_2500"]);
  assert.equal(PARTICIPATION_COST_FILTERS.includes("no_maximum"), false);
  assert.equal(PARTICIPATION_COST_FILTERS.includes("2500_plus"), false);
  // First Business UX pass: the stored filter value stays "complimentary"; its Business label is "Free to Participate".
  assert.deepEqual(PARTICIPATION_COST_FILTER_LABELS, { complimentary: "Free to Participate", up_to_500: "Up to $500", up_to_1000: "Up to $1,000", up_to_2500: "Up to $2,500" });
  for (const bad of ["no_maximum", "2500_plus", "", null, undefined, "any"]) assert.equal(isParticipationCostFilter(bad), false);
});

test("2. null/undefined filter ('Any Participation Cost') matches every shape, never filtering by commercial terms at all", () => {
  const shapes = [[fee("fixed", 300_000)], [comp("fixed", 100)], [budget("range", 500_000)], [inKindOnly()], [complimentary()], [custom()], []];
  for (const options of shapes) {
    assert.equal(matchesParticipationCost(null, legacy("custom", null), options), true);
    assert.equal(matchesParticipationCost(undefined, legacy("custom", null), options), true);
  }
});

test("3. complimentary filter matches a structured Complimentary Option, never a Participation Fee/Compensation/Project Budget/Custom Option", () => {
  assert.equal(matchesParticipationCost("complimentary", legacy("fixed", 75_000), [complimentary()]), true);
  for (const options of [[fee("fixed", 75_000)], [comp("fixed", 75_000)], [budget("fixed", 75_000)], [custom()], [inKindOnly()]]) {
    assert.equal(matchesParticipationCost("complimentary", legacy("fixed", 75_000), options), false);
  }
});

test("4. complimentary filter on a legacy-unclassified listing reads pricing_mode directly", () => {
  assert.equal(matchesParticipationCost("complimentary", legacy("complimentary", null), []), true);
  for (const pm of ["fixed", "starting_at", "custom"]) assert.equal(matchesParticipationCost("complimentary", legacy(pm, null), []), false);
});

test("5. worked example — Fixed $750: Up to $500 no match, Up to $1,000 yes, Up to $2,500 yes", () => {
  const options = [fee("fixed", 75_000)];
  assert.equal(matchesParticipationCost("up_to_500", legacy("custom", null), options), false);
  assert.equal(matchesParticipationCost("up_to_1000", legacy("custom", null), options), true);
  assert.equal(matchesParticipationCost("up_to_2500", legacy("custom", null), options), true);
});

test("6. worked example — Starting At $750 behaves identically to Fixed $750", () => {
  const options = [fee("starting_at", 75_000)];
  assert.equal(matchesParticipationCost("up_to_500", legacy("custom", null), options), false);
  assert.equal(matchesParticipationCost("up_to_1000", legacy("custom", null), options), true);
  assert.equal(matchesParticipationCost("up_to_2500", legacy("custom", null), options), true);
});

test("7. worked example — Range $500-$1,000: floor is the range minimum, so Up to $500 already matches", () => {
  const options = [{ commercial_mode: "structured", components: [{ component_type: "participation_fee", amount_mode: "range", amount_min_cents: 50_000, amount_max_cents: 100_000 }] }];
  assert.equal(matchesParticipationCost("up_to_500", legacy("custom", null), options), true);
  assert.equal(matchesParticipationCost("up_to_1000", legacy("custom", null), options), true);
  assert.equal(matchesParticipationCost("up_to_2500", legacy("custom", null), options), true);
});

test("8. Range $1,000-$2,000: Up to $500 no match (floor > cap), Up to $1,000 matches at the exact boundary, Up to $2,500 yes", () => {
  const options = [{ commercial_mode: "structured", components: [{ component_type: "participation_fee", amount_mode: "range", amount_min_cents: 100_000, amount_max_cents: 200_000 }] }];
  assert.equal(matchesParticipationCost("up_to_500", legacy("custom", null), options), false);
  assert.equal(matchesParticipationCost("up_to_1000", legacy("custom", null), options), true);
  assert.equal(matchesParticipationCost("up_to_2500", legacy("custom", null), options), true);
});

test("9. Undisclosed Participation Fee has no comparable floor — never matches any numeric cap", () => {
  const options = [fee("undisclosed", null)];
  for (const f of ["up_to_500", "up_to_1000", "up_to_2500"]) assert.equal(matchesParticipationCost(f, legacy("custom", null), options), false);
});

test("10. non-fee commercial directions never match a numeric cap, however small their amount", () => {
  for (const options of [[comp("fixed", 100)], [budget("fixed", 100)], [custom()], [inKindOnly()], [complimentary()]]) {
    assert.equal(matchesParticipationCost("up_to_2500", legacy("custom", null), options), false, JSON.stringify(options));
  }
});

test("11. multiple Options: ANY qualifying Option matches — never collapsed to one projected number first", () => {
  const options = [fee("fixed", 300_000), fee("fixed", 75_000)];
  assert.equal(matchesParticipationCost("up_to_1000", legacy("custom", null), options), true, "the $750 Option alone must be enough");
  assert.equal(matchesParticipationCost("up_to_500", legacy("custom", null), options), false, "neither Option has a floor <= $500");
});

test("12. mixed-direction Options: only the Participation-Fee-bearing Option contributes; Compensation contributes nothing", () => {
  const options = [comp("fixed", 50_000), fee("fixed", 500_000)];
  assert.equal(matchesParticipationCost("up_to_1000", legacy("custom", null), options), false, "the only fee is $5,000, well over the cap; the $500 Option is Compensation, never inspected");
});

test("13. mixed-direction Options: complimentary filter still finds the Complimentary Option even when another Option is a large fee", () => {
  const options = [complimentary(), fee("fixed", 500_000)];
  assert.equal(matchesParticipationCost("complimentary", legacy("custom", null), options), true);
  assert.equal(matchesParticipationCost("up_to_500", legacy("custom", null), options), false, "the fee Option is too high; Complimentary is never auto-included in a numeric cap");
});

test("14. legacy-unclassified listing: numeric cap reads pricing_mode/price_cents directly, at the exact boundary", () => {
  assert.equal(matchesParticipationCost("up_to_500", legacy("fixed", 50_000), []), true, "floor == cap matches");
  assert.equal(matchesParticipationCost("up_to_500", legacy("fixed", 50_001), []), false, "one cent over the cap does not");
  assert.equal(matchesParticipationCost("up_to_500", legacy("starting_at", 50_000), []), true);
});

test("15. legacy-unclassified listing: complimentary/custom pricing_mode never matches a numeric cap", () => {
  assert.equal(matchesParticipationCost("up_to_2500", legacy("complimentary", null), []), false);
  assert.equal(matchesParticipationCost("up_to_2500", legacy("custom", null), []), false);
});

// ============================================================================
// SECTION B — summarizeOptionsForCard Pass 3 direction prefixes (live)
// ============================================================================

test("16. uniform Compensation Options collapse to 'Compensation options from $X'", () => {
  const options = [
    { commercial_mode: "structured", components: [{ component_type: "compensation", amount_mode: "fixed", amount_min_cents: 150_000, currency: "USD" }] },
    { commercial_mode: "structured", components: [{ component_type: "compensation", amount_mode: "starting_at", amount_min_cents: 100_000, currency: "USD" }] },
  ];
  assert.equal(summarizeOptionsForCard(options), "Compensation options from $1,000");
});

test("17. uniform Project Budget Options collapse to 'Project budgets from $X'", () => {
  const options = [
    { commercial_mode: "structured", components: [{ component_type: "project_budget", amount_mode: "fixed", amount_min_cents: 500_000, currency: "USD" }] },
    { commercial_mode: "structured", components: [{ component_type: "project_budget", amount_mode: "fixed", amount_min_cents: 800_000, currency: "USD" }] },
  ];
  assert.equal(summarizeOptionsForCard(options), "Project budgets from $5,000");
});

test("18. uniform Participation Fee wording is unchanged from Pass 1 ('Options from $X', never 'Participation fee options from $X')", () => {
  const options = [
    { commercial_mode: "structured", components: [{ component_type: "participation_fee", amount_mode: "fixed", amount_min_cents: 75_000, currency: "USD" }] },
    { commercial_mode: "structured", components: [{ component_type: "participation_fee", amount_mode: "fixed", amount_min_cents: 150_000, currency: "USD" }] },
  ];
  assert.equal(summarizeOptionsForCard(options), "Options from $750");
});

test("19. mixed directions never blend into one number, even with the new prefixes", () => {
  const options = [
    { commercial_mode: "structured", components: [{ component_type: "compensation", amount_mode: "fixed", amount_min_cents: 150_000, currency: "USD" }] },
    { commercial_mode: "structured", components: [{ component_type: "project_budget", amount_mode: "fixed", amount_min_cents: 500_000, currency: "USD" }] },
  ];
  assert.equal(summarizeOptionsForCard(options), "2 Options");
});

// ============================================================================
// SECTION C — Business Deal view model (static guards; behavior is live-
// tested in tests/opportunity-business-deal.test.mjs)
// ============================================================================

test("20 (superseded by the Deal model). no runtime import of the domain module — the canonical formatters are injected, never reimplemented", () => {
  assert.equal(/^import (?!type)[^;]*from/m.test(DEAL), false, "type-only imports only");
  assert.match(PRESENTATION, /quantityUnit: formatQuantityUnit/);
  assert.match(PRESENTATION, /perUnitEquivalent: formatMonetaryPerUnitEquivalent/);
  assert.match(PRESENTATION, /estimatedValueCents: calculateInKindEstimatedValueCents/);
  assert.equal(/quantity\s*\*|\*\s*unit_value_cents/.test(strip(DEAL)), false, "no raw valuation math in the Deal model");
});

test("21 (superseded). Business money wording is direction-correct: Participation Fee / You Receive / Project Budget — never 'Investment' or 'Participation Cost'", () => {
  assert.match(DEAL, /Participation Fee/);
  assert.match(DEAL, /You Receive/);
  assert.match(DEAL, /Project Budget: /);
  assert.equal(/Investment|Participation Cost/.test(strip(DEAL)), false);
});

test("22-23 (superseded). an undisclosed amount says 'Contact Findmi', never Admin's 'Amount discussed with Findmi'", () => {
  assert.match(DEAL, /Participation Fee: Contact Findmi/);
  assert.equal(/Amount discussed with Findmi/.test(strip(DEAL)), false);
});

test("24 (superseded). there is ONE Included section with secondary attribution — no per-provider headings, never a fabricated party name", () => {
  assert.equal(/Your Contribution|Provided by Organizer|Provided by Another Party/.test(strip(DEAL)), false);
  assert.match(DEAL, /"Provided by Findmi"/);
  assert.match(DEAL, /"Provided by the Host"/);
  assert.match(DEAL, /"Provided by a Partner"/);
});

test("25-28 (superseded). required before optional; custom shows only the stored note; Free vs No Participation Fee keyed off required Business contributions", () => {
  assert.match(DEAL, /Number\(a\.item\.optional\) - Number\(b\.item\.optional\)/);
  assert.match(DEAL, /note: option\.custom_terms_note\?\.trim\(\) \|\| null/);
  assert.match(DEAL, /option\.components\.some\(isRequiredBusinessContribution\)/);
});

// ============================================================================
// SECTION D — OpportunityPresentation.tsx (static guards)
// ============================================================================

test("30-31 (updated). Admin's legacy render path is unchanged: commercialOptions omitted keeps the legacy price fact; showInvestment defaults true", () => {
  assert.match(PRESENTATION, /if \(!commercialOptions\) return \{ title: legacy\.amount, detail: legacy\.qualifier \};/);
  assert.match(PRESENTATION, /showInvestment = true/);
  assert.match(PRESENTATION, /\{showInvestment && \(\s*<OpportunitySection title=\{OPPORTUNITY_SECTION_LABELS\.investment\}>/);
});

test("32-36 (superseded). the Business presentation never shows schema words: no 'Commercial Terms' heading, no 'Option N', no accordions", () => {
  const business = PRESENTATION.slice(PRESENTATION.indexOf("// ---------------------------------------------------------------- Business: The Deal"), PRESENTATION.indexOf("/** Structured facts:"));
  assert.ok(business.length > 0);
  assert.equal(/Commercial Terms|In-Kind|Structured|Option \$\{|<details/.test(strip(business)), false);
  assert.match(business, /The Deal/);
  assert.match(business, /"You Provide"/);
  assert.match(business, /"Included"/);
  assert.match(business, />Packages</);
});

test("37 (updated). Credits Eligible is still preserved in Admin's legacy Investment block", () => {
  assert.match(PRESENTATION, /Credits Eligible/);
});

test("39 (superseded). 'Optional' is shown only for non-required items", () => {
  assert.match(PRESENTATION, /\{item\.optional && <span/);
});

test("41. OpportunityPresentation never imports admin-only authoring/persistence modules", () => {
  assert.equal(/CommercialTermsBuilder|toCommercialTermsRpcPayload|requireAdmin\(/.test(PRESENTATION), false);
});

// ============================================================================
// SECTION E — BusinessOpportunityCard.tsx (static guards)
// ============================================================================

test("42. OpportunityCard uses the direction-aware commercialCardLine, never the raw legacy price unconditionally", () => {
  assert.match(CARD, /import \{ ClockIcon, commercialCardLine, PinIcon, TagIcon/);
  assert.match(CARD, /const commercial = commercialCardLine\(commercialOptions, price, o\)/);
  assert.match(CARD, /\{commercial\.title\}/);
  assert.equal(/\{price\.amount\}/.test(CARD), false, "the old unconditional legacy-only render must be gone");
});

test("43. BusinessOpportunityCard forwards commercialOptions through to OpportunityCard", () => {
  const fn = fnBody(CARD, "export default function BusinessOpportunityCard");
  assert.match(fn, /commercialOptions\?:/);
  assert.match(fn, /commercialOptions=\{commercialOptions\}/);
});

// ============================================================================
// SECTION F — opportunity-listings.ts (static guards)
// ============================================================================

test("44. BusinessOpportunityItem and ExploreItem both carry Options for the presentation layer", () => {
  assert.match(fnBody(LISTINGS_LIB, "export interface BusinessOpportunityItem"), /options: AdminOpportunityOption\[\]/);
  assert.match(fnBody(LISTINGS_LIB, "export interface ExploreItem"), /options: AdminOpportunityOption\[\]/);
});

test("45. every Business/Explore read batches Options through the shared reader — no per-row (N+1) query", () => {
  for (const fnName of ["getBusinessOpportunityItems", "getBusinessOpportunityItem", "getExploreItems", "getExploreItem"]) {
    const re = new RegExp(`export async function ${fnName}\\([\\s\\S]*?\\n}\\n`);
    const body = LISTINGS_LIB.match(re)[0];
    assert.match(body, /getOpportunityOptionsForListings/, fnName);
    assert.equal(/for \(const row of[\s\S]*await getOpportunityOptionsForListings/.test(body), false, `${fnName} must not fetch Options inside a per-row loop`);
  }
});

test("46. getExploreItems composes matchesParticipationCost with the (now budget-free) matchesExploreFilters, never collapsing Options first", () => {
  const body = LISTINGS_LIB.match(/export async function getExploreItems[\s\S]*?\n}\n/)[0];
  assert.match(body, /matchesExploreFilters\(/);
  assert.match(body, /matchesParticipationCost\(\s*filters\.participationCost/);
  assert.match(body, /import \{ matchesParticipationCost \} from "@\/lib\/opportunity-participation-cost";/.test(LISTINGS_LIB) ? /./ : /matchesParticipationCost/);
});

test("47. matchesExploreFilters itself (opportunity-listings-domain.ts) no longer reads pricing_mode/price_cents or exposes a budget filter", () => {
  assert.equal(/EXPLORE_BUDGET|isExploreBudget|ExploreBudget/.test(LISTINGS_DOMAIN), false);
  const fn = LISTINGS_DOMAIN.match(/export function matchesExploreFilters[\s\S]*?\n\}/)[0];
  assert.equal(/pricing_mode|price_cents/.test(fn), false);
});

test("48. ExploreFilters carries participationCost (type-only reference to the zero-import module), not budget", () => {
  const iface = LISTINGS_DOMAIN.slice(LISTINGS_DOMAIN.indexOf("export interface ExploreFilters"), LISTINGS_DOMAIN.indexOf("export interface ExploreFilters") + 500);
  assert.match(iface, /participationCost\?:/);
  assert.equal(/budget\?:/.test(iface), false);
});

test("49 (updated after the classification correction). Pass 3 itself added no migration — the only migration after the unit-value one (20261011000000) is the later, separately reviewed classification correction", () => {
  const migrations = readdirSync(new URL("../supabase/migrations", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  const after = migrations.slice(migrations.indexOf("20261011000000_opportunity_commercial_terms_unit_value.sql") + 1);
  assert.ok(migrations.includes("20261011000000_opportunity_commercial_terms_unit_value.sql"));
  assert.deepEqual(after, ["20261012000000_commercial_terms_brand_contribution_classification.sql"]);
});

test("50. opportunity_recipients.option_id is still never referenced anywhere in src/ — Interested/Not Interested stays Option-less", () => {
  assert.equal(/opportunity_recipients[\s\S]{0,80}option_id|option_id[\s\S]{0,80}opportunity_recipients/i.test(LISTINGS_LIB), false);
  assert.equal(/\boption_id\b/.test(strip(LISTINGS_LIB)), false, "opportunity_listings.ts itself never touches any option_id column");
});

test("51. respondToOpportunityListing / expressExploreInterest are unchanged by Pass 3 — no Option selection added", () => {
  for (const fnName of ["respondToOpportunityListing", "expressExploreInterest"]) {
    const body = LISTINGS_LIB.match(new RegExp(`export async function ${fnName}\\([\\s\\S]*?\\n}\\n`))[0];
    assert.equal(/optionId|option_id/i.test(body), false, fnName);
  }
});

test("52. projectSafeLegacyPricing is kept, unmodified in role, still used by Admin's write-time legacy-column sync", () => {
  assert.match(BRIDGE, /export function projectSafeLegacyPricing/);
  assert.match(ADMIN_ACTIONS, /projectSafeLegacyPricing\(options\)/);
});

// ============================================================================
// SECTION G — Explore filter UI + business/[id]/page.tsx (static guards)
// ============================================================================

test("53. the Explore filter renders exactly the four locked choices, 'Any Participation Cost' as the default/unselected state", () => {
  assert.match(VIEW, /<option value="">Any Participation Cost<\/option>/);
  assert.match(VIEW, /PARTICIPATION_COST_FILTERS\.map/);
  assert.equal(/Any Budget|No Maximum|\$2,500\+/.test(VIEW), false);
});

test("54. the filter field is named participationCost end to end (form select, query param type, page wiring) — 'budget' is gone", () => {
  assert.match(VIEW, /name="participationCost"/);
  assert.equal(/name="budget"/.test(VIEW), false);
  assert.match(BUSINESS_PAGE, /participationCost\?: string/);
  assert.match(BUSINESS_PAGE, /isParticipationCostFilter\(rawSearchParams\.participationCost\)/);
  assert.equal(/budget/.test(BUSINESS_PAGE.slice(BUSINESS_PAGE.indexOf("searchParams: Promise"), BUSINESS_PAGE.indexOf("searchParams: Promise") + 1500)), false);
});

test("55. Clear Filters / empty-state copy keys off participationCost, not the removed budget field", () => {
  assert.match(VIEW, /filters\.participationCost/);
  assert.equal(/filters\.budget/.test(VIEW), false);
});

// ============================================================================
// SECTION H — BusinessHome.tsx (verification only, no new pricing logic)
// ============================================================================

test("56. BusinessHome passes the fetched Options through to the card preview and adds no pricing logic of its own", () => {
  assert.match(HOME, /commercialOptions=\{top\.options\}/);
  assert.equal(/opportunityPriceParts|formatOpportunityPrice|summarizeOptionForCard|summarizeOptionsForCard/.test(HOME), false, "BusinessHome must never compute its own commercial summary");
});

// ============================================================================
// SECTION I — Admin stays untouched
// ============================================================================

test("57. the Admin detail page never opts into the new Business presentation on either shared component", () => {
  for (const tag of ["OpportunityHero", "OpportunityAsideSections"]) {
    const call = ADMIN_DETAIL.match(new RegExp(`<${tag}[\\s\\S]*?/>`))[0];
    assert.equal(/commercialOptions/.test(call), false, tag);
  }
  assert.match(ADMIN_DETAIL, /function CommercialTermsSection/, "Admin keeps its own, separate Commercial Terms authoring/detail section");
});

test("58 (updated). Admin's own legacy 'Investment' heading survives in the shared component; the Business heading is The Deal, never 'Commercial Terms'", () => {
  assert.match(PRESENTATION, /OPPORTUNITY_SECTION_LABELS\.investment/);
  assert.equal(/title="Commercial Terms"/.test(PRESENTATION), false);
  assert.match(PRESENTATION, /The Deal/);
});

// ============================================================================
// SECTION J — DO NOT TOUCH: Goals / Pro / Stripe / Event participation
// ============================================================================

test("59. Goals, Pro entitlements, Stripe checkout/webhooks and Event participation are never referenced by any Pass 3 file", () => {
  for (const src of [DEAL, PRESENTATION, CARD, VIEW, HOME]) {
    assert.equal(/stripe|pro_access_request|redeem_pro_invite|event_businesses|respondToEventInvitation/i.test(src), false);
  }
});

test("60 (updated). both Business detail routes pass their fetched Options to The Deal, hide the hero price fact, and hide Admin's Investment block", () => {
  for (const src of [DETAIL, EXPLORE_DETAIL]) {
    assert.match(src, /<OpportunityDeal o=\{o\} options=\{(item\.)?options\} \/>/);
    assert.match(src, /showCommercialFact=\{false\}/);
    assert.match(src, /showInvestment=\{false\}/);
  }
});
