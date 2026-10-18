// Shared Event filter foundation — the one Event filter contract
// (lib/event-filter.ts), its URL state, and its semantics inside the ONE
// shared query (getEventsDiscovery / getEffectiveUpcomingEvents), run
// against an in-memory Supabase double. No network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "./supabase" && context.parentURL?.endsWith("/src/lib/data.ts")) {
      return { url: "data:text/javascript,export const getSupabase=()=>globalThis.__fakeSupabase??null;", shortCircuit: true };
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

const F = await import("../src/lib/event-filter.ts");
const FMT = await import("../src/lib/format.ts");
const D = await import("../src/lib/data.ts");
const { orPredicate, withDates } = await import("./helpers/postgrest-or.mjs");
const read = (p) => readFileSync(p, "utf8");

// ── In-memory Supabase double (eq / in / lt / gt / order / limit) ─────────
function fakeSupabase(tables) {
  const from = (table) => {
    const filters = [];
    let limitN = null;
    const rows = () => {
      // Rows carry the calendar dates the database derives (withDates), and
      // `.or(...)` windows are evaluated like PostgREST (helpers/postgrest-or).
      let out = (tables[table] ?? []).map(withDates).filter((r) =>
        filters.every(([op, k, v]) => {
          const x = r[k];
          if (op === "eq") return x === v;
          if (op === "in") return v.includes(x);
          if (op === "lt") return x < v;
          if (op === "gt") return x > v;
          if (op === "or") return orPredicate(k)(r);
          return true;
        })
      );
      if (limitN !== null) out = out.slice(0, limitN);
      return out;
    };
    const api = {
      select: () => api,
      eq: (k, v) => (filters.push(["eq", k, v]), api),
      in: (k, v) => (filters.push(["in", k, v]), api),
      lt: (k, v) => (filters.push(["lt", k, v]), api),
      gt: (k, v) => (filters.push(["gt", k, v]), api),
      or: (expr) => (filters.push(["or", expr]), api), ilike: () => api, neq: () => api, is: () => api, not: () => api,
      order: (k) => (filters.push(["order", k]), api),
      limit: (n) => ((limitN = n), api),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve) => {
        const out = rows();
        const orders = filters.filter((f) => f[0] === "order").map((f) => f[1]);
        if (orders.length) {
          out.sort((a, b) => {
            for (const k of orders) {
              const x = a[k] ?? null;
              const y = b[k] ?? null;
              if (x === y) continue;
              if (x === null) return 1;
              if (y === null) return -1;
              return x < y ? -1 : 1;
            }
            return 0;
          });
        }
        return resolve({ data: out, error: null });
      },
    };
    return api;
  };
  return { from };
}

const H = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();
const NOW = Date.now();
const mid = (b) => (b.start.getTime() + b.end.getTime()) / 2;
const tomorrow = FMT.getDiscoveryWindowBounds("tomorrow");
const weekend = FMT.getDiscoveryWindowBounds("weekend");
const LOC_A = "11111111-1111-4111-8111-11111111111a";
const LOC_B = "11111111-1111-4111-8111-11111111111b";
const BIZ = "22222222-2222-4222-8222-222222222222";

const ev = (id, over = {}) => ({
  id, slug: id, name: id, description: null, is_demo: false, start_at: iso(NOW + 10 * 24 * H), end_at: iso(NOW + 10 * 24 * H + H),
  venue_name: null, city: null, state: null, market_id: null, market_area_id: null, host_business_id: null,
  rsvp_enabled: false, rsvp_url: null, tickets_enabled: false, tickets_url: null, location_visibility: null, is_featured: false, ...over,
});
const occ = (id, event_id, start, end, over = {}) => ({ id, event_id, start_at: iso(start), end_at: iso(end), status: "scheduled", location_id: null, market_id: null, featured: false, ...over });

