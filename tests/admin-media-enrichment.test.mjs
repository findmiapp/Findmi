// Admin Media Enrichment — a chosen source image attached to an EXISTING
// Place / Event / Business through Findmi's existing image pipeline
// (safe fetch → real-bytes validation → storePublicImage with variants →
// the record's existing media column). Fakes only — no network, no
// database; verification, variant generation and storePublicImage are real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import sharp from "sharp";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/cache") return { url: "data:text/javascript,export const revalidatePath=(p)=>{(globalThis.__REVALIDATED??=[]).push(p)};", shortCircuit: true };
    if (specifier === "@/lib/admin/requireAdminSupabase")
      return { url: "data:text/javascript,export async function requireAdminSupabase(){const c=globalThis.__ADMIN;if(!c)throw new Error('Unauthorized');return c;}", shortCircuit: true };
    if (specifier === "@/lib/admin/auth")
      return { url: "data:text/javascript,export async function requireAdmin(){if(!globalThis.__ADMIN)throw new Error('Unauthorized')}", shortCircuit: true };
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

const E = await import("../src/lib/admin/media-enrichment.ts");
const EM = await import("../src/lib/event-import/media.ts");
const BI = await import("../src/lib/brand-images.ts");
const A = await import("../src/app/admin/(protected)/media-enrichment/actions.ts");
const read = (p) => readFileSync(p, "utf8");

const ID = "11111111-2222-4333-8444-555555555555";
const SRC = "https://www.example-venue.com/media/hero.jpg";

// A photo-like cover (gradient) and a two-tone logo — real encodable images.
async function photo(w, h) {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    raw[i] = (x * 255) / w; raw[i + 1] = (y * 255) / h; raw[i + 2] = ((x + y) * 97) % 255;
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
}
async function logo() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#ffffff"/><rect x="40" y="50" width="120" height="100" fill="#A64232"/><rect x="200" y="70" width="160" height="60" fill="#20292D"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
const fetchOk = (body, contentType) => async (url) => ({ ok: true, url: new URL(url), body, contentType, bytes: body.length, redirects: 0 });

/** Fake service-role client: one table row per table, recorded writes,
 * a storage bucket that records uploads. */
function fakeAdmin(rows) {
  const uploads = [];
  const updates = [];
  const client = {
    uploads,
    updates,
    from(table) {
      return {
        select() {
          return { eq: (_c, id) => ({ maybeSingle: async () => ({ data: rows[table]?.id === id ? rows[table] : null, error: null }) }) };
        },
        update(patch) {
          return { eq: async (_c, id) => { updates.push({ table, id, patch }); if (rows[table]?.id === id) Object.assign(rows[table], patch); return { error: null }; } };
        },
      };
    },
    storage: {
      from(bucket) {
        return {
          upload: async (path, _body, opts) => { uploads.push({ bucket, path, contentType: opts?.contentType }); return { data: { path }, error: null }; },
          remove: async () => ({ data: null, error: null }),
          getPublicUrl: (path) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
        };
      },
    },
  };
  return client;
}
function depsWith(fetchImage) {
  return {
    verifyCover: (url) => EM.fetchVerifiedEventImage(url, { fetchImage }),
    storeCover: EM.storeEventImage,
    verifyLogo: (url, role) => BI.fetchVerifiedBrandImage(url, role, { fetchImage }),
    storeLogo: BI.storeBrandImage,
  };
}
const rowsFor = () => ({
  locations: { id: ID, slug: "art-house-productions", cover_image_url: null, logo_url: null },
  events: { id: ID, slug: "spooky-fest-2026", cover_image_url: null },
  businesses: { id: ID, slug: "modcup-coffee", cover_image_url: "https://proj.supabase.co/storage/v1/object/public/findmi-media/old.jpg", logo_url: null },
});

for (const [entityType, table] of [["location", "locations"], ["event", "events"], ["business", "businesses"]]) {
  test(`${entityType} cover: stored in findmi-media with variants, then written to ${table}.cover_image_url`, async () => {
    const admin = fakeAdmin(rowsFor());
    const r = await E.enrichEntityImage(admin, { entityType, entityId: ID, target: "cover", url: SRC }, depsWith(fetchOk(await photo(1600, 900), "image/jpeg")));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.column, "cover_image_url");
    assert.match(r.url, /^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/public\/findmi-media\//, "Findmi's own URL, never the source URL");
    assert.notEqual(r.url, SRC);
    // Original + the existing 160/800/1600 WebP variants, all in findmi-media.
    assert.ok(admin.uploads.every((u) => u.bucket === "findmi-media"));
    assert.ok(admin.uploads.length >= 4, `original + variants (got ${admin.uploads.length})`);
    assert.equal(admin.uploads.filter((u) => u.contentType === "image/webp").length, 3);
    assert.deepEqual(admin.updates, [{ table, id: ID, patch: { cover_image_url: r.url } }], "only the target column on the existing row");
    if (entityType === "business") assert.match(r.previousUrl, /old\.jpg$/, "reports the image it replaced");
  });
}

test("Place and Business logos go through the Brand logo verification and storage", async () => {
  for (const entityType of ["location", "business"]) {
    const admin = fakeAdmin(rowsFor());
    const r = await E.enrichEntityImage(admin, { entityType, entityId: ID, target: "logo", url: "https://www.example-venue.com/logo.png" }, depsWith(fetchOk(await logo(), "image/png")));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.column, "logo_url");
    assert.equal(admin.updates[0].patch.logo_url, r.url);
  }
});

