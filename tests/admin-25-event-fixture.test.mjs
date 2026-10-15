// Admin Event Import — a deterministic 25-Event batch representing the real
// ingestion workload, run through the real pipeline: structured paste →
// per-Event Event Link reads (3 at a time) → Review defaults → Quick Create
// of repeated missing Locations → batch save (existing Events excluded) →
// Import Complete accounting. Plus Retry gap-filling. Fakes only — no
// network, no database, no production writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const E = await import("../src/lib/event-import/engine.ts");
const O = await import("../src/lib/event-import/operator.ts");
const R = await import("../src/lib/event-import/review.ts");
const P = await import("../src/lib/event-import/persist.ts");
const RUN = await import("../src/lib/admin/brand-import-runner.ts");
const read = (p) => readFileSync(p, "utf8");
const NOW = Date.parse("2026-10-01T12:00:00Z");
const ET = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const place = (name, street, postalCode = "10001") => ({ "@type": "Place", name, address: { "@type": "PostalAddress", streetAddress: street, addressLocality: "New York", addressRegion: "NY", postalCode } });
const eventPage = (o, head = "") => `<!doctype html><html><head><title>${o.name}</title>${head}${ld({ "@type": "Event", ...o })}</head><body><h1>${o.name}</h1></body></html>`;

const PAGES = {
  "https://goodamerican.com/pages/nyc": eventPage({ name: "GA Page Title", startDate: "2026-10-15T10:00:00-04:00", endDate: "2026-10-15T19:00:00-04:00", image: "https://goodamerican.com/cdn/flyer.jpg", description: "Denim drops and styling all weekend at the NYC pop-up.", location: place("The Canvas", "335 W 35th St") }),
  "https://knix.com/pages/acotar": eventPage({ name: "Knix x ACOTAR (page)", startDate: "2026-10-17T12:00:00-04:00", endDate: "2026-10-17T20:00:00-04:00", image: "https://knix.com/cdn/acotar.jpg", description: "Limited-edition ACOTAR collection with photo moments and giveaways all day.", location: place("LAVAN Chelsea", "541 W 25th St"), offers: { "@type": "Offer", url: "https://knix.com/rsvp/acotar", price: "0" } }),
  "https://miniverse.com/e/mini-break": eventPage({ name: "Miniverse (page)", startDate: "2026-10-20T11:00:00-04:00", endDate: "2026-10-20T19:00:00-04:00", image: "https://miniverse.com/cdn/mini.jpg", description: "Make tiny food and tiny gifts at the free Miniverse pop-up in Astor Place Plaza.", location: place("Astor Place Plaza", "8th St & Lafayette St", "10003") }),
  "https://generic.example.com/events/launch": `<!doctype html><html><head><title>Launch</title><meta property="og:image" content="https://generic.example.com/share.png">${ld({ "@type": "Event", name: "Launch", startDate: "2026-11-05T18:00:00-05:00", endDate: "2026-11-05T21:00:00-05:00", location: place("Hall", "1 Main St") })}</head><body></body></html>`,
  "https://generic.example.com/": `<!doctype html><html><head><meta property="og:image" content="https://generic.example.com/share.png"></head><body>Home</body></html>`,
  "https://existing.example.com/e/known": eventPage({ name: "Known", startDate: "2026-11-08T18:00:00-05:00", endDate: "2026-11-08T21:00:00-05:00", location: place("Known Hall", "2 Main St") }),
};
const EXISTING = { "https://goodamerican.com/pages/nyc": "eeeeeeee-0000-4000-8000-000000000001", "https://existing.example.com/e/known": "eeeeeeee-0000-4000-8000-000000000002" };

