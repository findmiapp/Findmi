// Brand Onboarding V1.1B — website-assisted brand creation orchestration
// (src/lib/brand-website-analysis.ts), the one candidate serializer
// (src/lib/brand-candidate.ts), the analysis limiter, the /join/brand
// entry point and the existing creation path's short_description support.
// Stubbed fetch/matcher/categories — no network, no production DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

const A = await import("../src/lib/brand-website-analysis.ts");
const C = await import("../src/lib/brand-candidate.ts");
const RL = await import("../src/lib/brand-website-rate-limit.ts");

const CATEGORY_ID = "3f2c1a9e-8b7d-4c6e-9f10-112233445566";
const HTML = `<!doctype html><html><head>
  <title>Espresso & More | Lavazza</title>
  <meta name="description" content="Italian coffee since 1895.">
  <script type="application/ld+json">${JSON.stringify({
    "@type": "CafeOrCoffeeShop",
    name: "Lavazza",
    url: "https://www.lavazza.com/",
    sameAs: ["https://www.instagram.com/lavazzausa/"],
    address: { "@type": "PostalAddress", addressLocality: "New York", addressRegion: "NY", addressCountry: "US" },
    logo: "https://www.lavazza.com/logo.png",
  })}</script></head><body></body></html>`;

function makeDeps(over = {}) {
  const calls = { fetch: [], match: [], logs: [], categories: 0 };
  const deps = {
    fetchHtml: async (url) => {
      calls.fetch.push(url.href);
      return { ok: true, url: new URL(url.href), html: HTML, bytes: HTML.length, redirects: 0 };
    },
    findMatches: async (input) => {
      calls.match.push(input);
      return [];
    },
    listCategories: async () => {
      calls.categories += 1;
      return [{ id: CATEGORY_ID, slug: "coffee" }, { id: "00000000-0000-4000-8000-000000000001", slug: "food-drink" }];
    },
    isRateLimited: () => false,
    enrich: async () => ({ result: null, called: false, usage: null }),
    verifyImage: async () => false,
    draftsEnabled: false,
    acquireSlot: () => () => {},
    cache: A.createExtractionCache(),
    log: (entry) => calls.logs.push(entry),
    now: () => 1_000_000,
    ...over,
  };
  return { deps, calls };
}
const run = (deps, website = "lavazza.com", userId = "user-1") => A.analyzeBrandWebsite({ website, userId, ip: "203.0.113.5" }, deps);
const params = (href) => new URL(href, "https://findmi.app").searchParams;
const ALLOWED_KEYS = new Set([...C.BRAND_CANDIDATE_FIELDS, "prefill", "source"]);

// ── Candidate serializer ──────────────────────────────────────────────────
test("serializer: strict whitelist — authority/plan/ownership/ids can never be serialized", () => {
  const href = C.brandCandidateHref({
    name: "Lavazza",
    authorized: "1",
    plan_choice: "pro",
    plan_tier: "pro",
    invite: "FREEPRO",
    ref: "PARTNER",
    market_id: "11111111-1111-4111-8111-111111111111",
    publication_status: "live",
    membership_status: "active",
    owner: "me",
    user_id: "u",
    is_pro_member: "true",
    duplicate_slug: "x",
    error: "x",
  });
  assert.equal(href, "/account/business/new?name=Lavazza&source=brand");
});

test("serializer: per-field validation (url schemes, Instagram canonical form, UUID category, 160-char description)", () => {
  const p = params(
    C.brandCandidateHref({
      website_url: "javascript:alert(1)",
      instagram_url: "@LavazzaUSA",
      short_description: "x".repeat(161),
      category_id: "not-a-uuid",
      city: "Austin\u0007",
      state: "TX",
    })
  );
  assert.equal(p.get("website_url"), null);
  assert.equal(p.get("instagram_url"), "https://www.instagram.com/lavazzausa");
  assert.equal(p.get("short_description"), null, "over the max is dropped, never silently truncated here");
  assert.equal(p.get("category_id"), null);
  assert.equal(p.get("city"), "Austin");
  assert.equal(params(C.brandCandidateHref({ website_url: "https://u:p@brand.com/" })).get("website_url"), null);
  assert.equal(params(C.brandCandidateHref({ category_id: CATEGORY_ID.toUpperCase() })).get("category_id"), CATEGORY_ID);
  assert.equal(params(C.brandCandidateHref({ short_description: "y".repeat(160) })).get("short_description").length, 160);
});

