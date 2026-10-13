// Admin "Convert To Event" failure path, end to end through the REAL
// server action (convertAppearanceFromAdminPage → runConversion →
// analyzeEventUrl → safeFetchEventPage, including its one 429/503 retry).
// Only Next's redirect/cache helpers, the admin client and the network
// transport are stubs. Plus the production crash regression: the route
// that hosts the action must not run on the default function budget and
// must contain a cut-off action instead of the whole-app error screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const data = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return data("export{}");
    if (specifier === "next/headers") return data("export const cookies=async()=>({get(){return undefined}});export const headers=async()=>new Map();");
    if (specifier === "next/navigation") return data("export function redirect(url){throw Object.assign(new Error('NEXT_REDIRECT'),{url})}export function notFound(){throw new Error('NOT_FOUND')}");
    if (specifier === "next/cache") return data("export function revalidatePath(){}");
    if (specifier === "@/lib/admin/requireAdminSupabase") return data("export async function requireAdminSupabase(){return globalThis.__admin}");
    if (specifier === "@/lib/admin/queries") return data("export async function isSlugTaken(){return false}");
    if (specifier === "../safe-fetch" && context.parentURL?.endsWith("/event-import/engine.ts")) {
      return { url: new URL("./fixtures/safe-fetch-stub-transport.mjs", import.meta.url).href, shortCircuit: true };
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

const A = await import("../src/app/admin/(protected)/appearances/convert-actions.ts");
const read = (p) => readFileSync(p, "utf8");

const QSBS = "4986798c-04be-4a6b-9795-7562f68f922c";
const SOURCE = "https://luma.com/corginyc-mjk0";

/** Read-only fake: the action only reads the item before the source fetch fails. */
function fakeAdmin() {
  const writes = [];
  const row = { id: QSBS, business_id: "corgi", external_url: SOURCE, event_id: null };
  const builder = () => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: row, error: null }),
      insert: (v) => (writes.push(v), q),
      update: (v) => (writes.push(v), q),
      upsert: (v) => (writes.push(v), q),
    };
    return q;
  };
  return { admin: { from: builder }, writes };
}

function luma(statuses) {
  const calls = [];
  let i = 0;
  globalThis.__safeFetchTransport = async (url) => {
    calls.push(url.href);
    const status = statuses[Math.min(i++, statuses.length - 1)];
    return { status, headers: { "content-type": "text/html" }, body: (async function* () { yield Buffer.from("refused"); })(), destroy() {} };
  };
  return calls;
}

/** Runs the real page action; returns the decoded Admin message it redirects with. */
async function convertFromAdminPage() {
  const { admin, writes } = fakeAdmin();
  globalThis.__admin = admin;
  try {
    await A.convertAppearanceFromAdminPage(QSBS);
  } catch (err) {
    if (err.message !== "NEXT_REDIRECT") throw err;
    const url = new URL(err.url, "https://findmi.app");
    assert.equal(url.pathname, `/admin/appearances/${QSBS}`);
    assert.equal(url.searchParams.get("converted"), null);
    return { message: url.searchParams.get("convertError"), raw: err.url, writes };
  }
  assert.fail("the action must redirect");
}

const PAGE = read("src/app/admin/(protected)/appearances/[id]/page.tsx");
/** Exactly what the Edit Appearance page renders for ?convertError=. */
const rendered = (message) => {
  assert.match(PAGE, /\{convertError && <p className="[^"]*">Not converted — \{convertError\}<\/p>\}/);
  return `Not converted — ${message}`;
};

test("Luma 403 → one request, Admin sees the status and host, nothing written", async () => {
  const calls = luma([403]);
  const r = await convertFromAdminPage();
  assert.equal(calls.length, 1, "403 is never retried");
  assert.equal(r.message, "Source unavailable — luma.com returned HTTP 403.");
  assert.equal(rendered(r.message), "Not converted — Source unavailable — luma.com returned HTTP 403.");
  assert.deepEqual(r.writes, []);
  assert.doesNotThrow(() => decodeURIComponent(r.raw), "the redirect URL is well-formed");
});

for (const status of [429, 503]) {
  test(`Luma ${status} twice → exactly one retry, temporary wording with the retry noted`, async () => {
    const calls = luma([status, status]);
    const r = await convertFromAdminPage();
    assert.deepEqual(calls, [SOURCE, SOURCE], "the original link, retried once");
    assert.equal(r.message, `Source temporarily unavailable — luma.com returned HTTP ${status} (after one retry).`);
    assert.equal(rendered(r.message), `Not converted — Source temporarily unavailable — luma.com returned HTTP ${status} (after one retry).`);
    assert.deepEqual(r.writes, []);
  });
}

test("401/407/451 → no retry, plain unavailable wording", async () => {
  for (const status of [401, 407, 451]) {
    const calls = luma([status]);
    const r = await convertFromAdminPage();
    assert.equal(calls.length, 1, String(status));
    assert.equal(r.message, `Source unavailable — luma.com returned HTTP ${status}.`);
  }
});

test("the summary API (convertLegacyAppearanceToEvent) returns plain, serializable diagnostics", async () => {
  luma([403]);
  const { admin } = fakeAdmin();
  globalThis.__admin = admin;
  const out = await A.convertLegacyAppearanceToEvent(QSBS);
  assert.deepEqual(out, {
    status: "not_converted",
    reason: "source_unavailable",
    detail: "Source unavailable — luma.com returned HTTP 403.",
    fetch: { fetchCode: "blocked_by_site", status: 403, host: "luma.com", attempts: 1 },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out, "plain data only");
});

// ── production crash regression ─────────────────────────────────────────
test("crash regression: the Convert route has the 60s function budget, not the platform default", () => {
  assert.match(PAGE, /^export const maxDuration = 60;$/m);
  // Same ceiling the Appearance Import route already uses.
  assert.match(read("src/app/admin/(protected)/appearances/import/page.tsx"), /^export const maxDuration = 60;$/m);
});

test("crash regression: a cut-off action is contained to the Appearance page, never the whole-app error screen", () => {
  const boundary = read("src/app/admin/(protected)/appearances/[id]/error.tsx");
  assert.match(boundary, /^"use client";/, "Next error boundaries are client components");
  assert.match(boundary, /export default function AppearanceError/);
  assert.match(boundary, /This Request Didn&rsquo;t Finish/);
  assert.match(boundary, /may still have been saved/, "never claims the change failed — the writes can land before the cut-off");
  assert.match(boundary, /window\.location\.reload\(\)/);
  assert.doesNotMatch(boundary, /error\.message|error\.stack/, "no internal error text shown");
});
