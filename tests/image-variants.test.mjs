// Image Performance Foundation — the shared variant architecture: path
// convention, display-size selection, real sharp generation (formats,
// alpha, orientation, no upscaling), upload failure isolation, and private
// signed-variant fallback + caching. No network, no production Storage —
// Storage is a local fake. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import sharp from "sharp";

// Resolve extensionless relative TS imports, and stub "server-only".
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

const V = await import("../src/lib/image-variants.ts");
const S = await import("../src/lib/image-variants-server.ts");
const C = await import("../src/lib/signed-image-urls.ts");

const PUB = "https://abc.supabase.co/storage/v1/object/public/findmi-media/";

// ── path convention ─────────────────────────────────────────────────────
test("variant paths are deterministic and replace only the final extension", () => {
  assert.equal(V.variantPath("3f2a.fv1.jpg", 800), "3f2a.fv1.w800.webp");
  assert.equal(V.variantPath("3f2a.fv1.jpeg", 160), "3f2a.fv1.w160.webp");
  assert.equal(V.variantPath("a.b.c.PNG", 1600), "a.b.c.w1600.webp");
  assert.equal(V.variantPath("x.fv1.webp", 800), "x.fv1.w800.webp");
  assert.equal(V.variantPath("journal/u/e/9c1d.jpg", 800), "journal/u/e/9c1d.w800.webp");
  assert.equal(V.variantPath("dir.with.dots/noext", 160), "dir.with.dots/noext.w160.webp");
  assert.equal(V.variantPath("photo.HEIC", 800), "photo.w800.webp");
  assert.throws(() => V.variantPath("x.fv1.w800.webp", 160));
});

test("originals and variants never collide; variants are recognisable", () => {
  for (const ext of ["jpg", "jpeg", "png", "webp", "JPG"]) {
    const original = V.markedOriginalName("3f2a-uuid", ext);
    assert.equal(original, `3f2a-uuid.fv1.${ext.toLowerCase()}`);
    assert.equal(V.isVariantPath(original), false);
    for (const size of V.VARIANT_SIZES) {
      const variant = V.variantPath(original, size);
      assert.equal(V.isVariantPath(variant), true);
      assert.notEqual(variant, original);
      assert.equal(V.hasPublicVariants(variant), false);
    }
  }
  assert.equal(V.hasPublicVariants("3f2a-uuid.fv1.jpg"), true);
  assert.equal(V.hasPublicVariants("3f2a-uuid.jpg"), false); // every pre-existing object
});

test("public URL resolution: marked → variant, everything else unchanged (fallback)", () => {
  const marked = `${PUB}3f2a.fv1.jpg`;
  assert.equal(V.imageVariantUrl(marked, "thumb"), `${PUB}3f2a.fv1.w160.webp`);
  assert.equal(V.imageVariantUrl(marked, "card"), `${PUB}3f2a.fv1.w800.webp`);
  assert.equal(V.imageVariantUrl(marked, "large"), `${PUB}3f2a.fv1.w1600.webp`);
  assert.equal(V.imageVariantUrl(marked, "original"), marked);
  assert.equal(V.imageVariantUrl(`${marked}?v=2`, "card"), `${PUB}3f2a.fv1.w800.webp?v=2`);
  const legacy = `${PUB}c51e16e3-670a-43b0-8ce9-b8b92b974f3c.jpg`;
  assert.equal(V.imageVariantUrl(legacy, "card"), legacy);
  for (const other of [
    "https://u.tally.so/x.fv1.jpg",
    "/seed/1.jpg",
    "https://abc.supabase.co/storage/v1/object/sign/journal-media/journal/u/e/a.jpg?token=t",
    null,
    undefined,
    "",
  ]) {
    assert.equal(V.imageVariantUrl(other, "card"), other);
  }
});

test("display size selection: 160 / 800 / 1600 from the declared slot", () => {
  assert.equal(V.inferImageSize({ sizes: "40px" }), "thumb");
  assert.equal(V.inferImageSize({ sizes: "56px" }), "thumb");
  assert.equal(V.inferImageSize({ sizes: "64px" }), "card");
  assert.equal(V.inferImageSize({ sizes: "224px" }), "card");
  assert.equal(V.inferImageSize({ sizes: "(min-width: 1024px) 380px, (min-width: 640px) 45vw, 85vw" }), "card"); // Moment collage
  assert.equal(V.inferImageSize({ sizes: "(min-width: 640px) 33vw, 50vw" }), "card");
  assert.equal(V.inferImageSize({ sizes: "(min-width: 768px) 672px, 100vw" }), "large"); // cover
  assert.equal(V.inferImageSize({ sizes: "100vw" }), "large");
  assert.equal(V.inferImageSize({ width: 40 }), "thumb");
  assert.equal(V.inferImageSize({ width: "32" }), "thumb");
  assert.equal(V.inferImageSize({ fill: true }), "large"); // unknown → never undersize
  assert.equal(V.sizeToVariant("thumb"), 160);
  assert.equal(V.sizeToVariant("card"), 800);
  assert.equal(V.sizeToVariant("large"), 1600);
  assert.equal(V.sizeToVariant("original"), null);
});

