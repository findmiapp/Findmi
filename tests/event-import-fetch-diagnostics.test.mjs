// Event Import — source fetch diagnostics + the ONE conservative 429/503
// retry. Stub transports and fake deps only: no network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/headers") return { url: "data:text/javascript,export const cookies=async()=>({get(){return undefined}});export const headers=async()=>new Map();", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const F = await import("../src/lib/safe-fetch.ts");
const E = await import("../src/lib/event-import/engine.ts");
const D = await import("../src/lib/event-import/diagnostics.ts");
const read = (p) => readFileSync(p, "utf8");

// ── stub transport ──────────────────────────────────────────────────────
function respond(status, headers = {}, body = "") {
  return {
    status,
    headers,
    body: (async function* () {
      yield Buffer.from(body);
    })(),
    destroy: () => {},
  };
}
const HTML = { "content-type": "text/html; charset=utf-8" };
const PAGE = "<html><head><title>QSBS</title></head><body>ok</body></html>";
/** routes: href → response, or array of responses served in order per href. */
function stub(routes) {
  const calls = [];
  const served = {};
  const transport = async (url) => {
    calls.push(url.href);
    const route = routes[url.href];
    if (!route) throw Object.assign(new Error("unexpected " + url.href), { code: "ECONNREFUSED" });
    if (Array.isArray(route)) {
      const i = served[url.href] ?? 0;
      served[url.href] = i + 1;
      return route[Math.min(i, route.length - 1)]();
    }
    return route();
  };
  return { transport, calls };
}
const waits = () => {
  const list = [];
  return { list, sleep: async (ms) => void list.push(ms) };
};
const EVENT = "https://luma.com/corginyc-mjk0";

