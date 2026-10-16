// Event Import V1 — one engine, Business entry contexts (participating /
// hosting), deterministic-first extraction, conservative matching, review
// before any write, and persistence through the existing domain paths.
// Fixture HTML + fake clients only: no network, no database.
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

const X = await import("../src/lib/event-import/extract.ts");
const AI = await import("../src/lib/event-import/ai.ts");
const E = await import("../src/lib/event-import/engine.ts");
const P = await import("../src/lib/event-import/persist.ts");
const R = await import("../src/lib/event-import/review.ts");
const SF = await import("../src/lib/safe-fetch.ts");
const read = (p) => readFileSync(p, "utf8");

const FUTURE = new Date(Date.now() + 30 * 24 * 3600e3);
const ymd = (d) => d.toISOString().slice(0, 10);
const DAY1 = ymd(FUTURE);
const DAY2 = ymd(new Date(FUTURE.getTime() + 7 * 24 * 3600e3));

const page = (jsonld, head = "", body = "") =>
  `<!doctype html><html><head><title>Page</title>${head}${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ""}</head><body>${body}</body></html>`;

const FESTIVAL = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", name: "Eventbrite" },
    {
      "@type": "FoodEvent",
      name: "NYC Coffee Festival",
      description: "<p>Tastings &amp; <b>talks</b> from 60 roasters.</p>",
      startDate: `${DAY1}T10:00:00-04:00`,
      endDate: `${DAY1}T18:00:00-04:00`,
      image: ["https://img.example-cdn.com/fest.jpg"],
      url: "https://www.eventbrite.com/e/nyc-coffee-festival-123",
      location: {
        "@type": "Place",
        name: "Metropolitan Pavilion",
        address: { "@type": "PostalAddress", streetAddress: "125 W 18th St", addressLocality: "New York", addressRegion: "NY", postalCode: "10011" },
      },
      organizer: { "@type": "Organization", name: "Specialty Coffee NYC" },
    },
  ],
};

// ── extraction ──────────────────────────────────────────────────────────
test("deterministic structured-data extraction (schema.org Event JSON-LD, @graph, Place/PostalAddress, organizer)", () => {
  const { candidate } = X.extractEventCandidate(page(FESTIVAL, '<meta property="og:site_name" content="Eventbrite">'), new URL("https://www.eventbrite.com/e/nyc-coffee-festival-123?aff=x"));
  assert.equal(candidate.title, "NYC Coffee Festival");
  assert.equal(candidate.description, "Tastings & talks from 60 roasters.");
  assert.equal(candidate.imageUrl, "https://img.example-cdn.com/fest.jpg");
  assert.equal(candidate.platform, "Eventbrite");
  assert.equal(candidate.sourceUrl, "https://www.eventbrite.com/e/nyc-coffee-festival-123");
  assert.deepEqual(candidate.occurrences.map(({ start, end, hasTime }) => ({ start, end, hasTime })), [{ start: new Date(`${DAY1}T14:00:00Z`).toISOString(), end: new Date(`${DAY1}T22:00:00Z`).toISOString(), hasTime: true }]);
  assert.deepEqual(candidate.occurrences[0].venue, { name: "Metropolitan Pavilion", address: "125 W 18th St", city: "New York", state: "NY", postalCode: "10011" });
  assert.equal(candidate.organizer, "Specialty Coffee NYC");
  assert.equal(candidate.sources.title, "structured");
  assert.equal(X.needsAiAssist(candidate), false, "complete → no AI call");
});

test("multiple dates: subEvent and same-name sibling Event nodes become one candidate with several dates", () => {
  const series = { "@type": "EventSeries", name: "Tabli Resident Demo", subEvent: [
    { "@type": "Event", startDate: `${DAY2}T15:00:00Z`, endDate: `${DAY2}T17:00:00Z` },
    { "@type": "Event", startDate: `${DAY1}T15:00:00Z`, endDate: `${DAY1}T17:00:00Z` },
  ] };
  const { candidate } = X.extractEventCandidate(page(series), new URL("https://lu.ma/tabli"));
  assert.equal(candidate.platform, "Luma");
  assert.deepEqual(candidate.occurrences.map((d) => d.start), [`${DAY1}T15:00:00.000Z`, `${DAY2}T15:00:00.000Z`], "chronological");
});

