// Appearance COUNTING vs PRESENTATION GROUPING (lib/findmi-here.ts).
// EVENT = the umbrella program; APPEARANCE = a Business showing up at a
// particular date/time/place. Counts count every normalized dated
// Appearance (canceled, superseded Event-level Primary Date projections and
// duplicate/range-mirror rows removed) — never collapsed by event_id.
// Compact surfaces may GROUP an Event's dates for presentation ("+ N More
// Dates") without changing any count. Fixtures mirror production Lavazza
// (one Tabli Event, all_dates participation, per-date rows + a superseded
// Primary Date row). Scenarios A–L. No network, no production DB.
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

const D = await import("../src/lib/data.ts");
const F = await import("../src/lib/findmi-here.ts");
const BD = await import("../src/lib/business-dashboard.ts");
const AQ = await import("../src/lib/admin/dashboard-queries.ts");

const H = 3600000;
const DAY = 24 * H;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

let seq = 0;
/** A real `appearances` row shape (one Business). */
function row({ event = null, occurrence = null, source = "manual", start, hours = 6, title = "Pop-Up", flyer = null }) {
  seq += 1;
  return {
    id: `a${seq}`,
    business_id: "biz",
    event_id: event,
    event_occurrence_id: occurrence,
    source,
    title,
    start_at: iso(start),
    end_at: iso(start + hours * H),
    created_at: iso(NOW - DAY),
    status: "confirmed",
    flyer_image_url: flyer,
    venue_name: "Eataly",
    city: "New York",
    state: "NY",
    description: null,
    event: event ? { slug: event, is_demo: false, name: `Event ${event}`, cover_image_url: null } : null,
  };
}
const standalone = (n, offsetDays = 1) =>
  Array.from({ length: n }, (_, i) => row({ start: NOW + (offsetDays + i) * DAY, title: `Stop ${i + 1}` }));
/** One all_dates participation exactly as appearance-event-sync writes it:
 * the Event-level Primary Date row + one official row per occurrence. */
function syncedEvent(eventId, dayOffsets) {
  return [
    row({ event: eventId, source: "official_participation", start: NOW + dayOffsets[0] * DAY, title: "Tabli" }),
    ...dayOffsets.map((d, i) =>
      row({ event: eventId, occurrence: `${eventId}-occ${i}`, source: "official_participation", start: NOW + d * DAY, title: "Tabli" })
    ),
  ];
}

/** The real Business-card pipeline minus the network: canonical
 * reconciliation (as the Business page) → per-business resolvers. */
async function summarize(rows, limit = 4) {
  const reconciled = D.reconcileBusinessActivity({
    businessId: "biz",
    rows: D.dedupeAppearances(rows),
    eventLinkIds: [],
    occurrences: [],
    events: new Map(),
  })
    .filter((r) => new Date(r.end_at).getTime() > NOW)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const hints = await D.resolveUpcomingAppearanceHints(["biz"], limit, async () => reconciled);
  const counts = await D.resolveUpcomingAppearanceCounts(["biz"], async () => F.countUpcomingAppearances(reconciled));
  return { preview: hints.get("biz") ?? [], count: counts.get("biz") ?? 0 };
}

// ── Counting ──────────────────────────────────────────────────────────────
const TEN = [0.2, 1, 6, 7, 8, 13, 14, 15, 20, 21]; // production-shaped: Fri/Sat/Sun runs

test("A. one standalone upcoming Appearance => count 1", async () => {
  assert.equal((await summarize(standalone(1))).count, 1);
});

test("B. ten occurrence-linked dated Appearances of one Event => count 10 (never collapsed by event_id)", async () => {
  const occOnly = syncedEvent("tabli", TEN).filter((r) => r.event_occurrence_id);
  assert.equal(occOnly.length, 10);
  assert.equal((await summarize(occOnly)).count, 10);
});

test("C. the superseded Event-level Primary Date row does not make it 11 (production Lavazza shape)", async () => {
  // Primary Date row on a past date (as production's Oct 3 row) + the same
  // instant as a past occurrence row + 10 upcoming dated rows.
  const past = syncedEvent("tabli", [-7, -1]); // Primary Date row (−7d) + 2 past dated rows
  const upcoming = syncedEvent("tabli", TEN).filter((r) => r.event_occurrence_id);
  const { count } = await summarize([...past, ...upcoming]);
  assert.equal(count, 10);
  // Even when the Primary Date row's own date is upcoming, it is superseded.
  assert.equal((await summarize(syncedEvent("tabli", TEN))).count, 10);
});

