// Public Event-date display: Featured never removes a date from Findmi Here,
// occurrence-aware Event links, the "Details" cue, and same-day ordering.
// Pure functions + source checks only — no database, no network.
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

const L = await import("../src/lib/event-links.ts");
const T = await import("../src/lib/event-time.ts");
const read = (p) => readFileSync(p, "utf8");
const BUSINESS = read("src/app/(public)/business/[slug]/BusinessPublicView.tsx");
const CONTEXT = read("src/components/EventOccurrenceContext.tsx");
const DATA = read("src/lib/data.ts");

test("1–3. Featured live date stays in Findmi Here; Featured card still renders; later dates stay", () => {
  assert.match(BUSINESS, /const scheduleAppearances = activity\.upcoming;/);
  assert.doesNotMatch(BUSINESS, /upcoming\.filter\(\(a\) => a\.id !== featuredAppearance/);
  assert.match(BUSINESS, /appearances=\{scheduleAppearances\}/);
  // The Featured card is unchanged: same resolver, same live "Until …" line.
  assert.match(BUSINESS, /const featuredAppearance = resolveBusinessHero\(appearances, \{ overrideId: featuredOverrideId, featuredEvents: activity\.featuredEvents \}\)\?\.item \?\? null;/);
  assert.match(BUSINESS, /\? `Until \$\{formatTime\(featuredAppearance\.end_at\)\}`/);
  assert.match(BUSINESS, /\{featuredAppearance && \(/);
});

test("4. a link for one date carries ?occurrence=<id>; a generic Event link stays plain", () => {
  assert.equal(L.eventHref("trace"), "/event/trace");
  assert.equal(L.eventHref("trace", null), "/event/trace");
  assert.equal(L.eventHref("trace", "bd1e814e-80e8-4994-8c85-2b7960c1ca00"), "/event/trace?occurrence=bd1e814e-80e8-4994-8c85-2b7960c1ca00");
  const dates = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(L.requestedOccurrence("?occurrence=b", dates)?.id, "b");
  // The Event page's shared date selection honors it as the visitor's pick.
  assert.match(CONTEXT, /const requested = requestedOccurrence\(window\.location\.search, occurrences\);\s*if \(!requested\) return;\s*setHasManualSelection\(true\);\s*setSelectedId\(requested\.id\);/);
});

test("5–6. invalid, missing, stale or another Event's date fails safe to the normal live / next default", () => {
  const dates = [{ id: "a" }, { id: "b" }];
  for (const search of ["", "?", "?occurrence=", "?occurrence=zzz", "?other=a", "?occurrence=%E0%A4%A", "not a query"]) {
    assert.equal(L.requestedOccurrence(search, dates), null, search);
  }
  // Another Event's date id is simply not among THIS page's dates.
  assert.equal(L.requestedOccurrence("?occurrence=other-event-date", dates), null);
  assert.equal(L.requestedOccurrence("?occurrence=a", []), null, "no dates listed → nothing selected");
});

test("deep links are added only where a card IS one date", () => {
  // Business: the Featured card and the Findmi Here Quick View for an Event date.
  assert.match(BUSINESS, /\? eventHref\(featuredAppearance\.event!\.slug, featuredAppearance\.event_occurrence_id\)/);
  const qv = read("src/components/AppearanceQuickView.tsx");
  assert.equal(qv.match(/href=\{eventHref\(appearance\.event!\.slug, appearance\.event_occurrence_id\)\}/g).length, 2);
  assert.match(read("src/components/AppearanceCard.tsx"), /href=\{eventHref\(eventSlug!, appearance\.event_occurrence_id\)\}/);
  // Location: each What's Happening Here Event row is one date.
  assert.match(DATA, /href: eventHref\(e\.slug, row\.id as string\),/);
  // Event-level participation (no specific date) keeps a null occurrence id → a plain link.
  assert.match(DATA, /event_occurrence_id: null,/);
  // Generic Event links elsewhere are untouched.
  assert.match(read("src/components/ConnectionCard.tsx"), /href=\{`\/event\/\$\{event\.slug\}`\}/);
});

test("7–8. a date with details shows a Details cue; one without shows none", () => {
  const hint = read("src/components/OccurrenceDetailsHint.tsx");
  assert.match(hint, /if \(!\(show \?\? Boolean\(details\?\.trim\(\)\)\)\) return null;/, "nothing without non-empty details");
  assert.match(hint, />\s*Details\s*</, "Title Case label");
  assert.match(read("src/components/EventOccurrenceCard.tsx"), /<OccurrenceDetailsHint details=\{occurrence\.details\} className="mt-1" \/>/);
  assert.match(read("src/components/UpcomingDatesRail.tsx"), /<OccurrenceDetailsHint details=\{occurrence\.details\} className="mt-1" \/>/);
  const loc = read("src/components/LocationHappeningCollection.tsx");
  assert.equal(loc.match(/<OccurrenceDetailsHint show=\{Boolean\(item\.hasDetails\)\}/g).length, 2, "Location Cards and List");
  assert.match(DATA, /hasDetails: Boolean\(\(row\.details as string \| null\)\?\.trim\(\)\),/);
  // The details themselves stay off compact cards (Quick View / selected date show them).
  assert.doesNotMatch(read("src/components/EventOccurrenceCard.tsx"), />\{occurrence\.details/, "never rendered as text on the card");
  assert.match(read("src/components/EventOccurrenceQuickView.tsx"), /occurrence\.details\?\.trim\(\) &&/);
});

const occ = (id, date, start, place) => ({ id, occurrence_date: date, start_at: start, end_at: null, timezone: "America/New_York", location: place ? { name: place } : null, venue_name: null });
const byPlace = T.compareScheduleOccurrences((o) => o.location?.name ?? o.venue_name);

test("9–10. same-day untimed dates sort by Location name; known times still come first", () => {
  const rows = [
    occ("z1", "2026-10-16", null, "World Press Photo"),
    occ("z2", "2026-10-16", null, "Magnum Photos"),
    occ("z3", "2026-10-16", null, "fujifilm Brand House"),
    occ("z4", "2026-10-16", "2026-10-16T14:00:00.000Z", "World Press Photo"),
    occ("z5", "2026-10-16", null, null),
    occ("z6", "2026-10-15", null, "Zeta"),
    occ("z7", "2026-10-16", "2026-10-16T13:00:00.000Z", "Zeta"),
  ];
  assert.deepEqual([...rows].sort(byPlace).map((r) => r.id), ["z6", "z7", "z4", "z3", "z2", "z1", "z5"]);
  // Identical place → stable id tie-break.
  assert.deepEqual([occ("b", "2026-10-16", null, "Hall"), occ("a", "2026-10-16", null, "Hall")].sort(byPlace).map((r) => r.id), ["a", "b"]);
  // Applied to both public Event-date reads.
  assert.equal(DATA.match(/\.sort\(compareScheduleOccurrences\(\(o\) => o\.location\?\.name \?\? o\.venue_name\)\);/g).length, 2);
});

test("11–12. date-only dates never gain a time and are never Happening Now", () => {
  const dateOnly = occ("d", "2026-10-16", null, "Magnum Photos");
  assert.equal(T.formatWhen(dateOnly), "Friday, October 16");
  assert.equal(T.isHappeningNow(dateOnly, new Date("2026-10-16T18:00:00Z")), false);
  assert.equal(T.temporalLabelFor(dateOnly, new Date("2026-10-16T18:00:00Z")).live, false);
  const card = read("src/components/EventOccurrenceCard.tsx");
  assert.match(card, /if \(!occurrence\.start_at\) \{[\s\S]*?timeLabel: ""/);
  assert.match(card, /timeLabel && <p className="text-xs font-medium text-ink\/55">\{timeLabel\}<\/p>/, "no empty time row");
  assert.match(read("src/components/UpcomingDatesRail.tsx"), /timeLabel && <span className="mt-0\.5 block truncate text-metadata text-secondary">\{timeLabel\}<\/span>/);
  assert.match(card, /const live = !cancelled && isHappeningNow\(occurrence\);/);
  // Sorting never invents a time.
  assert.equal([dateOnly].sort(byPlace)[0].start_at, null);
});
