// Event image quality guard — shared by Business Event Import (From Link),
// Admin From Link and Admin Event Link enrichment (all through
// analyzeEventUrl). A JSON-LD Event image is always kept; a page-level
// social fallback image is dropped ONLY when it is provably the site's own
// identity imagery. Fakes only — no network.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

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

const E = await import("../src/lib/event-import/engine.ts");
const X = await import("../src/lib/event-import/extract.ts");
const G = await import("../src/lib/event-import/image-guard.ts");
const SM = await import("../src/lib/event-import/structured-merge.ts");
const EX = await import("../src/lib/event-import/existing-event.ts");
const O = await import("../src/lib/event-import/operator.ts");
const read = (p) => readFileSync(p, "utf8");
const CLIENT = read("src/app/admin/(protected)/events/import/AdminEventImporter.tsx");

const NOW = Date.parse("2026-10-01T12:00:00Z");
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const LOGO = "https://www.goodamerican.com/cdn/shop/files/GA_social_share.png?v=1712345678";
const FLYER = "https://www.goodamerican.com/cdn/shop/files/nyc-popup-flyer.jpg";
/** A page with no JSON-LD Event image: dates from JSON-LD, image only from og:image. */
const eventPage = ({ og = LOGO, jsonImage = null, extraHead = "", body = "" } = {}) =>
  `<!doctype html><html><head><title>Good American NYC Pop-Up</title>${og ? `<meta property="og:image" content="${og}">` : ""}${ld({ "@type": "Event", name: "Good American NYC Pop-Up", startDate: "2026-10-15T11:00:00-04:00", endDate: "2026-10-15T18:00:00-04:00", ...(jsonImage ? { image: jsonImage } : {}), location: { "@type": "Place", name: "The Canvas", address: { "@type": "PostalAddress", streetAddress: "335 W 35th St", addressLocality: "New York", addressRegion: "NY" } } })}${extraHead}</head><body>${body}</body></html>`;
const homepage = (og) => `<!doctype html><html><head><title>Good American</title><meta property="og:image" content="${og}"></head><body>Shop denim</body></html>`;
const EVENT_URL = "https://www.goodamerican.com/pages/nyc-pop-up";

function deps(pages, over = {}) {
  const fetched = [];
  return {
    fetched,
    fetchPage: async (url) => {
      fetched.push(url.href);
      const html = pages[url.href];
      return html ? { ok: true, url, html, bytes: html.length, redirects: 0, truncated: false, declaredBytes: null } : { ok: false, code: "http_error", redirects: 0, status: 404 };
    },
    ai: null,
    matchEvent: async () => null,
    getEvent: async () => null,
    matchLocations: async () => [],
    matchOrganizer: async () => null,
    matchExistingAppearance: async () => null,
    findScheduledBySourceUrl: async () => null,
    findEventBySourceUrl: async () => null,
    isRateLimited: () => false,
    now: () => NOW,
    ...over,
  };
}
const analyze = (d, url = EVENT_URL, businessId = "biz") => E.analyzeEventUrl({ url, businessId, rateKey: "u" }, d);
beforeEach(() => E.resetEventImageGuardCache());

test("provenance is recorded: JSON-LD Event image vs. the exact social meta tag", () => {
  const u = new URL(EVENT_URL);
  assert.equal(X.extractEventCandidate(eventPage({ jsonImage: FLYER }), u, NOW).imageProvenance, "jsonld_event");
  assert.equal(X.extractEventCandidate(eventPage(), u, NOW).imageProvenance, "og:image");
  const tw = eventPage({ og: null, extraHead: `<meta name="twitter:image" content="${LOGO}">` });
  assert.equal(X.extractEventCandidate(tw, u, NOW).imageProvenance, "twitter:image");
  const secure = eventPage({ extraHead: `<meta property="og:image:secure_url" content="${FLYER}">` });
  const r = X.extractEventCandidate(secure, u, NOW);
  assert.deepEqual([r.imageProvenance, r.candidate.imageUrl], ["og:image:secure_url", FLYER], "same order as before");
});

test("1. a JSON-LD Event image is always kept — even if it is the site's share image or carries the Brand", async () => {
  const d = deps({ [EVENT_URL]: eventPage({ jsonImage: LOGO, extraHead: ld({ "@type": "Organization", name: "Good American", logo: LOGO }) }), "https://www.goodamerican.com/": homepage(LOGO) });
  const r = await analyze(d);
  assert.equal(r.candidate.imageUrl, LOGO);
  assert.equal(r.candidate.imageGuard, undefined);
  assert.deepEqual(d.fetched, [EVENT_URL], "structured Event imagery is never checked (no homepage fetch)");
});

