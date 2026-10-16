// Brand Ingestion P4 — Admin review of a Ready import candidate and the
// explicit, idempotent Create Business. No network, no database: an
// in-memory candidate store and canonical Business writer with the same
// conditional-update semantics as the Supabase implementations, plus
// static guards on the real Supabase code, the actions and the pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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

const V = await import("../src/lib/admin/brand-import-review.ts");
const read = (p) => readFileSync(p, "utf8");
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── Fixtures (synthetic — never production candidates) ────────────────────
const BATCH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_BATCH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CAND = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CAT = "11111111-1111-4111-8111-111111111111";
const CAT2 = "22222222-2222-4222-8222-222222222222";
const CATS = new Set([CAT, CAT2]);
const T1 = "2026-10-12T12:00:00.000000+00:00";

const PROPOSAL = {
  site: "https://examplebrand.test",
  finalUrl: "https://www.examplebrand.test/",
  name: "Example Brand",
  cat: CAT,
  sd: "Small-batch example goods.",
  about: "An example brand used only in tests.",
  ig: "examplebrand",
  logo: "https://cdn.examplebrand.test/logo.png",
  cover: "https://cdn.examplebrand.test/cover.jpg",
  city: "Austin",
  state: "TX",
};

function candidate(over = {}) {
  return {
    id: CAND,
    batch_id: BATCH,
    status: "ready",
    proposal: structuredClone(PROPOSAL),
    updated_at: T1,
    created_business_id: null,
    matched_business_id: null,
    // Columns P4 must never touch:
    attempt_count: 2,
    submitted_input: "examplebrand.test",
    normalized_host: "examplebrand.test",
    ai_status: "used",
    ai_model: "model-x",
    ai_input_tokens: 1200,
    ai_output_tokens: 300,
    ai_estimated_cost_usd: 0.0135,
    failure_code: null,
    ...over,
  };
}

/** In-memory store with the real store's conditional semantics. */
function memoryStore(row, { failFinalize = 0 } = {}) {
  const rows = new Map([[row.id, row]]);
  let tick = 0;
  const writes = [];
  const touch = (r, patch) => {
    Object.assign(r, patch, { updated_at: `2026-10-12T12:00:0${++tick}.000000+00:00` });
    writes.push(Object.keys(patch));
  };
  const scoped = (batchId, id) => {
    const r = rows.get(id);
    return r && r.batch_id === batchId ? r : null;
  };
  return {
    rows,
    writes,
    async getCandidate(batchId, id) {
      const r = scoped(batchId, id);
      return r ? structuredClone(r) : null;
    },
    async saveProposal(batchId, id, expected, proposal) {
      const r = scoped(batchId, id);
      if (!r || r.status !== "ready" || r.updated_at !== expected) return false;
      touch(r, { proposal });
      return true;
    },
    async discard(batchId, id) {
      const r = scoped(batchId, id);
      if (!r || !["ready", "failed"].includes(r.status)) return false;
      touch(r, { status: "discarded", processing_started_at: null });
      return true;
    },
    async markExisting(batchId, id, from, businessId) {
      const r = scoped(batchId, id);
      if (!r || r.status !== from) return false;
      touch(r, { status: "existing_business", matched_business_id: businessId });
      return true;
    },
    async claimCreate(batchId, id) {
      const r = scoped(batchId, id);
      if (!r || r.status !== "ready") return false;
      touch(r, { status: "creating" });
      return true;
    },
    async finalizeCreated(batchId, id, businessId) {
      const r = scoped(batchId, id);
      if (!r || r.status !== "creating") return false;
      if (failFinalize > 0) {
        failFinalize -= 1;
        throw new Error("brand_import_review_write_failed");
      }
      touch(r, { status: "created", created_business_id: businessId });
      return true;
    },
  };
}

/** In-memory canonical Businesses (unique id + unique slug). */
function memoryBusinesses({ existing = [], failCategory = 0, failInsertOther = 0, raceInsert = false, failMedia = false } = {}) {
  const rows = new Map(existing.map((b) => [b.id, { logo_url: null, cover_image_url: null, ...b }]));
  const categories = new Map();
  const calls = { insert: 0, setCategory: 0, setMedia: 0 };
  return {
    rows,
    categories,
    calls,
    async getById(id) {
      const b = rows.get(id);
      return b ? { id: b.id, name: b.name, logo_url: b.logo_url ?? null, cover_image_url: b.cover_image_url ?? null } : null;
    },
    async isSlugTaken(slug) {
      return [...rows.values()].some((b) => b.slug === slug);
    },
    async insert(row) {
      calls.insert += 1;
      if (failInsertOther > 0) {
        failInsertOther -= 1;
        return { ok: false, conflict: "other" };
      }
      if (raceInsert) {
        // Another request inserted this same id (and slug) a moment ago.
        raceInsert = false;
        rows.set(row.id, { ...row, logo_url: null, cover_image_url: null });
        return { ok: false, conflict: "id" };
      }
      if (rows.has(row.id)) return { ok: false, conflict: "id" };
      if ([...rows.values()].some((b) => b.slug === row.slug)) return { ok: false, conflict: "slug" };
      rows.set(row.id, { ...row, logo_url: null, cover_image_url: null });
      return { ok: true };
    },
    async setCategory(id, cat) {
      calls.setCategory += 1;
      if (failCategory > 0) {
        failCategory -= 1;
        return false;
      }
      categories.set(id, cat);
      return true;
    },
    async setMedia(id, media) {
      calls.setMedia += 1;
      if (failMedia) return false;
      Object.assign(rows.get(id), media);
      return true;
    },
  };
}

