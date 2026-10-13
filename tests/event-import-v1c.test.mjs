// Event Import V1C — one link, many DISTINCT Events (organizer calendars,
// venue pages) vs one Event with many occurrences (V1B). Fixture pages and
// fake clients only: no network, no database.
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

const SRC = await import("../src/lib/event-import/sources.ts");
const E = await import("../src/lib/event-import/engine.ts");
const P = await import("../src/lib/event-import/persist.ts");
const R = await import("../src/lib/event-import/review.ts");
const F = await import("./fixtures/event-sources.mjs");
const read = (p) => readFileSync(p, "utf8");

// Tue Oct 13 2026, 4 PM Eastern.
const NOW = Date.parse("2026-10-13T20:00:00Z");
const LUMA = new URL("https://luma.com/usecorginyc");

function deps(html, over = {}) {
  return {
    fetchPage: async (url) => ({ ok: true, url, html, bytes: html.length, redirects: 0, truncated: false, declaredBytes: null }),
    ai: null,
    matchEvent: async () => null,
    getEvent: async (id) => ({ slug: `slug-${id}`, host_business_id: null }),
    matchLocations: async () => [],
    matchOrganizer: async () => null,
    matchExistingAppearance: async () => null,
    findScheduledBySourceUrl: async () => null,
    findEventBySourceUrl: async () => null,
    isRateLimited: () => false,
    now: () => NOW,
    ...over,
  };
}
const analyze = (url, d) => E.analyzeEventUrl({ url, businessId: "corgi", rateKey: "u" }, d);

// ── classification ────────────────────────────────────────────────────
test("A: a normal single Event page stays SINGLE (its 'more events' list doesn't make it a calendar)", async () => {
  assert.equal(SRC.classifySource(F.singleEventPage(), new URL("https://market.example.com/fall"), NOW).kind, "single");
  const r = await analyze("https://market.example.com/fall", deps(F.singleEventPage()));
  assert.equal(r.kind, "single");
  assert.equal(r.candidate.title, "Fall Pop-Up Market");
});

test("A: a Luma-style single Event page (its own record matches the page) stays SINGLE", async () => {
  const url = new URL("https://luma.com/spooktober-movie-night");
  assert.equal(SRC.classifySource(F.lumaEventPage(), url, NOW).kind, "single");
  const r = await analyze(url.toString(), deps(F.lumaEventPage()));
  assert.equal(r.kind, "single");
  assert.equal(r.candidate.title, "Spooktober Movie Night", "the page's own Event, not a related one");
});

test("B: Starbucks-style one Event with many dates/places stays ONE Event (V1B), even when stops link to maps", async () => {
  const tour = F.tourWithMapLinks();
  assert.equal(SRC.classifySource(tour, new URL("https://www.nycforfree.co/events/tour"), NOW).kind, "single");
  const r = await analyze("https://www.nycforfree.co/events/tour", deps(tour));
  assert.equal(r.kind, "single");
  assert.deepEqual(r.candidate.occurrences.map((o) => o.venue.name), ["Grand Central", "Astoria Park", "Domino Park"]);
});

test("H: sections that are dates of one Event (same title) are NOT split", () => {
  assert.equal(SRC.classifySource(F.sameTitleSections(), new URL("https://thecellar.example.com/comedy"), NOW).kind, "single");
});

test("C: an organizer calendar (Luma page state) becomes MULTI — every Event, not just the first", () => {
  const c = SRC.classifySource(F.lumaCalendar(), LUMA, NOW);
  assert.equal(c.kind, "multi");
  assert.equal(c.via, "page_data");
  assert.equal(c.sourceName, "Corgi NYC");
  assert.equal(c.events.length, F.CORGI_EVENTS.length);
  const titles = c.events.map((e) => e.candidate.title);
  for (const name of ["Founder GTM Mixer", "AI Founders Roundtable", "QSBS: Guide to a Tax-Free Exit", "Spooktober Movie Night", "Term Sheet Teardown", "Founders After Hours", "A Pancake Social", "Built in Person"]) assert.ok(titles.includes(name), name);
});

