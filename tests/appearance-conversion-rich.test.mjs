// Rich Appearance → Event conversion: a legacy thin schedule item plus a
// recovered, identity-checked Event candidate becomes ONE Event + its
// Occurrence + the SAME item; images go through the one Event image path.
// Fake clients / generated images only — no network, no production data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import sharp from "sharp";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/headers") return { url: "data:text/javascript,export const cookies=async()=>({get(){return undefined}});export const headers=async()=>new Map();", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const C = await import("../src/lib/appearance-conversion.ts");
const M = await import("../src/lib/event-import/media.ts");
const B = await import("../src/lib/brand-images.ts");
const read = (p) => readFileSync(p, "utf8");

const CORGI_NYC = "660d3744-dc88-4e91-856c-c0a296c9e776";
// The legacy Corgi item as it is in production (thin: no description/image).
const LEGACY = {
  id: "d6c7cdd0-c72d-4151-b2fd-ecb3522b8f7e", business_id: "corgi", title: "Founder GTM Mixer: From Idea to First Users", description: null,
  start_at: "2026-10-13T21:30:00+00:00", end_at: "2026-10-14T00:00:00+00:00", status: "confirmed", event_id: null, location_id: CORGI_NYC,
  venue_name: "Corgi Cafe NYC", address: "121 East 27th Street", city: "Manhattan", state: "NY", latitude: null, longitude: null,
  external_url: "https://luma.com/nyc-gtm-mixer", flyer_image_url: null, market_id: "m1", market_area_id: null,
};
// What re-reading https://luma.com/nyc-gtm-mixer through the importer yields.
const RECOVERED = {
  title: "Founder GTM Mixer: From Idea to First Users", description: "Founders share how they found their first 100 users.",
  imageUrl: "https://images.lumacdn.com/event-covers/nyc-gtm-mixer.jpg", sourceUrl: "https://lu.ma/nyc-gtm-mixer", platform: "Luma",
  occurrences: [{ start: "2026-10-13T21:30:00.000Z", end: "2026-10-14T00:30:00.000Z", hasTime: true, venue: { name: "Corgi Cafe", address: null, city: "New York", state: "NY", postalCode: null }, evidence: null }],
  online: false, organizer: "Corgi NYC", sources: { title: "structured", dates: "structured", organizer: "structured" }, persistAs: "event",
};

function fakeAdmin({ appearance = LEGACY, eventsByUrl = {}, failOn = null } = {}) {
  const ops = [];
  let n = 0;
  const builder = (table) => {
    const filters = [];
    const api = {
      select: () => api, neq: () => api, is: () => api, in: () => api, limit: () => api,
      eq: (k, v) => (filters.push([k, v]), api),
      maybeSingle: async () => ({ data: table === "appearances" ? appearance : null }),
      then: (resolve) => resolve({ data: table === "events" ? (eventsByUrl[filters.find(([k]) => k === "external_url")?.[1]] ?? []) : [] }),
      insert: (row) => {
        const failed = failOn === table;
        if (!failed) ops.push({ op: "insert", table, row });
        const id = `${table}-${++n}`;
        return { select: () => ({ single: async () => (failed ? { data: null, error: { message: "boom" } } : { data: { id }, error: null }) }) };
      },
      upsert: (row) => (ops.push({ op: "upsert", table, row }), Promise.resolve({ error: failOn === table ? { message: "boom" } : null })),
      update: (patch) => {
        const rec = { op: "update", table, patch, where: [] };
        ops.push(rec);
        const chain = { eq: (k, v) => (rec.where.push([k, v]), chain), is: (k, v) => (rec.where.push([k, v]), chain), then: (r) => r({ error: failOn === `${table}.update` ? { message: "boom" } : null }) };
        return chain;
      },
    };
    return api;
  };
  return { ops, client: { from: builder } };
}
const deps = (over = {}) => ({ uniqueEventSlug: async () => "founder-gtm-mixer", recovered: RECOVERED, storeImage: async (u) => `https://findmi.supabase.co/storage/v1/object/public/findmi-media/${encodeURIComponent(u).slice(-12)}.webp`, ...over });

