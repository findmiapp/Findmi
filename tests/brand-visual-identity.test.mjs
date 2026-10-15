// Brand Visual Identity pass — logo + cover only. Bounded, ranked,
// deterministic candidate pools from first-party page evidence (shared
// extractor), verification of the top few per role (shared builder), and
// a reliable verified preview for review. No network (stub transports),
// no database, no Anthropic. Synthetic sites only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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

const X = await import("../src/lib/brand-website-extract.ts");
const IMG = await import("../src/lib/brand-images.ts");
const B = await import("../src/lib/brand-candidate-builder.ts");
const F = await import("../src/lib/safe-fetch.ts");
const D = await import("../src/lib/admin/brand-import-display.ts");
const read = (p) => readFileSync(p, "utf8");
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SITE = new URL("https://www.acmebeauty.com/");
const page = (head, body = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const extract = (html, url = SITE) => X.extractBrandProfile(html, url);
const ORG = (extra = {}) => ld({ "@type": "Organization", name: "Acme Beauty", url: "https://www.acmebeauty.com/", ...extra });
const HEADER_LOGO = '<header class="site-header"><a href="/"><img src="/cdn/files/acme-logo.png?v=3&width=400" alt="Acme Beauty" width="200" height="60"></a></header>';

// ── Image fixtures (generated locally) ───────────────────────────────────
function rng(seed = 7) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}
async function photo(w = 1200, h = 630) {
  const rand = rng();
  const data = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      data[i] = Math.min(255, (x / w) * 200 + rand() * 55);
      data[i + 1] = Math.min(255, (y / h) * 180 + rand() * 75);
      data[i + 2] = Math.min(255, 90 + rand() * 120);
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
}
/** A landscape share image that is really a wordmark on a flat field. */
const wordmark = () =>
  sharp({ create: { width: 1200, height: 630, channels: 3, background: "#ffffff" } })
    .composite([{ input: { create: { width: 600, height: 140, channels: 3, background: "#111111" } }, left: 300, top: 245 }])
    .png()
    .toBuffer();
const logoPng = () =>
  sharp({ create: { width: 400, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: 300, height: 60, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } }, left: 50, top: 30 }])
    .png()
    .toBuffer();
const tiny = () => sharp({ create: { width: 32, height: 32, channels: 3, background: "#14b0bc" } }).png().toBuffer();

/** Stub image transport: URL path → { body, type } (anything else fails). */
function transport(map) {
  const calls = [];
  return {
    calls,
    fetchImage: async (url) => {
      calls.push(url);
      const hit = Object.entries(map).find(([path]) => new URL(url).pathname === path);
      if (!hit) return { ok: false, code: "http_error" };
      const [, { body, type }] = hit;
      return { ok: true, url: new URL(url), body, contentType: type, bytes: body.length, redirects: 0 };
    },
  };
}
const verifierOf = (t) => async (url, role) => (await IMG.fetchVerifiedBrandImage(url, role, t)).ok;

// ── LOGO ──────────────────────────────────────────────────────────────────

test("logo: structured JSON-LD logo beats metadata, page logo, touch icon and site icon", () => {
  const html = page(
    '<link rel="icon" sizes="192x192" href="/icon-192.png"><link rel="apple-touch-icon" sizes="180x180" href="/touch.png">' +
      '<meta property="og:logo" content="/og-logo.png">' +
      ORG({ logo: { "@type": "ImageObject", url: "https://cdn.acmebeauty.com/brand/logo.png" } }),
    HEADER_LOGO
  );
  const p = extract(html);
  assert.deepEqual(p.logoCandidates, [
    "https://cdn.acmebeauty.com/brand/logo.png",
    "https://www.acmebeauty.com/og-logo.png",
    "https://www.acmebeauty.com/cdn/files/acme-logo.png?v=3&width=400",
    "https://www.acmebeauty.com/touch.png",
  ]);
  assert.equal(p.logoCandidateUrl, p.logoCandidates[0]);
  assert.ok(p.logoCandidates.length <= X.LOGO_CANDIDATE_MAX);
});

