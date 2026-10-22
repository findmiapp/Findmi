// Brand Onboarding V1 · Pass 1 — Business matching foundation
// (src/lib/business-matching.ts). Pure normalizers, deterministic ranking,
// injection-safe bounded candidate queries, visibility safety, and the
// createMemberBusiness wiring. No network, no production DB. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    return next(specifier, context);
  },
});

const M = await import("../src/lib/business-matching.ts");

// ── Website / domain ──────────────────────────────────────────────────────
test("website: scheme, www, trailing slash, path, query, fragment and case all resolve to the same host", () => {
  for (const v of [
    "https://www.example.com",
    "https://example.com/",
    "http://example.com",
    "https://example.com/about",
    "https://example.com/about?utm_source=findmi",
    "https://Example.COM/About#team",
    "example.com",
    "www.example.com/",
    "https://example.com:443/x",
    "  https://example.com  ",
    "https://example.com.",
  ]) {
    assert.equal(M.normalizeWebsiteHost(v), "example.com", v);
  }
});

test("website: subdomains other than www are never collapsed", () => {
  assert.equal(M.normalizeWebsiteHost("https://shop.example.com"), "shop.example.com");
  assert.equal(M.normalizeWebsiteHost("events.example.com/x"), "events.example.com");
  assert.notEqual(M.normalizeWebsiteHost("shop.example.com"), M.normalizeWebsiteHost("example.com"));
  assert.notEqual(M.normalizeWebsiteHost("shop.example.com"), M.normalizeWebsiteHost("events.example.com"));
  // Only ONE leading www. is removed.
  assert.equal(M.normalizeWebsiteHost("www.www.example.com"), "www.example.com");
});

test("website: malformed / unsafe / non-identity input returns null", () => {
  for (const v of [null, undefined, "", "   ", "not a url", "localhost", "http://localhost:3000", "ftp://example.com", "javascript:alert(1)",
    "mailto:hi@example.com", "http://192.168.0.1", "https://", "https://exa mple.com", "https://ex..ample.com", "http://[::1]/"]) {
    assert.equal(M.normalizeWebsiteHost(v), null, String(v));
  }
});

test("website: shared platform hosts are never a host identity — only their exact account path is", () => {
  for (const v of ["https://instagram.com/brand", "https://www.facebook.com/brand", "linktr.ee/brand", "https://www.tiktok.com/@brand", "https://www.etsy.com/shop/brand"]) {
    assert.equal(M.normalizeWebsiteHost(v), null, v);
  }
  assert.equal(M.normalizeWebsiteIdentity("https://linktr.ee/Brand/?utm_source=ig"), "linktr.ee/brand");
  assert.equal(M.normalizeWebsiteIdentity("www.etsy.com/shop/Brand#x"), "etsy.com/shop/brand");
  assert.equal(M.normalizeWebsiteIdentity("https://linktr.ee/"), null, "bare platform host is never an identity");
  assert.equal(M.normalizeWebsiteIdentity("https://instagram.com/brand"), null, "Instagram is the Instagram signal's job");
  assert.equal(M.normalizeWebsiteIdentity("https://m.instagram.com/brand"), null);
  assert.equal(M.normalizeWebsiteIdentity("https://www.example.com/about?x=1"), "example.com");
});

// ── Instagram ─────────────────────────────────────────────────────────────
test("instagram: @handle, bare handle, URLs, www, trailing slash, query, fragment and case resolve to one handle", () => {
  for (const v of [
    "@brand",
    "brand",
    "Brand",
    "https://instagram.com/brand",
    "https://www.instagram.com/brand/",
    "https://instagram.com/brand?igsh=abc123",
    "https://www.instagram.com/brand/?utm_source=ig_web",
    "instagram.com/Brand#top",
    "www.instagram.com/brand",
    "http://instagr.am/brand",
    "https://m.instagram.com/brand/",
  ]) {
    assert.equal(M.normalizeInstagramHandle(v), "brand", v);
  }
  assert.equal(M.normalizeInstagramHandle("@the.brand_nyc"), "the.brand_nyc");
});