// ── rich conversion ───────────────────────────────────────────────────
test("A–H/O: legacy thin item + validated recovery → ONE rich Event + Occurrence at the confirmed Location; the SAME item linked; participant, not host", async () => {
  const { client, ops } = fakeAdmin();
  const out = await C.convertAppearanceToEvent(client, LEGACY.id, deps());
  assert.equal(out.status, "converted");
  assert.equal(out.appearanceId, LEGACY.id, "B: same identity");
  assert.equal(out.image, "stored");
  const ev = ops.find((o) => o.table === "events" && o.op === "insert").row;
  assert.equal(ev.name, RECOVERED.title);
  assert.equal(ev.description, RECOVERED.description, "C");
  assert.match(ev.cover_image_url, /^https:\/\/findmi\.supabase\.co\/storage\/.*findmi-media/, "D: re-hosted in Findmi storage, not the Luma URL");
  assert.equal(ev.external_url, RECOVERED.sourceUrl, "E");
  assert.deepEqual([ev.host_business_id, ev.is_demo, ev.publication_status, ev.organizer_name], [null, true, "pending_review", "Corgi NYC"], "H/I: organizer is a name only");
  assert.deepEqual([ev.start_at, ev.end_at], [RECOVERED.occurrences[0].start, RECOVERED.occurrences[0].end], "the source's own time");
  const occ = ops.find((o) => o.table === "event_occurrences").row;
  assert.deepEqual([occ.location_id, occ.venue_name, occ.address], [CORGI_NYC, "Corgi Cafe NYC", "121 East 27th Street"], "F/G: confirmed Location kept although the source says 'Corgi Cafe'");
  assert.deepEqual(ops.filter((o) => o.op === "upsert").map((o) => [o.table, o.row.status]), [["event_businesses", "approved"], ["event_occurrence_businesses", "approved"]]);
  assert.equal(ops.find((o) => o.table === "event_businesses").row.participation_scope, "all_dates");
  const link = ops.find((o) => o.op === "update" && o.table === "appearances");
  assert.deepEqual(link.where, [["id", LEGACY.id], ["event_id", null]]);
  assert.equal(link.patch.event_id, out.eventId);
  assert.equal(link.patch.event_occurrence_id, out.occurrenceId);
  assert.equal(link.patch.end_at, RECOVERED.occurrences[0].end, "its date follows the recovered source time");
  assert.equal(ops.filter((o) => o.op === "insert" && o.table === "appearances").length, 0, "O: never a second item");
  assert.equal(ops.filter((o) => o.op === "insert" && o.table === "events").length, 1);
  assert.deepEqual(out.warnings, [], "'Corgi Cafe' is compatible with 'Corgi Cafe NYC'");
});

test("G: different source venue wording still keeps the confirmed Location (and says so)", async () => {
  const { client, ops } = fakeAdmin();
  const recovered = { ...RECOVERED, occurrences: [{ ...RECOVERED.occurrences[0], venue: { name: "The Back Room", address: null, city: "New York", state: "NY", postalCode: null } }] };
  const out = await C.convertAppearanceToEvent(client, LEGACY.id, deps({ recovered }));
  assert.equal(ops.find((o) => o.table === "event_occurrences").row.location_id, CORGI_NYC);
  assert.ok(out.warnings.some((w) => /confirmed Findmi Location is kept/.test(w)));
});

test("identity: J title, K source link and L date mismatches refuse before ANY write", async () => {
  for (const [recovered, reason] of [
    [{ ...RECOVERED, title: "Spooktober Movie Night" }, "title_mismatch"],
    [{ ...RECOVERED, sourceUrl: "https://luma.com/spooktober-movie-night" }, "source_mismatch"],
    [{ ...RECOVERED, occurrences: [{ ...RECOVERED.occurrences[0], start: "2026-10-20T21:30:00.000Z", end: "2026-10-21T00:00:00.000Z" }] }, "date_mismatch"],
  ]) {
    const { client, ops } = fakeAdmin();
    const out = await C.convertAppearanceToEvent(client, LEGACY.id, deps({ recovered }));
    assert.deepEqual([out.status, out.reason], ["refused", reason]);
    assert.equal(ops.length, 0, reason);
  }
  assert.equal(C.compatibleTitle("🧠 AI Founders Roundtable with The AI Collective NY x Avahi", "AI Founders Roundtable with The AI Collective NY x Avahi"), true);
  assert.equal(C.sameSourceLink("https://luma.com/nyc-gtm-mixer?tk=1", "https://lu.ma/nyc-gtm-mixer"), true);
});

test("M: image recovery failure is explicit and substitutes nothing", async () => {
  const { client, ops } = fakeAdmin();
  const out = await C.convertAppearanceToEvent(client, LEGACY.id, deps({ storeImage: async () => null }));
  assert.equal(out.image, "failed");
  assert.equal(ops.find((o) => o.table === "events").row.cover_image_url, null, "no calendar/business/other image put in its place");
  assert.ok(out.warnings.some((w) => /no image was substituted/.test(w)));
});

test("N: an Event already carrying either link is never duplicated", async () => {
  for (const url of [LEGACY.external_url, RECOVERED.sourceUrl]) {
    const { client, ops } = fakeAdmin({ eventsByUrl: { [url]: [{ id: "ev-existing" }] } });
    assert.deepEqual(await C.convertAppearanceToEvent(client, LEGACY.id, deps()), { status: "skipped", reason: "source_event_exists", eventId: "ev-existing" });
    assert.equal(ops.length, 0);
  }
});