test("C2. a dated row on the Event's range-mirror occurrence is a mirror, not another Appearance", async () => {
  const events = new Map([["tabli", { id: "tabli", slug: "tabli", name: "Tabli", cover_image_url: null, start_at: iso(NOW - 5 * DAY), end_at: iso(NOW + 25 * DAY), venue_name: null, address: null, city: null, state: null }]]);
  const mirror = { ...row({ event: "tabli", occurrence: "mirror", source: "official_participation", start: NOW - 5 * DAY }), end_at: iso(NOW + 25 * DAY) };
  const dated = syncedEvent("tabli", [1, 2]).filter((r) => r.event_occurrence_id);
  const reconciled = D.reconcileBusinessActivity({ businessId: "biz", rows: [mirror, ...dated], eventLinkIds: [], occurrences: [], events });
  assert.deepEqual(reconciled.map((r) => r.event_occurrence_id).sort(), dated.map((r) => r.event_occurrence_id).sort());
});

test("D. canceled Appearances never count — every activity read excludes them", () => {
  const src = readFileSync("src/lib/data.ts", "utf8");
  const start = src.indexOf("async function getUpcomingBusinessActivity");
  const fnSrc = src.slice(start, src.indexOf("export async function getUpcomingAppearanceSummaries", start));
  const appearanceReads = fnSrc.split('.from("appearances")').length - 1;
  const canceledFilters = fnSrc.split('.neq("status", "canceled")').length - 1;
  assert.equal(appearanceReads, 3);
  assert.equal(canceledFilters, 3, "every appearances read excludes canceled rows");
});

test("E. two different standalone Appearances remain count 2 (never merged, even with equal titles)", async () => {
  const rows = standalone(2).map((r) => ({ ...r, title: "Pop-Up" }));
  const { count, preview } = await summarize(rows);
  assert.equal(count, 2);
  assert.equal(preview.length, 2);
});

