// Admin Event Import — what actually reaches the browser for images.
// The page CSP allows only Findmi / data: (+ Supabase / Unsplash / Tally)
// images, so a third-party source image URL can never be rendered: Admin
// Review renders ONLY a verified, server-made data:image/* preview, or "No
// Preview Available". The source URL stays separate, as persistence input
// for recoverEventImage. These tests render the real view and check the
// final `src`, not just the preview helper.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import sharp from "sharp";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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

const V = await import("../src/app/admin/(protected)/events/import/preview-view.ts");
const PS = await import("../src/lib/event-import/preview-src.ts");
const M = await import("../src/lib/event-import/media.ts");
const O = await import("../src/lib/event-import/operator.ts");
const P = await import("../src/lib/event-import/persist.ts");
const read = (p) => readFileSync(p, "utf8");
const CLIENT = read("src/app/admin/(protected)/events/import/AdminEventImporter.tsx");
const MULTI = read("src/app/(public)/account/business/[id]/import-event/MultiEventImport.tsx");
const ACTIONS = read("src/app/admin/(protected)/events/import/actions.ts");

const SOURCE = "https://www.goodamerican.com/cdn/shop/files/nyc-popup.jpg?v=1";
const render = (state, extra = {}) => renderToStaticMarkup(createElement(V.ImagePreviewView, { state, className: "h-20 w-28", alt: "Event image preview", ...extra }));
const srcOf = (html) => /<img[^>]*\ssrc="([^"]*)"/.exec(html)?.[1] ?? null;
const photo = () => sharp({ create: { width: 1600, height: 1000, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg().toBuffer();

test("2. the Review image renders EXACTLY the data:image/webp preview previewEventImage returned", async () => {
  const body = await photo();
  const preview = await M.previewEventImage(SOURCE, { fetchImage: async (u) => ({ ok: true, url: new URL(u), body, contentType: "image/jpeg", bytes: body.length, redirects: 0 }) });
  assert.match(preview.preview, /^data:image\/webp;base64,/);
  const src = PS.safePreviewSrc(preview.preview);
  const html = render({ status: "ok", src });
  assert.equal(srcOf(html), preview.preview, "the final <img src> is the verified preview, byte for byte");
  assert.match(html, /data-image-preview="verified"/);
  assert.doesNotMatch(html, /goodamerican\.com/);
});

test("1 + 4. a remote URL is NEVER rendered — even if it reached the state — and a failed preview shows No Preview Available", () => {
  for (const forged of [SOURCE, "http://example.com/a.png", "//cdn.example.com/a.png", "javascript:alert(1)", "data:text/html;base64,PGgxPg==", ""]) {
    const html = render({ status: "ok", src: forged });
    assert.equal(srcOf(html), null, `no <img> for ${forged || "(empty)"}`);
    assert.match(html, /No Preview Available/);
  }
  const failed = render({ status: "failed", reason: "it’s too small or the wrong shape for an Event image" });
  assert.equal(srcOf(failed), null);
  assert.match(failed, /No Preview Available: it’s too small or the wrong shape for an Event image\. Saving checks the image again; if it fails then, no image is saved\./);
  assert.match(failed, /data-image-preview="none"/);
  const loading = render({ status: "loading" });
  assert.equal(srcOf(loading), null);
  assert.match(loading, /Checking image…/);
  assert.match(render({ status: "failed", reason: "x" }, { compact: true }), />No Preview</);
  // The decode-error path also lands on No Preview Available.
  assert.match(CLIENT, /onError=\{\(\) => \{\n\s+const failed: ImagePreviewState = \{ status: "failed", reason: "the preview couldn’t be displayed" \};/);
});

test("safePreviewSrc accepts only server-made data:image (webp/png/jpeg) base64 URIs", () => {
  assert.equal(PS.safePreviewSrc("data:image/webp;base64,UklGRg=="), "data:image/webp;base64,UklGRg==");
  assert.equal(PS.safePreviewSrc("data:image/svg+xml;base64,PHN2Zz4="), null, "no SVG");
  assert.equal(PS.safePreviewSrc(SOURCE), null);
  assert.equal(PS.safePreviewSrc(null), null);
  assert.equal(PS.safePreviewSrc(`data:image/webp;base64,${"A".repeat(300_000)}`), null, "bounded");
});

test("3. the source URL stays separate: Review keeps it for saving, and saving sends IT (not the preview) to recoverEventImage", async () => {
  const candidate = { title: "Good American NYC Pop-Up", description: null, imageUrl: SOURCE, sourceUrl: "https://www.goodamerican.com/pages/nyc", platform: null, origin: "text", occurrences: [{ start: "2026-10-15T15:00:00.000Z", end: "2026-10-15T22:00:00.000Z", hasTime: true, venue: { name: "The Canvas", address: null, city: "New York", state: "NY", postalCode: null }, evidence: null }], online: false, organizer: null, sources: {} };
  const review = O.operatorReviewDefaults(candidate, { event: null, locations: [], organizerBusiness: null, existingAppearance: null });
  assert.equal(review.imageUrl, SOURCE, "the persistence value is the source URL");
  const normalized = P.normalizeReview(review);
  const stored = [];
  const client = {
    from: () => {
      const c = { select: () => c, eq: () => c, is: () => c, maybeSingle: async () => ({ data: null }), insert: () => ({ select: () => ({ single: async () => ({ data: { id: "ev-1" }, error: null }), then: (cb) => cb({ data: [{ id: "o1" }] }) }) }), update: () => ({ eq: async () => ({ error: null }) }), upsert: async () => ({ error: null }), then: (cb) => cb({ data: [] }) };
      return c;
    },
  };
  await P.persistDiscoveryEvent(normalized.value, null, { admin: client, storeImage: async (u) => (stored.push(u), "https://x.supabase.co/stored.webp"), geography: async () => null, uniqueEventSlug: async () => "ga", propagateDates: async () => {}, findEventBySourceUrl: async () => null });
  assert.deepEqual(stored, [SOURCE], "recoverEventImage gets the original source URL");
  assert.match(ACTIONS, /storeImage: async \(url\) => \{\n\s+const stored = await recoverEventImage\(admin, url\);/);
  assert.doesNotMatch(CLIENT, /set\(\{ imageUrl: (?:state|preview|src)/, "a preview is never written into the review's imageUrl");
});

test("5. Events Found thumbnails in Admin use the verified preview, never the remote URL", () => {
  assert.match(MULTI, /operator \? \(\n\s+operator\.renderThumbnail\(e\.candidate\.imageUrl\)/);
  assert.match(CLIENT, /renderThumbnail: \(url\) => <VerifiedEventImagePreview url=\{url\} compact /);
  assert.match(CLIENT, /const PREVIEW_CONCURRENCY = 3;/, "a 25-Event list asks for previews a few at a time");
});

test("6. Review and Review Existing Event render only through the verified preview; no other <img> carries an Event image", () => {
  assert.match(CLIENT, /<VerifiedEventImagePreview url=\{review\.imageUrl\}/);
  assert.match(CLIENT, /\{c\.field === "image" && c\.kind !== "same" && <VerifiedEventImagePreview url=\{c\.proposed\}/);
  const imgs = [...CLIENT.matchAll(/<img\s+src=\{([^}]+)\}/g)].map((m) => m[1]);
  assert.deepEqual(imgs.sort(), ["previews.cover", "previews.logo", "verifiedPreview"], "the only raw <img> tags are verified logo/cover previews (Brand Import's, and Find Media's)");
  // Find Media's preview is the server-verified data URI, through the same filter.
  assert.match(CLIENT, /const verifiedPreview = c \? safePreviewSrc\(c\.preview\) : null;/);
  assert.match(CLIENT, /return \(\n\s+<ImagePreviewView/);
});

test("7 + 8. CSP unchanged; Business logo/cover previews stay Brand Import's verified data URIs", () => {
  assert.match(read("next.config.mjs"), /"img-src 'self' data: blob: https:\/\/\*\.supabase\.co https:\/\/images\.unsplash\.com https:\/\/\*\.tally\.so"/);
  assert.match(CLIENT, /const logo = safePreviewSrc\(r\?\.logo\.preview\);/);
  assert.match(CLIENT, /const cover = safePreviewSrc\(r\?\.cover\.preview\);/);
  assert.match(ACTIONS, /view\.proposal\.logo \? previewBrandCandidateResult\(view\.proposal\.logo, "logo"\)/);
});
