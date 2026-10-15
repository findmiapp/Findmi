// Brand website import — modern site extraction repair: challenge pages,
// the shared one-time 429/503 retry, inline SVG brand marks, responsive /
// lazy hero images and the ONE same-site About page. Evidence-only: what a
// site doesn't show stays blank. Fake transports / fetchers only — no
// network, no database, no AI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
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

const F = await import("../src/lib/safe-fetch.ts");
const X = await import("../src/lib/brand-website-extract.ts");
const C = await import("../src/lib/brand-candidate-builder.ts");
const A = await import("../src/lib/brand-website-analysis.ts");
const IMG = await import("../src/lib/brand-images.ts");
const read = (p) => readFileSync(p, "utf8");

const BASE = new URL("https://www.marcbrand.example/");
const page = (head = "", body = "") => `<!doctype html><html><head><title>Marc Brand</title>${head}</head><body>${body}</body></html>`;
const extract = (html, url = BASE) => X.extractBrandProfile(html, url);
const ok = (html, url = BASE.href) => ({ ok: true, url: new URL(url), html, bytes: html.length, redirects: 0, truncated: false, declaredBytes: null, contentType: "text/html" });

// ── BLOCKING ──────────────────────────────────────────────────────────────

const JUST_A_MOMENT = `<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta name="robots" content="noindex,nofollow"></head><body><div class="main-wrapper"><noscript>Enable JavaScript and cookies to continue</noscript></div><script>(function(){window._cf_chl_opt={cvId: '3'};})();</script></body></html>`;
const ACCESS_DENIED = `<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY><H1>Access Denied</H1>You don't have permission to access "http&#58;&#47;&#47;www&#46;coach&#46;example&#47;" on this server.<P>Reference&#32;&#35;18&#46;5e2c1002&#46;1760000000&#46;1a2b3c</BODY></HTML>`;
const NORMAL_SECURITY = page(
  '<meta name="description" content="Acme makes home security cameras and smart locks for renters and homeowners.">',
  `<main><h1>Security that respects your privacy</h1><p>Control access to your home with verification codes. We use cookies to improve your experience. Read our privacy policy.</p>${"<p>Acme cameras record in 2K and store footage locally, with optional encrypted cloud backup for every plan.</p>".repeat(8)}</main>`
);

test("blocking: 200 challenge / access-denied interstitials are recognized; ordinary pages never are", () => {
  assert.equal(F.isChallengePage(JUST_A_MOMENT), true);
  assert.equal(F.isChallengePage(ACCESS_DENIED), true);
  assert.equal(F.isChallengePage(NORMAL_SECURITY), false, "mentions security / access / verification / cookies / privacy");
  // Providers inject scripts into ORDINARY pages too — those are not blocks.
  const injected = NORMAL_SECURITY.replace("</body>", '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script><script src="/_Incapsula_Resource?SWJIYLWA=1"></script></body>');
  assert.equal(F.isChallengePage(injected), false);
  // An "Access Denied"-titled page with real content and no refusal wording.
  const article = `<html><head><title>Access Denied</title></head><body>${"<p>Access Denied is a 2026 thriller film about a hacker who breaks into a bank and the detective who follows her across three cities.</p>".repeat(10)}</body></html>`;
  assert.equal(F.isChallengePage(article), false);
  assert.equal(F.isChallengePage(""), false);
});

test("blocking: a challenge page is a refusal (blocked_by_site), never parsed as the brand", async () => {
  const r = await C.fetchBrandWebsite(new URL("https://coach.example/"), { fetchHtml: async () => ok(JUST_A_MOMENT, "https://www.coach.example/") });
  assert.equal(r.ok, false);
  assert.equal(r.code, "blocked_by_site");
  assert.equal(r.fetch.challenge, true);
  assert.equal(r.fetch.status, 200);
  assert.equal(C.isDeliberateBlock(r.code, r.fetch), true);
  assert.equal(C.isDeliberateBlock("blocked_by_site", { status: 403 }), true);
  assert.equal(C.isDeliberateBlock("blocked_by_site", { status: 503 }), false, "temporary unavailability is not a deliberate block");
  assert.equal(C.isDeliberateBlock("timeout", { status: null }), false);
});

function analysisDeps(fetchHtml, over = {}) {
  return {
    fetchHtml,
    findMatches: async () => [],
    listCategories: async () => [],
    isRateLimited: () => false,
    enrich: async () => ({ result: null, called: false, usage: null }),
    verifyImage: async () => false,
    draftsEnabled: false,
    acquireSlot: () => () => {},
    cache: A.createExtractionCache(),
    log: () => {},
    now: () => 1_000_000,
    ...over,
  };
}