// ── generation (real sharp) ─────────────────────────────────────────────
const photo = (w, h, format, opts = {}) =>
  sharp({ create: { width: w, height: h, channels: opts.alpha ? 4 : 3, background: opts.alpha ? { r: 20, g: 176, b: 188, alpha: 0.4 } : { r: 120, g: 90, b: 60 } } })
    [format](format === "jpeg" ? { quality: 90 } : {})
    .withMetadata(opts.orientation ? { orientation: opts.orientation } : {})
    .toBuffer();

test("JPEG: 160/800/1600 WebP, aspect ratio kept, longest edge = size", async () => {
  const out = await S.generateImageVariants(await photo(3000, 2000, "jpeg"));
  assert.deepEqual(out.map((v) => v.size), [160, 800, 1600]);
  for (const v of out) {
    assert.equal(Math.max(v.width, v.height), v.size);
    assert.ok(Math.abs(v.width / v.height - 1.5) < 0.02, "aspect ratio");
    assert.equal((await sharp(v.buffer).metadata()).format, "webp");
  }
});

test("never upscales a small source", async () => {
  const out = await S.generateImageVariants(await photo(300, 200, "jpeg"));
  assert.deepEqual(out.map((v) => [v.width, v.height]), [[160, 107], [300, 200], [300, 200]]);
});

test("PNG with transparency keeps its alpha channel; opaque PNG and WebP work", async () => {
  const [, card] = await S.generateImageVariants(await photo(1200, 1200, "png", { alpha: true }));
  const meta = await sharp(card.buffer).metadata();
  assert.equal(meta.hasAlpha, true);
  const { data } = await sharp(card.buffer).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[3] > 80 && data[3] < 120, `alpha preserved (got ${data[3]})`);
  assert.equal((await S.generateImageVariants(await photo(1000, 600, "png"))).length, 3);
  assert.equal((await S.generateImageVariants(await photo(1000, 600, "webp"))).length, 3);
});

test("phone orientation metadata is applied (portrait stays portrait) and stripped", async () => {
  // Stored 4000×3000 landscape pixels flagged "rotate 90°" (EXIF 6), as phones do.
  const out = await S.generateImageVariants(await photo(4000, 3000, "jpeg", { orientation: 6 }));
  for (const v of out) assert.ok(v.height > v.width, `${v.size}: ${v.width}×${v.height} should be portrait`);
  assert.equal((await sharp(out[1].buffer).metadata()).orientation, undefined);
});

test("variants are generated only for safe raster formats", () => {
  for (const ok of ["image/jpeg", "image/png", "image/webp"]) assert.equal(S.canGenerateVariants(ok), true);
  for (const no of ["image/gif", "image/heic", "image/svg+xml"]) assert.equal(S.canGenerateVariants(no), false);
});

test("undecodable input throws (caller then stores the original only)", async () => {
  await assert.rejects(() => S.generateImageVariants(Buffer.from("not an image")));
});

// ── uploads: original is canonical, variants never fail the upload ────
function fakeStorage({ failVariantUploads = false, failOriginal = false } = {}) {
  const objects = new Map();
  const removed = [];
  const api = {
    upload: async (path, body, opts) => {
      if (failVariantUploads && V.isVariantPath(path)) return { error: { message: "boom" } };
      if (failOriginal && !V.isVariantPath(path)) return { error: { message: "original failed" } };
      objects.set(path, { body, opts });
      return { error: null };
    },
    remove: async (paths) => {
      for (const p of paths) objects.delete(p), removed.push(p);
      return { error: null };
    },
    download: async (path) => (objects.has(path) ? { data: new Blob([objects.get(path).body]), error: null } : { data: null, error: { message: "missing" } }),
  };
  return { admin: { storage: { from: () => api } }, objects, removed };
}
const asFile = async (buf, type) => new File([buf], "upload", { type });