test("request rules: invalid / non-https / internal URLs, unknown targets and missing records are refused before any fetch", async () => {
  let fetched = 0;
  const deps = depsWith(async () => { fetched++; return { ok: false, code: "error", redirects: 0 }; });
  const admin = fakeAdmin(rowsFor());
  for (const url of ["not a url", "http://www.example-venue.com/a.jpg", "https://localhost/a.jpg", "https://127.0.0.1/a.jpg", "https://10.0.0.5/a.jpg", "https://metadata.google.internal/a.jpg", "https://user:pw@example-venue.com/a.jpg", "https://example-venue.com:8443/a.jpg", "file:///etc/passwd"]) {
    const r = await E.enrichEntityImage(admin, { entityType: "location", entityId: ID, target: "cover", url }, deps);
    assert.equal(r.ok, false, url);
  }
  assert.equal((await E.enrichEntityImage(admin, { entityType: "event", entityId: ID, target: "logo", url: SRC }, deps)).ok, false, "Events have no logo");
  assert.equal((await E.enrichEntityImage(admin, { entityType: "product", entityId: ID, target: "cover", url: SRC }, deps)).ok, false);
  assert.equal((await E.enrichEntityImage(admin, { entityType: "location", entityId: "nope", target: "cover", url: SRC }, deps)).ok, false);
  const missing = await E.enrichEntityImage(admin, { entityType: "location", entityId: "99999999-2222-4333-8444-555555555555", target: "cover", url: SRC }, deps);
  assert.deepEqual(missing, { ok: false, error: "That record no longer exists." });
  assert.equal(fetched, 0, "nothing fetched for a refused request");
  assert.equal(admin.updates.length + admin.uploads.length, 0, "nothing written");
});

test("non-image, unsuitable and failed remote fetches are reported per row — nothing stored, record untouched", async () => {
  const cases = [
    [fetchOk(Buffer.from("<html>not an image</html>"), "text/html"), /didn't return an image/],
    [fetchOk(Buffer.from("GIF89a-but-not-really"), "image/gif"), /isn't a supported image file|couldn't be read/],
    [fetchOk(Buffer.from("%PDF-1.4 not an image"), "image/jpeg"), /isn't a supported image file/],
    [fetchOk(await photo(120, 80), "image/jpeg"), /too small or too stretched/],
    [async () => ({ ok: false, code: "timeout", redirects: 0 }), /Couldn't download/],
    [async () => ({ ok: false, code: "blocked_destination", redirects: 0 }), /Couldn't download/],
  ];
  for (const [fetchImage, message] of cases) {
    const admin = fakeAdmin(rowsFor());
    const r = await E.enrichEntityImage(admin, { entityType: "event", entityId: ID, target: "cover", url: SRC }, depsWith(fetchImage));
    assert.equal(r.ok, false);
    assert.match(r.error, message);
    assert.equal(admin.uploads.length + admin.updates.length, 0);
  }
});

test("repeated processing stores a fresh copy and replaces the field (same as re-uploading in the edit form); previousUrl says what it replaced", async () => {
  const admin = fakeAdmin(rowsFor());
  const deps = depsWith(fetchOk(await photo(1200, 800), "image/jpeg"));
  const first = await E.enrichEntityImage(admin, { entityType: "location", entityId: ID, target: "cover", url: SRC }, deps);
  const second = await E.enrichEntityImage(admin, { entityType: "location", entityId: ID, target: "cover", url: SRC }, deps);
  assert.equal(first.ok && second.ok, true);
  assert.equal(first.previousUrl, null);
  assert.equal(second.previousUrl, first.url);
  assert.notEqual(second.url, first.url, "server UUID path, never an overwrite");
  // The table UI never re-runs a finished row or a duplicate of an earlier row.
  const ui = read("src/app/admin/(protected)/media-enrichment/MediaEnrichmentTable.tsx");
  assert.match(ui, /if \(!row \|\| row\.status === "done" \|\| isDuplicate\(row\)\) continue;/);
});

test("Server Actions are Admin-only (fail closed before any fetch or write)", async () => {
  globalThis.__ADMIN = undefined;
  assert.deepEqual(await A.processMediaRow({ entityType: "location", entityId: ID, target: "cover", url: SRC }), { ok: false, error: "Unauthorized." });
  assert.deepEqual(await A.previewMediaRow("cover", SRC), { error: "Unauthorized." });
  const actions = read("src/app/admin/(protected)/media-enrichment/actions.ts");
  assert.match(actions, /^"use server";/);
  assert.match(actions, /admin = await requireAdminSupabase\(\);/);
  const page = read("src/app/admin/(protected)/media-enrichment/page.tsx");
  assert.match(page, /if \(!\(await isAdminSession\(\)\)\) redirect\("\/admin\/login"\);/);
  // The browser never fetches the source image and never sees privileged credentials.
  const ui = read("src/app/admin/(protected)/media-enrichment/MediaEnrichmentTable.tsx");
  assert.match(ui, /^"use client";/);
  assert.doesNotMatch(ui, /SERVICE_ROLE|getAdminSupabase|supabase-admin|<img src=\{row\.url\}/);
  assert.doesNotMatch(ui, /fetch\(row\.url|fetch\(url/);
  assert.ok(existsSync("src/app/admin/(protected)/media-enrichment/page.tsx"));
});

test("reuses the existing pipeline only — no new bucket, storage or fetch code", () => {
  const lib = read("src/lib/admin/media-enrichment.ts");
  assert.match(lib, /from "@\/lib\/event-import\/media"/);
  assert.match(lib, /from "@\/lib\/brand-images"/);
  assert.doesNotMatch(lib, /\.storage\.|createClient\(|\bfetch\(/);
  assert.deepEqual(E.MEDIA_TARGETS, {
    location: { cover: "cover_image_url", logo: "logo_url" },
    event: { cover: "cover_image_url" },
    business: { cover: "cover_image_url", logo: "logo_url" },
  });
});
