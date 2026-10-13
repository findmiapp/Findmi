// VCL A3c — safe SVG logo → raster identity. Only EXTERNAL .svg logo URLs
// from strong logo evidence (JSON-LD logo, logo metadata, itemprop=logo,
// the header/home-link brand mark) are eligible. Each is safe-fetched
// (≤ 256 KB, image/svg+xml), passed through a strict safe-subset gate,
// rasterized server-side to PNG by librsvg (sharp) from an in-memory
// buffer, and the PNG must pass the normal logo verification. The SVG is
// never stored, served or rendered. Local synthetic fixtures only; the
// network-isolation tests use a loopback server that counts requests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
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
const B = await import("../src/lib/brand-candidate-builder.ts");
const F = await import("../src/lib/safe-fetch.ts");

const read = (p) => readFileSync(p, "utf8");
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const buf = (s) => Buffer.from(s, "utf8");

// ── Fixtures ──────────────────────────────────────────────────────────────
const WORDMARK = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Acme wordmark -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100" width="400" height="100">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#14b0bc"/><stop offset="1" stop-color="#0b6f77"/></linearGradient></defs>
  <rect x="10" y="20" width="380" height="60" rx="12" fill="url(#g)"/>
  <use href="#g"/>
</svg>`;
const SQUARE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#1db954"/></svg>`;

async function alphaStats(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0;
  let red = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) transparent++;
    if (data[i] > 200 && data[i + 1] < 50 && data[i + 2] < 50 && data[i + 3] > 0) red++;
  }
  return { transparent, red, pixels: info.width * info.height };
}

/** Stub fetchers keyed by URL. */
function fetchers({ svg = {}, raster = {} } = {}) {
  const calls = { svg: [], raster: [] };
  const ok = (url, body, type) => ({ ok: true, url: new URL(url), body, contentType: type, bytes: body.length, redirects: 0 });
  return {
    calls,
    deps: {
      fetchSvg: async (url) => (calls.svg.push(url), svg[url] ? ok(url, buf(svg[url].body ?? svg[url]), svg[url].type ?? "image/svg+xml") : { ok: false, code: "http_error" }),
      fetchImage: async (url) => (calls.raster.push(url), raster[url] ? ok(url, raster[url].body, raster[url].type) : { ok: false, code: "http_error" }),
    },
  };
}

// ── Safe-subset gate ─────────────────────────────────────────────────────
test("gate: a normal logo (paths, gradients, #fragment refs, xml prolog, comment) passes", () => {
  assert.deepEqual(IMG.inspectSvg(buf(WORDMARK)), { ok: true });
  assert.deepEqual(IMG.inspectSvg(buf(SQUARE)), { ok: true });
});

