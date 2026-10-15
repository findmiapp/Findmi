// Brand media verification — the two production failure classes seen on a
// modern brand site: (1) an inline SVG wordmark rejected as "unsuitable"
// (the 6:1 raster logo ratio applied to a ~10:1 vector wordmark), and
// (2) remote image failures all collapsed into "fetch_failed". Fixtures and
// fake fetchers only — no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const X = await import("../src/lib/brand-website-extract.ts");
const read = (p) => readFileSync(p, "utf8");

/** A one-line wordmark: `n` letter strokes across a w×h viewBox. */
const lettering = (w, h, n, fill = "") =>
  `<svg viewBox="0 0 ${w} ${h}">${Array.from({ length: n }, (_, i) => `<rect${fill ? ` fill="${fill}"` : ""} x="${Math.round((i * w) / n)}" y="0" width="${Math.round(w / n / 2)}" height="${h}"/>`).join("")}</svg>`;
const BASE = new URL("https://www.marcbrand.com/");
/** The page's inline header mark → the candidate the extractor produces. */
const inline = (svg) => {
  const html = `<html><head><title>Marc Brand</title></head><body><header><a href="/" class="site-logo" aria-label="Marc Brand">${svg}</a></header></body></html>`;
  return X.extractBrandProfile(html, BASE).svgLogoCandidates[0];
};
const verify = (url, role = "logo", deps) => IMG.fetchVerifiedBrandImage(url, role, deps);

// ── 1. Inline SVG wordmarks ───────────────────────────────────────────────

test("wordmark: a legitimate wide vector wordmark (~10:1, like a two-word fashion mark) now passes", async () => {
  const r = await verify(inline(lettering(300, 30, 11)));
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual([r.image.width, r.image.height], [800, 80], "rendered at 800px on the long side");
  assert.equal(r.image.validated.contentType, "image/png");
  assert.equal((await verify(inline(lettering(360, 30, 12)))).ok, true, "12:1 is the vector limit");
  assert.equal((await verify(inline(lettering(300, 50, 6)))).ok, true, "6:1 (800×133 after rounding) passes too");
});

test("wordmark: aspect is a sanity bound (24:1) for every logo, not a design rule; raster keeps its resolution minimum", async () => {
  assert.equal(IMG.LOGO_MAX_ASPECT, 24);
  assert.equal(IMG.isSuitableBrandImage("logo", 800, 80), true, "a 10:1 raster wordmark file is legitimate");
  assert.equal(IMG.isSuitableBrandImage("logo", 800, 80, { vectorWordmark: true }), true);
  assert.equal(IMG.isSuitableBrandImage("logo", 960, 40), true, "24:1 raster at usable resolution");
  assert.equal(IMG.isSuitableBrandImage("logo", 800, 30), false, "raster: 30px short side is unusably small");
  assert.equal(IMG.isSuitableBrandImage("logo", 800, 34, { vectorWordmark: true }), true, "vector: rendered, so resolution is never the issue");
  assert.equal(IMG.isSuitableBrandImage("logo", 800, 20, { vectorWordmark: true }), false, "40:1 is a rule/divider");
  assert.equal(IMG.isSuitableBrandImage("logo", 100, 400), true, "tall stacked logo");
  assert.equal(IMG.isSuitableBrandImage("logo", 8000, 2000), false, "resource bound");
  const strap = await verify(inline(lettering(400, 10, 20)));
  assert.deepEqual([strap.ok, strap.reason, strap.measure.code], [false, "unsuitable", "aspect_ratio"]);
  // Covers keep their landscape window (fixed banner crop).
  assert.equal(IMG.isSuitableBrandImage("cover", 1200, 100, { vectorWordmark: true }), false);
});

