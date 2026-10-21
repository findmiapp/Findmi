// Admin Media Enrichment — a chosen source image attached to an EXISTING
// Place / Event / Business through Findmi's existing image pipeline
// (safe fetch → real-bytes validation → storePublicImage with variants →
// the record's existing media column). Fakes only — no network, no
// database; verification, variant generation and storePublicImage are real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import sharp from "sharp";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/cache") return { url: "data:text/javascript,export const revalidatePath=(p)=>{(globalThis.__REVALIDATED??=[]).push(p)};", shortCircuit: true };
    if (specifier === "@/lib/admin/requireAdminSupabase")
      return { url: "data:text/javascript,export async function requireAdminSupabase(){const c=globalThis.__ADMIN;if(!c)throw new Error('Unauthorized');return c;}", shortCircuit: true };
    if (specifier === "@/lib/admin/auth")
      return { url: "data:text/javascript,export async function requireAdmin(){if(!globalThis.__ADMIN)throw new Error('Unauthorized')}", shortCircuit: true };
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

const E = await import("../src/lib/admin/media-enrichment.ts");
const EM = await import("../src/lib/event-import/media.ts");
const BI = await import("../src/lib/brand-images.ts");
const A = await import("../src/app/admin/(protected)/media-enrichment/actions.ts");
const read = (p) => readFileSync(p, "utf8");

const ID = "11111111-2222-4333-8444-555555555555";
const SRC = "https://www.example-venue.com/media/hero.jpg";

// A photo-like cover (gradient) and a two-tone logo — real encodable images.
async function photo(w, h) {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    raw[i] = (x * 255) / w; raw[i + 1] = (y * 255) / h; raw[i + 2] = ((x + y) * 97) % 255;
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
}
async function logo() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#ffffff"/><rect x="40" y="50" width="120" height="100" fill="#A64232"/><rect x="200" y="70" width="160" height="60" fill="#20292D"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
const fetchOk = (body, contentType) => async (url) => ({ ok: true, url: new URL(url), body, contentType, bytes: body.length, redirects: 0 });

/** Fake service-role client: one table row per table, recorded writes,
 * a storage bucket that records uploads. */
function fakeAdmin(rows) {
  const uploads = [];
  const updates = [];
  const client = {
    uploads,
    updates,
    from(table) {
      return {
        select() {
          return { eq: (_c, id) => ({ maybeSingle: async () => ({ data: rows[table]?.id === id ? rows[table] : null, error: null }) }) };
        },
        update(patch) {
          return { eq: async (_c, id) => { updates.push({ table, id, patch }); if (rows[table]?.id === id) Object.assign(rows[table], patch); return { error: null }; } };
        },
      };
    },
    storage: {
      from(bucket) {
        return {
          upload: async (path, _body, opts) => { uploads.push({ bucket, path, contentType: opts?.contentType }); return { data: { path }, error: null }; },
          remove: async () => ({ data: null, error: null }),
          getPublicUrl: (path) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
        };
      },
    },
  };
  return client;
}
/** The tool's real deps with fake transport: the existing verification and
 * storage functions run for real; only the network is faked. */
function depsWith(fetchImage, fetchPage = async () => ({ ok: false, code: "error", redirects: 0 })) {
  return {
    fetchCoverImage: fetchImage,
    fetchLogoImage: fetchImage,
    fetchSvg: fetchImage,
    fetchPage,
    storeCover: EM.storeEventImage,
    storeLogo: BI.storeBrandImage,
  };
}
const rowsFor = () => ({
  locations: { id: ID, slug: "art-house-productions", cover_image_url: null, logo_url: null },
  events: { id: ID, slug: "spooky-fest-2026", cover_image_url: null },
  businesses: { id: ID, slug: "modcup-coffee", cover_image_url: "https://proj.supabase.co/storage/v1/object/public/findmi-media/old.jpg", logo_url: null },
});