function deps() {
  const calls = { fetched: [], inFlight: 0, maxInFlight: 0 };
  return {
    calls,
    fetchPage: async (url) => {
      calls.fetched.push(url.href);
      calls.inFlight += 1;
      calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight);
      await new Promise((r) => setTimeout(r, 3));
      calls.inFlight -= 1;
      if (url.hostname === "broken.example.com") return { ok: false, code: "timeout", redirects: 0 };
      const html = PAGES[url.href];
      return html ? { ok: true, url, html, bytes: html.length, redirects: 0, truncated: false, declaredBytes: null } : { ok: false, code: "http_error", redirects: 0, status: 404 };
    },
    ai: null,
    matchEvent: async () => null,
    getEvent: async (id) => ({ slug: `slug-${id}`, host_business_id: null }),
    matchLocations: async (v) => (v.name === "LAVAN Chelsea" ? [{ id: "11111111-0000-4000-8000-00000000000a", name: "LAVAN Chelsea", address: "541 W 25th St", city: "New York", state: "NY", postal_code: "10001" }] : []),
    matchOrganizer: async (name) => (name === "Good American" ? { id: "22222222-0000-4000-8000-00000000000a", name: "Good American" } : null),
    matchExistingAppearance: async () => null,
    findScheduledBySourceUrl: async () => null,
    findEventBySourceUrl: async (url) => (EXISTING[url] ? { id: EXISTING[url], name: "Existing", startAt: "2026-10-15T15:00:00Z", venueName: null, city: "New York" } : null),
    isRateLimited: () => false,
    now: () => NOW,
  };
}

const B = (n, body) => `EVENT ${n}\n${body.trim()}\n=== END EVENT ${n} ===`;
const SIMPLE = (n, extra = "") => `Event Name: Series Night ${n}\nPrimary Business: Series Co\nDate: Nov ${(n % 20) + 1}, 2026\nStart Time: 6 PM\nEnd Time: 9 PM\nLocation Name: Gallery ${n}\nStreet Address: ${n} Gallery St\nCity: New York\nState: NY\n${extra}`;
const BLOCKS = [
  // 1 — existing Event (by link), existing Business, four dates at one place, details
  `Event Name: Good American NYC Pop-Up\nPrimary Business: Good American\nEvent Link: https://goodamerican.com/pages/nyc\nLocation Name: The Canvas\nStreet Address: 335 W 35th St\nCity: New York\nState: NY\nZIP: 10001\nStart Time: 11:00 AM\nEnd Time: 6:00 PM\nCategory: Fashion & Style\nFormats: Pop-Up, Shopping\n\nOccurrence 1:\nDate: October 15, 2026\nProgramming: Emma Grede appearance and Dot Cakes activation.\n\nOccurrence 2:\nDate: October 16, 2026\nProgramming: Leora Café activation.\n\nOccurrence 3:\nDate: October 17, 2026\n\nOccurrence 4:\nDate: October 18, 2026`,
  // 2 — new; Event-specific image + RSVP from the link; missing Business with website; existing Location
  `Event Name: Knix x ACOTAR Pop-Up\nPrimary Business: Knix\nBusiness Website: knix.com\nEvent Link: https://knix.com/pages/acotar\nDate: Oct 17, 2026\nLocation Name: LAVAN Chelsea\nStreet Address: 541 W 25th St\nCity: New York\nState: NY`,
  // 3 — new; MGA + Featured Brand; place only from the link (missing Location)
  `Event Name: Miniverse: Take a Mini Break\nPrimary Business: MGA Entertainment\nFeatured Brand: MGA's Miniverse\nBusiness Website: https://www.mgae.com\nEvent Link: https://miniverse.com/e/mini-break\nDate: Oct 20, 2026\nStart Time: 11 AM\nEnd Time: 7 PM`,
  // 4 — tour: different Locations by date, two on the same date/time
  `Event Name: Starbucks Refreshers NYC Tour\nPrimary Business: Starbucks\n\nOccurrence 1:\nDate: October 20, 2026\nStart Time: 11:00 AM\nEnd Time: 2:00 PM\nLocation Name: Location A\nStreet Address: 100 Example St\nCity: New York\nState: NY\nProgramming: Stop A programming.\n\nOccurrence 2:\nDate: October 21, 2026\nStart Time: 12:00 PM\nEnd Time: 3:00 PM\nLocation Name: Location B\nStreet Address: 200 Example St\nCity: New York\nState: NY\nProgramming: Stop B programming.\n\nOccurrence 3:\nDate: October 21, 2026\nStart Time: 12:00 PM\nEnd Time: 3:00 PM\nLocation Name: Location C\nStreet Address: 300 Example St\nCity: New York\nState: NY\nProgramming: Stop C programming.`,
  // 5 — generic site image (same as the homepage's) → no Event image
  `Event Name: Generic Launch\nEvent Link: https://generic.example.com/events/launch\nDate: Nov 5, 2026\nStart Time: 6 PM\nEnd Time: 9 PM\nLocation Name: Hall\nStreet Address: 1 Main St\nCity: New York\nState: NY`,
  // 6 — no image at all (no link)
  SIMPLE(6),
  // 7 — source failure: kept with explicit values
  `Event Name: Down Source Night\nEvent Link: https://broken.example.com/e/7\nDate: Nov 7, 2026\nStart Time: 7 PM\nEnd Time: 10 PM\nLocation Name: Gallery 7\nStreet Address: 7 Gallery St\nCity: New York\nState: NY`,
  // 8 — tickets
  SIMPLE(8, "Ticket URL: https://tickets.example.com/8"),
  // 9 — Participating Businesses evidence (never linked)
  SIMPLE(9, "Participating Businesses: Alpha Bakery, Beta Coffee"),
  // 10 — Business website that will fail to read
  SIMPLE(10, "Business Website: https://down-brand.example.com"),
  // 11–13 — the same missing Location repeated across Events
  ...[11, 12, 13].map((n) => `Event Name: Pier Market ${n}\nDate: Nov ${n}, 2026\nStart Time: 10 AM\nEnd Time: 4 PM\nLocation Name: Pier 57\nStreet Address: 25 11th Ave\nCity: New York\nState: NY\nProgramming: (event-level — evidence only)`),
  // 14 — second existing Event (by link)
  `Event Name: Known Event\nEvent Link: https://existing.example.com/e/known\nDate: Nov 8, 2026\nStart Time: 6 PM\nEnd Time: 9 PM\nLocation Name: Known Hall\nStreet Address: 2 Main St\nCity: New York\nState: NY`,
  // 15–25 — ordinary new Events (some with per-date details, RSVP)
  ...Array.from({ length: 11 }, (_, i) => {
    const n = 15 + i;
    return n % 3 === 0 ? `${SIMPLE(n, `RSVP URL: https://rsvp.example.com/${n}`)}` : n % 3 === 1 ? `Event Name: Series Night ${n}\nPrimary Business: Series Co\nLocation Name: Gallery ${n}\nStreet Address: ${n} Gallery St\nCity: New York\nState: NY\n\nOccurrence 1:\nDate: Dec ${i + 1}, 2026\nStart Time: 6 PM\nEnd Time: 9 PM\nDetails: Night ${n} lineup.` : SIMPLE(n);
  }),
];
const PASTE = BLOCKS.map((b, i) => B(i + 1, b)).join("\n\n");
const CATEGORIES = [
  { id: "c-fs", name: "Fashion & Style", slug: "fashion-style", parent_id: null },
];
const FORMATS = [
  { id: "f-popup", name: "Pop-Up", slug: "pop-up", parent_id: null },
  { id: "f-shop", name: "Shopping", slug: "shopping", parent_id: null },
];

