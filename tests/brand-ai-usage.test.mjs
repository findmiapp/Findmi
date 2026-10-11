// Brand Builder AI usage / cost telemetry: the Anthropic response's model
// and usage are captured per call (lib/brand-ai-enrichment.ts), priced by
// the central table (lib/anthropic-pricing.ts), and logged only on the
// request that actually called Anthropic (lib/brand-website-analysis.ts).
// No network (stub clients/transports), no production DB.
import { test } from "node:test";
import assert from "node:assert/strict";
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

const AI = await import("../src/lib/brand-ai-enrichment.ts");
const P = await import("../src/lib/anthropic-pricing.ts");
const A = await import("../src/lib/brand-website-analysis.ts");

const CAT = { id: "11111111-1111-4111-8111-111111111111", slug: "beauty-self-care", name: "Beauty & Self-Care" };
const GENERATED_SD = "Clean vegan makeup and skincare products for everyday wear.";
const GENERATED_ABOUT = "A makeup and skincare brand offering vegan, cruelty-free formulas for everyday routines.";
const aiInput = {
  brandName: "Milk Makeup",
  website: "https://milkmakeup.com",
  excerpt: { title: "Milk Makeup", descriptions: [], jsonLdName: null, jsonLdTypes: [], headings: ["Cooling Water"], paragraphs: ["SECRET-EXCERPT-TEXT about the studio."] },
  categories: [{ id: CAT.id, name: CAT.name }],
};

function client({ model = "claude-opus-5", usage = { input_tokens: 1200, output_tokens: 300 }, stop = "end_turn", output, throws } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      messages: {
        parse: async (params) => {
          calls.push(params);
          if (throws) throw throws;
          return { id: "msg_1", model, stop_reason: stop, usage, parsed_output: output === undefined ? { category_id: CAT.id, short_description: GENERATED_SD, about: GENERATED_ABOUT } : output };
        },
      },
    },
  };
}

test("usage: a successful call records the exact returned model and actual input/output tokens", async () => {
  const r = await AI.enrichBrandWithAi(aiInput, client({ model: "claude-opus-5", usage: { input_tokens: 1234, output_tokens: 321 } }).client);
  assert.equal(r.called, true);
  assert.equal(r.result.categoryId, CAT.id);
  assert.equal(r.usage.model, "claude-opus-5");
  assert.equal(r.usage.inputTokens, 1234);
  assert.equal(r.usage.outputTokens, 321);
});

test("usage: cache fields are captured when Anthropic supplies them", async () => {
  const usage = {
    input_tokens: 1200,
    output_tokens: 300,
    cache_creation_input_tokens: 2000,
    cache_read_input_tokens: 1000,
    cache_creation: { ephemeral_5m_input_tokens: 1500, ephemeral_1h_input_tokens: 500 },
    inference_geo: "global",
    service_tier: "standard",
  };
  const r = await AI.enrichBrandWithAi(aiInput, client({ usage }).client);
  assert.equal(r.usage.cacheCreationInputTokens, 2000);
  assert.equal(r.usage.cacheReadInputTokens, 1000);
  // 1200×$5 + 300×$25 + 1000×$0.50 + 1500×$6.25 + 500×$10, per MTok.
  assert.equal(r.usage.estimatedCostUsd, 0.028375);
});

test("usage: missing optional cache fields stay null (never invented)", async () => {
  const r = await AI.enrichBrandWithAi(aiInput, client({ usage: { input_tokens: 10, output_tokens: 5 } }).client);
  assert.equal(r.usage.cacheCreationInputTokens, null);
  assert.equal(r.usage.cacheReadInputTokens, null);
  const nulls = await AI.enrichBrandWithAi(aiInput, client({ usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: null, cache_read_input_tokens: null } }).client);
  assert.deepEqual([nulls.usage.cacheCreationInputTokens, nulls.usage.cacheReadInputTokens], [null, null]);
});