test("blocking: Review distinguishes 'doesn't let Findmi read it' from 'couldn't read it'; name + website kept", async () => {
  const seed = { name: "Coach" };
  const blocked = await A.analyzeBrandWebsite({ website: "coach.example", userId: "u1", ip: "203.0.113.1", seed }, analysisDeps(async () => ({ ok: false, code: "blocked_by_site", redirects: 1, status: 403, host: "www.coach.example" })));
  assert.equal(blocked.outcome, "blocked_by_site");
  assert.match(blocked.href, /prefill=blocked/);
  assert.match(blocked.href, /name=Coach/);
  assert.match(decodeURIComponent(blocked.href), /website_url=https:\/\/coach\.example/);
  const challenge = await A.analyzeBrandWebsite({ website: "coach.example", userId: "u2", ip: "203.0.113.2", seed }, analysisDeps(async () => ok(JUST_A_MOMENT)));
  assert.match(challenge.href, /prefill=blocked/);
  const busy = await A.analyzeBrandWebsite({ website: "coach.example", userId: "u3", ip: "203.0.113.3", seed }, analysisDeps(async () => ({ ok: false, code: "blocked_by_site", redirects: 0, status: 503 })));
  assert.match(busy.href, /prefill=unavailable/);
  const timeout = await A.analyzeBrandWebsite({ website: "coach.example", userId: "u4", ip: "203.0.113.4", seed }, analysisDeps(async () => ({ ok: false, code: "timeout", redirects: 0 })));
  assert.match(timeout.href, /prefill=unavailable/);
  // Plain language, no provider/internal terms.
  const review = read("src/app/(public)/account/business/new/page.tsx");
  assert.match(review, /prefillStatus === "blocked"\s*\?\s*`\$\{prefillHost \?\? "This website"\} doesn't let Findmi read it automatically\. You can still add the brand details yourself\.`/);
  assert.doesNotMatch(review, /cloudflare|akamai|incapsula|captcha|bot protection|challenge/i);
});

// ── RETRY ─────────────────────────────────────────────────────────────────

function respond(status, headers = {}, body = "") {
  return { status, headers, body: (async function* () { yield Buffer.from(body); })(), destroy: () => {} };
}
const HTML = { "content-type": "text/html; charset=utf-8" };
function stub(sequence) {
  const calls = [];
  let i = 0;
  const transport = async (url) => {
    calls.push(url.href);
    const r = sequence[Math.min(i, sequence.length - 1)];
    i += 1;
    return r();
  };
  return { transport, calls };
}
const SITE = "https://www.marcbrand.com/"; // .example is refused before any request
const sleepless = { sleep: async () => {} };

for (const status of [429, 503]) {
  test(`retry: ${status} is retried exactly once (then succeeds / stays failed)`, async () => {
    const recovered = stub([() => respond(status, HTML, "busy"), () => respond(200, HTML, page())]);
    const r1 = await F.safeFetchBrandPage(SITE, { transport: recovered.transport, ...sleepless });
    assert.equal(r1.ok, true);
    assert.equal(recovered.calls.length, 2);
    const stuck = stub([() => respond(status, HTML, "busy")]);
    const r2 = await F.safeFetchBrandPage(SITE, { transport: stuck.transport, ...sleepless });
    assert.deepEqual([r2.ok, r2.code, r2.attempts, stuck.calls.length], [false, "blocked_by_site", 2, 2], "never a second retry");
  });
}

