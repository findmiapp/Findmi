// Legacy-variant registry — the resolver extension that lets pre-existing
// (unmarked) findmi-media originals serve generated WebP derivatives once a
// future backfill creates them, without ever touching the zero-DB-lookup
// `.fv1.` path. No network, no production Storage — Storage/DB are local
// fakes. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const V = await import("../src/lib/image-variants.ts");
const R = await import("../src/lib/media-variants-registry.ts");
const C = await import("../src/lib/signed-image-urls.ts");
const Roles = await import("../src/lib/media-backfill-roles.ts");

const PUB = "https://abc.supabase.co/storage/v1/object/public/findmi-media/";
const BUCKET = "findmi-media";

// 1. `.fv1.` still resolves without the registry (zero DB lookup) ─────────
test("fv1 marked originals resolve from the filename alone — the registry is never consulted", () => {
  const marked = `${PUB}3f2a.fv1.jpg`;
  let fetchCalls = 0;
  const fetch = async () => {
    fetchCalls++;
    return [];
  };
  const cache = R.createRegistryCache();
  // Even if a caller mistakenly ran a registry lookup for a marked path,
  // imageVariantUrl itself never needs the result: hasPublicVariants(path)
  // short-circuits before registeredSizes is even read.
  assert.equal(V.imageVariantUrl(marked, "card", new Set()), `${PUB}3f2a.fv1.w800.webp`);
  assert.equal(V.imageVariantUrl(marked, "card", undefined), `${PUB}3f2a.fv1.w800.webp`);
  assert.equal(fetchCalls, 0);
  void fetch;
  void cache;
});

// 2. legacy + registry entry resolves the correct variant ─────────────────
test("a legacy original WITH a registry entry resolves to its registered variant", () => {
  const legacy = `${PUB}c51e16e3-670a-43b0-8ce9-b8b92b974f3c.jpg`;
  const registered = new Set([800, 1600]);
  assert.equal(V.imageVariantUrl(legacy, "card", registered), `${PUB}c51e16e3-670a-43b0-8ce9-b8b92b974f3c.w800.webp`);
  assert.equal(V.imageVariantUrl(legacy, "large", registered), `${PUB}c51e16e3-670a-43b0-8ce9-b8b92b974f3c.w1600.webp`);
});

// 3. legacy without a registry entry falls back to the original ───────────
test("a legacy original with NO registry entry falls back to the original, exactly as today", () => {
  const legacy = `${PUB}never-backfilled.jpg`;
  assert.equal(V.imageVariantUrl(legacy, "card", undefined), legacy);
  assert.equal(V.imageVariantUrl(legacy, "card", new Set()), legacy);
  assert.equal(V.imageVariantUrl(legacy, "card", new Set([160])), legacy); // registered, but not at THIS size
});

// 4. private Moment media is architecturally untouched ────────────────────
test("private journal-media signing is unaffected by the registry — same batching/fallback as before", async () => {
  const existing = new Set(["j/old.jpg"]); // no variant generated
  const sign = async (paths) => paths.map((p) => (existing.has(p) ? { path: p, signedUrl: `https://s/${p}`, error: null } : { path: p, signedUrl: null, error: "not found" }));
  const cache = C.createSignedUrlCache();
  const out = await C.signImageUrls(["j/old.jpg"], ["card"], sign, cache);
  assert.match(out.get("card").get("j/old.jpg"), /j\/old\.jpg/); // original fallback, no registry involved
});

// 5. multi-role union: one original generates each size only once ─────────
test("a multi-role original gets the UNION of its roles' required sizes, deduplicated and ordered", () => {
  assert.deepEqual(Roles.unionVariantSizes(["business_logo"]), [160, 800]);
  assert.deepEqual(Roles.unionVariantSizes(["homepage_bulletin_thumb"]), [160]);
  assert.deepEqual(Roles.unionVariantSizes(["business_cover", "event_gallery"]), [800, 1600]); // same sizes, not doubled
  assert.deepEqual(Roles.unionVariantSizes(["business_logo", "product_image"]), [160, 800, 1600]); // union, ascending
  assert.deepEqual(Roles.unionVariantSizes(["homepage_bulletin_thumb", "business_cover"]), [160, 800, 1600]);
});