test("21-24. gate rejects scripts, handlers, external/remote refs, fonts, embeds, DOCTYPE/entities and malformed roots", () => {
  const cases = {
    script: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>fetch("https://x")</script></svg>`,
    js_href: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><a href="javascript:alert(1)"><rect width="5" height="5"/></a></svg>`,
    event_handler: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><rect width="5" height="5"/></svg>`,
    external_image: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="https://evil.example/x.png" width="10" height="10"/></svg>`,
    xlink_use: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><use xlink:href="https://evil.example/s.svg#a"/></svg>`,
    unquoted_href: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><use href=https://evil.example/s.svg#a /></svg>`,
    css_import: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>@import url(https://evil.example/a.css);</style></svg>`,
    font_face: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>@font-face{font-family:x;src:url(https://evil.example/f.woff)}</style><text>A</text></svg>`,
    css_url: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5" style="fill:url(https://evil.example/p.svg#g)"/></svg>`,
    file_ref: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><use href="file:///etc/passwd#x"/></svg>`,
    data_ref: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><use href="data:image/svg+xml;base64,PHN2Zy8+#a"/></svg>`,
    foreign_object: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><foreignObject><div>x</div></foreignObject></svg>`,
    doctype: `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">&a;</svg>`,
    xml_stylesheet: `<?xml-stylesheet href="https://evil.example/a.css"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>`,
    html_not_svg: `<html><body><svg viewBox="0 0 10 10"></svg></body></html>`,
    gzip_svgz: "\x1f\x8b\x08\x00binary",
  };
  for (const [label, svg] of Object.entries(cases)) {
    const r = IMG.inspectSvg(buf(svg));
    assert.equal(r.ok, false, label);
  }
});

test("19/24. gate bounds size, complexity and pathological width/height/viewBox", () => {
  const big = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><!--${"x".repeat(300 * 1024)}--></svg>`;
  assert.deepEqual(IMG.inspectSvg(buf(big)), { ok: false, reason: "too_large" });
  const many = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${"<g/>".repeat(6000)}</svg>`;
  assert.deepEqual(IMG.inspectSvg(buf(many)), { ok: false, reason: "too_complex" });
  const uses = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g id="a"/>${'<use href="#a"/>'.repeat(250)}</svg>`;
  assert.deepEqual(IMG.inspectSvg(buf(uses)), { ok: false, reason: "too_complex" });
  for (const root of [
    '<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="10">',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1e9 1e9">',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 -5 10">',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 NaN 10">',
    '<svg xmlns="http://www.w3.org/2000/svg">',
    '<svg xmlns="http://www.w3.org/2000/svg" width="calc(1e9px)" height="10">',
  ]) {
    assert.deepEqual(IMG.inspectSvg(buf(`${root}<rect width="1" height="1"/></svg>`)), { ok: false, reason: "bad_dimensions" }, root);
  }
});

// ── The rasterizer boundary (proved even WITHOUT the gate) ───────────────
test("22/23. rasterizing a hostile SVG directly makes no network request and reads no local file", async () => {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    res.writeHead(200, { "content-type": "image/png" });
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const dir = mkdtempSync(join(tmpdir(), "a3c-"));
  const redPng = join(dir, "red.png");
  writeFileSync(redPng, await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer());
  const base = `http://127.0.0.1:${port}`;
  const hostile = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" width="100" height="100" onload="fetch('${base}/onload')">
    <script>fetch("${base}/script")</script>
    <style>@import url(${base}/import.css); @font-face { font-family: Evil; src: url(${base}/font.woff); } text { font-family: Evil; }</style>
    <image href="${base}/image.png" x="0" y="0" width="50" height="50"/>
    <image xlink:href="file://${redPng}" x="50" y="50" width="50" height="50"/>
    <use href="${base}/sprite.svg#a"/>
    <rect width="10" height="10" fill="url(${base}/paint.svg#g)"/>
    <text x="10" y="90">A</text>
  </svg>`;
  assert.equal(IMG.inspectSvg(buf(hostile)).ok, false, "the gate rejects it first");
  const png = await IMG.rasterizeSvgLogo(buf(hostile));
  await new Promise((r) => setTimeout(r, 300));
  server.close();
  assert.equal(hits, 0, "librsvg loaded nothing over the network");
  assert.ok(png, "the hostile document still rendered — so the checks below are meaningful");
  assert.equal((await alphaStats(png)).red, 0, "the local file: image was not loaded");
  // Positive control: the same red PNG inlined as a data: URI IS drawn by
  // librsvg — which is why the gate rejects every non-#fragment href.
  const redB64 = readFileSync(redPng).toString("base64");
  const dataSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" width="100" height="100"><image xlink:href="data:image/png;base64,${redB64}" width="100" height="100"/></svg>`;
  assert.ok((await alphaStats(await IMG.rasterizeSvgLogo(buf(dataSvg)))).red > 0, "control: an inline data: image renders");
  assert.equal(IMG.inspectSvg(buf(dataSvg)).ok, false, "…and the gate rejects it");
});

test("4/5/6/7/E. a wordmark SVG rasterizes to a transparent PNG with its full aspect ratio (never cropped)", async () => {
  const png = await IMG.rasterizeSvgLogo(buf(WORDMARK));
  const meta = await sharp(png).metadata();
  assert.equal(meta.format, "png");
  assert.deepEqual([meta.width, meta.height], [800, 200], "4:1 kept, long side 800");
  assert.equal(meta.hasAlpha, true);
  assert.ok((await alphaStats(png)).transparent > 0, "transparent background kept");
  const square = await sharp(await IMG.rasterizeSvgLogo(buf(SQUARE))).metadata();
  assert.deepEqual([square.width, square.height], [800, 800], "small vector rendered at size, not a blurry upscale");
  const huge = await IMG.rasterizeSvgLogo(buf('<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="2500"><rect width="10000" height="2500" fill="#000"/></svg>'));
  const h = await sharp(huge).metadata();
  assert.deepEqual([h.width, h.height], [800, 200], "bounded output");
});

test("20/25. malformed SVG / rasterizer failure → null, never a throw", async () => {
  assert.equal(await IMG.rasterizeSvgLogo(buf('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g></svg')), null);
  assert.equal(await IMG.rasterizeSvgLogo(buf("not an svg")), null);
  assert.equal(await IMG.rasterizeSvgLogo(Buffer.alloc(0)), null);
});

// ── Full verification path ───────────────────────────────────────────────
const SVG_URL = "https://cdn.acme-brand.com/brand/logo.svg";
test("9/8. an SVG logo becomes a VERIFIED PNG (normal checks); the SVG itself goes nowhere", async () => {
  const f = fetchers({ svg: { [SVG_URL]: WORDMARK } });
  const r = await IMG.fetchVerifiedBrandImage(SVG_URL, "logo", f.deps);
  assert.equal(r.ok, true);
  assert.equal(r.image.validated.contentType, "image/png");
  assert.deepEqual([r.image.width, r.image.height], [800, 200]);
  assert.deepEqual([...r.image.body.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "PNG bytes");
  assert.equal(r.image.body.includes("<svg"), false);
  assert.deepEqual(f.calls.raster, [], "never via the raster fetch");
  // Review preview is a re-encoded WebP data URI of the PNG — never the SVG.
  assert.match(await IMG.brandImagePreview(r.image), /^data:image\/webp;base64,/);
  // Storage stores the verified PNG through the normal pipeline.
  assert.match(code("src/lib/brand-images.ts"), /const file = new File\(\[new Uint8Array\(image\.body\)\], `brand-\$\{image\.role\}\.\$\{image\.validated\.extension\}`/);
});

test("SVG verification rejects: wrong content type, unsafe content, raster failure, unsuitable shape; covers never take the SVG path", async () => {
  const check = async (entry) => IMG.fetchVerifiedBrandImage(SVG_URL, "logo", fetchers({ svg: { [SVG_URL]: entry } }).deps);
  assert.deepEqual(await check({ body: WORDMARK, type: "text/html" }), { ok: false, reason: "type_mismatch" });
  assert.deepEqual(await check(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script/></svg>`), { ok: false, reason: "invalid_file" });
  assert.deepEqual(await check('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g></svg'), { ok: false, reason: "unreadable" });
  assert.deepEqual(await check('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 50"><rect width="1000" height="50"/></svg>'), { ok: false, reason: "unsuitable" }, "20:1 sliver fails the normal logo rule");
  const f = fetchers({ svg: { [SVG_URL]: WORDMARK } });
  assert.equal((await IMG.fetchVerifiedBrandImage(SVG_URL, "cover", f.deps)).ok, false);
  assert.deepEqual(f.calls.svg, [], "a cover never takes the SVG path");
});

test("16/17/18/19. SVG fetch keeps every SSRF rule, the type gate and a 256 KB declared cap", async () => {
  for (const u of ["https://127.0.0.1/logo.svg", "http://acme-brand.com/logo.svg", "https://acme-brand.com:8443/logo.svg", "https://cdn.local/logo.svg"]) {
    assert.equal((await F.safeFetchSvg(u)).ok, false, u);
  }
  const route = (status, headers, body = Buffer.from(SQUARE)) => async () => ({ status, headers, body: (async function* () { yield body; })(), destroy() {} });
  assert.equal((await F.safeFetchSvg(SVG_URL, { transport: route(302, { location: "http://cdn.acme-brand.com/logo.svg" }) })).code, "redirect_rejected");
  assert.equal((await F.safeFetchSvg(SVG_URL, { transport: route(200, { "content-type": "image/png" }) })).code, "unsupported_content");
  assert.equal((await F.safeFetchSvg(SVG_URL, { transport: route(200, { "content-type": "image/svg+xml", "content-length": String(300 * 1024) }) })).code, "too_large");
  const ok = await F.safeFetchSvg(SVG_URL, { transport: route(200, { "content-type": "image/svg+xml" }) });
  assert.equal(ok.ok, true);
  assert.equal(F.SAFE_FETCH_SVG_MAX_BYTES, 256 * 1024);
});

// ── Candidate eligibility (extractor) ────────────────────────────────────
const SITE = new URL("https://www.acme-brand.com/");
const page = (head, body = "") => `<!doctype html><html><head><title>Acme Brand</title>${head}</head><body>${body}</body></html>`;
const ld = (o) => `<script type="application/ld+json">${JSON.stringify({ "@type": "Organization", name: "Acme Brand", url: SITE.href, ...o })}</script>`;
const extract = (html) => X.extractBrandProfile(html, SITE);

test("3. strong SVG logo signals are eligible (JSON-LD, logo meta, itemprop, header/home-link brand mark)", () => {
  assert.deepEqual(extract(page(ld({ logo: SVG_URL }))).svgLogoCandidates, [SVG_URL]);
  assert.deepEqual(extract(page('<meta property="og:logo" content="/brand/logo.svg">')).svgLogoCandidates, ["https://www.acme-brand.com/brand/logo.svg"]);
  assert.deepEqual(extract(page("", '<div><img itemprop="logo" src="/i/acme.svg"></div>')).svgLogoCandidates, ["https://www.acme-brand.com/i/acme.svg"]);
  assert.deepEqual(extract(page("", '<header><a href="/"><img src="/i/acme-logo.svg" alt="Acme Brand"></a></header>')).svgLogoCandidates, ["https://www.acme-brand.com/i/acme-logo.svg"]);
  assert.ok(extract(page(ld({ logo: [SVG_URL, "https://cdn.acme-brand.com/a.svg", "https://cdn.acme-brand.com/b.svg"] }))).svgLogoCandidates.length <= X.SVG_LOGO_CANDIDATE_MAX);
  // .svg still never enters the RASTER pool.
  assert.deepEqual(extract(page(ld({ logo: SVG_URL }))).logoCandidates, []);
});

test("13/14/15/16. random, decorative, social, favicon/mask-icon, inline, http and data: SVGs are never identity", () => {
  const p = extract(
    page(
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="mask-icon" href="/mask.svg"><meta property="og:image" content="/share.svg">' + ld({ logo: "http://cdn.acme-brand.com/logo.svg", image: "/brand/hero.svg" }),
      '<header><nav><a href="https://instagram.com/acme"><img src="/icons/instagram.svg" alt="Instagram"></a><img src="/icons/menu.svg" alt="Menu"><svg aria-label="Acme Brand"><path d="M0 0h10"/></svg></nav></header>' +
        '<div class="hero"><img src="/art/hero-illustration.svg" alt="Summer"></div><img src="/img/spinner.svg" alt="Loading"><section class="press"><img src="/press/vogue-logo.svg" alt="Vogue"></section>' +
        '<img src="data:image/svg+xml;base64,PHN2Zy8+" itemprop="logo">'
    )
  );
  assert.deepEqual(p.svgLogoCandidates, []);
  assert.deepEqual(p.logoCandidates, []);
});

// ── Ordering in the builder ──────────────────────────────────────────────
const RASTER_LOGO = "https://cdn.acme-brand.com/brand/logo.png";
const TOUCH = "https://www.acme-brand.com/touch.png";
const square = (s) => sharp({ create: { width: s, height: s, channels: 3, background: "#123456" } }).png().toBuffer();
const wordPng = () => sharp({ create: { width: 600, height: 150, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: { create: { width: 500, height: 100, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } } }, left: 50, top: 25 }]).png().toBuffer();
async function photo() {
  let x = 7;
  const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const w = 1200, h = 630;
  const data = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let c = 0; c < w; c++) {
    const i = (y * w + c) * 3;
    data[i] = Math.min(255, (c / w) * 200 + rand() * 55);
    data[i + 1] = Math.min(255, (y / h) * 180 + rand() * 75);
    data[i + 2] = Math.min(255, 90 + rand() * 120);
  }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
}
const WEBSITE = { websiteUrl: "https://www.acme-brand.com", host: "acme-brand.com", fetchUrl: SITE };
async function build(html, f, extra = {}) {
  return B.buildCandidateFromExtraction(
    WEBSITE,
    { profile: extract(html), finalUrl: SITE.href },
    {
      findMatches: async () => [],
      listCategories: async () => [],
      enrich: async () => ({ result: null, called: false, usage: null }),
      verifyImage: async (url, role) => (await IMG.fetchVerifiedBrandImage(url, role, f.deps)).ok,
      ...extra,
    },
    { verifyImages: true }
  );
}

test("1/2/A. a strong raster logo wins and the SVG is never fetched", async () => {
  const f = fetchers({ svg: { [SVG_URL]: WORDMARK }, raster: { [RASTER_LOGO]: { body: await wordPng(), type: "image/png" } } });
  const built = await build(page(ld({ logo: RASTER_LOGO }), '<header><a href="/"><img src="/i/acme-logo.svg" alt="Acme Brand"></a></header>'), f);
  assert.equal(built.proposal.logoUrl, RASTER_LOGO);
  assert.deepEqual(f.calls.svg, []);
});

test("B/29. strong SVG (no usable raster logo) is rasterized and outranks the touch icon; ordering is deterministic", async () => {
  const f = fetchers({ svg: { [SVG_URL]: WORDMARK }, raster: { [TOUCH]: { body: await square(180), type: "image/png" } } });
  const html = page(ld({ logo: SVG_URL }) + '<link rel="apple-touch-icon" sizes="180x180" href="/touch.png">');
  assert.equal((await build(html, f)).proposal.logoUrl, SVG_URL);
  assert.deepEqual(f.calls.svg, [SVG_URL]);
  // A strong RASTER that fails verification still yields to the SVG before icons.
  const g = fetchers({ svg: { [SVG_URL]: WORDMARK }, raster: { [TOUCH]: { body: await square(180), type: "image/png" } } });
  const html2 = page(ld({ logo: SVG_URL }) + '<meta property="og:logo" content="https://cdn.acme-brand.com/broken.png"><link rel="apple-touch-icon" sizes="180x180" href="/touch.png">');
  assert.equal((await build(html2, g)).proposal.logoUrl, SVG_URL);
});

test("C/27. unsafe SVG → the touch icon is used; nothing usable → neutral fallback (no logo)", async () => {
  const unsafe = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="https://evil.example/x.png"/></svg>`;
  const f = fetchers({ svg: { [SVG_URL]: unsafe }, raster: { [TOUCH]: { body: await square(180), type: "image/png" } } });
  assert.equal((await build(page(ld({ logo: SVG_URL }) + '<link rel="apple-touch-icon" sizes="180x180" href="/touch.png">'), f)).proposal.logoUrl, TOUCH);
  const none = await build(page(ld({ logo: SVG_URL })), fetchers({ svg: { [SVG_URL]: unsafe } }));
  assert.equal(none.proposal.logoUrl, null);
  assert.match(code("src/app/(public)/account/CreatedBusinessCard.tsx"), /<NavIcon name="storefront"/, "existing neutral fallback");
});

test("11/28. SVG failure → the A3a manifest fallback still runs", async () => {
  const icon = "https://www.acme-brand.com/icons/icon-512.png";
  const f = fetchers({ svg: { [SVG_URL]: "<svg" }, raster: { [icon]: { body: await square(512), type: "image/png" } } });
  const built = await build(page(ld({ logo: SVG_URL }) + '<link rel="manifest" href="/site.webmanifest">'), f, {
    fetchManifestIcons: async (u) => X.manifestIconCandidates(JSON.stringify({ icons: [{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }] }), new URL(u)),
  });
  assert.equal(built.proposal.logoUrl, icon);
});

test("10/30/D. cover-only site: cover populated, identity empty; cover extraction unchanged; covers never enter the logo chain", async () => {
  const cover = "https://cdn.acme-brand.com/share/hero.jpg";
  const f = fetchers({ raster: { [cover]: { body: await photo(), type: "image/jpeg" } } });
  const built = await build(page(`<meta property="og:image" content="${cover}">`), f);
  assert.equal(built.proposal.coverUrl, cover);
  assert.equal(built.proposal.logoUrl, null);
  assert.deepEqual(extract(page('<meta property="og:image" content="/share/hero.svg">')).coverCandidates, [], "SVG covers still excluded");
});

test("F/25/26. rasterizer failure or a hung/throwing verifier never blocks the Build", async () => {
  const built = await build(page(ld({ logo: SVG_URL })), fetchers({ svg: { [SVG_URL]: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g></svg' } }));
  assert.equal(built.status, "candidate");
  assert.equal(built.proposal.logoUrl, null);
  const thrown = await B.buildCandidateFromExtraction(
    WEBSITE,
    { profile: extract(page(ld({ logo: SVG_URL }))), finalUrl: SITE.href },
    { findMatches: async () => [], listCategories: async () => [], enrich: async () => ({ result: null, called: false, usage: null }), verifyImage: async () => { throw new Error("timeout"); } },
    { verifyImages: true }
  );
  assert.equal(thrown.status, "candidate");
  assert.equal(thrown.proposal.logoUrl, null);
  assert.equal(IMG.SVG_RASTER_TIMEOUT_MS, 5000);
});

// ── Rendering / scope guards ─────────────────────────────────────────────
test("24/25. no raw SVG is persisted or rendered; compact identity stays logo-only", () => {
  const review = read("src/app/(public)/account/business/new/page.tsx");
  assert.match(review, /draft!\.logo \? previewBrandCandidate\(draft!\.logo, "logo"\)/, "Review shows only the verified preview data URI");
  assert.doesNotMatch(review, /dangerouslySetInnerHTML/);
  const create = read("src/app/(public)/account/business/actions.ts");
  assert.match(create, /const verified = await fetchVerifiedBrandImage\(url, role\);\s*return verified\.ok \? storeBrandImage\(admin, verified\.image\) : null;/, "creation stores the verified raster only");
  assert.doesNotMatch(read("src/lib/imageUploadValidation.ts"), /image\/svg\+xml["'],?\s*(\]|$)/, "user-upload SVG policy untouched");
  const home = code("src/app/(public)/account/page.tsx");
  assert.doesNotMatch(home, /b\.logoUrl \?\? b\.coverImageUrl|createdBusiness\.logoUrl \?\? createdBusiness\.coverImageUrl/);
});

test("35. A3b paid search remains OFF by default", async () => {
  const I = await import("../src/lib/brand-instagram-discovery.ts");
  assert.equal(I.instagramSearchEnabled({ ANTHROPIC_API_KEY: "k" }), false);
  assert.match(read(".env.example"), /^BRAND_INSTAGRAM_SEARCH_ENABLED=$/m);
});
