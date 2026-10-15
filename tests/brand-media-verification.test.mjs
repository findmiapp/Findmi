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

test("wordmark: the exact rule — raster logos keep 6:1; only vector wordmarks get up to 12:1; straps stay out", async () => {
  assert.equal(IMG.isSuitableBrandImage("logo", 800, 80), false, "a 10:1 RASTER logo file is still refused");
  assert.equal(IMG.isSuitableBrandImage("logo", 800, 80, { vectorWordmark: true }), true);
  assert.equal(IMG.isSuitableBrandImage("logo", 800, 50, { vectorWordmark: true }), false, "16:1 is a rule/strap, not a mark");
  assert.equal(IMG.isSuitableBrandImage("logo", 800, 133), false, "6.015:1 raster — unchanged");
  assert.equal(IMG.SVG_WORDMARK_MAX_RATIO, 12);
  const strap = await verify(inline(lettering(320, 20, 12)));
  assert.deepEqual([strap.ok, strap.reason], [false, "unsuitable"]);
  // Covers are untouched by the allowance.
  assert.equal(IMG.isSuitableBrandImage("cover", 1200, 100, { vectorWordmark: true }), false);
});

test("wordmark: blank, white-only and solid-block SVGs still fail", async () => {
  const blank = await verify(inline('<svg viewBox="0 0 200 50"></svg>'));
  assert.deepEqual([blank.ok, blank.reason], [false, "blank"], "nothing drawn");
  const white = await verify(inline(lettering(300, 30, 11, "#ffffff")));
  assert.deepEqual([white.ok, white.reason], [false, "blank"], "white on transparent is invisible on Findmi");
  const hairline = await verify(inline('<svg viewBox="0 0 400 100"><rect x="0" y="0" width="2" height="2"/></svg>'));
  assert.deepEqual([hairline.ok, hairline.reason], [false, "blank"], "near-blank");
  const solid = await verify(inline('<svg viewBox="0 0 200 50"><path d="M0 0h200v50H0z"/></svg>'));
  assert.deepEqual([solid.ok, solid.reason], [false, "unsuitable"], "a filled block is not lettering");
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

test("wordmark: raster logo files are unchanged (a real 180×180 PNG passes; a 12:1 raster is unsuitable)", async () => {
  const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: "#123456" } }).png().toBuffer();
  const ok = await verify("https://www.marcbrand.com/logo.png", "logo", { fetchImage: async (u) => ({ ok: true, url: new URL(u), body: await png(180, 180), contentType: "image/png", bytes: 1, redirects: 0 }) });
  assert.equal(ok.ok, true);
  const wide = await verify("https://www.marcbrand.com/wide.png", "logo", { fetchImage: async (u) => ({ ok: true, url: new URL(u), body: await png(1200, 100), contentType: "image/png", bytes: 1, redirects: 0 }) });
  assert.deepEqual([wide.ok, wide.reason], [false, "unsuitable"]);
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
    assert.deepEqual(r.fetch, detail);
    const reason = IMG.brandImageFailureReason(r);
    assert.equal(reason, label);
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