test("P: a failure mid-way soft-trashes the new Event and leaves the item untouched", async () => {
  for (const failOn of ["event_occurrences", "event_businesses"]) {
    const { client, ops } = fakeAdmin({ failOn });
    const out = await C.convertAppearanceToEvent(client, LEGACY.id, deps());
    assert.equal(out.status, "error", failOn);
    const trash = ops.find((o) => o.op === "update" && o.table === "events");
    assert.ok(trash && trash.patch.trashed_at, "the half-made Event is trashed, never left live/pending");
    assert.equal(ops.filter((o) => o.op === "update" && o.table === "appearances").length, 0, "the item is not modified");
  }
});

test("Q: without a recovered candidate, the thin conversion is exactly as before", async () => {
  const { client, ops } = fakeAdmin({ appearance: { ...LEGACY, description: "Own notes", flyer_image_url: "https://store/own.webp" } });
  const out = await C.convertAppearanceToEvent(client, LEGACY.id, { uniqueEventSlug: async () => "s" });
  assert.equal(out.status, "converted");
  assert.equal(out.image, undefined);
  const ev = ops.find((o) => o.table === "events").row;
  assert.deepEqual([ev.name, ev.description, ev.cover_image_url, ev.external_url, ev.start_at], [LEGACY.title, "Own notes", "https://store/own.webp", LEGACY.external_url, LEGACY.start_at]);
  assert.deepEqual(Object.keys(ops.find((o) => o.op === "update" && o.table === "appearances").patch).sort(), ["event_id", "event_occurrence_id", "source"]);
});

// ── the one Event image path ──────────────────────────────────────────
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 176, b: 188 } } }).png().toBuffer();

test("Event image path: square covers and portrait flyers are accepted (the Brand header rule would drop them); bad files are refused", async () => {
  const fetchOf = (body, type = "image/png") => ({ fetchImage: async () => ({ ok: true, url: "https://img", body, contentType: type, bytes: body.length, redirects: 0 }) });
  const square = await png(800, 800);
  assert.equal((await M.fetchVerifiedEventImage("https://img", fetchOf(square))).ok, true, "square Luma-style cover");
  assert.equal((await M.fetchVerifiedEventImage("https://img", fetchOf(await png(600, 900)))).ok, true, "portrait flyer");
  assert.equal(B.isSuitableBrandImage("cover", 800, 800), false, "why the Brand helper isn't used for Events");
  assert.deepEqual(await M.fetchVerifiedEventImage("https://img", fetchOf(await png(120, 120))), { ok: false, reason: "unsuitable" });
  assert.deepEqual(await M.fetchVerifiedEventImage("https://img", fetchOf(Buffer.from("<html>not an image</html>"), "text/html")), { ok: false, reason: "type_mismatch" });
  assert.deepEqual(await M.fetchVerifiedEventImage("https://img", { fetchImage: async () => ({ ok: false, code: "blocked_destination", redirects: 0 }) }), { ok: false, reason: "fetch_failed" });
  assert.match(read("src/lib/event-import/media.ts"), /storePublicImage\(admin, UPLOAD_BUCKET, image\.validated, file\)/, "same storage pipeline as an uploaded Event cover");
});

test("R: new imports use the same Event image path; the admin conversion reuses the importer and is admin-only", () => {
  const importActions = read("src/app/(public)/account/business/[id]/import-event/actions.ts");
  assert.match(importActions, /const stored = await recoverEventImage\(admin, url\);/);
  assert.doesNotMatch(importActions, /fetchVerifiedBrandImage/);
  const admin = read("src/app/admin/(protected)/appearances/convert-actions.ts");
  assert.match(admin, /export async function convertLegacyAppearanceToEvent\(appearanceId: string\): Promise<AdminConvertSummary> \{\s*const admin = await requireAdminSupabase\(\);/);
  assert.match(admin, /export async function convertAppearanceFromAdminPage\(appearanceId: string\) \{\s*const admin = await requireAdminSupabase\(\);/);
  assert.match(admin, /analyzeEventUrl\(\{ url: row\.external_url/, "the existing Event Import pipeline, not a separate scraper");
  assert.match(admin, /if \(analysis\.kind !== "single"\) return \{ status: "not_converted", reason: "source_is_calendar"/);
  assert.match(admin, /if \(analysis\.matches\.event\?\.confidence === "strong"\)/);
  const page = read("src/app/admin/(protected)/appearances/[id]/page.tsx");
  assert.match(page, /\{!appearance\.event_id && appearance\.external_url && !converted && \(/);
});