function fakeClient() {
  const ops = [];
  let occSeq = 0;
  let evSeq = 0;
  return {
    ops,
    rpc: async () => ({ data: null, error: { message: "unused" } }),
    from(table) {
      const chain = {
        select: () => chain,
        eq: (c, v) => ((chain._eq = [...(chain._eq ?? []), [c, v]]), chain),
        is: () => chain,
        in: () => chain,
        neq: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          const id = (chain._eq ?? []).find(([c]) => c === "id")?.[1];
          return { data: table === "locations" && id ? { id, name: "Loc", address: "a", city: "New York", state: "NY", postal_code: null, latitude: null, longitude: null } : null };
        },
        then: (res) => res({ data: [], error: null }),
        insert: (input) => {
          const rows = Array.isArray(input) ? input : [input];
          ops.push({ table, kind: "insert", rows });
          const withIds = rows.map((r) => ({ id: table === "event_occurrences" ? `occ-${++occSeq}` : table === "events" ? `ev-${++evSeq}` : `${table}-x`, ...r }));
          return { select: () => ({ single: async () => ({ data: withIds[0], error: null }), then: (cb) => cb({ data: withIds, error: null }) }), then: (cb) => cb({ error: null }) };
        },
        upsert: (row) => (ops.push({ table, kind: "upsert", rows: [row] }), Promise.resolve({ error: null })),
        update: (patch) => {
          const entry = { table, kind: "update", patch, id: null };
          ops.push(entry);
          const c = { eq: (col, v) => ((col === "id" ? (entry.id = v) : null), c), then: (cb) => cb({ error: null }) };
          return c;
        },
      };
      return chain;
    },
  };
}