// A ─ 403: blocked_by_site, status retained, never retried
test("A: HTTP 403 → blocked_by_site, status + host retained, exactly one request", async () => {
  const { transport, calls } = stub({ [EVENT]: () => respond(403, HTML, "denied") });
  const w = waits();
  const r = await F.safeFetchEventPage(EVENT, { transport, sleep: w.sleep });
  assert.equal(r.ok, false);
  assert.equal(r.code, "blocked_by_site");
  assert.equal(r.status, 403);
  assert.equal(r.host, "luma.com");
  assert.equal(r.attempts, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(w.list, []);
});

// B / C ─ 429 and 503: one retry maximum
for (const status of [429, 503]) {
  test(`B/C: HTTP ${status} → blocked_by_site, one retry maximum`, async () => {
    const { transport, calls } = stub({ [EVENT]: () => respond(status, HTML, "busy") });
    const w = waits();
    const r = await F.safeFetchEventPage(EVENT, { transport, sleep: w.sleep });
    assert.equal(r.code, "blocked_by_site");
    assert.equal(r.status, status);
    assert.equal(r.attempts, 2);
    assert.equal(calls.length, 2, "never more than one retry");
    assert.deepEqual(w.list, [F.SAFE_FETCH_RETRY_DEFAULT_WAIT_MS]);
  });

  test(`B/C: HTTP ${status} then 200 → the normal success result`, async () => {
    const { transport, calls } = stub({ [EVENT]: [() => respond(status, { ...HTML, "retry-after": "1" }), () => respond(200, HTML, PAGE)] });
    const w = waits();
    const r = await F.safeFetchEventPage(EVENT, { transport, sleep: w.sleep });
    assert.equal(r.ok, true);
    assert.equal(r.html, PAGE);
    assert.equal(calls.length, 2);
    assert.deepEqual(w.list, [1000], "a short Retry-After is honored");
  });
}

test("Retry-After: too long (seconds or date) → no retry, refusal returned as is", async () => {
  for (const ra of ["120", new Date(Date.now() + 60_000).toUTCString()]) {
    const { transport, calls } = stub({ [EVENT]: () => respond(429, { ...HTML, "retry-after": ra }) });
    const w = waits();
    const r = await F.safeFetchEventPage(EVENT, { transport, sleep: w.sleep });
    assert.equal(r.code, "blocked_by_site");
    assert.equal(r.status, 429);
    assert.equal(r.attempts, 1);
    assert.equal(calls.length, 1, ra);
    assert.deepEqual(w.list, []);
  }
});

test("Retry-After parsing: delta-seconds, HTTP-date, junk", () => {
  const now = Date.parse("2026-10-13T20:00:00Z");
  assert.equal(F.parseRetryAfter("2", now), 2000);
  assert.equal(F.parseRetryAfter(" 0 ", now), 0);
  assert.equal(F.parseRetryAfter(new Date(now + 1500).toUTCString(), now), 1000, "HTTP-date has second precision");
  assert.equal(F.parseRetryAfter(new Date(now - 5000).toUTCString(), now), 0, "a past date means now");
  assert.equal(F.parseRetryAfter("soon", now), null);
  assert.equal(F.parseRetryAfter(null, now), null);
  assert.equal(F.parseRetryAfter("-3", now), null);
});

test("budget: no retry when the remaining request budget is too small", async () => {
  const { transport, calls } = stub({ [EVENT]: () => respond(503, HTML) });
  let t = 0;
  const clock = () => t;
  const slowTransport = async (url, signal, accept) => {
    t += F.SAFE_FETCH_EVENT_BUDGET_MS - F.SAFE_FETCH_RETRY_MIN_ATTEMPT_MS; // the first attempt used most of the budget
    return transport(url, signal, accept);
  };
  const w = waits();
  const r = await F.safeFetchEventPage(EVENT, { transport: slowTransport, sleep: w.sleep, now: clock });
  assert.equal(r.status, 503);
  assert.equal(r.attempts, 1);
  assert.equal(calls.length, 1);
});

// D ─ 401 / 407 / 451 (and plain HTTP errors): never retried
test("D: HTTP 401/407/451 → blocked_by_site, no retry; 404/500 → http_error, no retry", async () => {
  for (const [status, code] of [[401, "blocked_by_site"], [407, "blocked_by_site"], [451, "blocked_by_site"], [404, "http_error"], [500, "http_error"]]) {
    const { transport, calls } = stub({ [EVENT]: () => respond(status, { ...HTML, "retry-after": "1" }) });
    const w = waits();
    const r = await F.safeFetchEventPage(EVENT, { transport, sleep: w.sleep });
    assert.equal(r.code, code, String(status));
    assert.equal(r.status, status);
    assert.equal(r.attempts, 1);
    assert.equal(calls.length, 1, String(status));
    assert.deepEqual(w.list, []);
  }
});

test("other failures (timeout/network/redirect_rejected) are never retried", async () => {
  const net = stub({});
  const r = await F.safeFetchEventPage(EVENT, { transport: net.transport, sleep: async () => assert.fail("no wait") });
  assert.equal(r.code, "network_error");
  assert.equal(net.calls.length, 1);
});

test("brand/image fetches never retry: only the Event page fetch does", async () => {
  const { transport, calls } = stub({ "https://brand.com/": () => respond(429, HTML) });
  assert.equal((await F.safeFetchHtml("https://brand.com/", { transport })).code, "blocked_by_site");
  assert.equal(calls.length, 1);
});

// E ─ final hostname retained (after validated redirects)
test("E: the FINAL hostname after a validated redirect is retained", async () => {
  const { transport } = stub({
    "https://lu.ma/corginyc-mjk0": () => respond(301, { location: EVENT }),
    [EVENT]: () => respond(403, HTML),
  });
  const r = await F.safeFetchEventPage("https://lu.ma/corginyc-mjk0", { transport });
  assert.equal(r.host, "luma.com");
  assert.equal(r.status, 403);
  assert.equal(r.redirects, 1);
});

// F ─ the retry re-runs the full validation and redirect checks
test("F: the retry starts again from the original URL and re-checks every redirect", async () => {
  const { transport, calls } = stub({
    "https://lu.ma/corginyc-mjk0": [() => respond(301, { location: EVENT }), () => respond(302, { location: "https://127.0.0.1/admin" })],
    [EVENT]: () => respond(503, HTML),
  });
  const r = await F.safeFetchEventPage("https://lu.ma/corginyc-mjk0", { transport, sleep: async () => {} });
  assert.deepEqual(calls, ["https://lu.ma/corginyc-mjk0", EVENT, "https://lu.ma/corginyc-mjk0"]);
  assert.equal(r.code, "redirect_rejected", "a retry's redirect to a blocked destination is refused exactly as before");
  assert.equal(r.attempts, 2);
});

test("F: a blocked destination is refused before any request — no retry path at all", async () => {
  const { transport, calls } = stub({});
  const r = await F.safeFetchEventPage("https://127.0.0.1/e", { transport, sleep: async () => assert.fail("no wait") });
  assert.equal(r.code, "blocked_destination");
  assert.equal(calls.length, 0);
});

// G ─ success shape unchanged
test("G: HTTP 200 → the same normal success result (no diagnostics fields)", async () => {
  const { transport, calls } = stub({ [EVENT]: () => respond(200, HTML, PAGE) });
  const r = await F.safeFetchEventPage(EVENT, { transport });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r).sort(), ["bytes", "contentType", "declaredBytes", "html", "ok", "redirects", "truncated", "url"]);
  assert.equal(r.html, PAGE);
  assert.equal(calls.length, 1);
});

// ── engine propagation + logging ────────────────────────────────────────
function deps(over = {}) {
  return {
    fetchPage: async () => ({ ok: false, code: "blocked_by_site", redirects: 1, status: 403, host: "luma.com", contentType: "text/html", attempts: 1 }),
    ai: null,
    matchEvent: async () => null,
    getEvent: async () => null,
    matchLocations: async () => [],
    matchOrganizer: async () => null,
    matchExistingAppearance: async () => null,
    findScheduledBySourceUrl: async () => null,
    findEventBySourceUrl: async () => null,
    isRateLimited: () => false,
    now: () => Date.now(),
    ...over,
  };
}