test("2. an og:image with no evidence of being generic is kept for Review", async () => {
  const d = deps({ [EVENT_URL]: eventPage({ og: FLYER }), "https://www.goodamerican.com/": homepage(LOGO) });
  const r = await analyze(d);
  assert.equal(r.candidate.imageUrl, FLYER);
  assert.equal(r.candidate.imageGuard, undefined);
});

test("3. a fallback image equal to the Business logo the page itself declares (Organization.logo) is rejected — no network", async () => {
  const d = deps({ [EVENT_URL]: eventPage({ extraHead: ld({ "@type": "Organization", name: "Good American", url: "https://www.goodamerican.com", logo: { "@type": "ImageObject", url: LOGO } }) }) });
  const r = await analyze(d);
  assert.equal(r.candidate.imageUrl, null);
  assert.deepEqual(r.candidate.imageGuard, { ignored: "generic_site_image", provenance: "og:image", evidence: "page_logo" });
  assert.deepEqual(d.fetched, [EVENT_URL], "decided without fetching the homepage");
});

test("4. a fallback image Brand Import already read as this site's logo / cover is rejected (Admin evidence)", async () => {
  const hosts = [];
  const d = deps({ [EVENT_URL]: eventPage() }, { siteBrandImages: async (host) => (hosts.push(host), ["https://goodamerican.com/cdn/shop/files/GA_social_share.png"]) });
  const r = await analyze(d, EVENT_URL, null);
  assert.deepEqual(hosts, ["www.goodamerican.com"]);
  assert.equal(r.candidate.imageGuard?.evidence, "brand_import", "same image: www and ?v= cache-busting ignored");
  assert.equal(r.candidate.imageUrl, null);
  // Only Admin passes this evidence; the Business importer never reads Brand Import tables.
  assert.match(read("src/app/admin/(protected)/events/import/actions.ts"), /siteBrandImages: \(host\) => brandImportSiteImages\(admin, host\),/);
  assert.doesNotMatch(read("src/lib/event-import/engine.ts"), /brand_import_/);
});

test("5. the homepage's own social image: same image → rejected; fetched once per site; same document / failure → inconclusive (kept)", async () => {
  const pages = { [EVENT_URL]: eventPage(), "https://www.goodamerican.com/": homepage(LOGO) };
  const d = deps(pages);
  const r = await analyze(d);
  assert.deepEqual(r.candidate.imageGuard, { ignored: "generic_site_image", provenance: "og:image", evidence: "homepage_image" });
  // A second Event on the same site reuses the homepage reading.
  pages["https://www.goodamerican.com/pages/la-pop-up"] = eventPage();
  await analyze(d, "https://www.goodamerican.com/pages/la-pop-up");
  assert.equal(d.fetched.filter((u) => u === "https://www.goodamerican.com/").length, 1);
  // The homepage IS the same document → proves nothing → kept.
  E.resetEventImageGuardCache();
  const same = eventPage();
  const s = await analyze(deps({ [EVENT_URL]: same, "https://www.goodamerican.com/": same }));
  assert.equal(s.candidate.imageUrl, LOGO);
  // Homepage unreachable → kept.
  E.resetEventImageGuardCache();
  const f = await analyze(deps({ [EVENT_URL]: eventPage() }));
  assert.equal(f.candidate.imageUrl, LOGO);
  assert.equal(f.candidate.imageGuard, undefined);
  // The Event page is the homepage itself → no comparison.
  E.resetEventImageGuardCache();
  const home = deps({ "https://www.goodamerican.com/": eventPage() });
  await analyze(home, "https://www.goodamerican.com/");
  assert.deepEqual(home.fetched, ["https://www.goodamerican.com/"]);
});

test("6–7. no file-name or dimension guessing: a 'logo'-named or square-looking image without evidence is kept", async () => {
  const named = "https://brand.example.com/images/brand-logo-square-1080x1080.png";
  const d = deps({ "https://brand.example.com/events/launch": eventPage({ og: named }), "https://brand.example.com/": homepage("https://brand.example.com/images/home-hero.jpg") });
  const r = await analyze(d, "https://brand.example.com/events/launch");
  assert.equal(r.candidate.imageUrl, named);
  assert.equal(r.candidate.imageGuard, undefined);
  const guard = read("src/lib/event-import/image-guard.ts");
  assert.doesNotMatch(guard, /\/logo\/i|includes\("logo"\)|width|height/i);
});

