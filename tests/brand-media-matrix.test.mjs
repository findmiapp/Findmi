// Brand media acceptance matrix — the GENERAL contract, not one site at a
// time. Legitimate modern brand media passes (any credible logo shape,
// badge, very wide wordmark, white-on-transparent, AVIF, imperfect MIME
// labels); unsafe, non-image, corrupt, blank, featureless, tiny and
// pathological media is refused. Fake transports only — no network, no
// real brand domains in logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import sharp from "sharp";

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

const IMG = await import("../src/lib/brand-images.ts");
const F = await import("../src/lib/safe-fetch.ts");
const X = await import("../src/lib/brand-website-extract.ts");

// ── fixtures ──────────────────────────────────────────────────────────────
const SITE = new URL("https://www.northwind-goods.com/");
const CDN = "https://media.northwind-cdn.com";
const strokes = (w, h, n, fill = "#111") => Array.from({ length: n }, (_, i) => `<rect fill="${fill}" x="${Math.round((i * w) / n)}" y="0" width="${Math.max(1, Math.round(w / n / 2))}" height="${h}"/>`).join("");
const wordmark = (w, h, n, fill) => `<svg viewBox="0 0 ${w} ${h}">${strokes(w, h, n, fill)}</svg>`;
/** The extractor's own inline candidate for a header home-link mark. */
const inline = (svg) =>
  X.extractBrandProfile(`<html><head><title>Northwind</title></head><body><header><a href="/" class="site-logo" aria-label="Northwind">${svg}</a></header></body></html>`, SITE).svgLogoCandidates[0];
/** A detailed photograph-like image (not a low-information graphic). */
const photo = async (w, h, fmt) => {
  // A smooth multi-hue field (many colours, no dominant one) — like a photo.
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      raw[i] = Math.round((x / w) * 255);
      raw[i + 1] = Math.round((y / h) * 255);
      raw[i + 2] = Math.round(((x + y) / (w + h)) * 255);
    }
  }
  const img = sharp(raw, { raw: { width: w, height: h, channels: 3 } });
  return fmt === "avif" ? img.avif({ quality: 60 }).toBuffer() : fmt === "webp" ? img.webp().toBuffer() : img.jpeg().toBuffer();
};
/** A mark: a coloured shape with a contrasting glyph, on transparency. */
const markPng = (w, h, fill = { r: 18, g: 52, b: 86, alpha: 1 }, glyph = { r: 255, g: 255, b: 255, alpha: 1 }) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: { create: { width: Math.round(w * 0.8), height: Math.round(h * 0.8), channels: 4, background: fill } }, left: Math.round(w * 0.1), top: Math.round(h * 0.1) },
      { input: { create: { width: Math.round(w * 0.3), height: Math.round(h * 0.3), channels: 4, background: glyph } }, left: Math.round(w * 0.35), top: Math.round(h * 0.35) },
    ])
    .png()
    .toBuffer();
/** A verifier fed by a fake (already safe-fetched) response. */
const served = (body, contentType) => ({ fetchImage: async (u) => ({ ok: true, url: new URL(u), body, contentType, bytes: body.length, redirects: 0 }) });
const verify = (url, role, deps) => IMG.fetchVerifiedBrandImage(url, role, deps);
/** The real Brand image fetch (every safe-fetch rule) over a stub transport. */
const viaFetch = (respond) => ({ fetchImage: (u) => F.safeFetchBrandImage(u, { transport: async (url) => respond(url) }) });
const response = (status, headers, body = Buffer.alloc(0)) => ({ status, headers, body: (async function* () { yield body; })(), destroy: () => {} });

// ── LEGITIMATE MEDIA PASSES ───────────────────────────────────────────────

test("legit: conventional storefront assets (JPEG share image, square PNG icon) pass", async () => {
  const cover = await verify(`${CDN}/files/share.jpg`, "cover", served(await photo(1200, 630), "image/jpeg"));
  assert.equal(cover.ok, true, IMG.brandImageFailureReason(cover));
  const icon = await verify(`${CDN}/files/apple-touch-icon.png`, "logo", served(await markPng(180, 180), "image/png"));
  assert.equal(icon.ok, true, IMG.brandImageFailureReason(icon));
});

test("legit: a wide inline SVG wordmark (13.3:1) and an AVIF cover pass — through the real fetch path", async () => {
  const mark = await verify(inline(wordmark(400, 30, 11)), "logo");
  assert.equal(mark.ok, true, IMG.brandImageFailureReason(mark));
  assert.deepEqual([mark.image.width, mark.image.height], [800, 60]);
  const avif = await photo(1600, 900, "avif");
  const cover = await verify(`${CDN}/i/hero.jpg`, "cover", viaFetch(() => response(200, { "content-type": "image/avif" }, avif)));
  assert.equal(cover.ok, true, IMG.brandImageFailureReason(cover));
  assert.equal(cover.image.validated.contentType, "image/webp", "normalized to Findmi's storage format before it is Brand media");
  assert.deepEqual([cover.image.width, cover.image.height], [1600, 900]);
});

