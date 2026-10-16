// Event / Appearance quick view — Calendar action. The Calendar menu is
// portaled to <body>; at z-20 it opened BEHIND the z-50 quick-view dialogs,
// so tapping Calendar looked dead. The menu now stacks above them, flips
// above the trigger when there's no room below, and the occurrence sheet
// passes THAT occurrence's own times, venue/address and the Event's public
// canonical URL. Payload builders are exercised directly; component wiring
// is pinned with source guards (no rendering harness). No network/DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const C = await import("../src/lib/calendar.ts");

const read = (p) => readFileSync(p, "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const BUTTON = code(read("src/components/AddToCalendarButton.tsx"));
const SHEET = code(read("src/components/EventOccurrenceQuickView.tsx"));
const RAIL = code(read("src/components/UpcomingDatesRail.tsx"));
const EVENT_VIEW = code(read("src/app/(public)/event/[slug]/EventPublicView.tsx"));
const APPEARANCE = code(read("src/components/AppearanceQuickView.tsx"));

// Three dates of one Event, stored as exact instants (event_occurrences
// start_at/end_at are timestamptz) with their own IANA timezone.
const OCC = {
  oct20: { start_at: "2026-10-20T14:00:00+00:00", end_at: "2026-10-20T18:00:00+00:00", timezone: "America/New_York" },
  oct21: { start_at: "2026-10-21T15:30:00+00:00", end_at: "2026-10-21T20:00:00+00:00", timezone: "America/New_York" },
  oct22: { start_at: "2026-10-22T14:00:00+00:00", end_at: "2026-10-22T18:00:00+00:00", timezone: "America/New_York" },
};
const URL_ = "https://findmi.app/event/illy-cup-of-love";
const ics = (p) => Object.fromEntries(p.ics.split("\r\n").filter((l) => l.includes(":")).map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1)]));
const gcal = (p) => new URL(p.gcalUrl).searchParams;

// ── The selected occurrence is the calendar entry ────────────────────────
test("each occurrence produces its own date/time — never the first or a generic Event date", () => {
  const made = Object.fromEntries(
    Object.entries(OCC).map(([k, o]) => [k, C.buildCalendarPayload({ title: "Cup of Love", startAt: o.start_at, endAt: o.end_at, url: URL_ })])
  );
  assert.equal(ics(made.oct21).DTSTART, "20261021T153000Z");
  assert.equal(ics(made.oct21).DTEND, "20261021T200000Z");
  assert.equal(gcal(made.oct21).get("dates"), "20261021T153000Z/20261021T200000Z");
  assert.equal(ics(made.oct20).DTSTART, "20261020T140000Z");
  assert.equal(ics(made.oct22).DTSTART, "20261022T140000Z");
  assert.notEqual(ics(made.oct21).DTSTART, ics(made.oct20).DTSTART);
});

test("timezone: exact stored instants in UTC (Z) — the calendar app localizes; no conversion invented", () => {
  // 15:30Z is 11:30 in New York (EDT) — the same instant the sheet shows via
  // formatTimeInZone(start_at, timezone); a non-UTC offset input is normalized, not shifted.
  const p = C.buildCalendarPayload({ title: "x", startAt: "2026-10-21T11:30:00-04:00", endAt: "2026-10-21T16:00:00-04:00" });
  assert.equal(ics(p).DTSTART, "20261021T153000Z");
  assert.equal(ics(p).DTEND, "20261021T200000Z");
  assert.equal(C.toIcsDate("2026-03-08T07:00:00Z"), "20260308T070000Z", "DST boundary untouched");
});