test("new public upload: marked original + three WebP variants, long cache", async () => {
  const { admin, objects } = fakeStorage();
  const buf = await photo(2400, 1600, "jpeg");
  const res = await S.storePublicImage(admin, "findmi-media", { extension: "jpg", contentType: "image/jpeg" }, await asFile(buf, "image/jpeg"));
  assert.equal(res.variants, true);
  assert.match(res.path, /^[0-9a-f-]{36}\.fv1\.jpg$/);
  assert.equal(objects.size, 4);
  for (const size of V.VARIANT_SIZES) {
    const v = objects.get(V.variantPath(res.path, size));
    assert.ok(v, `variant ${size} stored`);
    assert.equal(v.opts.contentType, "image/webp");
    assert.equal(v.opts.cacheControl, "31536000");
    assert.equal(v.opts.upsert, false);
  }
  assert.equal(objects.get(res.path).opts.contentType, "image/jpeg");
});

test("variant failure never fails the upload: original stored unmarked, no stray variants", async () => {
  const { admin, objects } = fakeStorage({ failVariantUploads: true });
  const buf = await photo(1200, 800, "jpeg");
  const res = await S.storePublicImage(admin, "findmi-media", { extension: "jpg", contentType: "image/jpeg" }, await asFile(buf, "image/jpeg"));
  assert.equal(res.variants, false);
  assert.match(res.path, /^[0-9a-f-]{36}\.jpg$/);
  assert.deepEqual([...objects.keys()], [res.path]);
  assert.equal(V.imageVariantUrl(PUB + res.path, "card"), PUB + res.path); // readers use the original
});

test("undecodable / GIF uploads still store the original", async () => {
  const { admin, objects } = fakeStorage();
  const gif = await S.storePublicImage(admin, "findmi-media", { extension: "gif", contentType: "image/gif" }, await asFile(Buffer.from("GIF89a"), "image/gif"));
  assert.equal(gif.variants, false);
  const bad = await S.storePublicImage(admin, "findmi-media", { extension: "jpg", contentType: "image/jpeg" }, await asFile(Buffer.from("nope"), "image/jpeg"));
  assert.equal(bad.variants, false);
  assert.equal(objects.size, 2);
});

test("HEIC uploads use the already-converted JPEG buffer as the source", async () => {
  const { admin, objects } = fakeStorage();
  const converted = await photo(1600, 1200, "jpeg");
  const res = await S.storePublicImage(admin, "findmi-media", { extension: "jpg", contentType: "image/jpeg", converted: { buffer: converted } }, await asFile(Buffer.from("heic-bytes"), "image/heic"));
  assert.equal(res.variants, true);
  assert.equal(objects.get(res.path).body, converted);
});

test("original upload failure returns an error and cleans up its variants", async () => {
  const { admin, objects } = fakeStorage({ failOriginal: true });
  const res = await S.storePublicImage(admin, "findmi-media", { extension: "jpg", contentType: "image/jpeg" }, await asFile(await photo(900, 900, "jpeg"), "image/jpeg"));
  assert.deepEqual(res, { error: "original failed" });
  assert.equal(objects.size, 0);
});

test("private variants: generated next to the original, original untouched", async () => {
  const { admin, objects } = fakeStorage();
  const original = await photo(2048, 1536, "jpeg");
  objects.set("journal/u/e/a.jpg", { body: original, opts: {} });
  assert.equal(await S.storePrivateVariants(admin, "journal-media", "journal/u/e/a.jpg"), true);
  assert.equal(objects.get("journal/u/e/a.jpg").body, original);
  for (const size of V.VARIANT_SIZES) assert.ok(objects.has(`journal/u/e/a.w${size}.webp`));
  assert.equal(await S.storePrivateVariants(admin, "journal-media", "journal/u/e/missing.jpg"), false);
});

// ── private signing: variant when present, original fallback, caching ──
function fakeSigner(existing) {
  const calls = [];
  const sign = async (paths) => {
    calls.push(paths);
    return paths.map((p) => (existing.has(p) ? { path: p, signedUrl: `https://s/${p}?token=${calls.length}`, error: null } : { path: p, signedUrl: null, error: "Either the object does not exist or you do not have access to it" }));
  };
  return { sign, calls };
}