test("serializer: prefill flag is a fixed enum; parser rejects anything else", () => {
  assert.equal(params(C.brandCandidateHref({ name: "x" }, "website")).get("prefill"), "website");
  assert.equal(params(C.brandCandidateHref({ name: "x" }, "evil")).get("prefill"), null);
  assert.equal(C.parseBrandPrefillStatus("limited"), "limited");
  assert.equal(C.parseBrandPrefillStatus("live"), null);
  assert.equal(C.parseBrandPrefillStatus(undefined), null);
  assert.equal(C.prefillHostLabel("https://www.lavazza.com/us"), "lavazza.com");
});

test("serializer is the ONE place create-form URLs are built", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && p !== "src/lib/brand-candidate.ts") {
        const s = readFileSync(p, "utf8");
        if (/["'`]\/account\/business\/new\?/.test(s) && /website_url|instagram_url|short_description/.test(s) && /URLSearchParams|params\.set/.test(s)) offenders.push(p);
      }
    }
  };
  walk("src/lib");
  walk("src/app/(public)/join");
  assert.deepEqual(offenders, []);
  assert.match(readFileSync("src/lib/brand-lookup.ts", "utf8"), /brandCandidateHref\(/);
});

// ── Analysis ──────────────────────────────────────────────────────────────
test("auth required: no account → sign-in back to the same website no-match result; nothing fetched or matched", async () => {
  const { deps, calls } = makeDeps();
  const r = await run(deps, "lavazza.com", null);
  assert.equal(r.outcome, "auth_required");
  assert.equal(r.href, "/login?next=" + encodeURIComponent("/join/brand?q=lavazza.com&as=website"));
  assert.deepEqual([calls.fetch.length, calls.match.length], [0, 0]);
});

test("genuinely new website → existing create form with ONLY whitelisted candidate params + prefill=website", async () => {
  const { deps, calls } = makeDeps();
  const r = await run(deps);
  assert.equal(r.outcome, "prefilled");
  assert.ok(r.href.startsWith("/account/business/new?"));
  const p = params(r.href);
  for (const key of p.keys()) assert.ok(ALLOWED_KEYS.has(key), `unexpected param ${key}`);
  assert.deepEqual(Object.fromEntries(p), {
    name: "Lavazza",
    website_url: "https://lavazza.com",
    instagram_url: "https://www.instagram.com/lavazzausa",
    short_description: "Italian coffee since 1895.",
    city: "New York",
    state: "NY",
    category_id: CATEGORY_ID,
    prefill: "website",
    source: "brand",
  });
  assert.deepEqual(calls.fetch, ["https://lavazza.com/"], "https only, one page");
  assert.equal(p.get("authorized"), null);
});

test("matcher runs AGAIN with the strongest extracted signals (website + Instagram + name/location, final host)", async () => {
  const { deps, calls } = makeDeps({
    fetchHtml: async (url) => ({ ok: true, url: new URL("https://www.lavazzausa.com/home"), html: HTML, bytes: 1, redirects: 1 }),
  });
  await run(deps);
  assert.deepEqual(calls.match[0], {
    websiteUrl: "https://lavazza.com",
    instagramUrl: "https://www.instagram.com/lavazzausa",
    name: "Lavazza",
    city: "New York",
    state: "NY",
  });
  assert.deepEqual(calls.match[1], { websiteUrl: "https://www.lavazzausa.com/home" }, "redirected host is matched too");
});

