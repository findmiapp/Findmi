// B2 — Business Home Coming Up = the Business's actual upcoming Findmi
// activity: its Appearances AND the Events it hosts (events.host_business_id),
// one item per Event, deduplicated by canonical Event id (never by title).
// Calls the real buildHomeComingUp; no network, no database.
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

const BD = await import("../src/lib/business-dashboard.ts");
const { getTemporalLabel } = await import("../src/lib/format.ts");

const H = 3600e3;
const at = (h) => new Date(Date.now() + h * H).toISOString();

/** A resolved Appearance (DashboardAppearance), only the fields Home reads. */
const appearance = ({ id, title = id, startH, durH = 4, eventId = null, status = null }) => {
  const startAt = at(startH);
  const endAt = at(startH + durH);
  return {
    id, title, startAt, endAt, eventId, venueName: "Venue", geographyLabel: null, city: null, state: null,
    participationStatus: status, statusLabel: status === "pending" ? "Pending" : "Confirmed",
    temporal: getTemporalLabel(startAt, endAt), managementHref: `/account/business/biz?tab=findmi-here&editing=${id}`,
    displayImageUrl: null,
  };
};
/** A hosted Event summary, as the page builds it from events + event_occurrences. */
const hosted = ({ eventId, name = eventId, dates, statusLabel = null }) => ({
  eventId, name, where: "Hall", statusLabel, imageUrl: null,
  href: `/account/event/${eventId}?business_id=biz`,
  dates: dates.map(([s, d = 3]) => ({ startAt: at(s), endAt: at(s + d) })),
});
const keys = (list) => list.map((i) => `${i.kind}:${i.title}`);

test("A. Appearance only → one appearance row", () => {
  const r = BD.buildHomeComingUp([appearance({ id: "market", startH: 24 })], []);
  assert.deepEqual(r.live, []);
  assert.deepEqual(keys(r.comingUp), ["appearance:market"]);
  assert.equal(r.comingUp[0].href, "/account/business/biz?tab=findmi-here&editing=market");
});

test("B. hosted Event only (no Appearance row) → it appears, opening the Event Manager with this Business", () => {
  const r = BD.buildHomeComingUp([], [hosted({ eventId: "launch", dates: [[48], [72], [96]] })]);
  assert.deepEqual(keys(r.comingUp), ["hosted_event:launch"]);
  assert.equal(r.comingUp[0].key, "event:launch");
  assert.equal(r.comingUp[0].moreDates, 2, "next date + 2 more");
  assert.equal(r.comingUp[0].href, "/account/event/launch?business_id=biz");
});

test("C. hosted Event + this Business's official Appearance for the same Event → ONE item (deduped by Event id)", () => {
  const apps = [
    appearance({ id: "occ-appearance", title: "Spring Launch (appearance)", startH: 48, eventId: "launch" }),
    appearance({ id: "event-level", title: "Different Title Entirely", startH: 50, eventId: "launch" }),
  ];
  const r = BD.buildHomeComingUp(apps, [hosted({ eventId: "launch", name: "Spring Launch", dates: [[48]] })]);
  assert.deepEqual(keys(r.comingUp), ["hosted_event:Spring Launch"]);
  assert.equal(new Set([...r.live, ...r.comingUp].map((i) => i.key)).size, r.live.length + r.comingUp.length, "no key twice");
});

test("C2. identity is the Event id, not the title: a same-titled Appearance of ANOTHER Event stays", () => {
  const r = BD.buildHomeComingUp([appearance({ id: "x", title: "Spring Launch", startH: 30, eventId: "other-event" })], [hosted({ eventId: "launch", name: "Spring Launch", dates: [[48]] })]);
  assert.deepEqual(keys(r.comingUp), ["appearance:Spring Launch", "hosted_event:Spring Launch"]);
});

test("D. unrelated hosted Event + Appearance → both, chronologically", () => {
  const r = BD.buildHomeComingUp(
    [appearance({ id: "late-market", startH: 96 }), appearance({ id: "early-popup", startH: 12 })],
    [hosted({ eventId: "tasting", dates: [[40]] })]
  );
  assert.deepEqual(keys(r.comingUp), ["appearance:early-popup", "hosted_event:tasting", "appearance:late-market"]);
});

