// Public Event detail page — Upcoming Dates section / "N upcoming dates"
// count are redundant presentation for an Event with 0 or exactly 1
// upcoming occurrence (the primary WHEN block already shows that one
// date). This is conditional RENDERING only: the truthful upcoming-
// occurrence collection (datedOccurrences, threaded unchanged into
// EventOccurrenceProvider / UpcomingDatesRail / EventScheduleSummary) is
// never recomputed or redefined here — only whether the section/count
// renders. Source-pattern checks only (same convention as the rest of
// this Server Component's test coverage) — no database, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const VIEW = read("src/app/(public)/event/[slug]/EventPublicView.tsx");
const SUMMARY = read("src/components/EventScheduleSummary.tsx");
const RAIL = read("src/components/UpcomingDatesRail.tsx");

test("Upcoming Dates section renders only with 2+ upcoming dates — same datedOccurrences collection, no new counting", () => {
  // The gate is the one real, truthful collection (end_at > now,
  // already-synthesized Primary Date and range-mirrors excluded) — the
  // exact same array passed to EventOccurrenceProvider (selection context,
  // so EventScheduleSummary's own count reads it too) and to the rail
  // itself. One collection, one threshold, no second "upcoming" definition.
  assert.match(VIEW, /const datesSection =\s*\n\s*datedOccurrences\.length > 1 \? \(/);
  assert.doesNotMatch(VIEW, /datedOccurrences\.length > 0 \? \(\s*\n\s*<section id="dates"/);
  assert.match(VIEW, /<EventOccurrenceProvider occurrences=\{datedOccurrences\}>/);
});

test("0 upcoming occurrences: Upcoming Dates section absent, no spacer — datesSection is null and sits in a flex-gap column", () => {
  // datedOccurrences.length === 0 fails the `> 1` gate exactly like
  // length === 1 does — both fall through to the `: null` branch.
  assert.match(VIEW, /\) : null;\s*\n\s*(\/\/[^\n]*\n\s*)*const momentsSection/);
  // The column that renders datesSection uses a flex gap (not fixed
  // spacers/min-heights), so a null child simply collapses — the next
  // section (Moments) moves up on its own.
  assert.match(VIEW, /className=\{`order-4 mt-8 flex flex-col gap-9/);
  assert.match(VIEW, /\{datesSection\}\s*\n\s*\{momentsSection\}/);
});

test("exactly 1 upcoming occurrence: Upcoming Dates section absent (datedOccurrences.length > 1 is false for length 1)", () => {
  // Same gate as the 0-occurrence case — no separate "is it exactly one"
  // branch was invented; `length > 1` already covers both 0 and 1.
  const gate = VIEW.match(/const datesSection =\s*\n\s*datedOccurrences\.length > 1 \? \(/);
  assert.ok(gate, "single gate covers both 0 and 1 — no second definition of upcoming");
});

test("exactly 1 upcoming occurrence: the redundant '1 upcoming date' count is hidden in the primary WHEN block", () => {
  assert.match(SUMMARY, /const countLabel = dateCount > 1 \? `\$\{dateCount\} upcoming dates` : null;/);
  assert.doesNotMatch(SUMMARY, /dateCount > 0 \? `\$\{dateCount\} upcoming date/, "must not fall back to the old > 0 threshold");
  assert.doesNotMatch(SUMMARY, /1 upcoming date(?!s)/, "the literal singular count string must not appear in source");
});

test("2 upcoming occurrences: Upcoming Dates section present with its full rail (cards, Quick View, rosters, tickets/RSVP) unchanged", () => {
  assert.match(
    VIEW,
    /<section id="dates" className="scroll-mt-24">\s*\n\s*<UpcomingDatesRail\s*\n\s*occurrences=\{datedOccurrences\}/
  );
  // The rail still receives every prop it did before this pass — nothing
  // was stripped out of the 2+ case to make room for the 0/1 suppression.
  for (const prop of [
    "eventName={event.name}",
    "eventId={event.id}",
    "eventUrl={canonicalUrl}",
    "canonicalLocation={canonicalLocation}",
    "ticketsEnabled={event.tickets_enabled}",
    "ticketsUrl={event.tickets_url}",
    "rsvpEnabled={event.rsvp_enabled}",
    "rostersByOccurrence={rostersByOccurrence}",
  ]) {
    assert.ok(VIEW.includes(prop), `UpcomingDatesRail still passes ${prop}`);
  }
});

test("2 upcoming occurrences: primary WHEN block can truthfully show the count; 3+ uses the same threshold, not a special multi-date case", () => {
  // `> 1` is a single boundary — true for 2, true for 3, true for 50 — no
  // separate "3 or more" branch exists or is needed.
  assert.match(SUMMARY, /const countLabel = dateCount > 1 \?/);
  assert.doesNotMatch(SUMMARY, /dateCount > 2/, "no separate 3+ threshold was introduced");
  assert.doesNotMatch(SUMMARY, /dateCount === 2/, "no special-cased exactly-2 branch was introduced");
});

test("occurrence card rail behavior (view toggle, 'View all N', per-date Quick View) is untouched by this pass", () => {
  assert.match(RAIL, /const hasMore = occurrences\.length > VISIBLE_COUNT;/);
  assert.match(RAIL, /\{count > 1 && \(\s*\n\s*<ViewToggle/);
  assert.match(RAIL, /onOpenQuickView=\{setOpenId\}/);
  // The rail's own internal count label logic (used only once 2+ dates
  // ever reach it) is unchanged — this pass only decides whether the
  // rail mounts at all, never how it counts once it does.
  assert.match(RAIL, /\$\{count\} upcoming date\$\{count === 1 \? "" : "s"\}/);
});

test("private/TBA Location presentation is unaffected — locationHidden branch in WHEN/WHERE untouched by the count change", () => {
  assert.match(VIEW, /<EventScheduleSummary\n\s+locationHidden=\{locationHidden\}/);
  assert.match(
    SUMMARY,
    /locationHidden \? \(\n\s+<WhereFact name=\{HIDDEN_LOCATION_COPY\} lines=\{\[cityState\(selected\.city, selected\.state\)\]\} \/>/
  );
  // Cancelled-date status and the "Next: …" status line (both independent
  // of the count label) are unchanged.
  assert.match(SUMMARY, /if \(selectedState === "cancelled"\) \{/);
  assert.match(SUMMARY, /\} else if \(dateCount > 1 && selectedState !== "current"\) \{/);
});

test("no Event/Occurrence persistence behavior changed — this pass touches only conditional rendering", () => {
  assert.doesNotMatch(VIEW, /\.from\("event_occurrences"\)\.(insert|update|delete)/);
  assert.doesNotMatch(VIEW, /\.from\("events"\)\.(insert|update|delete)/);
  assert.doesNotMatch(SUMMARY, /\.from\(/);
  // The underlying collections themselves are untouched — only consumed.
  assert.match(VIEW, /const realOccurrences = upcomingOccurrences\.filter\(\(o\) => !isPrimaryDateId\(o\.id\)\);/);
  assert.match(VIEW, /const datedOccurrences = withoutRangeMirrors\(realOccurrences, event\);/);
});