test("instagram: malformed, non-Instagram and non-profile input returns null (no free-text coercion)", () => {
  for (const v of [null, "", "@", "the brand", "brand!", "https://example.com/brand", "https://www.facebook.com/brand",
    "https://instagram.com/", "https://instagram.com/p/C0abc/", "https://www.instagram.com/reel/xyz", "https://instagram.com/explore",
    ".brand", "brand.", "bra..nd", "a".repeat(31), "javascript:alert(1)"]) {
    assert.equal(M.normalizeInstagramHandle(v), null, String(v));
  }
});

// ── Name + location ───────────────────────────────────────────────────────
test("name: conservative normalization — punctuation/case/spacing only, never fuzzy", () => {
  assert.equal(M.normalizeBusinessName("Joe's  Pizza!"), M.normalizeBusinessName("joe s pizza"));
  assert.equal(M.normalizeBusinessName("FREE BEAN"), M.normalizeBusinessName("free-bean"));
  assert.notEqual(M.normalizeBusinessName("Joes Pizza"), M.normalizeBusinessName("Joe's Pizza"), "no apostrophe-dropping guesswork");
  assert.notEqual(M.normalizeBusinessName("Free Bean"), M.normalizeBusinessName("Free Beans"));
  assert.notEqual(M.normalizeBusinessName("Lavazza"), M.normalizeBusinessName("Lavazza Coffee"));
});

test("location: same/compatible, incompatible and missing city/state", () => {
  assert.equal(M.isLocationCompatible({ city: "New York", state: "NY" }, { city: "new york", state: "ny" }), true);
  assert.equal(M.isLocationCompatible({ city: "New York", state: "NY" }, { city: "Brooklyn", state: "NY" }), false);
  assert.equal(M.isLocationCompatible({ city: "Portland", state: "OR" }, { city: "Portland", state: "ME" }), false);
  assert.equal(M.isLocationCompatible({ city: null, state: "NY" }, { city: "Brooklyn", state: "NY" }), true, "missing city never blocks");
  assert.equal(M.isLocationCompatible({ city: "Brooklyn", state: null }, { city: "Brooklyn", state: "NY" }), true);
  assert.equal(M.isLocationCompatible({ city: null, state: null }, { city: "Anywhere", state: "CA" }), true);
});

// ── Ranking ───────────────────────────────────────────────────────────────
let seq = 0;
const row = (over) => {
  seq += 1;
  return { id: `b${String(seq).padStart(3, "0")}`, slug: `biz-${seq}`, name: "Other Co", city: "New York", state: "NY",
    website_url: null, instagram_url: null, publication_status: "live", archived_at: null, trashed_at: null, ...over };
};

test("candidates: website outranks instagram outranks name+location; all legitimate candidates are kept", () => {
  const byName = row({ slug: "a-name", name: "Free Bean" });
  const byInsta = row({ slug: "b-insta", instagram_url: "https://instagram.com/freebean" });
  const bySite = row({ slug: "c-site", website_url: "https://www.freebean.com/menu" });
  const unrelated = row({ slug: "d-other", name: "Free Beans", website_url: "https://shop.freebean.com" });
  const out = M.rankBusinessMatches(
    { name: "Free Bean", city: "New York", state: "NY", websiteUrl: "freebean.com", instagramUrl: "@FreeBean" },
    [byName, unrelated, byInsta, bySite]
  );
  assert.deepEqual(out.map((m) => [m.slug, m.reasons]), [
    ["c-site", ["website"]],
    ["b-insta", ["instagram"]],
    ["a-name", ["name_location"]],
  ]);
});

test("candidates: deterministic — input order never changes the result; ties break by more signals, public first, then slug", () => {
  const both = row({ slug: "z-both", name: "Acme", website_url: "acme.com" });
  const siteOnlyPrivate = row({ slug: "a-private", website_url: "https://acme.com", publication_status: "pending_review" });
  const siteOnlyPublic = row({ slug: "m-public", website_url: "https://acme.com/shop" });
  const input = { name: "Acme", city: "New York", state: "NY", websiteUrl: "acme.com" };
  const a = M.rankBusinessMatches(input, [both, siteOnlyPrivate, siteOnlyPublic]).map((m) => m.slug);
  const b = M.rankBusinessMatches(input, [siteOnlyPublic, siteOnlyPrivate, both]).map((m) => m.slug);
  assert.deepEqual(a, ["z-both", "m-public", "a-private"]);
  assert.deepEqual(a, b);
});

