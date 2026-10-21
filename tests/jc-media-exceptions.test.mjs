// One-off JC media exception pass: real page assets, first-party only,
// branding never used as a cover, high-confidence-only writes.
import { test } from "node:test";
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
const X = await import("../scripts/jc-media-backfill/exceptions.ts");
const SRC = readFileSync("scripts/jc-media-backfill/exceptions.ts", "utf8");
const page = new URL("https://www.battellojc.com/");

test("content assets: largest srcset, lazy data-src, Squarespace/Wix originals; nav/footer marked as chrome", () => {
  const html = `<html><body><nav><img src="/nav-photo.jpg"></nav>
    <main><section class="hero"><img alt="Dining room" srcset="/a-600.jpg 600w, /a-2000.jpg 2000w" src="/a-600.jpg"></section>
    <img data-src="https://images.squarespace-cdn.com/content/v1/abc/room.jpg" data-image-dimensions="2500x1667"></main>
    <img src="https://static.wixstatic.com/media/cb580f_x~mv2.jpg/v1/fill/w_147,h_98/x.jpg">
    <footer><img src="/footer.jpg"></footer></body></html>`;
  const c = X.contentCandidates(html, page);
  assert.equal(c.find((x) => x.url.includes("nav-photo")).inChrome, true);
  assert.equal(c.find((x) => x.url.includes("footer")).inChrome, true);
  const hero = c.find((x) => x.url.endsWith("/a-2000.jpg"));
  assert.ok(hero && hero.inMain && hero.alt === "Dining room");
  assert.ok(c.some((x) => x.url === "https://images.squarespace-cdn.com/content/v1/abc/room.jpg?format=2500w" && x.declaredMax === 2500));
  assert.ok(c.some((x) => x.url === "https://static.wixstatic.com/media/cb580f_x~mv2.jpg"), "Wix original, not the 147px thumbnail");
});

test("first-party only: the site's own domain or its site builder's CDN", () => {
  assert.equal(X.isFirstParty("https://cdn.battellojc.com/x.jpg", page, null), true);
  assert.equal(X.isFirstParty("https://images.squarespace-cdn.com/x.jpg", page, null), true);
  assert.equal(X.isFirstParty("https://www.facebook.com/tr?id=1", page, null), false);
  assert.equal(X.isFirstParty("https://stock.example.com/x.jpg", page, null), false);
  assert.equal(X.isFirstParty("https://www.nj.gov/dep/x.jpg", new URL("https://dep.nj.gov/parks/"), null), true);
});

test("covers never use branding: logos, seals, icons, SVGs, nav/footer images, the site's own logo asset", () => {
  const c = (o) => ({ source: "content", alt: "", context: "", inChrome: false, inHeader: false, inMain: true, declaredMax: 0, order: 0, ...o });
  const logos = new Set(["https://www.nimbusdance.org/images/nimbus.png"]);
  for (const bad of [
    c({ url: "https://images.getbento.com/x/batellologo.png" }),
    c({ url: "https://www.hcnj.us/wp-content/uploads/hc_sealwith-no-background.png" }),
    c({ url: "https://jcdowntown.org/wp-content/uploads/cropped-JC-icon.png" }),
    c({ url: "https://site.org/mark.svg" }),
    c({ url: "https://site.org/photo.jpg", alt: "Company logo" }),
    c({ url: "https://site.org/photo.jpg", inChrome: true }),
    c({ url: "https://www.nimbusdance.org/images/nimbus.png" }),
  ]) assert.ok(X.coverRejection(bad, logos), bad.url);
  assert.equal(X.coverRejection(c({ url: "https://jerseycityculture.org/wp-content/uploads/2026/09/Diwali-on-Hudson-2026-flyer.jpg", alt: "Diwali on Hudson 2026" }), logos), null, "an event poster with text is fine");
});