test("missing optional fields stay unknown; date-only keeps no time; Open Graph fills title/image", () => {
  const thin = { "@type": "Event", name: "Pop-Up Market", startDate: DAY1 };
  const { candidate } = X.extractEventCandidate(page(thin, '<meta property="og:image" content="https://img.site.com/a.jpg">'), new URL("https://organizer.com/market"));
  assert.equal(candidate.title, "Pop-Up Market");
  assert.deepEqual(candidate.occurrences.map(({ start, end, hasTime }) => ({ start, end, hasTime })), [{ start: DAY1, end: null, hasTime: false }]);
  assert.deepEqual(candidate.occurrences[0].venue, { name: null, address: null, city: null, state: null, postalCode: null });
  assert.equal(candidate.organizer, null);
  assert.equal(candidate.imageUrl, "https://img.site.com/a.jpg");
  assert.equal(X.needsAiAssist(candidate), true);
  const og = X.extractEventCandidate(page(null, '<meta property="og:title" content="Summer Night Market | Partiful"><meta property="og:site_name" content="Partiful"><meta property="event:start_time" content="' + DAY1 + 'T19:00:00-04:00">'), new URL("https://partiful.com/e/1"));
  assert.equal(og.candidate.title, "Summer Night Market", "site suffix removed");
  assert.equal(og.candidate.sources.dates, "page");
});

test("date normalization never guesses: bad values are dropped, bare local times are read as Eastern and flagged", () => {
  assert.equal(X.normalizeDateValue("next Saturday"), null);
  assert.equal(X.normalizeDateValue("2026-13-45"), null);
  const local = X.normalizeDateValue(`${DAY1}T10:00`);
  assert.equal(local.assumedZone, true);
  const r = X.extractEventCandidate(page({ "@type": "Event", name: "X Fest", startDate: `${DAY1}T10:00`, location: "Pier 17" }), new URL("https://x.com/e"));
  assert.equal(r.assumedZone, true);
  assert.equal(r.candidate.occurrences[0].venue.name, "Pier 17");
});

test("non-https / script image and source values are never accepted", () => {
  const { candidate } = X.extractEventCandidate(page({ "@type": "Event", name: "Y", startDate: DAY1, image: "javascript:alert(1)", url: "http://evil.com" }), new URL("https://y.com/e"));
  assert.equal(candidate.imageUrl, null);
  assert.equal(candidate.sourceUrl, "https://y.com/e");
});

// ── AI fill-in (only missing fields, only evidenced values) ─────────────
const NATURAL1 = FUTURE.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

test("AI output is sanitized against the page text; hallucinated values are dropped", () => {
  const text = `Brooklyn Holiday Market at Industry City, 220 36th St, Brooklyn NY 11232\n${NATURAL1}, 11am–6pm – Industry City`;
  const out = AI.sanitizeEventAiOutput(
    {
      title: "Brooklyn Holiday Market",
      schedule: [
        { evidence: `${NATURAL1}, 11am–6pm – Industry City`, date: DAY1, start_time: "11:00", end_time: "18:00", venue_name: "Industry City", street_address: null },
        { evidence: "Dec 31, 9pm – Barclays Center", date: "2026-12-31", start_time: "21:00", end_time: null, venue_name: "Barclays Center", street_address: null },
      ],
      venue_name: "Barclays Center",
      street_address: "220 36th St",
      city: "Brooklyn",
      state: "New York",
      postal_code: "11232",
      organizer: "Invented Org",
      organizer_evidence: null,
    },
    text,
    { now: Date.now(), yearHint: null }
  );
  assert.equal(out.title, "Brooklyn Holiday Market");
  assert.equal(out.occurrences.length, 1, "an entry quoting a line that isn't on the page is dropped");
  assert.equal(out.occurrences[0].venue.name, "Industry City");
  assert.equal(out.venue.name, null, "not on the page");
  assert.equal(out.venue.address, "220 36th St");
  assert.equal(out.venue.state, "NY");
  assert.equal(out.organizer, null);
});