test("8. a rejected image becomes NO image — never another page image — with a clear warning", async () => {
  const d = deps({ [EVENT_URL]: eventPage({ body: `<img src="https://www.goodamerican.com/cdn/shop/files/random-banner.jpg">` }), "https://www.goodamerican.com/": homepage(LOGO) });
  const r = await analyze(d);
  assert.equal(r.candidate.imageUrl, null);
  assert.equal(r.candidate.sources.image, undefined);
  assert.ok(r.warnings.includes(G.GENERIC_IMAGE_WARNING));
  assert.match(G.GENERIC_IMAGE_WARNING, /^No Event Image Found\. Generic Brand\/Site Image Ignored/);
});

test("image identity: https/http, www and query on image files ignored; different images stay different", () => {
  assert.equal(G.imageIdentity("https://www.x.com/a/b.png?v=1"), G.imageIdentity("http://x.com/a/b.png?width=1200"));
  assert.notEqual(G.imageIdentity("https://x.com/a/b.png"), G.imageIdentity("https://x.com/a/c.png"));
  assert.notEqual(G.imageIdentity("https://x.com/img?id=1"), G.imageIdentity("https://x.com/img?id=2"), "query kept when the path isn't an image file");
  assert.equal(G.genericImageEvidence("https://x.com/a.png", {}), null);
});

test("9 + Admin: enrichment carries the guard into Review; the 616ef30e safe preview path is unchanged", () => {
  const explicit = { title: "GA", description: null, imageUrl: null, sourceUrl: EVENT_URL, platform: null, occurrences: [], online: false, organizer: null, sources: {} };
  const source = { ...explicit, imageGuard: { ignored: "generic_site_image", provenance: "og:image", evidence: "homepage_image" } };
  const m = SM.mergeSourceIntoStructured(explicit, source);
  assert.equal(m.candidate.imageUrl, null);
  assert.deepEqual(m.candidate.imageGuard, source.imageGuard);
  assert.ok(!m.filled.includes("image"));
  assert.match(CLIENT, /<span className="font-semibold text-primary">No Event Image Found<\/span> · Generic Brand\/Site Image Ignored\./);
  assert.match(CLIENT, /<VerifiedEventImagePreview url=\{review\.imageUrl\}/);
  assert.match(read("next.config.mjs"), /"img-src 'self' data: https:\/\/\*\.supabase\.co https:\/\/images\.unsplash\.com https:\/\/\*\.tally\.so"/);
});

test("10–11. Business Event Import still analyzes normally; a kept image is still saved only through recoverEventImage", async () => {
  const r = await analyze(deps({ [EVENT_URL]: eventPage({ og: FLYER }), "https://www.goodamerican.com/": homepage(LOGO) }), EVENT_URL, "biz-1");
  assert.equal(r.ok, true);
  assert.equal(r.candidate.title, "Good American NYC Pop-Up");
  assert.equal(r.candidate.imageUrl, FLYER);
  assert.match(read("src/app/(public)/account/business/[id]/import-event/actions.ts"), /const stored = await recoverEventImage\(admin, url\);/);
  assert.match(read("src/app/admin/(protected)/events/import/actions.ts"), /const stored = await recoverEventImage\(admin, url\);/);
});

test("12. Review Existing Event never removes or replaces an existing image because of the guard", async () => {
  const rejected = await analyze(deps({ [EVENT_URL]: eventPage(), "https://www.goodamerican.com/": homepage(LOGO) }));
  const review = O.operatorReviewDefaults(rejected.candidate, rejected.matches);
  assert.equal(review.imageUrl, null);
  const snap = { id: "e", name: "GA", slug: "ga", coverImageUrl: "https://x.supabase.co/existing.webp", description: null, externalUrl: null, attendanceUrl: null, organizerName: null, categoryIds: [], formatIds: [], businesses: [], occurrenceCount: 4, occurrencesWithoutLocation: 0 };
  const cmp = EX.compareExistingEvent(snap, EX.proposalFromReview(review, null));
  assert.ok(!cmp.some((c) => c.field === "image"), "no image proposal at all — the existing cover is untouched");
});
