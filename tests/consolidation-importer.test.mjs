// Findmi Consolidation pass — Batch B: ONE shared Event import engine.
//   A  the DUA structured-paste fixture (exact input from the brief)
//   B  single date · C  date range · D  multiple discrete dates
//   E  recurring weekly · F  end known / start unknown · G  no published time
//   H  existing / context Business match · L  Event duplicate suggestion
//   T  Admin and Business Manager parse equivalent input identically
//   U  the URL importer never turns an article's recommendations into Events
// Fakes only — no network, no database, no AI.
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
const SP = await import("../src/lib/event-import/structured-paste.ts");
const T = await import("../src/lib/event-import/temporal.ts");
const R = await import("../src/lib/event-import/review.ts");
const S = await import("../src/lib/event-import/sources.ts");
const X = await import("../src/lib/event-import/extract.ts");
const O = await import("../src/lib/event-import/operator.ts");
const BM = await import("../src/lib/business-matching.ts");
const EM = await import("../src/lib/event-matching.ts");
const read = (p) => readFileSync(p, "utf8");

const NOW = Date.parse("2026-10-28T12:00:00Z");

// The REQUIRED regression fixture — verbatim from the brief.
const DUA = `Event name: DUA by AB NYC Pop-Up

Dates: Open through November 29, 2026. Original opening date not specified.

Times:
Monday–Saturday: 10:00 AM–7:00 PM
Sunday: 11:00 AM–6:00 PM
Time zone: Eastern

Venue: DUA by AB Pop-Up

Address: 410 West 13th Street, New York, NY 10014

Brand: DUA by AB, Dua Lipa’s skincare brand developed with Augustinus Bader Science.

Event type: Beauty and skincare pop-up / product discovery / complimentary mini facials

Description: Explore DUA by AB at its NYC pop-up, featuring the brand’s three-step skincare routine, an interactive DUA Skin Bar, and complimentary mini facials. Discover the collection in person through November 29.

Admission / RSVP: The article does not specify an admission fee or whether appointments are required for mini facials.

Website: https://duabyab.com/

Instagram: https://www.instagram.com/duabyab/

Event details: https://holrmagazine.com/dua-by-ab-nyc-pop-up-extended/`;

const DUA_BIZ = { id: "11111111-1111-4111-8111-1111111111d0", name: "DUA by AB" };

function deps(over = {}) {
  const calls = { locations: [], organizers: [], ai: 0 };
  return {
    calls,
    fetchPage: async () => {
      throw new Error("never fetched");
    },
    ai: { complete: async () => ((calls.ai += 1), null) },
    matchEvent: async () => null,
    getEvent: async () => null,
    matchLocations: async (v) => (calls.locations.push(v), over.locations ?? []),
    matchPossibleLocations: async () => over.possible ?? [],
    matchOrganizer: async (name) => (calls.organizers.push(name), null),
    matchExistingAppearance: async () => null,
    findScheduledBySourceUrl: async () => null,
    findEventBySourceUrl: async () => null,
    isRateLimited: () => false,
    now: () => NOW,
    getBusiness: async (id) => (id === DUA_BIZ.id ? DUA_BIZ : { id, name: "Some Other Brand" }),
    ...over.deps,
  };
}
const analyze = (text, businessId = null, d = deps(), extra = {}) => E.analyzeEventText({ text, businessId, rateKey: "k", ...extra }, d);

