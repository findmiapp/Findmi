// Brand Onboarding V1 · Pass 2B — Find or Add Your Brand (/join/brand).
// Classification, public-only render model, hidden-record protection,
// claim/create handoffs, rate limiting and architectural guards. No
// network, no production DB. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/headers") return { url: "data:text/javascript,export const headers=async()=>new Map()", shortCircuit: true };
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
const RL = await import("../src/lib/brand-lookup-rate-limit.ts");

// ── Classification ────────────────────────────────────────────────────────
test("classify: name, website (scheme / bare domain), Instagram (@ / URL)", () => {
  const c = (q, as) => B.classifyBrandInput(q, as);
  assert.deepEqual(c("Lavazza"), { ok: true, kind: "name", value: "Lavazza", alternative: "instagram" });
  assert.deepEqual(c("Joe's Pizza"), { ok: true, kind: "name", value: "Joe's Pizza", alternative: null });
  assert.equal(c("https://lavazza.com/us").kind, "website");
  assert.equal(c("lavazza.com").kind, "website");
  assert.equal(c("@lavazzausa").kind, "instagram");
  assert.equal(c("instagram.com/lavazzausa").kind, "instagram");
  assert.equal(c("https://www.instagram.com/lavazzausa/?igsh=x").kind, "instagram");
  assert.equal(c("  東京珈琲  ").kind, "name");
});

test("classify: www.domain.com is deterministically a website; malformed whitespace is never loosened into one", () => {
  assert.deepEqual(B.classifyBrandInput("www.fentybeauty.com"), { ok: true, kind: "website", value: "www.fentybeauty.com", alternative: "name" });
  assert.equal(B.classifyBrandInput("www. fentybeauty.com").kind, "name", "a space inside the input keeps it a name");
  const page = readFileSync("src/app/(public)/join/brand/page.tsx", "utf8");
  assert.match(page, /autoCapitalize="none"\s+autoCorrect="off"\s+spellCheck=\{false\}/, "mobile keyboards can't alter domains/handles");
});

test("classify: ambiguous dotted token defaults to website but offers name; bare words are never auto-Instagram", () => {
  assert.deepEqual(B.classifyBrandInput("joe.coffee"), { ok: true, kind: "website", value: "joe.coffee", alternative: "name" });
  const bare = B.classifyBrandInput("lavazzausa");
  assert.equal(bare.kind, "name");
  assert.equal(bare.alternative, "instagram", "offered, never assumed");
  assert.equal(B.classifyBrandInput("St. Marks Coffee").kind, "name", "spaces → name even with a dot");
});

test("classify: as= overrides", () => {
  assert.deepEqual(B.classifyBrandInput("joe.coffee", "name"), { ok: true, kind: "name", value: "joe.coffee", alternative: null });
  assert.deepEqual(B.classifyBrandInput("lavazzausa", "instagram"), { ok: true, kind: "instagram", value: "lavazzausa", alternative: null });
  assert.equal(B.classifyBrandInput("Joe's Pizza", "website").ok, false, "invalid override → invalid, never silently reinterpreted");
  assert.equal(B.classifyBrandInput("Lavazza", "bogus").kind, "name", "unknown override ignored");
});

test("classify: empty, too short, too long, malformed", () => {
  assert.deepEqual(B.classifyBrandInput(""), { ok: false, reason: "empty", kind: null });
  assert.deepEqual(B.classifyBrandInput("   "), { ok: false, reason: "empty", kind: null });
  assert.deepEqual(B.classifyBrandInput("a"), { ok: false, reason: "too_short", kind: null });
  assert.equal(B.classifyBrandInput("x".repeat(201)).reason, "too_long");
  assert.equal(B.classifyBrandInput("x".repeat(200)).ok, true);
  assert.deepEqual(B.classifyBrandInput("@"), { ok: false, reason: "too_short", kind: null });
  assert.deepEqual(B.classifyBrandInput("@bad handle!"), { ok: false, reason: "invalid", kind: "instagram" });
  assert.deepEqual(B.classifyBrandInput("https://instagram.com/p/abc"), { ok: false, reason: "invalid", kind: "instagram" });
  assert.deepEqual(B.classifyBrandInput("https://localhost"), { ok: false, reason: "invalid", kind: "website" });
  assert.deepEqual(B.classifyBrandInput("!!!"), { ok: false, reason: "invalid", kind: "name" });
});

// ── Lookup decision ───────────────────────────────────────────────────────
const match = (slug, isPublic, reasons = ["website"]) => ({ id: `id-${slug}`, slug, name: `Name ${slug}`, reasons, isPublic });
const card = (slug) => ({ slug, name: `Public ${slug}`, logoUrl: null, category: "Coffee", city: "New York", state: "NY" });
function deps(matches, publicSlugs = matches.filter((m) => m.isPublic).map((m) => m.slug)) {
  const calls = { find: [], read: [] };
  return {
    calls,
    deps: {
      findMatches: async (input) => (calls.find.push(input), matches),
      readPublicCards: async (slugs) => (calls.read.push(slugs), slugs.filter((s) => publicSlugs.includes(s)).map(card)),
    },
  };
}
const FORBIDDEN = ["id", "reasons", "isPublic", "publication_status", "membership_status", "plan_tier", "website_url", "instagram_url", "email", "phone"];
const assertNoForbidden = (result) => {
  const json = JSON.stringify(result);
  for (const key of FORBIDDEN) assert.ok(!json.includes(`"${key}"`), `forbidden field ${key} in ${json}`);
};

