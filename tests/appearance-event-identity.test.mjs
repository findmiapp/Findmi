// Business card Appearance count — EVENT IDENTITY != SCHEDULE OCCURRENCES.
// A multi-date Event participation projects one appearance row per date
// (lib/appearance-event-sync.ts). The BusinessLogoCard preview and its
// "N Upcoming Appearances" label must count that participation ONCE
// (collapseEventDates), on every surface that renders the card. No
// network, no production DB. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const D = await import("../src/lib/data.ts");

const row = (id, event_id, start, end, title = "Lavazza Tabli") => ({
  id,
  event_id,
  business_id: "lavazza",
  title,
  start_at: start,
  end_at: end,
  flyer_image_url: null,
  venue_name: null,
  city: null,
  state: null,
  description: null,
  event: event_id ? { slug: "tabli", is_demo: false, name: "Tabli", cover_image_url: null } : null,
});

// The reported case: four dates of the same Tabli activation (Event-level
// Primary Date row + per-occurrence rows) — one Appearance, not four.
const TABLI = [
  row("primary", "evt-tabli", "2026-10-17T14:00:00Z", "2026-10-17T22:00:00Z"),
  row("occ-1", "evt-tabli", "2026-10-17T14:00:00Z", "2026-10-17T22:00:00Z"),
  row("occ-2", "evt-tabli", "2026-10-18T14:00:00Z", "2026-10-18T22:00:00Z"),
  row("occ-3", "evt-tabli", "2026-10-24T14:00:00Z", "2026-10-24T22:00:00Z"),
];

const fetcher = (rows) => async (_id, limit) => rows.slice(0, limit);

test("all dates of one Event participation preview as ONE Appearance", async () => {
  const hints = await D.resolveUpcomingAppearanceHints(["lavazza"], 4, fetcher(TABLI));
  assert.equal(hints.get("lavazza").length, 1);
  assert.equal(hints.get("lavazza")[0].href, "/event/tabli");
});

test("a multi-date Event can't crowd distinct Appearances out of the preview", async () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    row(`occ-${i}`, "evt-tabli", `2026-10-${String(11 + i).padStart(2, "0")}T14:00:00Z`, `2026-10-${String(11 + i).padStart(2, "0")}T22:00:00Z`)
  );
  const rows = [...many, row("solo", null, "2026-11-01T14:00:00Z", "2026-11-01T22:00:00Z", "Farmers Market"), row("other", "evt-b", "2026-11-02T14:00:00Z", "2026-11-02T22:00:00Z", "Fall Fest")];
  let requested = 0;
  const hints = await D.resolveUpcomingAppearanceHints(["lavazza"], 4, async (id, limit) => {
    requested = limit;
    return rows.slice(0, limit);
  });
  assert.ok(requested > 4, "over-fetches candidate rows before collapsing");
  assert.deepEqual(hints.get("lavazza").map((h) => h.venue), ["Lavazza Tabli", "Farmers Market", "Fall Fest"]);
});

test("standalone Appearances are never merged, even with the same title", async () => {
  const rows = [row("a", null, "2026-10-17T14:00:00Z", "2026-10-17T22:00:00Z", "Pop-Up"), row("b", null, "2026-10-18T14:00:00Z", "2026-10-18T22:00:00Z", "Pop-Up")];
  const hints = await D.resolveUpcomingAppearanceHints(["lavazza"], 4, fetcher(rows));
  assert.equal(hints.get("lavazza").length, 2);
});

test("preview still capped at limitPerBusiness distinct Appearances", async () => {
  const rows = Array.from({ length: 9 }, (_, i) => row(`s${i}`, null, `2026-10-1${i}T14:00:00Z`, `2026-10-1${i}T22:00:00Z`, `Stop ${i}`));
  const hints = await D.resolveUpcomingAppearanceHints(["lavazza"], 4, fetcher(rows));
  assert.equal(hints.get("lavazza").length, 4);
});

test("static guard: the count counts standalone rows + distinct Events, and keeps the fair resolver", () => {
  const src = readFileSync("src/lib/data.ts", "utf8");
  const start = src.indexOf("export async function getUpcomingAppearanceCounts");
  const fnSrc = src.slice(start, start + 1600);
  assert.match(fnSrc, /\.is\("event_id", null\)/);
  assert.match(fnSrc, /\.not\("event_id", "is", null\)/);
  assert.match(fnSrc, /new Set\(/);
  assert.match(fnSrc, /\(count \?\? 0\) \+ events\.size/);
  assert.match(fnSrc, /resolveUpcomingAppearanceCounts\(/);
  assert.match(src, /import \{ collapseEventDates \} from "\.\/findmi-here";/);
});

test("static guard: /businesses Featured cards pass the true count, not the preview length", () => {
  const page = readFileSync("src/app/(public)/businesses/page.tsx", "utf8");
  assert.match(page, /getUpcomingAppearanceCounts\(featuredBusinesses\.map\(\(b\) => b\.id\)\)/);
  assert.match(page, /totalUpcomingAppearances=\{featuredUpcomingCounts\.get\(b\.id\)\}/);
});

test("static guard: Business detail schedule lists dates, labeled as a schedule — never as Appearances", () => {
  const section = readFileSync("src/components/AppearanceFindMiHere.tsx", "utf8");
  assert.match(section, />Upcoming Schedule<\/h2>/);
  assert.match(section, /noun="Dates"/);
  assert.doesNotMatch(section, />Upcoming Appearances</);
  assert.doesNotMatch(section, /noun="Appearances"/);
  // Data behavior unchanged: the schedule still receives every date, the
  // Featured card still collapses per Event.
  const view = readFileSync("src/app/(public)/business/[slug]/BusinessPublicView.tsx", "utf8");
  assert.match(view, /const appearances = collapseEventDates\(activity\.upcoming\);/);
  assert.match(view, /appearances=\{scheduleAppearances\}/);
});