test("logo: an explicit header/home-link page logo beats the icon fallbacks", () => {
  const p = extract(page('<link rel="apple-touch-icon" sizes="180x180" href="/touch.png"><link rel="icon" sizes="512x512" href="/f512.png">', HEADER_LOGO));
  assert.equal(p.logoCandidateUrl, "https://www.acmebeauty.com/cdn/files/acme-logo.png?v=3&width=400");
  assert.deepEqual(p.logoCandidates.slice(1), ["https://www.acmebeauty.com/touch.png", "https://www.acmebeauty.com/f512.png"]);
  // Home-link placement without a header, alt naming the brand, srcset and lazy data-src.
  const homeLink = extract(page("", '<main><a href="https://www.acmebeauty.com/"><img data-src="/m.png" src="data:image/gif;base64,R0lGOD" alt="Acme Beauty"></a></main>'));
  assert.equal(homeLink.logoCandidateUrl, "https://www.acmebeauty.com/m.png");
  const srcset = extract(page("", '<header><img class="header__logo" srcset="/l-200.png 200w, /l-800.png 800w, /l-3000.png 3000w" alt=""></header>'));
  assert.equal(srcset.logoCandidateUrl, "https://www.acmebeauty.com/l-800.png", "largest srcset width within the logo bound");
});

test("logo: a tiny favicon is never preferred over (or offered beside) a credible logo", () => {
  const p = extract(page('<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="shortcut icon" href="/favicon.ico">', HEADER_LOGO));
  assert.deepEqual(p.logoCandidates, ["https://www.acmebeauty.com/cdn/files/acme-logo.png?v=3&width=400"]);
  assert.deepEqual(extract(page('<link rel="icon" sizes="32x32" href="/favicon-32.png">')).logoCandidates, []);
});

test("logo: duplicate candidates collapse (query/size params ignored), highest evidence kept", () => {
  const html = page(
    '<meta property="og:logo" content="https://cdn.acmebeauty.com/brand/logo.png?width=600">' + ORG({ logo: ["https://cdn.acmebeauty.com/brand/logo.png?v=1", "https://cdn.acmebeauty.com/brand/logo.png"] }),
    '<header><a href="/"><img src="https://cdn.acmebeauty.com/brand/logo.png?width=300" alt="Acme Beauty"></a></header>'
  );
  assert.deepEqual(extract(html).logoCandidates, ["https://cdn.acmebeauty.com/brand/logo.png?v=1"]);
});

test("logo: press strips, partner/payment marks, pixels and off-header logo images are not candidates", () => {
  const body =
    '<main><section class="as-seen-in"><img src="/press/vogue-logo.png" alt="Vogue logo"><img src="/press/allure-logo.png" alt="Allure"></section></main>' +
    '<header><img src="/icons/payment-visa.png" alt="Visa logo"><img src="/t.gif" width="1" height="1" alt="logo"></header>' +
    '<footer><img src="/badges/award-logo.png" alt="Best of Beauty award"></footer>';
  assert.deepEqual(extract(page("", body)).logoCandidates, []);
});

test("logo: SVG/ICO never; an SVG structured logo falls through to the next credible source", () => {
  const p = extract(page(ORG({ logo: "https://cdn.acmebeauty.com/logo.svg" }), '<header><a href="/"><img src="/logo.svg" alt="Acme Beauty"><img src="/logo.png" alt="Acme Beauty logo"></a></header>'));
  assert.deepEqual(p.logoCandidates, ["https://www.acmebeauty.com/logo.png"]);
});