test("C: each Event keeps its OWN link, image, date/time and place (never the calendar's)", () => {
  const c = SRC.classifySource(F.lumaCalendar(), LUMA, NOW);
  const qsbs = c.events.find((e) => e.candidate.title.startsWith("QSBS")).candidate;
  assert.equal(qsbs.sourceUrl, "https://luma.com/qsbs-guide");
  assert.equal(qsbs.imageUrl, "https://images.lumacdn.com/event-covers/qsbs-guide.jpg");
  assert.deepEqual(qsbs.occurrences.map((o) => [o.start, o.end, o.venue.name, o.venue.address, o.venue.city]), [["2026-10-15T22:00:00.000Z", "2026-10-16T00:00:00.000Z", "Corgi Cafe", "123 Orchard St", "New York"]]);
  const rose = c.events.find((e) => e.candidate.title === "AI Founders Roundtable").candidate;
  assert.equal(rose.occurrences[0].venue.name, "Rose Hill");
  const urls = new Set(c.events.map((e) => e.candidate.sourceUrl));
  assert.equal(urls.size, c.events.length, "distinct Event links → distinct Events");
  assert.ok(!urls.has(LUMA.toString()), "calendar URL is never an Event's link");
  assert.ok(c.events.every((e) => !/corgi-avatar/.test(e.candidate.imageUrl ?? "")), "calendar avatar never used as an Event image");
  const hidden = c.events.find((e) => e.candidate.title === "Holiday Founders Dinner").candidate;
  assert.equal(hidden.occurrences[0].venue.name, null, "a hidden address stays unknown");
  assert.equal(hidden.occurrences[0].venue.city, "New York");
});

test("C2/D/G: several Events from structured data, a venue's cards, and an organizer's platform cards", () => {
  const s = SRC.classifySource(F.structuredList(), new URL("https://www.corgicafe.nyc/events"), NOW);
  assert.equal(s.kind, "multi");
  assert.equal(s.via, "structured");
  assert.equal(s.events[0].candidate.imageUrl, "https://www.corgicafe.nyc/img/nyc-gtm-mixer.jpg");

  const v = SRC.classifySource(F.venueCalendar(), new URL("https://listeningroom.example.com/events"), NOW);
  assert.equal(v.kind, "multi");
  assert.equal(v.via, "cards");
  assert.equal(v.sourceName, "Events");
  const vinyl = v.events.find((e) => e.candidate.title.startsWith("Vinyl")).candidate;
  assert.equal(vinyl.sourceUrl, "https://listeningroom.example.com/events/vinyl-swap", "the card's own page (tickets anchor folded in)");
  assert.equal(vinyl.imageUrl, "https://listeningroom.example.com/img/vinyl-swap.jpg");
  assert.equal(vinyl.occurrences[0].venue.name, "Back Room");
  assert.equal(new Date(vinyl.occurrences[0].start).toISOString(), "2026-10-24T17:00:00.000Z");

  const o = SRC.classifySource(F.organizerCards(), new URL("https://www.eventbrite.com/o/brooklyn-makers-123"), NOW);
  assert.equal(o.kind, "multi");
  assert.deepEqual(o.events.map((e) => e.candidate.sourceUrl), [
    "https://www.eventbrite.com/e/brooklyn-maker-market-111",
    "https://www.eventbrite.com/e/holiday-craft-fair-222",
    "https://www.eventbrite.com/e/winter-night-market-333",
  ]);
});

test("a calendar whose Events can't be read fails clearly — it NEVER falls back to its first Event", async () => {
  assert.equal(SRC.classifySource(F.lumaCalendarUnreadable(), LUMA, NOW).kind, "multi_unreadable");
  const r = await analyze(LUMA.toString(), deps(F.lumaCalendarUnreadable()));
  assert.deepEqual(r, { ok: false, code: "calendar_unreadable" });
  const eb = await analyze("https://www.eventbrite.com/o/some-organizer-999", deps("<html><head><title>Organizer</title></head><body>Events</body></html>"));
  assert.deepEqual(eb, { ok: false, code: "calendar_unreadable" });
});

// ── analysis ──────────────────────────────────────────────────────────
test("F: past and future Events — past ones are kept, flagged, and not chosen by default", async () => {
  const r = await analyze(LUMA.toString(), deps(F.lumaCalendar()));
  assert.equal(r.kind, "multi");
  const past = r.events.filter((e) => e.past).map((e) => e.candidate.title);
  assert.deepEqual(past.sort(), ["September Founder Brunch", "Summer Rooftop Social"]);
  const chosen = new Set(R.defaultSelection(r.events, "participating"));
  assert.ok(r.events.filter((e) => e.past).every((e) => !chosen.has(e.key)));
  assert.equal(chosen.size, F.CORGI_EVENTS.length - 2);
  assert.deepEqual(R.defaultSelection(r.events, "hosting"), [], "hosting: nothing pre-chosen from someone's calendar");
});

