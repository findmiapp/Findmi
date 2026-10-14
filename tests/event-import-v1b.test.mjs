// Event Import V1B — multi-location occurrences + recurrence correctness.
// One Event → many occurrences → each with its own date, time and place;
// "date range + weekday rule + time + place" schedules expand to only the
// stated weekdays; past/future is decided on the final occurrence set.
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
const S = await import("../src/lib/event-import/schedule.ts");
const AI = await import("../src/lib/event-import/ai.ts");
const E = await import("../src/lib/event-import/engine.ts");
const P = await import("../src/lib/event-import/persist.ts");
const R = await import("../src/lib/event-import/review.ts");
const T = await import("../src/lib/event-import/types.ts");
const read = (p) => readFileSync(p, "utf8");

// A fixed "today" mid-tour: Tue Oct 13 2026, noon Eastern.
const NOW = Date.parse("2026-10-13T16:00:00Z");
const CTX = { now: NOW, yearHint: 2026 };
const html = (body, head = "") => `<!doctype html><html><head><title>Page</title>${head}</head><body>${body}</body></html>`;
const at = (date, hhmm) => {
  const iso = new Date(`${date}T${hhmm}:00-04:00`).toISOString(); // EDT through Nov 1
  return iso;
};
const brief = (o) => ({ start: o.start, end: o.end, place: o.venue.name, address: o.venue.address });
const days = (from, to, allowed) => {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    if (allowed.includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
  }
  return out;
};

// Inspired by a real sampling-tour page: explicit one-off stops, each with
// its own time and place, PLUS a recurring residency stop. Inline markup
// (<strong>) and <br>-separated lines must still group per line.
const TOUR = html(`
<article>
  <h1>Starbucks Refreshers Residency NYC Sampling Tour</h1>
  <p>Posted September 20, 2026. Free Refreshers samples all over the city.</p>
  <h2>Tour Stops</h2>
  <p>
    <strong>9/24</strong>, 1–7pm – Grand Central (42nd St &amp; Lexington Ave)<br>
    <strong>9/26</strong>, 12–6pm – Astoria Park (19th St &amp; 23rd Ave)<br>
    <strong>9/27</strong>, 1–7pm – Union Square<br>
    <strong>9/29</strong>, 1–7pm – Washington Square Park<br>
    <strong>9/30</strong>, 12–6pm – Queens Plaza<br>
    <strong>10/1</strong>, 1–7pm – Columbus Circle<br>
    <strong>10/2</strong>, 12–6pm – Barclays Center<br>
    <strong>10/16</strong>, 1–7pm – Domino Park<br>
    <strong>9/26</strong>, 6pm–12am – MSG
  </p>
  <h2>Residency</h2>
  <p>9/25–10/31, 6pm–12am — MSG</p>
  <p>Wednesdays, Fridays, and Saturdays only</p>
</article>`);
const MSG_DAYS = days("2026-09-25", "2026-10-31", [3, 5, 6]);

// ── A. one date, one place (unchanged) ─────────────────────────────────
test("A: a normal one-date, one-place Event is unchanged and reviewed with one shared place", () => {
  const ld = { "@type": "Event", name: "Pop-Up Market", startDate: "2026-11-07T11:00:00-05:00", endDate: "2026-11-07T17:00:00-05:00", location: { "@type": "Place", name: "Industry City", address: { "@type": "PostalAddress", streetAddress: "220 36th St", addressLocality: "Brooklyn", addressRegion: "NY" } } };
  const { candidate } = X.extractEventCandidate(html("", `<script type="application/ld+json">${JSON.stringify(ld)}</script>`), new URL("https://market.com/e"), NOW);
  assert.equal(candidate.occurrences.length, 1);
  assert.equal(candidate.occurrences[0].venue.name, "Industry City");
  const r = R.reviewDefaults(candidate, { event: null, locations: [], organizerBusiness: null, existingAppearance: null }, "participating");
  assert.equal(r.sharedPlace, true);
  assert.equal(r.place.venueName, "Industry City");
  assert.deepEqual(r.occurrences.map(({ date, startTime, endTime }) => ({ date, startTime, endTime })), [{ date: "2026-11-07", startTime: "11:00", endTime: "17:00" }]);
});