function deps({ store, businesses, matches = [], images = {} } = {}) {
  const logs = [];
  const imageCalls = [];
  const matchCalls = [];
  return {
    logs,
    imageCalls,
    matchCalls,
    store,
    businesses,
    findMatches: async (input) => {
      matchCalls.push(input);
      return typeof matches === "function" ? matches(input) : matches;
    },
    importImage: async (url, role) => {
      imageCalls.push(role);
      const r = role in images ? images[role] : `https://storage.findmi.test/${role}.webp`;
      if (r instanceof Error) throw r;
      return r;
    },
    log: (e) => logs.push(e),
  };
}

const review = (over = {}) => ({
  name: "Example Brand",
  categoryId: CAT,
  website: "https://examplebrand.test",
  instagram: "@examplebrand",
  shortDescription: "Small-batch example goods.",
  about: "An example brand used only in tests.",
  useLogo: true,
  useCover: true,
  ...over,
});

// ── Review validation ─────────────────────────────────────────────────────

test("review: edits only the whitelisted fields; other proposal keys are kept", () => {
  const r = V.applyBrandReview(PROPOSAL, review({ name: "  Renamed Brand ", categoryId: CAT2, instagram: "https://instagram.com/renamed/", useLogo: false }), CATS);
  assert.ok(r.ok);
  assert.equal(r.proposal.name, "Renamed Brand");
  assert.equal(r.proposal.cat, CAT2);
  assert.equal(r.proposal.ig, "renamed");
  assert.equal(r.proposal.useLogo, false);
  assert.equal(r.proposal.useCover, true);
  for (const k of ["finalUrl", "logo", "cover", "city", "state"]) assert.equal(r.proposal[k], PROPOSAL[k], k);
});

test("review: name and website required; category must be a business category; limits enforced", () => {
  const bad = (over) => V.applyBrandReview(PROPOSAL, review(over), CATS);
  assert.equal(bad({ name: "   " }).ok, false);
  assert.equal(bad({ website: "" }).ok, false);
  assert.equal(bad({ website: "https://instagram.com/examplebrand" }).ok, false, "social page is not a Brand website");
  assert.equal(bad({ website: "javascript:alert(1)" }).ok, false);
  assert.equal(bad({ categoryId: "33333333-3333-4333-8333-333333333333" }).ok, false);
  assert.equal(bad({ instagram: "not a handle!!" }).ok, false);
  assert.equal(bad({ shortDescription: "x".repeat(161) }).ok, false);
  assert.equal(bad({ about: "x".repeat(601) }).ok, false);
  assert.equal(bad({ name: "x".repeat(201) }).ok, false);
  assert.equal(bad({ shortDescription: "x".repeat(160), about: "y".repeat(600) }).ok, true);
});

test("review: optional fields can be cleared; nothing invents geography or extra keys", () => {
  const r = V.applyBrandReview(PROPOSAL, review({ categoryId: "", instagram: "", shortDescription: "", about: "" }), CATS);
  assert.ok(r.ok);
  for (const k of ["cat", "ig", "sd", "about"]) assert.equal(k in r.proposal, false, k);
  assert.deepEqual(Object.keys(r.proposal).sort(), ["city", "cover", "finalUrl", "logo", "name", "site", "state", "useCover", "useLogo"]);
});

test("review: markup is rejected or cleaned, never stored raw", () => {
  const r = V.applyBrandReview(PROPOSAL, review({ about: "<script>alert(1)</script>" }), CATS);
  if (r.ok) assert.doesNotMatch(r.proposal.about ?? "", /[<>]/);
});

// ── Save Review ───────────────────────────────────────────────────────────