test("confidence: share/structured images and in-content hero or entity-named images score as high; stray images don't", () => {
  const c = (o) => ({ source: "content", alt: "", context: "", inChrome: false, inHeader: false, inMain: false, declaredMax: 0, order: 0, ...o });
  const tokens = X.distinctiveTokens("Diwali on Hudson 2026");
  assert.deepEqual(tokens, ["diwali", "hudson"]);
  assert.ok(X.score(c({ url: "https://x.org/a.jpg", source: "meta" }), tokens) >= 3);
  assert.ok(X.score(c({ url: "https://x.org/a.jpg", context: "div tribe-events-event-image" }), tokens) >= 3);
  assert.ok(X.score(c({ url: "https://x.org/Diwali-2026.jpg" }), tokens) >= 3);
  assert.ok(X.score(c({ url: "https://x.org/random.jpg" }), tokens) < 3, "ambiguous → stays unresolved");
});

test("writes: READY + high confidence only, empty fields only, existing pipeline + provenance; approved exclusions kept", () => {
  assert.match(SRC, /if \(s < 3\) return base\("UNRESOLVED", c\.url, page\.url\.href, `ambiguous: low-confidence/);
  assert.match(SRC, /\.update\(\{ \[t\.column\]: stored \}\)\.eq\("id", t\.id\)\.is\(t\.column, null\)/);
  assert.match(SRC, /if \(r\.status !== "READY" \|\| !r\.ready\) continue;/);
  assert.match(SRC, /await writeProvenance\(db, stored,/);
  assert.match(SRC, /storeEventImage|storeBrandImage/);
  for (const slug of ["mana-contemporary-three-works-by-athena-latocha", "jcymap-2026-celebration-art-exhibition-documentary-premiere", "cat-stick-easel-moon-closing-reception"]) assert.ok(SRC.includes(`"${slug}"`), slug);
  assert.match(SRC, /"rocky-horror-picture-show-live-shadow-cast-lsc-2026": \/rocky\[-_ \]\?horror\/i/);
  assert.match(SRC, /"jodeci-loews-jersey-2026": \/jodeci\/i/);
  assert.match(SRC, /if \(process\.env\.JC_BACKFILL_MODE === "exceptions"\)/, "never runs on import");
  const WF = readFileSync(".github/workflows/jc-media-backfill.yml", "utf8");
  assert.match(WF, /options: \[backfill, exceptions\]/);
  assert.match(WF, /if: github\.event_name == 'workflow_dispatch' && github\.event\.inputs\.confirm == 'RUN'/);
});

test("covers cleared on review are never re-resolved by either pass", () => {
  const B = readFileSync("scripts/jc-media-backfill/backfill.ts", "utf8");
  for (const slug of ["modcup-coffee-bergen-lafayette", "battello-jersey-city", "newark-avenue-pedestrian-plaza", "lincoln-park-jersey-city"]) {
    assert.ok(B.match(/EXCLUDED_PLACE_COVER_SLUGS = new Set\(\[([\s\S]*?)\]\)/)[1].includes(`"${slug}"`), `backfill ${slug}`);
    assert.ok(SRC.match(/locations: new Set\(\[([^\]]*)\]\)/)[1].includes(`"${slug}"`), `exceptions ${slug}`);
  }
  for (const slug of ["modcup-coffee", "nimbus-dance"]) {
    assert.ok(B.match(/EXCLUDED_BUSINESS_COVER_SLUGS = new Set\(\[([\s\S]*?)\]\)/)[1].includes(`"${slug}"`), `backfill ${slug}`);
    assert.ok(SRC.match(/businesses: new Set\(\[([^\]]*)\]\)/)[1].includes(`"${slug}"`), `exceptions ${slug}`);
  }
  assert.ok(B.includes('"lsc-after-dark-covens-2026"') && SRC.includes('"lsc-after-dark-covens-2026"'));
  // Only covers: logos are still eligible.
  assert.match(SRC, /if \(!b\.logo_url\) list\.push\(/);
});

