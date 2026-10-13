// Brand Ingestion P3 — Admin bulk Brand Import: batch creation, candidate
// processing (claim/lease/attempts/global cap, match-first, P1 core,
// failures, AI usage accumulation), the runner, and the Admin/security
// boundary. No network (stub engine), no database (an in-memory store with
// the same conditional claim/finish semantics as the Supabase store).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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

const I = await import("../src/lib/admin/brand-import.ts");
const R = await import("../src/lib/admin/brand-import-runner.ts");
const read = (p) => readFileSync(p, "utf8");
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── Fixtures ──────────────────────────────────────────────────────────────
const CAT = { id: "11111111-1111-4111-8111-111111111111", slug: "beauty-self-care", name: "Beauty & Self-Care" };
const THIN = `<!doctype html><html><head><title>Milk Makeup</title><script type="application/ld+json">${JSON.stringify({ "@type": "Organization", name: "Milk Makeup", sameAs: ["https://www.instagram.com/milkmakeup/"] })}</script></head><body><h1>Milk</h1></body></html>`;
const USAGE = { model: "claude-opus-5", inputTokens: 1200, outputTokens: 300, cacheCreationInputTokens: null, cacheReadInputTokens: null, estimatedCostUsd: 0.0135 };
const AI_RESULT = { categoryId: CAT.id, shortDescription: "Vegan makeup and skincare products.", about: "A makeup brand offering vegan, cruelty-free formulas." };
const T0 = Date.parse("2026-10-12T12:00:00.000Z");

function row(over = {}) {
  return {
    id: over.id ?? "c1",
    batch_id: "b1",
    status: "queued",
    attempt_count: 0,
    processing_started_at: null,
    submitted_input: "milkmakeup.com",
    normalized_host: "milkmakeup.com",
    proposal: null,
    failure_code: null,
    matched_business_id: null,
    ai_status: null,
    ai_model: null,
    ai_input_tokens: null,
    ai_output_tokens: null,
    ai_cache_creation_input_tokens: null,
    ai_cache_read_input_tokens: null,
    ai_estimated_cost_usd: null,
    ...over,
  };
}

function memStore(rows = [row()]) {
  const db = new Map(rows.map((r) => [r.id, { ...r }]));
  const batches = [];
  return {
    db,
    batches,
    async createBatch(candidates) {
      const id = `batch-${batches.length + 1}`;
      batches.push({ id, submitted_count: candidates.length });
      candidates.forEach((c, i) => db.set(`${id}-c${i + 1}`, row({ id: `${id}-c${i + 1}`, batch_id: id, ...c })));
      return id;
    },
    async getCandidate(id) {
      const r = db.get(id);
      return r ? { ...r } : null;
    },
    async countFreshProcessing(since) {
      return [...db.values()].filter((r) => r.status === "processing" && r.processing_started_at >= since).length;
    },
    async claim(id, expected, nowIso, staleBefore) {
      const r = db.get(id);
      if (!r || r.attempt_count !== expected) return false;
      const ok = r.status === "queued" || r.status === "failed" || (r.status === "processing" && r.processing_started_at < staleBefore);
      if (!ok) return false;
      Object.assign(r, { status: "processing", processing_started_at: nowIso, attempt_count: expected + 1 });
      return true;
    },
    async finish(id, attempt, patch) {
      const r = db.get(id);
      if (!r || r.attempt_count !== attempt || r.status !== "processing") return false;
      Object.assign(r, patch);
      return true;
    },
  };
}

function engine(over = {}) {
  const calls = { match: [], fetch: 0, enrich: 0, verify: 0 };
  return {
    calls,
    engine: {
      findMatches: async (input) => {
        calls.match.push(input);
        return [];
      },
      fetchHtml: async (url) => {
        calls.fetch += 1;
        return { ok: true, url: new URL(url.href), html: THIN, bytes: THIN.length, redirects: 0, truncated: false, declaredBytes: null };
      },
      listCategories: async () => [CAT],
      enrich: async () => {
        calls.enrich += 1;
        return { result: AI_RESULT, called: true, usage: USAGE };
      },
      verifyImage: async () => {
        calls.verify += 1;
        return true;
      },
      ...over,
    },
  };
}

function deps(store, eng, now = T0) {
  const logs = [];
  return { logs, deps: { store, engine: eng, now: () => now, log: (e) => logs.push(e) } };
}

// ── Import creation ───────────────────────────────────────────────────────
test("create 1–2: zero usable lines and more than 20 are rejected", () => {
  assert.deepEqual(I.planBrandImport(""), { ok: false, error: "empty" });
  assert.deepEqual(I.planBrandImport(" \n\n  \r\n"), { ok: false, error: "empty" });
  const many = Array.from({ length: 21 }, (_, i) => `brand${i}.com`).join("\n");
  assert.deepEqual(I.planBrandImport(many), { ok: false, error: "too_many" });
  assert.equal(I.planBrandImport(Array.from({ length: 20 }, (_, i) => `brand${i}.com`).join("\n")).candidates.length, 20);
});