test("logo: invalid/unverified candidates are rejected — the next verified one wins; none verified → none", async () => {
  const t = transport({ "/brand/logo.png": { body: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), type: "image/png" }, "/cdn/files/acme-logo.png": { body: await logoPng(), type: "image/png" } });
  const pool = ["https://cdn.acmebeauty.com/brand/logo.png", "https://www.acmebeauty.com/cdn/files/acme-logo.png?v=3", "https://www.acmebeauty.com/touch.png"];
  assert.equal(await B.selectVerifiedImage(pool, "logo", verifierOf(t)), pool[1]);
  const small = transport({ "/touch.png": { body: await tiny(), type: "image/png" } });
  assert.equal(await B.selectVerifiedImage(["https://www.acmebeauty.com/touch.png"], "logo", verifierOf(small)), null, "a 32px icon is not a logo");
  assert.equal(await B.selectVerifiedImage([], "logo", verifierOf(t)), null);
});

test("logo: no credible candidate → no logo", () => {
  const p = extract(page("<title>Acme Beauty</title>", "<main><h1>Acme Beauty</h1><img src='/products/lipstick.jpg' alt='Lipstick'></main>"));
  assert.equal(p.logoCandidateUrl, null);
  assert.deepEqual(p.logoCandidates, []);
});

// ── COVER ─────────────────────────────────────────────────────────────────

test("cover: a strong landscape OG image is selected and verified", async () => {
  const p = extract(page('<meta property="og:image" content="https://cdn.acmebeauty.com/campaign/hero.jpg">' + ORG()));
  assert.equal(p.coverCandidateUrl, "https://cdn.acmebeauty.com/campaign/hero.jpg");
  const t = transport({ "/campaign/hero.jpg": { body: await photo(), type: "image/jpeg" } });
  assert.equal(await B.selectVerifiedImage(p.coverCandidates, "cover", verifierOf(t)), "https://cdn.acmebeauty.com/campaign/hero.jpg");
});

test("cover: ranked og → twitter → JSON-LD image → hero img; capped; duplicates collapse", () => {
  const html = page(
    '<meta property="og:image" content="/share.jpg?v=2"><meta property="og:image:secure_url" content="https://www.acmebeauty.com/share.jpg">' +
      '<meta name="twitter:image" content="/tw.jpg">' + ORG({ image: ["/ld-1.jpg", { url: "/ld-2.jpg" }] }),
    '<div class="hero-banner"><img src="/hero-1.jpg" width="1600" height="700" alt="Summer edit"></div><section class="slideshow"><img src="/hero-2.jpg" alt=""></section>'
  );
  const p = extract(html);
  assert.deepEqual(p.coverCandidates, ["https://www.acmebeauty.com/share.jpg", "https://www.acmebeauty.com/tw.jpg", "https://www.acmebeauty.com/ld-1.jpg", "https://www.acmebeauty.com/ld-2.jpg"]);
  assert.equal(p.coverCandidates.length, X.COVER_CANDIDATE_MAX);
  const heroOnly = extract(page("", '<div class="hero-banner"><img src="/hero-1.jpg" width="1600" height="700" alt="Summer edit"></div>'));
  assert.deepEqual(heroOnly.coverCandidates, ["https://www.acmebeauty.com/hero-1.jpg"]);
});

test("cover: the selected logo (or any logo candidate) can never also be the cover", async () => {
  const html = page('<meta property="og:image" content="https://cdn.acmebeauty.com/brand/logo-share.png?width=1200">' + ORG({ logo: "https://cdn.acmebeauty.com/brand/logo-share.png" }));
  const p = extract(html);
  assert.deepEqual(p.coverCandidates, []);
  assert.equal(p.coverCandidateUrl, null);
  // Builder post-check, even for a hand-built pool.
  assert.equal(await B.selectVerifiedImage(["https://cdn.acmebeauty.com/x.jpg?w=1"], "cover", async () => true, "https://cdn.acmebeauty.com/x.jpg"), null);
});

