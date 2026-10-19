// Brand onboarding end-to-end recovery. Verified images must survive from
// the Build to Review to creation:
//   - one invalid draft field no longer discards the whole signed draft
//     (which used to drop every image and the About silently);
//   - a verified logo/cover is staged ONCE (Findmi storage, this user's own
//     path) and reused by Review and creation — no second/third third-party
//     fetch, no preview limiter;
//   - a CDN's content-type label is a first gate only (bytes decide);
//   - the conventional /apple-touch-icon.png is a last-resort identity;
//   - A3b also accepts a handle equal to the brand's full name.
// SYNTHETIC fixtures modelled on real site shapes (no network). Netflix /
// Ulta are NOT special-cased anywhere — these are generic page shapes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import sharp from "sharp";

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

const D = await import("../src/lib/brand-draft.ts");
const IMG = await import("../src/lib/brand-images.ts");
const A = await import("../src/lib/brand-website-analysis.ts");
const I = await import("../src/lib/brand-instagram-discovery.ts");
const read = (p) => readFileSync(p, "utf8");

const SECRET = "x".repeat(48);
const USER = "0f0e0d0c-0b0a-4908-8706-050403020100";
const OTHER = "11111111-2222-4333-8444-555555555555";
const NOW = 1_800_000_000_000;

// ── Draft: one bad field no longer loses everything ──────────────────────
test("draft: an invalid optional field is DROPPED (reported), the rest — incl. images and About — is signed", () => {
  const longUrl = `https://img.cdn-example.com/${"a".repeat(1100)}.jpg`;
  const cand = { site: "https://brand.example", name: "Brand", about: "A brand that makes things.", logo: "https://img.cdn-example.com/logo.png", cover: longUrl, sd: "x".repeat(400) };
  const { clean, dropped, unknown } = D.sanitizeBrandDraftCandidate(cand);
  assert.deepEqual(dropped.sort(), ["cover", "sd"]);
  assert.deepEqual(unknown, []);
  assert.equal(clean.logo, cand.logo);
  assert.equal(clean.about, cand.about);
  const token = D.signBrandDraft(cand, USER, NOW, SECRET);
  assert.ok(token, "signed — previously the whole draft was refused");
  const draft = D.verifyBrandDraft(token, USER, NOW, SECRET);
  assert.equal(draft.logo, cand.logo);
  assert.equal(draft.about, cand.about);
  assert.equal(draft.cover, undefined);
  // An unknown (authority-bearing) key still refuses the whole draft.
  assert.equal(D.signBrandDraft({ ...cand, plan_choice: "pro" }, USER, NOW, SECRET), null);
  // Image URLs up to 1024 chars (real CDN URLs) are kept.
  const cdn = `https://img.cdn-example.com/${"b".repeat(900)}.jpg`;
  assert.equal(D.sanitizeBrandDraftCandidate({ site: cand.site, cover: cdn }).clean.cover, cdn);
});

test("draft: staged paths are accepted only in the exact staging shape", () => {
  const ok = `brand-drafts/${USER}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`;
  assert.deepEqual(D.sanitizeBrandDraftCandidate({ site: "https://a.example", logoStaged: ok }).clean.logoStaged, ok);
  for (const bad of ["../etc/passwd", `brand-drafts/${USER}/x.svg`, `other/${USER}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`, "https://evil.example/a.png"]) {
    assert.deepEqual(D.sanitizeBrandDraftCandidate({ site: "https://a.example", logoStaged: bad }).dropped, ["logoStaged"], bad);
  }
});