// ── A: the DUA fixture ────────────────────────────────────────────────────
test("A. DUA: labels stripped; end date kept, opening date unresolved (never invented); weekly hours structured; venue / address / description / links in their own fields", async () => {
  const r = await analyze(DUA, DUA_BIZ.id);
  assert.equal(r.ok, true, JSON.stringify(r));
  const c = r.candidate;
  assert.equal(c.title, "DUA by AB NYC Pop-Up", "never 'Event name: …'");
  // Temporal: end = Nov 29 2026, start unresolved, no occurrence invented.
  assert.equal(c.occurrences.length, 0, "no date is invented to satisfy a required field");
  assert.equal(c.temporal.endDate, "2026-11-29");
  assert.equal(c.temporal.startDate, null);
  assert.deepEqual(c.temporal.unresolved, ["start"]);
  assert.equal(c.temporal.timezone, "America/New_York");
  assert.deepEqual(
    c.temporal.weekly.map((w) => [w.days, w.startTime, w.endTime]),
    [
      [[1, 2, 3, 4, 5, 6], "10:00", "19:00"],
      [[0], "11:00", "18:00"],
    ],
    "recurring hours are structured per weekday, not one flattened occurrence"
  );
  // Review says exactly what was found and what is missing.
  assert.ok(r.warnings.some((w) => w.startsWith("We found an end date of November 29, 2026, but couldn't determine the opening date.")), r.warnings.join(" | "));
  assert.ok(!r.warnings.some((w) => /couldn't find a date/i.test(w)), "partial dates are never 'no date'");
  // Place.
  assert.deepEqual(c.place, { name: "DUA by AB Pop-Up", address: "410 West 13th Street", city: "New York", state: "NY", postalCode: "10014" });
  // Description is the Description field only — no dates / hours / admission dumped in.
  assert.equal(c.description, "Explore DUA by AB at its NYC pop-up, featuring the brand’s three-step skincare routine, an interactive DUA Skin Bar, and complimentary mini facials. Discover the collection in person through November 29.");
  assert.doesNotMatch(c.description, /Monday|Time zone|Admission|Website|Instagram|10:00 AM/);
  // Links into structured fields.
  assert.equal(c.sourceUrl, "https://holrmagazine.com/dua-by-ab-nyc-pop-up-extended/", "Event details → Event Link");
  assert.equal(c.structured.businessWebsite, "https://duabyab.com/");
  assert.equal(c.structured.instagram, "https://www.instagram.com/duabyab/");
  // Brand evidence: the name, with the full statement kept as evidence.
  assert.equal(c.structured.business, "DUA by AB");
  assert.match(c.structured.businessEvidence, /Augustinus Bader Science/);
  assert.match(c.structured.eventType, /pop-up/);
  // Admission prose is evidence, never "free".
  assert.match(c.structured.admission, /does not specify an admission fee/);
  assert.notEqual(c.attendance?.pricing, "free");
  assert.equal(c.structured.notes.filter((n) => /Not read/.test(n)).length, 0, "every label was recognized");
  assert.equal(r.matches.organizerBusiness?.id, DUA_BIZ.id);
});

test("A + 18. DUA imported BY DUA: the Business context is used — Host suggested when hosting, participant when participating; never 'Not listed'", async () => {
  const r = await analyze(DUA, DUA_BIZ.id);
  assert.deepEqual(r.matches.contextBusiness, { id: DUA_BIZ.id, name: "DUA by AB", evidence: "DUA by AB" });
  const hosting = R.reviewDefaults(r.candidate, r.matches, "hosting", "DUA by AB", { identityFromMatch: true });
  assert.equal(hosting.organizer, "DUA by AB", "hosting → this Business is the organizer");
  const participating = R.reviewDefaults(r.candidate, r.matches, "participating", "DUA by AB", { identityFromMatch: true });
  assert.notEqual(participating.organizer, "DUA by AB", "participating → never made the organizer");
  // A different Business importing the same paste gets no context match.
  const other = await analyze(DUA, "22222222-2222-4222-8222-222222222222");
  assert.equal(other.matches.contextBusiness ?? null, null);
  // The Business Manager review shows the evidence instead of "Not listed".
  const importer = read("src/app/(public)/account/business/[id]/import-event/EventImporter.tsx");
  assert.match(importer, /matches\.contextBusiness \? \(/);
  assert.match(importer, /Matched from the source:/);
});

test("A + 19. DUA place: the parsed venue/address is looked up against existing Findmi Locations (no re-entry)", async () => {
  const d = deps({ locations: [{ id: "loc-410", name: "410 West 13th Street", address: "410 West 13th Street", city: "New York", state: "NY", postal_code: "10014" }] });
  const r = await analyze(DUA, DUA_BIZ.id, d);
  assert.deepEqual(d.calls.locations[0], { name: "DUA by AB Pop-Up", address: "410 West 13th Street", city: "New York", state: "NY", postal_code: "10014" });
  assert.equal(r.matches.locations[0].id, "loc-410");
  assert.equal(r.matches.locations[0].confidence, "strong", "one exact match with an address → suggested");
  const review = R.reviewDefaults(r.candidate, r.matches, "hosting", "DUA by AB");
  assert.equal(review.place.useLocationId, "loc-410", "pre-selected, visibly, and can be undone");
});

test("A + 17. opening date supplied in Review → per-weekday dates through the end bound (Sundays 11–6, others 10–7)", async () => {
  const r = await analyze(DUA, DUA_BIZ.id);
  const review = R.reviewDefaults(r.candidate, r.matches, "hosting", "DUA by AB");
  const made = R.occurrencesFromTemporal(r.candidate.temporal, { startDate: "2026-11-20" }, review.place);
  assert.equal(made.truncated, false);
  assert.equal(made.occurrences.length, 10, "Nov 20–29 inclusive");
  const sunday = made.occurrences.find((o) => o.date === "2026-11-22");
  const monday = made.occurrences.find((o) => o.date === "2026-11-23");
  assert.deepEqual([sunday.startTime, sunday.endTime], ["11:00", "18:00"]);
  assert.deepEqual([monday.startTime, monday.endTime], ["10:00", "19:00"]);
  assert.equal(made.occurrences.at(-1).date, "2026-11-29");
  assert.equal(R.occurrencesFromTemporal(r.candidate.temporal, {}, review.place), null, "still nothing without the opening date");
  // Both importers render the same partial-schedule panel.
  for (const f of ["EventImporter.tsx", "MultiEventImport.tsx"]) assert.match(read(`src/app/(public)/account/business/[id]/import-event/${f}`), /temporal=\{[\w.]*candidate\.temporal \?\? null\}/, f);
});

// ── B–G: temporal shapes ──────────────────────────────────────────────────
const block = (lines) => ["Event Name: Spring Market", ...lines, "Venue: The Canvas", "Address: 335 W 35th St, New York, NY 10001"].join("\n");

test("B. single-date Event with a time", async () => {
  const r = await analyze(block(["Date: November 15, 2026", "Time: 6 PM – 9 PM"]));
  assert.equal(r.candidate.occurrences.length, 1);
  assert.equal(r.candidate.occurrences[0].hasTime, true);
  assert.equal(r.candidate.temporal, undefined);
});

test("C. date range → one date per day", async () => {
  const r = await analyze(block(["Dates: November 13–16, 2026", "Time: 11 AM – 6 PM"]));
  assert.equal(r.candidate.occurrences.length, 4);
});

test("D. multiple discrete dates", async () => {
  const r = await analyze(block(["Dates: Nov 13, Nov 15, Nov 20, 2026", "Time: 11 AM – 6 PM"]));
  assert.deepEqual(
    r.candidate.occurrences.map((o) => o.start.slice(0, 10)),
    ["2026-11-13", "2026-11-15", "2026-11-20"]
  );
});

test("E. recurring weekly: 'Every Saturday through December 19' → weekly rule + end bound; dates once the start is known", async () => {
  const r = await analyze(block(["Dates: Every Saturday through December 19, 2026", "Time: 10 AM – 2 PM"]));
  assert.equal(r.ok, true);
  assert.deepEqual(r.candidate.temporal.weekdays, [6]);
  assert.equal(r.candidate.temporal.endDate, "2026-12-19");
  assert.deepEqual(r.candidate.temporal.unresolved, ["start"]);
  const made = R.occurrencesFromTemporal(r.candidate.temporal, { startDate: "2026-11-01" }, R.emptyReviewOccurrence().place);
  assert.deepEqual(made.occurrences.map((o) => o.date), ["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28", "2026-12-05", "2026-12-12", "2026-12-19"], "Saturdays only");
  // Fully bounded weekly hours → dates right away, closed days skipped.
  const bounded = await analyze(block(["Dates: November 2 – November 15, 2026", "Hours:", "Thursday–Saturday: 12 PM – 8 PM"]));
  const days = bounded.candidate.occurrences.map((o) => new Date(o.start).getUTCDay());
  assert.equal(bounded.candidate.occurrences.length, 6, "two weeks × Thu/Fri/Sat");
  assert.ok(days.every((d) => [4, 5, 6].includes(d)));
});

test("F. known end, unknown start / known start, unknown end — both kept as partial information", () => {
  const ctx = { now: NOW, yearHint: null, upcomingYear: true };
  assert.deepEqual(T.readPartialDates("Open through November 29, 2026", ctx), { startDate: null, endDate: "2026-11-29", weekdays: null });
  assert.deepEqual(T.readPartialDates("Opening November 5", ctx), { startDate: "2026-11-05", endDate: null, weekdays: null });
  assert.deepEqual(T.readPartialDates("On view from Nov 5 through Jan 10, 2027", ctx), { startDate: "2026-11-05", endDate: "2027-01-10", weekdays: null });
  assert.equal(T.readPartialDates("Original opening date not specified", ctx), null);
  const t = { startDate: "2026-11-05", endDate: null, weekly: [], weekdays: null, timezone: null, unresolved: ["end"], evidence: "" };
  assert.match(T.describeTemporal(t), /We found a start date of November 5, 2026/);
});

test("G. no published time → the date is kept, untimed, and Review asks for the time", async () => {
  const r = await analyze(block(["Date: November 15, 2026"]));
  assert.equal(r.candidate.occurrences.length, 1);
  assert.equal(r.candidate.occurrences[0].hasTime, false);
  assert.ok(r.warnings.some((w) => /don't have a start time/.test(w)));
});

test("labels are recognized case-insensitively and in many variants; prose is never mistaken for labels", () => {
  const variants = ["NAME: X", "Title: X", "event title: X"];
  for (const v of variants) assert.equal(SP.isStructuredEvent(`${v}\nDate: Nov 5, 2026\nVenue: Y`), true, v);
  assert.equal(SP.isStructuredEvent("Join us: it's going to be fun. Bring friends: everyone welcome."), false);
  const r = SP.extractStructuredEvent(
    ["Name: Night Market", "When: Nov 5, 2026", "Where: Pier 17", "Host: Smorgasburg", "Type: Market", "RSVP: https://partiful.com/e/x", "Ticket Link: https://dice.fm/x", "Registration: https://luma.com/x", "Source: https://example.com/a", "Organizer: Smorgasburg LLC", "Address Line 2: Suite 4", "Address: 89 South St, New York, NY 10038"].join("\n"),
    { now: NOW }
  );
  assert.equal(r.candidate.title, "Night Market");
  assert.equal(r.candidate.structured.business, "Smorgasburg");
  assert.equal(r.candidate.organizer, "Smorgasburg LLC");
  assert.equal(r.candidate.structured.eventType, "Market");
  assert.deepEqual(r.candidate.structured.links, { rsvp: { cta: "rsvp", url: "https://partiful.com/e/x" }, tickets: "https://dice.fm/x" });
  assert.equal(r.candidate.occurrences[0].venue.addressLine2, "Suite 4");
  assert.equal(r.candidate.occurrences[0].venue.address, "89 South St");
});

// ── H: Business matching ─────────────────────────────────────────────────
test("H. existing Business match: strict name agreement, never fuzzy", () => {
  assert.equal(BM.businessNamesAgree("DUA by AB", "DUA by AB"), true);
  assert.equal(BM.businessNamesAgree("DUA by AB NYC", "DUA by AB"), true, "a longer statement starting with the name");
  assert.equal(BM.businessNamesAgree("dua-by-ab", "DUA by AB"), true, "punctuation / case");
  assert.equal(BM.businessNamesAgree("Augustinus Bader", "DUA by AB"), false);
  assert.equal(BM.businessNamesAgree("AB", "AB Studio"), false, "too short to agree on");
  assert.equal(BM.businessNamesAgree("Babylist", "Shopify"), false);
  assert.equal(SP.businessNameFromEvidence("DUA by AB, Dua Lipa’s skincare brand developed with Augustinus Bader Science."), "DUA by AB");
});

test("H. Event type suggests canonical Formats / Category through the ONE shared resolver", () => {
  const formats = [{ id: "f-popup", name: "Pop-Up", slug: "pop-up" }, { id: "f-tasting", name: "Tasting", slug: "tasting" }];
  const categories = [{ id: "c-beauty", name: "Beauty", slug: "beauty", parent_id: null }, { id: "c-fashion", name: "Fashion", slug: "fashion", parent_id: null }];
  const r = O.resolveStructuredTaxonomy({ category: null, subcategory: null, formats: [], eventType: "Beauty and skincare pop-up / product discovery" }, categories, formats);
  assert.deepEqual(r.formatIds, ["f-popup"]);
  assert.equal(r.categoryId, "c-beauty");
  assert.deepEqual(r.unresolved, []);
  assert.match(read("src/app/(public)/account/business/[id]/import-event/EventImporter.tsx"), /resolveStructuredTaxonomy\(result\.candidate\.structured, categories, formats\)/, "Business Manager uses it too");
});

// ── L: Event duplicate suggestion ─────────────────────────────────────────
test("L. typing an Event name suggests the likely existing Event, using Business / Location / date context", () => {
  const rows = [
    { id: "e1", name: "DUA by AB NYC Pop-Up", start_date: "2026-11-20", host_business_id: "biz-dua", location_ids: ["loc-410"] },
    { id: "e2", name: "Holiday Pop-Up Market", start_date: "2026-12-12" },
    { id: "e3", name: "DUA by AB Launch Party", start_date: "2025-03-01" },
  ];
  const ranked = EM.rankEventCandidates({ name: "dua by ab pop up", businessId: "biz-dua", locationId: "loc-410", date: "2026-11-21" }, rows);
  assert.equal(ranked[0].row.id, "e1");
  assert.ok(ranked[0].reasons.includes("Your Business is on it") && ranked[0].reasons.includes("Same Location"));
  assert.ok(!ranked.some((r) => r.row.id === "e2"), "an unrelated name is never suggested on context alone");
  assert.deepEqual(EM.rankEventCandidates({ name: "du" }, rows), [], "below the minimum length nothing runs");
  assert.equal(EM.eventNameSearchTerm("du"), null);
  assert.equal(EM.eventNameSearchTerm("The DUA Pop-Up"), "%dua%", "the most distinctive word, stop words dropped");
});

// ── T: one parser for both interfaces ────────────────────────────────────
test("T. Admin and Business Manager read equivalent input through the SAME parser with the same result", async () => {
  const asAdmin = await analyze(DUA, null, deps(), { structured: true });
  const asBusiness = await analyze(DUA, null, deps());
  assert.deepEqual(asBusiness.candidate, asAdmin.candidate);
  assert.deepEqual(asBusiness.warnings, asAdmin.warnings);
  // Both server actions call the one engine entry point.
  assert.match(read("src/app/admin/(protected)/events/import/actions.ts"), /await analyzeEventText\(/);
  assert.match(read("src/app/(public)/account/business/[id]/import-event/actions.ts"), /await analyzeEventText\(/);
  // Detection is automatic for everyone (no Admin-only gate on the reader).
  assert.match(read("src/lib/event-import/engine.ts"), /const fields = extractStructuredEvent\(text, \{ now \}\);/);
  assert.doesNotMatch(read("src/lib/event-import/engine.ts"), /const fields = structured \? extractStructuredEvent/);
});

// ── U: URL import isolation ───────────────────────────────────────────────
const ARTICLE = (extra = "") => `<!doctype html><html><head>
<title>DUA by AB NYC pop-up extended through November 29 | HOLR</title>
<meta property="og:type" content="article">
<meta property="og:title" content="DUA by AB NYC pop-up extended through November 29">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"DUA by AB NYC pop-up extended"}</script>
</head><body>
<nav><a href="/events/fall-fashion-week">Fall Fashion Week — Nov 3, 2026</a></nav>
<main><article><h1>DUA by AB NYC pop-up extended through November 29</h1>
<p>The DUA by AB pop-up at 410 West 13th Street is open through November 29, 2026.</p></article></main>
<aside class="related-posts">
  <ul>
    <li><a href="https://holrmagazine.com/events/sneaker-con-nyc"><h3>Sneaker Con NYC</h3></a><p>December 5, 2026 · Javits Center</p></li>
    <li><a href="https://holrmagazine.com/events/holiday-market-bryant-park"><h3>Bryant Park Holiday Market</h3></a><p>November 14, 2026 · Bryant Park</p></li>
    <li><a href="https://holrmagazine.com/events/wine-fest"><h3>NYC Wine Fest</h3></a><p>November 21, 2026 · Pier 76</p></li>
  </ul>
</aside>
${extra}
<footer><a href="/events/newsletter-party">Newsletter Party — Dec 1, 2026</a></footer>
</body></html>`;

test("U. an article with 'related posts' cards is ONE page about its own subject — the recommendations are not imported", () => {
  const url = new URL("https://holrmagazine.com/dua-by-ab-nyc-pop-up-extended/");
  assert.deepEqual(S.classifySource(ARTICLE(), url, NOW), { kind: "single" });
  const read1 = X.extractEventCandidate(ARTICLE(), url, NOW);
  const titles = JSON.stringify(read1.candidate);
  for (const unrelated of ["Sneaker Con", "Bryant Park Holiday Market", "NYC Wine Fest", "Fall Fashion Week", "Newsletter Party"]) assert.ok(!titles.includes(unrelated), unrelated);
});

test("U. related / recommended / sidebar modules are skipped on non-article pages too", () => {
  const listing = (cls) => `<html><head><title>Venue</title></head><body><main><p>Welcome</p></main>
  <section class="${cls}"><ul>
    <li><a href="https://v.example/e/a"><h3>Alpha Night</h3></a><p>November 14, 2026 7 PM</p></li>
    <li><a href="https://v.example/e/b"><h3>Beta Night</h3></a><p>November 21, 2026 7 PM</p></li>
  </ul></section></body></html>`;
  const url = new URL("https://v.example/about");
  assert.equal(S.classifySource(listing("recommended-events"), url, NOW).kind, "single", "a recommendations module isn't the page's Events");
  assert.equal(S.classifySource(listing("event-list"), url, NOW).kind, "multi", "a genuine events listing still works (Admin bulk unaffected)");
});

test("U. an article that genuinely describes several Events is surfaced as AMBIGUOUS — nothing pre-selected", () => {
  const roundup = `<html><head><meta property="og:type" content="article"><title>5 pop-ups this weekend</title>
  <script type="application/ld+json">[{"@context":"https://schema.org","@type":"Event","name":"Alpha Pop-Up","startDate":"2026-11-14T11:00:00-05:00","url":"https://a.example/alpha"},{"@context":"https://schema.org","@type":"Event","name":"Beta Pop-Up","startDate":"2026-11-15T11:00:00-05:00","url":"https://b.example/beta"}]</script>
  </head><body><p>Our picks.</p></body></html>`;
  const c = S.classifySource(roundup, new URL("https://mag.example/5-popups"), NOW);
  assert.equal(c.kind, "multi");
  assert.equal(c.ambiguous, true);
  assert.match(read("src/app/(public)/account/business/[id]/import-event/MultiEventImport.tsx"), /new Set\(source\.ambiguous \? \[\] : defaultSelection\(events, intent\)\)/);
  assert.match(read("src/lib/event-import/engine.ts"), /This article mentions several Events, so Findmi can't tell which one you mean\./);
});

test("build guard: the client Event importer never reaches server-only code (schedule → text-clean, not brand-website-extract)", () => {
  const read = (f) => readFileSync(f, "utf8");
  const schedule = read("src/lib/event-import/schedule.ts");
  assert.match(schedule, /import \{ cleanText \} from "\.\.\/text-clean";/);
  assert.doesNotMatch(schedule, /brand-website-extract|business-matching/);
  assert.doesNotMatch(read("src/lib/text-clean.ts"), /^import /m, "dependency-free");
  for (const f of ["src/lib/event-import/review.ts", "src/lib/event-import/temporal.ts"]) assert.doesNotMatch(read(f), /server-only|business-matching|brand-website-extract/, f);
});