test("wordmark: blank and solid-block SVGs fail; a white-only mark is KEPT on a dark plate", async () => {
  const blank = await verify(inline('<svg viewBox="0 0 200 50"></svg>'));
  assert.deepEqual([blank.ok, blank.reason], [false, "blank"], "nothing drawn");
  const hairline = await verify(inline('<svg viewBox="0 0 400 100"><rect x="0" y="0" width="2" height="2"/></svg>'));
  assert.deepEqual([hairline.ok, hairline.reason], [false, "blank"], "near-blank");
  const solid = await verify(inline('<svg viewBox="0 0 200 50"><path d="M0 0h200v50H0z"/></svg>'));
  assert.deepEqual([solid.ok, solid.reason], [false, "unsuitable"], "a filled block is not lettering");
  const white = await verify(inline(lettering(300, 30, 11, "#ffffff")));
  assert.equal(white.ok, true, "content exists — it just needs a plate");
  const plated = await sharp(white.image.body).raw().toBuffer({ resolveWithObject: true });
  assert.equal(plated.info.channels, 3, "transparency flattened");
  let plate = 0;
  for (let i = 0; i < plated.data.length; i += 3) if (plated.data[i] === 17 && plated.data[i + 1] === 17 && plated.data[i + 2] === 17) plate += 1;
  assert.ok(plate / (plated.data.length / 3) > 0.3, "the transparent background became the dark plate (#111)");
});

test("wordmark: tiny icons and decorative SVGs never become candidates; unsafe SVGs still fail", async () => {
  const icon = `<html><head><title>Marc Brand</title></head><body><header><a href="/"><svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg></a><a href="/cart" aria-label="Cart"><svg viewBox="0 0 24 24"><path d="M1 1h20v20H1z"/></svg></a></header><main><svg viewBox="0 0 400 400"><circle cx="200" cy="200" r="150"/></svg></main></body></html>`;
  assert.deepEqual(X.extractBrandProfile(icon, BASE).svgLogoCandidates, []);
  const strokes = lettering(300, 30, 11).replace("<svg ", "<svg $ATTR ");
  for (const [label, svg] of [
    ["script", strokes.replace("$ATTR ", "").replace("</svg>", "<script>alert(1)</script></svg>")],
    ["event handler", strokes.replace("$ATTR", 'onload="alert(1)"')],
    ["external image", strokes.replace("$ATTR ", "").replace("</svg>", '<image href="https://evil.example/x.png" width="10" height="10"/></svg>')],
    ["external url()", strokes.replace("$ATTR", 'style="fill:url(https://evil.example/p)"')],
  ]) {
    const cand = inline(svg);
    if (!cand) continue; // refused before it is even a candidate
    const r = await verify(cand);
    assert.deepEqual([r.ok, r.reason], [false, "invalid_file"], label);
  }
});