// ── B. many dates, same place ──────────────────────────────────────────
test("B: several dates at the same place keep one shared Where in Review, and each date still carries that place", () => {
  const page = html(`<h1>Union Square Night Market</h1><ul><li>Oct 16, 5–10pm – Union Square</li><li>Oct 23, 5–10pm – Union Square</li><li>Oct 30, 5–10pm – Union Square</li></ul>`);
  const { candidate } = X.extractEventCandidate(page, new URL("https://nightmarket.com/"), NOW);
  assert.equal(candidate.occurrences.length, 3);
  for (const o of candidate.occurrences) assert.equal(o.venue.name, "Union Square");
  assert.ok(T.sharedVenue(candidate.occurrences));
  const r = R.reviewDefaults(candidate, { event: null, locations: [], organizerBusiness: null, existingAppearance: null }, "participating");
  assert.equal(r.sharedPlace, true);
  assert.equal(r.place.venueName, "Union Square");
});

// ── C. many dates, different places ────────────────────────────────────
test("C: different places — each date keeps its OWN time and its OWN place (never one global place)", () => {
  const { occurrences } = S.parseScheduleLines(
    ["9/24, 1–7pm – Grand Central (42nd St & Lexington Ave)", "9/26, 12–6pm – Astoria Park (19th St & 23rd Ave)", "Oct 2: 12-6pm @ Barclays Center"],
    CTX
  );
  assert.deepEqual(occurrences.map(brief), [
    { start: at("2026-09-24", "13:00"), end: at("2026-09-24", "19:00"), place: "Grand Central", address: "42nd St & Lexington Ave" },
    { start: at("2026-09-26", "12:00"), end: at("2026-09-26", "18:00"), place: "Astoria Park", address: "19th St & 23rd Ave" },
    { start: at("2026-10-02", "12:00"), end: at("2026-10-02", "18:00"), place: "Barclays Center", address: null },
  ]);
  assert.equal(T.sharedVenue(occurrences), null, "places differ");
  assert.match(occurrences[1].evidence, /^9\/26, 12–6pm – Astoria Park/, "one grouped source line per date");
});

test("C: structured sub-events keep their own locations", () => {
  const ld = { "@type": "EventSeries", name: "Pop-Up Tour", location: { "@type": "Place", name: "HQ" }, subEvent: [
    { "@type": "Event", startDate: "2026-11-01T12:00:00-05:00", endDate: "2026-11-01T15:00:00-05:00", location: { "@type": "Place", name: "Pier 17" } },
    { "@type": "Event", startDate: "2026-11-02T12:00:00-05:00", endDate: "2026-11-02T15:00:00-05:00", location: { "@type": "Place", name: "Hudson Yards" } },
    { "@type": "Event", startDate: "2026-11-03T12:00:00-05:00", endDate: "2026-11-03T15:00:00-05:00" },
  ] };
  const { candidate } = X.extractEventCandidate(html("", `<script type="application/ld+json">${JSON.stringify(ld)}</script>`), new URL("https://tour.com/"), NOW);
  assert.deepEqual(candidate.occurrences.map((o) => o.venue.name), ["Pier 17", "Hudson Yards", "HQ"], "a sub-event without a place inherits the Event's");
});