test("public extracted match → the existing claim path; hidden → generic assistance (no identity)", async () => {
  const pub = makeDeps({ findMatches: async () => [{ id: "b1", slug: "lavazza", name: "Lavazza", reasons: ["instagram"], isPublic: true }] });
  const r1 = await run(pub.deps);
  assert.deepEqual(r1, { href: "/business/lavazza?claim=1", outcome: "public_match" });
  const hidden = makeDeps({ findMatches: async () => [{ id: "b2", slug: "secret-brand", name: "Secret Brand", reasons: ["name_location"], isPublic: false }] });
  const r2 = await run(hidden.deps);
  assert.deepEqual(r2, { href: "/join/brand?notice=already_listed", outcome: "hidden_match" });
  assert.doesNotMatch(r2.href, /secret|b2/);
  const mixed = makeDeps({
    findMatches: async () => [
      { id: "b2", slug: "hidden-one", name: "H", reasons: ["website"], isPublic: false },
      { id: "b1", slug: "lavazza", name: "Lavazza", reasons: ["name_location"], isPublic: true },
    ],
  });
  assert.equal((await run(mixed.deps)).href, "/business/lavazza?claim=1", "a public target wins");
});

test("every fetch failure → the manual form with the website preserved (never a dead end, never a reason leak)", async () => {
  for (const code of ["dns_failed", "timeout", "blocked_destination", "redirect_loop", "too_many_redirects", "redirect_rejected", "blocked_by_site", "http_error", "unsupported_content", "too_large", "network_error"]) {
    const { deps, calls } = makeDeps({ fetchHtml: async () => ({ ok: false, code, redirects: 0 }) });
    const r = await run(deps, "https://lavazza.com/us?utm=1");
    assert.equal(r.outcome, code);
    assert.equal(r.href, "/account/business/new?website_url=https%3A%2F%2Flavazza.com%2Fus%3Futm%3D1&prefill=unavailable&source=brand", code);
    assert.equal(calls.match.length, 0);
  }
});

test("logging: HTML size outcome — complete, successful truncated, streamed/header limit, declared over the old 1 MB", async () => {
  const truncated = makeDeps({
    fetchHtml: async (url) => ({ ok: true, url: new URL(url.href), html: HTML, bytes: 400000, redirects: 1, truncated: true, declaredBytes: 3000000 }),
  });
  assert.equal((await run(truncated.deps)).outcome, "prefilled");
  const t = truncated.calls.logs[0];
  assert.deepEqual([t.size, t.truncated, t.declaredSizeExceededOldLimit, t.bytes, t.redirects], ["successful_truncated_html", true, true, 400000, 1]);

  const complete = makeDeps({
    fetchHtml: async (url) => ({ ok: true, url: new URL(url.href), html: HTML, bytes: HTML.length, redirects: 0, truncated: false, declaredBytes: HTML.length }),
  });
  await run(complete.deps);
  const c = complete.calls.logs[0];
  assert.deepEqual([c.size, c.truncated, c.declaredSizeExceededOldLimit], ["complete_html", false, false]);

  for (const [limit, size] of [["streamed", "streamed_limit"], ["headers", "header_limit"]]) {
    const failed = makeDeps({ fetchHtml: async () => ({ ok: false, code: "too_large", redirects: 0, limit, declaredBytes: null }) });
    assert.equal((await run(failed.deps)).outcome, "too_large");
    const f = failed.calls.logs[0];
    assert.deepEqual([f.size, f.truncated, f.declaredSizeExceededOldLimit, f.bytes], [size, null, null, null]);
  }
});

test("no metadata, extraction error, matcher error, busy, unsupported site → manual form", async () => {
  const empty = makeDeps({ fetchHtml: async (url) => ({ ok: true, url, html: "<html></html>", bytes: 13, redirects: 0 }) });
  assert.deepEqual(await run(empty.deps), { href: "/account/business/new?website_url=https%3A%2F%2Flavazza.com&prefill=unavailable&source=brand", outcome: "no_metadata" });
  const broken = makeDeps({ findMatches: async () => Promise.reject(new Error("db down")) });
  assert.equal((await run(broken.deps)).outcome, "match_failed");
  assert.match((await run(broken.deps)).href, /prefill=unavailable/, "never prefill without the post-extraction match");
  const busy = makeDeps({ acquireSlot: () => null });
  assert.equal((await run(busy.deps)).outcome, "busy");
  const platform = makeDeps();
  const r = await run(platform.deps, "linktr.ee/lavazza");
  assert.equal(r.outcome, "unsupported_site");
  assert.equal(platform.calls.fetch.length, 0);
  assert.equal((await run(makeDeps().deps, "not a website")).outcome, "invalid_input");
});