// ── Staging helpers ───────────────────────────────────────────────────────
function fakeAdmin(files = {}) {
  const calls = { upload: [], download: [], remove: [], list: [] };
  const bucket = {
    upload: async (path, body, opts) => (calls.upload.push({ path, type: opts.contentType }), (files[path] = { body, type: opts.contentType }), { error: null }),
    download: async (path) => (calls.download.push(path), files[path] ? { data: new Blob([files[path].body]), error: null } : { data: null, error: { message: "nf" } }),
    getPublicUrl: (path) => ({ data: { publicUrl: `https://storage.findmi.test/${path}` } }),
    list: async (folder) => (calls.list.push(folder), { data: Object.keys(files).filter((p) => p.startsWith(`${folder}/`)).map((p) => ({ name: p.slice(folder.length + 1) })), error: null }),
    remove: async (paths) => (calls.remove.push(...paths), paths.forEach((p) => delete files[p]), { error: null }),
  };
  return { calls, files, admin: { storage: { from: () => bucket } } };
}
// A brand mark on a coloured field (a flat one-colour square is not a logo).
const png = (w, h) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 20, g: 120, b: 200, alpha: 1 } } })
    .composite([{ input: { create: { width: Math.round(w / 2), height: Math.round(h / 2), channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }, left: Math.round(w / 4), top: Math.round(h / 4) }])
    .png()
    .toBuffer();

test("staging: verified bytes go to this user's own path; load re-verifies; other users' paths are refused; clear is scoped", async () => {
  const v = await IMG.verifyRasterBytes(await png(400, 200), "image/png", "logo");
  assert.equal(v.ok, true);
  const f = fakeAdmin();
  const path = await IMG.stageBrandImage(f.admin, USER, v.image);
  assert.match(path, new RegExp(`^brand-drafts/${USER}/[0-9a-f-]{36}\\.png$`));
  assert.equal(IMG.isStagedPathFor(path, USER), true);
  assert.equal(IMG.isStagedPathFor(path, OTHER), false);
  const loaded = await IMG.loadStagedBrandImage(f.admin, USER, path, "logo");
  assert.deepEqual([loaded.width, loaded.height, loaded.validated.contentType], [400, 200, "image/png"]);
  assert.equal(await IMG.loadStagedBrandImage(f.admin, OTHER, path, "logo"), null, "another user can't use it");
  assert.equal(f.calls.download.length, 1, "refused before any download");
  // Tampered bytes at a valid path fail re-verification.
  f.files[path].body = Buffer.from("<svg onload=alert(1)>");
  assert.equal(await IMG.loadStagedBrandImage(f.admin, USER, path, "logo"), null);
  f.files[`brand-drafts/${OTHER}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`] = { body: Buffer.alloc(1) };
  await IMG.clearStagedBrandImages(f.admin, USER);
  assert.deepEqual(f.calls.remove, [path]);
  assert.ok(`brand-drafts/${OTHER}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png` in f.files, "other users untouched");
});

// ── The Build: verify once, stage, Review/creation reuse ─────────────────
const photoBytes = async () => {
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
};

function buildDeps(html, images, { finalUrl = "https://www.streamco.example/us/" } = {}) {
  const f = fakeAdmin();
  const fetches = [];
  const verifyDetailed = async (url, role) => {
    // An inline <svg> brand mark is verified locally — never a network fetch.
    if (url.startsWith("data:")) {
      const r = await IMG.fetchVerifiedBrandImage(url, role);
      return r.ok ? { ok: true, reason: null, image: r.image } : { ok: false, reason: r.reason };
    }
    fetches.push(`${role}|${new URL(url).pathname}`);
    const hit = images[new URL(url).pathname];
    if (!hit) return { ok: false, reason: "fetch_failed" };
    const r = await IMG.fetchVerifiedBrandImage(url, role, { fetchImage: async (u) => ({ ok: true, url: new URL(u), body: hit.body, contentType: hit.type, bytes: hit.body.length, redirects: 0 }) });
    return r.ok ? { ok: true, reason: null, image: r.image } : { ok: false, reason: r.reason };
  };
  const deps = {
    fetchHtml: async () => ({ ok: true, url: new URL(finalUrl), html, bytes: html.length, redirects: 2, truncated: false, declaredBytes: null, contentType: "text/html" }),
    findMatches: async () => [],
    listCategories: async () => [],
    isRateLimited: () => false,
    enrich: async () => ({ result: null, called: false, usage: null }),
    verifyImage: async () => false,
    verifyImageDetailed: verifyDetailed,
    stageVerified: (uid, image) => IMG.stageBrandImage(f.admin, uid, image),
    clearStaged: (uid) => IMG.clearStagedBrandImages(f.admin, uid),
    draftsEnabled: true,
    acquireSlot: () => () => {},
    cache: A.createExtractionCache(),
    log: () => {},
    diagnostic: () => {},
    now: () => 1_000_000,
  };
  return { deps, f, fetches };
}

// A streaming-service-shaped page: logo is inline SVG; the identity is a
// touch icon on an asset CDN served as octet-stream; the share image is a
// hero photo whose CDN URL is long and labelled image/jpg.
const LONG = `/ffe/siteui/vlv3/${"9f8e7d6c-".repeat(40)}hero_large.jpg`;
const STREAMCO = `<!doctype html><html><head><title>StreamCo - Watch TV Shows Online</title>
<meta name="description" content="Watch shows and movies anytime, anywhere.">
<meta property="og:title" content="StreamCo"><meta property="og:image" content="https://assets.streamco-cdn.example${LONG}">
<link rel="shortcut icon" href="https://assets.streamco-cdn.example/icons/favicon.ico">
<link rel="apple-touch-icon" href="https://assets.streamco-cdn.example/icons/touch.png">
</head><body><header><a href="/"><svg aria-label="StreamCo"><path d="M0 0h10"/></svg></a></header></body></html>`;

test("streaming-site shape: logo + cover verified ONCE, staged, draft carries staged paths (and survives a long CDN URL)", async () => {
  const { deps, f, fetches } = buildDeps(STREAMCO, {
    "/icons/touch.png": { body: await png(192, 192), type: "application/octet-stream" },
    [LONG]: { body: await photoBytes(), type: "image/jpg" },
  });
  const r = await A.analyzeBrandWebsite({ website: "streamco.example", userId: USER, ip: "203.0.113.1" }, deps);
  assert.equal(r.outcome, "prefilled");
  assert.match(r.draft.logoStaged, new RegExp(`^brand-drafts/${USER}/`));
  assert.match(r.draft.coverStaged, new RegExp(`^brand-drafts/${USER}/`));
  assert.equal(r.draft.logo, null, "no remote URL needed once staged");
  assert.equal(r.draft.cover, null);
  assert.deepEqual(fetches.sort(), [`cover|${LONG}`, "logo|/icons/touch.png"], "each verified image fetched exactly once");
  assert.ok(D.signBrandDraft(r.draft, USER, NOW, SECRET), "draft signs");
  // Creation reuses the staged copy (no third-party fetch).
  const logo = await IMG.loadStagedBrandImage(f.admin, USER, r.draft.logoStaged, "logo");
  const cover = await IMG.loadStagedBrandImage(f.admin, USER, r.draft.coverStaged, "cover");
  assert.deepEqual([logo.width, cover.width], [192, 1200]);
  assert.equal(fetches.length, 2);
});

// A big-retailer-shaped page: no declared icons or logo at all, an og:image
// on an image server labelled image/jpg; the site serves the conventional
// /apple-touch-icon.png.
const RETAILCO = `<!doctype html><html><head><title>RetailCo Beauty | Cosmetics, Fragrance, Skincare</title>
<meta name="description" content="Shop cosmetics, fragrance and skincare.">
<meta property="og:image" content="https://media.retailco.example/i/retailco/hero?w=1200&amp;fmt=jpg">
</head><body><div id="root"></div></body></html>`;

test("big-retailer shape: conventional touch icon becomes identity (last resort), cover from og:image", async () => {
  const { deps, fetches } = buildDeps(
    RETAILCO,
    {
      "/apple-touch-icon.png": { body: await png(180, 180), type: "image/png" },
      "/i/retailco/hero": { body: await photoBytes(), type: "image/jpg" },
    },
    { finalUrl: "https://www.retailco.example/" }
  );
  const r = await A.analyzeBrandWebsite({ website: "retailco.example", userId: USER, ip: "203.0.113.1" }, deps);
  assert.ok(r.draft.logoStaged, "identity found");
  assert.ok(r.draft.coverStaged, "cover found");
  assert.ok(fetches.includes("logo|/apple-touch-icon.png"));
});

test("a page logo that verifies means the conventional icon is never tried", async () => {
  const html = `<html><head><title>Brand</title><script type="application/ld+json">${JSON.stringify({ "@type": "Organization", name: "Brand", logo: "https://cdn.brand.example/logo.png" })}</script></head><body></body></html>`;
  const { deps, fetches } = buildDeps(html, { "/logo.png": { body: await png(400, 120), type: "image/png" } }, { finalUrl: "https://www.brand.example/" });
  await A.analyzeBrandWebsite({ website: "brand.example", userId: USER, ip: "203.0.113.1" }, deps);
  assert.deepEqual(fetches, ["logo|/logo.png"]);
});

test("nothing verifiable → no image, no staging, clear failure reasons (never an invented logo)", async () => {
  const { deps, f } = buildDeps(RETAILCO, {}, { finalUrl: "https://www.retailco.example/" });
  const diags = [];
  deps.diagnostic = (d) => diags.push(d);
  const r = await A.analyzeBrandWebsite({ website: "retailco.example", userId: USER, ip: "203.0.113.1" }, deps);
  assert.equal(r.draft.logoStaged, undefined);
  assert.equal(r.draft.coverStaged, undefined);
  assert.equal(f.calls.upload.length, 0);
  assert.ok(diags[0].verifications.every((v) => v.reason === "fetch_failed"));
  assert.deepEqual(diags[0].result.staged, { logo: false, cover: false });
});

// ── Bytes decide ──────────────────────────────────────────────────────────
test("content-type: CDN labels (image/jpg, octet-stream, mislabelled) no longer lose real images; non-images still refused", async () => {
  const jpeg = await photoBytes();
  for (const label of ["image/jpg", "image/pjpeg", "application/octet-stream", "binary/octet-stream", "image/png", "image/webp"]) {
    const r = await IMG.verifyRasterBytes(jpeg, label, "cover");
    assert.equal(r.ok, true, label);
    assert.equal(r.image.validated.contentType, "image/jpeg", "stored as what it really is");
  }
  assert.deepEqual(await IMG.verifyRasterBytes(jpeg, "text/html", "cover"), { ok: false, reason: "type_mismatch" });
  assert.deepEqual(await IMG.verifyRasterBytes(Buffer.from("<svg/>"), "application/octet-stream", "logo"), { ok: false, reason: "invalid_file" });
});

// ── Review + creation wiring ─────────────────────────────────────────────
test("Review shows the staged verified copy (no re-fetch, no limiter); creation re-hosts it, re-fetch only as fallback", () => {
  const page = read("src/app/(public)/account/business/new/page.tsx");
  assert.match(page, /const stagedUrl = \(path: string \| undefined\) => \(admin && path && isStagedPathFor\(path, user!\.id\) \? stagedBrandImageUrl\(admin, path\) : null\);/);
  assert.match(page, /const needsPreview = Boolean\(draft && \(\(draft\.logo && !logoStagedUrl\) \|\| \(draft\.cover && !coverStagedUrl\)\)\);/);
  assert.match(page, /const previewsAllowed = needsPreview && !recordBrandImagePreview\(user!\.id\);/);
  const create = read("src/app/(public)/account/business/actions.ts");
  assert.match(create, /const image = await loadStagedBrandImage\(admin, user\.id, stagedPath, role\);\s*if \(image\) return storeBrandImage\(admin, image\);/);
  assert.match(create, /await clearStagedBrandImages\(admin, user\.id\);/);
});

// ── Instagram ─────────────────────────────────────────────────────────────
test("A3b: a handle equal to the brand's full name is the brand's own (still needs title + model high; no conflicts)", () => {
  const brand = { name: "RetailCo Beauty", host: "retailco.example" };
  const hit = { url: "https://www.instagram.com/retailcobeauty/", title: "RetailCo Beauty (@retailcobeauty) • Instagram photos and videos" };
  assert.deepEqual(I.decideInstagram(brand, [hit], { handle: "retailcobeauty", confidence: "high" }), { handle: "retailcobeauty", confidence: "high", status: "found" });
  assert.equal(I.decideInstagram(brand, [hit], { handle: "retailcobeauty", confidence: "medium" }).handle, null);
  assert.equal(I.handleMatchesName("retailco", "RetailCo Beauty"), false, "a fragment of the name is not the name");
  assert.equal(I.handleMatchesName("abc", "ABC"), false, "too short to be evidence");
  assert.equal(I.instagramSearchEnabled({ ANTHROPIC_API_KEY: "k" }), false, "still OFF by default");
});
