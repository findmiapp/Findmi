// Brand Ingestion P1 — the shared Brand candidate core
// (src/lib/brand-candidate-builder.ts) and its public adapter
// (src/lib/brand-website-analysis.ts). Pure refactor: these pin the
// V1.1C behavior the core now owns. No network (stub deps), no DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/headers") {
      return { url: "data:text/javascript,export const headers=async()=>new Map();export const cookies=async()=>({get(){return undefined},set(){}})", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const B = await import("../src/lib/brand-candidate-builder.ts");
const A = await import("../src/lib/brand-website-analysis.ts");

const CAT = { id: "11111111-1111-4111-8111-111111111111", slug: "beauty-self-care", name: "Beauty & Self-Care" };
const AI_CAT = "22222222-2222-4222-8222-222222222222";
const LONG = "Facials, brows and lash treatments in a calm Brooklyn studio, with vegan products and gentle care for every skin type. Book online or walk in for a consultation any day.";
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const page = (head, body = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
/** Everything deterministic: category type, short + About description, IG, logo, cover. */
const FULL = page(
  `<title>Glow Studio</title><meta name="description" content="${LONG}"><meta property="og:image" content="https://glow.example.com/share.jpg">` +
    ld({ "@type": "BeautySalon", name: "Glow Studio", url: "https://glow.example.com/", logo: "https://glow.example.com/logo.png", sameAs: ["https://www.instagram.com/glowstudio/"], address: { addressLocality: "Brooklyn", addressRegion: "NY" } })
);
/** Name + Instagram only — category, short description and About missing. */
const THIN = page(`<title>Milk Makeup</title><meta property="og:site_name" content="Milk Makeup">` + ld({ "@type": "Organization", name: "Milk Makeup", url: "https://milkmakeup.com/", sameAs: ["https://www.instagram.com/milkmakeup/"] }));

const USAGE = { model: "claude-opus-5", inputTokens: 1200, outputTokens: 300, cacheCreationInputTokens: null, cacheReadInputTokens: null, estimatedCostUsd: 0.0135 };
const AI_RESULT = { categoryId: AI_CAT, shortDescription: "AI short description of the brand's products.", about: "AI About text describing the brand in a few neutral sentences." };

function deps(over = {}) {
  const calls = { fetch: [], match: [], categories: 0, enrich: [], verify: [] };
  return {
    calls,
    deps: {
      fetchHtml: async (url) => {
        calls.fetch.push(url.href);
        return { ok: true, url: new URL(url.href), html: FULL, bytes: FULL.length, redirects: 0, truncated: false, declaredBytes: null };
      },
      findMatches: async (input) => {
        calls.match.push(input);
        return [];
      },
      listCategories: async () => {
        calls.categories += 1;
        return [CAT];
      },
      enrich: async (input) => {
        calls.enrich.push(input);
        return { result: AI_RESULT, called: true, usage: USAGE };
      },
      verifyImage: async (url, role) => {
        calls.verify.push(role);
        return true;
      },
      ...over,
    },
  };
}
const html = (h) => async (url) => ({ ok: true, url: new URL(url.href), html: h, bytes: h.length, redirects: 0, truncated: false, declaredBytes: null });
const OPTS = { verifyImages: true };

test("core: a fully deterministic candidate is built with no AI call", async () => {
  const d = deps();
  const r = await B.buildBrandCandidate("glow.example.com", d.deps, OPTS);
  assert.equal(r.status, "candidate");
  assert.equal(d.calls.enrich.length, 0, "nothing missing → no AI");
  assert.deepEqual(r.ai, { status: "skipped", reused: false, called: false, usage: null });
  assert.deepEqual(r.proposal, {
    name: "Glow Studio",
    websiteUrl: "https://glow.example.com",
    finalUrl: "https://glow.example.com/",
    instagramHandle: "glowstudio",
    instagramUrl: "https://www.instagram.com/glowstudio",
    categoryId: CAT.id,
    shortDescription: r.proposal.shortDescription,
    about: LONG,
    city: "Brooklyn",
    state: "NY",
    logoUrl: "https://glow.example.com/logo.png",
    coverUrl: "https://glow.example.com/share.jpg",
  });
  assert.ok(r.proposal.shortDescription && r.proposal.shortDescription.length <= 160);
  assert.deepEqual(r.completeness, { name: true, category: true, shortDescription: true, about: true, instagram: true, logo: true, cover: true });
  assert.deepEqual(r.website, { websiteUrl: "https://glow.example.com", host: "glow.example.com", fetchUrl: new URL("https://glow.example.com/") });
  assert.deepEqual(r.fetch, { redirects: 0, bytes: FULL.length, truncated: false, size: "complete_html", declaredSizeExceededOldLimit: null });
  assert.equal(r.fields.category, true);
});

test("brandAiNeed: AI only when the category or a usable short description is missing — About alone never", () => {
  // The approved matrix (About is not an input any more).
  const rows = [
    // category, short, about → AI?
    ["c", "s", "a", false],
    ["c", "s", null, false],
    [null, "s", "a", true],
    ["c", null, "a", true],
    [null, null, null, true],
  ];
  for (const [category, short, about, expected] of rows) {
    assert.equal(B.brandAiNeed({ deterministicCategoryId: category, shortDescription: short, aboutDescription: about }), expected, JSON.stringify({ category, short, about }));
  }
  for (const category of [null, "c"]) {
    for (const short of [null, "s"]) {
      assert.equal(B.brandAiNeed({ deterministicCategoryId: category, shortDescription: short }), !category || !short);
    }
  }
  const src = readFileSync("src/lib/brand-candidate-builder.ts", "utf8");
  assert.equal((src.match(/brandAiNeed\(\{/g) ?? []).length, 1, "the one decision point is used by the core");
  assert.doesNotMatch(src.slice(src.indexOf("export function brandAiNeed")), /^[^}]*aboutDescription/, "About is not part of the rule");
});

test("core: AI merges as before — deterministic values win, AI fills only what is missing (About alone triggers nothing)", async () => {
  const thin = deps({ fetchHtml: html(THIN) });
  const r = await B.buildBrandCandidate("milkmakeup.com", thin.deps, OPTS);
  assert.equal(r.status, "candidate");
  assert.equal(thin.calls.enrich.length, 1);
  assert.deepEqual(thin.calls.enrich[0].categories, [{ id: CAT.id, name: CAT.name }]);
  assert.equal(thin.calls.enrich[0].brandName, "Milk Makeup");
  assert.equal(thin.calls.enrich[0].website, "https://milkmakeup.com", "the submitted website, as before");
  assert.deepEqual([r.proposal.categoryId, r.proposal.shortDescription, r.proposal.about], [AI_CAT, AI_RESULT.shortDescription, AI_RESULT.about]);
  assert.equal(r.ai.status, "used");
  // Only About missing → NO AI call (Quality pass): About stays empty.
  const SHORT_ONLY = page(ld({ "@type": "BeautySalon", name: "Glow Studio", url: "https://glow.example.com/", description: "Facials, brows and lash treatments for every skin type." }));
  const partial = deps({ fetchHtml: html(SHORT_ONLY) });
  const p = await B.buildBrandCandidate("glow.example.com", partial.deps, OPTS);
  assert.equal(partial.calls.enrich.length, 0, "About alone never calls Anthropic");
  assert.deepEqual(p.ai, { status: "skipped", reused: false, called: false, usage: null });
  assert.equal(p.proposal.categoryId, CAT.id);
  assert.equal(p.proposal.shortDescription, "Facials, brows and lash treatments for every skin type.");
  assert.equal(p.proposal.about, null);
  // Category missing (deterministic short present) → AI runs; deterministic
  // short wins, AI fills category and About in the SAME call.
  const NO_CAT = page(ld({ "@type": "Organization", name: "Glow Studio", url: "https://glow.example.com/", description: "Facials, brows and lash treatments for every skin type." }));
  const cat = deps({ fetchHtml: html(NO_CAT) });
  const c = await B.buildBrandCandidate("glow.example.com", cat.deps, OPTS);
  assert.equal(cat.calls.enrich.length, 1);
  assert.deepEqual([c.proposal.categoryId, c.proposal.shortDescription, c.proposal.about], [AI_CAT, "Facials, brows and lash treatments for every skin type.", AI_RESULT.about]);
  // AI failure → deterministic values only, status failed.
  const failed = deps({ fetchHtml: html(THIN), enrich: async () => ({ result: null, called: true, usage: null }) });
  const f = await B.buildBrandCandidate("milkmakeup.com", failed.deps, OPTS);
  assert.deepEqual([f.ai.status, f.proposal.categoryId, f.proposal.shortDescription, f.proposal.about], ["failed", null, null, null]);
  // An unexpected throw from enrich counts as a call with unknown usage.
  const thrown = deps({ fetchHtml: html(THIN), enrich: async () => { throw new Error("boom"); } });
  const t = await B.buildBrandCandidate("milkmakeup.com", thrown.deps, OPTS);
  assert.deepEqual(t.ai, { status: "failed", reused: false, called: true, usage: null });
});

test("core: matching lookups are exactly the V1.1C ones (website/IG/name+location, final host, replaced identity)", async () => {
  const d = deps({
    fetchHtml: async (url) => ({ ok: true, url: new URL("https://www.glowstudio.com/home"), html: FULL, bytes: 1, redirects: 1, truncated: false, declaredBytes: null }),
  });
  await B.buildBrandCandidate("glow.example.com", d.deps, { verifyImages: true, identity: { name: "Glow", instagram: "glow_official" } });
  assert.deepEqual(d.calls.match, [
    { websiteUrl: "https://glow.example.com", instagramUrl: "https://www.instagram.com/glow_official", name: "Glow", city: "Brooklyn", state: "NY" },
    { websiteUrl: "https://www.glowstudio.com/home" },
    { instagramUrl: "https://www.instagram.com/glowstudio" },
    { name: "Glow Studio", city: "Brooklyn", state: "NY" },
  ]);
  // Same host, no overrides → the single combined lookup.
  const plain = deps();
  await B.buildBrandCandidate("glow.example.com", plain.deps, OPTS);
  assert.deepEqual(plain.calls.match, [{ websiteUrl: "https://glow.example.com", instagramUrl: "https://www.instagram.com/glowstudio", name: "Glow Studio", city: "Brooklyn", state: "NY" }]);
});

test("core: a public match is reported (first public wins) and nothing else runs", async () => {
  const hidden = { id: "h", slug: "hidden-glow", name: "Glow", reasons: ["website"], isPublic: false };
  const pub = { id: "p", slug: "glow-studio", name: "Glow Studio", reasons: ["website"], isPublic: true };
  const d = deps({ findMatches: async () => [hidden, pub] });
  const r = await B.buildBrandCandidate("glow.example.com", d.deps, OPTS);
  assert.equal(r.status, "matched");
  assert.equal(r.publicMatch, pub);
  assert.deepEqual(r.matches, [hidden, pub]);
  assert.deepEqual([d.calls.categories, d.calls.enrich.length, d.calls.verify.length], [0, 0, 0], "no categories, AI or images after a match");
});

test("core: hidden-only matches stay available to the caller (publicMatch null)", async () => {
  const hidden = { id: "h", slug: "hidden-glow", name: "Glow", reasons: ["instagram"], isPublic: false };
  const d = deps({ findMatches: async () => [hidden] });
  const r = await B.buildBrandCandidate("glow.example.com", d.deps, OPTS);
  assert.deepEqual([r.status, r.publicMatch, r.matches], ["matched", null, [hidden]]);
  // The public adapter still discloses nothing about it.
  const adapter = adapterDeps({ findMatches: async () => [hidden] });
  const out = await A.analyzeBrandWebsite({ website: "glow.example.com", userId: "u", ip: "1" }, adapter.deps);
  assert.deepEqual(out, { href: "/join/brand?notice=already_listed", outcome: "hidden_match" });
  assert.ok(!JSON.stringify(adapter.logs).includes("hidden-glow"));
  // A matcher error is match_failed.
  const broken = deps({ findMatches: async () => Promise.reject(new Error("db down")) });
  const b = await B.buildBrandCandidate("glow.example.com", broken.deps, OPTS);
  assert.deepEqual([b.status, b.code], ["failed", "match_failed"]);
});

test("core: input rejection and safe-fetch failures propagate through the typed result", async () => {
  const d = deps();
  assert.deepEqual(await B.buildBrandCandidate("not a website", d.deps, OPTS), { status: "rejected", code: "invalid_input", host: null });
  assert.deepEqual(await B.buildBrandCandidate("https://instagram.com/glow", d.deps, OPTS), { status: "rejected", code: "invalid_input", host: null }, "classifier: a profile, not a website");
  assert.deepEqual(await B.buildBrandCandidate("linktr.ee/glow", d.deps, OPTS), { status: "rejected", code: "unsupported_site", host: null }, "shared platform");
  assert.equal(d.calls.fetch.length, 0, "nothing fetched for rejected input");
  const big = deps({ fetchHtml: async () => ({ ok: false, code: "too_large", redirects: 1, limit: "streamed", declaredBytes: 3_000_000 }) });
  const r = await B.buildBrandCandidate("glow.example.com", big.deps, OPTS);
  assert.equal(r.status, "failed");
  assert.equal(r.code, "too_large");
  assert.deepEqual(r.fetch, { redirects: 1, bytes: null, truncated: null, size: "streamed_limit", declaredSizeExceededOldLimit: true });
  assert.equal(big.calls.match.length, 0);
  const empty = deps({ fetchHtml: html("<html></html>") });
  const e = await B.buildBrandCandidate("glow.example.com", empty.deps, OPTS);
  assert.deepEqual([e.status, e.code, e.fetch.size], ["failed", "no_metadata", "complete_html"]);
  assert.equal(B.prepareBrandWebsite("glow.example.com/shop?utm=1#x").website.fetchUrl.href, "https://glow.example.com/shop", "https only, query/fragment dropped");
});

test("core: image verification unchanged — off means no fetches; rejected or throwing candidates are dropped", async () => {
  const off = deps();
  const r = await B.buildBrandCandidate("glow.example.com", off.deps, { verifyImages: false });
  assert.deepEqual([off.calls.verify.length, r.proposal.logoUrl, r.proposal.coverUrl], [0, null, null]);
  const on = deps();
  await B.buildBrandCandidate("glow.example.com", on.deps, OPTS);
  assert.deepEqual(on.calls.verify.sort(), ["cover", "logo"]);
  const rejected = deps({ verifyImage: async (url, role) => role === "logo" });
  const j = await B.buildBrandCandidate("glow.example.com", rejected.deps, OPTS);
  assert.deepEqual([j.proposal.logoUrl, j.proposal.coverUrl, j.completeness.cover], ["https://glow.example.com/logo.png", null, false]);
  const throwing = deps({ verifyImage: async () => { throw new Error("boom"); } });
  const t = await B.buildBrandCandidate("glow.example.com", throwing.deps, OPTS);
  assert.deepEqual([t.proposal.logoUrl, t.proposal.coverUrl], [null, null]);
});

test("core: AI usage metadata propagates for a new call, and never for a reused enrichment", async () => {
  const d = deps({ fetchHtml: html(THIN) });
  const r = await B.buildBrandCandidate("milkmakeup.com", d.deps, OPTS);
  assert.deepEqual(r.ai, { status: "used", reused: false, called: true, usage: USAGE });
  assert.equal("usage" in r.enrichment, false, "the memoizable enrichment carries no usage");
  const again = deps({ fetchHtml: html(THIN) });
  const reused = await B.buildBrandCandidate("milkmakeup.com", again.deps, { verifyImages: true, reuseEnrichment: r.enrichment });
  assert.deepEqual(reused.ai, { status: "used", reused: true, called: false, usage: null });
  assert.deepEqual([again.calls.enrich.length, again.calls.verify.length], [0, 0], "no AI call, no image fetches");
  assert.deepEqual(reused.proposal, r.proposal);
});

test("core: candidate field precedence — identity overrides name/IG; location from the page; extracted text over AI", async () => {
  const d = deps({ fetchHtml: html(THIN) });
  const r = await B.buildBrandCandidate("milkmakeup.com", d.deps, { verifyImages: true, identity: { name: "MILK", instagram: "milk" } });
  assert.deepEqual([r.proposal.name, r.proposal.instagramHandle, r.proposal.instagramUrl], ["MILK", "milk", "https://www.instagram.com/milk"]);
  assert.equal(d.calls.enrich[0].brandName, "MILK", "AI sees the override name, as before");
  const none = deps();
  const n = await B.buildBrandCandidate("glow.example.com", none.deps, { verifyImages: true, identity: { name: null, instagram: null } });
  assert.deepEqual([n.proposal.name, n.proposal.instagramHandle, n.proposal.city, n.proposal.state], ["Glow Studio", "glowstudio", "Brooklyn", "NY"]);
});

test("core boundary: no redirects, cookies, auth, request IP, public limits, slot, cache or page URLs", () => {
  const code = readFileSync("src/lib/brand-candidate-builder.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(code, /^import "server-only";/);
  for (const banned of [
    /next\/navigation|redirect\(/,
    /next\/headers|cookies\(|headers\(/,
    /brand-draft|signBrandDraft|BRAND_DRAFT/,
    /auth\.getUser|userId/,
    /x-forwarded-for|\bip\b/,
    /brand-website-rate-limit|isRateLimited|acquireSlot|tryAcquire/,
    /createExtractionCache|\.cache\b/,
    /\/login|\/join\/brand|\/account\/business|claimHref|searchHref|ALREADY_LISTED/,
    /console\./,
    /getAdminSupabase|\.from\(|\.rpc\(|storeBrandImage|storePublicImage|create_owned_business|@anthropic-ai/,
  ]) {
    assert.doesNotMatch(code, banned, String(banned));
  }
  // The adapter keeps every public concern.
  const adapter = readFileSync("src/lib/brand-website-analysis.ts", "utf8");
  for (const kept of ["isRateLimited(input.userId, input.ip)", "deps.acquireSlot()", "deps.cache.get(cacheKey", "claimHref(built.publicMatch.slug, true)", "ALREADY_LISTED_HREF", "BRAND_DRAFT_REVIEW_HREF", "sanitizeBrandSeed", "brandBuildSignInHref(value, seed)"]) {
    assert.ok(adapter.includes(kept), kept);
  }
});

// ── Public adapter over the core ──────────────────────────────────────────
function adapterDeps(over = {}) {
  const thin = html(THIN);
  const d = deps({ ...over });
  if (!over.fetchHtml) {
    d.deps.fetchHtml = async (url) => {
      d.calls.fetch.push(url.href);
      return thin(url);
    };
  }
  const logs = [];
  return {
    calls: d.calls,
    logs,
    deps: {
      ...d.deps,
      draftsEnabled: true,
      isRateLimited: () => false,
      acquireSlot: () => () => {},
      cache: A.createExtractionCache(),
      log: (e) => logs.push(e),
      now: () => 0,
    },
  };
}

test("adapter: a cached public analysis does not report a new Anthropic call", async () => {
  const d = adapterDeps();
  const first = await A.analyzeBrandWebsite({ website: "milkmakeup.com", userId: "u", ip: "1" }, d.deps);
  const second = await A.analyzeBrandWebsite({ website: "milkmakeup.com", userId: "u", ip: "1" }, d.deps);
  assert.deepEqual(second, first, "same result from the cache");
  assert.equal(d.calls.fetch.length, 1);
  assert.equal(d.calls.enrich.length, 1);
  const [a, b] = d.logs;
  assert.deepEqual([a.cached, a.ai, a.aiFromCache, a.aiCalled, a.aiModel, a.aiInputTokens, a.aiEstimatedCostUsd], [false, "used", false, true, "claude-opus-5", 1200, 0.0135]);
  assert.deepEqual([b.cached, b.ai, b.aiFromCache, b.aiCalled, b.aiModel, b.aiInputTokens, b.aiOutputTokens, b.aiEstimatedCostUsd], [true, "used", true, false, null, null, null, null]);
  assert.equal(first.href, A.BRAND_DRAFT_REVIEW_HREF);
  assert.deepEqual(first.draft, {
    site: "https://milkmakeup.com",
    name: "Milk Makeup",
    cat: AI_CAT,
    sd: AI_RESULT.shortDescription,
    about: AI_RESULT.about,
    ig: "milkmakeup",
    city: null,
    state: null,
    logo: null,
    cover: null,
  });
});

test("adapter: the fetch slot is released even when fetchHtml throws, and busy still short-circuits", async () => {
  let held = 0;
  const slot = () => {
    held += 1;
    let done = false;
    return () => {
      if (!done) {
        done = true;
        held -= 1;
      }
    };
  };
  const throwing = adapterDeps({ fetchHtml: async () => { throw new Error("socket"); } });
  await assert.rejects(A.analyzeBrandWebsite({ website: "milkmakeup.com", userId: "u", ip: "1" }, { ...throwing.deps, acquireSlot: slot }));
  assert.equal(held, 0);
  const busy = adapterDeps();
  const r = await A.analyzeBrandWebsite({ website: "milkmakeup.com", userId: "u", ip: "1" }, { ...busy.deps, acquireSlot: () => null });
  assert.equal(r.outcome, "busy");
  assert.equal(busy.calls.fetch.length, 0);
});