test("25-Event batch: every Event represented once, exact occurrences / Locations / details, isolated failures, no duplicates, honest accounting", async () => {
  E.resetEventImageGuardCache();
  // 1. Paste → 25 Events, instantly (no network).
  const fast = deps();
  const first = await E.analyzeEventText({ text: PASTE, businessId: null, rateKey: "admin", structured: true }, fast);
  assert.equal(first.kind, "multi");
  assert.equal(first.events.length, 25, "exactly 25 Events");
  assert.deepEqual(first.events.map((e) => e.key), Array.from({ length: 25 }, (_, i) => `pasted-event-${i + 1}`), "one row each, in order — none merged or split");
  assert.equal(fast.calls.fetched.length, 0);

  // 2. Event Links read one Event per request, 3 at a time.
  const segments = O.segmentTextByKey(PASTE);
  const d = deps();
  const byKey = new Map(first.events.map((e) => [e.key, e]));
  await RUN.runWithConcurrency(first.events.filter((e) => e.candidate.sourceUrl).map((e) => e.key), 3, async (key) => {
    const r = await E.analyzeAdminSourceEvent({ text: segments.get(key), rateKey: "admin" }, d);
    assert.equal(r.ok, true, `${key} still reads (a failed source never drops the Event)`);
    byKey.set(key, { ...byKey.get(key), candidate: r.candidate, matches: r.matches, warnings: r.warnings });
    return "done";
  });
  assert.ok(d.calls.maxInFlight <= 3);
  const ev = (n) => byKey.get(`pasted-event-${n}`);
  assert.equal(byKey.size, 25);

  // Explicit values win; the link only fills gaps.
  assert.equal(ev(1).candidate.title, "Good American NYC Pop-Up");
  assert.deepEqual(ev(1).candidate.occurrences.map((o) => [ET(o.start), ET(o.end)])[0], ["Oct 15, 11:00 AM", "Oct 15, 6:00 PM"], "explicit 11–6 beats the page's 10–7");
  assert.equal(ev(2).candidate.title, "Knix x ACOTAR Pop-Up");
  assert.equal(ev(2).candidate.imageUrl, "https://knix.com/cdn/acotar.jpg", "Event-specific image");
  assert.equal(ev(2).candidate.attendance?.url, "https://knix.com/rsvp/acotar", "RSVP from the link");
  assert.equal(ev(2).matches.locations[0].id, "11111111-0000-4000-8000-00000000000a", "existing Location matched");
  assert.equal(ev(3).candidate.occurrences[0].venue.name, "Astor Place Plaza", "place only from the link");
  assert.deepEqual(ev(3).candidate.structured.otherBusinesses, ["MGA's Miniverse"]);
  assert.equal(ev(5).candidate.imageUrl, null);
  assert.equal(ev(5).candidate.imageGuard?.evidence, "homepage_image", "generic site image ignored");
  assert.equal(ev(6).candidate.imageUrl, null, "no image anywhere → none");
  assert.equal(ev(7).candidate.structured.source.status, "failed", "source failure isolated");
  assert.equal(ev(7).candidate.title, "Down Source Night");
  assert.equal(ev(8).candidate.attendance?.cta, "tickets");
  assert.deepEqual(ev(9).candidate.structured.otherBusinesses, ["Alpha Bakery", "Beta Coffee"], "evidence only");
  assert.equal(ev(10).candidate.structured.businessWebsite, "https://down-brand.example.com/");
  assert.equal(ev(1).matches.event?.id, EXISTING["https://goodamerican.com/pages/nyc"]);
  assert.equal(ev(14).matches.event?.id, EXISTING["https://existing.example.com/e/known"]);
  assert.deepEqual(ev(1).matches.organizerBusiness, { id: "22222222-0000-4000-8000-00000000000a", name: "Good American" }, "existing Business matched");

  // Businesses: the websites Brand Import would read (missing Businesses only).
  const websites = [...new Set([...byKey.values()].flatMap((e) => (!e.matches.organizerBusiness && e.candidate.structured?.businessWebsite ? [e.candidate.structured.businessWebsite] : [])))];
  assert.deepEqual(websites.sort(), ["https://down-brand.example.com/", "https://knix.com/", "https://www.mgae.com/"]);

  // 3. Review defaults.
  const reviews = new Map([...byKey.values()].map((e) => [e.key, O.operatorReviewDefaults(e.candidate, e.matches, { categories: CATEGORIES, formats: FORMATS })]));
  const rv = (n) => reviews.get(`pasted-event-${n}`);
  assert.equal(rv(1).useEventId, EXISTING["https://goodamerican.com/pages/nyc"]);
  assert.equal(rv(1).categoryId, "c-fs");
  assert.deepEqual(rv(1).formatIds, ["f-popup", "f-shop"], "multiple Formats");
  assert.equal(rv(4).sharedPlace, false);

  // 4. Quick Create the repeated missing Location ONCE; it resolves every Event there.
  const created = { business: new Set(), location: new Set() };
  const pierKey = R.placeKeyFor(rv(11).place);
  const pier = { key: pierKey, id: "33333333-0000-4000-8000-0000000000f7", name: "Pier 57", address: "25 11th Ave", city: "New York", state: "NY", postalCode: null };
  created.location.add(pier.id);
  for (const [k, r] of reviews) reviews.set(k, R.applyCreatedLocation(k === "pasted-event-11" ? R.selectCreatedLocation(r, "shared", pier) : r, pier));
  assert.deepEqual([11, 12, 13].map((n) => rv(n).place.useLocationId), [pier.id, pier.id, pier.id]);
  // A Business created through Brand Import (Knix) and the minimal one for the failed website.
  created.business.add("knix-new");
  created.business.add("down-brand-new");

  // 5. Save: existing Events are never sent to new-Event creation.
  const existingRows = [...reviews.entries()].filter(([, r]) => r.useEventId);
  assert.deepEqual(existingRows.map(([k]) => k), ["pasted-event-1", "pasted-event-14"]);
  const results = [];
  const saved = new Map();
  for (const [key, review] of reviews) {
    if (review.useEventId) continue;
    const n = P.normalizeReview(review);
    if (!n.ok) {
      results.push({ outcome: n });
      continue;
    }
    const client = fakeClient();
    const outcome = await P.persistDiscoveryEvent(n.value, null, { admin: client, storeImage: async (u) => `stored:${u}`, geography: async () => null, uniqueEventSlug: async () => key, propagateDates: async () => {}, findEventBySourceUrl: async () => null });
    results.push({ outcome });
    saved.set(key, client.ops);
  }
  assert.equal(saved.size, 23, "23 new Events, each saved once");
  for (const ops of saved.values()) assert.equal(ops.filter((o) => o.table === "events" && o.kind === "insert").length, 1, "never two Events for one row");
  const occOf = (n) => saved.get(`pasted-event-${n}`).find((o) => o.table === "event_occurrences" && o.kind === "insert").rows;
  const detailsOf = (n) => saved.get(`pasted-event-${n}`).filter((o) => o.kind === "update" && o.patch && "details" in o.patch).map((u) => [u.id, u.patch.details]);
  // The tour: exact occurrences, Locations and details.
  assert.deepEqual(occOf(4).map((r) => r.venue_name), ["Location A", "Location B", "Location C"]);
  assert.deepEqual(detailsOf(4), [["occ-1", "Stop A programming."], ["occ-2", "Stop B programming."], ["occ-3", "Stop C programming."]]);
  // The repeated Location: every Event at Pier 57 is linked to the ONE created Location.
  assert.deepEqual([11, 12, 13].map((n) => occOf(n).map((r) => r.location_id)), [[pier.id], [pier.id], [pier.id]]);
  assert.deepEqual(detailsOf(11), [], "Event-level programming is never saved onto a date");
  // Per-date details on ordinary Events.
  assert.deepEqual(detailsOf(16), [["occ-1", "Night 16 lineup."]]);
  // Images: Event-specific stored via the Event image path; generic / none → no image.
  const evRow = (n) => saved.get(`pasted-event-${n}`).find((o) => o.table === "events" && o.kind === "insert").rows[0];
  assert.equal(evRow(2).cover_image_url, "stored:https://knix.com/cdn/acotar.jpg");
  assert.equal(evRow(5).cover_image_url, null);
  assert.equal(evRow(6).cover_image_url, null);
  assert.equal(evRow(7).name, "Down Source Night", "the failed-source Event saves with its explicit values");
  assert.equal(evRow(8).tickets_url, "https://tickets.example.com/8");
  // No participation from evidence-only names.
  assert.equal(saved.get("pasted-event-9").filter((o) => o.table === "event_businesses").length, 0);

  // 6. Import Complete.
  const summary = O.operatorImportSummary(results, existingRows.length, { businessesCreated: created.business.size, locationsCreated: created.location.size, existingEventsUpdated: 0 });
  assert.deepEqual(summary, { newEvents: 23, existingEvents: 2, existingEventsUpdated: 0, businessesCreated: 2, locationsCreated: 1, failed: 0 });
  assert.equal(summary.newEvents + summary.existingEvents, 25, "every Event accounted for");
});