test("AI fills only what is missing, and is skipped entirely when structured data is complete", async () => {
  let calls = 0;
  const line = `${NATURAL1}, 7pm – Hall A`;
  const client = { messages: { parse: async () => { calls++; return { stop_reason: "end_turn", parsed_output: { title: "Other Title", schedule: [{ evidence: line, date: DAY1, start_time: "19:00", end_time: null, venue_name: "Hall A", street_address: null }], venue_name: null, street_address: null, city: null, state: null, postal_code: null, organizer: null, organizer_evidence: null } }; } } };
  const thin = X.extractEventCandidate(page({ "@type": "Event", name: "Known Title" }, "", "<h1>Known Title</h1>"), new URL("https://a.com/e"));
  const r = await AI.assistWithAi(thin.candidate, `${thin.excerpt}\n${line}`, client);
  assert.equal(calls, 1);
  assert.equal(r.candidate.title, "Known Title", "existing value never overwritten");
  assert.equal(r.candidate.sources.dates, "ai");
  assert.equal(r.candidate.occurrences[0].venue.name, "Hall A");
  const none = await AI.assistWithAi(thin.candidate, thin.excerpt, null);
  assert.equal(none.called, false, "no API key → no call, candidate unchanged");
});

// ── URL safety ──────────────────────────────────────────────────────────
test("invalid and unsafe URLs are rejected before any network use", () => {
  assert.deepEqual(E.normalizeImportUrl("not a url at all"), { ok: false, code: "invalid_url" });
  assert.equal(E.normalizeImportUrl("javascript:alert(1)").code, "blocked_url");
  assert.equal(E.normalizeImportUrl("ftp://files.com/e").code, "blocked_url");
  assert.equal(E.normalizeImportUrl("file:///etc/passwd").code, "blocked_url");
  for (const bad of ["https://localhost/e", "https://10.0.0.1/e", "https://169.254.169.254/latest", "https://user:pw@site.com/e", "https://intranet/e", "https://site.com:8443/e"]) {
    assert.equal(E.normalizeImportUrl(bad).ok, false, bad);
  }
  const ok = E.normalizeImportUrl("www.eventbrite.com/e/nyc-coffee-123");
  assert.equal(ok.ok, true);
  assert.equal(ok.url.protocol, "https:");
  assert.equal(E.normalizeImportUrl("http://lu.ma/x").url.protocol, "https:", "upgraded to https");
});

test("event pages on shared platforms are allowed for Event Import only; Brand rules unchanged", () => {
  assert.equal(SF.validateFetchUrl("https://www.eventbrite.com/e/1").ok, false, "brand profile still refuses shared platforms");
  assert.equal(SF.validateFetchUrl("https://www.eventbrite.com/e/1", { allowSharedPlatforms: true }).ok, true);
  assert.equal(SF.validateFetchUrl("https://127.0.0.1/e", { allowSharedPlatforms: true }).ok, false, "safety rules still apply");
  const src = read("src/lib/safe-fetch.ts");
  assert.match(src, /const EVENT_HTML_PROFILE: FetchProfile = \{ \.\.\.HTML_PROFILE, maxBytes: SAFE_FETCH_EVENT_MAX_BYTES, headStop: \{ bodyBytes: SAFE_FETCH_EVENT_BODY_BYTES \}, allowSharedPlatforms: true \};/);
  assert.match(src, /const checked = validateFetchUrl\(next, \{ allowSharedPlatforms: profile\.allowSharedPlatforms \}\);/, "redirects re-checked with the same rules");
});

// ── analyze (engine) with fake deps ─────────────────────────────────────
function deps(over = {}) {
  return {
    fetchPage: async (url) => ({ ok: true, url, html: page(FESTIVAL), bytes: 1000, redirects: 0, truncated: false, declaredBytes: null }),
    ai: null,
    matchEvent: async () => null,
    getEvent: async () => null,
    matchLocations: async () => [],
    matchOrganizer: async () => null,
    matchExistingAppearance: async () => null,
    isRateLimited: () => false,
    now: () => Date.now(),
    ...over,
  };
}