test("rate limited → manual form with the 'limited' notice; no fetch", async () => {
  const { deps, calls } = makeDeps({ isRateLimited: () => true });
  const r = await run(deps);
  assert.deepEqual(r, { href: "/account/business/new?website_url=https%3A%2F%2Flavazza.com&prefill=limited&source=brand", outcome: "rate_limited" });
  assert.equal(calls.fetch.length, 0);
});

test("cache: successful extractions reused for 10 minutes (matcher still re-runs); failures never cached", async () => {
  let now = 1_000_000;
  const cache = A.createExtractionCache();
  const { deps, calls } = makeDeps({ cache, now: () => now });
  await run(deps);
  await run(deps);
  assert.equal(calls.fetch.length, 1, "second run served from cache");
  assert.equal(calls.match.length, 2, "matching is never cached");
  assert.equal(calls.logs[1].cached, true);
  now += A.WEBSITE_ANALYSIS_CACHE_TTL_MS;
  await run(deps);
  assert.equal(calls.fetch.length, 2, "expired");
  let failingFetches = 0;
  const failing = makeDeps({
    fetchHtml: async () => {
      failingFetches += 1;
      return { ok: false, code: "timeout", redirects: 0 };
    },
  });
  await run(failing.deps);
  await run(failing.deps);
  assert.equal(failingFetches, 2, "a failure is retried next time, never served from cache");
  const small = A.createExtractionCache(1000, 2);
  for (const k of ["a", "b", "c"]) small.set(k, { profile: {}, finalUrl: k }, 0);
  assert.equal(small.size(), 2);
  assert.equal(small.get("a", 1), null, "oldest evicted");
});

test("logging: host/outcome/timings/counts/booleans only — no HTML, text, query strings or user ids", async () => {
  const { deps, calls } = makeDeps();
  await run(deps, "https://lavazza.com/us?secret=token", "user-secret-id");
  const entry = calls.logs[0];
  assert.deepEqual(Object.keys(entry).sort(), ["ai", "aiCacheCreationInputTokens", "aiCacheReadInputTokens", "aiCalled", "aiEstimatedCostUsd", "aiFromCache", "aiInputTokens", "aiModel", "aiOutputTokens", "bytes", "cached", "declaredSizeExceededOldLimit", "event", "fields", "host", "match", "ms", "outcome", "redirects", "size", "truncated"]);
  const json = JSON.stringify(calls.logs);
  for (const leak of ["Italian coffee", "<html", "secret=token", "user-secret-id", "lavazzausa", "New York", "203.0.113.5"]) {
    assert.ok(!json.includes(leak), `log leaks ${leak}`);
  }
  assert.equal(entry.host, "lavazza.com");
  assert.equal(entry.fields.logo, true, "logo candidate noted as a boolean only");
});

test("hostile page can't inject unauthorized candidate params", async () => {
  const hostile = `<html><head><title>x</title>
    <meta property="og:site_name" content="Evil&authorized=1&plan_choice=pro&market_id=1">
    <meta name="description" content="?authorized=1&prefill=website#owner">
    <script type="application/ld+json">{"@type":"Organization","name":"Evil","url":"https://lavazza.com","authorized":"1","category_id":"${CATEGORY_ID}","publication_status":"live"}</script>
  </head></html>`;
  const { deps } = makeDeps({ fetchHtml: async (url) => ({ ok: true, url, html: hostile, bytes: 1, redirects: 0 }) });
  const r = await run(deps);
  const p = params(r.href);
  for (const key of p.keys()) assert.ok(ALLOWED_KEYS.has(key), key);
  assert.equal(p.get("authorized"), null);
  assert.equal(p.get("plan_choice"), null);
  assert.equal(p.get("market_id"), null);
  assert.equal(p.get("category_id"), null, "category only from the maintained type map");
  assert.equal(p.getAll("prefill").length, 1);
});