test("save: writes ONLY the proposal; status, attempts, telemetry, input, host and match preserved", async () => {
  const store = memoryStore(candidate({ matched_business_id: null }));
  const before = structuredClone(store.rows.get(CAND));
  const r = await V.saveBrandReview(BATCH, CAND, T1, review({ name: "Saved Name" }), { store, businessCategoryIds: CATS });
  assert.deepEqual(r, { outcome: "saved" });
  const after = store.rows.get(CAND);
  assert.equal(after.proposal.name, "Saved Name");
  assert.deepEqual(store.writes, [["proposal"]]);
  for (const k of Object.keys(before).filter((k) => !["proposal", "updated_at"].includes(k))) assert.deepEqual(after[k], before[k], k);
});

test("save: a stale form never overwrites a newer review", async () => {
  const store = memoryStore(candidate());
  assert.equal((await V.saveBrandReview(BATCH, CAND, T1, review({ name: "First" }), { store, businessCategoryIds: CATS })).outcome, "saved");
  const r = await V.saveBrandReview(BATCH, CAND, T1, review({ name: "Second" }), { store, businessCategoryIds: CATS });
  assert.deepEqual(r, { outcome: "stale" });
  assert.equal(store.rows.get(CAND).proposal.name, "First");
  assert.deepEqual((await V.saveBrandReview(BATCH, CAND, "", review(), { store, businessCategoryIds: CATS })).outcome, "stale");
});

test("save: only Ready candidates in THIS batch; invalid input writes nothing", async () => {
  for (const status of ["queued", "processing", "failed", "creating", "created", "existing_business", "discarded"]) {
    const store = memoryStore(candidate({ status }));
    assert.equal((await V.saveBrandReview(BATCH, CAND, T1, review(), { store, businessCategoryIds: CATS })).outcome, "not_eligible", status);
    assert.equal(store.writes.length, 0);
  }
  const store = memoryStore(candidate());
  assert.equal((await V.saveBrandReview(OTHER_BATCH, CAND, T1, review(), { store, businessCategoryIds: CATS })).outcome, "not_found");
  const invalid = await V.saveBrandReview(BATCH, CAND, T1, review({ name: "" }), { store, businessCategoryIds: CATS });
  assert.equal(invalid.outcome, "invalid");
  assert.equal(store.writes.length, 0);
});