test("create 3–4, 7: blank lines removed, hosts normalized, order preserved", () => {
  const plan = I.planBrandImport("\n  https://www.MilkMakeup.com/  \n\nglossier.com\r\nrarebeauty.com/shop?x=1\n");
  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.candidates.map((c) => [c.position, c.normalized_host, c.status, c.failure_code]),
    [
      [1, "milkmakeup.com", "queued", null],
      [2, "glossier.com", "queued", null],
      [3, "rarebeauty.com", "queued", null],
    ]
  );
  assert.equal(plan.candidates[0].submitted_input, "https://www.MilkMakeup.com/", "the trimmed line as submitted");
});

test("create 5: same-host duplicates in one paste are skipped (not failures)", () => {
  const plan = I.planBrandImport("https://milkmakeup.com\nwww.milkmakeup.com/\nMILKMAKEUP.COM\nglossier.com");
  assert.equal(plan.duplicatesSkipped, 2);
  assert.deepEqual(plan.candidates.map((c) => c.normalized_host), ["milkmakeup.com", "glossier.com"]);
  assert.ok(plan.candidates.every((c) => c.status === "queued"));
});

test("create 6: invalid inputs are kept as failed with a safe code and no host", () => {
  const plan = I.planBrandImport(`not a website\nlinktr.ee/brand\n${"x".repeat(250)}.com\nglossier.com`);
  assert.deepEqual(
    plan.candidates.map((c) => [c.status, c.failure_code, c.normalized_host]),
    [
      ["failed", "invalid_input", null],
      ["failed", "unsupported_site", null],
      ["failed", "invalid_input", null],
      ["queued", null, "glossier.com"],
    ]
  );
  assert.equal(plan.candidates[2].submitted_input.length, 200, "bounded like the database column");
});

test("create 8: submitted_count equals the persisted candidates; positions are 1..n", async () => {
  const store = memStore([]);
  const plan = I.planBrandImport("milkmakeup.com\nmilkmakeup.com\nnot a website\nglossier.com");
  const id = await store.createBatch(plan.candidates);
  const persisted = [...store.db.values()].filter((r) => r.batch_id === id);
  assert.equal(store.batches[0].submitted_count, persisted.length);
  assert.deepEqual(persisted.map((r) => r.position), [1, 2, 3]);
});

// ── Processing ────────────────────────────────────────────────────────────
test("process 9, 12, 17–18: a queued candidate is claimed once, run through the P1 core and becomes ready", async () => {
  const store = memStore();
  const e = engine();
  const { deps: d } = deps(store, e.engine);
  assert.deepEqual(await I.processBrandImportCandidate("c1", d), { outcome: "processed", status: "ready" });
  const r = store.db.get("c1");
  assert.equal(r.status, "ready");
  assert.equal(r.attempt_count, 1, "incremented exactly once");
  assert.equal(r.processing_started_at, null, "lease released");
  assert.equal(r.failure_code, null);
  assert.deepEqual(r.proposal, { site: "https://milkmakeup.com", finalUrl: "https://milkmakeup.com/", name: "Milk Makeup", cat: CAT.id, sd: AI_RESULT.shortDescription, about: AI_RESULT.about, ig: "milkmakeup", logo: "https://milkmakeup.com/apple-touch-icon.png" }, "the stub verifies everything, so the conventional touch icon is used");
  assert.deepEqual([e.calls.fetch, e.calls.enrich], [1, 1]);
});

test("process 10: two concurrent requests cannot both own the same attempt", async () => {
  const store = memStore();
  const slow = engine({
    fetchHtml: async (url) => {
      slow.calls.fetch += 1;
      await new Promise((res) => setTimeout(res, 20));
      return { ok: true, url: new URL(url.href), html: THIN, bytes: 1, redirects: 0, truncated: false, declaredBytes: null };
    },
  });
  const { deps: d } = deps(store, slow.engine);
  const results = await Promise.all([I.processBrandImportCandidate("c1", d), I.processBrandImportCandidate("c1", d)]);
  assert.deepEqual(results.map((r) => r.outcome).sort(), ["not_eligible", "processed"]);
  assert.equal(slow.calls.fetch, 1);
  assert.equal(store.db.get("c1").attempt_count, 1);
  // A fresh processing candidate is not claimable either.
  const fresh = memStore([row({ status: "processing", attempt_count: 1, processing_started_at: new Date(T0 - 30_000).toISOString() })]);
  assert.deepEqual(await I.processBrandImportCandidate("c1", deps(fresh, engine().engine).deps), { outcome: "not_eligible" });
});