for (const [entityType, table] of [["location", "locations"], ["event", "events"], ["business", "businesses"]]) {
  test(`${entityType} cover: stored in findmi-media with variants, then written to ${table}.cover_image_url`, async () => {
    const admin = fakeAdmin(rowsFor());
    const r = await E.enrichEntityImage(admin, { entityType, entityId: ID, target: "cover", url: SRC }, depsWith(fetchOk(await photo(1600, 900), "image/jpeg")));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.column, "cover_image_url");
    assert.match(r.url, /^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/public\/findmi-media\//, "Findmi's own URL, never the source URL");
    assert.notEqual(r.url, SRC);
    // Original + the existing 160/800/1600 WebP variants, all in findmi-media.
    assert.ok(admin.uploads.every((u) => u.bucket === "findmi-media"));
    assert.ok(admin.uploads.length >= 4, `original + variants (got ${admin.uploads.length})`);
    assert.equal(admin.uploads.filter((u) => u.contentType === "image/webp").length, 3);
    // A direct image keeps its exact previous behavior; provenance records it.
    assert.equal(r.resolvedFrom, "direct");
    assert.equal(r.sourcePageUrl, null);
    assert.equal(r.resolvedImageUrl, SRC);
    assert.deepEqual(admin.updates, [{ table, id: ID, patch: { cover_image_url: r.url } }], "only the target column on the existing row");
    if (entityType === "business") assert.match(r.previousUrl, /old\.jpg$/, "reports the image it replaced");
  });
}

test("Place and Business logos go through the Brand logo verification and storage", async () => {
  for (const entityType of ["location", "business"]) {
    const admin = fakeAdmin(rowsFor());
    const r = await E.enrichEntityImage(admin, { entityType, entityId: ID, target: "logo", url: "https://www.example-venue.com/logo.png" }, depsWith(fetchOk(await logo(), "image/png")));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.column, "logo_url");
    assert.equal(admin.updates[0].patch.logo_url, r.url);
  }
});

test("request rules: invalid / non-https / internal URLs, unknown targets and missing records are refused before any fetch", async () => {
  let fetched = 0;
  const deps = depsWith(async () => { fetched++; return { ok: false, code: "error", redirects: 0 }; });
  const admin = fakeAdmin(rowsFor());
  for (const url of ["not a url", "http://www.example-venue.com/a.jpg", "https://localhost/a.jpg", "https://127.0.0.1/a.jpg", "https://10.0.0.5/a.jpg", "https://metadata.google.internal/a.jpg", "https://user:pw@example-venue.com/a.jpg", "https://example-venue.com:8443/a.jpg", "file:///etc/passwd"]) {
    const r = await E.enrichEntityImage(admin, { entityType: "location", entityId: ID, target: "cover", url }, deps);
    assert.equal(r.ok, false, url);
  }
  assert.equal((await E.enrichEntityImage(admin, { entityType: "event", entityId: ID, target: "logo", url: SRC }, deps)).ok, false, "Events have no logo");
  assert.equal((await E.enrichEntityImage(admin, { entityType: "product", entityId: ID, target: "cover", url: SRC }, deps)).ok, false);
  assert.equal((await E.enrichEntityImage(admin, { entityType: "location", entityId: "nope", target: "cover", url: SRC }, deps)).ok, false);
  const missing = await E.enrichEntityImage(admin, { entityType: "location", entityId: "99999999-2222-4333-8444-555555555555", target: "cover", url: SRC }, deps);
  assert.deepEqual(missing, { ok: false, error: "That record no longer exists." });
  assert.equal(fetched, 0, "nothing fetched for a refused request");
  assert.equal(admin.updates.length + admin.uploads.length, 0, "nothing written");
});