test("wordmark: a FETCHED .svg logo gets the same allowance and the same ink check", async () => {
  const deps = (svg) => ({
    fetchImage: async () => assert.fail("never a raster fetch"),
    fetchSvg: async (u) => ({ ok: true, url: new URL(u), body: Buffer.from(svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"')), contentType: "image/svg+xml", bytes: svg.length, redirects: 0 }),
  });
  const U = "https://www.marcbrand.com/logo.svg";
  assert.equal((await verify(U, "logo", deps(lettering(300, 30, 11)))).ok, true);
  assert.equal((await verify(U, "logo", deps('<svg viewBox="0 0 200 50"></svg>'))).reason, "blank");
});

test("wordmark: raster logo files — a real 180×180 PNG passes, a 12:1 raster wordmark passes, a 30:1 strip does not", async () => {
  const mark = (w, h) =>
    sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: { create: { width: Math.round(w * 0.9), height: Math.round(h * 0.6), channels: 4, background: { r: 18, g: 52, b: 86, alpha: 1 } } }, left: Math.round(w * 0.05), top: Math.round(h * 0.2) }, { input: { create: { width: Math.round(w * 0.2), height: Math.round(h * 0.2), channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }, left: Math.round(w * 0.4), top: Math.round(h * 0.4) }])
      .png()
      .toBuffer();
  const fetchOf = async (body) => ({ fetchImage: async (u) => ({ ok: true, url: new URL(u), body, contentType: "image/png", bytes: body.length, redirects: 0 }) });
  assert.equal((await verify("https://www.marcbrand.com/logo.png", "logo", await fetchOf(await mark(180, 180)))).ok, true);
  assert.equal((await verify("https://www.marcbrand.com/wide.png", "logo", await fetchOf(await mark(1200, 100)))).ok, true);
  const strip = await verify("https://www.marcbrand.com/strip.png", "logo", await fetchOf(await mark(3000, 100)));
  assert.deepEqual([strip.ok, strip.reason, strip.measure.code], [false, "unsuitable", "aspect_ratio"]);
});

// ── 2. fetch_failed → its real class ──────────────────────────────────────

test("fetch: what used to collapse into fetch_failed now carries the safe-fetch class and HTTP status", async () => {
  const failing = (f) => ({ fetchImage: async () => ({ ok: false, redirects: 0, ...f }) });
  const cases = [
    [{ code: "blocked_by_site", status: 403, host: "media.marcbrand.com" }, { code: "blocked_by_site", status: 403 }, "fetch_failed:blocked_by_site:403"],
    [{ code: "http_error", status: 404, host: "www.marcbrand.com" }, { code: "http_error", status: 404 }, "fetch_failed:http_error:404"],
    [{ code: "timeout" }, { code: "timeout" }, "fetch_failed:timeout"],
    [{ code: "redirect_rejected", status: 302 }, { code: "redirect_rejected", status: 302 }, "fetch_failed:redirect_rejected:302"],
    [{ code: "blocked_destination" }, { code: "blocked_destination" }, "fetch_failed:blocked_destination"],
    [{ code: "network_error" }, { code: "network_error" }, "fetch_failed:network_error"],
    [{ code: "unsupported_content", status: 200 }, { code: "unsupported_content", status: 200 }, "fetch_failed:unsupported_content:200"],
    [{ code: "too_large", status: 200, limit: "declared" }, { code: "too_large", status: 200 }, "fetch_failed:too_large:200"],
  ];
  for (const [fetched, detail, label] of cases) {
    const r = await verify("https://media.marcbrand.com/i/hero.jpg?w=1600&token=secret", "cover", failing(fetched));
    assert.equal(r.ok, false);
    assert.equal(r.reason, "fetch_failed", "the reason itself is unchanged");
    assert.deepEqual(r.fetch, { ...detail, ext: "jpg" });
    const reason = IMG.brandImageFailureReason(r);
    assert.equal(reason, `${label}:ext=jpg`);
    assert.doesNotMatch(reason, /https?:|marcbrand|token|secret|\?/, "never the URL, host or query");
  }
  const thrown = await verify("https://media.marcbrand.com/x.jpg", "cover", { fetchImage: async () => { throw new Error("boom"); } });
  assert.deepEqual([thrown.reason, thrown.fetch], ["fetch_failed", { code: "error" }]);
  // Invalid bytes are their own class (never fetch_failed).
  const bytes = await verify("https://media.marcbrand.com/x.jpg", "cover", { fetchImage: async (u) => ({ ok: true, url: new URL(u), body: Buffer.from("<html>"), contentType: "image/jpeg", bytes: 6, redirects: 0 }) });
  assert.deepEqual([bytes.reason, bytes.fetch], ["invalid_file", undefined]);
  assert.equal(IMG.brandImageFailureReason({ reason: "unsuitable" }), "unsuitable");
});

test("fetch: the Build diagnostic records the class; inline marks are labelled svg; no fetch rule was loosened", () => {
  const analysis = read("src/lib/brand-website-analysis.ts");
  assert.match(analysis, /return \{ ok: false, reason: brandImageFailureReason\(r\) \};/);
  assert.match(analysis, /kind: isSvgCandidateUrl\(url\) \|\| url\.startsWith\("data:image\/svg\+xml"\) \? "svg" : "raster"/);
  const sf = read("src/lib/safe-fetch.ts");
  assert.match(sf, /export const SAFE_FETCH_USER_AGENT = "FindmiBot\/1\.0 \(\+https:\/\/findmi\.app; reads one public page or image a Findmi user asked for\)";/, "honest UA unchanged");
  assert.match(sf, /const IMAGE_PROFILE: FetchProfile = \{\n\s+accept: "image\/png,image\/jpeg,image\/webp,image\/gif;q=0\.8",\n\s+mediaTypes: SAFE_FETCH_IMAGE_TYPES,\n\s+maxBytes: SAFE_FETCH_IMAGE_MAX_BYTES,\n\s+rejectDeclaredOverMax: true,\n\};/, "image profile unchanged");
  // Event Import's image path keeps its own reasons (type-only widening).
  assert.match(read("src/lib/event-import/media.ts"), /if \(!fetched\.ok\) return \{ ok: false, reason: "fetch_failed" \};/);
});

// ── 3. Production follow-up: unsupported_content and the SVG measurements ─

const F = await import("../src/lib/safe-fetch.ts");
function respond(status, headers = {}, body = Buffer.alloc(0)) {
  return { status, headers, body: (async function* () { yield Buffer.isBuffer(body) ? body : Buffer.from(body); })(), destroy: () => {} };
}
const IMG_URL = "https://media.marcbrand.com/i/hero.jpg";

test("unsupported_content: the three causes are told apart (media type / encoding / decode), with the media type", async () => {
  const avif = await F.safeFetchImage(IMG_URL, { transport: async () => respond(200, { "content-type": "image/avif" }, Buffer.from("....ftypavif")) });
  assert.deepEqual([avif.ok, avif.code, avif.status, avif.contentIssue, avif.contentType], [false, "unsupported_content", 200, "media_type", "image/avif"]);
  const html = await F.safeFetchImage(IMG_URL, { transport: async () => respond(200, { "content-type": "text/html; charset=utf-8" }, "<html>denied</html>") });
  assert.deepEqual([html.ok, html.code, html.contentIssue, html.contentType], [false, "unsupported_content", "media_type", "text/html"], "an HTML 200 is still refused");
  const zstd = await F.safeFetchImage(IMG_URL, { transport: async () => respond(200, { "content-type": "image/jpeg", "content-encoding": "zstd" }, Buffer.from([1, 2, 3])) });
  assert.deepEqual([zstd.code, zstd.contentIssue], ["unsupported_content", "encoding"]);
  const badGzip = await F.safeFetchImage(IMG_URL, { transport: async () => respond(200, { "content-type": "image/jpeg", "content-encoding": "gzip" }, Buffer.from("not gzip at all")) });
  assert.deepEqual([badGzip.code, badGzip.contentIssue], ["unsupported_content", "decode"]);
  // Event pages see the same code (semantics unchanged; the cause is extra).
  const ev = await F.safeFetchEventPage("https://luma.com/x", { transport: async () => respond(200, { "content-type": "application/pdf" }, "%PDF") });
  assert.deepEqual([ev.ok, ev.code], [false, "unsupported_content"]);
});

test("unsupported_content: the Brand diagnostic names the cause, media type and path extension — never the URL", async () => {
  const r = await verify(`${IMG_URL}?w=1600&sig=secret`, "cover", { fetchImage: async () => ({ ok: false, code: "unsupported_content", redirects: 0, status: 200, contentType: "image/avif", contentIssue: "media_type" }) });
  const reason = IMG.brandImageFailureReason(r);
  assert.equal(reason, "fetch_failed:unsupported_content:200:media_type:image/avif:ext=jpg");
  assert.doesNotMatch(reason, /marcbrand|sig|secret|https?:/);
  // A hostile / malformed media type is never echoed.
  const odd = await verify(IMG_URL, "cover", { fetchImage: async () => ({ ok: false, code: "unsupported_content", redirects: 0, status: 200, contentType: "text/html<script>", contentIssue: "media_type" }) });
  assert.equal(IMG.brandImageFailureReason(odd), "fetch_failed:unsupported_content:200:media_type:ext=jpg");
  assert.equal(IMG.candidateExtension("https://x.com/a/b"), "none");
  assert.equal(IMG.candidateExtension("https://x.com/a/B.WEBP?x=1"), "webp");
  // Validation itself is unchanged: the image profile's accepted types and
  // byte checks are exactly as before.
  assert.deepEqual([...F.SAFE_FETCH_IMAGE_TYPES].sort(), ["application/octet-stream", "binary/octet-stream", "image/gif", "image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/webp"]);
});

test("svg measurements: every SVG-derived rejection says which rule, at what size and ink", async () => {
  const wide = await verify(inline(lettering(280, 20, 11)));
  assert.equal(wide.ok, true, "14:1 widely tracked caps — a legitimate wordmark");
  const rule = await verify(inline(lettering(600, 20, 24)));
  assert.match(IMG.brandImageFailureReason(rule), /^unsuitable:aspect_ratio:800x27:r(29|30)\.\d$/, "a ~30:1 rule");
  const block = await verify(inline('<svg viewBox="0 0 200 50"><rect width="200" height="50"/></svg>'));
  assert.equal(IMG.brandImageFailureReason(block), "unsuitable:solid_fill:800x200:r4.0:ink100");
  const blank = await verify(inline('<svg viewBox="0 0 200 50"></svg>'));
  assert.equal(IMG.brandImageFailureReason(blank), "blank:blank:800x200:r4.0:ink0");
  const whiteBlock = await verify(inline('<svg viewBox="0 0 200 50"><rect width="200" height="50" fill="#fff"/></svg>'));
  assert.match(IMG.brandImageFailureReason(whiteBlock), /^unsuitable:solid_fill:800x200:r4\.0:ink100$/, "an opaque white block");
  assert.equal(IMG.brandImageSuitabilityFailure("logo", 100, 30), "too_small");
  assert.equal(IMG.brandImageSuitabilityFailure("logo", 800, 80), null, "10:1 raster wordmark is fine");
  assert.equal(IMG.brandImageSuitabilityFailure("logo", 3000, 100), "aspect_ratio");
  assert.equal(IMG.brandImageSuitabilityFailure("logo", 800, 80, { vectorWordmark: true }), null);
  assert.equal(IMG.brandImageSuitabilityFailure("cover", 500, 400), "too_small");
});

test("svg solid rule: a badge logo (lettering on a filled shape) passes; a featureless or same-colour block does not", async () => {
  const strokes = (w, h, n, fill) => Array.from({ length: n }, (_, i) => `<rect fill="${fill}" x="${Math.round((i * w) / n)}" y="0" width="${Math.round(w / n / 2)}" height="${h}"/>`).join("");
  const whiteOnBlack = await verify(inline(`<svg viewBox="0 0 300 60"><rect width="300" height="60" fill="#000"/>${strokes(300, 60, 11, "#fff")}</svg>`));
  assert.equal(whiteOnBlack.ok, true, IMG.brandImageFailureReason(whiteOnBlack));
  const navyOnGold = await verify(inline(`<svg viewBox="0 0 200 100"><rect width="200" height="100" fill="#d4af37"/>${strokes(200, 100, 8, "#001f5b")}</svg>`));
  assert.equal(navyOnGold.ok, true, IMG.brandImageFailureReason(navyOnGold));
  const sameColour = await verify(inline(`<svg viewBox="0 0 300 30"><rect width="300" height="30" fill="#000"/>${strokes(300, 30, 11, "#000")}</svg>`));
  assert.equal(IMG.brandImageFailureReason(sameColour), "unsuitable:solid_fill:800x80:r10.0:ink100", "invisible lettering is still a block");
});
