// Brand Candidate Quality pass — Instagram evidence, logo vs cover
// semantics, neutral profile copy and the AI trigger rule, in the SHARED
// Brand candidate engine (public Brand Builder + Admin Brand Import).
// No network (stub transports/engines), no database, no Anthropic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import sharp from "sharp";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/headers") {
      return { url: "data:text/javascript,export const headers=async()=>new Map();export const cookies=async()=>({get(){return undefined},set(){}})", shortCircuit: true };
    }
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
const AI = await import("../src/lib/brand-ai-enrichment.ts");
const B = await import("../src/lib/brand-candidate-builder.ts");
const A = await import("../src/lib/brand-website-analysis.ts");
const I = await import("../src/lib/admin/brand-import.ts");

const SITE = new URL("https://www.acmebeauty.com/");
const page = (head, body = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const extract = (html, url = SITE) => X.extractBrandProfile(html, url);
const NEUTRAL = "Acme Beauty is a beauty brand offering clean, cruelty-free and vegan makeup.";
const CTA = "Shop Acme Beauty's clean, cruelty-free, vegan makeup and skincare. Free shipping on orders over $40.";

// ── B. Instagram ──────────────────────────────────────────────────────────
test("Instagram: JSON-LD sameAs on the brand entity", () => {
  const html = page(ld({ "@type": "Organization", name: "Acme Beauty", url: "https://www.acmebeauty.com/", sameAs: ["https://www.instagram.com/acmebeauty/", "https://www.tiktok.com/@acmebeauty"] }));
  assert.equal(extract(html).instagramHandle, "acmebeauty");
});

test("Instagram: an ordinary first-party link (header/footer anchor or rel=me)", () => {
  assert.equal(extract(page("", '<footer><a href="https://www.instagram.com/acmebeauty?hl=en">Instagram</a></footer>')).instagramHandle, "acmebeauty");
  assert.equal(extract(page('<link rel="me" href="https://instagram.com/acmebeauty/">')).instagramHandle, "acmebeauty");
});

test("Instagram: malformed or non-profile Instagram URLs and non-Instagram socials are ignored", () => {
  for (const href of ["https://instagram.com/", "https://instagram.com/p/Cxyz123/", "https://instagram.com/explore/tags/makeup/", "https://evil.example/instagram.com/acme", "javascript:alert(1)", "https://instagram.com/bad..handle"]) {
    assert.equal(extract(page("", `<a href="${href}">x</a>`)).instagramHandle, null, href);
  }
  const socials = page(ld({ "@type": "Organization", name: "Acme Beauty", sameAs: ["https://www.facebook.com/acmebeauty", "https://x.com/acmebeauty", "https://www.tiktok.com/@acmebeauty"] }));
  assert.equal(extract(socials).instagramHandle, null);
});

test("Instagram: multiple candidates resolve deterministically, or not at all", () => {
  const C = (sameAs, page = new Set()) => X.chooseInstagramHandle(new Set(sameAs), page, "www.acmebeauty.com");
  assert.equal(C(["acme_ca", "acmebeauty"], new Set(["acmebeauty"])), "acmebeauty", "the sameAs account also linked on the page");
  assert.equal(C(["acme_ca", "acmebeauty"]), "acmebeauty", "else the one equal to the domain label");
  assert.equal(C(["acme_ca", "acme_uk"]), null, "no defensible tie-break → none");
  assert.equal(X.chooseInstagramHandle(new Set(), new Set(["acme.beauty", "makeupartist_jane"]), "acmebeauty.com"), "acme.beauty", "page links: label match (dots/underscores ignored)");
  assert.equal(X.chooseInstagramHandle(new Set(), new Set(["makeupartist_jane", "someone_else"]), "acmebeauty.com"), null, "unrelated accounts (e.g. UGC) → none");
  // sameAs beats page links when it names exactly one account.
  assert.equal(X.chooseInstagramHandle(new Set(["acmebeauty"]), new Set(["makeupartist_jane"]), "acmebeauty.com"), "acmebeauty");
  // Never derived from the name/domain alone.
  assert.equal(X.chooseInstagramHandle(new Set(), new Set(), "acmebeauty.com"), null);
});

test("Instagram: no evidence → none (no AI, no guess from the brand name)", () => {
  const p = extract(page(`<title>Acme Beauty</title><meta property="og:site_name" content="Acme Beauty">`));
  assert.equal(p.instagramHandle, null);
});

// ── C. Logo vs cover ──────────────────────────────────────────────────────
const solidWith = async (w, h, bg, blocks = []) =>
  sharp({ create: { width: w, height: h, channels: 3, background: bg } })
    .composite(blocks.map(([left, top, bw, bh, color]) => ({ input: { create: { width: bw, height: bh, channels: 3, background: color } }, left, top })))
    .png()
    .toBuffer();
/** A wordmark/share graphic: dark lettering blocks on a flat white card. */
const wordmark = () => solidWith(1200, 630, "#ffffff", [[300, 260, 120, 110, "#111111"], [440, 260, 120, 110, "#111111"], [580, 260, 120, 110, "#111111"], [720, 260, 180, 110, "#111111"]]);
/** Photo-like: per-pixel colour noise over a gradient. */
async function photo(w = 1200, h = 630) {
  const data = Buffer.alloc(w * h * 3);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
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
/** A legitimately graphic but colourful brand banner (four colour bands). */
const banner = () => solidWith(1200, 630, "#f4a6c4", [[300, 0, 300, 630, "#14b0bc"], [600, 0, 300, 630, "#ffd166"], [900, 0, 300, 630, "#3d348b"]]);
const fetchOf = (body, type = "image/png") => ({ fetchImage: async (url) => ({ ok: true, url: new URL(url), body, contentType: type, bytes: body.length, redirects: 0 }) });

test("images: a strong logo + a photographic cover are both kept", async () => {
  const html = page(
    `<meta property="og:image" content="https://cdn.acmebeauty.com/hero.jpg">` +
      ld({ "@type": "Organization", name: "Acme Beauty", logo: "https://cdn.acmebeauty.com/logo.png" })
  );
  const p = extract(html);
  assert.deepEqual([p.logoCandidateUrl, p.coverCandidateUrl], ["https://cdn.acmebeauty.com/logo.png", "https://cdn.acmebeauty.com/hero.jpg"]);
  const cover = await IMG.fetchVerifiedBrandImage(p.coverCandidateUrl, "cover", fetchOf(await photo(), "image/jpeg"));
  assert.equal(cover.ok, true, "a photograph is a cover");
  assert.equal(await IMG.isLowInformationGraphic(await photo()), false);
});

test("images: the same image is never both logo and cover (query/size params ignored)", () => {
  const same = page(`<meta property="og:image" content="https://cdn.acmebeauty.com/files/logo.png?v=123&width=1200">` + ld({ "@type": "Organization", name: "Acme Beauty", logo: "https://cdn.acmebeauty.com/files/logo.png" }));
  const p = extract(same);
  assert.equal(p.logoCandidateUrl, "https://cdn.acmebeauty.com/files/logo.png");
  assert.equal(p.coverCandidateUrl, null);
  assert.equal(X.sameImageSource("https://a.com/x.png?w=1", "https://A.com/x.png#f"), true);
  assert.equal(X.sameImageSource("https://a.com/x.png", "https://a.com/y.png"), false);
});

test("images: an obvious low-information wordmark/share graphic is not a cover (and is not turned into a logo)", async () => {
  const body = await wordmark();
  assert.equal(await IMG.isLowInformationGraphic(body), true);
  assert.deepEqual(await IMG.fetchVerifiedBrandImage("https://cdn.acmebeauty.com/share.png", "cover", fetchOf(body)), { ok: false, reason: "graphic" });
  // Only covers are tested; the same file offered as a LOGO is judged by
  // the logo rules alone (no silent cover→logo conversion happens: the
  // extractor never reuses the cover URL as a logo).
  assert.equal((await IMG.fetchVerifiedBrandImage("https://cdn.acmebeauty.com/logo.png", "logo", fetchOf(await solidWith(600, 200, "#ffffff", [[100, 60, 400, 80, "#111111"]])))).ok, true);
  const onlyShare = extract(page(`<meta property="og:image" content="https://cdn.acmebeauty.com/share.png">`));
  assert.equal(onlyShare.logoCandidateUrl, null);
  // A transparent logo-on-nothing PNG is also a graphic.
  const transparent = await sharp({ create: { width: 1200, height: 630, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: 500, height: 120, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } }, left: 350, top: 255 }])
    .png()
    .toBuffer();
  assert.equal(await IMG.isLowInformationGraphic(transparent), true);
});