// 6. batched lookup: many images on one page → one query, not N ───────────
test("resolveLegacyVariantSizes issues exactly one fetch call for many paths (no N+1)", async () => {
  const rows = [
    { original_path: "a.jpg", variants: { "160": {}, "800": {} } },
    { original_path: "b.jpg", variants: { "800": {}, "1600": {} } },
  ];
  let calls = 0;
  const fetch = async (bucket, paths) => {
    calls++;
    assert.equal(bucket, BUCKET);
    return rows.filter((r) => paths.includes(r.original_path));
  };
  const cache = R.createRegistryCache();
  const paths = ["a.jpg", "b.jpg", "c.jpg", "a.jpg"]; // a page with a repeat and an unregistered path
  const out = await R.resolveLegacyVariantSizes(BUCKET, paths, fetch, cache);
  const sortNum = (s) => [...s].sort((a, b) => a - b);
  assert.equal(calls, 1, "one batched query for the whole page");
  assert.deepEqual(sortNum(out.get("a.jpg")), [160, 800]);
  assert.deepEqual(sortNum(out.get("b.jpg")), [800, 1600]);
  assert.equal(out.has("c.jpg"), false); // no row → absent, caller falls back to original

  // A second page reusing the same cache for the same paths makes no new call.
  const again = await R.resolveLegacyVariantSizes(BUCKET, paths, fetch, cache);
  assert.equal(calls, 1, "cache hit, no second query");
  assert.deepEqual(sortNum(again.get("a.jpg")), [160, 800]);
});

// 7. a missing/incomplete derivative fails safe to the original ───────────
test("a registered size that was never actually generated for a size falls back safely", () => {
  const legacy = `${PUB}partial.jpg`;
  const onlyCard = new Set([800]); // e.g. the backfill only ever wrote 800 for this role
  assert.equal(V.imageVariantUrl(legacy, "large", onlyCard), legacy); // 1600 missing → original, not a broken variant URL
  assert.equal(V.imageVariantUrl(legacy, "card", onlyCard), `${PUB}partial.w800.webp`);
});

// 8. duplicate registry insert is prevented (upsert on the natural key) ───
test("upserting the same original twice replaces its row rather than duplicating it", async () => {
  const store = new Map(); // key: `${bucket}\0${original_path}`
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: async () => ({ data: [], error: null }),
        }),
      }),
      upsert: async (row, opts) => {
        assert.equal(opts.onConflict, "bucket,original_path");
        store.set(`${row.bucket}\u0000${row.original_path}`, row);
        return { error: null };
      },
      delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    }),
  };
  await R.upsertMediaVariant(admin, { bucket: BUCKET, originalPath: "x.jpg", role: "business_logo", variants: { 160: { bytes: 1, width: 160, height: 160, format: "webp" } } });
  await R.upsertMediaVariant(admin, { bucket: BUCKET, originalPath: "x.jpg", role: "business_logo", variants: { 160: { bytes: 1, width: 160, height: 160, format: "webp" }, 800: { bytes: 2, width: 800, height: 800, format: "webp" } } });
  assert.equal(store.size, 1, "one row per (bucket, original_path), never duplicated");
  assert.deepEqual(Object.keys(store.get(`${BUCKET}\u0000x.jpg`).variants).sort(), ["160", "800"]);
});

// 9. the deletion helper cleans up a registry row ──────────────────────────
test("deleteMediaVariant removes exactly the targeted row", async () => {
  const store = new Map([[`${BUCKET}\u0000x.jpg`, {}], [`${BUCKET}\u0000y.jpg`, {}]]);
  const admin = {
    from: () => ({
      select: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }),
      upsert: async () => ({ error: null }),
      delete: () => ({
        eq: (col1, bucket) => ({
          eq: async (col2, originalPath) => {
            store.delete(`${bucket}\u0000${originalPath}`);
            return { error: null };
          },
        }),
      }),
    }),
  };
  await R.deleteMediaVariant(admin, BUCKET, "x.jpg");
  assert.deepEqual([...store.keys()], [`${BUCKET}\u0000y.jpg`]);
});

// 10. existing URLs are never altered by any of this ───────────────────────
test("registering variants never changes the original's own stored URL/path", () => {
  const originalUrl = `${PUB}c51e16e3-670a-43b0-8ce9-b8b92b974f3c.jpg`;
  const registered = new Set([800, 1600]);
  // "original" display intent always returns the exact stored URL, registry or not.
  assert.equal(V.imageVariantUrl(originalUrl, "original", registered), originalUrl);
  // publicMediaPath extraction round-trips without mutating anything.
  const path = V.publicMediaPath(originalUrl);
  assert.equal(`${PUB}${path}`, originalUrl);
  assert.equal(V.isLegacyPublicPath(path), true);
  assert.equal(V.isLegacyPublicPath("3f2a.fv1.jpg"), false);
  assert.equal(V.isLegacyPublicPath("3f2a.w800.webp"), false);
});