test("candidates: same name in a different known city is not a match; Instagram on the website field still matches", () => {
  const elsewhere = row({ name: "Free Bean", city: "Chicago", state: "IL" });
  const igAsSite = row({ slug: "ig-site", website_url: "https://www.instagram.com/freebean/" });
  const out = M.rankBusinessMatches({ name: "Free Bean", city: "New York", state: "NY", instagramUrl: "freebean" }, [elsewhere, igAsSite]);
  assert.deepEqual(out.map((m) => [m.slug, m.reasons]), [["ig-site", ["instagram"]]]);
});

test("candidates: different accounts on a shared platform never match; the same account still does (old exact-URL protection kept); result limit applies", () => {
  const a = row({ website_url: "https://instagram.com/other" });
  assert.equal(M.rankBusinessMatches({ websiteUrl: "https://instagram.com/brand" }, [a]).length, 0);
  const lt = row({ slug: "lt", website_url: "https://linktr.ee/brand" });
  assert.equal(M.rankBusinessMatches({ websiteUrl: "https://linktr.ee/other" }, [lt]).length, 0);
  assert.deepEqual(M.rankBusinessMatches({ websiteUrl: "linktr.ee/Brand/" }, [lt]).map((m) => [m.slug, m.reasons]), [["lt", ["website"]]]);
  const many = Array.from({ length: 9 }, () => row({ website_url: "https://dup.example.com" }));
  assert.equal(M.rankBusinessMatches({ websiteUrl: "dup.example.com" }, many).length, M.BUSINESS_MATCH_RESULT_LIMIT);
  assert.equal(M.rankBusinessMatches({ websiteUrl: "dup.example.com" }, many, 2).length, 2);
});

test("name (Unicode): Latin diacritics, Cyrillic, CJK, Korean and Arabic names keep a meaningful identity", () => {
  assert.equal(M.normalizeBusinessName("Café Findmi"), "café findmi");
  assert.equal(M.normalizeBusinessName("CAFÉ  FINDMI!"), "café findmi");
  assert.equal(M.normalizeBusinessName("Cafe\u0301 Findmi"), "café findmi", "decomposed accent composes (NFKC)");
  assert.equal(M.normalizeBusinessName("ＣＡＦＥ"), "cafe", "full-width folds (NFKC)");
  assert.equal(M.normalizeBusinessName("Кофе"), "кофе");
  assert.equal(M.normalizeBusinessName("КОФЕ – Хаус"), "кофе хаус");
  assert.equal(M.normalizeBusinessName("東京珈琲"), "東京珈琲");
  assert.equal(M.normalizeBusinessName("東京・珈琲"), "東京 珈琲");
  assert.equal(M.normalizeBusinessName("카페"), "카페");
  assert.equal(M.normalizeBusinessName("مقهى"), "مقهى");
  assert.equal(M.normalizeBusinessName("مقهى، القاهرة"), "مقهى القاهرة");
  for (const n of ["Café Findmi", "Кофе", "東京珈琲", "카페", "مقهى"]) assert.notEqual(M.normalizeBusinessName(n), "", n);
});

test("name (Unicode): no transliteration, no cross-script or look-alike folding, no fuzzy matching", () => {
  assert.notEqual(M.normalizeBusinessName("Café"), M.normalizeBusinessName("Cafe"), "diacritics are kept");
  assert.notEqual(M.normalizeBusinessName("Кофе"), M.normalizeBusinessName("Kofe"), "no transliteration");
  assert.notEqual(M.normalizeBusinessName("Сafe"), M.normalizeBusinessName("Cafe"), "Cyrillic С ≠ Latin C (look-alikes)");
  assert.notEqual(M.normalizeBusinessName("東京珈琲"), M.normalizeBusinessName("大阪珈琲"));
  assert.notEqual(M.normalizeBusinessName("카페"), M.normalizeBusinessName("카페 서울"));
});