function world() {
  return {
    events: [
      ev("live-rsvp", { rsvp_enabled: true, rsvp_url: "https://luma.com/x" }),
      ev("tomorrow-tix", { tickets_enabled: true, tickets_url: "https://tix.example/t" }),
      ev("weekend-plain"),
      ev("rsvp-flag-no-url", { rsvp_enabled: true, rsvp_url: null }),
      ev("hosted-legacy", { host_business_id: BIZ, start_at: iso(NOW + 20 * 24 * H), end_at: iso(NOW + 20 * 24 * H + H) }),
      ev("hidden-at-a", { location_visibility: "hidden" }),
      ev("selected-dates"),
      ev("demo", { is_demo: true }),
    ],
    event_occurrences: [
      occ("o-live", "live-rsvp", NOW - H, NOW + H, { location_id: LOC_A }),
      occ("o-tom", "tomorrow-tix", mid(tomorrow) - H, mid(tomorrow) + H, { location_id: LOC_B }),
      occ("o-wknd", "weekend-plain", mid(weekend) - H, mid(weekend) + H),
      occ("o-flag", "rsvp-flag-no-url", NOW + 30 * 24 * H, NOW + 30 * 24 * H + H),
      occ("o-hidden", "hidden-at-a", NOW + 5 * 24 * H, NOW + 5 * 24 * H + H, { location_id: LOC_A }),
      occ("o-sel-1", "selected-dates", NOW + 3 * 24 * H, NOW + 3 * 24 * H + H),
      occ("o-sel-2", "selected-dates", NOW + 4 * 24 * H, NOW + 4 * 24 * H + H),
      occ("o-demo", "demo", NOW - H, NOW + H),
    ],
    locations: [{ id: LOC_A, market_id: null }, { id: LOC_B, market_id: null }],
    event_businesses: [
      { event_id: "tomorrow-tix", business_id: BIZ, status: "approved", participation_scope: "all_dates" },
      { event_id: "weekend-plain", business_id: BIZ, status: "pending", participation_scope: "all_dates" },
      { event_id: "selected-dates", business_id: BIZ, status: "approved", participation_scope: "selected_dates" },
    ],
    event_occurrence_businesses: [{ occurrence_id: "o-sel-2", business_id: BIZ, status: "approved" }],
    categories: [
      { id: "c-food", slug: "food-drink", kind: "event", parent_id: null },
      { id: "c-coffee", slug: "coffee-tea", kind: "event", parent_id: "c-food" },
    ],
    event_categories: [
      { event_id: "weekend-plain", category_id: "c-food" },
      { event_id: "tomorrow-tix", category_id: "c-coffee" },
    ],
  };
}
async function discover(filter, page = {}) {
  globalThis.__fakeSupabase = fakeSupabase(world());
  const rows = await D.getEventsDiscovery(F.eventDiscoveryParams(filter, page));
  return rows.map((r) => r.id);
}

// ── CONTRACT + URL ────────────────────────────────────────────────────────

test("parse: the existing params, plus access; defaults omitted", () => {
  const p = new URLSearchParams("when=weekend&q=%20jazz%20%20night%20&category=coffee-tea&location=Brooklyn&market=nyc&area=williamsburg&access=tickets&access=rsvp&date=2026-10-31");
  assert.deepEqual(F.parseEventFilter(p), {
    when: "weekend", date: "2026-10-31", market: "nyc", area: "williamsburg", location: "Brooklyn", category: "coffee-tea", access: ["rsvp", "tickets"], q: "jazz night",
  });
  assert.deepEqual(F.parseEventFilter(new URLSearchParams("")), {});
  assert.deepEqual(F.parseEventFilter({ when: "next" }), {}, "Up Next is the default");
  // A Next.js searchParams object works the same as URLSearchParams.
  assert.deepEqual(F.parseEventFilter({ when: "live", access: ["tickets", "rsvp,tickets"] }), { when: "live", access: ["rsvp", "tickets"] });
});

test("parse: malformed / unknown values are dropped safely; duplicates normalized", () => {
  const f = F.parseEventFilter(
    new URLSearchParams("when=yesterday&date=2026-02-30&category=Coffee%20Tea!&market=NYC&area=x&access=walk-in&access=RSVP&access=rsvp&q=&location=%20%20")
  );
  assert.deepEqual(f, { market: "nyc", area: "x", access: ["rsvp"] });
  assert.equal(F.parseEventFilter({ area: "williamsburg" }).area, undefined, "an Area without a Market is meaningless");
  assert.equal(F.parseEventFilter({ date: "10/31/2026" }).date, undefined);
  assert.equal(F.parseEventFilter({ date: "2026-13-01" }).date, undefined);
  assert.equal(F.parseEventFilter({ q: "x".repeat(500) }).q.length, 120);
  assert.equal(F.parseEventFilter({ when: "WEEKEND" }).when, "weekend");
  // Scoping is programmatic only — never read from a URL.
  assert.deepEqual(F.parseEventFilter({ locationId: LOC_A, businessId: BIZ }), {});
});

test("serialize: stable order, defaults omitted, round-trips, scoping never written", () => {
  const filter = { when: "tomorrow", category: "food-drink", market: "nyc", area: "williamsburg", access: ["tickets", "rsvp", "tickets"], q: "jazz", locationId: LOC_A, businessId: BIZ };
  const p = F.eventFilterToSearchParams(filter);
  assert.equal(p.toString(), "q=jazz&when=tomorrow&category=food-drink&market=nyc&area=williamsburg&access=rsvp&access=tickets");
  assert.deepEqual(F.parseEventFilter(p), { when: "tomorrow", category: "food-drink", market: "nyc", area: "williamsburg", access: ["rsvp", "tickets"], q: "jazz" });
  assert.equal(F.eventFilterToSearchParams({ when: "next" }).toString(), "");
  assert.equal(F.eventFilterToSearchParams({ area: "williamsburg" }).toString(), "", "no Area without a Market");
});