test("images: a valid photographic landscape cover and a colourful graphic banner both pass", async () => {
  assert.equal((await IMG.fetchVerifiedBrandImage("https://cdn.acmebeauty.com/hero.jpg", "cover", fetchOf(await photo(), "image/jpeg"))).ok, true);
  assert.equal(await IMG.isLowInformationGraphic(await banner()), false, "not aggressive against real graphic covers");
  assert.equal((await IMG.fetchVerifiedBrandImage("https://cdn.acmebeauty.com/banner.png", "cover", fetchOf(await banner()))).ok, true);
  assert.deepEqual([IMG.GRAPHIC_TOP_COLOR_MIN, IMG.GRAPHIC_MAX_SIGNIFICANT_COLORS], [0.6, 6]);
});

test("images: no valid cover / no valid logo → none", async () => {
  // No share image at all.
  assert.equal(extract(page("<title>Acme</title>")).coverCandidateUrl, null);
  // SVG/ICO and tiny favicons are never logo candidates.
  const weak = page(
    `<link rel="icon" href="/favicon.ico"><link rel="icon" sizes="32x32" href="/favicon-32.png"><link rel="icon" sizes="192x192" type="image/svg+xml" href="/icon.svg">` +
      ld({ "@type": "Organization", name: "Acme Beauty", logo: "https://cdn.acmebeauty.com/logo.svg" })
  );
  assert.equal(extract(weak).logoCandidateUrl, null);
  // A portrait image is not a cover.
  assert.deepEqual(await IMG.fetchVerifiedBrandImage("https://cdn.acmebeauty.com/tall.jpg", "cover", fetchOf(await photo(600, 900), "image/jpeg")), { ok: false, reason: "unsuitable" });
});

