// Location hours correctness — missing / unset hours are UNKNOWN, never
// "Closed". Three states only: Open (within configured hours), Closed
// (outside configured hours, or a day explicitly marked Closed), and
// Not Set (no usable hours) — for which Open/Closed is never computed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const H = await import("../src/lib/locationHours.ts");
const read = (p) => readFileSync(p, "utf8");
const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min);
const TUE_NOON = at(2026, 10, 13, 12);
const TUE_EVENING = at(2026, 10, 13, 20);
const NINE_FIVE = { closed: false, open: "09:00", close: "17:00" };

const UNKNOWN = [
  ["missing (undefined)", undefined],
  ["null", null],
  ["empty object", {}],
  ["empty array", []],
  ["non-empty array", [NINE_FIVE]],
  ["a string", "9-5"],
  ["days present but empty", { mon: {}, tue: {} }],
  ["open flag without times", { tue: { closed: false } }],
  ["malformed times", { tue: { closed: false, open: "9am", close: "5pm" } }],
  ["unknown keys only", { monday: NINE_FIVE }],
];

test("missing / null / empty / structurally-empty hours are never Closed (nor Open)", () => {
  for (const [label, hours] of UNKNOWN) {
    assert.equal(H.hasAnyHours(hours), false, label);
    assert.equal(H.isOpenNow(hours), null, label);
    assert.equal(H.getHoursStatus(hours, TUE_NOON), null, label);
    assert.equal(H.getHoursStatus(hours, TUE_EVENING), null, label);
    assert.equal(H.getHoursSummaryLabel(hours), null, label);
  }
});

test("a day with nothing set is unknown — the rest of the week doesn't make it Closed", () => {
  const weekdaysOnly = { mon: NINE_FIVE, wed: NINE_FIVE };
  assert.equal(H.hasAnyHours(weekdaysOnly), true);
  assert.equal(H.getHoursStatus(weekdaysOnly, TUE_NOON), null, "Tuesday not set → no status at all");
  assert.equal(H.dayHoursState(undefined), "unset");
  assert.equal(H.formatDayHoursCompact(undefined), "Hours Not Set");
  assert.equal(H.formatDayHours({ closed: false }), "Hours Not Set");
});

test("valid configured hours still produce Open and Closed", () => {
  const hours = { tue: NINE_FIVE, wed: { closed: true } };
  assert.deepEqual(H.getHoursStatus(hours, TUE_NOON), { open: true, detail: "Until 5 PM" });
  assert.deepEqual(H.getHoursStatus(hours, TUE_EVENING), { open: false, detail: null });
  assert.deepEqual(H.getHoursStatus(hours, at(2026, 10, 13, 8)), { open: false, detail: "Opens 9 AM" });
  // An explicitly Closed day is Closed.
  assert.deepEqual(H.getHoursStatus(hours, at(2026, 10, 14, 12)), { open: false, detail: null });
  assert.equal(H.formatDayHoursCompact({ closed: true }), "Closed");
  assert.deepEqual(H.getHoursStatus({ tue: { closed: false, allDay: true } }, TUE_EVENING), { open: true, detail: "Open 24 Hours" });
});

test("public UI suppresses status when hours are unknown, and never lists an unset day as Closed", () => {
  const ui = read("src/components/LocationHours.tsx");
  // Both public surfaces render nothing without a computed status.
  assert.match(ui, /export function LocationHoursStatus[\s\S]*?if \(!status\) return null;/);
  assert.match(ui, /export function LocationOpenBadge[\s\S]*?if \(!status\) return null;/);
  assert.match(ui, /LOCATION_WEEKDAYS\.filter\(\(\{ key \}\) => dayHoursState\(hours\?\.\[key\]\) !== "unset"\)/);
  // The Location page only mounts the Hours bar for usable hours.
  const page = read("src/app/(public)/location/[slug]/LocationPublicView.tsx");
  assert.match(page, /const showHours = hasAnyHours\(location\.hours\);/);
  assert.match(page, /\{showHours && <LocationHoursStatus hours=\{location\.hours\} \/>\}/);
  // No other public surface computes a Location open/closed state.
  assert.match(read("src/components/OurLocations.tsx"), /<LocationOpenBadge hours=\{location\.hours\} \/>/);
});

test("Admin / editing identifies the state as Hours Not Set (unset days are never pre-selected as Closed)", () => {
  assert.equal(H.HOURS_NOT_SET, "Hours Not Set");
  const editor = read("src/components/admin/LocationHoursField.tsx");
  assert.match(editor, /\{!hasAnyHours\(hours\) && <span[^>]*>\{HOURS_NOT_SET\}<\/span>\}/);
  assert.match(editor, /function modeOf\(day: LocationDayHours \| undefined\): Mode \| null \{\n\s+const state = dayHoursState\(day\);\n\s+return state === "unset" \? null : state;/);
  assert.match(editor, /\{mode === null && <span[^>]*>Not Set<\/span>\}/);
  // Location Manager's attention prompt uses the same usable-hours rule.
  assert.match(read("src/app/(public)/account/location/[id]/page.tsx"), /const missingHours = !hasAnyHours\(location\.hours\);/);
});