test("cover: an obvious wordmark/logo-like share image is rejected — the hero photo is used instead (end to end)", async () => {
  const html = page(
    '<meta property="og:image" content="https://www.acmebeauty.com/cdn/shop/files/share.png">' + ORG(),
    '<div class="hero"><img src="/cdn/shop/files/campaign.jpg" width="1920" height="900" alt="Campaign"></div>'
  );
  const t = transport({
    "/cdn/shop/files/share.png": { body: await wordmark(), type: "image/png" },
    "/cdn/shop/files/campaign.jpg": { body: await photo(), type: "image/jpeg" },
  });
  const built = await B.buildCandidateFromExtraction(
    { websiteUrl: "https://www.acmebeauty.com", host: "acmebeauty.com", fetchUrl: SITE },
    { profile: extract(html), finalUrl: SITE.href },
    {
      findMatches: async () => [],
      listCategories: async () => [],
      enrich: async () => ({ result: null, called: false, usage: null }),
      verifyImage: verifierOf(t),
    },
    { verifyImages: true }
  );
  assert.equal(built.status, "candidate");
  assert.equal(built.proposal.coverUrl, "https://www.acmebeauty.com/cdn/shop/files/campaign.jpg");
  assert.equal(built.proposal.logoUrl, null, "a rejected cover is never turned into a logo");
  // File names saying logo/wordmark never enter the cover pool at all.
  assert.deepEqual(extract(page('<meta property="og:image" content="/files/acme-wordmark_1200x630.png">')).coverCandidates, []);
});

test("cover: tiny/icon imagery is rejected", async () => {
  assert.deepEqual(extract(page("", '<div class="hero"><img src="/hero-small.jpg" width="300" height="200"></div>')).coverCandidates, [], "declared too small");
  assert.deepEqual(extract(page("", '<div class="banner"><img src="/icon-star.png" alt="5 stars"></div>')).coverCandidates, []);
  const t = transport({ "/sq.png": { body: await tiny(), type: "image/png" } });
  assert.equal(await B.selectVerifiedImage(["https://www.acmebeauty.com/sq.png"], "cover", verifierOf(t)), null);
});

test("cover: no credible candidate → no cover; hero images in the header are not covers", () => {
  const p = extract(page("<title>Acme</title>", '<header class="hero"><img src="/promo.jpg" width="1600"></header>'));
  assert.deepEqual([p.coverCandidateUrl, p.coverCandidates], [null, []]);
});

test("verification is bounded: at most BRAND_IMAGE_VERIFY_MAX fetches per role, highest-ranked pass wins", async () => {
  const seen = [];
  const pool = ["https://a.com/1.png", "https://a.com/2.png", "https://a.com/3.png", "https://a.com/4.png"];
  const picked = await B.selectVerifiedImage(pool, "cover", async (url) => (seen.push(url), url.endsWith("/3.png") || url.endsWith("/2.png")));
  assert.equal(picked, "https://a.com/2.png");
  assert.deepEqual(seen.sort(), pool.slice(0, B.BRAND_IMAGE_VERIFY_MAX));
  assert.equal(B.BRAND_IMAGE_VERIFY_MAX, 3);
  assert.deepEqual([X.LOGO_CANDIDATE_MAX, X.COVER_CANDIDATE_MAX], [4, 4]);
  // A throwing verifier is a rejection, never a crash.
  assert.equal(await B.selectVerifiedImage(pool, "logo", async () => { throw new Error("x"); }), null);
});

test("evidence scan is bounded: hundreds of <img>s never produce more than the capped pools", () => {
  const imgs = Array.from({ length: 1000 }, (_, i) => `<header><a href="/"><img src="/logo-${i}.png" alt="Acme Beauty logo"></a></header><div class="hero"><img src="/hero-${i}.jpg"></div>`).join("");
  const p = extract(page("", imgs));
  assert.equal(p.logoCandidates.length, X.LOGO_CANDIDATE_MAX);
  assert.ok(p.coverCandidates.length <= 2, "at most two hero images");
});

// ── SECURITY ──────────────────────────────────────────────────────────────