test("E2. counting is explicit and separate from grouping", () => {
  const rows = syncedEvent("tabli", TEN).filter((r) => r.event_occurrence_id);
  assert.equal(F.countUpcomingAppearances(rows), 10);
  assert.equal(F.groupAppearancesForPreview(rows).length, 1, "presentation groups ≠ count");
  const src = readFileSync("src/lib/data.ts", "utf8");
  assert.match(src, /resolveUpcomingAppearanceCounts\(businessIds, async \(id\) => countUpcomingAppearances\(/);
  assert.doesNotMatch(readFileSync("src/lib/findmi-here.ts", "utf8"), /appearanceIdentityKey|groupAppearanceActivities/);
});

// ── Preview (presentation grouping) ───────────────────────────────────────
test("F. a multi-date Event previews ONCE with '+ N More Dates' while the count stays the number of dated Appearances", async () => {
  const rows = syncedEvent("tabli", TEN).filter((r) => r.event_occurrence_id);
  const { count, preview } = await summarize(rows);
  assert.equal(count, 10);
  assert.equal(preview.length, 1);
  assert.equal(preview[0].moreDates, 9);
  assert.equal(preview[0].href, "/event/tabli");
  const card = readFileSync("src/components/BusinessLogoCard.tsx", "utf8");
  assert.match(card, /`\+ \$\{moreDates\} More Dates`/);
  assert.match(card, /\{totalUpcoming === 1 \? "1 Upcoming Appearance" : `\$\{totalUpcoming\} Upcoming Appearances`\}/);
});

test("G. a multi-date Event does not crowd unrelated standalone Appearances out of the preview", async () => {
  const many = syncedEvent("tabli", Array.from({ length: 12 }, (_, i) => 1 + i)).filter((r) => r.event_occurrence_id);
  const rows = [...many, row({ start: NOW + 20 * DAY, title: "Farmers Market" }), row({ event: "fall", start: NOW + 21 * DAY, title: "Fall Fest" })];
  const { count, preview } = await summarize(rows);
  assert.equal(count, 14);
  assert.deepEqual(preview.map((h) => [h.venue, h.moreDates]), [["Tabli", 11], ["Farmers Market", 0], ["Fall Fest", 0]]);
});

test("G2. preview limit smaller than the total never changes the total; the read pages exhaustively", async () => {
  const rows = [...syncedEvent("tabli", TEN).filter((r) => r.event_occurrence_id), ...standalone(7, 30)];
  const { count, preview } = await summarize(rows, 4);
  assert.equal(count, 17);
  assert.equal(preview.length, 4);
  const src = readFileSync("src/lib/data.ts", "utf8");
  const start = src.indexOf("async function getUpcomingBusinessActivity");
  const fnSrc = src.slice(start, src.indexOf("export async function getUpcomingAppearanceSummaries", start));
  assert.doesNotMatch(fnSrc, /\.limit\(/);
  assert.match(fnSrc, /reconcileBusinessActivity\(/, "same normalization as the Business page");
});

// ── Account Home ──────────────────────────────────────────────────────────
function dash({ id, eventId = null, startOffsetH, hours = 6 }) {
  const live = startOffsetH <= 0 && startOffsetH + hours > 0;
  return {
    id,
    title: eventId ? "Lavazza Tabli" : `Standalone ${id}`,
    startAt: iso(NOW + startOffsetH * H),
    endAt: iso(NOW + (startOffsetH + hours) * H),
    eventId,
    temporal: { live, label: live ? "NOW" : "SOON" },
  };
}

test("H. Account Home groups an Event's dates into one row (+ N More Dates) without changing the count", () => {
  const rows = TEN.map((d, i) => dash({ id: `d${i}`, eventId: "tabli", startOffsetH: i === 0 ? -2 : d * 24 }));
  const { live, comingUp } = BD.buildHomeActivities(rows);
  assert.deepEqual(live.map((a) => a.id), ["d0"]);
  assert.equal(comingUp.length, 1);
  assert.equal(comingUp[0].appearance.id, "d1");
  assert.equal(comingUp[0].moreDates, 8, "9 not-yet-live dates: the next one + 8 more");
  // The grouped row represents those dated Appearances; the canonical count is untouched.
  assert.equal(F.countUpcomingAppearances(rows.map((r) => ({ id: r.id, event_id: r.eventId, start_at: r.startAt, end_at: r.endAt }))), 10);
  // "+ N More Dates" comes from the FULL schedule when the loaded list is paged.
  assert.equal(BD.buildHomeActivities(rows.slice(0, 2), new Map([["event:tabli", 30]])).comingUp[0].moreDates, 29);
  const home = readFileSync("src/app/(public)/account/business/[id]/v2/BusinessHome.tsx", "utf8");
  assert.match(home, /`\+ \$\{moreDates\} More Dates`/);
});

test("H2. Account Home: standalone Appearances stay separate rows; full-schedule date counts use the same normalization", () => {
  const { comingUp } = BD.buildHomeActivities([dash({ id: "s1", startOffsetH: 24 }), dash({ id: "s2", startOffsetH: 48 })]);
  assert.deepEqual(comingUp.map((c) => [c.appearance.id, c.moreDates]), [["s1", 0], ["s2", 0]]);
  const counts = BD.countUpcomingDatesPerPreviewGroup(syncedEvent("tabli", [1, 6, 7, 8]), new Set(["tabli"]), NOW);
  assert.equal(counts.get("event:tabli"), 4, "superseded Primary Date row not counted");
});

/** Minimal service-role stand-in: events lookup only (no Market/Area ids). */
const fakeAdmin = (events) => ({ from: () => ({ select: () => ({ in: async () => ({ data: events }) }) }) });
const source = (over) => ({
  id: "x", title: "Lavazza Tabli", start_at: iso(NOW - H), end_at: iso(NOW + 5 * H), venue_name: "Eataly Chiosco",
  address: null, city: null, state: null, flyer_image_url: null, event_id: null, event_occurrence_id: null, participationStatus: null, ...over,
});
const GEO = { primaryMarketId: null, marketAreaId: null };
const TABLI_EVENT = [{ id: "tabli", name: "Tabli", slug: "tabli", is_demo: false, cover_image_url: "https://x/tabli-cover.jpg", market_id: null, market_area_id: null }];

test("H3. Happening Now image: flyer, else Event cover, else gallery/cover, else logo — before any placeholder", async () => {
  const imgs = { galleryImages: ["https://x/g1.jpg"], coverUrl: "https://x/cover.jpg", logoUrl: "https://x/logo.png" };
  const { appearances } = await BD.resolveDashboardAppearances(fakeAdmin(TABLI_EVENT), "biz",
    [source({ id: "ev", event_id: "tabli" }), source({ id: "own", flyer_image_url: "https://x/flyer.jpg" }), source({ id: "bare" })], GEO, imgs);
  const byId = Object.fromEntries(appearances.map((a) => [a.id, a]));
  assert.equal(byId.ev.displayImageUrl, "https://x/tabli-cover.jpg");
  assert.equal(byId.own.displayImageUrl, "https://x/flyer.jpg");
  assert.equal(byId.bare.displayImageUrl, "https://x/g1.jpg");
  const logoOnly = await BD.resolveDashboardAppearances(fakeAdmin([]), "biz", [source({ id: "bare" })], GEO, { galleryImages: [], coverUrl: null, logoUrl: "https://x/logo.png" });
  assert.equal(logoOnly.appearances[0].displayImageUrl, "https://x/logo.png");
});

test("H4. optional-flyer warning only when the Appearance has no image of its own (its Event's cover counts)", async () => {
  const base = { businessId: "biz", hasPrimaryMarket: true, pendingMarketRequestText: null, newOrderCount: 0, profileIncomplete: false };
  const { appearances } = await BD.resolveDashboardAppearances(fakeAdmin(TABLI_EVENT), "biz", [source({ id: "ev", event_id: "tabli" })], GEO);
  assert.equal(BD.buildNeedsAttentionItems({ ...base, upcomingAppearances: appearances }).length, 0);
  const bare = await BD.resolveDashboardAppearances(fakeAdmin([]), "biz", [source({ id: "bare" })], GEO);
  assert.match(BD.buildNeedsAttentionItems({ ...base, upcomingAppearances: bare.appearances })[0].message, /has no flyer image yet/);
});

// ── Admin Today (presentation folding) ────────────────────────────────────
const biz = (name) => ({ id: name.toLowerCase().replace(/\W+/g, "-"), name, logo_url: `https://x/${name}-logo.png`, cover_image_url: null });
function todayAppearance({ business, event = null, occurrence = null, source = "official_participation", flyer = null, eventCover = null, startH = -1 }) {
  seq += 1;
  return {
    id: `t${seq}`, title: business.name, start_at: iso(NOW + startH * H), end_at: iso(NOW + (startH + 6) * H), venue_name: "Eataly",
    flyer_image_url: flyer, event_id: event, event_occurrence_id: occurrence, source, created_at: iso(NOW - DAY), business,
    event: event ? { cover_image_url: eventCover, is_demo: false } : null,
  };
}
const occ = (id, eventId, name, cover = null, startH = -1, extra = {}) => ({
  id, start_at: iso(NOW + startH * H), end_at: iso(NOW + (startH + 6) * H), venue_name: "Eataly", event: { id: eventId, name, cover_image_url: cover, ...extra },
});

test("I. Admin Today folds today's participation Appearance into its Event row (Lavazza + Tabli, Free Bean + its Pop-Up) — display only", () => {
  const items = AQ.buildTodayActivity(
    [
      todayAppearance({ business: biz("Lavazza"), event: "tabli", occurrence: "tabli-today" }),
      todayAppearance({ business: biz("Free Bean"), event: "fb", occurrence: "fb-today" }),
      todayAppearance({ business: biz("Free Bean"), event: "fb" }), // Primary Date projection
    ],
    [occ("tabli-today", "tabli", "Lavazza Tabli Sampling", "https://x/t.jpg"), occ("fb-today", "fb", "Free Bean NYC Pop-Up")]
  );
  assert.deepEqual(items.map((i) => [i.kind, i.title, i.withBusinesses]).sort(), [
    ["event", "Free Bean NYC Pop-Up", ["Free Bean"]],
    ["event", "Lavazza Tabli Sampling", ["Lavazza"]],
  ]);
  // Folding lives only in buildTodayActivity — the count/preview path never imports it.
  assert.doesNotMatch(readFileSync("src/lib/data.ts", "utf8"), /buildTodayActivity/);
});

test("I2. Admin Today keeps genuinely independent rows; hides an Event's range mirror; rows carry deterministic images", () => {
  const lav = biz("Lavazza");
  const range = { start_at: iso(NOW - 12 * DAY), end_at: iso(NOW + 18 * DAY) };
  const items = AQ.buildTodayActivity(
    [
      todayAppearance({ business: lav, source: "manual", flyer: "https://x/flyer.jpg", startH: 1 }),
      todayAppearance({ business: lav, event: "nr", eventCover: "https://x/nr.jpg", startH: 2 }),
      todayAppearance({ business: lav, source: "manual", startH: 3 }),
    ],
    [
      { id: "mirror", ...range, venue_name: null, event: { id: "ev", name: "Pop-Up", cover_image_url: "https://x/ev.jpg", ...range } },
      occ("o1", "ev", "Pop-Up", "https://x/ev.jpg", 4, range),
      occ("o2", "ev2", "Coverless", null, 5),
    ]
  );
  assert.deepEqual(items.map((i) => [i.id.split("-")[0], i.imageUrl]), [
    ["appearance", "https://x/flyer.jpg"],
    ["appearance", "https://x/nr.jpg"],
    ["appearance", "https://x/Lavazza-logo.png"],
    ["occurrence", "https://x/ev.jpg"],
    ["occurrence", null],
  ]);
  const page = readFileSync("src/app/admin/(protected)/page.tsx", "utf8");
  assert.match(page, /item\.title\.charAt\(0\)\.toUpperCase\(\)/);
});

// ── Business detail schedule ──────────────────────────────────────────────
test("J. Business Upcoming Schedule stays date-based; Featured uses presentation grouping only", () => {
  const view = readFileSync("src/app/(public)/business/[slug]/BusinessPublicView.tsx", "utf8");
  assert.match(view, /const appearances = collapseEventDates\(activity\.upcoming\);/);
  assert.match(view, /appearances=\{scheduleAppearances\}/);
  const section = readFileSync("src/components/AppearanceFindMiHere.tsx", "utf8");
  assert.match(section, />Upcoming Schedule<\/h2>/);
  assert.match(section, /total=\{appearances\.length\}/);
  assert.match(section, /noun="Dates"/);
});

// ── Card layout ───────────────────────────────────────────────────────────
test("K. Featured Business cards are equal height: card fills its rail slot, CTA anchored, fixed-footprint preview", () => {
  const card = readFileSync("src/components/BusinessLogoCard.tsx", "utf8");
  assert.match(card, /className="group relative flex h-full w-full flex-col rounded-3xl/);
  assert.match(card, /className="relative flex flex-1 flex-col gap-1 rounded-b-3xl p-3\.5"/);
  assert.match(card, /className="mt-auto flex items-center gap-0\.5 pt-1 text-xs font-bold uppercase/);
  assert.match(card, /<div className="relative h-24 w-full shrink-0 overflow-hidden bg-black\/5">/);
  assert.match(card, /flex h-16 flex-col justify-center/);
  for (const rail of ["src/components/HomepageBusinessRow.tsx", "src/components/Section.tsx"]) {
    assert.doesNotMatch(readFileSync(rail, "utf8"), /items-start/, `${rail} rail must keep flex stretch`);
  }
});

// ── Messaging OFF ─────────────────────────────────────────────────────────
test("L. messaging disabled => no direct or replacement communication CTA on Business/Event/Location", () => {
  const gate = readFileSync("src/lib/message-visibility.ts", "utf8");
  const paused = gate.indexOf("if (!isDirectBusinessMessagingEnabled()) return false;");
  assert.ok(paused > -1 && paused < gate.indexOf("getServerSupabase()"));
  for (const page of [
    "src/app/(public)/business/[slug]/BusinessPublicView.tsx",
    "src/app/(public)/event/[slug]/EventPublicView.tsx",
    "src/app/(public)/location/[slug]/LocationPublicView.tsx",
  ]) {
    assert.match(readFileSync(page, "utf8"), /messagingEnabled=\{isDirectBusinessMessagingEnabled\(\)\}/, page);
  }
});