test("matching runs independently per Event; nothing is written during Analyze", async () => {
  const drafts = [];
  const r = await analyze(LUMA.toString(), deps(F.lumaCalendar(), { matchEvent: async (d) => (drafts.push(d.title), null) }));
  assert.equal(drafts.length, r.events.length);
  assert.deepEqual(new Set(drafts), new Set(r.events.map((e) => e.candidate.title)));
  for (const f of ["engine.ts", "sources.ts"]) assert.doesNotMatch(read(`src/lib/event-import/${f}`), /\.insert\(|\.update\(|\.upsert\(|\.rpc\(|\.delete\(/, f);
});

test("E + retry safety: an Event already on Findmi is matched; one already imported is marked and not re-chosen", async () => {
  const d = deps(F.lumaCalendar(), {
    findEventBySourceUrl: async (url) => (url === "https://luma.com/aleph-corgi-run-club" ? { id: "ev-run", name: "Aleph x Corgi Run Club NYC", startAt: "2026-10-17T13:00:00Z", venueName: "East River Park", city: "New York" } : null),
    findScheduledBySourceUrl: async (_b, url) => (url === "https://luma.com/spooktober-movie-night" ? { title: "Spooktober Movie Night", startAt: "2026-10-15T23:00:00Z" } : null),
  });
  const r = await analyze(LUMA.toString(), d);
  const run = r.events.find((e) => e.candidate.sourceUrl === "https://luma.com/aleph-corgi-run-club");
  assert.equal(run.matches.event.id, "ev-run");
  assert.equal(run.matches.event.confidence, "strong", "same Event link = same Event");
  const spook = r.events.find((e) => e.candidate.title === "Spooktober Movie Night");
  assert.deepEqual(spook.alreadyOnSchedule, { title: "Spooktober Movie Night", startAt: "2026-10-15T23:00:00Z" });
  assert.ok(!R.defaultSelection(r.events, "participating").includes(spook.key), "not chosen again");
  // Joining the existing Event is the default for participating (no duplicate Event).
  const review = R.reviewDefaults(run.candidate, run.matches, "participating", "Corgi");
  assert.equal(review.useEventId, "ev-run");
  assert.equal(R.batchItemStatus(review, run.matches).kind, "joins_existing");
});

test("Business relationship is inherited from the entry point for every Event", async () => {
  const r = await analyze(LUMA.toString(), deps(F.lumaCalendar()));
  for (const e of r.events) assert.equal(R.reviewDefaults(e.candidate, e.matches, "participating", "Corgi").intent, "participating");
  for (const e of r.events) assert.equal(R.reviewDefaults(e.candidate, e.matches, "hosting", "Corgi").intent, "hosting");
});

// ── review + persistence ──────────────────────────────────────────────
test("review is required: batch status marks what's missing; incomplete Events are never sent", async () => {
  const r = await analyze("https://listeningroom.example.com/events", deps(F.venueCalendar()));
  const poetry = r.events.find((e) => e.candidate.title === "Poetry Slam"); // "7pm" — no end time
  const review = R.reviewDefaults(poetry.candidate, poetry.matches, "participating", "Corgi");
  assert.deepEqual(R.batchItemStatus(review, poetry.matches), { kind: "needs_details", missing: ["Start and end time"] });
  assert.equal(P.normalizeReview(review).ok, false, "the server refuses it too");
  const jazz = r.events.find((e) => e.candidate.title === "Late Night Jazz Trio");
  assert.equal(R.batchItemStatus(R.reviewDefaults(jazz.candidate, jazz.matches, "participating", "Corgi"), jazz.matches).kind, "ready");
  const ui = read("src/app/(public)/account/business/[id]/import-event/MultiEventImport.tsx");
  assert.match(ui, /const ready = chosen\.filter\(\(e\) => reviews\[e\.key\] && statusOf\(e\.key\)\.kind !== "needs_details"\);/);
  assert.match(ui, /commitEventImportBatch\(\s*businessId,\s*ready\.map\(\(e\) => reviews\[e\.key\]\)/);
});

function fakeAdmin({ failTitles = [] } = {}) {
  const ops = [];
  let n = 0;
  const builder = (table) => {
    const api = {
      select: () => api, eq: () => api, neq: () => api, is: () => api, in: () => api,
      maybeSingle: async () => ({ data: null }),
      then: (resolve) => resolve({ data: [] }),
      insert: (input) => {
        const rows = Array.isArray(input) ? input : [input];
        const failed = rows.some((r) => failTitles.includes(r.title ?? r.name));
        if (!failed) ops.push({ table, rows });
        const res = { error: failed ? { message: "boom" } : null, data: null };
        const ids = rows.map(() => `${table}-${++n}`);
        return { ...res, select: () => ({ single: async () => (failed ? { data: null, error: res.error } : { data: { id: ids[0] }, error: null }), then: (r) => r({ data: ids.map((id) => ({ id })) }) }), then: (r) => r(res) };
      },
      upsert: (row) => (ops.push({ table, rows: [row], upsert: true }), Promise.resolve({ error: null })),
      update: () => ({ eq: async () => ({ error: null }) }),
    };
    return api;
  };
  return { ops, client: { from: builder, rpc: async () => ({ data: { id: "new" }, error: null }) } };
}
const persistDeps = (admin, propagated = []) => ({
  admin, userId: "u", businessId: "corgi", businessName: "Corgi", applyToEvent: async () => "applied", canHost: async () => true,
  storeImage: async (u) => `stored:${u}`, geography: async () => null, uniqueEventSlug: async (t) => t.toLowerCase().replace(/\W+/g, "-"), notifyNewEvent: async () => {},
  propagateDates: async (eventId, ids) => propagated.push([eventId, ids]), findEventBySourceUrl: async () => null,
});

test("batch persistence: each calendar Event becomes its OWN canonical Event with its own link/image/place; one failure doesn't touch the others", async () => {
  const r = await analyze(LUMA.toString(), deps(F.lumaCalendar()));
  const picked = r.events.filter((e) => ["AI Founders Roundtable", "Term Sheet Teardown", "A Pancake Social"].includes(e.candidate.title));
  const reviews = picked.map((e) => R.reviewDefaults(e.candidate, e.matches, "participating", "Corgi"));
  assert.ok(reviews.every((rv) => rv.asEvent === true), "rich calendar Events are saved as Events");
  const { client, ops } = fakeAdmin({ failTitles: ["Term Sheet Teardown"] });
  const propagated = [];
  const results = [];
  for (const rv of reviews) {
    const n = P.normalizeReview(rv);
    assert.equal(n.ok, true, JSON.stringify(n));
    results.push({ title: rv.title, outcome: await P.persistEventImport(n.value, persistDeps(client, propagated)) });
  }
  assert.deepEqual(results.map((x) => x.outcome.ok), [true, false, true]);
  const events = ops.filter((o) => o.table === "events").map((o) => o.rows[0]);
  assert.deepEqual(events.map((e) => e.name), ["AI Founders Roundtable", "A Pancake Social"], "one Event each; the failed one wrote nothing");
  const rose = events[0];
  assert.equal(rose.external_url, "https://luma.com/ai-founders-roundtable");
  assert.equal(rose.cover_image_url, "stored:https://images.lumacdn.com/event-covers/ai-founders-roundtable.jpg");
  assert.equal(rose.host_business_id, null, "participating — never the host");
  assert.equal(ops.filter((o) => o.table === "appearances").length, 0, "schedule items come from the shared participation sync, not a standalone insert");
  assert.equal(propagated.length, 2);
  const summary = R.batchSummary(results, 1, "Corgi");
  assert.equal(summary.headline, "2 Events Added To Corgi");
  assert.deepEqual(summary.attention.map((a) => a.title), ["Term Sheet Teardown"]);
  assert.equal(summary.skipped, 1);
  for (const s of [summary.headline, ...Object.values(R.BATCH_STATUS_LABEL)]) assert.doesNotMatch(s, /appearance|occurrence|database/i);
});

test("the batch action validates and saves each Event independently through the single-import path", () => {
  const actions = read("src/app/(public)/account/business/[id]/import-event/actions.ts");
  assert.match(actions, /export async function commitEventImportBatch\(/);
  assert.match(actions, /for \(const review of reviews\) \{\s*results\.push\(\{ title: [^}]+, outcome: await commitOne\(ctx, businessId, review, emailVerified\) \}\);/);
  assert.match(actions, /async function commitOne\([\s\S]*?const normalized = normalizeReview\(review\);\s*if \(!normalized\.ok\) return normalized;[\s\S]*?try \{\s*return await persistEventImport/);
  assert.match(actions, /if \(reviews\.length > BATCH_MAX\)/);
});

test("UI: Events Found → Review Selected → Add N Events → summary, with no schema words", () => {
  const ui = read("src/app/(public)/account/business/[id]/import-event/MultiEventImport.tsx");
  for (const s of ["Events Found", "Select All", "Clear All", "Review Selected", "Show Past Events", "View Schedule", "Import More", "Back To Events"]) assert.ok(ui.includes(s), s);
  assert.match(ui, /`Add \$\{ready\.length\} \$\{ready\.length === 1 \? "Event" : "Events"\}`/);
  const importer = read("src/app/(public)/account/business/[id]/import-event/EventImporter.tsx");
  assert.match(importer, /if \(result\.kind === "multi"\) \{/, "several Events never open the single Review for the first one");
  const visible = ui.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const re of [/"[^"\n]*"/g, />[^<>{}\n]+</g]) for (const m of visible.match(re) ?? []) assert.doesNotMatch(m, /Appearance|occurrence|location_id|event_id/, m);
});
