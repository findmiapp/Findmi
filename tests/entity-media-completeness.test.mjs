// Entity Media Completeness V1 — Event Image in paste / Review, fill-only
// Find Media for existing Businesses and Locations through the EXISTING
// readers, the ready Brand Import read preferred over a bare Quick Create,
// and the FUJIKINA canonical Location integrity. Fakes only — no network.
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

const SP = await import("../src/lib/event-import/structured-paste.ts");
const SM = await import("../src/lib/event-import/structured-merge.ts");
const R = await import("../src/lib/event-import/review.ts");
const P = await import("../src/lib/event-import/persist.ts");
const M = await import("../src/lib/entity-media.ts");
const EP = await import("../src/lib/entity-prepare.ts");
const IMG = await import("../src/lib/appearance-image.ts");
const read = (p) => readFileSync(p, "utf8");
const NOW = Date.parse("2026-10-01T12:00:00Z");
const NO_MATCHES = { event: null, locations: [], organizerBusiness: null, existingAppearance: null };
const FLYER = "https://cdn.fujifilm-x.com/fujikina/nyc-2026-hero.jpg";
const CLIENT = read("src/app/admin/(protected)/events/import/AdminEventImporter.tsx");
const ACTIONS = read("src/app/admin/(protected)/events/import/actions.ts");

const PASTE = (extra = "") => `Event Name: FUJIKINA NYC 2026
Primary Business: FUJIFILM
Event Link: https://shopusa.fujifilm-x.com/fujikina/
${extra}
Date: October 16, 2026
Location Name: Magnum Photos
Street Address: 301 Grand Street
City: New York
State: NY`;