test("pricing: claude-opus-5 list prices produce the expected estimate", () => {
  assert.deepEqual(P.ANTHROPIC_PRICING["claude-opus-5"], { inputPerMTok: 5, outputPerMTok: 25, cacheWrite5mPerMTok: 6.25, cacheWrite1hPerMTok: 10, cacheReadPerMTok: 0.5 });
  // 1200×$5/M + 300×$25/M = $0.006 + $0.0075
  assert.equal(P.estimateAnthropicCostUsd("claude-opus-5", { input_tokens: 1200, output_tokens: 300 }), 0.0135);
  assert.equal(P.estimateAnthropicCostUsd("claude-opus-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 30);
  assert.equal(P.estimateAnthropicCostUsd("claude-opus-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), 0);
});

test("pricing: unknown models and unpriced usage return null, never a guess", async () => {
  for (const model of ["claude-opus-5-5", "claude-opus-5-20990101", "claude-sonnet-5", "gpt-4o", "", "constructor", "__proto__"]) {
    assert.equal(P.estimateAnthropicCostUsd(model, { input_tokens: 100, output_tokens: 100 }), null, model);
  }
  const r = await AI.enrichBrandWithAi(aiInput, client({ model: "claude-something-new" }).client);
  assert.equal(r.usage.model, "claude-something-new", "tokens still recorded");
  assert.equal(r.usage.inputTokens, 1200);
  assert.equal(r.usage.estimatedCostUsd, null);
  const base = { input_tokens: 100, output_tokens: 100 };
  assert.equal(P.estimateAnthropicCostUsd("claude-opus-5", { ...base, inference_geo: "us" }), null, "US-only 1.1× not modelled");
  assert.equal(P.estimateAnthropicCostUsd("claude-opus-5", { ...base, service_tier: "batch" }), null);
  assert.equal(P.estimateAnthropicCostUsd("claude-opus-5", { ...base, cache_creation_input_tokens: 50 }), null, "write TTL unknown");
  assert.equal(P.estimateAnthropicCostUsd("claude-opus-5", { ...base, cache_creation_input_tokens: 50, cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 10 } }), null, "breakdown mismatch");
});

test("failure: a thrown call never fabricates usage; a refusal reports the real tokens it consumed", async () => {
  const thrown = await AI.enrichBrandWithAi(aiInput, client({ throws: new Error("timeout") }).client);
  assert.deepEqual(thrown, { result: null, called: true, usage: null });
  const refused = await AI.enrichBrandWithAi(aiInput, client({ stop: "refusal", usage: { input_tokens: 900, output_tokens: 2 } }).client);
  assert.equal(refused.result, null, "deterministic fallback unchanged");
  assert.deepEqual([refused.usage.inputTokens, refused.usage.outputTokens], [900, 2]);
  const noUsage = await AI.enrichBrandWithAi(aiInput, client({ usage: null }).client);
  assert.deepEqual([noUsage.called, noUsage.usage], [true, null], "no usage object → null, not zero");
  const malformed = await AI.enrichBrandWithAi(aiInput, client({ usage: { input_tokens: "lots" } }).client);
  assert.equal(malformed.usage, null, "unreadable usage → null, not zero");
});

// ── Analysis telemetry ────────────────────────────────────────────────────
const HTML = `<!doctype html><html><head><title>Milk Makeup</title><meta property="og:site_name" content="Milk Makeup"></head><body><h1>Milk Makeup</h1><p>SECRET-EXCERPT-TEXT about the studio.</p></body></html>`;
const AI_FIELDS = ["aiModel", "aiInputTokens", "aiOutputTokens", "aiCacheCreationInputTokens", "aiCacheReadInputTokens", "aiEstimatedCostUsd"];
function deps(over = {}) {
  const logs = [];
  const counts = { enrich: 0 };
  const stub = client();
  return {
    logs,
    counts,
    stub,
    deps: {
      fetchHtml: async (url) => ({ ok: true, url: new URL(url.href), html: HTML, bytes: HTML.length, redirects: 0, truncated: false, declaredBytes: null }),
      findMatches: async () => [],
      listCategories: async () => [CAT],
      enrich: async (input) => {
        counts.enrich += 1;
        return AI.enrichBrandWithAi(input, stub.client);
      },
      verifyImage: async () => false,
      draftsEnabled: true,
      isRateLimited: () => false,
      acquireSlot: () => () => {},
      cache: A.createExtractionCache(),
      log: (e) => logs.push(e),
      now: () => 0,
      ...over,
    },
  };
}
const run = (d, website = "milkmakeup.com", userId = "user-secret-id") => A.analyzeBrandWebsite({ website, userId, ip: "203.0.113.5" }, d);

test("analysis: a new call logs aiCalled + model, tokens and estimated cost", async () => {
  const d = deps();
  assert.equal((await run(d.deps)).outcome, "prefilled");
  const e = d.logs[0];
  assert.deepEqual(
    [e.ai, e.aiFromCache, e.aiCalled, e.aiModel, e.aiInputTokens, e.aiOutputTokens, e.aiCacheCreationInputTokens, e.aiCacheReadInputTokens, e.aiEstimatedCostUsd],
    ["used", false, true, "claude-opus-5", 1200, 300, null, null, 0.0135]
  );
});

test("analysis: a Findmi-cached candidate reports NO new Anthropic invocation", async () => {
  const d = deps();
  await run(d.deps);
  await run(d.deps);
  assert.equal(d.counts.enrich, 1, "Anthropic called once");
  const [first, second] = d.logs;
  assert.equal(first.aiCalled, true);
  assert.equal(second.cached, true);
  assert.equal(second.ai, "used", "the candidate was AI-enriched originally");
  assert.equal(second.aiFromCache, true);
  assert.equal(second.aiCalled, false, "no new paid call on this request");
  for (const k of AI_FIELDS) assert.equal(second[k], null, k);
});

test("analysis: AI skipped / failed never fabricate usage", async () => {
  // Skipped: nothing missing → no call.
  const typed = `<!doctype html><html><head><title>Glow</title><script type="application/ld+json">${JSON.stringify({ "@type": "BeautySalon", name: "Glow Studio", url: "https://milkmakeup.com/", description: "Facials, brows and lash treatments in a calm studio setting for every skin type. ".repeat(3) })}</script></head><body></body></html>`;
  const skipped = deps({ fetchHtml: async (url) => ({ ok: true, url, html: typed, bytes: 1, redirects: 0, truncated: false, declaredBytes: null }) });
  await run(skipped.deps);
  const s = skipped.logs[0];
  assert.equal(skipped.counts.enrich, 0);
  assert.deepEqual([s.ai, s.aiCalled, s.aiFromCache], ["skipped", false, false]);
  for (const k of AI_FIELDS) assert.equal(s[k], null, k);
  // No API key: the call is never sent.
  const nokey = deps({ enrich: (input) => AI.enrichBrandWithAi(input, null) });
  await run(nokey.deps);
  assert.deepEqual([nokey.logs[0].ai, nokey.logs[0].aiCalled], ["failed", false]);
  for (const k of AI_FIELDS) assert.equal(nokey.logs[0][k], null, k);
  // Sent but failed with no response (timeout/connection): called, tokens unknown.
  const failing = client({ throws: new Error("timeout") });
  const failed = deps({ enrich: (input) => AI.enrichBrandWithAi(input, failing.client) });
  assert.equal((await run(failed.deps)).outcome, "prefilled");
  assert.deepEqual([failed.logs[0].ai, failed.logs[0].aiCalled], ["failed", true]);
  for (const k of AI_FIELDS) assert.equal(failed.logs[0][k], null, k);
  // Early exits before enrichment leave every AI field null.
  const early = deps({ fetchHtml: async () => ({ ok: false, code: "timeout", redirects: 0 }) });
  await run(early.deps);
  assert.deepEqual([early.logs[0].ai, early.logs[0].aiCalled, early.logs[0].aiFromCache], [null, null, null]);
});

test("analysis telemetry never contains prompts, excerpts, generated copy, keys, cookies, user ids, IPs or query strings", async () => {
  const before = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-ant-api03-SECRETKEYVALUE";
  try {
    const d = deps();
    await run(d.deps, "https://milkmakeup.com/?utm_source=SECRETQUERY#frag");
    const prompt = d.stub.calls[0];
    assert.ok(prompt, "Anthropic was called");
    const json = JSON.stringify(d.logs);
    for (const leak of [
      "SECRET-EXCERPT-TEXT",
      "website_data",
      "Allowed categories",
      prompt.system.slice(0, 40),
      GENERATED_SD,
      GENERATED_ABOUT,
      "sk-ant-",
      "SECRETKEYVALUE",
      "findmi_brand_draft",
      "user-secret-id",
      "203.0.113.5",
      "SECRETQUERY",
      "utm_source",
      "msg_1",
    ]) {
      assert.ok(!json.includes(leak), `log leaks ${leak}`);
    }
    assert.equal(d.logs[0].host, "milkmakeup.com");
  } finally {
    if (before === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = before;
  }
});