test("legit: badge / round logos, very wide (20:1) and tall stacked marks pass", async () => {
  const badge = `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="58" fill="#0b3d2e"/>${strokes(80, 30, 6, "#f4e9c1").replace(/x="(\d+)"/g, (_, x) => `x="${Number(x) + 20}"`).replace(/y="0"/g, 'y="45"')}</svg>`;
  for (const [label, svg] of [
    ["round badge", badge],
    ["square badge", `<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#222"/>${strokes(100, 100, 5, "#e6c200")}</svg>`],
    ["very wide 20:1", wordmark(400, 20, 20)],
    ["tall stacked 1:3", `<svg viewBox="0 0 60 180">${strokes(60, 180, 3)}</svg>`],
  ]) {
    const r = await verify(inline(svg), "logo");
    assert.equal(r.ok, true, `${label}: ${r.ok ? "" : IMG.brandImageFailureReason(r)}`);
  }
});

test("legit: transparent, monochrome and white-on-transparent raster logos pass (white is plated, not dropped)", async () => {
  const transparent = await verify(`${CDN}/logo.png`, "logo", served(await markPng(600, 200), "image/png"));
  assert.equal(transparent.ok, true);
  const mono = await verify(`${CDN}/logo-black.png`, "logo", served(await markPng(500, 120, { r: 0, g: 0, b: 0, alpha: 1 }, { r: 0, g: 0, b: 0, alpha: 0 }), "image/png"));
  assert.equal(mono.ok, true, IMG.brandImageFailureReason(mono));
  const white = await verify(`${CDN}/logo-white.png`, "logo", served(await markPng(500, 120, { r: 255, g: 255, b: 255, alpha: 1 }, { r: 255, g: 255, b: 255, alpha: 0 }), "image/png"));
  assert.equal(white.ok, true, IMG.brandImageFailureReason(white));
  assert.equal((await sharp(white.image.body).metadata()).hasAlpha, false, "kept on Findmi's dark plate");
});

test("legit: an imperfect MIME label never decides — the verified bytes do", async () => {
  const jpeg = await photo(1200, 630);
  for (const label of ["image/png", "application/octet-stream", "image/jpg", "binary/octet-stream"]) {
    const r = await verify(`${CDN}/a.jpg`, "cover", served(jpeg, label));
    assert.equal(r.ok, true, label);
    assert.equal(r.image.validated.contentType, "image/jpeg", `${label} → stored as what it really is`);
  }
  const avifAsJpeg = await verify(`${CDN}/b.jpg`, "cover", served(await photo(1200, 630, "avif"), "image/jpeg"));
  assert.equal(avifAsJpeg.ok, true, "AVIF bytes behind a JPEG label");
  assert.equal(avifAsJpeg.image.validated.contentType, "image/webp");
  const xpng = await verify(`${CDN}/c.png`, "logo", viaFetch(async () => response(200, { "content-type": "image/x-png" }, await markPng(200, 200))));
  assert.equal(xpng.ok, true, "legacy image/x-png label through the real fetch");
});

// ── INVALID MEDIA IS REFUSED ──────────────────────────────────────────────

test("refused: malformed and unsafe SVG (scripts, event handlers, external references)", async () => {
  const malformed = await verify(`data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g></svg').toString("base64")}`, "logo");
  assert.equal(malformed.ok, false);
  const L = wordmark(300, 30, 11);
  for (const [label, svg] of [
    ["script", L.replace("</svg>", "<script>alert(1)</script></svg>")],
    ["event handler", L.replace("<svg ", '<svg onload="alert(1)" ')],
    ["external image", L.replace("</svg>", '<image href="https://evil.example/x.png" width="9" height="9"/></svg>')],
    ["external url()", L.replace("<svg ", '<svg style="fill:url(https://evil.example/p)" ')],
    ["foreignObject", L.replace("</svg>", "<foreignObject><div>x</div></foreignObject></svg>")],
  ]) {
    const cand = inline(svg);
    if (!cand) continue; // refused before it is even a candidate
    const r = await verify(cand, "logo");
    assert.deepEqual([r.ok, r.reason], [false, "invalid_file"], label);
  }
});