// ── D. date range + weekday rule + time + place ───────────────────────
test("D: a date range expands to ONLY the stated weekdays, with its time and its place", () => {
  const { occurrences, unresolvedRanges } = S.parseScheduleLines(["9/25–10/31, 6pm–12am — MSG", "Wednesdays, Fridays, and Saturdays only"], CTX);
  assert.equal(unresolvedRanges, 0);
  assert.deepEqual(occurrences.map((o) => new Date(Date.parse(o.start) - 4 * 3600e3).toISOString().slice(0, 10)), MSG_DAYS);
  for (const o of occurrences) {
    assert.equal(o.venue.name, "MSG");
    assert.equal((Date.parse(o.end) - Date.parse(o.start)) / 3600e3, 6, "6 PM – 12 AM ends after midnight");
    assert.equal(new Date(o.start).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric" }), "6 PM");
  }
  assert.ok(!occurrences.some((o) => [0, 1, 2, 4].includes(new Date(Date.parse(o.start) - 4 * 3600e3).getUTCDay())), "no other weekdays");
});

test("D: a bare range is never read as every day; weekday rules on the same line, ranges and 'weekends' work", () => {
  const bare = S.parseScheduleLines(["10/1–10/31, 6–9pm — Pier 17"], CTX);
  assert.equal(bare.occurrences.length, 0);
  assert.equal(bare.unresolvedRanges, 1);
  const sameLine = S.parseScheduleLines(["Oct 1 – Oct 14, Thu–Sat, 7–11pm at Elsewhere"], CTX);
  assert.deepEqual(sameLine.occurrences.map((o) => new Date(Date.parse(o.start) - 4 * 3600e3).toISOString().slice(0, 10)), days("2026-10-01", "2026-10-14", [4, 5, 6]));
  assert.equal(sameLine.occurrences[0].venue.name, "Elsewhere");
  const weekends = S.parseScheduleLines(["Oct 1–31: weekends, noon–5pm – Smorgasburg"], CTX);
  assert.deepEqual(weekends.occurrences.map((o) => new Date(Date.parse(o.start) - 4 * 3600e3).toISOString().slice(0, 10)), days("2026-10-01", "2026-10-31", [0, 6]));
  assert.equal(S.parseWeekdayRule("daily").size, 7);
});

test("times: '12–6pm' is noon to 6, '6pm–12am' ends at midnight, an am/pm-less end follows the start", () => {
  assert.deepEqual(S.parseTimes("12–6pm").startTime, "12:00");
  assert.deepEqual([S.parseTimes("6pm–12am").endTime, S.parseTimes("6pm–12am").overnight], ["00:00", true]);
  assert.equal(S.parseTimes("1pm-7:00").endTime, "19:00");
  assert.equal(S.parseTimes("11–2pm").startTime, "11:00");
  assert.equal(S.parseTimes("Posted by staff"), null);
});

// ── E. mixed explicit stops + recurring schedule ──────────────────────
test("E: mixed one-off stops + recurring residency → every date with its own time + place; duplicates removed", () => {
  const { candidate, unresolvedRanges } = X.extractEventCandidate(TOUR, new URL("https://www.nycforfree.co/events/refreshers-tour"), NOW);
  assert.equal(unresolvedRanges, 0);
  assert.equal(candidate.title, "Page", "title comes from the page head (no structured data)");
  const byPlace = (name) => candidate.occurrences.filter((o) => o.venue.name === name);
  assert.deepEqual(byPlace("Grand Central").map(brief), [{ start: at("2026-09-24", "13:00"), end: at("2026-09-24", "19:00"), place: "Grand Central", address: "42nd St & Lexington Ave" }]);
  assert.deepEqual(byPlace("Astoria Park").map(brief), [{ start: at("2026-09-26", "12:00"), end: at("2026-09-26", "18:00"), place: "Astoria Park", address: "19th St & 23rd Ave" }]);
  assert.equal(byPlace("Barclays Center")[0].start, at("2026-10-02", "12:00"));
  const msg = byPlace("MSG");
  assert.equal(msg.length, MSG_DAYS.length, "the explicit 9/26 MSG line duplicates the residency's 9/26 and is removed");
  const oneOffs = ["Grand Central", "Astoria Park", "Union Square", "Washington Square Park", "Queens Plaza", "Columbus Circle", "Barclays Center", "Domino Park"];
  assert.equal(candidate.occurrences.length, oneOffs.length + MSG_DAYS.length);
  assert.deepEqual([...candidate.occurrences].sort((a, b) => a.start.localeCompare(b.start)).map((o) => o.start), candidate.occurrences.map((o) => o.start), "chronological");
  assert.equal(T.sharedVenue(candidate.occurrences), null);
});

test("E: a structured umbrella span is broken into the page's real schedule", () => {
  const ld = { "@type": "Event", name: "Refreshers Tour", startDate: "2026-09-24T13:00:00-04:00", endDate: "2026-10-31T23:59:00-04:00", location: { "@type": "Place", name: "Various NYC", address: { "@type": "PostalAddress", addressLocality: "New York", addressRegion: "NY" } } };
  const { candidate } = X.extractEventCandidate(TOUR.replace("</head>", `<script type="application/ld+json">${JSON.stringify(ld)}</script></head>`), new URL("https://tour.com/"), NOW);
  assert.equal(candidate.title, "Refreshers Tour");
  assert.ok(candidate.occurrences.length > 20);
  assert.equal(candidate.sources.dates, "page");
});

// ── F. past + future ──────────────────────────────────────────────────
function deps(over = {}) {
  return {
    fetchPage: async (url) => ({ ok: true, url, html: TOUR, bytes: 1000, redirects: 0, truncated: false, declaredBytes: null }),
    ai: null,
    matchEvent: async () => null,
    getEvent: async () => null,
    matchLocations: async () => [],
    matchOrganizer: async () => null,
    matchExistingAppearance: async () => null,
    isRateLimited: () => false,
    now: () => NOW,
    ...over,
  };
}
const EMPTY_MATCHES = { event: null, locations: [], organizerBusiness: null, existingAppearance: null };

test("F: some past + some future does NOT say 'all passed'; past dates are kept (flagged), future ones are reviewed", async () => {
  const r = await E.analyzeEventUrl({ url: "https://www.nycforfree.co/events/refreshers-tour", businessId: "starbucks", rateKey: "u" }, deps());
  assert.equal(r.ok, true);
  assert.doesNotMatch(r.warnings.join(" "), /All the dates/);
  assert.match(r.warnings.join(" "), /Some dates on this page have already passed\. Future dates are shown below\./);
  const past = r.candidate.occurrences.filter((o) => o.past);
  const future = r.candidate.occurrences.filter((o) => !o.past);
  assert.ok(past.length > 0 && future.length > 0, "nothing discarded");
  assert.equal(future.filter((o) => o.venue.name === "MSG").length, MSG_DAYS.filter((d) => d >= "2026-10-14").length, "future MSG nights remain");
  assert.ok(future.some((o) => o.venue.name === "Domino Park"));
  const review = R.reviewDefaults(r.candidate, r.matches, "participating", "Starbucks");
  assert.equal(review.occurrences.length, future.length, "Review starts with the future dates");
  assert.equal(review.sharedPlace, false, "places differ → each date reviewed with its place");
  assert.equal(R.pastReviewOccurrences(r.candidate, r.matches).length, past.length, "past dates can be added back");
});

test("F: when ALL dates have passed, the 'all passed' warning is shown and the dates are still reviewable", async () => {
  const later = Date.parse("2027-01-15T16:00:00Z");
  const r = await E.analyzeEventUrl({ url: "https://x.com/e", businessId: "b", rateKey: "u" }, deps({ now: () => later }));
  assert.match(r.warnings.join(" "), /All the dates on that page have already passed\./);
  assert.equal(R.reviewDefaults(r.candidate, r.matches, "participating").occurrences.length, r.candidate.occurrences.length);
});

// ── organizer ─────────────────────────────────────────────────────────
test("organizer: a featured brand is not inferred as organizer; explicit organizer language still counts", () => {
  const featured = "Starbucks Refreshers Residency NYC Sampling Tour. Free Starbucks samples all over the city.";
  const raw = { title: null, schedule: [], venue_name: null, street_address: null, city: null, state: null, postal_code: null, organizer: "Starbucks", organizer_evidence: null };
  assert.equal(AI.sanitizeEventAiOutput(raw, featured, CTX).organizer, null);
  assert.equal(AI.sanitizeEventAiOutput(raw, `${featured} Presented by Starbucks.`, CTX).organizer, "Starbucks");
  assert.equal(AI.organizerEvidenced("Specialty Coffee NYC", "Organizer: Specialty Coffee NYC"), true);
  // A participating Business isn't shown as the organizer on non-structured evidence.
  const cand = { title: "Tour", description: null, imageUrl: null, sourceUrl: "https://x.com", platform: null, occurrences: [], online: false, organizer: "Starbucks", sources: { organizer: "ai" } };
  assert.equal(R.reviewDefaults(cand, EMPTY_MATCHES, "participating", "Starbucks").organizer, null);
  assert.equal(R.reviewDefaults({ ...cand, sources: { organizer: "structured" } }, EMPTY_MATCHES, "participating", "Starbucks").organizer, "Starbucks", "explicit structured organizer kept");
  assert.equal(R.reviewDefaults(cand, EMPTY_MATCHES, "participating", "Lavazza").organizer, "Starbucks");
});

test("AI recurrence: an entry quoting the range + weekday lines is expanded by Findmi's parser, not the model", () => {
  const text = "Residency\n9/25–10/31, 6pm–12am — MSG\nWednesdays, Fridays, and Saturdays only";
  const out = AI.sanitizeEventAiOutput(
    { title: null, schedule: [{ evidence: "9/25–10/31, 6pm–12am — MSG\nWednesdays, Fridays, and Saturdays only", date: null, start_time: "18:00", end_time: "00:00", venue_name: "MSG", street_address: null }], venue_name: null, street_address: null, city: null, state: null, postal_code: null, organizer: null, organizer_evidence: null },
    text,
    CTX
  );
  assert.equal(out.occurrences.length, MSG_DAYS.length);
  const invented = AI.sanitizeEventAiOutput(
    { title: null, schedule: [{ evidence: "Sep 25, 6pm – MSG", date: "2026-09-25", start_time: "18:00", end_time: null, venue_name: "MSG", street_address: null }], venue_name: null, street_address: null, city: null, state: null, postal_code: null, organizer: null, organizer_evidence: null },
    text,
    CTX
  );
  assert.equal(invented.occurrences.length, 0, "evidence not on the page → dropped");
});

// ── Location matching per distinct place ─────────────────────────────
test("Location matching runs once per DISTINCT place; strong matches pre-select per date, possible ones don't", async () => {
  const looked = [];
  const r = await E.analyzeEventUrl(
    { url: "https://www.nycforfree.co/events/refreshers-tour", businessId: "starbucks", rateKey: "u" },
    deps({
      matchLocations: async (v) => {
        looked.push(v.name);
        if (v.name === "Grand Central") return [{ id: "loc-gc", name: "Grand Central", address: "89 E 42nd St", city: "New York", state: "NY" }];
        if (v.name === "MSG") return [{ id: "loc-msg", name: "MSG", address: "4 Pennsylvania Plaza", city: "New York", state: "NY" }];
        return [];
      },
    })
  );
  assert.equal(looked.length, new Set(looked).size, "each place looked up once");
  assert.equal(looked.filter((n) => n === "MSG").length, 1, "the residency's many MSG nights → one lookup");
  const gc = r.matches.locations.find((l) => l.id === "loc-gc");
  const msg = r.matches.locations.find((l) => l.id === "loc-msg");
  assert.equal(gc.confidence, "strong", "page gave a cross-street to agree with");
  assert.equal(msg.confidence, "possible", "a bare name is shown, never silently merged");
  const all = [...R.reviewDefaults(r.candidate, r.matches, "participating").occurrences, ...R.pastReviewOccurrences(r.candidate, r.matches)];
  assert.ok(all.filter((o) => o.place.venueName === "Grand Central").every((o) => o.place.useLocationId === "loc-gc"));
  assert.ok(all.filter((o) => o.place.venueName === "MSG").every((o) => o.place.useLocationId === null && o.place.matchKey === msg.key));
});

// ── persistence ───────────────────────────────────────────────────────
function fakeAdmin({ existingAppearances = [], locations = {} } = {}) {
  const ops = [];
  const builder = (table) => {
    const state = { filters: [] };
    const api = {
      select: () => api,
      eq: (k, v) => (state.filters.push([k, v]), api),
      neq: () => api,
      is: () => api,
      in: () => api,
      maybeSingle: async () => ({ data: table === "locations" ? (locations[state.filters.find(([k]) => k === "id")?.[1]] ?? null) : null }),
      then: (resolve) => resolve({ data: table === "appearances" ? existingAppearances : [] }),
      insert: (rows) => {
        ops.push({ op: "insert", table, rows });
        const res = { error: null, data: null };
        return { ...res, select: async () => ({ data: rows.map((_, i) => ({ id: `occ-${i}` })) }), then: (r) => r(res) };
      },
      update: (patch) => { ops.push({ op: "update", table, patch }); const c = { eq: () => c, is: () => c, select: () => c, maybeSingle: async () => ({ data: { id: "published" }, error: null }), then: (r) => r({ error: null }) }; return c; },
    };
    return api;
  };
  return { ops, client: { from: (t) => builder(t), rpc: async (name, args) => (ops.push({ op: "rpc", name, args }), { data: { id: "new-event" }, error: null }) } };
}
function persistDeps(admin) {
  return {
    admin,
    userId: "user-1",
    businessId: "biz",
    businessName: "Starbucks",
    applyToEvent: async () => "applied",
    canHost: async () => true,
    storeImage: async () => null,
    geography: async () => null,
    uniqueEventSlug: async () => "refreshers-tour",
    notifyNewEvent: async () => {},
    propagateDates: async () => {},
  };
}
const LOC_GC = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const GC_ROW = { id: LOC_GC, name: "Grand Central Terminal", address: "89 E 42nd St", city: "New York", state: "NY", postal_code: "10017", latitude: 40.75, longitude: -73.97 };
const place = (venueName, extra = {}) => ({ venueName, address: null, city: "New York", state: "NY", postalCode: null, useLocationId: null, ...extra });
const tourReview = (over = {}) => ({
  intent: "participating",
  title: "Starbucks Refreshers Residency NYC Sampling Tour",
  description: null,
  imageUrl: null,
  sourceUrl: "https://www.nycforfree.co/events/refreshers-tour",
  sharedPlace: false,
  place: place(null),
  occurrences: [
    { date: "2026-10-16", startTime: "13:00", endTime: "19:00", place: place("Grand Central", { useLocationId: LOC_GC }) },
    { date: "2026-10-17", startTime: "12:00", endTime: "18:00", place: place("Astoria Park", { address: "19th St & 23rd Ave" }) },
    { date: "2026-10-16", startTime: "18:00", endTime: "00:00", place: place("MSG") },
  ],
  organizer: null,
  useEventId: null,
  ...over,
});
const norm = (r) => {
  const n = P.normalizeReview(r);
  assert.equal(n.ok, true, JSON.stringify(n));
  return n.value;
};

test("review is required and validated per date: overnight ends are allowed (≤12h), each date keeps its own place", () => {
  const v = norm(tourReview());
  assert.deepEqual(v.occurrences.map((o) => [o.start, o.end, o.place.name, o.place.locationId]), [
    [at("2026-10-16", "13:00"), at("2026-10-16", "19:00"), "Grand Central", LOC_GC],
    [at("2026-10-16", "18:00"), at("2026-10-17", "00:00"), "MSG", null],
    [at("2026-10-17", "12:00"), at("2026-10-17", "18:00"), "Astoria Park", null],
  ]);
  assert.equal(P.normalizeReview(tourReview({ occurrences: [{ date: "2026-10-16", startTime: "18:00", endTime: "10:00", place: place("X") }] })).error, "End time must be after the start time.", "16h 'overnight' is a mistake, not a night");
  assert.equal(P.normalizeReview(tourReview({ occurrences: [] })).ok, false);
  // Shared place applies to every date; per-date places are independent.
  const shared = norm(tourReview({ sharedPlace: true, place: place("Union Square") }));
  assert.ok(shared.occurrences.every((o) => o.place.name === "Union Square"));
  const edited = tourReview();
  edited.occurrences[1] = { ...edited.occurrences[1], place: { ...edited.occurrences[1].place, venueName: "Astoria Park Lawn" } };
  assert.deepEqual(norm(edited).occurrences.map((o) => o.place.name), ["Grand Central", "MSG", "Astoria Park Lawn"], "editing one stop never changes another");
});

test("PARTICIPATING (new Event): each schedule item keeps its own date, time and place", async () => {
  const { client, ops } = fakeAdmin({ locations: { [LOC_GC]: GC_ROW } });
  const out = await P.persistEventImport(norm(tourReview()), persistDeps(client));
  assert.equal(out.kind, "scheduled");
  const inserts = ops.filter((o) => o.op === "insert");
  assert.deepEqual(inserts.map((o) => o.table), ["appearances"]);
  assert.deepEqual(inserts[0].rows.map((r) => [r.start_at, r.end_at, r.venue_name, r.location_id, r.address]), [
    [at("2026-10-16", "13:00"), at("2026-10-16", "19:00"), "Grand Central Terminal", LOC_GC, "89 E 42nd St"],
    [at("2026-10-16", "18:00"), at("2026-10-17", "00:00"), "MSG", null, null],
    [at("2026-10-17", "12:00"), at("2026-10-17", "18:00"), "Astoria Park", null, "19th St & 23rd Ave"],
  ]);
  assert.ok(inserts[0].rows.every((r) => r.source === "manual" && r.event_id === undefined), "own schedule items, never another organizer's Event");
});

test("PARTICIPATING in an Event already on Findmi: the V1 join path; no schedule items that would conflict", async () => {
  const { client, ops } = fakeAdmin();
  const out = await P.persistEventImport(norm(tourReview({ useEventId: "11111111-2222-4333-8444-555555555555" })), persistDeps(client));
  assert.equal(out.kind, "requested");
  assert.deepEqual(ops, []);
});

test("HOSTING: one Event → one occurrence per date, each linked to ITS OWN place; still no Appearance for the host", async () => {
  const { client, ops } = fakeAdmin({ locations: { [LOC_GC]: GC_ROW } });
  const out = await P.persistEventImport(norm(tourReview({ intent: "hosting" })), persistDeps(client));
  assert.equal(out.ok, true);
  assert.equal(ops.filter((o) => o.table === "appearances").length, 0, "host gets no manufactured Appearance");
  const rpc = ops.find((o) => o.op === "rpc");
  assert.equal(rpc.args.p_start_at, at("2026-10-16", "13:00"));
  assert.equal(rpc.args.p_end_at, at("2026-10-17", "18:00"), "spans to the latest end");
  const occ = ops.find((o) => o.op === "insert" && o.table === "event_occurrences").rows;
  assert.deepEqual(occ.map((r) => [r.venue_name, r.location_id]), [["Grand Central Terminal", LOC_GC], ["MSG", null], ["Astoria Park", null]]);
  assert.deepEqual(ops.find((o) => o.op === "update" && o.table === "events").patch, { is_demo: false, publication_status: "live" }, "live by default");
  const ev = ops.find((o) => o.op === "update" && o.table === "events" && !("is_demo" in o.patch)).patch;
  assert.equal(ev.venue_name, null, "a multi-place Event has no single Event-level venue");
  assert.equal(ev.city, "New York", "…but keeps the city every date shares");
});

// ── UI ────────────────────────────────────────────────────────────────
test("Review UI: per-date place rows, compact summaries, Remove, past dates, no schema jargon", () => {
  // The date/place review parts are shared by the single and several-Events reviews.
  const ui = read("src/app/(public)/account/business/[id]/import-event/ReviewParts.tsx");
  assert.match(read("src/app/(public)/account/business/[id]/import-event/EventImporter.tsx"), /<WhenWhereEditor key=\{reviewVersion\} review=\{review\} set=\{set\} matches=\{matches\} initialPast=\{initialPast\} \/>/);
  assert.match(ui, /\{review\.sharedPlace \? "When" : "When & Where"\}/);
  assert.match(ui, /aria-label=\{`Remove \$\{label\}`\}/);
  assert.match(ui, /Earlier \{pastDates\.length === 1 \? "Date" : "Dates"\} Not Included/);
  assert.match(ui, /showPlace=\{!review\.sharedPlace\}/);
  const visible = ui.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const re of [/"[^"\n]*"/g, />[^<>{}\n]+</g]) {
    for (const m of visible.match(re) ?? []) assert.doesNotMatch(m, /Occurrence|occurrence_|Appearance|location_id|event_id/, m);
  }
  assert.equal(R.occurrenceSummary({ date: "2026-09-24", startTime: "13:00", endTime: "19:00" }).time, "1:00 PM – 7:00 PM");
  assert.equal(R.occurrenceSummary({ date: "2026-09-24", startTime: "13:00", endTime: "19:00" }).day, "Thu, Sep 24");
});