test("images: additional first-party logo sources, strongest first (SVG JSON-LD logo falls through)", () => {
  const svgThenMeta = page(`<meta property="og:logo" content="https://cdn.acmebeauty.com/og-logo.png">` + ld({ "@type": "Organization", name: "Acme", logo: "https://cdn.acmebeauty.com/logo.svg" }));
  assert.equal(extract(svgThenMeta).logoCandidateUrl, "https://cdn.acmebeauty.com/og-logo.png");
  const itemprop = page(`<meta itemprop="logo" content="/brand/logo.png">`);
  assert.equal(extract(itemprop).logoCandidateUrl, "https://www.acmebeauty.com/brand/logo.png");
  const icon = page(`<link rel="icon" sizes="32x32" href="/f32.png"><link rel="icon" sizes="192x192" href="/f192.png"><link rel="icon" sizes="512x512" href="/f512.png">`);
  assert.equal(extract(icon).logoCandidateUrl, "https://www.acmebeauty.com/f512.png", "largest declared raster icon ≥ 120");
  const touchFirst = page(`<link rel="icon" sizes="512x512" href="/f512.png"><link rel="apple-touch-icon" sizes="180x180" href="/touch.png">`);
  assert.equal(extract(touchFirst).logoCandidateUrl, "https://www.acmebeauty.com/touch.png", "apple-touch-icon before generic icons");
});