test("process 11: an expired processing lease (≥ 2 minutes) is reclaimed", async () => {
  const store = memStore([row({ status: "processing", attempt_count: 1, processing_started_at: new Date(T0 - 121_000).toISOString() })]);
  assert.deepEqual(await I.processBrandImportCandidate("c1", deps(store, engine().engine).deps), { outcome: "processed", status: "ready" });
  assert.equal(store.db.get("c1").attempt_count, 2);
  assert.equal(I.BRAND_IMPORT_LEASE_MS, 120_000);
});

test("process 13: the 5-attempt limit is enforced", async () => {
  const store = memStore([row({ status: "failed", attempt_count: 5, failure_code: "timeout" })]);
  const e = engine();
  assert.deepEqual(await I.processBrandImportCandidate("c1", deps(store, e.engine).deps), { outcome: "not_eligible" });
  assert.equal(e.calls.fetch + e.calls.match.length, 0);
  const four = memStore([row({ status: "failed", attempt_count: 4, failure_code: "timeout" })]);
  assert.equal((await I.processBrandImportCandidate("c1", deps(four, engine().engine).deps)).outcome, "processed");
  assert.equal(I.BRAND_IMPORT_MAX_ATTEMPTS, 5);
});

test("process 14: the global fresh-processing guard (max 3) is enforced before claiming", async () => {
  const freshAt = new Date(T0 - 10_000).toISOString();
  const store = memStore([
    row(),
    row({ id: "p1", status: "processing", attempt_count: 1, processing_started_at: freshAt }),
    row({ id: "p2", status: "processing", attempt_count: 1, processing_started_at: freshAt }),
    row({ id: "p3", status: "processing", attempt_count: 1, processing_started_at: freshAt }),
  ]);
  const e = engine();
  const { deps: d, logs } = deps(store, e.engine);
  assert.deepEqual(await I.processBrandImportCandidate("c1", d), { outcome: "busy" });
  assert.equal(store.db.get("c1").status, "queued", "not claimed");
  assert.equal(store.db.get("c1").attempt_count, 0);
  assert.equal(logs[0].outcome, "busy");
  // Stale leases don't count against the cap.
  store.db.get("p3").processing_started_at = new Date(T0 - 300_000).toISOString();
  assert.equal((await I.processBrandImportCandidate("c1", d)).outcome, "processed");
  assert.equal(I.BRAND_IMPORT_MAX_FRESH_PROCESSING, 3);
});

test("process 15–16: an existing website match stops before any fetch, AI or image work", async () => {
  const store = memStore();
  const existing = { id: "biz-1", slug: "milk", name: "Milk Makeup", reasons: ["website"], isPublic: false };
  const e = engine({ findMatches: async (input) => (e.calls.match.push(input), [existing]) });
  assert.deepEqual(await I.processBrandImportCandidate("c1", deps(store, e.engine).deps), { outcome: "processed", status: "existing_business" });
  assert.deepEqual(e.calls.match, [{ websiteUrl: "https://milkmakeup.com" }], "website identity only");
  assert.deepEqual([e.calls.fetch, e.calls.enrich, e.calls.verify], [0, 0, 0]);
  const r = store.db.get("c1");
  assert.deepEqual([r.status, r.matched_business_id, r.proposal, r.ai_status], ["existing_business", "biz-1", null, null]);
  // A non-website pre-fetch match does not stop processing (the P1 core's
  // own safeguards decide after extraction).
  const weak = memStore();
  const e2 = engine({ findMatches: async (input) => (e2.calls.match.push(input), input.websiteUrl && !input.instagramUrl ? [{ ...existing, reasons: ["name_location"] }] : []) });
  assert.equal((await I.processBrandImportCandidate("c1", deps(weak, e2.engine).deps)).status, "ready");
  assert.equal(e2.calls.fetch, 1);
});

test("process: a match found by the P1 safeguards after extraction is existing_business too", async () => {
  const store = memStore();
  const igMatch = { id: "biz-ig", slug: "milk", name: "Milk", reasons: ["instagram"], isPublic: true };
  const e = engine({ findMatches: async (input) => (input.instagramUrl ? [igMatch] : []) });
  assert.equal((await I.processBrandImportCandidate("c1", deps(store, e.engine).deps)).status, "existing_business");
  assert.equal(store.db.get("c1").matched_business_id, "biz-ig");
  assert.equal(e.calls.enrich, 0, "no AI after a match");
});

