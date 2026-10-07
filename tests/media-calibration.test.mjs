// Legacy-variant CALIBRATION runner — validates the pipeline logic in
// lib/admin/media-calibration.ts against a fake Storage/DB (no network,
// no production access): the 11-entry list shape, role-size scoping,
// preflight safety gating, and the full download→generate→validate→
// upload→verify→register pipeline for both a public and the private
// Moment entry. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import sharp from "sharp";

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

const M = await import("../src/lib/admin/media-calibration.ts");
const V = await import("../src/lib/image-variants.ts");
const Roles = await import("../src/lib/media-backfill-roles.ts");

const photo = (w, h, format = "jpeg", opts = {}) =>
  sharp({ create: { width: w, height: h, channels: opts.alpha ? 4 : 3, background: opts.alpha ? { r: 20, g: 176, b: 188, alpha: 0.4 } : { r: 120, g: 90, b: 60 } } })
    [format](format === "jpeg" ? { quality: 90 } : {})
    .toBuffer();

test("CALIBRATION_ORIGINALS: exactly 11 unique entries, role sizes match the spec", () => {
  assert.equal(M.CALIBRATION_ORIGINALS.length, 11);
  assert.equal(new Set(M.CALIBRATION_ORIGINALS.map((e) => e.key)).size, 11);
  const byKey = Object.fromEntries(M.CALIBRATION_ORIGINALS.map((e) => [e.key, e]));
  assert.deepEqual(Roles.unionVariantSizes(byKey.business_logo_tendy.roles), [160, 800]);
  assert.deepEqual(Roles.unionVariantSizes(byKey.business_cover_tendy.roles), [800, 1600]);
  assert.deepEqual(Roles.unionVariantSizes(byKey.location_logo_vanderbilt.roles), [160, 800]);
  assert.deepEqual(Roles.unionVariantSizes(byKey.location_cover_vanderbilt.roles), [800, 1600]);
  assert.deepEqual(Roles.unionVariantSizes(byKey.event_cover_free_bean.roles), [800, 1600]);
  assert.deepEqual(Roles.unionVariantSizes(byKey.product_image_sourdough_pancake.roles), [160, 800, 1600]);
  assert.deepEqual(Roles.unionVariantSizes(byKey.business_gallery_small.roles), [800, 1600]);
  assert.deepEqual(Roles.unionVariantSizes(byKey.business_gallery_large_source.roles), [800, 1600]);
  assert.deepEqual(Roles.unionVariantSizes(byKey.homepage_bulletin_thumb.roles), [160]);
  assert.deepEqual(Roles.unionVariantSizes(byKey.moment_photo_private.roles), [800, 1600]);
  // Only the private entry targets journal-media; everything else is public.
  const buckets = M.CALIBRATION_ORIGINALS.map((e) => e.bucket);
  assert.equal(buckets.filter((b) => b === "journal-media").length, 1);
  assert.equal(buckets.filter((b) => b === "findmi-media").length, 10);
});

// ── POST execution gate (MEDIA_CALIBRATION_ENABLED) ───────────────────────
test("isCalibrationExecutionEnabled: fails closed on anything but the literal string \"true\"", () => {
  assert.equal(M.isCalibrationExecutionEnabled({}), false, "missing entirely");
  assert.equal(M.isCalibrationExecutionEnabled({ MEDIA_CALIBRATION_ENABLED: undefined }), false);
  assert.equal(M.isCalibrationExecutionEnabled({ MEDIA_CALIBRATION_ENABLED: "" }), false, "empty string");
  assert.equal(M.isCalibrationExecutionEnabled({ MEDIA_CALIBRATION_ENABLED: "false" }), false);
  assert.equal(M.isCalibrationExecutionEnabled({ MEDIA_CALIBRATION_ENABLED: "0" }), false);
  assert.equal(M.isCalibrationExecutionEnabled({ MEDIA_CALIBRATION_ENABLED: "1" }), false);
  assert.equal(M.isCalibrationExecutionEnabled({ MEDIA_CALIBRATION_ENABLED: "TRUE" }), false, "wrong case is refused, not normalized");
  assert.equal(M.isCalibrationExecutionEnabled({ MEDIA_CALIBRATION_ENABLED: " true" }), false, "whitespace is refused, not trimmed");
  assert.equal(M.isCalibrationExecutionEnabled({ MEDIA_CALIBRATION_ENABLED: "true" }), true, "only the exact literal enables it");
});