test("backward compatible /events URLs map to the same getEventsDiscovery parameters as before", () => {
  // Before: when=WINDOW_BY_TIME_KEY[key], categorySlug, location, marketSlug, areaSlug only with market.
  for (const [key, window] of Object.entries(FMT.WINDOW_BY_TIME_KEY)) {
    assert.equal(F.eventDiscoveryParams(F.parseEventFilter({ when: key })).when, window, key);
  }
  assert.deepEqual(F.eventDiscoveryParams(F.parseEventFilter({ q: "jazz", category: "food-drink", location: "Brooklyn", market: "nyc", area: "wb" }), { limit: 25, featuredFirst: true }), {
    when: "anytime", q: "jazz", categorySlug: "food-drink", location: "Brooklyn", marketSlug: "nyc", areaSlug: "wb", limit: 25, featuredFirst: true,
  });
  // The homepage's own shared tabs are unchanged.
  assert.deepEqual(FMT.DISCOVERY_TIME_TABS.map((t) => t.key), ["next", "today", "week", "weekend", "all"]);
});

// ── TIME ──────────────────────────────────────────────────────────────────

test("time windows: Happening Now is getTemporalLabel().live; Tomorrow is the next local day; one time system", () => {
  const live = FMT.getDiscoveryWindowBounds("live");
  // The shared overlap test (start < end-bound AND end > start-bound) on
  // [now-1ms, now+1ms] is exactly start <= now <= end.
  const overlaps = (s, e) => s < live.end.getTime() && e > live.start.getTime();
  const now = (live.start.getTime() + live.end.getTime()) / 2;
  for (const [s, e] of [[now - H, now + H], [now, now + H], [now - H, now], [now + 1, now + H], [now - H, now - 1]]) {
    assert.equal(overlaps(s, e), s <= now && now <= e, `${s - now}..${e - now}`);
  }
  // …which is getTemporalLabel()'s live rule, used verbatim for the final check.
  const t = Date.now();
  for (const [s, e] of [[t - H, t + H], [t + H, t + 2 * H], [t - 2 * H, t - H]]) {
    assert.equal(F.isEventHappeningNow(iso(s), iso(e)), FMT.getTemporalLabel(iso(s), iso(e)).live);
  }
  assert.equal(F.isEventHappeningNow(iso(t - H), iso(t + H)), true);
  assert.equal(F.isEventHappeningNow(iso(t + H), iso(t + 2 * H)), false);
  const today = FMT.getDiscoveryWindowBounds("now");
  // (getLocalDayBounds' bounds carry a few ms of clock jitter between calls.)
  assert.ok(Math.abs(tomorrow.start.getTime() - today.end.getTime()) < 1000, "tomorrow starts where today ends");
  assert.ok(tomorrow.end.getTime() - tomorrow.start.getTime() >= 23 * H && tomorrow.end.getTime() - tomorrow.start.getTime() <= 25 * H);
  assert.equal(F.EVENT_WINDOW_BY_TIME_KEY.today, "now");
  assert.equal(F.EVENT_WINDOW_BY_TIME_KEY.week, "week");
  assert.equal(F.EVENT_WINDOW_BY_TIME_KEY.weekend, "weekend");
  assert.deepEqual([...F.EVENT_TIME_KEYS], ["next", "live", "today", "tomorrow", "week", "weekend", "all"]);
});

test("shared query: Happening Now, Today, Tomorrow, This Week, This Weekend select by date overlap", async () => {
  assert.deepEqual(await discover({ when: "live" }), ["live-rsvp"], "only the Event live right now (demo excluded)");
  assert.ok((await discover({ when: "today" })).includes("live-rsvp"));
  assert.ok(!(await discover({ when: "today" })).includes("tomorrow-tix"));
  assert.deepEqual(await discover({ when: "tomorrow" }), ["tomorrow-tix"]);
  assert.ok((await discover({ when: "weekend" })).includes("weekend-plain"));
  const week = await discover({ when: "week" });
  assert.ok(week.includes("live-rsvp"));
  const all = await discover({});
  assert.ok(["live-rsvp", "tomorrow-tix", "weekend-plain", "hosted-legacy", "selected-dates"].every((id) => all.includes(id)));
  assert.ok(!all.includes("demo"));
  // An exact date overrides the time key (the live check is the "when" key's).
  const d = new Date(mid(tomorrow));
  const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  assert.deepEqual(await discover({ when: "live", date: dateStr }), ["tomorrow-tix"]);
});

// ── ACCESS ────────────────────────────────────────────────────────────────

