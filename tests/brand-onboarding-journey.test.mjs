// Brand Onboarding correction — the production journey that exposed the
// gap: a NAME-first search ("Fenty Beauty") fell straight into the generic
// Add Business form. Now name/Instagram no-matches ask for a website, which
// goes through the ordinary website lookup, then website analysis, then
// the existing create form in source=brand presentation (no Free/Pro),
// landing on the new Business's Profile. Stubbed deps; no network, no DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/headers") return { url: "data:text/javascript,export const headers=async()=>new Map();export const cookies=async()=>({get(){return undefined},set(){}})", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const B = await import("../src/lib/brand-lookup.ts");
const C = await import("../src/lib/brand-candidate.ts");
const A = await import("../src/lib/brand-website-analysis.ts");

const read = (p) => readFileSync(p, "utf8");
const PAGE = read("src/app/(public)/join/brand/page.tsx");
const NEW_PAGE = read("src/app/(public)/account/business/new/page.tsx");
const ACTIONS = read("src/app/(public)/account/business/actions.ts");
const MANAGER = read("src/app/(public)/account/business/[id]/page.tsx");
const CREATE = ACTIONS.slice(ACTIONS.indexOf("export async function createMemberBusiness"), ACTIONS.indexOf("\n}\n", ACTIONS.indexOf("export async function createMemberBusiness")));
const params = (href) => new URL(href, "https://findmi.app").searchParams;
const pathOf = (href) => new URL(href, "https://findmi.app").pathname;

const FENTY_HTML = `<html><head><title>FENTY BEAUTY by Rihanna | Official Site</title>
  <meta name="description" content="Beauty for all.">
  <script type="application/ld+json">${JSON.stringify({
    "@type": "Organization",
    name: "FENTY BEAUTY by Rihanna",
    url: "https://fentybeauty.com/",
    sameAs: ["https://www.instagram.com/fentybeautyofficial/"],
  })}</script></head></html>`;

function deps(over = {}) {
  const calls = { fetch: 0, match: [] };
  return {
    calls,
    deps: {
      fetchHtml: async (url) => {
        calls.fetch += 1;
        return { ok: true, url: new URL(url.href), html: FENTY_HTML, bytes: 1, redirects: 0 };
      },
      findMatches: async (input) => {
        calls.match.push(input);
        return [];
      },
      listCategories: async () => [],
      isRateLimited: () => false,
      enrich: async () => ({ result: null, called: false, usage: null }),
      verifyImage: async () => false,
      draftsEnabled: false,
      acquireSlot: () => () => {},
      cache: A.createExtractionCache(),
      log: () => {},
      now: () => 0,
      ...over,
    },
  };
}