test("Retry Event Link fills ONLY gaps — operator edits and explicit values survive", () => {
  const review = {
    intent: "participating",
    title: "Edited Title",
    description: "",
    imageUrl: null,
    sourceUrl: "https://knix.com/pages/acotar",
    occurrences: [
      { id: "d1", date: "2026-10-17", startTime: "", endTime: "", place: { venueName: "LAVAN Chelsea", address: null, city: null, state: null, postalCode: null, useLocationId: null }, details: "Operator note." },
      { id: "d2", date: "2026-10-18", startTime: "09:00", endTime: "10:00", place: { venueName: "Edited Place", address: null, city: null, state: null, postalCode: null, useLocationId: null } },
    ],
    sharedPlace: false,
    place: { venueName: null, address: null, city: null, state: null, postalCode: null, useLocationId: null },
    organizer: "Operator Org",
    useEventId: null,
    asEvent: true,
    attendance: null,
    categoryId: "c-op",
    formatIds: ["f-op"],
  };
  const fresh = {
    ...review,
    title: "Page Title",
    description: "Fresh description.",
    imageUrl: "https://knix.com/cdn/acotar.jpg",
    organizer: "Page Org",
    attendance: { cta: "rsvp", url: "https://knix.com/rsvp" },
    occurrences: [
      { id: "x1", date: "2026-10-17", startTime: "12:00", endTime: "20:00", place: { venueName: "Page Place", address: null, city: null, state: null, postalCode: null, useLocationId: null } },
      { id: "x2", date: "2026-10-18", startTime: "11:00", endTime: "12:00", place: review.place },
    ],
    categoryId: "c-page",
    formatIds: ["f-page"],
  };
  const out = O.fillReviewGaps(review, fresh, { hadImage: false });
  assert.equal(out.title, "Edited Title");
  assert.equal(out.organizer, "Operator Org");
  assert.equal(out.description, "Fresh description.", "empty → filled");
  assert.equal(out.imageUrl, "https://knix.com/cdn/acotar.jpg");
  assert.deepEqual(out.attendance, { cta: "rsvp", url: "https://knix.com/rsvp" });
  assert.deepEqual(out.occurrences.map((o) => [o.startTime, o.endTime, o.place.venueName, o.details ?? null]), [
    ["12:00", "20:00", "LAVAN Chelsea", "Operator note."],
    ["09:00", "10:00", "Edited Place", null],
  ], "a missing time on the SAME date filled; edited times, places and details kept");
  assert.equal(out.categoryId, "c-op");
  assert.deepEqual(out.formatIds, ["f-op"]);
  assert.equal(O.fillReviewGaps(review, fresh, { hadImage: true }).imageUrl, null, "an image the operator removed stays removed");
});