test("candidates: non-Latin names match only their exact equivalent, with compatible location", () => {
  const tokyo = row({ slug: "tokyo", name: "東京珈琲", city: "New York", state: "NY" });
  const cyr = row({ slug: "kofe", name: "КОФЕ", city: "New York", state: "NY" });
  const elsewhere = row({ slug: "kofe-chi", name: "Кофе", city: "Chicago", state: "IL" });
  const rows = [tokyo, cyr, elsewhere];
  assert.deepEqual(M.rankBusinessMatches({ name: "東京珈琲", city: "New York", state: "NY" }, rows).map((m) => m.slug), ["tokyo"]);
  assert.deepEqual(M.rankBusinessMatches({ name: "Кофе", city: "New York", state: "NY" }, rows).map((m) => m.slug), ["kofe"]);
  assert.equal(M.rankBusinessMatches({ name: "大阪ベーカリー", city: "New York", state: "NY" }, rows).length, 0);
  assert.equal(M.rankBusinessMatches({ name: "!!!", city: "New York", state: "NY" }, [row({ name: "???" })]).length, 0, "empty names never match");
});

test("exact-name regex: anchored, exact token sequence, flexible separators, injection-safe", () => {
  assert.equal(M.buildExactNameRegex("Joe's  Pizza!"), "^[^[:alnum:]]*joe[^[:alnum:]]+s[^[:alnum:]]+pizza[^[:alnum:]]*$");
  assert.equal(M.buildExactNameRegex("東京珈琲"), "^[^[:alnum:]]*東京珈琲[^[:alnum:]]*$");
  assert.equal(M.buildExactNameRegex("!!!"), null);
  for (const nasty of [`a.*b`, `x|y`, `(a)+[b]{2}\\d$^?`, `name.ilike.*,id.neq.0`, `100% "Best"_x`]) {
    const re = M.buildExactNameRegex(nasty);
    const body = re.slice("^[^[:alnum:]]*".length, -"[^[:alnum:]]*$".length).split("[^[:alnum:]]+");
    for (const tok of body) assert.match(tok, /^[\p{L}\p{N}\p{M}]+$/u, `${nasty} → ${tok}`);
  }
  // The regex agrees with the JS rule on what is "the same name".
  const re = new RegExp(M.buildExactNameRegex("Joe's Pizza").replaceAll("[:alnum:]", "\\p{L}\\p{N}"), "iu");
  for (const same of ["Joe's Pizza", "JOE S PIZZA", "  joe's - pizza!! "]) assert.ok(re.test(same), same);
  for (const other of ["Joe's Pizza Bar", "Best Joe's Pizza", "Joes Pizza", "Joe's Pizzas"]) assert.ok(!re.test(other), other);
});

// ── Visibility / data safety ─────────────────────────────────────────────
test("visibility: only live, non-archived, non-trashed candidates are public; every real status still blocks", () => {
  const statuses = [
    [{ publication_status: "live" }, true],
    [{ publication_status: "pending_review" }, false],
    [{ publication_status: "draft" }, false],
    [{ publication_status: "paused" }, false],
    [{ publication_status: "rejected" }, false],
    [{ publication_status: "live", archived_at: "2026-01-01" }, false],
    [{ publication_status: "live", trashed_at: "2026-01-01" }, false],
  ];
  for (const [over, isPublic] of statuses) {
    const [m] = M.rankBusinessMatches({ websiteUrl: "same.example.com" }, [row({ website_url: "same.example.com", ...over })]);
    assert.ok(m, JSON.stringify(over));
    assert.equal(m.isPublic, isPublic, JSON.stringify(over));
  }
});

function fakeAdmin(rows) {
  const calls = [];
  const builder = () => {
    const q = { filters: {} };
    const chain = {
      select: (cols) => ((q.select = cols), chain),
      eq: (c, v) => ((q.filters[c] = v), chain),
      or: (f) => ((q.or = f), chain),
      filter: (c, op, v) => ((q.filter = [c, op, v]), chain),
      order: (c) => ((q.order = c), chain),
      limit: (n) => {
        q.limit = n;
        calls.push(q);
        return Promise.resolve({ data: rows.filter((r) => !r.is_demo) });
      },
    };
    return chain;
  };
  return { admin: { from: (t) => ((calls.table = t), builder()) }, calls };
}

