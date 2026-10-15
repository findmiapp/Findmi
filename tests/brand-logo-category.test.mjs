// Brand Builder — logo candidate ranking (primary identity outranks
// favicon / touch-icon fallbacks, independent of shape) and category
// inference (schema.org → grounded AI over EXISTING categories → blank),
// end to end into the signed Review draft. Fakes only — no network, no AI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/headers") return { url: "data:text/javascript,export const cookies=async()=>({get(){return undefined},set(){}});export const headers=async()=>new Map();", shortCircuit: true };
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
const C = await import("../src/lib/brand-candidate-builder.ts");
const A = await import("../src/lib/brand-website-analysis.ts");
const AI = await import("../src/lib/brand-ai-enrichment.ts");
const D = await import("../src/lib/brand-draft.ts");
const read = (p) => readFileSync(p, "utf8");

const SITE = new URL("https://www.northwind-goods.com/");
const website = C.prepareBrandWebsite("northwind-goods.com").website;
const page = (head, body = "") => `<!doctype html><html><head><title>Northwind</title>${head}</head><body>${body}</body></html>`;
const ld = (o) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", ...o })}</script>`;
const strokes = (w, h, n) => Array.from({ length: n }, (_, i) => `<rect x="${Math.round((i * w) / n)}" y="0" width="${Math.round(w / n / 2)}" height="${h}"/>`).join("");
const WIDE_MARK = `<header><a href="/" class="site-logo" aria-label="Northwind"><svg viewBox="0 0 400 30">${strokes(400, 30, 11)}</svg></a></header>`;
const SQUARE_MARK = `<header><a href="/" class="site-logo" aria-label="Northwind"><svg viewBox="0 0 100 100">${strokes(100, 100, 4)}</svg></a></header>`;
const TOUCH = '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-180.png">';

/** Build from page HTML; every image "verifies" unless listed in `fail`. */
async function build(html, { fail = [], enrich } = {}) {
  const profile = X.extractBrandProfile(html, SITE);
  const tried = [];
  const deps = {
    findMatches: async () => [],
    listCategories: async () => CATEGORIES,
    enrich: enrich ?? (async () => ({ result: null, called: false, usage: null })),
    verifyImage: async (url, role) => (tried.push(`${role}|${A.brandCandidateSource(url, role, profile, SITE.href)}`), !fail.some((f) => url.includes(f))),
  };
  const built = await C.buildCandidateFromExtraction(website, { profile, finalUrl: SITE.href }, deps, { verifyImages: true });
  return { built, profile, tried, source: built.proposal.logoUrl ? A.brandCandidateSource(built.proposal.logoUrl, "logo", profile, SITE.href) : null };
}

// ── LOGO RANKING ──────────────────────────────────────────────────────────

test("logo: a primary identity logo outranks the touch-icon fallback", async () => {
  const r = await build(page(TOUCH + ld({ "@type": "Organization", name: "Northwind", logo: "https://www.northwind-goods.com/brand/logo.png" })));
  assert.equal(r.source, "page_logo");
  assert.equal(r.built.proposal.logoUrl, "https://www.northwind-goods.com/brand/logo.png");
});

test("logo: an inline SVG brand mark outranks the touch icon — wide or square alike (shape is not a preference)", async () => {
  const wide = await build(page(TOUCH, WIDE_MARK));
  assert.equal(wide.source, "inline_svg");
  const square = await build(page(TOUCH, SQUARE_MARK));
  assert.equal(square.source, "inline_svg", "a square header mark wins the same way");
  // The touch icon is only tried when the stronger mark fails.
  assert.ok(!wide.tried.includes("logo|icon"), "the fallback icon is never even fetched when the mark verifies");
});

test("logo: a square primary logo (structured data) still beats a wide inline wordmark — provenance, not width, decides", async () => {
  const r = await build(page(TOUCH + ld({ "@type": "Organization", name: "Northwind", logo: "https://www.northwind-goods.com/brand/square-logo.png" }), WIDE_MARK));
  assert.equal(r.source, "page_logo");
  assert.equal(r.built.proposal.logoUrl, "https://www.northwind-goods.com/brand/square-logo.png");
});