// Event date/time precision (approved): the earlier 2-hour fallback was a
// fabricated end. A start-only date now exports its known start with NO
// Findmi-made end; a date with no published time exports as all-day.
test("end time: the real one when present; never invented when absent (start only / all-day)", () => {
  const withEnd = C.buildCalendarPayload({ title: "x", startAt: OCC.oct21.start_at, endAt: OCC.oct21.end_at });
  assert.equal(ics(withEnd).DTEND, "20261021T200000Z");
  const noEnd = C.buildCalendarPayload({ title: "x", startAt: OCC.oct21.start_at, endAt: null });
  assert.equal(ics(noEnd).DTSTART, "20261021T153000Z");
  assert.ok(!("DTEND" in ics(noEnd)), "no Findmi-made end");
  assert.equal(gcal(noEnd).get("dates"), "20261021T153000Z/20261021T153000Z", "Google: the start only (zero-length), never a guessed end");
  const dateOnly = C.buildCalendarPayload({ title: "x", startAt: null, endAt: null, date: "2026-10-16" });
  assert.match(dateOnly.ics, /DTSTART;VALUE=DATE:20261016\r\nDTEND;VALUE=DATE:20261017/);
  assert.equal(gcal(dateOnly).get("dates"), "20261016/20261017");
});

test("location: venue + address when available (escaped in .ics); omitted entirely when there is none", () => {
  const p = C.buildCalendarPayload({ title: "x", startAt: OCC.oct21.start_at, endAt: OCC.oct21.end_at, location: "Bryant Park, 6th Ave, New York, NY" });
  assert.equal(ics(p).LOCATION, "Bryant Park\\, 6th Ave\\, New York\\, NY");
  assert.equal(gcal(p).get("location"), "Bryant Park, 6th Ave, New York, NY");
  const none = C.buildCalendarPayload({ title: "x", startAt: OCC.oct21.start_at, endAt: OCC.oct21.end_at, location: null });
  assert.ok(!("LOCATION" in ics(none)));
  assert.equal(gcal(none).get("location"), null);
  assert.match(none.ics, /^BEGIN:VCALENDAR\r\n[\s\S]*END:VCALENDAR$/, "still a complete calendar file");
});

test("canonical Findmi link: in the Google details, the .ics DESCRIPTION and URL fields; nothing when absent", () => {
  const p = C.buildCalendarPayload({ title: "x", description: "Free coffee", startAt: OCC.oct21.start_at, endAt: OCC.oct21.end_at, url: URL_ });
  assert.equal(gcal(p).get("details"), `Free coffee\n\n${URL_}`);
  assert.equal(ics(p).URL, URL_);
  assert.equal(ics(p).DESCRIPTION, `Free coffee\\n\\n${URL_.replace(/,/g, "\\,")}`);
  const bare = C.buildCalendarPayload({ title: "x", startAt: OCC.oct21.start_at, endAt: OCC.oct21.end_at });
  assert.ok(!("URL" in ics(bare)) && !("DESCRIPTION" in ics(bare)));
  assert.equal(gcal(bare).get("details"), null);
});

