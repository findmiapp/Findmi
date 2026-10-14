// Legacy Corgi Appearances → Events, Admin batch. Runs the REAL
// convertLegacyAppearanceToEvent (Event Import analysis → identity checks →
// convertAppearanceToEvent) one item at a time against a STATEFUL fake
// database, a stubbed Luma transport and a stubbed image store. No
// network, no production data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const data = (src) => ({ url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true });
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return data("export{}");
    if (specifier === "next/headers") return data("export const cookies=async()=>({get(){return undefined}});export const headers=async()=>new Map();");
    if (specifier === "next/navigation") return data("export function redirect(url){throw Object.assign(new Error('NEXT_REDIRECT'),{url})}");
    if (specifier === "next/cache") return data("export function revalidatePath(){}");
    if (specifier === "@/lib/admin/requireAdminSupabase") return data("export async function requireAdminSupabase(){if(!globalThis.__admin)throw new Error('NOT_ADMIN');return globalThis.__admin}");
    if (specifier === "@/lib/admin/queries") return data("export async function isSlugTaken(){return false}");
    // The one Event image path, stubbed at its boundary: stores a recovered Luma cover in Findmi media.
    if (specifier === "@/lib/event-import/media") return data("export async function recoverEventImage(admin,url){(globalThis.__images??=[]).push(url);return /lumacdn/.test(url)?{ok:true,url:'https://proj.supabase.co/storage/v1/object/public/findmi-media/'+(globalThis.__images.length)+'.fv1.webp'}:{ok:false,reason:'fetch_failed'}}");
    if (specifier === "../safe-fetch" && context.parentURL?.endsWith("/event-import/engine.ts")) {
      return { url: new URL("./fixtures/safe-fetch-stub-transport.mjs", import.meta.url).href, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const A = await import("../src/app/admin/(protected)/appearances/convert-actions.ts");
const LC = await import("../src/lib/admin/legacy-conversion.ts");
const read = (p) => readFileSync(p, "utf8");

const CORGI = "ef134d41-4264-46e4-8fa5-aacd0f6afa50";
const CORGI_NYC = "660d3744-dc88-4e91-856c-c0a296c9e776";
const QSBS_ID = "4986798c-04be-4a6b-9795-7562f68f922c";
const QSBS_EVENT = "d05861f9-b21d-4974-ac1f-ad277c67244d";

const item = (id, title, slug, start, end, extra = {}) => ({
  id, business_id: CORGI, title, description: null, start_at: start, end_at: end, status: "confirmed", event_id: null, event_occurrence_id: null,
  location_id: CORGI_NYC, venue_name: "Corgi Cafe NYC", address: "121 East 27th Street", city: "Manhattan", state: "NY", latitude: null, longitude: null,
  external_url: `https://luma.com/${slug}`, flyer_image_url: null, market_id: "nyc", market_area_id: null, source: "manual", ...extra,
});
const SPOOK = item("ee69927e-f655-4adf-87e8-45118ab24d08", "Spooktober Movie Night - The Drama", "4w2i8mkh", "2026-10-15T23:00:00+00:00", "2026-10-16T01:00:00+00:00");
const TERM = item("1638b240-1817-472e-8363-6433a1fc9fe3", "Term Sheet Teardown: Clauses, Catches & Negotiation Tactics, presented by Wells Fargo and Cooley LLP", "corginyc-rhyw", "2026-10-20T14:00:00+00:00", "2026-10-20T16:00:00+00:00");
const RUN = item("de7bc12f-3313-4c28-ab44-e7679b613878", "Aleph x Corgi Run Club NYC", "au1yymwo", "2026-10-17T13:00:00+00:00", "2026-10-17T14:00:00+00:00", { location_id: null, venue_name: "Pier 34 at Hudson River Park", address: null, city: "New York" });
const PANCAKE = item("c6e0401c-2ceb-4203-84a9-a314c157007b", "A Pancake Social by Sent & Corgi", "corginyc-5j7v", "2026-10-21T14:00:00+00:00", "2026-10-21T17:00:00+00:00");
const QSBS = item(QSBS_ID, "QSBS: Guide to a Tax-Free Exit, presented by Wells Fargo and BakerTilly", "corginyc-mjk0", "2026-10-15T14:00:00+00:00", "2026-10-15T16:00:00+00:00", { event_id: QSBS_EVENT, event_occurrence_id: "4f231289", source: "official_participation" });

/** A Luma-style individual Event page (schema.org Event, as Luma ships it). */
function lumaPage(row, over = {}) {
  const ev = {
    "@context": "https://schema.org", "@type": "Event", name: row.title, startDate: row.start_at, endDate: row.end_at, url: row.external_url,
    description: `${row.title} — the full description from its own Luma page.`, image: [`https://images.lumacdn.com/event-covers/${row.external_url.split("/").pop()}.jpg`],
    organizer: [{ "@type": "Organization", name: "Corgi NYC" }],
    location: row.location_id ? { "@type": "Place", name: "Corgi Cafe", address: { "@type": "PostalAddress", streetAddress: "121 E 27th St", addressLocality: "New York", addressRegion: "NY" } } : { "@type": "Place", name: "Pier 34", address: { "@type": "PostalAddress", addressLocality: "New York", addressRegion: "NY" } },
    ...over,
  };
  return `<!doctype html><html><head><title>${row.title} · Luma</title><script type="application/ld+json">${JSON.stringify(ev)}</script></head><body><h1>${row.title}</h1></body></html>`;
}

/** Stateful fake database: filters really select rows; writes really change them. */
function fakeDb(seed, { failInsertOn = null } = {}) {
  const t = { appearances: [], events: [], event_occurrences: [], event_businesses: [], event_occurrence_businesses: [], locations: [], ...structuredClone(seed) };
  const log = [];
  let n = 0;
  const match = (filters) => (r) =>
    filters.every(([op, k, v]) => (op === "eq" ? r[k] === v : op === "neq" ? r[k] !== v : op === "is" ? (r[k] ?? null) === v : op === "not_is" ? (r[k] ?? null) !== v : op === "in" ? v.includes(r[k]) : true));
  const from = (table) => {
    t[table] ??= [];
    const filters = [];
    let write = null;
    const rows = () => t[table].filter(match(filters));
    const apply = () => {
      if (write?.kind === "update") {
        const hit = rows();
        hit.forEach((r) => Object.assign(r, write.patch));
        log.push({ op: "update", table, patch: write.patch, count: hit.length });
        return hit;
      }
      return rows();
    };
    const q = {
      select: () => q, order: () => q, limit: () => q, range: () => q, or: () => q, ilike: () => q, gte: () => q, lte: () => q, lt: () => q, gt: () => q, textSearch: () => q, contains: () => q,
      eq: (k, v) => (filters.push(["eq", k, v]), q),
      neq: (k, v) => (filters.push(["neq", k, v]), q),
      is: (k, v) => (filters.push(["is", k, v]), q),
      not: (k, op, v) => (filters.push(["not_is", k, v]), q),
      in: (k, v) => (filters.push(["in", k, v]), q),
      maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
      single: async () => ({ data: apply()[0] ?? null, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: apply(), error: null }).then(resolve, reject),
      update: (patch) => ((write = { kind: "update", patch }), q),
      insert: (input) => {
        const list = (Array.isArray(input) ? input : [input]).map((r) => ({ id: `${table}-${++n}`, created_at: new Date().toISOString(), archived_at: null, trashed_at: null, ...r }));
        if (failInsertOn === table) {
          log.push({ op: "insert_failed", table });
          const fail = { data: null, error: { message: "boom" } };
          return { select: () => ({ single: async () => fail, then: (r) => r(fail) }), then: (r) => r(fail) };
        }
        t[table].push(...list);
        log.push({ op: "insert", table, rows: list });
        const ok = { data: list, error: null };
        return { select: () => ({ single: async () => ({ data: list[0], error: null }), then: (r) => r(ok) }), then: (r) => r(ok) };
      },
      upsert: (row) => {
        t[table].push({ id: `${table}-${++n}`, ...row });
        log.push({ op: "upsert", table, row });
        return Promise.resolve({ error: null });
      },
      delete: () => (log.push({ op: "delete", table }), q),
    };
    return q;
  };
  return { t, log, client: { from, rpc: async () => ({ data: null, error: { message: "no rpc" } }) } };
}

function luma(pages) {
  const calls = [];
  globalThis.__safeFetchTransport = async (url) => {
    calls.push(url.href);
    const page = pages[url.href];
    if (page === undefined) throw Object.assign(new Error("offline"), { code: "ECONNREFUSED" });
    const [status, body] = typeof page === "number" ? [page, "refused"] : [200, page];
    return { status, headers: { "content-type": "text/html; charset=utf-8" }, body: (async function* () { yield Buffer.from(body); })(), destroy() {} };
  };
  return calls;
}

const SEED = () => ({
  appearances: [QSBS, SPOOK, TERM, RUN, PANCAKE].map((r) => ({ ...r })),
  events: [{ id: QSBS_EVENT, name: QSBS.title, slug: "qsbs", external_url: QSBS.external_url, is_demo: false, publication_status: "live", host_business_id: null, archived_at: null, trashed_at: null }],
});

/** What the batch screen does: one request per selected item, in order. */
async function runBatch(ids) {
  const results = [];
  for (const id of ids) results.push(await A.convertLegacyAppearanceToEvent(id));
  return results;
}

test("the batch converts sequentially, ONE item per request: QSBS skipped, a refused source skipped, the rest converted", async () => {
  const db = fakeDb(SEED());
  globalThis.__admin = db.client;
  globalThis.__images = [];
  const calls = luma({ [SPOOK.external_url]: lumaPage(SPOOK), [TERM.external_url]: 403, [RUN.external_url]: lumaPage(RUN), [PANCAKE.external_url]: lumaPage(PANCAKE) });

  const perRequest = [];
  const results = [];
  for (const id of [QSBS_ID, SPOOK.id, TERM.id, RUN.id, PANCAKE.id]) {
    const before = calls.length;
    results.push(await A.convertLegacyAppearanceToEvent(id));
    perRequest.push(calls.length - before);
  }
  assert.deepEqual(results.map((r) => r.status), ["not_converted", "converted", "not_converted", "converted", "converted"]);
  assert.deepEqual(perRequest, [0, 1, 1, 1, 1], "QSBS never re-fetched; one source read per item (403 not retried)");

  // QSBS: already an Event — reported, untouched.
  assert.deepEqual([results[0].reason, results[0].eventId], ["already_linked", QSBS_EVENT]);
  // Refused source: skipped with the Admin diagnostic; nothing written for it.
  assert.equal(results[2].reason, "source_unavailable");
  assert.equal(results[2].detail, "Source unavailable — luma.com returned HTTP 403.");
  const term = db.t.appearances.find((a) => a.id === TERM.id);
  assert.deepEqual([term.event_id, term.event_occurrence_id, term.source], [null, null, "manual"], "the failed item is not modified");
  assert.equal(db.t.events.filter((e) => e.external_url === TERM.external_url).length, 0, "no thin fallback Event");

  // Converted: exactly 3 new Events, all live, none hosted by Corgi.
  const created = db.t.events.filter((e) => e.id !== QSBS_EVENT);
  assert.equal(created.length, 3);
  for (const e of created) {
    assert.deepEqual([e.is_demo, e.publication_status, e.host_business_id, e.organizer_name], [false, "live", null, "Corgi NYC"], e.name);
    assert.match(e.cover_image_url, /\/storage\/v1\/object\/public\/findmi-media\/\d+\.fv1\.webp$/, "Event cover stored in Findmi media");
    assert.match(e.description, /full description from its own Luma page/);
  }
  // Read-back the screen shows.
  for (const r of [results[1], results[3], results[4]]) {
    assert.equal(r.persisted.live, true);
    assert.match(r.persisted.coverUrl, /findmi-media/);
    assert.equal(r.persisted.hostBusinessId, null);
    assert.equal(r.image, "stored");
  }
  assert.deepEqual(globalThis.__images, [SPOOK, RUN, PANCAKE].map((r) => `https://images.lumacdn.com/event-covers/${r.external_url.split("/").pop()}.jpg`), "only each Event's own image");
});

test("each converted item keeps its ID and Location; Corgi participates; no duplicate Appearance", async () => {
  const db = fakeDb(SEED());
  globalThis.__admin = db.client;
  luma({ [SPOOK.external_url]: lumaPage(SPOOK), [RUN.external_url]: lumaPage(RUN) });
  const [spook, run] = await runBatch([SPOOK.id, RUN.id]);

  const a = db.t.appearances.find((x) => x.id === SPOOK.id);
  assert.equal(spook.appearanceId, SPOOK.id, "same Appearance");
  assert.deepEqual([a.event_id, a.event_occurrence_id, a.source, a.location_id], [spook.eventId, spook.occurrenceId, "official_participation", CORGI_NYC]);
  const occ = db.t.event_occurrences.find((o) => o.id === spook.occurrenceId);
  assert.equal(occ.location_id, CORGI_NYC, "the confirmed Corgi Cafe NYC Location is kept");
  assert.deepEqual(db.t.event_businesses.filter((r) => r.event_id === spook.eventId).map((r) => [r.business_id, r.status]), [[CORGI, "approved"]]);
  assert.deepEqual(db.t.event_occurrence_businesses.filter((r) => r.occurrence_id === spook.occurrenceId).map((r) => r.business_id), [CORGI]);

  // Uncertain place: never forced onto Corgi Cafe NYC.
  const runOcc = db.t.event_occurrences.find((o) => o.id === run.occurrenceId);
  assert.equal(runOcc.location_id, null, "no invented Location match");
  assert.equal(db.t.appearances.find((x) => x.id === RUN.id).location_id, null);
  assert.notEqual(runOcc.venue_name, "Corgi Cafe NYC");

  assert.equal(db.t.appearances.length, 5, "no Appearance created or removed");
  assert.equal(db.log.filter((l) => l.op === "insert" && l.table === "appearances").length, 0);
  assert.equal(db.log.filter((l) => l.op === "delete").length, 0);
});

test("never a duplicate Event: re-running is a safe skip, and a link already on an Event is skipped with its ID", async () => {
  const db = fakeDb(SEED());
  globalThis.__admin = db.client;
  luma({ [SPOOK.external_url]: lumaPage(SPOOK) });
  const first = await A.convertLegacyAppearanceToEvent(SPOOK.id);
  assert.equal(first.status, "converted");
  const again = await A.convertLegacyAppearanceToEvent(SPOOK.id);
  assert.deepEqual([again.status, again.reason, again.eventId], ["not_converted", "already_linked", first.eventId]);

  // Another standalone item pointing at the same source Event.
  const twin = { ...SPOOK, id: "twin-item" };
  db.t.appearances.push(twin);
  const dup = await A.convertLegacyAppearanceToEvent(twin.id);
  assert.deepEqual([dup.status, dup.reason, dup.eventId], ["not_converted", "source_event_exists", first.eventId]);
  assert.equal(db.t.events.filter((e) => e.external_url === SPOOK.external_url).length, 1);
});

test("identity checks still refuse a source that isn't this item (title / date)", async () => {
  const db = fakeDb(SEED());
  globalThis.__admin = db.client;
  luma({ [SPOOK.external_url]: lumaPage(SPOOK, { name: "Completely Different Workshop" }), [PANCAKE.external_url]: lumaPage(PANCAKE, { startDate: "2026-11-21T14:00:00+00:00", endDate: "2026-11-21T17:00:00+00:00" }) });
  const [a, b] = await runBatch([SPOOK.id, PANCAKE.id]);
  assert.deepEqual([a.status, a.reason], ["not_converted", "title_mismatch"]);
  assert.deepEqual([b.status, b.reason], ["not_converted", "date_mismatch"]);
  assert.equal(db.t.events.length, 1, "nothing created");
});

test("a failure inside one conversion leaves no partial Event and doesn't stop the next item", async () => {
  const db = fakeDb(SEED(), { failInsertOn: "event_occurrences" });
  globalThis.__admin = db.client;
  luma({ [SPOOK.external_url]: lumaPage(SPOOK) });
  const r = await A.convertLegacyAppearanceToEvent(SPOOK.id);
  assert.deepEqual([r.status, r.reason, r.detail], ["not_converted", "error", "occurrence_insert_failed"]);
  const made = db.t.events.find((e) => e.external_url === SPOOK.external_url);
  assert.ok(made.trashed_at, "the just-created Event is soft-trashed (kept, never public)");
  assert.equal(db.t.appearances.find((x) => x.id === SPOOK.id).event_id, null, "the item is untouched");

  // Isolation: the batch keeps going with the next item.
  const db2 = fakeDb(SEED());
  globalThis.__admin = db2.client;
  luma({ [SPOOK.external_url]: 503, [PANCAKE.external_url]: lumaPage(PANCAKE) });
  const [x, y] = await runBatch([SPOOK.id, PANCAKE.id]);
  assert.deepEqual([x.status, x.detail], ["not_converted", "Source temporarily unavailable — luma.com returned HTTP 503 (after one retry)."]);
  assert.equal(y.status, "converted");
});

test("Admin only: no Admin session → the action refuses before reading anything", async () => {
  globalThis.__admin = null;
  const calls = luma({ [SPOOK.external_url]: lumaPage(SPOOK) });
  await assert.rejects(() => A.convertLegacyAppearanceToEvent(SPOOK.id), /NOT_ADMIN/);
  assert.equal(calls.length, 0);
  const src = read("src/app/admin/(protected)/appearances/convert-actions.ts");
  assert.match(src, /export async function convertLegacyAppearanceToEvent\(appearanceId: string\): Promise<AdminConvertSummary> \{\n  const admin = await requireAdminSupabase\(\);/);
});

test("eligibility: standalone items with a link are offered; Events, canceled and link-less items aren't; ended items aren't pre-selected", () => {
  assert.equal(LC.legacyConversionEligibility(QSBS), "already_event");
  assert.equal(LC.legacyConversionEligibility(SPOOK), "eligible");
  assert.equal(LC.legacyConversionEligibility({ ...SPOOK, status: "canceled" }), "canceled");
  assert.equal(LC.legacyConversionEligibility({ ...SPOOK, external_url: null }), "no_source_link");
  const now = Date.parse("2026-10-14T12:00:00Z");
  assert.equal(LC.hasEnded({ start_at: "2026-10-13T21:30:00Z", end_at: "2026-10-14T00:00:00Z" }, now), true);
  assert.equal(LC.hasEnded(SPOOK, now), false);
});

test("the batch screen: Admin-only route, 60s budget, one awaited request per item, no automatic retry", () => {
  const page = read("src/app/admin/(protected)/appearances/convert/page.tsx");
  assert.match(page, /^export const maxDuration = 60;$/m);
  const client = read("src/app/admin/(protected)/appearances/convert/LegacyConversionBatch.tsx");
  assert.match(client, /for \(const row of queue\) \{[\s\S]*?const summary = await convertLegacyAppearanceToEvent\(row\.id\); \/\/ one request, one item/);
  assert.doesNotMatch(client, /Promise\.all|Promise\.allSettled/, "never in parallel / never all at once");
  assert.match(client, /if \(prior\?\.kind === "done" \|\| prior\?\.kind === "failed"\) continue; \/\/ never re-sent automatically/);
  assert.match(client, /selected · \{converted\} converted · \{skipped\} skipped/);
  assert.match(client, /\{queue\.length - finished\.length\} remaining/);
});