test("H: analyzeEventUrl keeps status + final host for Admin, and logs one concise line", async () => {
  const logs = [];
  const r = await E.analyzeEventUrl({ url: "https://lu.ma/corginyc-mjk0?utm=x", businessId: "b", rateKey: "u" }, deps({ logFetchFailure: (l) => logs.push(l) }));
  assert.deepEqual(r, { ok: false, code: "blocked_by_site", fetch: { fetchCode: "blocked_by_site", status: 403, host: "luma.com", attempts: 1 } });
  assert.equal(logs.length, 1);
  assert.equal(logs[0], "[event-import] source fetch failed source=lu.ma final=luma.com status=403 fetch=blocked_by_site result=blocked_by_site attempts=1");
  assert.doesNotMatch(logs[0], /corginyc|utm|https?:/, "no path, query or full URL");
});

test("H: Admin wording distinguishes 403 / 429 / 503", () => {
  const d = (status, attempts = 1) => ({ fetchCode: "blocked_by_site", status, host: "luma.com", attempts });
  assert.equal(D.describeSourceFailure("blocked_by_site", d(403)), "Source unavailable — luma.com returned HTTP 403.");
  assert.equal(D.describeSourceFailure("blocked_by_site", d(429, 2)), "Source temporarily unavailable — luma.com returned HTTP 429 (after one retry).");
  assert.equal(D.describeSourceFailure("blocked_by_site", d(503, 2)), "Source temporarily unavailable — luma.com returned HTTP 503 (after one retry).");
  assert.equal(D.describeSourceFailure("unreachable", { fetchCode: "timeout" }), "Source unavailable — timeout.");
  assert.equal(D.describeSourceFailure("unreachable", undefined), "Source unavailable — unreachable.");
});

test("H: diagnostics keep only safe public fields", () => {
  const out = D.safeFetchDiagnostics({ code: "blocked_by_site", status: 403, host: "LUMA.com", attempts: 1, contentType: "text/html", address: "10.0.0.1", headers: { cookie: "x" } });
  assert.deepEqual(out, { fetchCode: "blocked_by_site", status: 403, host: "luma.com", attempts: 1 });
  assert.deepEqual(D.safeFetchDiagnostics({ code: "http_error", status: 9999, host: "bad host/x" }), { fetchCode: "http_error" });
});

test("H: Admin conversion surfaces the safe status/host sentence", () => {
  const src = read("src/app/admin/(protected)/appearances/convert-actions.ts");
  assert.match(src, /reason: "source_unavailable", detail: describeSourceFailure\(analysis\.code, analysis\.fetch\), fetch: analysis\.fetch/);
  assert.match(src, /requireAdminSupabase\(\)/);
});

// I ─ consumer-facing results carry no diagnostics
test("I: consumer importer results are stripped to the plain failure code", async () => {
  const r = await E.analyzeEventUrl({ url: "https://luma.com/x", businessId: "b", rateKey: "u" }, deps());
  assert.ok(r.fetch, "the engine has them (Admin)…");
  assert.deepEqual(D.publicImportAnalysis(r), { ok: false, code: "blocked_by_site" }, "…the consumer result does not");
  const ok = { ok: true, kind: "single", candidate: {}, matches: {}, warnings: [] };
  assert.equal(D.publicImportAnalysis(ok), ok);
  const action = read("src/app/(public)/account/business/[id]/import-event/actions.ts");
  assert.match(action, /return publicImportAnalysis\(await analyzeEventUrl\(/);
});

// J ─ existing semantics: a failure without any site response is unchanged
test("J: failures with no site response keep the exact previous result shape, and are not logged", async () => {
  const logs = [];
  for (const [code, expected] of [["timeout", "unreachable"], ["blocked_destination", "blocked_url"], ["dns_failed", "unreachable"]]) {
    const r = await E.analyzeEventUrl({ url: "https://site.com/e", businessId: "b", rateKey: "u" }, deps({ fetchPage: async () => ({ ok: false, code, redirects: 0 }), logFetchFailure: (l) => logs.push(l) }));
    assert.deepEqual(r, { ok: false, code: expected });
  }
  assert.deepEqual(logs, []);
});

// ── static guards ───────────────────────────────────────────────────────
test("static: honest generic Findmi User-Agent; no browser / crawler impersonation", () => {
  assert.match(F.SAFE_FETCH_USER_AGENT, /^FindmiBot\/1\.0 \(\+https:\/\/findmi\.app; /);
  assert.doesNotMatch(F.SAFE_FETCH_USER_AGENT, /brand profile|Mozilla|Chrome|Safari|Googlebot|bingbot|AppleWebKit/i);
});

test("static: the retry goes through safeFetchResource (full validation), only for 429/503", () => {
  const src = read("src/lib/safe-fetch.ts");
  assert.match(src, /const TRANSIENT_STATUSES = new Set\(\[429, 503\]\);/);
  assert.match(src, /const SITE_REFUSAL_STATUSES = new Set\(\[401, 403, 407, 429, 451, 503\]\);/);
  assert.match(src, /r = await safeFetchResource\(input, EVENT_HTML_PROFILE, \{ \.\.\.options, timeoutMs: /);
  assert.ok(F.SAFE_FETCH_RETRY_MAX_WAIT_MS <= 2000);
  assert.ok(F.SAFE_FETCH_EVENT_BUDGET_MS <= 10_000);
});