test("retry controls reuse the SAME actions, per item, bounded", () => {
  const client = read("src/app/admin/(protected)/events/import/AdminEventImporter.tsx");
  assert.match(client, /const read = await adminEnrichPastedEvent\(text\);/, "Retry Event Link → the batch's own action, for one Event");
  assert.match(client, /const outcome = await adminProcessBusinessRead\(read\.candidateId\);/, "Retry Business Website → Brand Import's own processing, one candidate");
  assert.match(client, /This website has been retried too many times/, "Brand Import's attempt limit applies");
  assert.match(client, /Retry Event Link/);
  assert.match(client, /Retry Business Website/);
  assert.match(read("src/app/admin/(protected)/events/import/preview-view.ts"), /"Retry Preview"/);
  assert.match(client, /eventPreviewCache\.delete\(url\);\n\s+setAttempt\(\(n\) => n \+ 1\);/);
});

test("durability: the paste survives a refresh (this tab's sessionStorage); leaving mid-batch asks first", () => {
  const client = read("src/app/admin/(protected)/events/import/AdminEventImporter.tsx");
  assert.match(client, /const PASTE_DRAFT_KEY = "findmi:admin-event-import:paste";/);
  assert.match(client, /window\.sessionStorage\.getItem\(PASTE_DRAFT_KEY\)/);
  assert.match(client, /window\.addEventListener\("beforeunload", handler\);/);
  assert.match(client, /const inProgress = Boolean\(progress \|\| result\);/);
});