test("security: private/local/unsafe image targets stay blocked before any request", async () => {
  for (const u of ["https://127.0.0.1/logo.png", "https://169.254.169.254/latest/meta-data", "https://10.0.0.1/x.png", "https://[::1]/x.png", "https://localhost/x.png", "http://cdn.acmebeauty.com/x.png", "file:///etc/passwd"]) {
    const r = await F.safeFetchImage(u);
    assert.equal(r.ok, false, u);
  }
  // Extracted candidates are https only; data:/javascript: never become URLs.
  const p = extract(page('<meta property="og:image" content="javascript:alert(1)"><meta property="og:logo" content="http://cdn.acmebeauty.com/l.png">', '<header><a href="/"><img src="data:image/png;base64,AAAA" alt="Acme Beauty logo"></a></header>'));
  assert.deepEqual([p.logoCandidates, p.coverCandidates], [[], []]);
});

test("security: byte/type/dimension bounds unchanged; SVG and mismatched bytes are rejected", async () => {
  assert.equal(F.SAFE_FETCH_IMAGE_MAX_BYTES, 5 * 1024 * 1024);
  assert.deepEqual([...F.SAFE_FETCH_IMAGE_TYPES].sort(), ["application/octet-stream", "binary/octet-stream", "image/gif", "image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/webp"], "first gate only — the bytes decide");
  assert.equal(IMG.BRAND_IMAGE_PIXEL_LIMIT, 40_000_000);
  const svg = transport({ "/l.png": { body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), type: "image/png" } });
  assert.deepEqual(await IMG.fetchVerifiedBrandImage("https://a.com/l.png", "logo", svg), { ok: false, reason: "invalid_file" });
  // A CDN label that disagrees with the bytes no longer loses the image: the
  // real format (sniffed) is what is verified and stored. A non-image label is refused.
  const relabeled = await IMG.fetchVerifiedBrandImage("https://a.com/l.png", "logo", transport({ "/l.png": { body: await photo(400, 300), type: "image/png" } }));
  assert.equal(relabeled.ok, true);
  assert.equal(relabeled.image.validated.contentType, "image/jpeg");
  assert.deepEqual(await IMG.fetchVerifiedBrandImage("https://a.com/l.png", "logo", transport({ "/l.png": { body: await photo(400, 300), type: "text/html" } })), { ok: false, reason: "type_mismatch" });
  assert.equal(IMG.isSuitableBrandImage("cover", 599, 400), false);
  assert.equal(IMG.isSuitableBrandImage("logo", 100, 100), false);
});

test("security: no image proxy — previews are server-rendered thumbnails for recorded candidate URLs only", () => {
  const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
  const users = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && /previewBrandCandidate(Result)?\(/.test(read(f)) && !f.endsWith(join("lib", "brand-images.ts")));
  assert.deepEqual(users.sort(), [join("src", "app", "(public)", "account", "business", "new", "page.tsx"), join("src", "app", "admin", "(protected)", "businesses", "import", "[batchId]", "[candidateId]", "page.tsx"),
    // Admin Event Import's inline Create & Review Business — the stored
    // candidate's own logo / cover (adminPreviewBusinessRead), server-side.
    join("src", "app", "admin", "(protected)", "events", "import", "actions.ts")].sort());
  for (const f of users) assert.doesNotMatch(read(f), /^"use client";/, f);
  assert.deepEqual(walk("src/app/api").filter((f) => /brand-images|previewBrandCandidate|safeFetchImage/.test(read(f))), [], "no API route fetches images");
  // The Admin page never hands the remote candidate URL to the browser.
  const admin = code("src/app/admin/(protected)/businesses/import/[batchId]/[candidateId]/page.tsx");
  assert.doesNotMatch(admin, /src=\{p\.(logo|cover)\}|\{p\.(logo|cover)\}|href=\{p\.(logo|cover)\}/);
  assert.match(admin, /<img src=\{img\.preview\}/);
});

// ── PREVIEW ───────────────────────────────────────────────────────────────