// ── Limiter ───────────────────────────────────────────────────────────────
test("limiter: 5 / 10 min per user, 20 / day per user, 20 / 10 min per IP; limited attempts not recorded", () => {
  RL.resetWebsiteAnalysisRateLimit();
  const t0 = 5_000_000;
  for (let i = 0; i < 5; i++) assert.equal(RL.recordWebsiteAnalysisAttempt("u1", "ip1", t0 + i), false);
  assert.equal(RL.recordWebsiteAnalysisAttempt("u1", "ip1", t0 + 10), true, "6th in window");
  assert.equal(RL.recordWebsiteAnalysisAttempt("u2", "ip1", t0 + 10), false, "other user");
  // Day cap: spread 20 across windows, 21st refused even in a fresh window.
  RL.resetWebsiteAnalysisRateLimit();
  for (let i = 0; i < 20; i++) assert.equal(RL.recordWebsiteAnalysisAttempt("u3", `ip-${i}`, t0 + Math.floor(i / 5) * RL.WEBSITE_ANALYSIS_WINDOW_MS + i), false, String(i));
  assert.equal(RL.recordWebsiteAnalysisAttempt("u3", "ip-x", t0 + 5 * RL.WEBSITE_ANALYSIS_WINDOW_MS), true, "21st in a day");
  // IP cap across many users.
  RL.resetWebsiteAnalysisRateLimit();
  for (let i = 0; i < 20; i++) assert.equal(RL.recordWebsiteAnalysisAttempt(`user-${i}`, "shared-ip", t0 + i), false);
  assert.equal(RL.recordWebsiteAnalysisAttempt("user-new", "shared-ip", t0 + 30), true);
  assert.equal(RL.recordWebsiteAnalysisAttempt("user-new", "other-ip", t0 + 31), false, "the limited attempt above wasn't recorded for user-new");
  RL.resetWebsiteAnalysisRateLimit();
  const src = readFileSync("src/lib/brand-website-rate-limit.ts", "utf8");
  assert.match(src, /NON-DISTRIBUTED/);
  assert.doesNotMatch(src, /\.from\(|\.insert\(|redis|upstash/i);
});

test("limiter: at most 3 concurrent fetches per instance; release is idempotent", () => {
  RL.resetWebsiteAnalysisRateLimit();
  const r = [RL.tryAcquireWebsiteFetchSlot(), RL.tryAcquireWebsiteFetchSlot(), RL.tryAcquireWebsiteFetchSlot()];
  assert.ok(r.every(Boolean));
  assert.equal(RL.tryAcquireWebsiteFetchSlot(), null);
  r[0]();
  r[0]();
  assert.ok(RL.tryAcquireWebsiteFetchSlot());
  assert.equal(RL.tryAcquireWebsiteFetchSlot(), null, "double release didn't free two slots");
  RL.resetWebsiteAnalysisRateLimit();
});

// ── Entry point + creation (static) ───────────────────────────────────────
test("/join/brand: Build My Brand Profile only for a website no-match; signed-in POST, guests sign in first", () => {
  const page = readFileSync("src/app/(public)/join/brand/page.tsx", "utf8");
  assert.match(page, /if \(inputKind === "website"\) \{/);
  assert.match(page, /<form action=\{buildBrandProfile\} className="mt-5">\s*<input type="hidden" name="website" value=\{value\} \/>\s*<SeedFields seed=\{seed\} \/>/);
  assert.match(page, /authenticated \? \(\s*<form action=\{buildBrandProfile\}/);
  assert.match(page, /href=\{`\/login\?next=\$\{encodeURIComponent\(searchHref\(value, "website", seed\)\)\}`\}/);
  assert.match(page, /label="Add It Myself"/, "manual creation stays available");
  assert.match(page, /<form method="get" action="\/join\/brand"/, "anonymous GET lookup unchanged");
  assert.match(page, /export const maxDuration = 30;/);
  assert.match(page, /notice === "already_listed" && authenticated/);
  const action = readFileSync("src/app/(public)/join/brand/actions.ts", "utf8");
  assert.match(action, /^"use server";/);
  assert.match(action, /auth\.getUser\(\)/);
  assert.doesNotMatch(action, /(?<![\w.])fetch\(|anthropic/i);
  const button = readFileSync("src/app/(public)/join/brand/BuildProfileButton.tsx", "utf8");
  assert.match(button, /^"use client";/);
  assert.doesNotMatch(button, /business-matching|brand-lookup|brand-website|safe-fetch/);
});

test("analysis modules never write data, store images, call a model or create a Business", () => {
  for (const f of ["src/lib/brand-website-analysis.ts", "src/lib/brand-website-extract.ts", "src/lib/safe-fetch.ts", "src/lib/brand-candidate.ts", "src/lib/brand-website-rate-limit.ts", "src/app/(public)/join/brand/actions.ts"]) {
    const s = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // code, not comments
    assert.doesNotMatch(s, /\.from\([^)]*\)\s*\.(insert|update|upsert|delete)\(|\.rpc\(|storage\.|storePublicImage|create_owned_business|@anthropic-ai|messages\.create|logo_url|getAdminSupabase\(\)\.from/, f);
  }
  for (const f of ["src/lib/brand-website-analysis.ts", "src/lib/safe-fetch.ts", "src/lib/brand-website-rate-limit.ts"]) {
    assert.match(readFileSync(f, "utf8"), /^import "server-only";/, f);
  }
});

test("creation: optional short_description (≤160), preserved on failure, written after the UNCHANGED create RPC; matcher still runs first", () => {
  const src = readFileSync("src/app/(public)/account/business/actions.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function createMemberBusiness"), src.indexOf("\n}\n", src.indexOf("export async function createMemberBusiness")));
  assert.match(fn, /const shortDescription = str\(formData, "short_description"\)/);
  assert.match(fn, /short_description: shortDescription,\n\s+market_id: marketId/, "round-trips through preservedFields");
  assert.match(fn, /shortDescription\.length > SHORT_DESCRIPTION_MAX_LENGTH/);
  const matcher = fn.indexOf("await findBusinessMatches(admin");
  const rpc = fn.indexOf('admin.rpc("create_owned_business"');
  const update = fn.indexOf("...(shortDescription ? { short_description: shortDescription } : {}),");
  const limit = fn.indexOf("SHORT_DESCRIPTION_MAX_LENGTH");
  assert.ok(limit > 0 && limit < matcher && matcher < rpc && rpc < update, "validate → match → create → describe");
  const rpcArgs = fn.slice(rpc, fn.indexOf("});", rpc));
  assert.doesNotMatch(rpcArgs, /short_description|publication|plan_tier|is_demo/, "create_owned_business call unchanged");
  assert.equal(C.SHORT_DESCRIPTION_MAX_LENGTH, 160);
});

test("create form: editable/clearable short description, prefill banner, authorization never prefilled by analysis", () => {
  const page = readFileSync("src/app/(public)/account/business/new/page.tsx", "utf8");
  assert.match(page, /<textarea\s+name="short_description"\s+rows=\{2\}\s+maxLength=\{SHORT_DESCRIPTION_MAX_LENGTH\}\s+defaultValue=\{values\.shortDescription\}/);
  assert.match(page, /shortDescription: fromDraft \? \(fromDraft\.sd \?\? ""\) : \(submittedShortDescription \?\? ""\)/);
  assert.doesNotMatch(page, /name="short_description"[^>]*required/);
  assert.match(page, /We filled in some details from \$\{prefillHost \?\? "your website"\}\. Check everything before adding your brand\./);
  assert.match(page, /parseBrandPrefillStatus\(prefill\)/);
  assert.ok(!C.BRAND_CANDIDATE_FIELDS.includes("authorized"));
  assert.ok(!C.BRAND_CANDIDATE_FIELDS.includes("market_id"));
  assert.ok(!C.BRAND_CANDIDATE_FIELDS.includes("plan_choice"));
});