test("E. a hosted Event happening now → Happening Now; its next date still listed in Coming Up", () => {
  const r = BD.buildHomeComingUp([appearance({ id: "tomorrow", startH: 24 })], [hosted({ eventId: "weekly", dates: [[-1, 3], [24 * 7]] })]);
  assert.deepEqual(keys(r.live), ["hosted_event:weekly"]);
  assert.equal(r.live[0].temporal.live, true);
  assert.deepEqual(keys(r.comingUp), ["appearance:tomorrow", "hosted_event:weekly"]);
  assert.equal(r.comingUp.find((i) => i.kind === "hosted_event").moreDates, 0);
  // a single-date live hosted Event is only in Happening Now
  const once = BD.buildHomeComingUp([], [hosted({ eventId: "once", dates: [[-1, 3]] })]);
  assert.deepEqual([keys(once.live), keys(once.comingUp)], [["hosted_event:once"], []]);
});

test("Happening Now merges live Appearances and live hosted Events, earliest start first", () => {
  const r = BD.buildHomeComingUp([appearance({ id: "pop", startH: -2, durH: 5 })], [hosted({ eventId: "fair", dates: [[-1, 4]] })]);
  assert.deepEqual(keys(r.live), ["appearance:pop", "hosted_event:fair"]);
});

test("F. no upcoming activity → nothing (Home shows its single empty line)", () => {
  const r = BD.buildHomeComingUp([], [hosted({ eventId: "past-only", dates: [] })]);
  assert.deepEqual([r.live, r.comingUp, r.total], [[], [], 0]);
});

test("compact: Coming Up is capped (default 4) and `total` keeps the real count for See All", () => {
  const apps = Array.from({ length: 5 }, (_, i) => appearance({ id: `a${i}`, startH: 10 + i * 24 }));
  const r = BD.buildHomeComingUp(apps, [hosted({ eventId: "h", dates: [[11]] })]);
  assert.equal(r.comingUp.length, 4);
  assert.equal(r.total, 6);
  assert.deepEqual(keys(r.comingUp), ["appearance:a0", "hosted_event:h", "appearance:a1", "appearance:a2"]);
});

test("not-yet-public hosted Event keeps its review label; a pending participation keeps its chip", () => {
  const r = BD.buildHomeComingUp([appearance({ id: "req", startH: 5, eventId: "e2", status: "pending" })], [hosted({ eventId: "draft-ev", dates: [[6]], statusLabel: "In Review" })]);
  assert.deepEqual(r.comingUp.map((i) => i.pendingLabel), ["Pending", "In Review"]);
});

test("G/H. Free and Pro: Coming Up has no plan logic (core Findmi activity is open)", () => {
  const src = readFileSync("src/lib/business-dashboard.ts", "utf8");
  const fn = src.slice(src.indexOf("export function buildHomeComingUp"), src.indexOf("/** Not-yet-live upcoming dated Appearances"));
  assert.doesNotMatch(fn, /\bpro\b|plan_tier|isBusinessPro/i);
});

test("page: hosted Events come from the existing host_business_id + event_occurrences reads; nothing is written", () => {
  const page = readFileSync("src/app/(public)/account/business/[id]/page.tsx", "utf8");
  assert.match(page, /\.select\("id, name, slug, start_at, end_at, venue_name, city, state, is_demo, publication_status, cover_image_url"\)\s*\.eq\("host_business_id", id\)/);
  assert.match(page, /upcomingDates: upcoming\.map\(\(o\) => \(\{ startAt: o\.start_at, endAt: o\.end_at \}\)\),/);
  assert.match(page, /href: `\/account\/event\/\$\{h\.id\}\?business_id=\$\{encodeURIComponent\(id\)\}`,/);
  const fn = readFileSync("src/lib/business-dashboard.ts", "utf8");
  const helper = fn.slice(fn.indexOf("export function buildHomeComingUp"), fn.indexOf("/** Not-yet-live upcoming dated Appearances"));
  assert.doesNotMatch(helper, /insert|upsert|\.from\(/, "pure: no Appearance is manufactured");
});
