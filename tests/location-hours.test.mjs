// Location Hours UX — explicit "Open 24 Hours" days, the Open 24/7
// shortcut, Copy To selected days, Hours as its own Location Manager tab,
// and the public Open Now / Closed rendering.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const H = await import("../src/lib/locationHours.ts");
const read = (p) => readFileSync(p, "utf8");

const NINE_FIVE = { closed: false, open: "09:00", close: "17:00" };
const ALL_DAY = { closed: false, allDay: true };
// Local wall-clock moments (the helpers use the visitor's local clock).
const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min);
const TUE = [2026, 10, 13]; // Tuesday
const WED = [2026, 10, 14];

// ── Location Manager tab ─────────────────────────────────────────────
test("Hours has its own Location Manager tab and is no longer inside Profile", () => {
  const page = read("src/app/(public)/account/location/[id]/page.tsx");
  assert.match(page, /\{ key: "overview", label: "Overview" \},\s*\{ key: "happening", label: "What's Happening" \},[\s\S]*?\{ key: "hours", label: "Hours" \},\s*\{ key: "profile", label: "Profile" \},/);
  const hoursTab = page.slice(page.indexOf('{tab === "hours" && ('), page.indexOf('{tab === "profile" && ('));
  assert.match(hoursTab, /<LocationHoursField name="hours" defaultValue=\{location\.hours\} \/>/);
  const profileTab = page.slice(page.indexOf('{tab === "profile" && ('));
  assert.doesNotMatch(profileTab, /LocationHoursField|updateMemberLocationHours/, "not duplicated in Profile");
  assert.equal((page.match(/<LocationHoursField /g) ?? []).length, 1);
  const actions = read("src/app/(public)/account/location/actions.ts");
  assert.match(actions, /export async function updateMemberLocationHours[\s\S]{0,200}\?tab=hours`/, "saving returns to the Hours tab");
  assert.match(actions, /normalizeLocationHours\(JSON\.parse\(hoursRaw\)\)/);
});

// ── 24 hours ─────────────────────────────────────────────────────────
test("one day Open 24 Hours: no times needed, shown as 'Open 24 Hours', open at every minute of that day", () => {
  const hours = { tue: ALL_DAY, wed: NINE_FIVE };
  assert.equal(H.formatDayHoursCompact(hours.tue), "Open 24 Hours");
  assert.equal(H.formatDayHours(hours.tue), "Open 24 Hours");
  for (const [h, m] of [[0, 0], [0, 1], [6, 30], [12, 0], [23, 59]]) {
    assert.deepEqual(H.getHoursStatus(hours, at(...TUE, h, m)), { open: true, detail: "Open 24 Hours" }, `${h}:${m}`);
  }
  // The next day is an ordinary day again.
  assert.deepEqual(H.getHoursStatus(hours, at(...WED, 8, 0)), { open: false, detail: "Opens 9 AM" });
  assert.deepEqual(H.getHoursStatus(hours, at(...WED, 10, 0)), { open: true, detail: "Until 5 PM" });
  // Closed the night before a 24-hour day.
  assert.deepEqual(H.getHoursStatus({ mon: NINE_FIVE, tue: ALL_DAY }, at(2026, 10, 12, 20, 0)), { open: false, detail: "Opens 12 AM Tomorrow" });
  assert.deepEqual(H.normalizeLocationHours({ tue: { closed: false, allDay: true } }), { tue: { closed: false, allDay: true } }, "times not required");
});

test("Open 24/7: every day becomes Open 24 Hours, the status says 'Open 24/7', and each day stays editable", () => {
  const all = H.setAllDaysOpen24({ mon: NINE_FIVE, sat: { closed: true } });
  for (const { key } of H.LOCATION_WEEKDAYS) assert.equal(H.isAllDay(all[key]), true, key);
  assert.equal(H.isOpen247(all), true);
  assert.deepEqual(H.getHoursStatus(all, at(...TUE, 3, 0)), { open: true, detail: "Open 24/7" });
  assert.equal(all.mon.open, "09:00", "previous times remembered for switching back");
  const edited = { ...all, sun: { closed: true } };
  assert.equal(H.isOpen247(edited), false);
  assert.deepEqual(H.getHoursStatus(edited, at(...TUE, 3, 0)), { open: true, detail: "Open 24 Hours" });
});

// ── Copy To ──────────────────────────────────────────────────────────
test("Copy Monday to Tue–Fri: only selected days change", () => {
  const start = { mon: NINE_FIVE, tue: { closed: false, open: "10:00", close: "14:00" }, sat: { closed: false, open: "11:00", close: "16:00" } };
  const out = H.copyDayHours(start, "mon", ["tue", "wed", "thu", "fri"]);
  for (const k of ["mon", "tue", "wed", "thu", "fri"]) assert.deepEqual(out[k], NINE_FIVE, k);
  assert.deepEqual(out.sat, start.sat, "unselected day unchanged");
  assert.equal(out.sun, undefined, "untouched day stays untouched");
  assert.deepEqual(start.tue, { closed: false, open: "10:00", close: "14:00" }, "input not mutated");
});

test("copying a 24-hour day (and a closed day) copies the whole state; editing a copy never changes the source", () => {
  const start = { sat: ALL_DAY, mon: NINE_FIVE, tue: { closed: true } };
  const out = H.copyDayHours(start, "sat", ["sun", "mon"]);
  assert.equal(H.isAllDay(out.sun), true);
  assert.equal(H.isAllDay(out.mon), true);
  out.sun.allDay = false;
  out.sun.open = "08:00";
  assert.equal(H.isAllDay(out.sat), true, "source unaffected");
  const closed = H.copyDayHours(out, "tue", ["wed"]);
  assert.deepEqual(closed.wed, { closed: true });
});

test("the editor wires Copy To, Open 24/7 and the per-day 24 Hours option", () => {
  const ui = read("src/components/admin/LocationHoursField.tsx");
  assert.match(ui, /\{ key: "allDay", label: "24 Hours" \}/);
  assert.match(ui, /setHours\(\(prev\) => copyDayHours\(prev, copyFrom, copyTargets\)\)/);
  assert.match(ui, /setHours\(\(prev\) => setAllDaysOpen24\(prev\)\)/);
  assert.match(ui, /\{mode === "hours" && \(/, "time inputs only for set hours");
  assert.match(ui, /Copy \{label\}&rsquo;s Hours To/);
});

// ── existing behavior ────────────────────────────────────────────────
test("existing normal hours, closed days and 12:00 AM – 11:59 PM rows are unchanged (never auto-reinterpreted)", () => {
  const hours = { tue: NINE_FIVE, wed: { closed: true } };
  assert.equal(H.formatDayHoursCompact(hours.tue), "9 AM – 5 PM");
  assert.equal(H.formatDayHours(hours.tue), "9:00 AM - 5:00 PM");
  assert.equal(H.formatDayHoursCompact(hours.wed), "Closed");
  assert.deepEqual(H.getHoursStatus(hours, at(...TUE, 12, 0)), { open: true, detail: "Until 5 PM" });
  assert.deepEqual(H.getHoursStatus(hours, at(...TUE, 18, 0)), { open: false, detail: null }, "Wednesday closed → no 'opens tomorrow'");
  // A legacy "all day" row keeps its literal meaning until the owner switches it.
  const legacy = { closed: false, open: "00:00", close: "23:59" };
  assert.equal(H.isAllDay(legacy), false);
  assert.equal(H.formatDayHoursCompact(legacy), "12 AM – 11:59 PM");
  assert.equal(H.looksLikeAllDay(legacy), true, "the editor offers the switch");
  assert.deepEqual(H.normalizeLocationHours({ tue: legacy }), { tue: legacy });
});

test("normalizeLocationHours keeps only the known shape", () => {
  assert.equal(H.normalizeLocationHours(null), null);
  assert.equal(H.normalizeLocationHours({}), null);
  assert.deepEqual(
    H.normalizeLocationHours({ mon: { closed: false, open: "9am", close: "17:00" }, tue: { closed: "yes" }, xyz: ALL_DAY, wed: { closed: true, open: "09:00" }, thu: { closed: false, allDay: true, open: "<b>", close: "17:00" } }),
    { wed: { closed: true }, thu: { closed: false, allDay: true } }
  );
});

test("public page: the week list and status use the shared helpers (24-hour days render 'Open 24 Hours')", () => {
  const ui = read("src/components/LocationHours.tsx");
  assert.match(ui, /formatDayHoursCompact\(hours\?\.\[key\]\)/);
  assert.match(ui, /getHoursStatus\(hours, now\)/);
  assert.match(ui, /\{isToday && <span className="text-findmi-700"> · Today<\/span>\}/);
});