test("process 19: the proposal is validated before persistence", async () => {
  const bad = { websiteUrl: "https://x.com", finalUrl: "https://x.com/", name: "X", categoryId: "not-a-uuid", shortDescription: null, about: null, instagramHandle: null, instagramUrl: null, city: null, state: null, logoUrl: null, coverUrl: null };
  assert.equal(I.toBrandImportProposal(bad), null);
  assert.deepEqual(I.toBrandImportProposal({ ...bad, categoryId: CAT.id, logoUrl: `https://cdn.x.com/${"a".repeat(600)}.png` }), { site: "https://x.com", finalUrl: "https://x.com/", name: "X", cat: CAT.id }, "over-long image URL dropped, nulls omitted");
  assert.equal(I.parseBrandImportProposal({ site: "https://x.com", finalUrl: "https://x.com/", html: "<p>" }), null, "strict: no extra keys");
  // An unparseable candidate is stored as failed/invalid_proposal.
  const store = memStore();
  // A dependency returning a value outside the candidate boundary.
  const e = engine({ enrich: async () => ({ result: { categoryId: "not-a-uuid", shortDescription: null, about: null }, called: true, usage: USAGE }) });
  await I.processBrandImportCandidate("c1", deps(store, e.engine).deps);
  const r = store.db.get("c1");
  assert.deepEqual([r.status, r.failure_code, r.proposal], ["failed", "invalid_proposal", null]);
  assert.equal(r.ai_input_tokens, 1200, "the AI spend that happened is still recorded");
});

test("process 20: safe fetch failures become failed with the typed code", async () => {
  for (const code of ["timeout", "too_large", "blocked_destination", "dns_failed"]) {
    const store = memStore();
    const e = engine({ fetchHtml: async () => ({ ok: false, code, redirects: 0 }) });
    assert.deepEqual(await I.processBrandImportCandidate("c1", deps(store, e.engine).deps), { outcome: "processed", status: "failed" });
    assert.equal(store.db.get("c1").failure_code, code);
  }
  const empty = memStore();
  await I.processBrandImportCandidate("c1", deps(empty, engine({ fetchHtml: async (url) => ({ ok: true, url, html: "<html></html>", bytes: 1, redirects: 0, truncated: false, declaredBytes: null }) }).engine).deps);
  assert.equal(empty.db.get("c1").failure_code, "no_metadata");
  const matchErr = memStore();
  let first = true;
  await I.processBrandImportCandidate("c1", deps(matchErr, engine({ findMatches: async () => { if (first) { first = false; return []; } throw new Error("db"); } }).engine).deps);
  assert.equal(matchErr.db.get("c1").failure_code, "match_failed");
});

test("process 21–22: an unknown exception persists internal_error only — never the message", async () => {
  const store = memStore();
  const SECRET = "https://evil.example/?token=sk-SECRET <html>stack</html>";
  const e = engine({ fetchHtml: async () => { throw new TypeError(SECRET); } });
  const { deps: d, logs } = deps(store, e.engine);
  assert.deepEqual(await I.processBrandImportCandidate("c1", d), { outcome: "processed", status: "failed" });
  const r = store.db.get("c1");
  assert.deepEqual([r.status, r.failure_code], ["failed", "internal_error"]);
  assert.ok(!JSON.stringify(r).includes("SECRET") && !JSON.stringify(logs).includes("SECRET"), "message never persisted or logged");
  assert.equal(logs[0].errorType, "TypeError");
  assert.ok(!JSON.stringify(logs).includes("milkmakeup.com/"), "no URLs in the log beyond the host");
});

test("process: a result is discarded if the lease was taken over meanwhile", async () => {
  const store = memStore();
  const e = engine({
    fetchHtml: async (url) => {
      // Another request reclaims the (expired) lease while we work.
      store.db.get("c1").attempt_count = 2;
      return { ok: true, url: new URL(url.href), html: THIN, bytes: 1, redirects: 0, truncated: false, declaredBytes: null };
    },
  });
  assert.deepEqual(await I.processBrandImportCandidate("c1", deps(store, e.engine).deps), { outcome: "lease_lost" });
  assert.equal(store.db.get("c1").proposal, null);
});

// ── AI usage ──────────────────────────────────────────────────────────────
test("AI 23: a new call's usage is stored", async () => {
  const store = memStore();
  await I.processBrandImportCandidate("c1", deps(store, engine().engine).deps);
  const r = store.db.get("c1");
  assert.deepEqual(
    [r.ai_status, r.ai_model, r.ai_input_tokens, r.ai_output_tokens, r.ai_cache_creation_input_tokens, r.ai_cache_read_input_tokens, r.ai_estimated_cost_usd],
    ["used", "claude-opus-5", 1200, 300, null, null, 0.0135]
  );
});