test("query: bounded per-signal queries, demo excluded, never the whole table", async () => {
  const { admin, calls } = fakeAdmin([row({ website_url: "freebean.com" }), row({ website_url: "freebean.com", is_demo: true })]);
  const out = await M.findBusinessMatches(admin, { name: "Free Bean", city: "New York", state: "NY", websiteUrl: "https://freebean.com", instagramUrl: "@freebean" });
  assert.equal(calls.length, 4, "website, instagram, broad name and exact name each get their own bounded query");
  for (const q of calls) {
    assert.equal(q.filters.is_demo, false);
    assert.equal(q.limit, M.BUSINESS_MATCH_CANDIDATE_QUERY_LIMIT);
    assert.ok(q.or || q.filter, "always narrowed in the database");
    assert.match(q.select, /publication_status/);
  }
  const exact = calls.find((q) => q.filter);
  assert.deepEqual(exact.filter, ["name", "imatch", M.buildExactNameRegex("Free Bean")], "exact-name query is its own filter, never inside or()");
  assert.equal(exact.or, undefined);
  assert.equal(out.length, 1);
  const none = fakeAdmin([]);
  assert.deepEqual(await M.findBusinessMatches(none.admin, { name: "!!!" }), []);
  assert.equal(none.calls.length, 0, "no usable signal → no query at all");
});

test("query safety: commas, parentheses, %, _, quotes, apostrophes, dots, backslashes never reach the or() expression", () => {
  const nasty = [
    `Joe's Café, Bar & Grill (NYC) 100% "Best"_x\\y.z`,
    `a,b.or(id.eq.1)`,
    `%_%`,
    `name.ilike.*,id.neq.0`,
  ];
  for (const name of nasty) {
    for (const f of M.buildBusinessCandidateFilters({ name, websiteUrl: `https://${"evil(1),x"}.com`, instagramUrl: `@a_b.c` })) {
      // Every filter is `column.ilike.%tok%tok%` (comma-joined only between
      // two fixed instagram/website clauses) — website/Instagram values are
      // [a-z0-9%] only; name values are Unicode letters/numbers/marks + %.
      for (const clause of f.split(",")) {
        assert.match(clause, /^(website_url|instagram_url)\.ilike\.%[a-z0-9%]+%$|^name\.ilike\.%[\p{L}\p{N}\p{M}%]+%$/u, clause);
      }
    }
  }
  assert.deepEqual(M.buildBusinessCandidateFilters({ name: "%%%", websiteUrl: "(),", instagramUrl: "''" }), []);
});

// ── Regression: createMemberBusiness wiring ───────────────────────────────
test("regression: createMemberBusiness uses the shared matcher, still blocks before create, and never reveals non-public matches", () => {
  const actions = readFileSync("src/app/(public)/account/business/actions.ts", "utf8");
  assert.match(actions, /import \{ findBusinessMatches, ownedBusinessMatch \} from "@\/lib\/business-matching";/);
  assert.doesNotMatch(actions, /findLikelyDuplicateBusiness|normalizeUrlForMatch/, "old full-table matcher removed");
  const fn = actions.slice(actions.indexOf("export async function createMemberBusiness"));
  const check = fn.indexOf("await findBusinessMatches(admin");
  assert.ok(check > -1 && check < fn.indexOf('admin.rpc("create_owned_business"'), "duplicate check runs before the atomic create");
  assert.match(fn, /duplicate\.isPublic\s*\?\s*errorRedirectUrlWithFields\(\s*CREATE_BUSINESS_PATH,\s*"We found a business that looks like a match\. Claim it instead of creating a duplicate\.",\s*\{ \.\.\.preservedFields, duplicate_slug: duplicate\.slug, duplicate_name: duplicate\.name \}/);
  const privateBranch = fn.slice(fn.indexOf(": errorRedirectUrlWithFields("), fn.indexOf("const baseSlug"));
  assert.doesNotMatch(privateBranch, /duplicate_slug|duplicate_name|duplicate\.slug|duplicate\.name/, "no private name/slug leak");
  // The page's claim banner contract is unchanged.
  const page = readFileSync("src/app/(public)/account/business/new/page.tsx", "utf8");
  assert.match(page, /href=\{`\/business\/\$\{duplicateSlug\}`\}/);
});

test("boundaries: the matcher is server-only, read-only and never touches ownership", () => {
  const src = readFileSync("src/lib/business-matching.ts", "utf8");
  assert.match(src, /^import "server-only";/);
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete|rpc)\(/);
  assert.doesNotMatch(src, /from\("(business_members|business_claim_requests)"\)/);
});