test("signed private variants: variant when it exists, original otherwise, one batch", async () => {
  const existing = new Set(["j/new.jpg", "j/new.w800.webp", "j/old.jpg"]);
  const { sign, calls } = fakeSigner(existing);
  const cache = C.createSignedUrlCache();
  const out = await C.signImageUrls(["j/new.jpg", "j/old.jpg"], ["card", "original"], sign, cache);
  assert.equal(calls.length, 1, "one signing call");
  assert.match(out.get("card").get("j/new.jpg"), /j\/new\.w800\.webp/);
  assert.match(out.get("card").get("j/old.jpg"), /j\/old\.jpg/); // no variant yet → original
  assert.match(out.get("original").get("j/new.jpg"), /j\/new\.jpg/);
});

test("signed URLs are reused for ≤45 minutes, never past their life", async () => {
  let t = 0;
  const cache = C.createSignedUrlCache({ now: () => t });
  const { sign, calls } = fakeSigner(new Set(["j/a.jpg"]));
  const first = (await C.signImageUrls(["j/a.jpg"], ["original"], sign, cache)).get("original").get("j/a.jpg");
  t = 44 * 60 * 1000;
  const again = (await C.signImageUrls(["j/a.jpg"], ["original"], sign, cache)).get("original").get("j/a.jpg");
  assert.equal(again, first, "same URL → browser cache can reuse it");
  t = 45 * 60 * 1000;
  const fresh = (await C.signImageUrls(["j/a.jpg"], ["original"], sign, cache)).get("original").get("j/a.jpg");
  assert.notEqual(fresh, first, "re-signed before the 60-minute expiry");
  assert.ok(C.SIGNED_URL_REUSE_MS + 15 * 60 * 1000 <= C.SIGNED_URL_TTL_SECONDS * 1000, "≥15 minutes left on anything served");
  assert.equal(calls.length, 2);
});

test("a missing variant is re-checked after 5 minutes (picks up late generation)", async () => {
  let t = 0;
  const existing = new Set(["j/a.jpg"]);
  const cache = C.createSignedUrlCache({ now: () => t });
  const { sign } = fakeSigner(existing);
  assert.match((await C.signImageUrls(["j/a.jpg"], ["card"], sign, cache)).get("card").get("j/a.jpg"), /a\.jpg/);
  existing.add("j/a.w800.webp");
  t = 5 * 60 * 1000;
  assert.match((await C.signImageUrls(["j/a.jpg"], ["card"], sign, cache)).get("card").get("j/a.jpg"), /a\.w800\.webp/);
});

test("a failed signing call is not cached", async () => {
  const cache = C.createSignedUrlCache();
  const out = await C.signImageUrls(["j/a.jpg"], ["card"], async () => null, cache);
  assert.equal(out.get("card").size, 0);
  assert.equal(cache.size, 0);
});

// ── static guards ───────────────────────────────────────────────────────
test("static guards: every public upload uses the shared pipeline; journal media stays private", () => {
  for (const f of [
    "src/lib/admin/upload.ts",
    "src/app/(public)/account/business/actions.ts",
    "src/app/(public)/account/event/actions.ts",
    "src/app/(public)/account/location/actions.ts",
  ]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /storePublicImage\(/, f);
    assert.doesNotMatch(src, /\.upload\(path/, f);
  }
  const journal = readFileSync("src/app/(public)/my-world/journal/actions.ts", "utf8");
  assert.match(journal, /storePrivateVariants\(/);
  assert.doesNotMatch(journal, /getPublicUrl/);
  assert.match(journal, /isVariantPath\(item\.storagePath\)/);
  const supabaseImage = readFileSync("src/components/SupabaseImage.tsx", "utf8");
  assert.match(supabaseImage, /imageVariantUrl\(/);
  assert.match(readFileSync("src/components/ImageLightbox.tsx", "utf8"), /variant="original"/);
});

test("static guards: Moments loading — first card prioritised, others deferred", () => {
  const d = readFileSync("src/components/moments/MomentsDiscovery.tsx", "utf8");
  assert.match(d, /priority=\{first\}/);
  assert.match(d, /load=\{first \|\| \(near && heroSettled\)\}/);
  assert.match(d, /load=\{railNear && \(first \|\| \(near && heroSettled\)\)\}/);
  assert.match(d, /heroOnly=\{first && !heroSettled\}/);
  assert.match(d, /HERO_HEAD_START_MS = 2500/);
  assert.doesNotMatch(d, /priority=\{i < 2\}/);
  const c = readFileSync("src/components/moments/MomentMediaCollage.tsx", "utf8");
  assert.match(c, /bg-mist/);
  assert.match(c, /\{load && \(/);
});