test("AI 24–25: retries accumulate actual usage; a no-AI attempt adds nothing", () => {
  const base = { ai_status: "used", ai_model: "claude-opus-5", ai_input_tokens: 1200, ai_output_tokens: 300, ai_cache_creation_input_tokens: null, ai_cache_read_input_tokens: null, ai_estimated_cost_usd: 0.0135 };
  const again = I.accumulateAiUsage(base, { status: "used", reused: false, called: true, usage: { ...USAGE, cacheReadInputTokens: 50 } });
  assert.deepEqual(
    [again.ai_input_tokens, again.ai_output_tokens, again.ai_cache_read_input_tokens, again.ai_cache_creation_input_tokens, again.ai_estimated_cost_usd],
    [2400, 600, 50, null, 0.027]
  );
  const skipped = I.accumulateAiUsage(base, { status: "skipped", reused: false, called: false, usage: null });
  assert.deepEqual({ ...skipped, ai_status: "used" }, base, "numbers unchanged");
  assert.equal(skipped.ai_status, "skipped", "status reflects the latest attempt");
  const noResponse = I.accumulateAiUsage(base, { status: "failed", reused: false, called: true, usage: null });
  assert.equal(noResponse.ai_input_tokens, 1200, "called but no usage → unknown, not zero");
  const unpriced = I.accumulateAiUsage(base, { status: "used", reused: false, called: true, usage: { ...USAGE, model: "other", estimatedCostUsd: null } });
  assert.deepEqual([unpriced.ai_model, unpriced.ai_input_tokens, unpriced.ai_estimated_cost_usd], ["other", 2400, 0.0135], "cost sums KNOWN estimates");
  assert.deepEqual(Object.keys(again).sort(), Object.keys(base).sort(), "only AI columns");
});

test("AI 24 (end to end): a retried candidate accumulates both calls", async () => {
  const store = memStore();
  let n = 0;
  const e = engine({ fetchHtml: async (url) => (++n === 1 ? { ok: false, code: "timeout", redirects: 0 } : { ok: true, url: new URL(url.href), html: THIN, bytes: 1, redirects: 0, truncated: false, declaredBytes: null }) });
  await I.processBrandImportCandidate("c1", deps(store, e.engine).deps);
  assert.equal(store.db.get("c1").ai_input_tokens, null, "failed fetch: no AI, nothing recorded");
  await I.processBrandImportCandidate("c1", deps(store, e.engine).deps);
  store.db.get("c1").status = "failed"; // admin retries a ready one only in tests
  await I.processBrandImportCandidate("c1", deps(store, e.engine).deps);
  const r = store.db.get("c1");
  assert.deepEqual([r.attempt_count, r.ai_input_tokens, r.ai_output_tokens, r.ai_estimated_cost_usd], [3, 2400, 600, 0.027]);
});

test("AI 26: a reused enrichment never adds cost", () => {
  const base = { ai_status: "used", ai_model: "m", ai_input_tokens: 10, ai_output_tokens: 5, ai_cache_creation_input_tokens: null, ai_cache_read_input_tokens: null, ai_estimated_cost_usd: 0.001 };
  const reused = I.accumulateAiUsage(base, { status: "used", reused: true, called: false, usage: null });
  assert.deepEqual(reused, base);
  const weird = I.accumulateAiUsage(base, { status: "used", reused: true, called: true, usage: USAGE });
  assert.equal(weird.ai_input_tokens, 10, "reused is never counted, whatever else it claims");
});

// ── Runner ────────────────────────────────────────────────────────────────
test("runner 31: at most 2 candidates in flight", async () => {
  let inFlight = 0;
  let max = 0;
  const done = [];
  await R.runWithConcurrency(["a", "b", "c", "d", "e"], R.BRAND_IMPORT_RUNNER_CONCURRENCY, async (id) => {
    inFlight += 1;
    max = Math.max(max, inFlight);
    await new Promise((res) => setTimeout(res, 5));
    inFlight -= 1;
    done.push(id);
    return "done";
  });
  assert.equal(R.BRAND_IMPORT_RUNNER_CONCURRENCY, 2);
  assert.equal(max, 2);
  assert.deepEqual(done.sort(), ["a", "b", "c", "d", "e"]);
  // Busy → requeued (bounded), never an infinite loop.
  const seen = [];
  await R.runWithConcurrency(["x"], 2, async (id) => (seen.push(id), "retry_later"), { wait: async () => {}, maxRequeues: 3 });
  assert.equal(seen.length, 4);
});