test("Event Image: structured paste reads the Event's own image (https only)", () => {
  for (const label of ["Event Image", "Event Image URL", "Event Flyer", "Flyer", "Hero Image"]) {
    assert.equal(SP.extractStructuredEvent(PASTE(`${label}: ${FLYER}`), { now: NOW }).candidate.imageUrl, FLYER, label);
  }
  const bad = SP.extractStructuredEvent(PASTE("Event Image: http://insecure.example/x.jpg"), { now: NOW });
  assert.equal(bad.candidate.imageUrl, null);
  assert.ok(bad.candidate.structured.notes.some((n) => /Event Image isn't a full https link/.test(n)));
  assert.equal(SP.extractStructuredEvent(PASTE(), { now: NOW }).candidate.imageUrl, null, "no image invented");
  // The pasted image wins over the Event Link page's image.
  const explicit = SP.extractStructuredEvent(PASTE(`Event Image: ${FLYER}`), { now: NOW }).candidate;
  const page = { ...explicit, imageUrl: "https://shopusa.fujifilm-x.com/og.jpg", structured: undefined };
  assert.equal(SM.mergeSourceIntoStructured(explicit, page).candidate.imageUrl, FLYER);
});

test("Event Image: reaches Review, validates, and is stored once through the existing Event image path", async () => {
  const c = SP.extractStructuredEvent(PASTE(`Event Image: ${FLYER}`), { now: NOW }).candidate;
  const review = { ...R.reviewDefaults(c, NO_MATCHES, "participating"), asEvent: true };
  assert.equal(review.imageUrl, FLYER);
  const n = P.normalizeReview(review);
  assert.equal(n.ok, true);
  assert.equal(n.value.imageUrl, FLYER);
  assert.equal(P.normalizeReview({ ...review, imageUrl: "http://x.example/a.jpg" }).value.imageUrl, null, "https only");
  // Create: re-hosted through deps.storeImage (recoverEventImage in Admin).
  const stored = [];
  const ops = [];
  const admin = {
    from(table) {
      const chain = {
        select: () => chain, eq: () => chain, is: () => chain, in: () => chain, neq: () => chain, limit: () => chain,
        maybeSingle: async () => ({ data: null }),
        then: (res) => res({ data: [], error: null }),
        insert: (input) => {
          const rows = Array.isArray(input) ? input : [input];
          ops.push({ table, rows });
          const withIds = rows.map((r, i) => ({ id: `${table}-${i}`, ...r }));
          return { select: () => ({ single: async () => ({ data: withIds[0], error: null }), then: (cb) => cb({ data: withIds, error: null }) }), then: (cb) => cb({ error: null }) };
        },
        upsert: () => Promise.resolve({ error: null }),
        update: () => ({ eq: () => ({ then: (cb) => cb({ error: null }) }) }),
      };
      return chain;
    },
  };
  const out = await P.persistDiscoveryEvent(n.value, null, { admin, storeImage: async (u) => (stored.push(u), "https://x.supabase.co/stored.webp"), geography: async () => null, uniqueEventSlug: async () => "fujikina", propagateDates: async () => {}, findEventBySourceUrl: async () => null });
  assert.equal(out.ok, true);
  assert.deepEqual(stored, [FLYER]);
  assert.equal(ops.find((o) => o.table === "events").rows[0].cover_image_url, "https://x.supabase.co/stored.webp");
  // Never one image per date: occurrences carry no image of their own.
  assert.ok(ops.find((o) => o.table === "event_occurrences").rows.every((r) => !("cover_image_url" in r) && !("image_url" in r)));
  // Review: the operator's Event Image URL field is checked through the verified preview first.
  assert.match(CLIENT, /function EventImageUrlField/);
  assert.match(CLIENT, /const state = await limitedPreview\(value\);[\s\S]*?if \(state\.status !== "ok"\) return setError/);
  assert.match(CLIENT, /<EventImageUrlField id=\{id\} review=\{review\} set=\{set\} \/>/);
});

test("one Event cover supplies every date card (no per-date images)", () => {
  for (const f of ["src/components/EventOccurrenceCard.tsx", "src/components/UpcomingDatesRail.tsx"]) {
    assert.match(read(f), /specificImageUrl: coverImageUrl,\s*galleryImages,\s*businessCoverUrl: null,/, f);
  }
  const cover = "https://x.supabase.co/fujikina.webp";
  for (const id of ["occ-1", "occ-2", "occ-22"]) assert.equal(IMG.resolveAppearanceDisplayImage({ appearanceId: id, specificImageUrl: cover, galleryImages: [], businessCoverUrl: null }), cover);
});

test("generic Brand / site imagery is still rejected as Event creative", () => {
  const engine = read("src/lib/event-import/engine.ts");
  assert.match(engine, /const imageGuard = await guardFallbackImage\(extracted, page, deps\);/);
  assert.match(engine, /candidate = \{ \.\.\.candidate, imageUrl: null, sources, imageGuard \};/);
  // The media helper never feeds Event creative; the Event image is the operator's field / the page's own.
  assert.doesNotMatch(read("src/lib/entity-media.ts"), /imageUrl|cover_image_url.*events/);
});

const row = (over = {}) => ({ id: "11111111-1111-4111-8111-111111111111", name: "Femme Foto Gallery", logo_url: null, cover_image_url: null, website_url: null, address: "48 Ludlow Street", city: "New York", state: "NY", postal_code: null, ...over });

test("missing media detection for existing Businesses and Locations", () => {
  assert.deepEqual(M.missingMedia(M.entityMediaState("location", row())), ["logo", "cover"]);
  assert.deepEqual(M.missingMedia(M.entityMediaState("business", row({ name: "FUJIFILM", logo_url: "https://x/logo.png" }))), ["cover"]);
  assert.deepEqual(M.missingMedia(M.entityMediaState("location", row({ logo_url: "https://x/l.png", cover_image_url: "https://x/c.png" }))), []);
  assert.deepEqual(M.missingMedia(M.entityMediaState("location", row({ logo_url: "   " }))), ["logo", "cover"], "blank is missing");
});

function findDeps({ research = { status: "not_found", website: null }, read: readResult = { ok: true, logo: { sourceUrl: "https://site/logo.png", preview: "data:image/webp;base64,AA" }, cover: { sourceUrl: "https://site/cover.jpg", preview: "data:image/webp;base64,BB" } } } = {}) {
  const calls = { research: [], read: [] };
  return {
    calls,
    deps: {
      research: async (q) => (calls.research.push(q), research),
      readWebsite: async (url, supplied) => (calls.read.push([url, supplied]), readResult),
    },
  };
}

test("Find Media: stored website → import website → Entity Research, then the existing reader; only missing roles", async () => {
  // 1. Stored website — no research.
  let f = findDeps();
  let r = await M.findEntityMedia("location", row({ website_url: "https://icp.org/", logo_url: "https://x/logo.png" }), { website: "https://other.example/" }, f.deps);
  assert.deepEqual(f.calls.research, []);
  assert.deepEqual(f.calls.read, [["https://icp.org/", { address: "48 Ludlow Street" }]]);
  assert.equal(r.websiteSource, "stored");
  assert.equal(r.logo, null, "a present logo is never re-sourced");
  assert.equal(r.cover.sourceUrl, "https://site/cover.jpg");
  // 2. This import's website.
  f = findDeps();
  r = await M.findEntityMedia("business", row({ name: "FUJIFILM" }), { website: "https://www.fujifilm.com/" }, f.deps);
  assert.equal(r.websiteSource, "import");
  assert.deepEqual(f.calls.research, []);
  // 3. Entity Research (name + address context for a Location).
  f = findDeps({ research: { status: "found", website: "https://femmefotogallery.example/" } });
  r = await M.findEntityMedia("location", row(), { eventName: "FUJIKINA NYC 2026" }, f.deps);
  assert.equal(r.websiteSource, "research");
  assert.equal(f.calls.research[0].kind, "location");
  assert.equal(f.calls.research[0].address, "48 Ludlow Street");
  assert.equal(f.calls.read[0][0], "https://femmefotogallery.example/");
  // Research without a confident site → nothing, with a note.
  f = findDeps({ research: { status: "ambiguous", website: null } });
  r = await M.findEntityMedia("location", row(), {}, f.deps);
  assert.deepEqual([r.logo, r.cover, f.calls.read.length], [null, null, 0]);
  assert.match(r.note, /No official website found/);
  // Unreadable website → note.
  f = findDeps({ read: { ok: false } });
  r = await M.findEntityMedia("location", row({ website_url: "https://x.example/" }), {}, f.deps);
  assert.match(r.note, /couldn't be read/);
  // The server action wires the EXISTING reader + research (no second system).
  assert.match(ACTIONS, /const read = await readLocationWebsite\(url, supplied, deps\);/);
  assert.match(ACTIONS, /research: \(q\) => researchEntity\(q, undefined/);
});

function applyDeps(current) {
  const writes = [];
  return {
    writes,
    deps: {
      load: async () => current,
      store: async (url, role) => `https://x.supabase.co/${role}.webp`,
      fillIfEmpty: async (kind, id, column, url) => {
        if (current[column]) return false;
        writes.push([column, url]);
        return true;
      },
    },
  };
}

test("Apply is FILL-ONLY: existing media is never overwritten", async () => {
  const a = applyDeps(row({ logo_url: "https://x/existing-logo.png" }));
  const r = await M.applyEntityMedia("location", "id", { logoSourceUrl: "https://site/logo.png", coverSourceUrl: "https://site/cover.jpg" }, a.deps);
  assert.deepEqual(r, { ok: true, applied: ["cover"], skipped: ["logo"] });
  assert.deepEqual(a.writes, [["cover_image_url", "https://x.supabase.co/cover.webp"]]);
  // A field filled meanwhile (the guarded write fails) is reported skipped, never forced.
  const race = applyDeps(row());
  race.deps.fillIfEmpty = async () => false;
  assert.deepEqual(await M.applyEntityMedia("business", "id", { logoSourceUrl: "https://site/logo.png" }, race.deps), { ok: true, applied: [], skipped: ["logo"] });
  // Unverifiable image → nothing written.
  const bad = applyDeps(row());
  bad.deps.store = async () => null;
  assert.deepEqual((await M.applyEntityMedia("business", "id", { coverSourceUrl: "https://site/c.jpg" }, bad.deps)).applied, []);
  // The real write is guarded by "still empty" in the database itself.
  assert.match(ACTIONS, /\.update\(\{ \[column\]: url \}\)\.eq\("id", id\)\.is\(column, null\)/);
  // Re-verified + re-hosted through the existing brand-image storage.
  assert.match(ACTIONS, /const verified = await fetchVerifiedBrandImage\(url, role\);\s*return verified\.ok \? storeBrandImage\(admin, verified\.image\) : null;/);
});

test("a READY Brand Import read is preferred over a bare Quick Create (the FUJIFILM case)", async () => {
  assert.equal(M.readMatchesBusiness("FUJIFILM", { name: "Fujifilm Group", website: "https://www.fujifilm.com/" }), true, "site label");
  assert.equal(M.readMatchesBusiness("Fujifilm Group", { name: "Fujifilm Group", website: null }), true, "same name");
  assert.equal(M.readMatchesBusiness("Fuji Bakery", { name: "Fujifilm Group", website: "https://www.fujifilm.com/" }), false);
  assert.equal(M.readMatchesBusiness("Magnum", { name: "Fujifilm Group", website: "https://www.fujifilm.com/" }), false);
  const researched = [];
  const deps = {
    findMatches: async () => [],
    research: async (q) => (researched.push(q), { status: "not_found", website: null, name: null, address: null, suggestions: [], sources: [], searches: 1 }),
    findReadyRead: async () => ({ batchId: "b", candidateId: "c", website: "https://www.fujifilm.com/" }),
  };
  const r = await EP.prepareBusiness({ name: "FUJIFILM", website: null, websiteReadFailed: false }, deps);
  assert.deepEqual([r.status, r.source, r.website, r.priorRead], ["website", "read", "https://www.fujifilm.com/", { batchId: "b", candidateId: "c" }]);
  assert.deepEqual(researched, [], "no search needed");
  // An existing Business still wins; a pasted website still goes first.
  assert.equal((await EP.prepareBusiness({ name: "FUJIFILM", website: null, websiteReadFailed: false }, { ...deps, findMatches: async () => [{ id: "x", name: "FUJIFILM", isPublic: true, reasons: ["website"] }] })).status, "existing");
  assert.equal((await EP.prepareBusiness({ name: "FUJIFILM", website: "https://fujifilm-x.com/", websiteReadFailed: false }, deps)).source, "pasted");
  // No ready read → research → Quick Create stays the fallback.
  assert.equal((await EP.prepareBusiness({ name: "FUJIFILM", website: null, websiteReadFailed: false }, { ...deps, findReadyRead: async () => null })).status, "no_website");
  // Client: the prior read is loaded (BrandReviewCard → Create from read), and Quick Create hides while a read is ready.
  assert.match(CLIENT, /r\.prepared\.source === "read" && r\.prepared\.priorRead[\s\S]*?adminLoadBusinessRead\(r\.prepared\.priorRead\.batchId, r\.prepared\.priorRead\.candidateId\)/);
  assert.match(CLIENT, /read\?\.status !== "ready" && !\(read && PENDING_READ\.has\(read\.status\)\)/);
  assert.match(ACTIONS, /\.eq\("status", "ready"\)\s*\.is\("created_business_id", null\)\s*\.is\("matched_business_id", null\)/);
});

test("Review Media section: Event Image + each Business / Location, ✓ / Needed, Find Media only when missing, never blocks Create", () => {
  const panel = CLIENT.slice(CLIENT.indexOf("function MediaCompleteness"), CLIENT.indexOf("function EventDetails"));
  assert.match(panel, /<Mark ok=\{Boolean\(review\.imageUrl\)\} label="Event Image" \/>/);
  assert.match(panel, /<Mark ok=\{state\.logo\} label="Logo" \/>/);
  assert.match(panel, /<Mark ok=\{state\.cover\} label="Cover" \/>/);
  assert.match(panel, /\{ok \? "✓" : "· Needed"\}/);
  assert.match(panel, /\{missing && !found && \(/);
  assert.match(panel, />\s*\{busy \? "Looking for Media…" : "Find Media"\}/);
  assert.match(panel, /Use Selected Media/);
  assert.doesNotMatch(panel, /disabled=\{[^}]*Create|setCanSave|blockCreate/);
  assert.match(CLIENT, /<MediaCompleteness review=\{review\} business=\{business\} businessWebsite=\{s\?\.businessWebsite \?\? null\} eventName=\{candidate\.title\} \/>/);
});

test("FUJIKINA: 22 dates at 8 canonical Locations stay distinct (7 / 8 / 7 per day)", () => {
  const L = { wpp: "World Press Photo", mag: "Magnum Photos", fbh: "Fujifilm Brand House", fcg: "FUJIKINA Community Gallery", ffg: "Femme Foto Gallery", icp: "International Center of Photography", thr: "FUJIKINA Theater", ppa: "FotoFest / PPA" };
  const ids = Object.fromEntries(Object.keys(L).map((k, i) => [k, `aaaaaaaa-0000-4000-8000-00000000000${i}`]));
  const days = { "2026-10-16": ["wpp", "mag", "fbh", "fcg", "ffg", "icp", "thr"], "2026-10-17": ["wpp", "mag", "fbh", "fcg", "ffg", "icp", "thr", "ppa"], "2026-10-18": ["wpp", "mag", "fbh", "fcg", "ffg", "icp", "thr"] };
  const occurrences = Object.entries(days).flatMap(([date, keys]) =>
    keys.map((k) => ({ ...R.emptyReviewOccurrence({ venueName: L[k], address: null, city: "New York", state: "NY", postalCode: null, useLocationId: ids[k] }), date, details: `${L[k]} programming` }))
  );
  const base = { ...R.reviewDefaults(SP.extractStructuredEvent(PASTE(), { now: NOW }).candidate, NO_MATCHES, "participating"), asEvent: true, sharedPlace: false, occurrences };
  const n = P.normalizeReview(base);
  assert.equal(n.ok, true);
  const dates = n.value.occurrences;
  assert.equal(dates.length, 22);
  assert.equal(new Set(dates.map((d) => d.place.locationId)).size, 8);
  const per = (day) => new Set(dates.filter((d) => d.date === day).map((d) => d.place.locationId)).size;
  assert.deepEqual([per("2026-10-16"), per("2026-10-17"), per("2026-10-18")], [7, 8, 7]);
  assert.ok(dates.every((d) => d.start === null && d.details));
});