test("refused: blank, featureless block, tiny icon and pathological sliver", async () => {
  const blank = await sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  assert.equal((await verify(`${CDN}/blank.png`, "logo", served(blank, "image/png"))).reason, "blank");
  const block = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#1db954" } }).png().toBuffer();
  const b = await verify(`${CDN}/block.png`, "logo", served(block, "image/png"));
  assert.deepEqual([b.reason, b.measure.code], ["unsuitable", "solid_fill"]);
  const tiny = await verify(`${CDN}/favicon-16.png`, "logo", served(await markPng(16, 16), "image/png"));
  assert.deepEqual([tiny.reason, tiny.measure.code], ["unsuitable", "too_small"]);
  const sliver = await verify(inline(wordmark(800, 20, 30)), "logo");
  assert.deepEqual([sliver.reason, sliver.measure.code], ["unsuitable", "aspect_ratio"], "40:1 — a rule, not a mark");
  // UI icons / decorative SVGs never even become logo candidates.
  const ui = `<html><head><title>Northwind</title></head><body><header><a href="/cart" aria-label="Cart"><svg viewBox="0 0 24 24"><path d="M1 1h20v20H1z"/></svg></a><a href="/"><svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg></a></header><section class="hero"><svg viewBox="0 0 500 300"><circle cx="250" cy="150" r="140"/></svg></section></body></html>`;
  assert.deepEqual(X.extractBrandProfile(ui, SITE).svgLogoCandidates, []);
});

test("refused: HTML with HTTP 200, a non-image label, and corrupt bytes behind a correct label", async () => {
  const html = await verify(`${CDN}/i/hero.jpg`, "cover", viaFetch(() => response(200, { "content-type": "text/html; charset=utf-8" }, Buffer.from("<!doctype html><title>Access Denied</title>"))));
  assert.equal(IMG.brandImageFailureReason(html), "fetch_failed:unsupported_content:200:media_type:text/html:ext=jpg");
  const plain = await verify(`${CDN}/a.jpg`, "cover", viaFetch(async () => response(200, { "content-type": "text/plain" }, await photo(1200, 630))));
  assert.equal(plain.reason, "fetch_failed", "an image label is required at the fetch boundary");
  const corrupt = await verify(`${CDN}/a.jpg`, "cover", served(Buffer.from("\xff\xd8\xffgarbage-not-a-jpeg", "latin1"), "image/jpeg"));
  assert.equal(corrupt.ok, false);
  const fakeAvif = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypavif\0\0\0\0avifmif1", "latin1"), Buffer.from("not really an image")]);
  assert.deepEqual([(await verify(`${CDN}/a.avif`, "cover", served(fakeAvif, "image/avif"))).reason], ["invalid_file"], "AVIF signature but undecodable");
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic\0\0\0\0mif1heic", "latin1"), Buffer.alloc(64)]);
  assert.equal((await verify(`${CDN}/a.jpg`, "cover", served(heic, "image/jpeg"))).ok, false, "HEIC (HEVC) is not supported by the deployed decoder");
  const svgAsCover = await verify(`${CDN}/a.svg`, "cover", served(Buffer.from(wordmark(300, 30, 9)), "image/svg+xml"));
  assert.equal(svgAsCover.ok, false, "a cover is never an SVG");
});

test("refused: oversized response, rejected redirect and blocked destination (safe-fetch bounds unchanged)", async () => {
  const big = await verify(`${CDN}/huge.jpg`, "cover", viaFetch(() => response(200, { "content-type": "image/jpeg", "content-length": String(6 * 1024 * 1024) })));
  assert.equal(IMG.brandImageFailureReason(big), "fetch_failed:too_large:200:image/jpeg:ext=jpg");
  const redirect = await verify(`${CDN}/r.jpg`, "cover", viaFetch(() => response(302, { location: "http://media.northwind-cdn.com/r.jpg" })));
  assert.match(IMG.brandImageFailureReason(redirect), /^fetch_failed:redirect_rejected/);
  for (const u of ["https://127.0.0.1/logo.png", "https://10.0.0.5/logo.png", "https://cdn.local/logo.png", "http://www.northwind-goods.com/logo.png"]) {
    const r = await IMG.fetchVerifiedBrandImage(u, "logo");
    assert.equal(r.ok, false, u);
    assert.equal(r.reason, "fetch_failed", u);
  }
});

// ── SHARED-FETCH BOUNDARY ─────────────────────────────────────────────────

test("boundary: the richer media list is a Brand capability only — Event Import's image fetch is unchanged", async () => {
  const avif = await photo(800, 450, "avif");
  const ev = await F.safeFetchImage(`${CDN}/e.avif`, { transport: async () => response(200, { "content-type": "image/avif" }, avif) });
  assert.deepEqual([ev.ok, ev.code], [false, "unsupported_content"], "Event Import still refuses AVIF labels");
  const brand = await F.safeFetchBrandImage(`${CDN}/e.avif`, { transport: async () => response(200, { "content-type": "image/avif" }, avif) });
  assert.equal(brand.ok, true);
  assert.deepEqual([...F.SAFE_FETCH_BRAND_IMAGE_TYPES].filter((t) => !F.SAFE_FETCH_IMAGE_TYPES.has(t)).sort(), ["image/avif", "image/x-png"]);
  assert.equal(IMG.isAvifBytes(avif), true);
  assert.equal(IMG.isAvifBytes(await photo(64, 64)), false);
});