// ── NAME FIRST ────────────────────────────────────────────────────────────
test("name first: 'Fenty Beauty' is a name; no match → the website prompt (not the generic Add link)", async () => {
  const c = B.classifyBrandInput("Fenty Beauty");
  assert.equal(c.kind, "name");
  const result = await B.lookupBrand(c, true, { findMatches: async () => [], readPublicCards: async () => [] });
  assert.deepEqual(result, { state: "none" });
  // The name/Instagram no-match renders WebsitePrompt, not the old
  // "Add Your Brand" primary link into the generic form.
  assert.match(PAGE, /return \(\s*<WebsitePrompt\s+title=\{`We Couldn't Find \$\{instagramSeed \? `@\$\{instagramSeed\}` : value\}`\}\s+body="Add your website and Findmi will build the starting profile for you\."/);
  assert.doesNotMatch(PAGE, /<PrimaryLink href=\{addHref\} label="Add Your Brand" \/>/, "the old primary jump is gone");
  // The prompt is a GET back into the ordinary website lookup, carrying the seed.
  const prompt = PAGE.slice(PAGE.indexOf("function WebsitePrompt"));
  assert.match(prompt, /<form method="get" action="\/join\/brand"[^>]*>\s*<input type="hidden" name="as" value="website" \/>\s*<SeedFields seed=\{seed\} \/>/);
  assert.match(prompt, /name="q"/);
  assert.match(prompt, />\s*Build My Brand Profile\s*</);
  assert.match(prompt, /label="Add It Myself"/);
  assert.match(prompt, /autoCapitalize="none"\s+autoCorrect="off"\s+spellCheck=\{false\}/);
});

test("name first: the website goes through the existing website LOOKUP before any analysis — existing → Claim", async () => {
  const next = B.searchHref("fentybeauty.com", "website", { name: "Fenty Beauty" });
  assert.equal(next, "/join/brand?q=fentybeauty.com&as=website&seed_name=Fenty+Beauty");
  const p = params(next);
  const c = B.classifyBrandInput(p.get("q"), p.get("as"));
  assert.equal(c.kind, "website");
  const looked = [];
  const result = await B.lookupBrand(c, true, {
    findMatches: async (input) => {
      looked.push(input);
      return [{ id: "1", slug: "fenty-beauty", name: "Fenty Beauty", reasons: ["website"], isPublic: true }];
    },
    readPublicCards: async () => [{ slug: "fenty-beauty", name: "Fenty Beauty", logoUrl: null, category: null, city: null, state: null }],
  });
  assert.deepEqual(looked, [{ websiteUrl: "fentybeauty.com" }]);
  assert.equal(result.state, "strong", "existing Business → claim cards");
  assert.equal(B.claimHref("fenty-beauty", true), "/business/fenty-beauty?claim=1");
});

test("name first: new website → Build (signed-in POST carries the seed; guests sign in and return with it)", () => {
  assert.match(PAGE, /<input type="hidden" name="website" value=\{value\} \/>\s*<SeedFields seed=\{seed\} \/>\s*<BuildProfileButton \/>/);
  assert.match(PAGE, /searchHref\(value, "website", seed\)/);
  assert.match(PAGE, /const seed = as === "website" \? sanitizeBrandSeed\(\{ name: seedName, instagram: seedInstagram \}\) : \{\};/, "seed only for website searches");
  const action = read("src/app/(public)/join/brand/actions.ts");
  assert.match(action, /sanitizeBrandSeed\(\{ name: formData\.get\(BRAND_SEED_PARAMS\.name\), instagram: formData\.get\(BRAND_SEED_PARAMS\.instagram\) \}\)/);
  assert.match(action, /analyzeBrandWebsite\(\{ website, userId: user\?\.id \?\? null, ip, seed \}, deps\)/);
});

test("name first: the original name wins over the extracted name, stays editable, and the matcher checks BOTH", async () => {
  const { deps: d, calls } = deps();
  const r = await A.analyzeBrandWebsite({ website: "fentybeauty.com", userId: "u", ip: "1", seed: { name: "Fenty Beauty" } }, d);
  assert.equal(r.outcome, "prefilled");
  const p = params(r.href);
  assert.equal(p.get("name"), "Fenty Beauty");
  assert.equal(p.get("instagram_url"), "https://www.instagram.com/fentybeautyofficial", "extracted Instagram still suggested");
  assert.equal(p.get("source"), "brand");
  assert.equal(calls.match[0].name, "Fenty Beauty");
  assert.ok(calls.match.some((m) => m.name === "FENTY BEAUTY by Rihanna"), "the extracted name is matched too");
});

test("name first: an extracted-name match that is public still routes to Claim", async () => {
  const { deps: d } = deps({
    findMatches: async (input) => (input.name === "FENTY BEAUTY by Rihanna" ? [{ id: "9", slug: "fenty", name: "x", reasons: ["name_location"], isPublic: true }] : []),
  });
  const r = await A.analyzeBrandWebsite({ website: "fentybeauty.com", userId: "u", ip: "1", seed: { name: "Fenty Beauty" } }, d);
  assert.deepEqual(r, { href: "/business/fenty?claim=1", outcome: "public_match" });
});

// ── INSTAGRAM FIRST ───────────────────────────────────────────────────────
test("Instagram first: no match → website prompt; the handle survives as a bounded, canonical seed", async () => {
  const c = B.classifyBrandInput("@FentyBeauty");
  assert.equal(c.kind, "instagram");
  assert.match(PAGE, /seed=\{inputKind === "name" \? \{ name: value \} : \{ instagram: instagramSeed \}\}/);
  assert.equal(B.searchHref("fentybeauty.com", "website", { instagram: "https://instagram.com/FentyBeauty?igsh=x" }), "/join/brand?q=fentybeauty.com&as=website&seed_instagram=fentybeauty");
  const { deps: d, calls } = deps();
  const r = await A.analyzeBrandWebsite({ website: "fentybeauty.com", userId: "u", ip: "1", seed: { instagram: "fentybeauty" } }, d);
  assert.equal(params(r.href).get("instagram_url"), "https://www.instagram.com/fentybeauty", "visitor's handle wins");
  assert.equal(params(r.href).get("name"), "FENTY BEAUTY by Rihanna", "no name seed → extracted name");
  assert.ok(calls.match.some((m) => m.instagramUrl === "https://www.instagram.com/fentybeautyofficial"), "extracted handle matched too");
});

// ── WEBSITE FIRST (unchanged) ─────────────────────────────────────────────
test("website first: no seed → extracted values, as in V1.1B; links unchanged apart from source=brand", async () => {
  const { deps: d } = deps();
  const r = await A.analyzeBrandWebsite({ website: "fentybeauty.com", userId: "u", ip: "1" }, d);
  assert.equal(params(r.href).get("name"), "FENTY BEAUTY by Rihanna");
  assert.equal(B.createHref({ kind: "website", value: "fentybeauty.com" }), "/account/business/new?website_url=https%3A%2F%2Ffentybeauty.com&source=brand");
  assert.equal(B.searchHref("fentybeauty.com", "website"), "/join/brand?q=fentybeauty.com&as=website");
});

// ── SOURCE = BRAND ────────────────────────────────────────────────────────
test("source=brand is on every Brand Onboarding create link: Add It Myself (all kinds), analysis, every fallback", async () => {
  for (const href of [
    B.createHref({ kind: "name", value: "Fenty Beauty" }),
    B.createHref({ kind: "instagram", value: "@fentybeauty" }),
    B.createHref({ kind: "website", value: "fentybeauty.com" }, { name: "Fenty Beauty" }),
    A.manualBrandFormHref("fentybeauty.com", { name: "Fenty Beauty" }),
    C.brandCandidateHref({}, "limited"),
  ]) {
    assert.deepEqual(params(href).getAll("source"), ["brand"], href);
  }
  const fail = deps({ fetchHtml: async () => ({ ok: false, code: "blocked_by_site", redirects: 0 }) });
  const r = await A.analyzeBrandWebsite({ website: "fentybeauty.com", userId: "u", ip: "1", seed: { name: "Fenty Beauty" } }, fail.deps);
  assert.deepEqual(Object.fromEntries(params(r.href)), { name: "Fenty Beauty", website_url: "https://fentybeauty.com", prefill: "unavailable", source: "brand" });
  assert.equal(params(B.createHref({ kind: "website", value: "fentybeauty.com" }, { name: "Fenty Beauty" })).get("name"), "Fenty Beauty", "Add It Myself keeps the seed");
});

test("seeds are bounded and can carry nothing else", () => {
  assert.deepEqual(C.sanitizeBrandSeed({ name: "x".repeat(201) }), {});
  assert.deepEqual(C.sanitizeBrandSeed({ name: "Fenty\u0007 Beauty", instagram: "not a handle!" }), { name: "Fenty Beauty" });
  assert.deepEqual(C.sanitizeBrandSeed({ name: 42, instagram: ["@x"] }), {});
  assert.deepEqual(C.sanitizeBrandSeed({ name: "A", instagram: "@ok_handle", authorized: "1", plan_choice: "pro", market_id: "m" }), { name: "A", instagram: "ok_handle" });
  const hostile = B.searchHref("fentybeauty.com", "website", { name: "Evil&authorized=1&plan_choice=pro&source=brand" });
  assert.deepEqual([...params(hostile).keys()].sort(), ["as", "q", "seed_name"]);
  const created = C.brandCandidateHref({ ...C.seedCandidate({ name: "Evil&authorized=1" }), website_url: "https://a.com" });
  assert.deepEqual([...params(created).keys()].sort(), ["name", "source", "website_url"]);
  assert.deepEqual(Object.values(C.BRAND_SEED_PARAMS).sort(), ["seed_instagram", "seed_name"]);
});

test("Review Your Brand presentation: same form, no Free/Pro picker, Add My Brand; authorization never prefilled", () => {
  assert.match(NEW_PAGE, /const brandOnboarding = parseBrandSource\(source\);/);
  assert.match(NEW_PAGE, /\{brandOnboarding \? "Review Your Brand" : "Add a Business"\}/);
  assert.match(NEW_PAGE, /\{brandOnboarding && <input type="hidden" name="source" value=\{BRAND_SOURCE\} \/>\}/);
  assert.match(NEW_PAGE, /\{hasInvite \? \([\s\S]*?\) : brandOnboarding \? null : \(\s*<div>/, "invite block kept; plan picker skipped for brand");
  assert.match(NEW_PAGE, /\{brandOnboarding \? "Add My Brand" : "Create My Business"\}/);
  assert.equal((NEW_PAGE.match(/<form action=\{createMemberBusiness\}/g) ?? []).length, 1, "one form, not a duplicate");
  assert.ok(!C.BRAND_CANDIDATE_FIELDS.includes("authorized") && !C.BRAND_CANDIDATE_FIELDS.includes("plan_choice"));
  assert.equal(C.parseBrandSource("brand"), true);
  assert.equal(C.parseBrandSource("Brand"), false);
  assert.equal(C.parseBrandSource("admin"), false);
});

test("createMemberBusiness: source=brand ignores plan_choice, round-trips the flag, and lands on the Profile", () => {
  assert.match(CREATE, /const brandOnboarding = parseBrandSource\(str\(formData, "source"\)\);\s*const planChoiceRaw = brandOnboarding \? null : str\(formData, "plan_choice"\);/);
  assert.match(CREATE, /source: brandOnboarding \? BRAND_SOURCE : null,/, "kept through every preservedFields error redirect");
  const invite = CREATE.indexOf("if (inviteRaw) {");
  const pro = CREATE.indexOf('if (planChoiceRaw === "pro") {');
  const brand = CREATE.indexOf("if (brandOnboarding) redirect(`/account/business/${businessId}?tab=profile&created=1`);");
  const normal = CREATE.lastIndexOf("redirect(`/account/business/${businessId}?created=1`);");
  assert.ok(invite > 0 && invite < pro && pro < brand && brand < normal, "invite → Pro (non-brand only) → brand profile → unchanged default");
  // Matcher still runs before the unchanged create RPC.
  assert.ok(CREATE.indexOf("await findBusinessMatches(admin") < CREATE.indexOf('admin.rpc("create_owned_business"'));
  assert.doesNotMatch(CREATE.slice(CREATE.indexOf('admin.rpc("create_owned_business"'), CREATE.indexOf("});", CREATE.indexOf('admin.rpc("create_owned_business"'))), /source|plan/);
});

test("Profile tab shows the created confirmation; Overview keeps its own", () => {
  const profile = MANAGER.slice(MANAGER.indexOf('{activeTab === "profile" && ('));
  assert.match(profile.slice(0, 1200), /\{created && \(\s*<p[^>]*>\s*Business created!/);
  assert.match(MANAGER, /Business created! You can start building your profile below\./, "Overview banner unchanged");
});

test("scope guard: matcher, safe-fetch and geography untouched by this correction", () => {
  // Geography: city/state/market still required at creation, RPC args unchanged.
  assert.match(CREATE, /if \(!city \|\| !state\) fail\("City and state are required\."\);/);
  assert.match(CREATE, /if \(!marketId && !requestedMarketText\) \{/);
  assert.match(CREATE, /p_market_id: effectiveMarketId,/);
  assert.doesNotMatch(read("src/lib/brand-website-analysis.ts"), /safeFetchHtml\(url, \{/, "default safe-fetch options");
});