test("logo: the fallback icon still works when no stronger identity exists, or when the stronger one fails", async () => {
  const onlyIcon = await build(page(TOUCH));
  assert.equal(onlyIcon.source, "icon");
  const failed = await build(page(TOUCH, WIDE_MARK), { fail: ["data:image/svg+xml"] });
  assert.equal(failed.source, "icon");
  assert.deepEqual(failed.tried, ["logo|inline_svg", "logo|icon"], "rank order: the mark first, then the icon");
  const nothing = await build(page(""), { fail: ["apple-touch-icon"] });
  assert.deepEqual([nothing.source, nothing.tried], [null, ["logo|conventional_icon"]], "last resort only");
});

test("logo diagnostics: provenance per verification and the selected logo's size / normalization (no URLs)", () => {
  const src = read("src/lib/brand-website-analysis.ts");
  assert.match(src, /source: brandCandidateSource\(url, role, sourceProfile, sourceFinalUrl\),/);
  assert.match(src, /logoDetail: \(\(\) => \{/);
  assert.match(src, /normalized: img\?\.normalized \?\? null,/);
  assert.match(src, /category: !p\.categoryId \? "none" : built\.fields\.category \? "schema" : "ai",/);
  assert.match(read("src/lib/brand-images.ts"), /normalized = "dark_plate";/);
});

// ── CATEGORY ──────────────────────────────────────────────────────────────

const FASHION = "bcf434ba-5f5b-43f8-92c3-58765bbe9ddf";
const CATEGORIES = [
  { id: FASHION, slug: "fashion-apparel", name: "Fashion & Apparel" },
  { id: "e73b15b6-bd5c-4510-b9c2-956a3fc5c073", slug: "jewelry-accessories", name: "Jewelry & Accessories" },
  { id: "22222222-2222-4222-8222-222222222207", slug: "food-drink", name: "Food & Drink" },
];
const aiReturning = (categoryId) => {
  const seen = [];
  return {
    seen,
    enrich: async (input) => (seen.push(input), { result: { categoryId, shortDescription: null, about: null }, called: true, usage: null }),
  };
};

test("category: schema.org evidence wins and the AI isn't asked for it", async () => {
  const r = await build(page(ld({ "@type": "ClothingStore", name: "Northwind", description: "Northwind is a New York label making ready-to-wear clothing and leather goods." })));
  assert.equal(r.built.proposal.categoryId, FASHION);
  assert.equal(r.built.ai.status, "skipped", "schema category + a useful description → no AI call");
});

test("category: the grounded AI chooses ONLY from the existing categories it is given", async () => {
  const ai = aiReturning(FASHION);
  const r = await build(page('<meta name="description" content="Shop the official Northwind site.">', "<main><h1>New Season Ready-to-Wear</h1><h2>Handbags</h2></main>"), { enrich: ai.enrich });
  assert.equal(r.built.proposal.categoryId, FASHION);
  assert.deepEqual(ai.seen[0].categories.map((c) => c.id), CATEGORIES.map((c) => c.id), "the existing taxonomy is the whole choice");
  assert.ok(ai.seen[0].excerpt.headings.includes("New Season Ready-to-Wear"), "grounded in the page's own text");
  // An invented / unknown category never survives the sanitizer.
  assert.equal(AI.sanitizeBrandAiOutput({ category_id: "luxury-fashion-house" }, CATEGORIES.map((c) => c.id), "Northwind").categoryId, null);
  assert.equal(AI.sanitizeBrandAiOutput({ category_id: "00000000-0000-4000-8000-000000000000" }, CATEGORIES.map((c) => c.id), "Northwind").categoryId, null);
  // …and the model's own output schema is an enum of the existing ids.
  const calls = [];
  const client = { messages: { parse: async (req) => (calls.push(req), { stop_reason: "end_turn", parsed_output: { category_id: "invented", short_description: null, about: null }, usage: null, model: "m" }) } };
  const out = await AI.enrichBrandWithAi({ brandName: "Northwind", website: "https://northwind-goods.com", excerpt: r.profile.excerpt, categories: CATEGORIES }, client);
  assert.equal(out.result.categoryId, null);
  assert.match(calls[0].messages[0].content, /Allowed categories \(id: name\):\nbcf434ba-5f5b-43f8-92c3-58765bbe9ddf: Fashion & Apparel/);
});

test("category: insufficient evidence (AI returns none, fails, or is unavailable) leaves it blank", async () => {
  for (const enrich of [aiReturning(null).enrich, async () => ({ result: null, called: true, usage: null }), async () => ({ result: null, called: false, usage: null })]) {
    const r = await build(page("<title>Northwind</title>"), { enrich });
    assert.equal(r.built.proposal.categoryId, null);
  }
});

test("category: an inferred existing category survives proposal → signed draft → Review", async () => {
  const SECRET = "x".repeat(48);
  const ai = aiReturning(FASHION);
  const html = page('<meta name="description" content="Shop the official Northwind site.">', "<main><h1>Ready-to-Wear</h1></main>");
  const deps = {
    fetchHtml: async () => ({ ok: true, url: SITE, html, bytes: html.length, redirects: 0, truncated: false, declaredBytes: null, contentType: "text/html" }),
    findMatches: async () => [],
    listCategories: async () => CATEGORIES,
    isRateLimited: () => false,
    enrich: ai.enrich,
    verifyImage: async () => false,
    draftsEnabled: true,
    acquireSlot: () => () => {},
    cache: A.createExtractionCache(),
    log: () => {},
    now: () => 1_000_000,
  };
  const r = await A.analyzeBrandWebsite({ website: "northwind-goods.com", userId: "11111111-1111-4111-8111-111111111111", ip: "203.0.113.7" }, deps);
  assert.equal(r.outcome, "prefilled");
  assert.equal(r.draft.cat, FASHION);
  const token = D.signBrandDraft(r.draft, "11111111-1111-4111-8111-111111111111", 1_000_000, SECRET);
  assert.ok(token);
  assert.equal(D.verifyBrandDraft(token, "11111111-1111-4111-8111-111111111111", 1_000_000, SECRET).cat, FASHION, "the signed draft keeps it");
  assert.deepEqual(D.sanitizeBrandDraftCandidate(r.draft).dropped, [], "nothing is dropped as invalid");
  // The text-only fallback carries it too.
  assert.match(r.fallbackHref, new RegExp(`category_id=${FASHION}`));
  // Review: the draft's category is the select's initial value, over the same list.
  const review = read("src/app/(public)/account/business/new/page.tsx");
  assert.match(review, /categoryId: fromDraft \? \(fromDraft\.cat \?\? ""\) : \(submittedCategoryId \?\? ""\),/);
  assert.match(review, /<select name="category_id" required defaultValue=\{values\.categoryId\}/);
  assert.match(review, /getCategories\(\)/);
  assert.match(read("src/lib/brand-website-analysis.ts"), /listCategories: async \(\) => \(await getCategories\(\)\)\.map/, "the AI chooses from that same list");
});

// ── BRAND PAGE LOGO PRESENTATION ──────────────────────────────────────────

test("brand page: the identity logo is contained (never cropped) in the same square slot; the cover still fills", () => {
  const view = read("src/app/(public)/business/[slug]/BusinessPublicView.tsx");
  const slot = view.match(/<div className="([^"]*)">\s*<SupabaseImage src=\{business\.logo_url\}([^\n]*)\/>/);
  assert.ok(slot, "the hero logo slot is present");
  // Contain semantics: a wide wordmark keeps its full width, no crop.
  assert.match(slot[2], /className="object-contain"/);
  assert.doesNotMatch(slot[2], /object-cover/);
  // Same square footprint as before — one rule for every shape, no aspect-ratio branching.
  for (const cls of ["h-24", "w-24", "sm:h-28", "sm:w-28", "rounded-2xl", "bg-white", "overflow-hidden"]) assert.ok(slot[1].split(" ").includes(cls), cls);
  assert.doesNotMatch(slot[2], /width|height|aspect/i);
  // The cover is untouched: crop/fill.
  assert.match(view, /src=\{business\.cover_image_url\}\s*alt=\{business\.name\}\s*fill\s*priority\s*sizes="\(min-width: 1024px\) 1024px, 100vw"\s*className="object-cover"/);
});