test("access: RSVP / Register and Tickets come from the Event's own action fields; ANY of; no Walk-In", async () => {
  assert.deepEqual(await discover({ access: ["rsvp"] }), ["live-rsvp"], "rsvp_enabled AND a link (a flag without a link doesn't count)");
  assert.deepEqual(await discover({ access: ["tickets"] }), ["tomorrow-tix"]);
  assert.deepEqual(await discover({ access: ["rsvp", "tickets"] }), ["live-rsvp", "tomorrow-tix"]);
  assert.deepEqual(await discover({ when: "tomorrow", access: ["rsvp"] }), [], "dimensions intersect");
  assert.equal(F.eventOffersAccess({ rsvp_enabled: true, rsvp_url: "  " }, "rsvp"), false);
  assert.deepEqual(F.parseEventAccess(["walk-in", "free"]), [], "no Walk-In / cost filter exists");
  assert.deepEqual([...F.EVENT_ACCESS_KINDS], ["rsvp", "tickets"]);
});

// ── CATEGORY ──────────────────────────────────────────────────────────────

test("category: a top-level category includes its subcategories; a subcategory stays specific", async () => {
  assert.deepEqual((await discover({ category: "food-drink" })).sort(), ["tomorrow-tix", "weekend-plain"]);
  assert.deepEqual(await discover({ category: "coffee-tea" }), ["tomorrow-tix"]);
  assert.deepEqual(await discover({ category: "unknown-slug" }), []);
  assert.deepEqual(await discover({ category: "food-drink", access: ["tickets"] }), ["tomorrow-tix"]);
});

// ── SCOPING ───────────────────────────────────────────────────────────────

test("locationId: Events with a date at exactly that Location; hidden-location Events never revealed", async () => {
  assert.deepEqual(await discover({ locationId: LOC_A }), ["live-rsvp"], "hidden-at-a is at LOC_A but hides its address");
  assert.deepEqual(await discover({ locationId: LOC_B }), ["tomorrow-tix"]);
  assert.deepEqual(await discover({ locationId: LOC_A, when: "tomorrow" }), []);
  // Unscoped, the hidden Event is still listed (its venue withheld) — unchanged.
  assert.ok((await discover({})).includes("hidden-at-a"));
});

test("businessId: hosted + approved all-dates Events, and only the approved dates of a selected-dates Event", async () => {
  globalThis.__fakeSupabase = fakeSupabase(world());
  const rows = await D.getEventsDiscovery(F.eventDiscoveryParams({ businessId: BIZ }));
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(Object.keys(byId).sort(), ["hosted-legacy", "selected-dates", "tomorrow-tix"], "pending participation and unrelated Events excluded");
  // selected_dates: shown by the date the Business is approved for (o-sel-2), not the earlier o-sel-1.
  assert.equal(byId["selected-dates"].start_at, world().event_occurrences.find((o) => o.id === "o-sel-2").start_at);
  assert.deepEqual(await discover({ businessId: "33333333-3333-4333-8333-333333333333" }), [], "no relationships → nothing");
});

// ── CALLERS + SURFACES ────────────────────────────────────────────────────

test("existing getEventsDiscovery callers keep their parameters; /events reads/writes the shared contract", () => {
  assert.match(read("src/app/(public)/discover/page.tsx"), /getEventsDiscovery\(\{ when: toDiscoveryWindow\(whenKey\), marketSlug, areaSlug, canonicalGeo, limit: 8, featuredFirst: true \}\)/);
  assert.match(read("src/app/api/homepage-search/route.ts"), /getEventsDiscovery\(\{ q, limit: 4, marketSlug \}\)/);
  const data = read("src/lib/data.ts");
  for (const k of ["q?: string;", "when?: DiscoveryWindow;", "date?: string;", "categorySlug?: string;", "city?: string;", "location?: string;", "featuredFirst?: boolean;", "marketSlug?: string;", "areaSlug?: string;", "access?: EventAccess[];", "locationId?: string;", "businessId?: string;"]) {
    assert.ok(data.slice(data.indexOf("export interface EventDiscoveryParams")).includes(k), k);
  }
  const page = read("src/app/(public)/events/page.tsx");
  assert.match(page, /const filter: EventFilter = parseEventFilter\(/);
  assert.match(page, /getEventsDiscovery\(\{ \.\.\.eventDiscoveryParams\(filter, \{ limit: limit \+ 1, featuredFirst: true \}\), canonicalGeo \}\)/);
  assert.match(page, /const baseParams = eventFilterToSearchParams\(filter\);/);
  assert.match(page, /const TIME_TABS = EVENT_TIME_KEYS\.map/);
  assert.match(read("src/components/discover/EventFilters.tsx"), /name="access" value=\{kind\}/);
  // Location and Brand surfaces keep their own (different) semantics this phase.
  assert.doesNotMatch(read("src/app/(public)/location/[slug]/LocationPublicView.tsx"), /getEventsDiscovery/);
});
