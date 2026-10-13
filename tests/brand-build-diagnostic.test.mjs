// TEMPORARY VCL A3 root-cause diagnostics for the real Brand Build path:
// one `brand_build_diagnostic` line per Build (hosts, statuses, counts,
// source kinds, reason codes) and one `brand_review_preview` line on
// Review. These tests prove what each failure class looks like in the log
// and that the line never carries URLs, query strings, HTML or user ids.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/headers") return { url: "data:text/javascript,export const headers=async()=>new Map();export const cookies=async()=>({get(){return undefined},set(){}})", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const A = await import("../src/lib/brand-website-analysis.ts");

function run(fetchResult, { verify = async () => ({ ok: false, reason: "fetch_failed" }), drafts = true, html } = {}) {
  const diags = [];
  const deps = {
    fetchHtml: async (url) => (typeof fetchResult === "function" ? fetchResult(url) : fetchResult),
    findMatches: async () => [],
    listCategories: async () => [],
    isRateLimited: () => false,
    enrich: async () => ({ result: null, called: false, usage: null }),
    verifyImage: async () => false,
    verifyImageDetailed: verify,
    draftsEnabled: drafts,
    acquireSlot: () => () => {},
    cache: A.createExtractionCache(),
    log: () => {},
    diagnostic: (d) => diags.push(JSON.parse(JSON.stringify(d))),
    now: () => 1_000_000,
  };
  return A.analyzeBrandWebsite({ website: "brand-site.com", userId: "user-secret-id", ip: "203.0.113.9" }, deps).then((r) => ({ r, d: diags[0], raw: JSON.stringify(diags) }));
}
const noLeak = (raw) => {
  assert.doesNotMatch(raw, /https?:\/\//, "no URLs");
  assert.doesNotMatch(raw, /\?[a-z]+=/i, "no query strings");
  assert.doesNotMatch(raw, /user-secret-id|203\.0\.113\.9/, "no user id / ip");
  assert.doesNotMatch(raw, /<html|<meta|<script/i, "no HTML");
};

test("bot protection / WAF: the line shows the refusal status, media type and host — and the manual-form outcome", async () => {
  const { r, d, raw } = await run({ ok: false, code: "blocked_by_site", redirects: 1, status: 403, contentType: "text/html", host: "www.brand-site.com" });
  assert.equal(r.outcome, "blocked_by_site");
  assert.deepEqual(d.fetch, { status: 403, contentType: "text/html", finalHost: "www.brand-site.com", redirects: 1, bytes: null, size: null });
  assert.equal(d.signals, null);
  assert.deepEqual(d.verifications, []);
  noLeak(raw);
});

test("JS shell / challenge page served as 200: no metadata signals → no_metadata", async () => {
  const shell = '<!doctype html><html><head><script src="/app.js"></script></head><body><div id="root"></div></body></html>';
  const { r, d, raw } = await run({ ok: true, url: new URL("https://www.brand-site.com/"), html: shell, bytes: shell.length, redirects: 1, truncated: false, declaredBytes: null, contentType: "text/html" });
  assert.equal(r.outcome, "no_metadata");
  assert.equal(d.fetch.status, 200);
  noLeak(raw);
});

test("real page whose images all fail verification: each candidate's role, kind, host and reason are logged", async () => {
  const html = `<!doctype html><html><head><title>Brand Site</title>
    <meta property="og:title" content="Brand Site"><meta property="og:image" content="https://img.brand-cdn.com/share.jpg?token=abc">
    <link rel="apple-touch-icon" sizes="180x180" href="/touch.png"><link rel="manifest" href="/site.webmanifest">
    <script type="application/ld+json">${JSON.stringify({ "@type": "Organization", name: "Brand Site", logo: "https://img.brand-cdn.com/logo.svg" })}</script>
    </head><body><footer><a href="https://www.instagram.com/brandsite/">IG</a></footer></body></html>`;
  const { r, d, raw } = await run(
    { ok: true, url: new URL("https://www.brand-site.com/"), html, bytes: html.length, redirects: 0, truncated: false, declaredBytes: null, contentType: "text/html" },
    { verify: async (url, role) => ({ ok: false, reason: url.endsWith(".svg") ? "invalid_file" : role === "cover" ? "fetch_failed" : "unsuitable" }) }
  );
  assert.equal(r.outcome, "prefilled");
  assert.equal(d.signals.title, true);
  assert.equal(d.signals.ogImage, 1);
  assert.equal(d.signals.manifest, true);
  assert.equal(d.signals.entityLogo, true);
  assert.equal(d.signals.instagramLinks, 1);
  assert.deepEqual(d.candidates, { logo: 1, logoStrong: 0, svgLogo: 1, cover: 1, manifestUrl: true });
  const byKind = d.verifications.map((v) => `${v.role}:${v.kind}:${v.host}:${v.reason}`).sort();
  assert.deepEqual(byKind, ["cover:raster:img.brand-cdn.com:fetch_failed", "logo:raster:www.brand-site.com:unsuitable", "logo:svg:img.brand-cdn.com:invalid_file"]);
  assert.deepEqual(d.result, { logo: null, cover: false, instagram: "page" });
  assert.equal(d.instagramSearch, "disabled", "A3b flag off → search never runs");
  assert.equal(d.imagesEnabled, true);
  noLeak(raw);
});

test("drafts disabled (no BRAND_DRAFT_SECRET): images are never verified — visible as imagesEnabled:false", async () => {
  const html = '<html><head><title>Brand Site</title><meta property="og:image" content="https://img.brand-cdn.com/x.jpg"></head><body></body></html>';
  const { d } = await run({ ok: true, url: new URL("https://www.brand-site.com/"), html, bytes: html.length, redirects: 0, truncated: false, declaredBytes: null }, { drafts: false });
  assert.equal(d.imagesEnabled, false);
  assert.deepEqual(d.verifications, []);
});

test("a throwing diagnostics sink never affects the Build", async () => {
  const deps = {
    fetchHtml: async () => ({ ok: false, code: "timeout", redirects: 0 }),
    findMatches: async () => [],
    listCategories: async () => [],
    isRateLimited: () => false,
    enrich: async () => ({ result: null, called: false, usage: null }),
    verifyImage: async () => false,
    draftsEnabled: true,
    acquireSlot: () => () => {},
    cache: A.createExtractionCache(),
    log: () => {},
    diagnostic: () => {
      throw new Error("sink down");
    },
    now: () => 1,
  };
  assert.equal((await A.analyzeBrandWebsite({ website: "brand-site.com", userId: "u", ip: "1.1.1.1" }, deps)).outcome, "timeout");
});

test("Review logs whether the found logo/cover were actually shown (reason codes only)", () => {
  const page = readFileSync("src/app/(public)/account/business/new/page.tsx", "utf8");
  assert.match(page, /event: "brand_review_preview",/);
  assert.match(page, /logo: draft\?\.logo \? \(logoResult \? \(logoResult\.preview \? "shown" : logoResult\.reason\) : "not_previewed"\) : null,/);
  assert.doesNotMatch(page.slice(page.indexOf('event: "brand_review_preview"'), page.indexOf('event: "brand_review_preview"') + 600), /user\.id|draft\.logo\b(?!\))|websiteUrl/);
});
