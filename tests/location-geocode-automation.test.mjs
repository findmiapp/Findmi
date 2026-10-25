// Automatic Location geocoding. The REAL drain (lib/geo/geocode.ts), the
// REAL write-path kick (lib/geo/geocode-auto.ts, with next/server's after()
// captured) and the REAL cron route, against an in-memory `locations` table
// whose update/insert behavior mirrors the database trigger
// (locations_geocode_guard) — the SQL itself is pinned by source assertions
// below. A fake provider counts calls. No network, no Production data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, resolve as resolvePath } from "node:path";

const require = createRequire(import.meta.url);
const { transform } = require("sucrase");
const ROOT = process.cwd();
const read = (f) => readFileSync(f, "utf8");
const isFile = (f) => existsSync(f) && statSync(f).isFile();
const withExt = (base) => [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(isFile);
const js = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
const NEXT_SERVER = `export const after = (fn) => { if (!globalThis.__inRequest) throw new Error("after() outside a request scope"); globalThis.__after.push(fn); };
    export const NextResponse = { json: (body, init = {}) => ({ status: init.status ?? 200, body, headers: init.headers ?? {} }) };`;
const STUBS = {
  "server-only": "export{}",
  "next/server": NEXT_SERVER,
  "next/server.js": NEXT_SERVER,
  "@/lib/admin/supabase-admin": "export const getAdminSupabase = () => globalThis.__admin ?? null;",
};
registerHooks({
  resolve(specifier, context, next) {
    if (STUBS[specifier] !== undefined) return js(STUBS[specifier]);
    if (specifier.startsWith("@/")) {
      const f = withExt(resolvePath(ROOT, "src", specifier.slice(2)));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.includes("/src/")) {
      const f = withExt(resolvePath(fileURLToPath(new URL(".", context.parentURL)), specifier));
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("file:") && /\/src\/.*\.tsx?$/.test(url)) {
      return { format: "module", source: transform(read(fileURLToPath(url)), { transforms: ["typescript", "jsx"], jsxRuntime: "automatic", production: true }).code, shortCircuit: true };
    }
    return next(url, context);
  },
});

const GEO = await import("../src/lib/geo/geocode.ts");
const CORE = await import("../src/lib/geo/geocode-core.ts");
const AUTO = await import("../src/lib/geo/geocode-auto.ts");
const CRON = await import("../src/app/api/cron/geocode/route.ts");
const MIG = read("supabase/migrations/20261115000000_location_geocode_automation.sql");

// ---------------------------------------------------------------- fake DB (mirrors locations_geocode_guard)

const key = (r) => [r.address, r.city, r.state, r.postal_code].map((v) => (v ?? "").trim()).filter(Boolean).join(", ").toLowerCase().replace(/\s+/g, " ") || null;
function trigger(op, old, row) {
  if (op === "insert") {
    if (row.latitude != null && row.longitude != null && row.geocode_status === "pending") Object.assign(row, { geocode_status: "resolved", geocode_source: row.geocode_source ?? "import" });
    return row;
  }
  if (row.geocode_status !== old.geocode_status) return row;
  const coords = row.latitude !== old.latitude || row.longitude !== old.longitude;
  if (coords) {
    if (row.latitude == null) Object.assign(row, { geocode_status: "pending", geocode_source: null, geocoded_at: null, geocode_attempts: 0, geocode_attempted_at: null });
    else Object.assign(row, { geocode_status: "manual", geocode_source: "manual", geocode_error: null });
  } else if (key(row) !== key(old)) {
    Object.assign(row, { latitude: null, longitude: null, geocode_status: "pending", geocode_source: null, geocoded_at: null, geocode_attempts: 0, geocode_error: null, geocode_attempted_at: null });
  }
  return row;
}
const TRIGGER_COLS = ["address", "city", "state", "postal_code", "latitude", "longitude", "geocode_status"];

function fakeDb() {
  const rows = [];
  const from = (table) => {
    assert.equal(table, "locations", "geocoding only ever touches locations");
    const st = { op: "select", filters: [], patch: null, head: false, limit: Infinity, order: null };
    const run = () => {
      const match = () => rows.filter((r) => st.filters.every((f) => f(r)));
      if (st.op === "update") {
        const hit = match();
        for (const r of hit) {
          const old = { ...r };
          const next = { ...r, ...st.patch };
          Object.assign(r, Object.keys(st.patch).some((k) => TRIGGER_COLS.includes(k)) ? trigger("update", old, next) : next);
        }
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      let out = match();
      if (st.order) out = [...out].sort((a, b) => ((a[st.order] ?? "") < (b[st.order] ?? "") ? -1 : 1));
      out = out.slice(0, st.limit);
      return st.head ? { count: out.length, error: null } : { data: out.map((r) => ({ ...r })), error: null };
    };
    const api = {
      select(_c, o) { if (o?.head) st.head = true; return api; },
      update(p) { st.op = "update"; st.patch = p; return api; },
      eq(c, v) { st.filters.push((r) => r[c] === v); return api; },
      is(c, v) { st.filters.push((r) => (r[c] ?? null) === v); return api; },
      in(c, v) { st.filters.push((r) => v.includes(r[c])); return api; },
      lt(c, v) { st.filters.push((r) => r[c] < v); return api; },
      order(c) { st.order = c; return api; },
      limit(n) { st.limit = n; return api; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return api;
  };
  const insert = (o) => {
    const row = trigger("insert", null, { id: o.id, archived_at: null, trashed_at: null, latitude: null, longitude: null, timezone: null, geocode_status: "pending", geocode_source: null, geocoded_at: null, geocode_attempts: 0, geocode_error: null, geocode_attempted_at: null, is_demo: true, ...o });
    rows.push(row);
    return row;
  };
  const byId = (id) => rows.find((r) => r.id === id);
  return { client: { from }, rows, insert, byId };
}

// Fake Geocodio: answers by query text; counts calls; optional delay.
function provider(answers, { delay = 0 } = {}) {
  const calls = [];
  return {
    calls,
    source: "geocodio",
    async geocode(text) {
      calls.push(text);
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const a = answers[text];
      if (a instanceof Error) throw a;
      return a ?? [];
    },
  };
}
const precise = (lat, lng, state = "NY") => [{ lat, lng, accuracy: 1, precision: "rooftop", state, timezone: "America/New_York" }];
const T0 = new Date("2026-10-26T15:00:00Z");
const mins = (n) => new Date(T0.getTime() + n * 60_000);

// Drive the write-path kick exactly as a Server Action would.
async function afterSave(ids, prov) {
  globalThis.__inRequest = true;
  globalThis.__after = [];
  AUTO.queueLocationGeocode(ids);
  globalThis.__inRequest = false;
  assert.equal(globalThis.__after.length, ids.filter(Boolean).length ? 1 : 0, "work is deferred until after the response");
  // The real callback calls drainGeocodeQueue with the real client; swap in
  // the fake provider by running the same drain the callback runs.
  for (const fn of globalThis.__after) await fn.call(null);
  return prov;
}

const ADDR = { address: "200 Fifth Ave", city: "New York", state: "NY", postal_code: "10010" };
const Q = "200 Fifth Ave, New York, NY 10010";

// ---------------------------------------------------------------- A / B / C / D / E

test("A. a new complete Location is placed automatically right after it's saved — no Admin step", async () => {
  const db = fakeDb();
  globalThis.__admin = db.client;
  const prov = provider({ [Q]: precise(40.7420, -73.9897) });
  // The kick uses the default provider; point the drain at the fake one.
  const real = GEO.geocodeProvider;
  db.insert({ id: "a", name: "Test Place", ...ADDR });
  assert.equal(db.byId("a").geocode_status, "pending", "saved normally, queued");
  globalThis.__inRequest = true;
  globalThis.__after = [];
  AUTO.queueLocationGeocode(["a", "a", null]);
  globalThis.__inRequest = false;
  assert.equal(globalThis.__after.length, 1, "one deferred job, deduplicated ids, creation not blocked");
  // Run the same drain the deferred job runs, with the fake provider.
  const s = await GEO.drainGeocodeQueue(db.client, { ids: ["a"], limit: 1, provider: prov, pauseMs: 0, now: T0 });
  assert.equal(s.resolved, 1);
  const a = db.byId("a");
  assert.deepEqual([a.latitude, a.longitude, a.timezone, a.geocode_status, a.geocode_source, a.geocode_attempts], [40.742, -73.9897, "America/New_York", "resolved", "geocodio", 1]);
  assert.equal(a.is_demo, true, "geocoding never makes an unlisted Location public");
  assert.equal(real, GEO.geocodeProvider);
});

test("A2. the deferred job itself runs the drain (and never throws into the request)", async () => {
  const db = fakeDb();
  globalThis.__admin = db.client;
  db.insert({ id: "k", name: "Kick", address: "", city: "New York", state: "NY" });
  await afterSave(["k"]);
  assert.equal(db.byId("k").geocode_status, "incomplete", "the real deferred callback drained it (no provider call needed)");
  globalThis.__admin = { from() { throw new Error("db down"); } };
  globalThis.__inRequest = true;
  globalThis.__after = [];
  AUTO.queueLocationGeocode(["x"]);
  globalThis.__inRequest = false;
  await assert.doesNotReject(globalThis.__after[0]());
  assert.doesNotThrow(() => AUTO.queueLocationGeocode(["y"]), "outside a request scope it quietly defers to the scheduled run");
});

test("B. an address change clears the old pin and the new address is placed automatically", async () => {
  const db = fakeDb();
  const prov = provider({ [Q]: precise(40.742, -73.9897), "1 Main St, Jersey City, NJ 07302": precise(40.7178, -74.0431, "NJ") });
  db.insert({ id: "b", name: "Mover", ...ADDR });
  await GEO.drainGeocodeQueue(db.client, { ids: ["b"], provider: prov, pauseMs: 0, now: T0 });
  assert.equal(db.byId("b").geocode_status, "resolved");
  // An ordinary save of the new address (Admin form re-posts the old coords unchanged).
  await db.client.from("locations").update({ address: "1 Main St", city: "Jersey City", state: "NJ", postal_code: "07302", latitude: 40.742, longitude: -73.9897 }).eq("id", "b");
  const cleared = db.byId("b");
  assert.deepEqual([cleared.latitude, cleared.longitude, cleared.geocode_status, cleared.geocode_attempts, cleared.geocode_attempted_at], [null, null, "pending", 0, null], "stale pin cleared, re-queued");
  await GEO.drainGeocodeQueue(db.client, { ids: ["b"], provider: prov, pauseMs: 0, now: mins(1) });
  assert.deepEqual([db.byId("b").latitude, db.byId("b").longitude, db.byId("b").geocode_status], [40.7178, -74.0431, "resolved"]);
});

test("B2. an address edited WHILE the provider is answering never receives the old pin", async () => {
  const db = fakeDb();
  db.insert({ id: "r", name: "Race", ...ADDR });
  const prov = {
    source: "geocodio",
    async geocode() {
      await db.client.from("locations").update({ address: "9 Other St" }).eq("id", "r");
      return precise(40.742, -73.9897);
    },
  };
  const s = await GEO.drainGeocodeQueue(db.client, { ids: ["r"], provider: prov, pauseMs: 0, now: T0 });
  assert.equal(s.resolved, 0);
  assert.equal(s.skipped, 1);
  const r = db.byId("r");
  assert.deepEqual([r.latitude, r.geocode_status, r.geocode_attempts, r.geocode_attempted_at], [null, "pending", 0, null], "re-queued for the NEW address, due immediately");
});

test("C. an ambiguous address lands in Needs A Choice with no guessed pin, and is never retried automatically", async () => {
  const db = fakeDb();
  db.insert({ id: "c", name: "Vague", ...ADDR });
  const prov = provider({ [Q]: [{ lat: 40.74, lng: -73.99, accuracy: 0.9, precision: "place", state: "NY" }] });
  await GEO.drainGeocodeQueue(db.client, { provider: prov, pauseMs: 0, now: T0 });
  assert.deepEqual([db.byId("c").geocode_status, db.byId("c").latitude], ["ambiguous", null]);
  for (const t of [mins(60), mins(60 * 48)]) await GEO.drainGeocodeQueue(db.client, { provider: prov, pauseMs: 0, now: t });
  assert.equal(prov.calls.length, 1, "no repeated provider calls for an ambiguous address");
});

test("D. an incomplete address lands in Incomplete Address with no provider call and no pin", async () => {
  const db = fakeDb();
  db.insert({ id: "d", name: "Park", address: "", city: "Jersey City", state: "NJ" });
  const prov = provider({});
  await GEO.drainGeocodeQueue(db.client, { provider: prov, pauseMs: 0, now: T0 });
  await GEO.drainGeocodeQueue(db.client, { provider: prov, pauseMs: 0, now: mins(60 * 48) });
  assert.deepEqual([db.byId("d").geocode_status, db.byId("d").latitude, prov.calls.length], ["incomplete", null, 0]);
  // Fixing the address re-queues it automatically (the trigger), no Admin step.
  await db.client.from("locations").update({ address: "9 McWilliams Pl", postal_code: "07302" }).eq("id", "d");
  assert.equal(db.byId("d").geocode_status, "pending");
});

test("E. Events / Appearances become map-usable through the Location — nothing is copied onto them", () => {
  const geocode = read("src/lib/geo/geocode.ts");
  for (const m of geocode.matchAll(/\.from\("([a-z_]+)"\)/g)) assert.equal(m[1], "locations");
  const server = read("src/lib/discovery/map-server.ts");
  assert.match(server, /location:locations!inner\(\$\{LOCATION_COLS\}\)/, "dated items read the canonical Location's coordinates");
  assert.match(server, /if \(!isValidCoordinate\(r\.latitude, r\.longitude\)\) return null;/, "unplaced Locations simply don't map yet");
  assert.doesNotMatch(MIG, /alter table public\.(events|appearances|event_occurrences|businesses)/);
});

// ---------------------------------------------------------------- retries / dedup

test("transient failures retry with growing gaps, then stop; a provider 'no match' is not retried", async () => {
  const db = fakeDb();
  db.insert({ id: "t", name: "Flaky", ...ADDR });
  const prov = provider({ [Q]: new Error("Geocodio 503") });
  const run = (m) => GEO.drainGeocodeQueue(db.client, { provider: prov, pauseMs: 0, now: mins(m) });
  await run(0);
  assert.deepEqual([db.byId("t").geocode_status, db.byId("t").geocode_attempts], ["failed", 1]);
  await run(5);
  assert.equal(prov.calls.length, 1, "inside the 15-minute backoff: no call");
  let t = 0;
  for (const gap of CORE.RETRY_BACKOFF_MINUTES) {
    t += gap;
    await run(t);
  }
  assert.equal(prov.calls.length, CORE.MAX_GEOCODE_ATTEMPTS, "bounded: exactly MAX attempts");
  await run(t + 60 * 24 * 30);
  assert.equal(prov.calls.length, CORE.MAX_GEOCODE_ATTEMPTS, "then it waits for Admin — no loop");

  const db2 = fakeDb();
  db2.insert({ id: "n", name: "Nowhere", ...ADDR });
  const none = provider({ [Q]: [] });
  await GEO.drainGeocodeQueue(db2.client, { provider: none, pauseMs: 0, now: T0 });
  assert.equal(db2.byId("n").geocode_status, "failed");
  assert.equal(db2.byId("n").geocode_attempts, CORE.MAX_GEOCODE_ATTEMPTS);
  assert.match(db2.byId("n").geocode_error, /not retried automatically/);
  await GEO.drainGeocodeQueue(db2.client, { provider: none, pauseMs: 0, now: mins(60 * 48) });
  assert.equal(none.calls.length, 1);
});

test("H. concurrent drains: one provider call per Location, no conflicting writes", async () => {
  const db = fakeDb();
  for (const id of ["p1", "p2", "p3"]) db.insert({ id, name: id, ...ADDR });
  const prov = provider({ [Q]: precise(40.742, -73.9897) }, { delay: 20 });
  const results = await Promise.all([1, 2, 3].map(() => GEO.drainGeocodeQueue(db.client, { provider: prov, pauseMs: 0, now: T0 })));
  assert.equal(prov.calls.length, 3, "each Location claimed once across three concurrent workers");
  assert.equal(results.reduce((n, s) => n + s.resolved, 0), 3);
  assert.ok(db.rows.every((r) => r.geocode_status === "resolved" && r.geocode_attempts === 1));
});

test("a claimed attempt that never finished (serverless cut-off) is picked up again only after the lease", async () => {
  const db = fakeDb();
  db.insert({ id: "z", name: "Cut", ...ADDR, geocode_attempts: 1, geocode_attempted_at: T0.toISOString() });
  const prov = provider({ [Q]: precise(40.742, -73.9897) });
  await GEO.drainGeocodeQueue(db.client, { provider: prov, pauseMs: 0, now: mins(5) });
  await GEO.runGeocodeBatch(db.client, { provider: prov, pauseMs: 0, now: mins(5) });
  assert.equal(prov.calls.length, 0, "not even Admin recovery bypasses an in-flight claim");
  await GEO.drainGeocodeQueue(db.client, { provider: prov, pauseMs: 0, now: mins(CORE.CLAIM_LEASE_MINUTES + 1) });
  assert.equal(db.byId("z").geocode_status, "resolved");
});

test("Admin Retry puts an exception back with a fresh budget; recovery batch skips backoff for failed ones", async () => {
  const db = fakeDb();
  db.insert({ id: "f", name: "F", ...ADDR, geocode_status: "failed", geocode_attempts: 2, geocode_attempted_at: T0.toISOString(), geocode_error: "Geocodio 503" });
  const prov = provider({ [Q]: precise(40.742, -73.9897) });
  await GEO.drainGeocodeQueue(db.client, { provider: prov, pauseMs: 0, now: mins(1) });
  assert.equal(prov.calls.length, 0, "automatic run respects backoff");
  await GEO.runGeocodeBatch(db.client, { provider: prov, pauseMs: 0, now: mins(1) });
  assert.equal(db.byId("f").geocode_status, "resolved");
  db.insert({ id: "amb", name: "Amb", ...ADDR, geocode_status: "ambiguous", geocode_attempts: 1, geocode_error: "x" });
  await GEO.requeueLocation(db.client, "amb");
  assert.deepEqual([db.byId("amb").geocode_status, db.byId("amb").geocode_attempts, db.byId("amb").geocode_attempted_at], ["pending", 0, null]);
});

test("isDue: only pending/failed under the cap; ambiguous/incomplete/resolved never", () => {
  const due = (o, m = 0) => CORE.isDue({ geocode_attempts: 0, geocode_attempted_at: null, ...o }, mins(m));
  assert.equal(due({ geocode_status: "pending" }), true);
  for (const s of ["ambiguous", "incomplete", "resolved", "manual"]) assert.equal(due({ geocode_status: s }), false, s);
  assert.equal(due({ geocode_status: "failed", geocode_attempts: 1, geocode_attempted_at: T0.toISOString() }, 14), false);
  assert.equal(due({ geocode_status: "failed", geocode_attempts: 1, geocode_attempted_at: T0.toISOString() }, 15), true);
  assert.equal(due({ geocode_status: "failed", geocode_attempts: 5 }), false);
});

// ---------------------------------------------------------------- cron, privacy of requests, key safety

test("cron safety net: fails closed without CRON_SECRET; drains one bounded batch when authorized", async () => {
  const db = fakeDb();
  db.insert({ id: "cr", name: "Cron", address: "", city: "X", state: "NY" });
  globalThis.__admin = db.client;
  const req = (auth) => ({ headers: { get: (k) => (k === "authorization" ? auth : null) } });
  delete process.env.CRON_SECRET;
  assert.equal((await CRON.GET(req("Bearer "))).status, 401, "no secret configured → refuses");
  process.env.CRON_SECRET = "s3cret";
  assert.equal((await CRON.GET(req("Bearer wrong"))).status, 401);
  assert.equal((await CRON.GET(req(null))).status, 401);
  const ok = await CRON.GET(req("Bearer s3cret"));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.incomplete, 1);
  assert.doesNotMatch(JSON.stringify(ok.body), /s3cret|api_key|address/i, "counts only");
  const vercel = JSON.parse(read("vercel.json"));
  assert.deepEqual(vercel.crons.map((c) => c.path), ["/api/cron/geocode"]);
  delete process.env.CRON_SECRET;
});

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

test("F. no public page or public API request can trigger geocoding", () => {
  const allowed = new Set([
    "src/lib/geo/geocode.ts",
    "src/lib/geo/geocode-auto.ts",
    "src/app/api/cron/geocode/route.ts",
    "src/app/admin/(protected)/locations/geocode/actions.ts",
    "src/app/admin/(protected)/locations/actions.ts",
    "src/app/(public)/account/location/actions.ts",
    "src/lib/places/inline-place.ts",
  ]);
  const users = walk("src").filter((f) => /from "(@\/lib\/geo\/geocode(-auto)?|\.\/geocode)"/.test(read(f)));
  assert.deepEqual(users.filter((f) => !allowed.has(f)), [], "only write actions, Admin and the cron use the geocoder");
  for (const f of users.filter((f) => f.startsWith("src/app/(public)"))) assert.match(read(f), /^"use server";/, `${f} is a Server Action, not a page`);
  for (const f of ["src/app/(public)/map/page.tsx", "src/app/api/discovery/map/route.ts", "src/lib/discovery/map-server.ts"]) assert.doesNotMatch(read(f), /geocode-auto|lib\/geo\/geocode"/);
});

test("G. the Geocodio key stays server-side and never reaches stored errors or logs", () => {
  const refs = walk("src").filter((f) => read(f).includes("GEOCODIO_API_KEY"));
  for (const f of refs) {
    const src = read(f);
    assert.doesNotMatch(src, /^"use client"/, f);
    assert.doesNotMatch(src, /NEXT_PUBLIC_GEOCODIO/, f);
  }
  assert.ok(refs.includes("src/lib/geo/geocode.ts"));
  assert.match(read("src/lib/geo/geocode.ts"), /^import "server-only";/);
  assert.equal(GEO.safeError(new Error("request to https://api.geocod.io/v1.7/geocode?q=x&api_key=ABC123secret failed")), "request to https://api.geocod.io/v1.7/geocode?q=x&api_key=[redacted] failed");
  assert.doesNotMatch(read("src/lib/geo/geocode-auto.ts") + read("src/app/api/cron/geocode/route.ts"), /console\.\w+\([^)]*(url|key|address)/i);
});

test("migration: additive; the trigger clears the new attempt time whenever it re-queues", () => {
  assert.match(MIG, /alter table public\.locations add column if not exists geocode_attempted_at timestamptz;/);
  assert.equal((MIG.match(/new\.geocode_attempted_at := null;/g) ?? []).length, 2);
  const sql = MIG.replace(/--[^\n]*\n/g, "\n");
  assert.doesNotMatch(sql, /\b(drop table|drop column|delete from|truncate|create policy|alter policy|grant |revoke |update public\.)/i);
  // Everything else in the function is the already-applied V1 trigger body.
  const v1 = read("supabase/migrations/20261114000000_discovery_engine_map_v1.sql");
  const body = (s) => s.slice(s.indexOf("create or replace function public.locations_geocode_guard()"), s.indexOf("$$;", s.indexOf("create or replace function public.locations_geocode_guard()"))).replace(/\s*new\.geocode_attempted_at := null;/g, "").replace(/--[^\n]*\n/g, "").replace(/\s+/g, " ");
  assert.equal(body(MIG), body(v1));
});