// ── D. Neutral profile copy ───────────────────────────────────────────────
test("copy: merchant CTA and first/second-person openings are not usable descriptions", () => {
  for (const text of [
    CTA,
    "Discover clean, vegan makeup from Acme Beauty for every skin type and tone.",
    "Buy prebiotic soda online from Acme with fast shipping across the country.",
    "Explore our collection of vegan makeup made for every face and every day.",
    "We strive to make clean makeup that works for every skin type and tone.",
    "Our products are vegan, cruelty-free and made in small batches in Brooklyn.",
    "Your new favorite vegan makeup brand, made for every face and every routine.",
    "Get free shipping on clean, vegan makeup and skincare from Acme Beauty today.",
  ]) {
    assert.equal(X.isUsefulDescription(text, "Acme Beauty"), false, text);
  }
  assert.equal(X.isUsefulDescription(NEUTRAL, "Acme Beauty"), true);
  assert.equal(X.isUsefulDescription("A beverage brand offering prebiotic soda made with plant fiber and real fruit juice.", "Acme"), true);
  assert.equal(X.isUsefulDescription("Acme Beauty makes vegan makeup that our founders first mixed in a Brooklyn studio.", "Acme Beauty"), true, "first person mid-sentence is not penalised");
});

test("copy: a neutral candidate wins over CTA copy; CTA-only pages leave the short description to the AI step", () => {
  const both = extract(page(`<meta name="description" content="${CTA}"><meta property="og:description" content="${NEUTRAL}">`));
  assert.equal(both.shortDescription, NEUTRAL);
  const ctaOnly = extract(page(`<title>Acme Beauty</title><meta name="description" content="${CTA}">` + ld({ "@type": "BeautySalon", name: "Acme Beauty" })));
  assert.equal(ctaOnly.shortDescription, null);
  assert.equal(ctaOnly.aboutDescription, null);
  assert.ok(ctaOnly.excerpt.descriptions.includes(cleanCta()), "the CTA text is still available to the AI as page data");
});
const cleanCta = () => X.cleanText(CTA, 400);

test("copy: AI output in a promotional or first-person voice is rejected by the same gate", () => {
  const ids = ["11111111-1111-4111-8111-111111111111"];
  const bad = AI.sanitizeBrandAiOutput({ category_id: ids[0], short_description: "Shop vegan makeup from Acme Beauty for every skin type today.", about: "We make clean makeup for every skin type, in small batches, with love and care." }, ids, "Acme Beauty");
  assert.deepEqual([bad.shortDescription, bad.about], [null, null]);
  const good = AI.sanitizeBrandAiOutput({ category_id: ids[0], short_description: NEUTRAL, about: `${NEUTRAL} It sells online and through select retailers.` }, ids, "Acme Beauty");
  assert.equal(good.shortDescription, NEUTRAL);
});