test("static guard: POST is rejected by the MEDIA_CALIBRATION_ENABLED gate before any write path is reachable; GET is unaffected", () => {
  const route = readFileSync("src/app/admin/api/media-calibration/route.ts", "utf8");
  assert.match(route, /isCalibrationExecutionEnabled/);

  const postStart = route.indexOf("export async function POST");
  assert.ok(postStart !== -1, "POST handler exists");
  const postBody = route.slice(postStart);

  const gateAt = postBody.indexOf("isCalibrationExecutionEnabled(process.env)");
  const runAt = postBody.indexOf("runCalibration(");
  assert.ok(gateAt !== -1, "POST checks isCalibrationExecutionEnabled");
  assert.ok(runAt !== -1, "POST calls runCalibration");
  assert.ok(gateAt < runAt, "the enablement gate is checked BEFORE runCalibration can ever be reached");

  // The gate must return early (403) rather than merely being observed.
  const gateLine = postBody.slice(gateAt - 10, gateAt + 60);
  assert.match(gateLine, /!isCalibrationExecutionEnabled/, "POST refuses when the flag is NOT enabled");
  assert.match(postBody.slice(gateAt, runAt), /calibrationDisabled\(\)/, "the false branch returns the disabled response, not a silent continue");
  assert.match(route, /status:\s*403/, "the disabled response is a real HTTP refusal, not a 200");

  const getStart = route.indexOf("export async function GET");
  const getBody = route.slice(getStart, postStart);
  assert.doesNotMatch(getBody, /MEDIA_CALIBRATION_ENABLED|isCalibrationExecutionEnabled/, "GET (read-only) must stay unaffected by this write-only gate");
});

test("static guard: media-calibration's local JOURNAL_MEDIA_BUCKET literal matches lib/journal.ts's own constant", () => {
  const journal = readFileSync("src/lib/journal.ts", "utf8");
  assert.match(journal, /JOURNAL_MEDIA_BUCKET\s*=\s*"journal-media"/);
  const calibration = readFileSync("src/lib/admin/media-calibration.ts", "utf8");
  assert.match(calibration, /JOURNAL_MEDIA_BUCKET\s*=\s*"journal-media"/);
  assert.ok(M.CALIBRATION_ORIGINALS.some((e) => e.bucket === "journal-media"));
});