// ── Sheet wiring ─────────────────────────────────────────────────────────
test("occurrence sheet: Calendar uses THIS occurrence's start/end, its displayed venue/address and the Event URL", () => {
  assert.match(SHEET, /<AddToCalendarButton\s+title=\{eventName\}\s+location=\{calendarLocation\}\s+url=\{eventUrl\}\s+startAt=\{occurrence\.start_at\}\s+endAt=\{occurrence\.end_at\}\s+date=\{occurrenceDate\}\s+layout="row"\s+\/>/);
  assert.match(SHEET, /const calendarLocation = \[venueLabel, fullAddress\]\.filter\(\(v, i, all\) => v && all\.indexOf\(v\) === i\)\.join\(", "\) \|\| null;/);
  // The sheet is opened for the tapped occurrence, not the first.
  assert.match(RAIL, /occurrence=\{openOccurrence\}/);
  assert.match(RAIL, /eventUrl=\{eventUrl\}/);
  // The URL is the same public canonical URL the page already shares/declares.
  assert.match(EVENT_VIEW, /eventUrl=\{canonicalUrl\}/);
  assert.match(EVENT_VIEW, /const canonicalUrl = await resolveCanonicalUrl\(event\.id, event\.slug\);/);
  assert.doesNotMatch(SHEET + RAIL, /\/admin|\/account\//, "never an admin/account destination");
});

test("Directions unchanged", () => {
  assert.match(SHEET, /const directionsHref = mapsQuery \? `https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=\$\{encodeURIComponent\(mapsQuery\)\}` : null;/);
  assert.match(SHEET, /<a\s+href=\{directionsHref\}\s+target="_blank"\s+rel="noreferrer"/);
  assert.match(APPEARANCE, /onClick=\{\(\) => trackEvent\(\{ event_name: "click_directions", \.\.\.analyticsFields \}\)\}/);
});

// ── The control ──────────────────────────────────────────────────────────
test("root cause fixed: the portaled menu stacks above the z-50 quick-view dialogs", () => {
  assert.match(SHEET, /className="fixed inset-0 z-50 /);
  assert.match(APPEARANCE, /className="fixed inset-0 z-50 /);
  assert.match(BUTTON, /createPortal\(\s*<div\s+ref=\{panelRef\}\s+role="menu"\s+aria-label="Add to Calendar"\s+className="fixed z-\[80\] /);
  assert.doesNotMatch(BUTTON, /fixed z-20/);
});

test("first tap: a real <button> that opens the menu on its own click — no timers, guards or swallowed taps", () => {
  assert.match(BUTTON, /<button\s+ref=\{triggerRef\}\s+type="button"/);
  const trigger = BUTTON.slice(BUTTON.indexOf("ref={triggerRef}"), BUTTON.indexOf("className={triggerClass}"));
  assert.match(trigger, /setOpen\(\(o\) => !o\);/);
  assert.doesNotMatch(BUTTON, /setTimeout|requestAnimationFrame|preventDefault|onPointerDown=|onTouchStart=/);
  // Each option is a real button acting on its own click (one more tap: pick Google or .ics).
  assert.match(BUTTON, /role="menuitem"\s+onClick=\{openGoogleCalendar\}/);
  assert.match(BUTTON, /role="menuitem"\s+onClick=\{downloadIcs\}/);
  // Outside-tap close never treats the trigger or the menu as "outside".
  assert.match(BUTTON, /if \(triggerRef\.current\?\.contains\(target\)\) return;\s*if \(panelRef\.current\?\.contains\(target\)\) return;/);
});

test("menu stays on screen: opens above the trigger when it wouldn't fit below (bottom sheets)", () => {
  assert.match(BUTTON, /const fitsBelow = rect\.bottom \+ 6 \+ MENU_HEIGHT <= window\.innerHeight;/);
  assert.match(BUTTON, /top: fitsBelow \? rect\.bottom \+ 6 : Math\.max\(8, rect\.top - 6 - MENU_HEIGHT\)/);
  assert.match(BUTTON, /const left = Math\.max\(8, Math\.min\(rect\.left, window\.innerWidth - \(layout === "icon" \? 232 : 200\)\)\);/, "never overhangs the right edge");
});

test("no parent navigation/close: the sheet stops clicks; the portaled menu's React events bubble to that stop", () => {
  assert.match(SHEET, /<div\s+onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  assert.match(SHEET, /role="dialog"\s+aria-modal="true"/);
  // The menu is a React child of the button (portal), so its clicks reach the
  // sheet's stopPropagation before the dialog's onClose backdrop handler.
  assert.ok(BUTTON.indexOf("createPortal(") > BUTTON.indexOf("ref={triggerRef}"));
});

test("accessibility: keyboard-native buttons, labelled, expanded state announced", () => {
  assert.match(BUTTON, /aria-haspopup="menu"\s+aria-expanded=\{open\}/);
  assert.doesNotMatch(BUTTON, /<div[^>]*onClick=/, "no clickable divs");
  // Enter/Space activate native <button type="button"> elements without extra handlers.
  assert.equal((BUTTON.match(/<button\s/g) ?? []).length, 3);
});

test("payload is built at tap time from the button's own props (never shared across rows)", () => {
  assert.match(BUTTON, /const payload = \(\) => buildCalendarPayload\(\{ title, description, location, url, startAt, endAt, date, endDate \}\);/);
  assert.match(BUTTON, /window\.location\.assign\(payload\(\)\.gcalUrl\);/);
  assert.match(BUTTON, /new Blob\(\[payload\(\)\.ics\], \{ type: "text\/calendar;charset=utf-8" \}\)/);
});