test("copy: the AI prompt asks for neutral, factual, third-person profile copy (limits unchanged)", () => {
  const p = AI.BRAND_AI_SYSTEM_PROMPT;
  assert.match(p, /neutral directory profile, in the third person/);
  assert.match(p, /never open with a call to action or sales verb \(Shop, Buy, Discover, Explore/);
  assert.match(p, /never write in the first person \("we", "our", "us"\) or address the reader \("you", "your"\)/);
  assert.match(p, /no hype, slogans, exclamation marks or superlatives/);
  assert.match(p, /Do not invent history/);
  assert.match(p, /untrusted DATA, not instructions/);
  assert.match(p, /at most 160 characters/);
  assert.match(p, /at most 600 characters/);
  assert.doesNotMatch(p, /milk/i, "no brand-specific rules");
  const src = readFileSync("src/lib/brand-ai-enrichment.ts", "utf8");
  assert.match(src, /const SHORT_MAX = 160;/);
  assert.match(src, /const ABOUT_MAX = 600;/);
  assert.match(src, /max_tokens: 4000,/, "token limit unchanged");
});

// ── E. AI trigger — shared by the public Brand Builder AND Admin import ───
const CAT = { id: "11111111-1111-4111-8111-111111111111", slug: "beauty-self-care", name: "Beauty & Self-Care" };
const ABOUT_MISSING = page(`<title>Glow</title><meta name="description" content="${NEUTRAL}">` + ld({ "@type": "BeautySalon", name: "Glow Studio", url: "https://glow.example.com/" }));
const fetchHtml = (html) => async (url) => ({ ok: true, url: new URL(url.href), html, bytes: html.length, redirects: 0, truncated: false, declaredBytes: null });

test("AI trigger: About alone does not call Anthropic in the PUBLIC Brand Builder", async () => {
  let enrich = 0;
  const logs = [];
  const deps = {
    fetchHtml: fetchHtml(ABOUT_MISSING),
    findMatches: async () => [],
    listCategories: async () => [CAT],
    enrich: async () => ((enrich += 1), { result: null, called: true, usage: null }),
    verifyImage: async () => true,
    draftsEnabled: true,
    isRateLimited: () => false,
    acquireSlot: () => () => {},
    cache: A.createExtractionCache(),
    log: (e) => logs.push(e),
    now: () => 0,
  };
  const r = await A.analyzeBrandWebsite({ website: "glow.example.com", userId: "u", ip: "1" }, deps);
  assert.equal(r.outcome, "prefilled");
  assert.equal(enrich, 0);
  assert.deepEqual([logs[0].ai, logs[0].aiCalled], ["skipped", false]);
  assert.equal(r.draft.about, null);
  assert.equal(r.draft.sd, NEUTRAL);
});

test("AI trigger: About alone does not call Anthropic in ADMIN Brand Import; category missing still does", async () => {
  const row = { id: "c1", batch_id: "b1", status: "queued", attempt_count: 0, processing_started_at: null, submitted_input: "glow.example.com", normalized_host: "glow.example.com", ai_status: null, ai_model: null, ai_input_tokens: null, ai_output_tokens: null, ai_cache_creation_input_tokens: null, ai_cache_read_input_tokens: null, ai_estimated_cost_usd: null };
  const store = (r) => {
    const db = { ...r };
    return {
      db,
      createBatch: async () => "b1",
      getCandidate: async () => ({ ...db }),
      countFreshProcessing: async () => 0,
      claim: async (id, n, nowIso) => (db.attempt_count === n ? (Object.assign(db, { status: "processing", processing_started_at: nowIso, attempt_count: n + 1 }), true) : false),
      finish: async (id, n, patch) => (Object.assign(db, patch), true),
    };
  };
  const run = async (html) => {
    let enrich = 0;
    const s = store(row);
    const engine = {
      fetchHtml: fetchHtml(html),
      findMatches: async () => [],
      listCategories: async () => [CAT],
      enrich: async () => ((enrich += 1), { result: { categoryId: CAT.id, shortDescription: null, about: "Glow Studio is a beauty studio offering facials and brow treatments." }, called: true, usage: { model: "claude-opus-5", inputTokens: 900, outputTokens: 80, cacheCreationInputTokens: null, cacheReadInputTokens: null, estimatedCostUsd: 0.0065 } }),
      verifyImage: async () => true,
    };
    await I.processBrandImportCandidate("c1", { store: s, engine, now: () => Date.parse("2026-10-12T12:00:00Z"), log: () => {} });
    return { enrich, db: s.db };
  };
  const aboutOnly = await run(ABOUT_MISSING);
  assert.equal(aboutOnly.enrich, 0);
  assert.deepEqual([aboutOnly.db.status, aboutOnly.db.ai_status, aboutOnly.db.ai_input_tokens, aboutOnly.db.ai_estimated_cost_usd], ["ready", "skipped", null, null], "no cost recorded");
  const noCategory = await run(page(`<meta name="description" content="${NEUTRAL}">` + ld({ "@type": "Organization", name: "Glow Studio" })));
  assert.equal(noCategory.enrich, 1);
  assert.deepEqual([noCategory.db.ai_status, noCategory.db.ai_input_tokens, noCategory.db.proposal.about], ["used", 900, "Glow Studio is a beauty studio offering facials and brow treatments."], "About comes back in the same call");
});

test("scope: no hostname/brand-specific rules; safe-fetch and matching untouched", () => {
  for (const f of ["src/lib/brand-website-extract.ts", "src/lib/brand-images.ts", "src/lib/brand-ai-enrichment.ts", "src/lib/brand-candidate-builder.ts"]) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /milk|olipop|liquid ?death|rare ?beauty|glossier/i, f);
  }
});