test("strong public website / Instagram match → 'strong' with only approved card fields", async () => {
  for (const kind of ["website", "instagram"]) {
    const { deps: d, calls } = deps([match("lavazza", true, [kind])]);
    const r = await B.lookupBrand({ kind, value: kind === "website" ? "lavazza.com" : "@lavazzausa" }, false, d);
    assert.equal(r.state, "strong");
    assert.deepEqual(r.candidates, [card("lavazza")]);
    assert.deepEqual(Object.keys(r.candidates[0]).sort(), ["category", "city", "logoUrl", "name", "slug", "state"]);
    assertNoForbidden(r);
    assert.deepEqual(calls.find[0], kind === "website" ? { websiteUrl: "lavazza.com" } : { instagramUrl: "@lavazzausa" });
  }
});

test("name-only public candidates → 'possible' (selection, never 'this is yours'), max 5, matcher order kept", async () => {
  const many = Array.from({ length: 7 }, (_, i) => match(`joes-${i}`, true, ["name_location"]));
  const { deps: d } = deps(many);
  const r = await B.lookupBrand({ kind: "name", value: "Joe's Pizza" }, false, d);
  assert.equal(r.state, "possible");
  assert.equal(r.candidates.length, 5);
  assert.deepEqual(r.candidates.map((c) => c.slug), ["joes-0", "joes-1", "joes-2", "joes-3", "joes-4"]);
  assertNoForbidden(r);
});

test("protected/non-public rows are never displayed; a 'public' match the public re-read won't confirm is treated as protected", async () => {
  const { deps: d, calls } = deps([match("hidden", false), match("public-one", true), match("unconfirmed", true)], ["public-one"]);
  const r = await B.lookupBrand({ kind: "website", value: "x.com" }, false, d);
  assert.deepEqual(r.candidates.map((c) => c.slug), ["public-one"]);
  assert.deepEqual(calls.read[0], ["public-one", "unconfirmed"], "hidden slugs are never even sent to the public re-read");
  assert.ok(!JSON.stringify(r).includes("hidden"));
});

test("ANONYMOUS: hidden conflict renders exactly the ordinary no-match state", async () => {
  const hidden = await B.lookupBrand({ kind: "website", value: "lavazza.com" }, false, deps([match("secret-slug", false)]).deps);
  const none = await B.lookupBrand({ kind: "website", value: "lavazza.com" }, false, deps([]).deps);
  assert.deepEqual(hidden, { state: "none" });
  assert.deepEqual(hidden, none, "byte-identical render model");
  for (const leak of ["secret-slug", "id-secret", "Name secret", "pending", "website"]) assert.ok(!JSON.stringify(hidden).includes(leak));
});

test("AUTHENTICATED: hidden conflict with no public target → generic 'assistance' only; public target still wins", async () => {
  const r = await B.lookupBrand({ kind: "website", value: "lavazza.com" }, true, deps([match("secret-slug", false)]).deps);
  assert.deepEqual(r, { state: "assistance" });
  const withPublic = await B.lookupBrand({ kind: "website", value: "lavazza.com" }, true, deps([match("secret-slug", false), match("pub", true)]).deps);
  assert.equal(withPublic.state, "strong");
  assert.deepEqual(withPublic.candidates.map((c) => c.slug), ["pub"]);
  const empty = await B.lookupBrand({ kind: "name", value: "Nothing" }, true, deps([]).deps);
  assert.deepEqual(empty, { state: "none" });
});

// ── Handoffs ──────────────────────────────────────────────────────────────
test("claim links reuse ClaimButton's ?claim=1, guests go through /login with an encoded next", () => {
  assert.equal(B.claimHref("lavazza", true), "/business/lavazza?claim=1");
  assert.equal(B.claimHref("lavazza", false), "/login?next=%2Fbusiness%2Flavazza%3Fclaim%3D1");
  assert.equal(decodeURIComponent(B.claimHref("joe's-pizza", false).split("next=")[1]), "/business/joe's-pizza?claim=1");
});