test("runner 32–33: stopping leaves persisted state; Resume picks up queued and expired candidates only", async () => {
  const store = memStore([1, 2, 3, 4].map((i) => row({ id: `c${i}`, submitted_input: `brand${i}.com`, normalized_host: `brand${i}.com` })));
  const e = engine();
  let stop = false;
  let processed = 0;
  await R.runWithConcurrency(["c1", "c2", "c3", "c4"], 2, async (id) => {
    await I.processBrandImportCandidate(id, deps(store, e.engine).deps);
    processed += 1;
    if (processed === 2) stop = true; // the page was closed
    return "done";
  }, { shouldStop: () => stop });
  const view = [...store.db.values()].map((r) => ({ id: r.id, position: Number(r.id.slice(1)), status: r.status, attemptCount: r.attempt_count, processingStartedAt: r.processing_started_at }));
  assert.deepEqual(R.runnableCandidateIds(view, T0), ["c3", "c4"], "remaining queued are resumable");
  // An abandoned processing claim becomes runnable only after the lease.
  const abandoned = [{ id: "z", position: 9, status: "processing", attemptCount: 1, processingStartedAt: new Date(T0 - 30_000).toISOString() }];
  assert.deepEqual(R.runnableCandidateIds(abandoned, T0), []);
  assert.deepEqual(R.runnableCandidateIds(abandoned, T0 + 120_000), ["z"]);
  // Failed / done / over-limit candidates are not auto-run.
  assert.deepEqual(R.runnableCandidateIds([
    { id: "f", position: 1, status: "failed", attemptCount: 1, processingStartedAt: null },
    { id: "r", position: 2, status: "ready", attemptCount: 1, processingStartedAt: null },
    { id: "q", position: 3, status: "queued", attemptCount: 5, processingStartedAt: null },
  ], T0), []);
});

// ── Security / boundary ───────────────────────────────────────────────────
const IMPORT_DIR = "src/app/admin/(protected)/businesses/import";
const ACTIONS = `${IMPORT_DIR}/actions.ts`;
const LIB = "src/lib/admin/brand-import.ts";
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const P3_FILES = [LIB, "src/lib/admin/brand-import-runner.ts", "src/lib/admin/brand-import-display.ts", ...walk(IMPORT_DIR)];

test("security 27: every action and page verifies the admin session before any data access", () => {
  const actions = code(ACTIONS);
  assert.match(actions, /^"use server";/);
  for (const fn of ["createBrandImportBatchAction", "processBrandImportCandidateAction"]) {
    const body = actions.slice(actions.indexOf(`export async function ${fn}`));
    const guard = body.indexOf("await requireAdminSupabase()");
    assert.ok(guard > 0, `${fn} guarded`);
    for (const use of ["supabaseBrandImportStore(", "processBrandImportCandidate(", "getAllCategories("]) {
      const at = body.indexOf(use);
      assert.ok(at === -1 || at > guard, `${fn}: ${use} after the guard`);
    }
  }
  for (const page of walk(IMPORT_DIR).filter((f) => f.endsWith("page.tsx"))) {
    const src = code(page);
    const guard = src.indexOf("await requireAdminSupabase()");
    assert.ok(guard > 0, `${page} guarded`);
    assert.ok(src.indexOf("load") === -1 || src.indexOf("(admin") > guard, `${page}: loads after the guard`);
  }
  assert.ok(walk(IMPORT_DIR).every((f) => f.includes(join("app", "admin", "(protected)"))), "under the middleware-protected admin tree");
});

test("security 28: service role stays server-side; client components get ids and safe data only", () => {
  assert.match(read(LIB), /^import "server-only";/);
  for (const f of walk(IMPORT_DIR).filter((f) => /^"use client";/.test(read(f)))) {
    const src = code(f);
    assert.doesNotMatch(src, /lib\/admin\/brand-import"|supabase-admin|requireAdminSupabase|getAdminSupabase|SERVICE_ROLE|safe-fetch|brand-ai-enrichment/, f);
  }
  assert.doesNotMatch(read("src/lib/admin/brand-import-runner.ts"), /server-only|supabase|process\.env/);
  // The batch page hands the runner only runnable ids.
  assert.match(read(`${IMPORT_DIR}/[batchId]/page.tsx`), /<BrandImportRunner runnableIds=\{runnableIds\} resumed=\{resumed\} \/>/);
});

test("security 29: no public route or API touches import candidates", () => {
  const offenders = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && read(f).includes("brand_import_")).filter((f) => !f.startsWith(join("src", "lib", "admin")) && !f.startsWith(join("src", "app", "admin")));
  assert.deepEqual(offenders, []);
  assert.deepEqual(walk("src/app/api").filter((f) => /import/i.test(f) && /brand/i.test(read(f))), []);
});