test("preview: a verified candidate renders as a re-encoded WebP data URI (never the remote URL)", async () => {
  IMG.resetBrandPreviewCache();
  const t = transport({ "/hero.jpg": { body: await photo(), type: "image/jpeg" }, "/logo.png": { body: await logoPng(), type: "image/png" } });
  const cover = await IMG.previewBrandCandidateResult("https://cdn.acmebeauty.com/hero.jpg", "cover", 0, t);
  assert.equal(cover.reason, null);
  assert.match(cover.preview, /^data:image\/webp;base64,/);
  assert.ok(Buffer.from(cover.preview.split(",")[1], "base64").length <= 120 * 1024);
  const logo = await IMG.previewBrandCandidateResult("https://cdn.acmebeauty.com/logo.png", "logo", 0, t);
  assert.match(logo.preview, /^data:image\/webp;base64,/);
  assert.equal(await IMG.previewBrandCandidate("https://cdn.acmebeauty.com/logo.png", "logo", 0, t), logo.preview, "legacy API unchanged");
});

test("preview: a worst-case detailed photo (noise) stays within the preview byte cap", async () => {
  const rand = rng(3);
  const w = 1280;
  const h = 720;
  const noise = Buffer.alloc(w * h * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(rand() * 256);
  const body = await sharp(noise, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  const preview = await IMG.brandImagePreview({ role: "cover", body, validated: {}, width: w, height: h });
  assert.ok(preview === null || Buffer.from(preview.split(",")[1], "base64").length <= 120 * 1024, "within the preview byte cap");
});

test("preview: failures are nonfatal with a safe reason; transient fetch failures retry soon, rejections stay cached", async () => {
  IMG.resetBrandPreviewCache();
  const t = transport({ "/share.png": { body: await wordmark(), type: "image/png" } });
  assert.deepEqual(await IMG.previewBrandCandidateResult("https://a.com/share.png", "cover", 0, t), { preview: null, reason: "graphic" });
  assert.deepEqual(await IMG.previewBrandCandidateResult("https://a.com/gone.png", "cover", 0, t), { preview: null, reason: "fetch_failed" });
  const before = t.calls.length;
  await IMG.previewBrandCandidateResult("https://a.com/gone.png", "cover", 30_000, t);
  await IMG.previewBrandCandidateResult("https://a.com/share.png", "cover", 5 * 60_000, t);
  assert.equal(t.calls.length, before, "both cached within their TTLs");
  await IMG.previewBrandCandidateResult("https://a.com/gone.png", "cover", 61_000, t);
  assert.equal(t.calls.length, before + 1, "a failed fetch is retried after a minute");
  await IMG.previewBrandCandidateResult("https://a.com/share.png", "cover", 6 * 60_000, t);
  assert.equal(t.calls.length, before + 1, "a deterministic rejection is not refetched");
});

test("preview: an unavailable preview still defaults to Remove, with a reason-specific safe label", () => {
  const items = D.brandImageReviewItems({ site: "https://a.com", cover: "https://a.com/share.png", logo: "https://a.com/l.png" }, { cover: null, logo: "data:image/webp;base64,AA" });
  assert.equal(items.items.find((i) => i.role === "cover").keep, false);
  assert.equal(items.items.find((i) => i.role === "logo").keep, true);
  assert.match(D.brandImagePreviewUnavailableLabel("cover", "graphic"), /logo or wordmark/);
  assert.match(D.brandImagePreviewUnavailableLabel("cover", "fetch_failed"), /Reload to try again/);
  assert.match(D.brandImagePreviewUnavailableLabel("logo", "unsuitable"), /logo/);
  assert.equal(D.brandImagePreviewUnavailableLabel("cover", "https://evil.example/<x>"), "This image can't be shown.", "unknown codes never echo input");
});

// ── REGRESSION ────────────────────────────────────────────────────────────

test("regression: text, category and the AI trigger are unchanged; images never call AI", async () => {
  assert.equal(B.brandAiNeed({ deterministicCategoryId: "c", shortDescription: "s" }), false);
  assert.equal(B.brandAiNeed({ deterministicCategoryId: null, shortDescription: "s" }), true);
  assert.equal(B.brandAiNeed({ deterministicCategoryId: "c", shortDescription: null }), true);
  const html = page('<meta name="description" content="Acme Beauty is a beauty brand offering clean, cruelty-free and vegan makeup.">' + ORG({ "@type": "HealthAndBeautyBusiness", logo: "https://cdn.acmebeauty.com/l.png" }), HEADER_LOGO);
  const p = extract(html);
  assert.equal(p.name, "Acme Beauty");
  assert.equal(p.shortDescription, "Acme Beauty is a beauty brand offering clean, cruelty-free and vegan makeup.");
  let enrichCalls = 0;
  const built = await B.buildCandidateFromExtraction(
    { websiteUrl: "https://www.acmebeauty.com", host: "acmebeauty.com", fetchUrl: SITE },
    { profile: p, finalUrl: SITE.href },
    {
      findMatches: async () => [],
      listCategories: async () => [{ id: "cat-beauty", slug: "beauty-self-care", name: "Beauty & Self-Care" }],
      enrich: async () => (enrichCalls++, { result: null, called: true, usage: null }),
      verifyImage: async () => true,
    },
    { verifyImages: true }
  );
  assert.equal(enrichCalls, 0, "deterministic category + short description → no AI call");
  assert.equal(built.ai.status, "skipped");
  assert.equal(built.proposal.logoUrl, "https://cdn.acmebeauty.com/l.png");
  // verifyImages off → nothing fetched, both null.
  let fetched = 0;
  const off = await B.buildCandidateFromExtraction(
    { websiteUrl: "https://www.acmebeauty.com", host: "acmebeauty.com", fetchUrl: SITE },
    { profile: p, finalUrl: SITE.href },
    { findMatches: async () => [], listCategories: async () => [], enrich: async () => ({ result: null, called: false, usage: null }), verifyImage: async () => (fetched++, true) },
    { verifyImages: false }
  );
  assert.deepEqual([off.proposal.logoUrl, off.proposal.coverUrl, fetched], [null, null, 0]);
  for (const f of ["src/lib/brand-website-extract.ts", "src/lib/brand-images.ts"]) assert.doesNotMatch(read(f), /anthropic|brand-ai-enrichment/i, f);
});

test("regression: an older single-pick extraction (no pools) still works", async () => {
  const legacy = { ...extract(page(ORG({ logo: "https://cdn.acmebeauty.com/l.png" }))), logoCandidates: undefined, coverCandidates: undefined };
  const built = await B.buildCandidateFromExtraction(
    { websiteUrl: "https://www.acmebeauty.com", host: "acmebeauty.com", fetchUrl: SITE },
    { profile: legacy, finalUrl: SITE.href },
    { findMatches: async () => [], listCategories: async () => [], enrich: async () => ({ result: null, called: false, usage: null }), verifyImage: async () => true },
    { verifyImages: true }
  );
  assert.equal(built.proposal.logoUrl, "https://cdn.acmebeauty.com/l.png");
});

test("regression: P3/P4 import semantics unchanged — one logo/cover URL per proposal, pending_review creation, no gallery", () => {
  const lib = read("src/lib/admin/brand-import.ts");
  assert.match(lib, /put\("logo", p\.logoUrl/);
  assert.match(lib, /put\("cover", p\.coverUrl/);
  assert.match(read("src/lib/admin/brand-import-review.ts"), /publication_status: "pending_review"/);
  const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
  const brandFiles = walk("src").filter((f) => /brand/i.test(f) && /\.(ts|tsx)$/.test(f));
  for (const f of brandFiles) assert.doesNotMatch(read(f), /galleryCandidates|gallery_candidates|galleryUrls/, f);
  const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  // No migration for this pass: nothing after Phase 0B touches Brand
  // Import or Business media (later migrations are unrelated features).
  for (const f of migrations.filter((f) => f > "20261012020000_business_select_privacy_boundary.sql")) {
    assert.doesNotMatch(read(join("supabase/migrations", f)).replace(/--.*$/gm, ""), /brand_import|logo_url|cover_image_url|alter table (public\.)?businesses/i, f);
  }
});
