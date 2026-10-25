// Image metadata privacy (Phase 2A): EXIF/GPS is stripped from uploaded
// originals, orientation is preserved, clean files are untouched, and every
// original-storing path sanitizes before upload.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import sharp from "sharp";

// Resolve extensionless relative TS imports, and stub "server-only" (same
// harness as tests/image-variants.test.mjs).
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
import { hasSensitiveImageMetadata, stripImageMetadata } from "../src/lib/image-metadata.ts";

async function photoWithGps(format = "jpeg") {
  const base = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#14B0BC" } })[format]().toBuffer();
  return sharp(base)
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Make: "TestPhone" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 44/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "73/1 59/1 0/1" },
    })
    [format]()
    .toBuffer();
}

test("JPEG with GPS EXIF: metadata removed, orientation applied", async () => {
  const input = await photoWithGps("jpeg");
  assert.equal(await hasSensitiveImageMetadata(input), true);
  const before = await sharp(input).metadata();
  assert.equal(before.orientation, 6);
  const out = await stripImageMetadata(input, "image/jpeg");
  assert.ok("buffer" in out && out.changed);
  const after = await sharp(out.buffer).metadata();
  assert.equal(await hasSensitiveImageMetadata(out.buffer), false);
  assert.ok(!out.buffer.includes(Buffer.from("TestPhone")), "device string gone");
  // Orientation 6 = rotate 90°: the stored pixels are now upright.
  assert.equal(after.width, 20);
  assert.equal(after.height, 40);
  assert.ok(!after.orientation || after.orientation === 1);
});

test("WebP and PNG with EXIF are cleaned too", async () => {
  for (const [format, type] of [["webp", "image/webp"], ["png", "image/png"]]) {
    const input = await photoWithGps(format);
    const out = await stripImageMetadata(input, type);
    assert.ok("buffer" in out);
    assert.equal(await hasSensitiveImageMetadata(out.buffer), false, `${format} clean`);
  }
});

test("a clean file is returned unchanged (no re-encode)", async () => {
  const clean = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
  const out = await stripImageMetadata(clean, "image/jpeg");
  assert.ok("buffer" in out && !out.changed);
  assert.equal(out.buffer, clean);
});

test("GIF and unknown types pass through", async () => {
  const buf = Buffer.from("GIF89a");
  const out = await stripImageMetadata(buf, "image/gif");
  assert.ok("buffer" in out && !out.changed);
});

test("static guards: every original-storing upload path strips metadata first", () => {
  const variants = readFileSync("src/lib/image-variants-server.ts", "utf8");
  assert.match(variants, /stripImageMetadata\(/, "public images (findmi-media)");
  const journal = readFileSync("src/app/(public)/my-world/journal/actions.ts", "utf8");
  assert.ok((journal.match(/stripImageMetadata\(|sanitizeStoredOriginal\(/g) ?? []).length >= 2, "Moment uploads: server upload and direct/HEIC finalize");
  assert.doesNotMatch(variants + journal, /withMetadata\(|keepExif\(|keepMetadata\(/);
});

test("public views never sign the stored original; missing variants are reported", async () => {
  const { signImageUrls, createSignedUrlCache } = await import("../src/lib/signed-image-urls.ts");
  const existing = new Set(["m/a.jpg", "m/a.w800.webp", "m/b.jpg"]); // b has no variants
  const sign = async (paths) => paths.map((p) => ({ path: p, signedUrl: existing.has(p) ? `signed:${p}` : null, error: existing.has(p) ? null : "nf" }));
  let missing = [];
  const pub = await signImageUrls(["m/a.jpg", "m/b.jpg"], ["card", "original"], sign, createSignedUrlCache(), {
    allowOriginal: false,
    onMissingVariants: (p) => (missing = p),
  });
  assert.equal(pub.get("card").get("m/a.jpg"), "signed:m/a.w800.webp");
  assert.equal(pub.get("original").get("m/a.jpg"), "signed:m/a.w800.webp", "fullscreen uses the largest variant, not the original");
  assert.equal(pub.get("card").has("m/b.jpg"), false, "no original fallback");
  assert.deepEqual(missing, ["m/b.jpg"]);
  const owner = await signImageUrls(["m/b.jpg"], ["card"], sign, createSignedUrlCache());
  assert.equal(owner.get("card").get("m/b.jpg"), "signed:m/b.jpg", "owner views keep the original fallback");
});