// P4 adds the ONE canonical Business writer in lib/admin/brand-import-review.ts
// (guarded by tests/brand-import-review.test.mjs); P3 files and the import
// pages/actions still never write a Business directly.
test("security 30: P3 files have no canonical Business write path", () => {
  for (const f of P3_FILES) {
    const src = code(f);
    assert.doesNotMatch(src, /from\("businesses"\)\s*\.(insert|update|upsert|delete)\(/, f);
    assert.doesNotMatch(src, /\.rpc\(|create_owned_business|storeBrandImage|storePublicImage|business_members|business_markets|market_requests|publication_status|\.storage\./, f);
  }
  // The only businesses access is a read (matched names) plus the matcher's SELECT.
  assert.match(code(LIB), /from\("businesses"\)\.select\("id, name"\)/);
  // Writes go only to the two import tables.
  const tables = [...code(LIB).matchAll(/from\("(\w+)"\)\s*\.(insert|update|delete|upsert)\(/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tables)].sort(), ["brand_import_batches", "brand_import_candidates"]);
});

test("store: claim and finish are conditional (attempt + lease) in the real Supabase store", () => {
  const src = code(LIB);
  const claim = src.slice(src.indexOf("async claim("), src.indexOf("async finish("));
  assert.match(claim, /\.eq\("attempt_count", expectedAttempts\)/);
  assert.match(claim, /status\.in\.\(queued,failed\),and\(status\.eq\.processing,processing_started_at\.lt\."\$\{staleBeforeIso\}"\)/);
  assert.match(claim, /attempt_count: expectedAttempts \+ 1/);
  const finish = src.slice(src.indexOf("async finish("));
  assert.match(finish, /\.eq\("attempt_count", attempt\)\s*\.eq\("status", "processing"\)/);
  assert.match(src, /\.eq\("status", "processing"\)\s*\.gte\("processing_started_at", freshSinceIso\)/);
});

test("entry point: Import Brands is reachable from Admin Businesses; Title Case copy", () => {
  const list = read("src/app/admin/(protected)/businesses/page.tsx");
  assert.match(list, /href="\/admin\/businesses\/import"[\s\S]{0,200}Import Brands/);
  const page = read(`${IMPORT_DIR}/page.tsx`);
  assert.match(page, />Import Brands</);
  assert.match(read(`${IMPORT_DIR}/BuildBrandProfilesButton.tsx`), /"Build Brand Profiles"/);
  assert.match(read(`${IMPORT_DIR}/BrandImportRunner.tsx`), /"Start Processing"[\s\S]*Pause|Pause[\s\S]*"Start Processing"/);
  assert.match(read(`${IMPORT_DIR}/[batchId]/page.tsx`), /Retry Limit Reached/);
  assert.doesNotMatch(page, /type="file"|csv/i, "website input only");
});

// ── View Candidate: link → route → loader (production 404 regression) ─────
const BATCH_ID = "e085e544-0399-4d4e-aade-ba3aab3e0338";
const CAND_ID = "305b8c4a-acdb-4fbd-a859-989597607874";
const OTHER_BATCH_ID = "11111111-2222-4333-8444-555555555555";
const CANDIDATE_ROW = {
  id: CAND_ID, batch_id: BATCH_ID, position: 1, submitted_input: "milkmakeup.com", normalized_host: "milkmakeup.com", status: "ready",
  failure_code: null, attempt_count: 1, processing_started_at: null,
  proposal: { site: "https://milkmakeup.com", finalUrl: "https://milkmakeup.com/", name: "Milk Makeup", cat: CAT.id },
  matched_business_id: null, ai_status: "used", ai_model: "claude-opus-5", ai_input_tokens: 2100, ai_output_tokens: 150,
  ai_cache_creation_input_tokens: null, ai_cache_read_input_tokens: null, ai_estimated_cost_usd: 0.0143,
};
/** A fake service-role client: applies eq/in filters like PostgREST; can
 * fail one table's query with a PostgREST-style error. */
function fakeAdmin(tables, failTable = null) {
  return {
    from(table) {
      const filters = [];
      let single = false;
      const q = {
        select: () => q,
        order: () => q,
        eq: (col, val) => (filters.push((r) => r[col] === val), q),
        in: (col, vals) => (filters.push((r) => vals.includes(r[col])), q),
        maybeSingle: () => ((single = true), q),
        then(resolve, reject) {
          if (failTable === table) {
            return Promise.resolve({ data: null, error: { code: "PGRST000", message: "connection failed https://db.example/?token=SECRET" } }).then(resolve, reject);
          }
          const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          return Promise.resolve(single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}
const TABLES = { brand_import_batches: [{ id: BATCH_ID, created_at: "2026-10-12T02:00:00Z", submitted_count: 5 }], brand_import_candidates: [CANDIDATE_ROW], businesses: [] };

async function captureConsoleError(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(" "));
  try {
    return { result: await fn().catch((e) => ({ thrown: e })), lines };
  } finally {
    console.error = original;
  }
}

test("view candidate 1: the batch page's href matches the real route shape and param names", () => {
  const batchPage = read(`${IMPORT_DIR}/[batchId]/page.tsx`);
  const template = batchPage.match(/href=\{`(\/admin\/businesses\/import\/\$\{batch\.id\}\/\$\{c\.id\})`\}/);
  assert.ok(template, "View Candidate links to /admin/businesses/import/${batch.id}/${c.id}");
  assert.ok(statSync(`${IMPORT_DIR}/[batchId]/[candidateId]/page.tsx`).isFile(), "route file exists");
  const detail = read(`${IMPORT_DIR}/[batchId]/[candidateId]/page.tsx`);
  assert.match(detail, /params: Promise<\{ batchId: string; candidateId: string \}>/);
  // The concrete production URL matches the route pattern and passes the
  // page's own id check.
  const href = template[1].replace("${batch.id}", BATCH_ID).replace("${c.id}", CAND_ID);
  const m = href.match(/^\/admin\/businesses\/import\/([^/]+)\/([^/]+)$/);
  assert.deepEqual([m[1], m[2]], [BATCH_ID, CAND_ID]);
  const UUID = new RegExp(detail.match(/const UUID = \/(.+)\/i;/)[1], "i");
  assert.ok(UUID.test(m[1]) && UUID.test(m[2]));
});

test("view candidate 2: a valid batchId + candidateId resolves through the loader", async () => {
  const view = await I.loadBrandImportCandidate(fakeAdmin(TABLES), BATCH_ID, CAND_ID);
  assert.equal(view.id, CAND_ID);
  assert.equal(view.status, "ready");
  assert.equal(view.proposal.name, "Milk Makeup");
  assert.equal(view.aiEstimatedCostUsd, 0.0143);
});

test("view candidate 3–4: wrong batch and nonexistent candidate stay not found (null → 404)", async () => {
  assert.equal(await I.loadBrandImportCandidate(fakeAdmin(TABLES), OTHER_BATCH_ID, CAND_ID), null, "candidate of another batch");
  assert.equal(await I.loadBrandImportCandidate(fakeAdmin(TABLES), BATCH_ID, "99999999-9999-4999-8999-999999999999"), null);
  assert.equal(await I.loadBrandImportBatch(fakeAdmin(TABLES), OTHER_BATCH_ID), null);
});

test("view candidate: a failed query is NOT a 404 — it throws a generic error and logs safely", async () => {
  for (const [fn, table, target] of [
    [() => I.loadBrandImportCandidate(fakeAdmin(TABLES, "brand_import_candidates"), BATCH_ID, CAND_ID), "brand_import_candidates", "candidate"],
    [() => I.loadBrandImportBatch(fakeAdmin(TABLES, "brand_import_batches"), BATCH_ID), "brand_import_batches", "batch"],
    [() => I.loadBrandImportBatch(fakeAdmin(TABLES, "brand_import_candidates"), BATCH_ID), "brand_import_candidates", "batch_candidates"],
  ]) {
    const { result, lines } = await captureConsoleError(fn);
    assert.ok(result?.thrown instanceof I.BrandImportLoadError, `${table}: throws, not null`);
    assert.equal(result.thrown.target, target);
    assert.equal(result.thrown.message, "brand_import_load_failed", "generic message for the browser");
    assert.deepEqual(JSON.parse(lines[0]), { event: "brand_import_load", outcome: "query_failed", target, code: "PGRST000" });
    assert.ok(!lines.join("").includes("SECRET") && !lines.join("").includes(CAND_ID), "no message, URL or ids in the log");
  }
});

test("view candidate 5: the detail page keeps the Admin boundary and 404s only for invalid ids or a missing candidate", () => {
  const detail = code(`${IMPORT_DIR}/[batchId]/[candidateId]/page.tsx`);
  const guard = detail.indexOf("await requireAdminSupabase()");
  assert.ok(guard > 0 && guard < detail.indexOf("loadBrandImportCandidate(admin"), "admin session verified before loading");
  assert.deepEqual(detail.match(/notFound\(\)/g).length, 2);
  assert.match(detail, /if \(!UUID\.test\(batchId\) \|\| !UUID\.test\(candidateId\)\) notFound\(\);/);
  assert.match(detail, /if \(!candidate\) notFound\(\);/);
  assert.doesNotMatch(detail, /catch\s*\(/, "load errors are not swallowed into a 404");
  // The loader itself scopes by both ids and never swallows its error.
  const loader = code(LIB).slice(code(LIB).indexOf("export async function loadBrandImportCandidate"));
  assert.match(loader, /\.eq\("id", candidateId\)\.eq\("batch_id", batchId\)\.maybeSingle\(\)/);
  assert.match(loader, /if \(error\) loadFailed\("candidate", error\);\s*if \(!data\) return null;/);
});