test("non-image, unsuitable and failed remote fetches are reported per row — nothing stored, record untouched", async () => {
  const cases = [
    [fetchOk(Buffer.from("<html>not an image</html>"), "text/html"), /isn't an image, and the webpage couldn't be read/],
    [fetchOk(Buffer.from("GIF89a-but-not-really"), "image/gif"), /isn't a supported image file|couldn't be read/],
    [fetchOk(Buffer.from("%PDF-1.4 not an image"), "image/jpeg"), /isn't a supported image file/],
    [fetchOk(await photo(120, 80), "image/jpeg"), /too small or too stretched/],
    [async () => ({ ok: false, code: "timeout", redirects: 0 }), /Couldn't download/],
    [async () => ({ ok: false, code: "blocked_destination", redirects: 0 }), /webpage couldn't be read|isn't allowed/],
  ];
  for (const [fetchImage, message] of cases) {
    const admin = fakeAdmin(rowsFor());
    const r = await E.enrichEntityImage(admin, { entityType: "event", entityId: ID, target: "cover", url: SRC }, depsWith(fetchImage));
    assert.equal(r.ok, false);
    assert.match(r.error, message);
    assert.equal(admin.uploads.length + admin.updates.length, 0);
  }
});

test("repeated processing stores a fresh copy and replaces the field (same as re-uploading in the edit form); previousUrl says what it replaced", async () => {
  const admin = fakeAdmin(rowsFor());
  const deps = depsWith(fetchOk(await photo(1200, 800), "image/jpeg"));
  const first = await E.enrichEntityImage(admin, { entityType: "location", entityId: ID, target: "cover", url: SRC }, deps);
  const second = await E.enrichEntityImage(admin, { entityType: "location", entityId: ID, target: "cover", url: SRC }, deps);
  assert.equal(first.ok && second.ok, true);
  assert.equal(first.previousUrl, null);
  assert.equal(second.previousUrl, first.url);
  assert.notEqual(second.url, first.url, "server UUID path, never an overwrite");
  // The table UI never re-runs a finished row or a duplicate of an earlier row.
  const ui = read("src/app/admin/(protected)/media-enrichment/MediaEnrichmentTable.tsx");
  assert.match(ui, /if \(!row \|\| row\.status === "done" \|\| isDuplicate\(row\)\) continue;/);
});

test("Server Actions are Admin-only (fail closed before any fetch or write)", async () => {
  globalThis.__ADMIN = undefined;
  assert.deepEqual(await A.processMediaRow({ entityType: "location", entityId: ID, target: "cover", url: SRC }), { ok: false, error: "Unauthorized." });
  assert.deepEqual(await A.previewMediaRow("cover", SRC), { error: "Unauthorized." });
  const actions = read("src/app/admin/(protected)/media-enrichment/actions.ts");
  assert.match(actions, /^"use server";/);
  assert.match(actions, /admin = await requireAdminSupabase\(\);/);
  const page = read("src/app/admin/(protected)/media-enrichment/page.tsx");
  assert.match(page, /if \(!\(await isAdminSession\(\)\)\) redirect\("\/admin\/login"\);/);
  // The browser never fetches the source image and never sees privileged credentials.
  const ui = read("src/app/admin/(protected)/media-enrichment/MediaEnrichmentTable.tsx");
  assert.match(ui, /^"use client";/);
  assert.doesNotMatch(ui, /SERVICE_ROLE|getAdminSupabase|supabase-admin|<img src=\{row\.url\}/);
  assert.doesNotMatch(ui, /fetch\(row\.url|fetch\(url/);
  assert.ok(existsSync("src/app/admin/(protected)/media-enrichment/page.tsx"));
});

test("reuses the existing pipeline only — no new bucket, storage or fetch code", () => {
  const lib = read("src/lib/admin/media-enrichment.ts");
  assert.match(lib, /from "@\/lib\/event-import\/media"/);
  assert.match(lib, /from "@\/lib\/brand-images"/);
  assert.doesNotMatch(lib, /createClient\(|\bfetch\(/);
  // Its only own storage write is the small provenance sidecar next to the stored original.
  assert.deepEqual(lib.match(/\.storage\.[^\n]*/g), ['.storage.from(BUCKET).upload(path, new Blob([body], { type: "application/json" }), { contentType: "application/json", upsert: false });']);
  assert.match(lib, /\.provenance\.json/);
  assert.deepEqual(E.MEDIA_TARGETS, {
    location: { cover: "cover_image_url", logo: "logo_url" },
    event: { cover: "cover_image_url" },
    business: { cover: "cover_image_url", logo: "logo_url" },
  });
});

// ── Official webpage → representative image ──────────────────────────────

const S = await import("../src/lib/safe-fetch.ts");
const X = await import("../src/lib/event-import/extract.ts");
const PAGE = "https://www.manacontemporary.com/";
const page = (head, body = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
/** Image fetch fake that behaves like safeFetchImage: the page URL isn't an
 * image (unsupported_content); listed image URLs return bytes; anything
 * else goes to the REAL guarded fetch (which refuses blocked destinations
 * before any network). */
function imageRouter(images) {
  return async (url) => {
    if (url === PAGE || url.endsWith("/event-page")) return { ok: false, code: "unsupported_content", redirects: 0 };
    if (images[url]) return images[url](url);
    return S.safeFetchImage(url, { transport: async () => { throw new Error("network must not be reached"); } });
  };
}
const pageFetch = (html, finalUrl = PAGE) => async () => ({ ok: true, url: new URL(finalUrl), html, bytes: html.length, redirects: finalUrl === PAGE ? 0 : 1, truncated: false, declaredBytes: null });

test("resolver order: og:image:secure_url → og:image → twitter:image → JSON-LD → conservative fallback; relative URLs resolve against the page", () => {
  const base = new URL("https://venue.example.com/visit/");
  const all = X.representativePageImages(
    page(`<meta property="og:image" content="/og.jpg"><meta property="og:image:secure_url" content="https://cdn.example.com/secure.jpg"><meta name="twitter:image" content="tw.jpg"><script type="application/ld+json">{"@type":"Museum","url":"https://venue.example.com/","image":"https://cdn.example.com/ld.jpg","logo":"https://cdn.example.com/logo.png"}</script>`),
    base
  );
  assert.deepEqual(all, [
    { url: "https://cdn.example.com/secure.jpg", source: "og:image:secure_url" },
    { url: "https://venue.example.com/og.jpg", source: "og:image" },
    { url: "https://venue.example.com/visit/tw.jpg", source: "twitter:image" },
    { url: "https://cdn.example.com/ld.jpg", source: "jsonld" },
  ]);
  assert.ok(!all.some((c) => c.url.endsWith("logo.png")), "a logo is never the page image");
  // Fallback only when nothing is declared: image_src, then a large declared <img> outside header/nav/footer.
  assert.deepEqual(
    X.representativePageImages(page("", `<header><img src="/brand.png" width="800" height="800"></header><img src="/icon.png" width="32" height="32"><main><img src="hero.jpg" width="1200" height="700"></main>`), base),
    [{ url: "https://venue.example.com/visit/hero.jpg", source: "page" }]
  );
  assert.deepEqual(X.representativePageImages(page(`<link rel="image_src" href="/share.jpg">`), base), [{ url: "https://venue.example.com/share.jpg", source: "page" }]);
  assert.deepEqual(X.representativePageImages(page(`<meta property="og:image" content="http://insecure.example.com/a.jpg">`), base), [], "https only");
  assert.deepEqual(X.representativePageImages(page(`<script>document.write('<meta property="og:image" content="/js.jpg">')</script>`), base), [], "page script never runs");
});

test("an official webpage: og:image is resolved, fetched and verified like a direct image, stored with variants, written to the record — provenance kept", async () => {
  const admin = fakeAdmin(rowsFor());
  const hero = await photo(1600, 900);
  const deps = depsWith(imageRouter({ "https://www.manacontemporary.com/media/hero.jpg": fetchOk(hero, "image/jpeg") }), pageFetch(page(`<meta property="og:image" content="/media/hero.jpg">`)));
  const r = await E.enrichEntityImage(admin, { entityType: "location", entityId: ID, target: "cover", url: PAGE }, deps);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.sourcePageUrl, PAGE);
  assert.equal(r.resolvedImageUrl, "https://www.manacontemporary.com/media/hero.jpg", "relative og:image resolved against the page");
  assert.equal(r.resolvedFrom, "og:image");
  assert.match(r.url, /\/findmi-media\//, "Findmi's own stored copy, never the source image");
  assert.equal(admin.uploads.filter((u) => u.contentType === "image/webp").length, 3, "the existing variants");
  assert.deepEqual(admin.updates, [{ table: "locations", id: ID, patch: { cover_image_url: r.url } }]);
  const sidecar = admin.uploads.find((u) => u.path.endsWith(".provenance.json"));
  assert.ok(sidecar, "provenance sidecar stored next to the original");
  assert.equal(sidecar.contentType, "application/json");
});

test("og:image:secure_url wins over og:image; twitter:image is the fallback; JSON-LD after that", async () => {
  const img = fetchOk(await photo(1200, 800), "image/jpeg");
  const cases = [
    [`<meta property="og:image" content="https://cdn.example.com/plain.jpg"><meta property="og:image:secure_url" content="https://cdn.example.com/secure.jpg">`, "https://cdn.example.com/secure.jpg", "og:image:secure_url"],
    [`<meta name="twitter:image" content="https://cdn.example.com/tw.jpg">`, "https://cdn.example.com/tw.jpg", "twitter:image"],
    [`<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"Spooky Fest","url":"${PAGE}","image":{"@type":"ImageObject","contentUrl":"https://cdn.example.com/ld.jpg"}}</script>`, "https://cdn.example.com/ld.jpg", "jsonld"],
  ];
  for (const [head, expected, source] of cases) {
    const images = { "https://cdn.example.com/plain.jpg": img, "https://cdn.example.com/secure.jpg": img, "https://cdn.example.com/tw.jpg": img, "https://cdn.example.com/ld.jpg": img };
    const preview = await E.previewEntityImage("cover", PAGE, depsWith(imageRouter(images), pageFetch(page(head))));
    assert.equal(preview.resolvedImageUrl, expected, source);
    assert.equal(preview.resolvedFrom, source);
  }
});

test("redirects: relative images resolve against the FINAL page URL", async () => {
  const final = "https://manacontemporary.com/en/home/";
  const deps = depsWith(imageRouter({ "https://manacontemporary.com/en/hero.jpg": fetchOk(await photo(1200, 800), "image/jpeg") }), pageFetch(page(`<meta property="og:image" content="../hero.jpg">`), final));
  const r = await E.previewEntityImage("cover", PAGE, deps);
  assert.equal(r.sourcePageUrl, final);
  assert.equal(r.resolvedImageUrl, "https://manacontemporary.com/en/hero.jpg");
  // The page fetch itself is safe-fetch's guarded event-page profile (redirects re-validated, max 3).
  assert.match(read("src/lib/admin/media-enrichment.ts"), /fetchPage: \(url\) => safeFetchEventPage\(url\)/);
  assert.equal(S.SAFE_FETCH_MAX_REDIRECTS, 3);
});

test("unsafe page URLs are refused before any fetch; a page the guarded fetch blocks is reported", async () => {
  let pageFetches = 0;
  const deps = depsWith(imageRouter({}), async () => { pageFetches++; return { ok: false, code: "blocked_destination", redirects: 1 }; });
  for (const url of ["https://localhost/", "https://10.1.2.3/", "https://169.254.169.254/latest/meta-data/", "https://metadata.google.internal/", "http://www.manacontemporary.com/", "https://www.manacontemporary.com:8080/"]) {
    const r = await E.previewEntityImage("cover", url, deps);
    assert.ok(r.error, url);
  }
  assert.equal(pageFetches, 0);
  const blocked = await E.previewEntityImage("cover", PAGE, deps);
  assert.equal(blocked.error, "That address isn't allowed.", "e.g. a redirect to a private address");
});

test("an unsafe resolved image URL is refused by the same guarded image fetch — nothing stored", async () => {
  for (const og of ["https://127.0.0.1/a.jpg", "https://intranet.local/a.jpg", "https://metadata.google.internal/a.jpg", "https://cdn.example.com:8443/a.jpg"]) {
    const admin = fakeAdmin(rowsFor());
    const r = await E.enrichEntityImage(admin, { entityType: "event", entityId: ID, target: "cover", url: PAGE }, depsWith(imageRouter({}), pageFetch(page(`<meta property="og:image" content="${og}">`))));
    assert.equal(r.ok, false, og);
    assert.match(r.error, /The page's image couldn't be used/);
    assert.equal(admin.uploads.length + admin.updates.length, 0);
  }
});

test("a resolved resource that isn't an image is refused; a page with no acceptable image gives a useful review state", async () => {
  const notImage = depsWith(
    imageRouter({ "https://cdn.example.com/x.jpg": fetchOk(Buffer.from("<html>soft 404</html>"), "text/html") }),
    pageFetch(page(`<meta property="og:image" content="https://cdn.example.com/x.jpg">`))
  );
  const a = await E.previewEntityImage("cover", PAGE, notImage);
  assert.match(a.error, /The page's image couldn't be used: That URL didn't return an image\./);
  assert.equal(a.resolvedImageUrl, "https://cdn.example.com/x.jpg", "the resolved URL is shown for review");
  const none = await E.previewEntityImage("cover", PAGE, depsWith(imageRouter({}), pageFetch(page("<title>Mana</title>", "<p>Hello</p>"))));
  assert.match(none.error, /doesn't declare a representative image/);
  assert.equal(none.sourcePageUrl, PAGE);
  // A too-small og:image fails with the existing size rule, then the next candidate is tried.
  const next = depsWith(
    imageRouter({ "https://cdn.example.com/tiny.jpg": fetchOk(await photo(100, 60), "image/jpeg"), "https://cdn.example.com/big.jpg": fetchOk(await photo(1200, 800), "image/jpeg") }),
    pageFetch(page(`<meta property="og:image" content="https://cdn.example.com/tiny.jpg"><meta name="twitter:image" content="https://cdn.example.com/big.jpg">`))
  );
  assert.equal((await E.previewEntityImage("cover", PAGE, next)).resolvedImageUrl, "https://cdn.example.com/big.jpg");
});

test("Preview never reads or modifies the record; Process uses exactly the image the admin previewed", async () => {
  const hero = fetchOk(await photo(1600, 900), "image/jpeg");
  const deps = depsWith(imageRouter({ "https://cdn.example.com/hero.jpg": hero }), pageFetch(page(`<meta property="og:image" content="https://cdn.example.com/hero.jpg">`)));
  const preview = await E.previewEntityImage("cover", PAGE, deps);
  assert.match(preview.preview, /^data:image\/webp;base64,/);
  assert.equal(E.previewEntityImage.length >= 2, true);
  assert.doesNotMatch(read("src/app/admin/(protected)/media-enrichment/actions.ts").split("export async function previewMediaRow")[1], /requireAdminSupabase|enrichEntityImage|revalidatePath/, "no service client, no write, no revalidation in Preview");
  // Process with the confirmed resolved image: the page is not re-read; the image is verified again.
  let pageReads = 0;
  const admin = fakeAdmin(rowsFor());
  const r = await E.enrichEntityImage(
    admin,
    { entityType: "event", entityId: ID, target: "cover", url: PAGE, resolvedImageUrl: preview.resolvedImageUrl, resolvedFrom: preview.resolvedFrom },
    { ...deps, fetchPage: async () => { pageReads++; return { ok: false, code: "error", redirects: 0 }; } }
  );
  assert.equal(r.ok, true, r.error);
  assert.equal(pageReads, 0);
  assert.equal(r.resolvedImageUrl, "https://cdn.example.com/hero.jpg");
  assert.equal(r.sourcePageUrl, PAGE);
  assert.equal(r.resolvedFrom, "og:image");
  // A confirmed image URL still has to pass the URL rules.
  const bad = await E.enrichEntityImage(fakeAdmin(rowsFor()), { entityType: "event", entityId: ID, target: "cover", url: PAGE, resolvedImageUrl: "https://127.0.0.1/a.jpg" }, deps);
  assert.equal(bad.ok, false);
  // The UI sends the previewed resolution, and clears it when the URL or target changes.
  const ui = read("src/app/admin/(protected)/media-enrichment/MediaEnrichmentTable.tsx");
  assert.match(ui, /resolvedImageUrl: confirmed\?\.resolvedImageUrl \?\? null/);
  assert.match(ui, /url: e\.target\.value, preview: null, resolved: null/);
  assert.match(ui, />Source URL</);
  assert.match(ui, /Paste a direct image URL or an official webpage\. Findmi can extract the page&apos;s representative image\./);
});