test("retry: 403 / other 4xx / a long Retry-After are never retried", async () => {
  for (const status of [403, 401, 404, 451]) {
    const s = stub([() => respond(status, HTML, "no")]);
    const r = await F.safeFetchBrandPage(SITE, { transport: s.transport, ...sleepless });
    assert.equal(s.calls.length, 1, String(status));
    assert.equal(r.ok, false);
  }
  const slow = stub([() => respond(429, { ...HTML, "retry-after": "30" }, "later")]);
  await F.safeFetchBrandPage(SITE, { transport: slow.transport, ...sleepless });
  assert.equal(slow.calls.length, 1, "a long Retry-After means no retry");
  // A challenge page is a 200: the fetch succeeds once; the Build refuses it.
  const chal = stub([() => respond(200, HTML, JUST_A_MOMENT)]);
  assert.equal((await F.safeFetchBrandPage(SITE, { transport: chal.transport, ...sleepless })).ok, true);
  assert.equal(chal.calls.length, 1);
  // ONE shared retry implementation; Event pages use it unchanged.
  const src = read("src/lib/safe-fetch.ts");
  assert.equal(src.match(/async function fetchWithTransientRetry\(/g).length, 1);
  assert.match(src, /export async function safeFetchEventPage[\s\S]{0,200}fetchWithTransientRetry\(input, EVENT_HTML_PROFILE, options\)/);
  assert.match(src, /export async function safeFetchBrandPage[\s\S]{0,200}fetchWithTransientRetry\(input, HTML_PROFILE, options\)/);
  assert.match(read("src/lib/brand-website-analysis.ts"), /fetchHtml: \(url\) => safeFetchBrandPage\(url\),/);
});

// ── LOGO: inline SVG brand marks ──────────────────────────────────────────

const WORDMARK = '<svg viewBox="0 0 200 50" aria-label="Marc Brand"><title>Marc Brand</title><path d="M0 0h200v50H0z"/></svg>';

test("logo: an inline SVG home-link brand mark in the header is a candidate; UI icons and random SVGs are not", () => {
  const html = page(
    "",
    `<header class="site-header"><button class="menu"><svg class="icon-menu" viewBox="0 0 24 24"><path d="M0 0h24"/></svg></button><a href="/" class="site-logo">${WORDMARK}</a><a href="/cart" aria-label="Cart"><svg viewBox="0 0 24 24"><path d="M1 1h20"/></svg></a><a href="/search"><svg class="search" viewBox="0 0 24 24"><path d="M2 2h10"/></svg></a></header>` +
      '<main><div class="promo"><svg viewBox="0 0 400 400"><circle cx="200" cy="200" r="100"/></svg></div></main>'
  );
  const p = extract(html);
  assert.equal(p.svgLogoCandidates.length, 1);
  const markup = X.inlineSvgMarkup(p.svgLogoCandidates[0]);
  assert.match(markup, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 200 50"/);
  assert.match(markup, /Marc Brand/);
  assert.equal(p.signals.inlineSvgLogos, 1);
  // Only decorative / interface SVGs → nothing.
  const icons = page("", '<header><a href="/account" aria-label="Account"><svg viewBox="0 0 24 24"><path d="M0 0h1"/></svg></a></header><section class="hero"><svg viewBox="0 0 500 300"><rect width="500" height="300"/></svg></section>');
  assert.deepEqual(extract(icons).svgLogoCandidates, []);
  // An icon-sized declared mark is not a logo.
  const tiny = page("", '<header><a href="/"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M0 0h16"/></svg></a></header>');
  assert.deepEqual(extract(tiny).svgLogoCandidates, []);
  // A <use> reference points outside the element → skipped.
  const sprite = page("", '<header><a href="/" class="logo"><svg viewBox="0 0 200 50"><use href="#logo-sprite"/></svg></a></header>');
  assert.deepEqual(extract(sprite).svgLogoCandidates, []);
});

test("logo: the inline mark goes through the SAME inspect → rasterize → verify path; unsafe markup is refused", async () => {
  const good = extract(page("", `<header><a href="/" class="logo">${WORDMARK}</a></header>`)).svgLogoCandidates[0];
  const v = await IMG.fetchVerifiedBrandImage(good, "logo", { fetchImage: async () => assert.fail("an inline mark is never fetched") });
  assert.equal(v.ok, true);
  assert.equal(v.image.validated.contentType, "image/png", "stored only as a verified raster, never raw SVG");
  assert.equal((await IMG.fetchVerifiedBrandImage(good, "cover")).ok, false, "never a cover");
  for (const evil of [
    '<svg viewBox="0 0 200 50"><script>alert(1)</script><path d="M0 0h200v50H0z"/></svg>',
    '<svg viewBox="0 0 200 50" onload="alert(1)"><path d="M0 0h200v50H0z"/></svg>',
    '<svg viewBox="0 0 200 50"><image href="https://evil.example/x.png" width="200" height="50"/></svg>',
    '<svg viewBox="0 0 200 50"><path style="fill:url(https://evil.example/p)" d="M0 0h200v50H0z"/></svg>',
  ]) {
    const cand = extract(page("", `<header><a href="/" class="logo">${evil}</a></header>`)).svgLogoCandidates[0];
    if (!cand) continue; // refused before it is even a candidate
    assert.equal((await IMG.fetchVerifiedBrandImage(cand, "logo")).ok, false, evil);
  }
  // Existing URL-based logo paths are unchanged and still rank first.
  const both = extract(page('<script type="application/ld+json">{"@type":"Organization","name":"Marc Brand","logo":"https://cdn.marcbrand.example/logo.svg"}</script>', `<header><a href="/" class="logo">${WORDMARK}</a></header>`));
  assert.equal(both.svgLogoCandidates[0], "https://cdn.marcbrand.example/logo.svg");
  assert.ok(X.isInlineSvgCandidate(both.svgLogoCandidates[1]));
  assert.equal(extract(page('<link rel="apple-touch-icon" sizes="180x180" href="/a180.png">')).logoCandidateUrl, "https://www.marcbrand.example/a180.png");
});

// ── COVER: responsive / lazy hero images ──────────────────────────────────

test("cover: <picture><source srcset|data-srcset> and lazy data-src/data-srcset heroes are candidates; sensible size picked", () => {
  const picture = page(
    "",
    '<section class="hero-banner"><picture><source type="image/avif" srcset="https://cdn.marcbrand.example/hero.avif 1600w"><source media="(min-width: 800px)" srcset="https://cdn.marcbrand.example/hero-800.jpg 800w, https://cdn.marcbrand.example/hero-1600.jpg 1600w, https://cdn.marcbrand.example/hero-3200.jpg 3200w"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Fall campaign"></picture></section>'
  );
  assert.deepEqual(extract(picture).coverCandidates, ["https://cdn.marcbrand.example/hero-1600.jpg"], "largest ≤ 2000w; AVIF never; placeholder ignored");
  const lazySource = page("", '<div class="hero"><picture><source data-srcset="https://cdn.marcbrand.example/lazy-1200.webp 1200w" type="image/webp"><img class="lazyload" alt=""></picture></div>');
  assert.deepEqual(extract(lazySource).coverCandidates, ["https://cdn.marcbrand.example/lazy-1200.webp"]);
  const lazyImg = page("", '<div class="slideshow"><img data-src="https://cdn.marcbrand.example/slide.jpg" alt="Runway"></div><div class="carousel"><img data-srcset="https://cdn.marcbrand.example/c-640.jpg 640w, https://cdn.marcbrand.example/c-1920.jpg 1920w"></div>');
  assert.deepEqual(extract(lazyImg).coverCandidates, ["https://cdn.marcbrand.example/slide.jpg", "https://cdn.marcbrand.example/c-1920.jpg"]);
});

test("cover: large product / gallery thumbnails are never promoted; OG / Twitter / JSON-LD keep their order", () => {
  const products = page("", '<main><ul class="product-grid">' + '<li class="product-tile"><picture><source srcset="https://cdn.marcbrand.example/p1-2000.jpg 2000w"><img src="https://cdn.marcbrand.example/p1.jpg" width="1200" height="1500"></picture></li>'.repeat(5) + "</ul></main>");
  assert.deepEqual(extract(products).coverCandidates, []);
  const meta = page(
    '<meta property="og:image" content="https://cdn.marcbrand.example/og.jpg"><meta name="twitter:image" content="https://cdn.marcbrand.example/tw.jpg"><script type="application/ld+json">{"@type":"Organization","name":"Marc Brand","image":"https://cdn.marcbrand.example/ld.jpg"}</script>',
    '<section class="hero"><picture><source srcset="https://cdn.marcbrand.example/hero.jpg 1600w"><img alt=""></picture></section>'
  );
  assert.deepEqual(extract(meta).coverCandidates, ["https://cdn.marcbrand.example/og.jpg", "https://cdn.marcbrand.example/tw.jpg", "https://cdn.marcbrand.example/ld.jpg", "https://cdn.marcbrand.example/hero.jpg"]);
});

// ── ABOUT ─────────────────────────────────────────────────────────────────

const ABOUT_HTML = `<html><head><title>About | Marc Brand</title><meta name="description" content="Marc Brand is a New York fashion house known for ready-to-wear, handbags and fragrance."></head><body>
<header><nav><a href="/">Home</a></nav></header>
<main><h1>Our Story</h1><p>Marc Brand is a New York fashion house founded in 1984, known for ready-to-wear collections, leather handbags and fragrance sold worldwide.</p>
<p>The label's runway shows during New York Fashion Week present seasonal womenswear alongside accessories and the brand's signature tote bag.</p>
<p>Free shipping on orders over $150. Returns accepted within 30 days. See our privacy policy.</p></main>
<footer><p>© 2026 Marc Brand. All rights reserved. Terms of use and cookie settings.</p></footer></body></html>`;

const website = C.prepareBrandWebsite("marcbrand.example").website;
function buildDeps(over = {}) {
  const aboutCalls = [];
  const enrichCalls = [];
  return {
    aboutCalls,
    enrichCalls,
    deps: {
      findMatches: async () => [],
      listCategories: async () => [],
      enrich: async (input) => (enrichCalls.push(input), { result: null, called: true, usage: null }),
      verifyImage: async () => false,
      fetchAboutPage: async (url) => (aboutCalls.push(url.href), ok(ABOUT_HTML, url.href)),
      ...over,
    },
  };
}
const homeWithLinks = (links, head = "") => page(head, `<main><h1>New Season</h1></main><footer>${links}</footer>`);
async function buildFrom(html, d) {
  const profile = extract(html);
  return C.buildCandidateFromExtraction(website, { profile, finalUrl: BASE.href }, d.deps, { verifyImages: false });
}

test("about: a useful homepage description means NO About request", async () => {
  const d = buildDeps();
  const html = homeWithLinks('<a href="/about-us">About Us</a>', '<meta name="description" content="Marc Brand is a New York fashion house known for ready-to-wear and handbags.">');
  const built = await buildFrom(html, d);
  assert.deepEqual(d.aboutCalls, []);
  assert.match(built.proposal.shortDescription, /^Marc Brand is a New York fashion house/);
});

test("about: no usable homepage description → ONE same-site About request; its own text, legal/footer excluded", async () => {
  const d = buildDeps();
  const html = homeWithLinks('<a href="/pages/our-story">Our Story</a> <a href="/about-us">About Us</a>', '<meta name="description" content="Shop the official Marc Brand site. Free shipping.">');
  const p = extract(html);
  assert.equal(p.aboutLinkUrl, "https://www.marcbrand.example/pages/our-story");
  const built = await buildFrom(html, d);
  assert.deepEqual(d.aboutCalls, ["https://www.marcbrand.example/pages/our-story"], "exactly one request — the second candidate is never fetched");
  assert.equal(built.proposal.shortDescription, "Marc Brand is a New York fashion house known for ready-to-wear, handbags and fragrance.");
  assert.match(built.proposal.about, /founded in 1984/);
  assert.doesNotMatch(built.proposal.about, /shipping|privacy|rights reserved|cookie/i);
  assert.deepEqual(built.enrichment.aboutPage, { shortDescription: built.proposal.shortDescription, about: built.proposal.about }, "memoized with the enrichment");
  // The grounded AI fill (still needed for the category) sees that page's text.
  assert.equal(d.enrichCalls.length, 1);
  assert.ok(d.enrichCalls[0].excerpt.paragraphs.some((t) => /founded in 1984/.test(t)));
});

test("about: external / off-site About links are never requested", async () => {
  const html = homeWithLinks('<a href="https://about.otherbrand.example/about">About</a> <a href="https://www.facebook.com/marcbrand/about">About Us</a>');
  assert.equal(extract(html).aboutLinkUrl, null);
  const d = buildDeps();
  await buildFrom(html, d);
  assert.deepEqual(d.aboutCalls, []);
  assert.equal(X.isSameSite(new URL("https://shop.marcbrand.example/about"), BASE), true, "a subdomain of the same site");
  assert.equal(X.isSameSite(new URL("https://marcbrand.example.evil.example/about"), BASE), false);
  // A redirect that leaves the site is discarded.
  const off = buildDeps({ fetchAboutPage: async () => ok(ABOUT_HTML, "https://www.otherbrand.example/about") });
  const built = await buildFrom(homeWithLinks('<a href="/about">About</a>'), off);
  assert.equal(off.aboutCalls.length, 0);
  assert.equal(built.proposal.shortDescription, null);
});

test("about: weak / promotional / blocked About pages leave the fields blank (nothing invented)", async () => {
  const weak = `<html><head><title>About</title></head><body><main><p>We believe in bold ideas and our community. Join us and discover your style today with our newest collections.</p><p>Free shipping and easy returns on every order. Sign up for our newsletter.</p></main></body></html>`;
  const d = buildDeps({ fetchAboutPage: async () => ok(weak, "https://www.marcbrand.example/about") });
  const built = await buildFrom(homeWithLinks('<a href="/about">About</a>'), d);
  assert.equal(built.proposal.shortDescription, null);
  assert.equal(built.proposal.about, null);
  const blocked = buildDeps({ fetchAboutPage: async () => ok(JUST_A_MOMENT, "https://www.marcbrand.example/about") });
  const b = await buildFrom(homeWithLinks('<a href="/about">About</a>'), blocked);
  assert.equal(b.proposal.about, null);
  assert.equal(b.enrichment.aboutPage, undefined, "a challenge page is never read as About text");
  const failed = buildDeps({ fetchAboutPage: async () => ({ ok: false, code: "timeout", redirects: 0 }) });
  assert.equal((await buildFrom(homeWithLinks('<a href="/about">About</a>'), failed)).proposal.about, null);
  // No About link at all → no request.
  const none = buildDeps();
  await buildFrom(page(), none);
  assert.deepEqual(none.aboutCalls, []);
});

test("about: the About fetch is bounded (one request, no retry, a shorter deadline)", () => {
  const src = read("src/lib/safe-fetch.ts");
  assert.match(src, /export const SAFE_FETCH_ABOUT_TIMEOUT_MS = 5000;/);
  assert.match(src, /export async function safeFetchBrandAboutPage[\s\S]{0,200}return safeFetchHtml\(input, \{ \.\.\.options, timeoutMs: Math\.min\(/, "plain safeFetchHtml — no retry");
  assert.match(read("src/lib/brand-website-analysis.ts"), /fetchAboutPage: \(url\) => safeFetchBrandAboutPage\(url\),/);
  assert.doesNotMatch(read("src/lib/brand-candidate-builder.ts"), /aboutLinks|for \(const .* of .*about/i, "never iterates About candidates");
});

// ── CATEGORY / CONFIGURATION ──────────────────────────────────────────────

test("category: unchanged — schema.org map, then the grounded AI choosing only existing categories, else manual", () => {
  const builder = read("src/lib/brand-candidate-builder.ts");
  assert.match(builder, /categoryId: deterministicCategoryId \?\? aiResult\?\.categoryId \?\? null,/);
  assert.match(builder, /export function brandAiNeed\(input: \{ deterministicCategoryId: string \| null; shortDescription: string \| null \}\): boolean \{\n\s+return !input\.deterministicCategoryId \|\| !input\.shortDescription;/);
});

test("configuration: without signed drafts the text-only prefill carries no media, and Review only shows verified previews", async () => {
  let verified = 0;
  const html = page('<meta property="og:image" content="https://cdn.marcbrand.example/og.jpg">', `<header><a href="/" class="logo">${WORDMARK}</a></header>`);
  const r = await A.analyzeBrandWebsite(
    { website: "marcbrand.example", userId: "u9", ip: "203.0.113.9", seed: { name: "Marc Brand" } },
    analysisDeps(async () => ok(html), { verifyImage: async () => (verified++, true), draftsEnabled: false })
  );
  assert.equal(r.outcome, "prefilled");
  assert.equal(r.draft, undefined, "no draft → the bounded text prefill");
  assert.match(r.href, /prefill=website/);
  assert.doesNotMatch(decodeURIComponent(r.href), /logo|cover|og\.jpg|data:image/i, "no media in the text prefill");
  assert.equal(verified, 0, "images are not even checked when they can't reach Review");
  const review = read("src/app/(public)/account/business/new/page.tsx");
  assert.match(review, /const logoPreview = logoStagedUrl \?\? logoResult\?\.preview \?\? null;/);
  assert.match(review, /<BrandImageInput role="logo" label="Logo" foundPreview=\{logoPreview\}/);
  // An inline mark is never written into the draft cookie as a URL.
  assert.match(read("src/lib/brand-draft.ts"), /logo: httpsUrl\(1024\)\.optional\(\),/);
});

// ── REGRESSION GUARDS ─────────────────────────────────────────────────────

test("regression: Event Import keeps its own fetch and is not challenge-filtered by this pass", () => {
  const engine = read("src/lib/event-import/engine.ts");
  assert.match(engine, /fetchPage: \(url\) => safeFetchEventPage\(url\),/);
  assert.doesNotMatch(engine, /isChallengePage|safeFetchBrand/);
  assert.doesNotMatch(read("src/lib/brand-website-extract.ts"), /(?<![\w.])fetch\(|safe-fetch/, "extraction stays pure");
});