test("analyze: fetch failures become plain-language codes; nothing is written", async () => {
  for (const [code, expected] of [["blocked_by_site", "blocked_by_site"], ["timeout", "unreachable"], ["unsupported_content", "not_html"], ["blocked_destination", "blocked_url"]]) {
    const r = await E.analyzeEventUrl({ url: "https://site.com/e", businessId: "b", rateKey: "u" }, deps({ fetchPage: async () => ({ ok: false, code, redirects: 0 }) }));
    assert.deepEqual(r, { ok: false, code: expected });
  }
  const none = await E.analyzeEventUrl({ url: "https://site.com/about", businessId: "b", rateKey: "u" }, deps({ fetchPage: async (url) => ({ ok: true, url, html: "<html><head></head><body>About us</body></html>", bytes: 10, redirects: 0, truncated: false, declaredBytes: null }) }));
  assert.deepEqual(none, { ok: false, code: "no_event" });
  assert.deepEqual(await E.analyzeEventUrl({ url: "https://site.com/e", businessId: "b", rateKey: "u" }, deps({ isRateLimited: () => true })), { ok: false, code: "rate_limited" });
  assert.doesNotMatch(read("src/lib/event-import/engine.ts"), /\.insert\(|\.update\(|\.upsert\(|\.rpc\(|\.delete\(/, "Analyze never writes");
});

test("analyze: existing Event + existing Location are reported as matches (conservative)", async () => {
  const r = await E.analyzeEventUrl(
    { url: "https://www.eventbrite.com/e/nyc-coffee-festival-123", businessId: "biz", rateKey: "u" },
    deps({
      matchEvent: async (draft) => (draft.date === DAY1 ? { id: "ev-1", name: "NYC Coffee Festival", venue_name: "Metropolitan Pavilion", city: "New York", start_at: `${DAY1}T14:00:00Z`, confidence: "strong" } : null),
      getEvent: async () => ({ slug: "nyc-coffee-festival", host_business_id: "someone-else" }),
      matchLocations: async (v) => (v.name === "Metropolitan Pavilion" ? [{ id: "loc-1", name: "Metropolitan Pavilion", address: "125 W 18th St", city: "New York", state: "NY" }] : []),
    })
  );
  assert.equal(r.ok, true);
  assert.equal(r.matches.event.id, "ev-1");
  assert.equal(r.matches.event.hostedByThisBusiness, false);
  assert.equal(r.matches.locations[0].id, "loc-1");
  assert.equal(r.matches.locations[0].confidence, "strong", "one Location agreeing on address/city");
  // Review: participating pre-selects a strong Event; hosting never pre-selects someone else's Event.
  assert.equal(R.reviewDefaults(r.candidate, r.matches, "participating").useEventId, "ev-1");
  assert.equal(R.reviewDefaults(r.candidate, r.matches, "hosting").useEventId, null);
  assert.equal(R.reviewDefaults(r.candidate, r.matches, "participating").place.useLocationId, "loc-1");
  const weak = { ...r.matches, event: { ...r.matches.event, confidence: "weak" } };
  assert.equal(R.reviewDefaults(r.candidate, weak, "participating").useEventId, null, "weak match shown, never pre-selected");
});

test("analyze: unknown / unlaunched geography never blocks; past dates are left out with a note", async () => {
  const huntsville = { "@type": "Event", name: "Rocket City Food Fest", startDate: `${DAY1}T10:00:00-05:00`, endDate: `${DAY1}T16:00:00-05:00`, location: { "@type": "Place", name: "Whole Foods Market", address: { "@type": "PostalAddress", streetAddress: "6002 Ready Section Rd", addressLocality: "Huntsville", addressRegion: "Alabama" } } };
  const r = await E.analyzeEventUrl({ url: "https://huntsville.com/e", businessId: "b", rateKey: "u" }, deps({ fetchPage: async (url) => ({ ok: true, url, html: page(huntsville), bytes: 1, redirects: 0, truncated: false, declaredBytes: null }) }));
  assert.equal(r.ok, true);
  assert.equal(r.candidate.occurrences[0].venue.state, "AL");
  assert.doesNotMatch(r.warnings.join(" "), /not available|area|market/i);
  const past = { "@type": "Event", name: "Old Fest", startDate: "2020-01-01T10:00:00Z", endDate: "2020-01-01T12:00:00Z" };
  const p2 = await E.analyzeEventUrl({ url: "https://x.com/e", businessId: "b", rateKey: "u" }, deps({ fetchPage: async (url) => ({ ok: true, url, html: page(past), bytes: 1, redirects: 0, truncated: false, declaredBytes: null }) }));
  assert.match(p2.warnings.join(" "), /already passed/);
});

// ── persistence ─────────────────────────────────────────────────────────
function fakeAdmin({ existingAppearances = [], events = {}, locations = {} } = {}) {
  const ops = [];
  const builder = (table) => {
    const state = { table, filters: [] };
    const api = {
      select: () => api,
      eq: (k, v) => (state.filters.push([k, v]), api),
      neq: () => api,
      is: () => api,
      in: () => api,
      maybeSingle: async () => {
        const id = state.filters.find(([k]) => k === "id")?.[1];
        if (table === "events") return { data: events[id] ?? null };
        if (table === "locations") return { data: locations[id] ?? null };
        return { data: null };
      },
      then: (resolve) => resolve({ data: table === "appearances" ? existingAppearances : [] }),
      insert: (rows) => {
        ops.push({ op: "insert", table, rows: Array.isArray(rows) ? rows : [rows] });
        const res = { error: null, data: null };
        return { ...res, select: async () => ({ data: (Array.isArray(rows) ? rows : [rows]).map((_, i) => ({ id: `occ-${i}` })) }), then: (r) => r(res) };
      },
      update: (patch) => {
        ops.push({ op: "update", table, patch });
        const c = { eq: () => c, is: () => c, select: () => c, maybeSingle: async () => ({ data: { id: "published" }, error: null }), then: (r) => r({ error: null }) };
        return c;
      },
    };
    return api;
  };
  return {
    ops,
    client: {
      from: (t) => builder(t),
      rpc: async (name, args) => (ops.push({ op: "rpc", name, args }), { data: { id: "new-event" }, error: null }),
    },
  };
}

function persistDeps(admin, over = {}) {
  const calls = { apply: [], notify: [], propagate: [], images: [] };
  return {
    calls,
    deps: {
      admin,
      userId: "user-1",
      businessId: "biz",
      businessName: "Lavazza",
      applyToEvent: async (id) => (calls.apply.push(id), over.applyResult ?? "applied"),
      canHost: async () => over.canHost ?? true,
      storeImage: async (url) => (calls.images.push(url), "https://store.supabase.co/findmi-media/img.webp"),
      geography: async () => over.geography ?? null,
      uniqueEventSlug: async () => "lavazza-tabli-resident-demo",
      notifyNewEvent: async (id) => calls.notify.push(id),
      propagateDates: async (id, ids) => calls.propagate.push([id, ids]),
    },
  };
}

const PLACE_KEYS = ["venueName", "address", "city", "state", "postalCode", "useLocationId"];
/** V1 shape helper: `dates` + shared place fields → occurrences + one shared place. */
const review = (over = {}) => {
  const place = { venueName: "Metropolitan Pavilion", address: "125 W 18th St", city: "New York", state: "NY", postalCode: "10011", useLocationId: null };
  const rest = {};
  for (const [k, v] of Object.entries(over)) (PLACE_KEYS.includes(k) ? place : rest)[k] = v;
  const dates = rest.dates ?? [{ date: DAY1, startTime: "10:00", endTime: "18:00" }];
  delete rest.dates;
  return {
    intent: "participating",
    title: "NYC Coffee Festival",
    description: "Tastings",
    imageUrl: "https://img.example-cdn.com/fest.jpg",
    sourceUrl: "https://www.eventbrite.com/e/nyc-coffee-festival-123",
    occurrences: dates.map((d) => ({ ...d, place: { ...place } })),
    sharedPlace: true,
    place,
    organizer: "Specialty Coffee NYC",
    useEventId: null,
    ...rest,
  };
};
const norm = (r) => {
  const n = P.normalizeReview(r);
  assert.equal(n.ok, true, JSON.stringify(n));
  return n.value;
};

test("review is required: incomplete reviewed values are refused before any write", () => {
  assert.equal(P.normalizeReview(review({ title: "  " })).ok, false);
  assert.equal(P.normalizeReview(review({ dates: [] })).ok, false);
  // Event date/time precision (approved): a date with no published time is
  // valid (no time invented); an end with no start is refused.
  assert.equal(P.normalizeReview(review({ dates: [{ date: DAY1, startTime: "", endTime: "" }] })).ok, true);
  assert.equal(P.normalizeReview(review({ dates: [{ date: DAY1, startTime: "", endTime: "" }] })).value.occurrences[0].start, null);
  assert.equal(P.normalizeReview(review({ dates: [{ date: DAY1, startTime: "", endTime: "21:00" }] })).error, "An end time needs a start time. Add the start, or clear the end.");
  assert.equal(P.normalizeReview(review({ dates: [{ date: "", startTime: "18:00", endTime: "21:00" }] })).error, "Each date needs a day.");
  assert.equal(P.normalizeReview(review({ dates: [{ date: DAY1, startTime: "18:00", endTime: "10:00" }] })).error, "End time must be after the start time.");
  assert.equal(P.normalizeReview(review({ sourceUrl: "javascript:alert(1)" })).ok, false);
  assert.equal(norm(review({ imageUrl: "http://insecure.com/a.jpg" })).imageUrl, null);
  assert.equal(norm(review({ useEventId: "'; drop table" })).useEventId, null, "ids are uuid-only");
  const page_ = read("src/app/(public)/account/business/[id]/import-event/actions.ts");
  assert.match(page_, /const normalized = normalizeReview\(review\);\s*if \(!normalized\.ok\) return normalized;/);
});

const EV_ID = "11111111-2222-4333-8444-555555555555";
const LOC_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

test("PARTICIPATING + existing Findmi Event → the shared application path; no Event, Date or Appearance created", async () => {
  const { client, ops } = fakeAdmin();
  const { deps: d, calls } = persistDeps(client);
  const out = await P.persistEventImport(norm(review({ useEventId: EV_ID })), d);
  assert.deepEqual(calls.apply, [EV_ID]);
  assert.deepEqual(ops, [], "no direct writes");
  assert.equal(out.kind, "requested");
  const invited = persistDeps(fakeAdmin().client, { applyResult: "approved_now" });
  assert.equal((await P.persistEventImport(norm(review({ useEventId: EV_ID })), invited.deps)).kind, "scheduled");
});

test("PARTICIPATING without a Findmi Event → this Business's own schedule items (one per date), never a new Event", async () => {
  const { client, ops } = fakeAdmin();
  const { deps: d } = persistDeps(client);
  const out = await P.persistEventImport(norm(review({ dates: [{ date: DAY1, startTime: "10:00", endTime: "18:00" }, { date: DAY2, startTime: "10:00", endTime: "18:00" }] })), d);
  assert.equal(out.kind, "scheduled");
  assert.deepEqual(ops.map((o) => `${o.op}:${o.table ?? o.name}`), ["insert:appearances"]);
  const rows = ops[0].rows;
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.business_id, "biz");
    assert.equal(row.source, "manual");
    assert.equal(row.status, "confirmed");
    assert.equal(row.external_url, "https://www.eventbrite.com/e/nyc-coffee-festival-123");
    assert.equal(row.venue_name, "Metropolitan Pavilion");
    assert.equal(row.flyer_image_url, "https://store.supabase.co/findmi-media/img.webp", "image re-hosted in Findmi storage");
    assert.equal(row.event_id, undefined, "never linked to an Event it doesn't belong to");
  }
});

test("PARTICIPATING at a confirmed existing Location → the Location's own details and id are used", async () => {
  const { client, ops } = fakeAdmin({ locations: { [LOC_ID]: { id: LOC_ID, name: "Metropolitan Pavilion", address: "125 W 18th St", city: "New York", state: "NY", postal_code: "10011", latitude: null, longitude: null } } });
  const { deps: d } = persistDeps(client);
  await P.persistEventImport(norm(review({ useLocationId: LOC_ID, venueName: "typo hall" })), d);
  assert.equal(ops[0].rows[0].location_id, LOC_ID);
  assert.equal(ops[0].rows[0].venue_name, "Metropolitan Pavilion");
});

test("duplicate avoidance: a date already on the schedule is not added again", async () => {
  const start = P.normalizeReview(review()).value.occurrences[0].start;
  const { client, ops } = fakeAdmin({ existingAppearances: [{ start_at: start, title: "NYC Coffee Festival" }] });
  const { deps: d } = persistDeps(client);
  const out = await P.persistEventImport(norm(review()), d);
  assert.equal(out.kind, "already");
  assert.deepEqual(ops, []);
});

test("HOSTING → create_owned_event with this Business as host, Dates for each day, and NO Appearance for the host", async () => {
  const { client, ops } = fakeAdmin();
  const { deps: d, calls } = persistDeps(client);
  const out = await P.persistEventImport(
    norm(review({ intent: "hosting", title: "Lavazza Tabli Resident Demo", dates: [{ date: DAY1, startTime: "15:00", endTime: "17:00" }, { date: DAY2, startTime: "15:00", endTime: "17:00" }] })),
    d
  );
  assert.equal(out.kind, "scheduled");
  assert.equal(out.viewHref, "/account/event/new-event?business_id=biz");
  const rpc = ops.find((o) => o.op === "rpc");
  assert.equal(rpc.name, "create_owned_event");
  assert.equal(rpc.args.p_host_business_id, "biz");
  assert.equal(rpc.args.p_user_id, "user-1");
  assert.equal(rpc.args.p_requested_market_text, null, "never auto-creates a Market request");
  assert.equal(ops.filter((o) => o.table === "appearances").length, 0, "host gets no manufactured Appearance");
  const occ = ops.find((o) => o.op === "insert" && o.table === "event_occurrences");
  assert.equal(occ.rows.length, 2);
  assert.equal(calls.propagate.length, 1);
  assert.deepEqual(calls.notify, ["new-event"], "Findmi Admin is told about every new Event");
  // Live by default: the RPC's review state is replaced right after creation.
  assert.deepEqual(ops.find((o) => o.op === "update" && o.table === "events").patch, { is_demo: false, publication_status: "live" });
  const upd = ops.find((o) => o.op === "update" && o.table === "events" && !("is_demo" in o.patch));
  assert.equal(upd.patch.external_url, "https://www.eventbrite.com/e/nyc-coffee-festival-123");
});

test("HOSTING in an unlaunched geography still creates the Event (no Market required)", async () => {
  const { client, ops } = fakeAdmin();
  const { deps: d } = persistDeps(client, { geography: null });
  const out = await P.persistEventImport(norm(review({ intent: "hosting", city: "Huntsville", state: "AL" })), d);
  assert.equal(out.ok, true);
  assert.equal(ops.find((o) => o.op === "rpc").args.p_market_id, null);
});

test("HOSTING never takes over someone else's Event; its own existing Event is 'already'", async () => {
  const other = fakeAdmin({ events: { [EV_ID]: { id: EV_ID, host_business_id: "someone-else" } } });
  const r1 = await P.persistEventImport(norm(review({ intent: "hosting", useEventId: EV_ID })), persistDeps(other.client).deps);
  assert.equal(r1.ok, false);
  assert.match(r1.error, /already on Findmi, organized by someone else/);
  assert.equal(other.ops.length, 0);
  const own = fakeAdmin({ events: { [EV_ID]: { id: EV_ID, host_business_id: "biz" } } });
  assert.equal((await P.persistEventImport(norm(review({ intent: "hosting", useEventId: EV_ID })), persistDeps(own.client).deps)).kind, "already");
  const noRole = await P.persistEventImport(norm(review({ intent: "hosting" })), persistDeps(fakeAdmin().client, { canHost: false }).deps);
  assert.equal(noRole.ok, false, "staff can't host");
});

// ── entry points, copy, Add Another ─────────────────────────────────────
test("Where I'll Be launches the participating context; Host an Event launches hosting", () => {
  const manage = read("src/app/(public)/account/business/[id]/page.tsx");
  assert.match(manage, /href=\{`\/account\/business\/\$\{id\}\/import-event\?intent=participating`\}[\s\S]{0,300}Import Event/);
  const host = read("src/app/(public)/account/event/new/page.tsx");
  assert.match(host, /href=\{`\/account\/business\/\$\{businessContext\.id\}\/import-event\?intent=hosting`\}/);
  assert.match(host, /Or Create Manually/, "manual creation preserved");
  const pg = read("src/app/(public)/account/business/[id]/import-event/page.tsx");
  assert.match(pg, /const intent = parseEventImportIntent\(intentParam\);/);
  assert.match(pg, /participating: `\$\{businessHome\}\?tab=findmi-here&compose=1#going-somewhere`/);
  assert.match(pg, /hosting: `\/account\/event\/new\?business_id=\$\{encodeURIComponent\(id\)\}`/);
});

test("success copy is Business-facing and never says 'Appearance'", () => {
  for (const kind of ["scheduled", "requested", "already"]) {
    for (const intent of ["participating", "hosting"]) assert.doesNotMatch(R.successMessage(kind, "NYC Coffee Festival", "Lavazza", intent), /appearance/i);
  }
  assert.equal(R.successMessage("scheduled", "NYC Coffee Festival", "Lavazza", "participating"), "NYC Coffee Festival is now on Lavazza's Findmi schedule.");
  const ui = read("src/app/(public)/account/business/[id]/import-event/EventImporter.tsx");
  const visible = ui.replace(/\/\*[\s\S]*?\*\//g, "");
  // user-visible strings: quoted literals and JSX text
  for (const re of [/"[^"\n]*"/g, /`[^`\n]*`/g, />[^<>{}\n]+</g]) {
    for (const m of visible.match(re) ?? []) assert.doesNotMatch(m, /Appearance|event_occurrence|location_id|business_event/, m);
  }
});

test("Add Another returns to a fresh link step in the same context", () => {
  const ui = read("src/app/(public)/account/business/[id]/import-event/EventImporter.tsx");
  assert.match(ui, /function addAnother\(\) \{\s*setUrl\(""\);\s*setReview\(null\);\s*setSaveError\(null\);\s*setStep\(\{ kind: "url", error: null \}\);/);
  assert.match(ui, /onClick=\{addAnother\} className=\{secondaryButtonClass\}>\s*Add Another/);
  assert.doesNotMatch(ui.slice(ui.indexOf("function addAnother"), ui.indexOf("const header")), /setIntent/, "keeps the relationship");
});

test("composer participation refactor: one shared invariant for Where I'll Be and Event Import", () => {
  const actions = read("src/app/(public)/account/business/actions.ts");
  assert.match(actions, /const result = await applyBusinessToEvent\(admin, \{ eventId: a, businessId, userId: user\?\.id \?\? null, note \}\);/);
  const helper = read("src/lib/event-participation.ts");
  assert.match(helper, /if \(currentStatus === "invited"\) \{[\s\S]*?ensureEventAppearance\(admin, eventId, businessId\);/);
  assert.match(helper, /upsert\(\{ event_id: eventId, business_id: businessId, status: "applied" \}/);
  assert.doesNotMatch(helper.slice(helper.indexOf('result = "applied"') - 400, helper.indexOf('result = "applied"')), /ensureEventAppearance/, "an application never creates an Appearance");
});