test("create links prefill only the visitor's own input, safely encoded", () => {
  assert.equal(B.createHref({ kind: "name", value: "Joe's Pizza & Co" }), "/account/business/new?name=Joe%27s+Pizza+%26+Co");
  assert.equal(B.createHref({ kind: "website", value: "lavazza.com/us" }), "/account/business/new?website_url=https%3A%2F%2Flavazza.com%2Fus");
  assert.equal(B.createHref({ kind: "website", value: "http://lavazza.com" }), "/account/business/new?website_url=http%3A%2F%2Flavazza.com");
  assert.equal(
    B.createHref({ kind: "instagram", value: "https://instagram.com/LavazzaUSA?igsh=abc" }),
    "/account/business/new?instagram_url=https%3A%2F%2Fwww.instagram.com%2Flavazzausa"
  );
  const page = readFileSync("src/app/(public)/account/business/new/page.tsx", "utf8");
  for (const field of ["name", "website_url", "instagram_url"]) assert.match(page, new RegExp(`${field}\\?: string;`), `create form reads ${field}`);
});

// ── Rate limit ────────────────────────────────────────────────────────────
test("rate limit: 30 per 10 minutes per key, limited attempts don't extend the window, recovers after it", () => {
  RL.resetBrandLookupRateLimit();
  const t0 = 1_000_000;
  for (let i = 0; i < RL.BRAND_LOOKUP_MAX_PER_WINDOW; i++) assert.equal(RL.recordBrandLookupAttempt("1.2.3.4", t0 + i), false);
  assert.equal(RL.recordBrandLookupAttempt("1.2.3.4", t0 + 100), true);
  assert.equal(RL.recordBrandLookupAttempt("5.6.7.8", t0 + 100), false, "keys are independent");
  assert.equal(RL.recordBrandLookupAttempt("1.2.3.4", t0 + RL.BRAND_LOOKUP_WINDOW_MS + 50), false, "window recovers");
  RL.resetBrandLookupRateLimit();
  const src = readFileSync("src/lib/brand-lookup-rate-limit.ts", "utf8");
  assert.match(src, /NON-DISTRIBUTED/);
  assert.doesNotMatch(src, /\.from\(|\.insert\(|localStorage|cookies\(/, "nothing persisted");
});

// ── Architecture / scope ──────────────────────────────────────────────────
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test("architecture: server-only helpers, no public JSON lookup API, matcher never reaches client code", () => {
  for (const f of ["src/lib/brand-lookup.ts", "src/lib/brand-lookup-rate-limit.ts"]) {
    assert.match(readFileSync(f, "utf8"), /^import "server-only";/, f);
  }
  assert.equal(existsSync("src/app/api/brand"), false);
  assert.equal(existsSync("src/app/api/brand-lookup"), false);
  for (const f of walk("src")) {
    if (!/\.(ts|tsx)$/.test(f)) continue;
    const s = readFileSync(f, "utf8");
    if (/^["']use client["']/.test(s)) {
      assert.doesNotMatch(s, /business-matching|brand-lookup/, `client file imports matcher/lookup: ${f}`);
    }
    if (f.startsWith("src/app/api/")) assert.doesNotMatch(s, /brand-lookup|findBusinessMatches/, `API route exposes lookup: ${f}`);
  }
  const page = readFileSync("src/app/(public)/join/brand/page.tsx", "utf8");
  assert.doesNotMatch(page, /^["']use client["']/);
  assert.match(page, /robots: \{ index: false \}/);
  assert.match(page, /<form method="get" action="\/join\/brand"/);
  assert.doesNotMatch(page, /findBusinessMatches|business-matching/, "page only sees the narrow render model");
  const mw = readFileSync("src/middleware.ts", "utf8");
  assert.doesNotMatch(mw, /join/, "/join/brand stays public");
});

test("public re-read is anon, live-only, non-demo, not archived/trashed, and selects no private columns", () => {
  const src = readFileSync("src/lib/brand-lookup.ts", "utf8");
  const fn = src.slice(src.indexOf("async function readPublicCardsViaAnon"), src.indexOf("export function defaultBrandLookupDeps"));
  assert.match(fn, /getSupabase\(\)/);
  assert.doesNotMatch(fn, /getAdminSupabase/);
  for (const guard of ['.eq("is_demo", false)', '.eq("publication_status", "live")', '.is("archived_at", null)', '.is("trashed_at", null)']) {
    assert.ok(fn.includes(guard), guard);
  }
  assert.match(fn, /\.select\("id, slug, name, logo_url, city, state"\)/);
});

test("CTA retargeting: only the homepage Add Business card and the /join brand card point at /join/brand", () => {
  const home = readFileSync("src/app/(public)/page.tsx", "utf8");
  assert.match(home, /href="\/join\/brand"/);
  assert.doesNotMatch(home, /href="\/account\/business\/new"/);
  const join = readFileSync("src/app/(public)/join/page.tsx", "utf8");
  assert.match(join, /href="\/join\/brand"\s*\n\s*icon=\{<NavIcon name="storefront"/);
  assert.doesNotMatch(join, /intent=business/);
  // Untouched: QuickCreate, /join/start, /join/business pricing paths.
  assert.match(readFileSync("src/components/QuickCreateMenu.tsx", "utf8"), /\/account\/business\/new/);
  assert.match(readFileSync("src/app/(public)/join/start/page.tsx", "utf8"), /href="\/account\/business\/new"/);
});