test("save: no fetch, no AI, no Business access (static)", () => {
  const src = code("src/lib/admin/brand-import-review.ts");
  const save = src.slice(src.indexOf("export async function saveBrandReview"), src.indexOf("export async function discardBrandCandidate"));
  assert.doesNotMatch(save, /fetch|enrich|anthropic|businesses|findMatches|importImage/i);
  assert.doesNotMatch(src, /brand-ai-enrichment|safe-fetch"|anthropic/i, "the review module never calls AI or fetches pages");
});

// ── Discard ───────────────────────────────────────────────────────────────

test("discard: ready or failed → discarded; nothing deleted; telemetry kept; others refused", async () => {
  for (const status of ["ready", "failed"]) {
    const store = memoryStore(candidate({ status }));
    assert.equal(await V.discardBrandCandidate(BATCH, CAND, store), "discarded");
    const r = store.rows.get(CAND);
    assert.equal(r.status, "discarded");
    assert.equal(r.ai_input_tokens, 1200);
    assert.equal(r.attempt_count, 2);
    assert.ok(r.proposal);
  }
  for (const status of ["queued", "processing", "creating", "created", "existing_business", "discarded"]) {
    const store = memoryStore(candidate({ status }));
    assert.equal(await V.discardBrandCandidate(BATCH, CAND, store), "not_eligible", status);
  }
  assert.equal(await V.discardBrandCandidate(OTHER_BATCH, CAND, memoryStore(candidate())), "not_eligible");
});

// ── Create Business ───────────────────────────────────────────────────────

test("create: maps only identity fields; Business.id = candidate.id; pending_review; no geography/market/owner", async () => {
  const store = memoryStore(candidate());
  const businesses = memoryBusinesses();
  const d = deps({ store, businesses });
  const r = await V.createBusinessFromCandidate(BATCH, CAND, d);
  assert.equal(r.outcome, "created");
  assert.equal(r.businessId, CAND);
  const b = businesses.rows.get(CAND);
  assert.deepEqual(
    Object.keys(b).sort(),
    ["cover_image_url", "description", "id", "instagram_url", "is_demo", "logo_url", "name", "plan_tier", "publication_status", "short_description", "slug", "website_url"]
  );
  assert.equal(b.name, "Example Brand");
  assert.equal(b.slug, "example-brand");
  assert.equal(b.website_url, "https://examplebrand.test");
  assert.equal(b.instagram_url, "https://www.instagram.com/examplebrand");
  assert.equal(b.short_description, PROPOSAL.sd);
  assert.equal(b.description, PROPOSAL.about);
  assert.equal(b.publication_status, "pending_review");
  assert.equal(b.plan_tier, "free");
  assert.equal(b.is_demo, false);
  for (const k of ["city", "state", "market_id", "email", "phone", "owner_id"]) assert.equal(k in b, false, k);
  assert.equal(businesses.categories.get(CAND), CAT);
  const c = store.rows.get(CAND);
  assert.equal(c.status, "created");
  assert.equal(c.created_business_id, CAND);
  assert.equal(c.ai_input_tokens, 1200);
  assert.equal(c.attempt_count, 2);
});

test("create: final match on the REVIEWED identity links the existing Business and creates nothing", async () => {
  const store = memoryStore(candidate({ proposal: { ...PROPOSAL, finalUrl: "https://shop.examplebrand-store.test/" } }));
  const businesses = memoryBusinesses({ existing: [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "Example Brand", slug: "example-brand" }] });
  const d = deps({ store, businesses, matches: [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", slug: "example-brand", name: "Example Brand", reasons: ["website"] }] });
  const r = await V.createBusinessFromCandidate(BATCH, CAND, d);
  assert.deepEqual(r, { outcome: "existing_business", businessId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
  assert.equal(businesses.calls.insert, 0);
  assert.equal(businesses.calls.setCategory, 0);
  assert.equal(d.imageCalls.length, 0);
  assert.equal(store.rows.get(CAND).status, "existing_business");
  assert.equal(store.rows.get(CAND).matched_business_id, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  assert.equal(businesses.rows.get("dddddddd-dddd-4ddd-8ddd-dddddddddddd").name, "Example Brand", "never modified");
  // Reviewed values were matched, plus the post-redirect host.
  assert.equal(d.matchCalls[0].websiteUrl, "https://examplebrand.test");
  assert.equal(d.matchCalls[0].instagramUrl, "https://www.instagram.com/examplebrand");
  assert.equal(d.matchCalls[0].name, "Example Brand");
  assert.equal(d.matchCalls[1].websiteUrl, "https://shop.examplebrand-store.test/");
});

test("create: the candidate's own Business never counts as a match", async () => {
  const store = memoryStore(candidate({ status: "creating" }));
  const businesses = memoryBusinesses({ existing: [{ id: CAND, name: "Example Brand", slug: "example-brand" }] });
  const d = deps({ store, businesses, matches: [{ id: CAND, slug: "example-brand", name: "Example Brand", reasons: ["website"] }] });
  assert.equal((await V.createBusinessFromCandidate(BATCH, CAND, d)).outcome, "created");
});

test("create: requires a complete reviewed proposal and an eligible candidate in this batch", async () => {
  const noCat = candidate({ proposal: { ...PROPOSAL, cat: undefined } });
  delete noCat.proposal.cat;
  let r = await V.createBusinessFromCandidate(BATCH, CAND, deps({ store: memoryStore(noCat), businesses: memoryBusinesses() }));
  assert.equal(r.outcome, "invalid");
  r = await V.createBusinessFromCandidate(BATCH, CAND, deps({ store: memoryStore(candidate({ proposal: { site: "nope" } })), businesses: memoryBusinesses() }));
  assert.equal(r.outcome, "invalid");
  for (const status of ["queued", "processing", "failed", "existing_business", "discarded"]) {
    const businesses = memoryBusinesses();
    r = await V.createBusinessFromCandidate(BATCH, CAND, deps({ store: memoryStore(candidate({ status })), businesses }));
    assert.equal(r.outcome, "not_eligible", status);
    assert.equal(businesses.calls.insert, 0);
  }
  r = await V.createBusinessFromCandidate(OTHER_BATCH, CAND, deps({ store: memoryStore(candidate()), businesses: memoryBusinesses() }));
  assert.equal(r.outcome, "not_found");
});

test("create: slug collision gets the next existing-convention suffix; other Businesses untouched", async () => {
  const businesses = memoryBusinesses({
    existing: [
      { id: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1", name: "Other", slug: "example-brand" },
      { id: "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2", name: "Other 2", slug: "example-brand-2" },
    ],
  });
  const r = await V.createBusinessFromCandidate(BATCH, CAND, deps({ store: memoryStore(candidate()), businesses }));
  assert.equal(r.outcome, "created");
  assert.equal(businesses.rows.get(CAND).slug, "example-brand-3");
  assert.equal(businesses.rows.get("e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1").slug, "example-brand");
});

test("images: kept images are imported through the canonical path; removed ones are not", async () => {
  const p = { ...PROPOSAL, useLogo: true, useCover: false };
  const businesses = memoryBusinesses();
  const d = deps({ store: memoryStore(candidate({ proposal: p })), businesses });
  const r = await V.createBusinessFromCandidate(BATCH, CAND, d);
  assert.equal(r.outcome, "created");
  assert.deepEqual(d.imageCalls, ["logo"]);
  assert.equal(businesses.rows.get(CAND).logo_url, "https://storage.findmi.test/logo.webp");
  assert.equal(businesses.rows.get(CAND).cover_image_url, null);
});

test("images: a failed image never blocks or duplicates creation — warning only", async () => {
  const businesses = memoryBusinesses();
  const store = memoryStore(candidate());
  const d = deps({ store, businesses, images: { logo: null, cover: new Error("network") } });
  const r = await V.createBusinessFromCandidate(BATCH, CAND, d);
  assert.equal(r.outcome, "created");
  assert.deepEqual(r.imageWarnings.sort(), ["cover", "logo"]);
  assert.equal(businesses.calls.insert, 1);
  assert.equal(store.rows.get(CAND).status, "created");
  // setMedia failure is a warning too.
  const b2 = memoryBusinesses({ failMedia: true });
  const r2 = await V.createBusinessFromCandidate(BATCH, CAND, deps({ store: memoryStore(candidate()), businesses: b2 }));
  assert.equal(r2.outcome, "created");
  assert.deepEqual(r2.imageWarnings.sort(), ["cover", "logo"]);
});

// ── Recovery ──────────────────────────────────────────────────────────────

test("recovery A: insert failed after the claim → stays creating; retry creates exactly one Business", async () => {
  const store = memoryStore(candidate());
  const businesses = memoryBusinesses({ failInsertOther: 1 });
  assert.deepEqual(await V.createBusinessFromCandidate(BATCH, CAND, deps({ store, businesses })), { outcome: "failed", step: "insert" });
  assert.equal(store.rows.get(CAND).status, "creating");
  assert.equal(businesses.rows.size, 0);
  const r = await V.createBusinessFromCandidate(BATCH, CAND, deps({ store, businesses }));
  assert.equal(r.outcome, "created");
  assert.equal(businesses.rows.size, 1);
});

test("recovery B: Business inserted but category failed → retry finishes without a second insert", async () => {
  const store = memoryStore(candidate());
  const businesses = memoryBusinesses({ failCategory: 1 });
  assert.deepEqual(await V.createBusinessFromCandidate(BATCH, CAND, deps({ store, businesses })), { outcome: "failed", step: "category" });
  assert.equal(businesses.rows.size, 1);
  const r = await V.createBusinessFromCandidate(BATCH, CAND, deps({ store, businesses }));
  assert.equal(r.outcome, "created");
  assert.equal(r.recovered, true);
  assert.equal(businesses.calls.insert, 1);
  assert.equal(businesses.categories.get(CAND), CAT);
});

test("recovery C: finalize failed → retry finalizes; images already stored are not re-imported", async () => {
  const store = memoryStore(candidate(), { failFinalize: 1 });
  const businesses = memoryBusinesses();
  const d1 = deps({ store, businesses });
  await assert.rejects(V.createBusinessFromCandidate(BATCH, CAND, d1));
  assert.equal(store.rows.get(CAND).status, "creating");
  const d2 = deps({ store, businesses });
  const r = await V.createBusinessFromCandidate(BATCH, CAND, d2);
  assert.equal(r.outcome, "created");
  assert.equal(businesses.calls.insert, 1);
  assert.deepEqual(d2.imageCalls, [], "slots already filled are never overwritten");
  assert.equal(store.rows.get(CAND).created_business_id, CAND);
});

test("recovery D: a created candidate is display-only — a repeat submit creates nothing", async () => {
  const store = memoryStore(candidate({ status: "created", created_business_id: CAND }));
  const businesses = memoryBusinesses({ existing: [{ id: CAND, name: "Example Brand", slug: "example-brand" }] });
  const d = deps({ store, businesses });
  assert.deepEqual(await V.createBusinessFromCandidate(BATCH, CAND, d), { outcome: "already_created", businessId: CAND });
  assert.equal(businesses.calls.insert + businesses.calls.setCategory + businesses.calls.setMedia, 0);
  assert.equal(d.matchCalls.length, 0);
});

test("recovery E: concurrent submit (id already inserted) → recovers, never duplicates", async () => {
  const store = memoryStore(candidate());
  const businesses = memoryBusinesses({ raceInsert: true });
  const r = await V.createBusinessFromCandidate(BATCH, CAND, deps({ store, businesses }));
  assert.equal(r.outcome, "created");
  assert.equal(r.recovered, true);
  assert.equal(businesses.rows.size, 1);
  // A second request that lost the claim race cannot proceed.
  const late = memoryStore(candidate({ status: "created", created_business_id: CAND }));
  assert.equal((await V.createBusinessFromCandidate(BATCH, CAND, deps({ store: late, businesses }))).outcome, "already_created");
});

test("logs are safe: outcome/step/warnings only — no names, URLs, ids or proposal text", async () => {
  const d = deps({ store: memoryStore(candidate()), businesses: memoryBusinesses({ failCategory: 1 }) });
  await V.createBusinessFromCandidate(BATCH, CAND, d);
  const d2 = deps({ store: memoryStore(candidate()), businesses: memoryBusinesses(), images: { logo: null } });
  await V.createBusinessFromCandidate(BATCH, CAND, d2);
  for (const e of [...d.logs, ...d2.logs]) {
    assert.deepEqual(Object.keys(e).filter((k) => !["event", "outcome", "step", "recovered", "imageWarnings"].includes(k)), []);
    assert.doesNotMatch(JSON.stringify(e), /Example|examplebrand|cccccccc|https?:/);
  }
});

// ── Real Supabase implementations (static) ───────────────────────────────

const REVIEW_LIB = "src/lib/admin/brand-import-review.ts";
const IMPORT_DIR = "src/app/admin/(protected)/businesses/import";
const ACTIONS = `${IMPORT_DIR}/actions.ts`;
const PAGE = `${IMPORT_DIR}/[batchId]/[candidateId]/page.tsx`;
const BATCH_PAGE = `${IMPORT_DIR}/[batchId]/page.tsx`;

test("store: every transition is conditional on batch + expected status (and updated_at for saves)", () => {
  const src = code(REVIEW_LIB);
  assert.match(src, /^import "server-only";/);
  assert.match(src, /saveProposal: [\s\S]*?\.update\(\{ proposal \}\)\.eq\("id", candidateId\)\.eq\("batch_id", batchId\)\.eq\("status", "ready"\)\.eq\("updated_at", expectedUpdatedAt\)/);
  assert.match(src, /discard: [\s\S]*?\.eq\("batch_id", batchId\)\.in\("status", \["ready", "failed"\]\)/);
  assert.match(src, /claimCreate: [\s\S]*?\.update\(\{ status: "creating" \}\)\.eq\("id", candidateId\)\.eq\("batch_id", batchId\)\.eq\("status", "ready"\)/);
  assert.match(src, /finalizeCreated: [\s\S]*?\.update\(\{ status: "created", created_business_id: businessId \}\)[\s\S]*?\.eq\("status", "creating"\)/);
  // No delete of anything; no other candidate columns written.
  assert.doesNotMatch(src, /\.delete\(|\.upsert\(/);
  assert.doesNotMatch(src, /attempt_count|ai_input_tokens|submitted_input|normalized_host:/);
});

test("Business writes: insert + media update by own id + canonical category RPC only", () => {
  const src = code(REVIEW_LIB);
  const writes = [...src.matchAll(/from\("(\w+)"\)\s*\.(insert|update|delete|upsert)\(/g)].map((m) => `${m[1]}.${m[2]}`);
  assert.deepEqual([...new Set(writes)].sort(), ["businesses.insert", "businesses.update"]);
  assert.match(src, /admin\.from\("businesses"\)\.update\(media\)\.eq\("id", businessId\)/);
  assert.match(src, /admin\.rpc\("set_business_category", \{ p_business_id: businessId, p_category_id: categoryId \}\)/);
  assert.doesNotMatch(src, /business_members|business_markets|market_requests|create_owned_business|referral|membership/i);
  assert.match(src, /publication_status: "pending_review"/);
  assert.doesNotMatch(src, /publication_status: "live"/);
  assert.doesNotMatch(src, /\bcity:|\bstate:|market_id|email|phone/);
  assert.match(src, /storeBrandImage\(admin, verified\.image\)/);
  assert.match(src, /fetchVerifiedBrandImage\(url, role\)/);
});

test("actions: every P4 action verifies the admin session before any data access", () => {
  const actions = code(ACTIONS);
  assert.match(actions, /^"use server";/);
  for (const fn of ["saveBrandReviewAction", "discardBrandCandidateAction", "createBusinessFromCandidateAction"]) {
    const start = actions.indexOf(`export async function ${fn}`);
    assert.ok(start > 0, fn);
    const body = actions.slice(start, actions.indexOf("\nexport ", start + 10) === -1 ? undefined : actions.indexOf("\nexport ", start + 10));
    const guard = body.indexOf("await requireAdminSupabase()");
    assert.ok(guard > 0, `${fn} guarded`);
    for (const use of ["supabaseBrandReviewStore(", "defaultCreateBusinessDeps(", "getAllCategories(", "saveBrandReview(", "createBusinessFromCandidate(", "discardBrandCandidate("]) {
      const at = body.indexOf(use);
      assert.ok(at === -1 || at > guard, `${fn}: ${use} after the guard`);
    }
    assert.match(body, /UUID|validIds/, `${fn} validates ids`);
  }
});

test("actions never expose proposal JSON, raw errors or internals to the client", () => {
  const actions = code(ACTIONS);
  const p4 = actions.slice(actions.indexOf("// ── P4"));
  assert.doesNotMatch(p4, /JSON\.stringify|error\.message|\.details|\.proposal/);
  assert.doesNotMatch(p4, /catch \((e|err|error)\)/, "caught errors are never surfaced");
});

test("page: Ready is editable; Created/Existing/Discarded are display-only; failed has Discard; creating can finish", () => {
  const src = code(PAGE);
  assert.match(src, /const editable = status === "ready";/);
  assert.match(src, /\{editable && p && \(/);
  for (const name of ["name", "category_id", "website", "instagram", "short_description", "about", "expected_updated_at", "batch_id", "candidate_id"]) {
    assert.match(src, new RegExp(`name="${name}"`), name);
  }
  // Keep/Remove: one radio pair per image, posting use_cover / use_logo = 1 | 0.
  assert.match(src, /<input type="radio" name=\{img\.field\} value="1" defaultChecked=\{img\.keep\}/);
  assert.match(src, /<input type="radio" name=\{img\.field\} value="0" defaultChecked=\{!img\.keep\}/);
  assert.doesNotMatch(src, /name="(city|state|market|owner|email|phone|plan|referral)/, "no geography/owner/plan fields");
  assert.doesNotMatch(src, />\s*(City|State)\s*</, "no City/State controls or labels");
  assert.match(src, /status === "created" && openBusiness\(candidate\.createdBusiness, "Created"\)/);
  assert.match(src, /status === "existing_business" && openBusiness\(candidate\.matchedBusiness, "Existing On Findmi"\)/);
  assert.match(src, /Open Business/);
  assert.match(src, /status === "failed" && \([\s\S]*?Discard Candidate/);
  assert.match(src, /status === "creating" && \([\s\S]*?Finish Creating/);
  assert.match(src, /action=\{saveBrandReviewAction\}/);
  assert.match(src, /action=\{createBusinessFromCandidateAction\}/);
  assert.match(src, /discardBrandCandidateAction\.bind\(null, batchId, candidateId\)/);
  assert.match(src, /confirmMessage=/, "discard is confirmed");
  // Save Review / Create appear only inside the editable/creating branches.
  const outside = src.replace(/\{editable && p && \([\s\S]*?\n {6}\)\}/, "").replace(/\{status === "creating" && \([\s\S]*?\n {6}\)\}/, "");
  assert.doesNotMatch(outside, /Save Review|label="Create Business"/);
  assert.doesNotMatch(src, /JSON\.stringify|<pre/);
});

const D = await import("../src/lib/admin/brand-import-display.ts");

test("image review: a verified preview renders and defaults to Keep (unless the saved review removed it)", () => {
  const { items, undecided } = D.brandImageReviewItems(PROPOSAL, { cover: "data:image/webp;base64,AAA", logo: "data:image/webp;base64,BBB" });
  assert.deepEqual(items.map((i) => [i.role, i.label, i.field, i.keep]), [["cover", "Cover", "use_cover", true], ["logo", "Logo", "use_logo", true]]);
  assert.equal(items[0].preview, "data:image/webp;base64,AAA");
  assert.deepEqual(undecided, []);
  const removed = D.brandImageReviewItems({ ...PROPOSAL, useCover: false }, { cover: "data:x", logo: "data:y" });
  assert.equal(removed.items[0].keep, false);
  // Only images the candidate actually has.
  assert.deepEqual(D.brandImageReviewItems({ site: PROPOSAL.site, logo: PROPOSAL.logo }, { cover: null, logo: "data:y" }).items.map((i) => i.role), ["logo"]);
  assert.deepEqual(D.brandImageReviewItems(null, { cover: null, logo: null }), { items: [], undecided: [] });
});

test("image review: an unavailable preview never defaults to Keep; Create waits for a saved decision", () => {
  const unsaved = D.brandImageReviewItems(PROPOSAL, { cover: null, logo: "data:y" });
  assert.equal(unsaved.items.find((i) => i.role === "cover").keep, false);
  assert.equal(unsaved.items.find((i) => i.role === "cover").preview, null);
  assert.equal(unsaved.items.find((i) => i.role === "logo").keep, true);
  assert.deepEqual(unsaved.undecided, ["cover"]);
  // Saved Remove → decided; saved explicit Keep → an informed choice, kept.
  assert.deepEqual(D.brandImageReviewItems({ ...PROPOSAL, useCover: false }, { cover: null, logo: "data:y" }).undecided, []);
  const keptBlind = D.brandImageReviewItems({ ...PROPOSAL, useCover: true }, { cover: null, logo: "data:y" });
  assert.equal(keptBlind.items[0].keep, true);
  assert.deepEqual(keptBlind.undecided, []);
  // A saved review always records both flags, so the decision persists.
  const saved = V.applyBrandReview(PROPOSAL, review({ useCover: false }), CATS);
  assert.equal(saved.proposal.useCover, false);
});

test("page: previews are verified data URIs (no hotlink); unavailable is labelled; Create is gated on undecided images", () => {
  const src = code(PAGE);
  assert.match(src, /previewBrandCandidateResult\(p\.cover, "cover"\)/);
  assert.match(src, /previewBrandCandidateResult\(p\.logo, "logo"\)/);
  assert.doesNotMatch(src, /src=\{p\.(logo|cover)\}|src=\{img\.url\}/, "never hotlinks the candidate URL");
  assert.match(src, /<img src=\{img\.preview\} alt="Cover preview"/);
  assert.match(src, /<img src=\{img\.preview\} alt="Logo preview"/);
  assert.match(src, /Preview unavailable/);
  assert.match(src, /brandImageReviewItems\(p, \{ cover, logo \}\)/);
  assert.match(src, /undecidedImages\.length > 0 \? \([\s\S]*?save the review before creating[\s\S]*?\) : \(\s*<form action=\{createBusinessFromCandidateAction\}/);
});

test("page: Create Business card uses the simplified copy — no implementation details", () => {
  const src = code(PAGE);
  const card = src.slice(src.indexOf('id="create-business-heading"'), src.indexOf("Not adding this brand?"));
  assert.match(card, /Create Business/);
  assert.match(card, /Ready to add this brand to Findmi\?/);
  assert.match(card, /<dt className="text-ink\/50">Status<\/dt>\s*<dd className="text-ink">Needs Review<\/dd>/);
  assert.match(card, /<dt className="text-ink\/50">Category<\/dt>/);
  assert.match(card, /Save any edits before creating\./);
  assert.match(card, /label="Create Business"/);
  assert.doesNotMatch(card, /owner|location|market|saved<\/strong>|pending-review Business/i);
  // Create never submits the review form's fields (no implicit save).
  const createForm = card.slice(card.indexOf("<form action={createBusinessFromCandidateAction}"), card.indexOf("</form>"));
  assert.doesNotMatch(createForm, /name="(name|website|about|short_description|use_cover|use_logo)"/);
});

test("page: action hierarchy — Save in the review form, Create primary, Discard separated and destructive", () => {
  const src = code(PAGE);
  const reviewForm = src.slice(src.indexOf("<form action={saveBrandReviewAction}"), src.indexOf("</form>", src.indexOf("<form action={saveBrandReviewAction}")));
  assert.match(reviewForm, /<ReviewSubmitButton label="Save Review" pendingLabel="Saving…" wide \/>/);
  assert.match(src, /<ReviewSubmitButton label="Create Business" pendingLabel="Creating…" primary wide \/>/);
  const discardAt = src.indexOf("Not adding this brand?");
  assert.ok(discardAt > src.indexOf("create-business-heading"), "Discard comes after Create");
  assert.match(src.slice(discardAt, discardAt + 400), /<DeleteButton action=\{discard\} label="Discard Candidate"/);
  assert.match(read("src/components/admin/DeleteButton.tsx"), /text-red-600/, "Discard stays visually destructive");
});

test("batch page: Open Business for created; settled candidates link to their page", () => {
  const src = code(BATCH_PAGE);
  assert.match(src, /c\.status === "created" && c\.createdBusiness && \([\s\S]*?\/admin\/businesses\/\$\{c\.createdBusiness\.id\}[\s\S]*?Open Business/);
  assert.match(src, /c\.status !== "queued" && c\.status !== "processing" && \(/);
});

test("the review module and its client button never reach the browser bundle with secrets", () => {
  const button = read(`${IMPORT_DIR}/ReviewSubmitButton.tsx`);
  assert.match(button, /^"use client";/);
  assert.doesNotMatch(button, /supabase|brand-import|process\.env|SERVICE_ROLE/);
  const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
  const importers = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && read(f).includes("brand-import-review"));
  for (const f of importers) {
    assert.ok(f.startsWith(join("src", "app", "admin")) || f.startsWith(join("src", "lib", "admin")), f);
    assert.doesNotMatch(read(f), /^"use client";/, f);
  }
});

test("no schema migration for P4 (later, unrelated migrations never touch Brand Import or Business media)", () => {
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  const PHASE_0B = "20261012020000_business_select_privacy_boundary.sql";
  assert.ok(files.includes(PHASE_0B));
  for (const f of files.filter((f) => f > PHASE_0B)) {
    const sql = read(join("supabase/migrations", f)).replace(/--.*$/gm, "");
    assert.doesNotMatch(sql, /brand_import|public\.businesses\s*(add|alter|drop)|alter table (public\.)?businesses/i, f);
  }
});