// ── a minimal fake admin client: .from(table) for verify()/registry, ─────
// .storage.from(bucket) for download/upload/list/remove ──────────────────
function fakeAdmin({ referencedKeys = new Set(M.CALIBRATION_ORIGINALS.map((e) => e.key)), objects = new Map(), failUploadFor = new Set() } = {}) {
  const uploadCalls = [];
  const registryRows = new Map(); // `${bucket}\0${path}` -> row

  function tableFrom(table) {
    if (table === "media_variants") {
      return {
        select: () => ({
          eq: (col, bucket) => ({
            in: async (col2, paths) => ({
              data: paths.filter((p) => registryRows.has(`${bucket}\u0000${p}`)).map((p) => registryRows.get(`${bucket}\u0000${p}`)),
              error: null,
            }),
          }),
        }),
        upsert: async (row) => {
          registryRows.set(`${row.bucket}\u0000${row.original_path}`, { original_path: row.original_path, variants: row.variants });
          return { error: null };
        },
        delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      };
    }
    // Any "entity" table used by a CalibrationEntry.verify() — keyed by
    // whichever key the test wants to mark referenced/unreferenced; the
    // fake just reports maybeSingle() truthy/falsy per-key via a closure
    // the test sets up (see fakeEntityQuery below). Real verify()
    // closures in media-calibration.ts build their own query chain per
    // entry, so here we just need .eq().eq().maybeSingle() to resolve.
    return {
      select: () => makeEntityChain(table),
    };
  }

  function makeEntityChain(table) {
    const chain = {
      eq: () => chain,
      maybeSingle: async () => ({ data: referencedKeys.has(table) ? {} : null, error: null }),
    };
    return chain;
  }

  function storageFrom(bucket) {
    return {
      download: async (path) => {
        const obj = objects.get(`${bucket}\u0000${path}`);
        return obj ? { data: new Blob([obj.buffer]), error: null } : { data: null, error: { message: "not found" } };
      },
      upload: async (path, buffer) => {
        uploadCalls.push({ bucket, path });
        if (failUploadFor.has(bucket + ":" + path.split(".")[0])) return { error: { message: "simulated upload failure" } };
        objects.set(`${bucket}\u0000${path}`, { buffer: Buffer.from(buffer) });
        return { error: null };
      },
      remove: async (paths) => {
        for (const p of paths) objects.delete(`${bucket}\u0000${p}`);
        return { error: null };
      },
      list: async (dir, { search } = {}) => {
        const prefix = dir ? `${bucket}\u0000${dir}/` : `${bucket}\u0000`;
        const matches = [...objects.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((k) => k.slice(prefix.length))
          .filter((name) => !name.includes("/"))
          .filter((name) => !search || name === search)
          .map((name) => ({ name, metadata: { size: objects.get(`${prefix}${name}`).buffer.length, mimetype: "image/jpeg" } }));
        return { data: matches, error: null };
      },
    };
  }

  return { admin: { from: tableFrom, storage: { from: storageFrom } }, objects, uploadCalls, registryRows };
}

test("preflightCalibration: all safe when referenced, source exists, no prior registry row", async () => {
  const objects = new Map();
  for (const e of M.CALIBRATION_ORIGINALS) objects.set(`${e.bucket}\u0000${e.path}`, { buffer: Buffer.from("fake") });
  const { admin } = fakeAdmin({ objects });
  // Override each entry's own verify() with a stub that always says
  // referenced (the entity-table shape varies per entry; this test is
  // about preflight's AGGREGATION logic, not re-deriving each real query).
  const originalVerifies = M.CALIBRATION_ORIGINALS.map((e) => e.verify);
  for (const e of M.CALIBRATION_ORIGINALS) e.verify = async () => ({ referenced: true, detail: "stub: referenced" });
  try {
    const preflight = await M.preflightCalibration(admin);
    assert.equal(preflight.length, 11);
    assert.ok(preflight.every((p) => p.safeToProcess), JSON.stringify(preflight.filter((p) => !p.safeToProcess)));
    assert.ok(preflight.every((p) => p.sourceExists));
    assert.ok(preflight.every((p) => !p.alreadyRegistered));
  } finally {
    M.CALIBRATION_ORIGINALS.forEach((e, i) => (e.verify = originalVerifies[i]));
  }
});

test("preflightCalibration: flags unreferenced, missing source, and pre-existing registry rows as unsafe", async () => {
  const entries = M.CALIBRATION_ORIGINALS;
  const objects = new Map();
  for (const e of entries) objects.set(`${e.bucket}\u0000${e.path}`, { buffer: Buffer.from("fake") });
  objects.delete(`${entries[1].bucket}\u0000${entries[1].path}`); // entry[1] source "deleted"
  const { admin, registryRows } = fakeAdmin({ objects });
  registryRows.set(`${entries[2].bucket}\u0000${entries[2].path}`, { original_path: entries[2].path, variants: { "160": {} } }); // entry[2] already registered

  const originalVerifies = entries.map((e) => e.verify);
  entries[0].verify = async () => ({ referenced: false, detail: "stub: orphaned" });
  for (let i = 1; i < entries.length; i++) entries[i].verify = async () => ({ referenced: true, detail: "stub: referenced" });
  try {
    const preflight = await M.preflightCalibration(admin);
    const byKey = Object.fromEntries(preflight.map((p) => [p.key, p]));
    assert.equal(byKey[entries[0].key].safeToProcess, false, "unreferenced must be unsafe");
    assert.equal(byKey[entries[1].key].safeToProcess, false, "missing source must be unsafe");
    assert.equal(byKey[entries[1].key].sourceExists, false);
    assert.equal(byKey[entries[2].key].safeToProcess, false, "already-registered must be unsafe");
    assert.equal(byKey[entries[2].key].alreadyRegistered, true);
    for (let i = 3; i < entries.length; i++) assert.equal(byKey[entries[i].key].safeToProcess, true, entries[i].key);
  } finally {
    entries.forEach((e, i) => (e.verify = originalVerifies[i]));
  }
});

test("calibrateOneOriginal (public): generates ONLY the role-required sizes, uploads, verifies, registers", async () => {
  const entry = M.CALIBRATION_ORIGINALS.find((e) => e.key === "business_logo_tendy"); // business_logo → 160+800 only
  const buf = await photo(1200, 1200, "jpeg");
  const { admin, objects, uploadCalls, registryRows } = fakeAdmin({ objects: new Map([[`${entry.bucket}\u0000${entry.path}`, { buffer: buf }]]) });

  const result = await M.calibrateOneOriginal(admin, entry);

  assert.equal(result.error, undefined);
  assert.equal(result.partialFailure, false);
  assert.deepEqual(result.derivatives.map((d) => d.size).sort((a, b) => a - b), [160, 800], "no 1600 — not required for business_logo");
  for (const d of result.derivatives) {
    assert.equal(d.uploaded, true);
    assert.equal(d.verified, true);
    assert.equal(d.format, "webp");
    assert.equal(d.upscaled, false);
    assert.ok(d.aspectRatioDeltaPct < 1);
  }
  assert.equal(result.registered, true);
  assert.deepEqual(result.registeredSizes.sort((a, b) => a - b), [160, 800]);
  assert.equal(uploadCalls.length, 2, "exactly 2 uploads — never 3");
  assert.ok(objects.has(`${entry.bucket}\u0000${V.variantPath(entry.path, 160)}`));
  assert.ok(objects.has(`${entry.bucket}\u0000${V.variantPath(entry.path, 800)}`));
  assert.equal(objects.has(`${entry.bucket}\u0000${V.variantPath(entry.path, 1600)}`), false);
  const row = registryRows.get(`${entry.bucket}\u0000${entry.path}`);
  assert.deepEqual(Object.keys(row.variants).sort(), ["160", "800"]);
});

test("calibrateOneOriginal (private Moment): derivatives uploaded in journal-media, but NO registry row", async () => {
  const entry = M.CALIBRATION_ORIGINALS.find((e) => e.key === "moment_photo_private");
  const buf = await photo(2000, 1500, "jpeg");
  const { admin, objects, registryRows } = fakeAdmin({ objects: new Map([[`${entry.bucket}\u0000${entry.path}`, { buffer: buf }]]) });

  const result = await M.calibrateOneOriginal(admin, entry);

  assert.deepEqual(result.derivatives.map((d) => d.size).sort((a, b) => a - b), [800, 1600]);
  assert.ok(result.derivatives.every((d) => d.verified));
  assert.equal(result.registered, false, "private Moment never gets a registry row");
  assert.deepEqual(result.registeredSizes, []);
  assert.equal(registryRows.has(`${entry.bucket}\u0000${entry.path}`), false);
  // But the actual derivative files DO exist, privately, next to the original.
  assert.ok(objects.has(`${entry.bucket}\u0000${V.variantPath(entry.path, 800)}`));
  assert.ok(objects.has(`${entry.bucket}\u0000${V.variantPath(entry.path, 1600)}`));
});

test("calibrateOneOriginal: a download failure is reported, nothing generated or registered", async () => {
  const entry = M.CALIBRATION_ORIGINALS.find((e) => e.key === "event_cover_free_bean");
  const { admin, registryRows } = fakeAdmin({ objects: new Map() }); // source missing
  const result = await M.calibrateOneOriginal(admin, entry);
  assert.match(result.error, /download failed/);
  assert.deepEqual(result.derivatives, []);
  assert.equal(result.registered, false);
  assert.equal(registryRows.size, 0);
});

test("calibrateOneOriginal: an upload failure leaves derivatives unverified and unregistered, original untouched", async () => {
  const entry = M.CALIBRATION_ORIGINALS.find((e) => e.key === "location_cover_vanderbilt"); // 800+1600
  const buf = await photo(1800, 1200, "jpeg");
  const { admin, objects, registryRows } = fakeAdmin({
    objects: new Map([[`${entry.bucket}\u0000${entry.path}`, { buffer: buf }]]),
    failUploadFor: new Set([`${entry.bucket}:${entry.path.split(".")[0]}`]),
  });
  const originalBefore = objects.get(`${entry.bucket}\u0000${entry.path}`).buffer;

  const result = await M.calibrateOneOriginal(admin, entry);

  assert.ok(result.derivatives.every((d) => !d.verified));
  assert.equal(result.registered, false);
  assert.equal(registryRows.size, 0);
  assert.equal(objects.get(`${entry.bucket}\u0000${entry.path}`).buffer, originalBefore, "original byte-identical, never touched");
});
