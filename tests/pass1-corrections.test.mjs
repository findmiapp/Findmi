// Pass 1 corrections —
//   1. Location discovery eligibility (Logo AND Cover): one predicate, consumer-only, never destructive.
//   2. Review semantics for Find Us Here edits: only a NEW public claim returns an entry to Pending Review;
//      single-entry and bulk edits share one rule.
//   3. No 1,000-row cap on admin counts / paging / Approve All / Decline All (the fake database caps every
//      READ at 1,000 rows, exactly like the API, so a read that silently truncates fails here).
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

const read = (p) => readFileSync(p, "utf8");
const E = await import("../src/lib/location-eligibility.ts");
const LINKS = await import("../src/lib/location-links.ts");
const DOMAIN = await import("../src/lib/business-availability-domain.ts");
const BULKD = await import("../src/lib/business-availability-bulk-domain.ts");
const BULK = await import("../src/lib/business-availability-bulk.ts");
const OWNER = await import("../src/lib/business-availability-owner.ts");
const FEATURED = await import("../src/lib/featured-locations.ts");
const FORMAT = await import("../src/lib/format.ts");
const SECTION = await import("../src/lib/section-anchors.ts");

const LOGO = "https://drcbrzwchlirfspjgtik.supabase.co/storage/v1/object/public/findmi-media/logo.jpg";
const COVER = "https://drcbrzwchlirfspjgtik.supabase.co/storage/v1/object/public/findmi-media/cover.jpg";

// ═══ 1. Location discovery eligibility ═══════════════════════════════════════

test("eligibility: listed AND usable Logo AND usable Cover — nothing else qualifies", () => {
  const ok = { is_demo: false, logo_url: LOGO, cover_image_url: COVER };
  assert.equal(E.isLocationDiscoverable(ok), true);
  assert.equal(E.isLocationDiscoverable({ ...ok, logo_url: null }), false, "missing Logo only");
  assert.equal(E.isLocationDiscoverable({ ...ok, cover_image_url: null }), false, "missing Cover only");
  assert.equal(E.isLocationDiscoverable({ ...ok, logo_url: null, cover_image_url: null }), false, "missing both");
  assert.equal(E.isLocationDiscoverable({ ...ok, is_demo: true }), false, "unlisted is never discoverable");
  assert.equal(E.isLocationDiscoverable({ logo_url: LOGO, cover_image_url: COVER }), true, "is_demo absent = listed");
  assert.equal(E.isLocationDiscoverable(null), false);
  assert.equal(E.isLocationDiscoverable(undefined), false);
  // Renderable = a place Findmi is configured to display from (Supabase PUBLIC storage, Unsplash,
  // Tally's CDN, a site path). A string that merely looks like an image URL does not count.
  for (const junk of ["", "   ", "null", "undefined", "NULL", "ftp://x/y.png", "cdn.example/x.png", "https://cdn.example/logo.png", "http://drcbrzwchlirfspjgtik.supabase.co/storage/v1/object/public/findmi-media/a.jpg", "https://drcbrzwchlirfspjgtik.supabase.co/storage/v1/object/sign/findmi-media/a.jpg?token=x", "https://evil.example/https://x.supabase.co/storage/v1/object/public/a.jpg"]) {
    assert.equal(E.isLocationDiscoverable({ ...ok, logo_url: junk }), false, `Logo ${JSON.stringify(junk)}`);
    assert.equal(E.isLocationDiscoverable({ ...ok, cover_image_url: junk }), false, `Cover ${JSON.stringify(junk)}`);
  }
  assert.equal(E.isLocationDiscoverable({ ...ok, logo_url: "/uploads/logo.png", cover_image_url: "/uploads/cover.png" }), true, "site-relative paths are usable");
  assert.equal(E.isLocationDiscoverable({ ...ok, cover_image_url: "https://images.unsplash.com/photo-1?w=800" }), true, "Unsplash (an allowed host)");
});

test("eligibility: one predicate — the in-memory filter and the DB filter agree; the contextual link is a separate question", () => {
  const rows = [
    { id: "full", is_demo: false, logo_url: LOGO, cover_image_url: COVER },
    { id: "no-logo", is_demo: false, logo_url: null, cover_image_url: COVER },
    { id: "no-cover", is_demo: false, logo_url: LOGO, cover_image_url: null },
    { id: "neither", is_demo: false, logo_url: null, cover_image_url: null },
    { id: "unlisted", is_demo: true, logo_url: LOGO, cover_image_url: COVER },
  ];
  assert.deepEqual(E.discoverableLocations(rows).map((r) => r.id), ["full"]);
  // CONTEXT links follow the listing alone: a listed-but-incomplete Location is reachable from an
  // Event / Business / Moment; only an unlisted one has no page.
  for (const r of rows) assert.equal(LINKS.publicLocationHref({ slug: r.id, ...r }) !== null, r.id !== "unlisted", r.id);
  assert.equal(LINKS.publicLocationHref({ slug: "no-logo", ...rows[1] }), "/location/no-logo");

  // The DB form: record the filter calls and evaluate the patterns against sample values.
  const calls = [];
  const rec = { eq: (...a) => (calls.push(["eq", ...a]), rec), or: (...a) => (calls.push(["or", ...a]), rec) };
  E.applyLocationDiscoveryFilter(rec);
  assert.deepEqual(calls[0], ["eq", "is_demo", false]);
  const orFor = (col) => calls.find((c) => c[0] === "or" && c[1].startsWith(`${col}.`))[1].split(",").map((p) => p.split("."));
  const matches = (col, value) =>
    orFor(col).some(([, op, ...pat]) => {
      assert.equal(op, "ilike");
      const re = new RegExp(`^${pat.join(".").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");
      return re.test(value ?? "");
    });
  for (const v of [LOGO, "https://images.unsplash.com/p.jpg", "https://x.tally.so/a.png", "HTTPS://DRCB.SUPABASE.CO/STORAGE/V1/OBJECT/PUBLIC/F/A.JPG", "/uploads/x.png", "http://a/b.png", "https://cdn.example/a.png", "https://x.supabase.co/storage/v1/object/sign/f/a.jpg", "", "null", "undefined", "ftp://x", "cdn.example/x.png"]) {
    for (const col of ["logo_url", "cover_image_url"]) {
      assert.equal(matches(col, v), E.isRenderableImageUrl(v), `${col} ${JSON.stringify(v)}`);
    }
  }
});

test("eligibility is evaluated, never stored: adding both images makes a Location eligible; removing either removes it; nothing is deleted", () => {
  const place = { id: "L1", name: "Corner Shop", is_demo: false, logo_url: null, cover_image_url: null, parent: "P1", availability: ["A1"], events: ["E1"] };
  const snapshot = JSON.stringify({ ...place, logo_url: 0, cover_image_url: 0 });
  const state = (l) => E.isLocationDiscoverable(l);
  assert.equal(state(place), false);
  place.logo_url = LOGO;
  assert.equal(state(place), false, "Logo alone is not enough");
  place.cover_image_url = COVER;
  assert.equal(state(place), true, "both images → discoverable automatically");
  place.logo_url = null;
  assert.equal(state(place), false, "removing the Logo removes it from discovery");
  place.logo_url = LOGO;
  place.cover_image_url = "";
  assert.equal(state(place), false, "removing the Cover removes it from discovery");
  // The Location and every relationship are exactly as they were — only the images changed.
  assert.equal(JSON.stringify({ ...place, logo_url: 0, cover_image_url: 0 }), snapshot);
});

const walk = (dir) =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
const SRC = walk("src");

test("consumer discovery: every public Location listing/search path goes through the canonical filter", () => {
  const data = read("src/lib/data.ts");
  const fn = (name, next) => data.slice(data.indexOf(`export async function ${name}`), data.indexOf(next));
  assert.match(fn("getLocations", "export async function getFeaturedLocations"), /applyLocationDiscoveryFilter\(supabase\.from\("locations"\)/);
  assert.match(fn("getLocations", "export async function getFeaturedLocations"), /discoverableLocations\(/);
  assert.match(fn("searchLocations", "export async function getLocationBySlug"), /applyLocationDiscoveryFilter\(supabase\.from\("locations"\)/);
  assert.match(fn("searchLocations", "export async function getLocationBySlug"), /discoverableLocations\(/);
  // Featured Locations, Market/Area pages, the Discovery feed and JerseyCity all read through getLocations.
  assert.match(data, /export async function getFeaturedLocations[\s\S]{0,400}getLocations\(/);
  assert.match(read("src/app/api/homepage-search/route.ts"), /searchLocations\(q, 4\)/);
  assert.match(read("src/lib/discovery/server.ts"), /getLocations\(\{ limit: 80/);
  assert.match(read("src/lib/jc/data.ts"), /getLocations\(/);
  assert.match(read("src/app/sitemap.ts"), /applyLocationDiscoveryFilter\(supabase\.from\("locations"\)\.select\("slug"\)\)/);
  assert.match(read("src/lib/account-home.ts"), /isLocationDiscoverable\(l\)/);
});

test("consumer discovery: no scattered image checks — only the canonical module decides, and no raw /location/ link is built for a Location card", () => {
  // Scattered `logo_url && cover_image_url` style rules are what the single predicate replaces.
  const scattered = SRC.filter((p) => p !== "src/lib/location-eligibility.ts").filter((p) => read(p).split("\n").some((line) => /ocation/.test(line) && /logo_url\s*&&[^\n]*cover_image_url|cover_image_url\s*&&[^\n]*logo_url/.test(line)));
  assert.deepEqual(scattered, []);
  // Raw `/location/${…slug}` links on consumer surfaces must be gated.
  const consumerLinks = [
    ["src/components/OurLocations.tsx", /publicLocationHref\(\{ slug: location\.slug \}\)/],
    ["src/components/LocationHappeningCollection.tsx", /at\.linkable/],
    ["src/app/(public)/location/[slug]/LocationPublicView.tsx", /a\.linkable/],
    ["src/app/(public)/journal/[id]/page.tsx", /publicLocationHref\(location\)/],
    ["src/app/(public)/business/[slug]/BusinessPublicView.tsx", /publicLocationHref\(featuredAppearance\.location\)/],
  ];
  for (const [file, re] of consumerLinks) assert.match(read(file), re, file);
  // Ancestor / descendant context carries a `linkable` flag computed by the same predicate.
  const data = read("src/lib/data.ts");
  // Context: a listed parent / child place has a page, so it links; an unlisted one doesn't.
  assert.match(data, /linkable: imageryById\.get\(r\.id\)\?\.is_demo !== true/);
});

test("incomplete Locations stay fully usable internally: pickers, search, import and admin do not apply the discovery filter", () => {
  const importers = SRC.filter((p) => /applyLocationDiscoveryFilter|discoverableLocations|isLocationDiscoverable|hasDiscoveryImagery/.test(read(p)) && p !== "src/lib/location-eligibility.ts");
  // The only files allowed to use the consumer rule are consumer read paths and render sites.
  const forbidden = importers.filter((p) =>
    /^src\/(app\/admin|lib\/admin|lib\/locator-import|lib\/location-import|lib\/locationCreation|lib\/business-availability|lib\/event-import|lib\/places|app\/api\/account)/.test(p) ||
    /Picker|EventLocationField|Import/.test(p)
  );
  assert.deepEqual(forbidden, [], "no internal path filters by discoverability");
  // The Event/Appearance Location picker lists unlisted AND image-less places.
  const search = read("src/app/api/account/search/route.ts");
  assert.doesNotMatch(search, /location-eligibility|logo_url\b[^\n]*\.not\(|cover_image_url"\s*,\s*"is"/);
  assert.match(search, /if \(!linkableScope\) query = query\.eq\("is_demo", false\);/, "scope=place still includes places that are not public");
  // The owner's Find Us Here place picker has no image requirement.
  const owner = read("src/lib/business-availability-owner.ts");
  const picker = owner.slice(owner.indexOf("export async function searchAvailabilityLocations"));
  assert.doesNotMatch(picker, /logo_url|cover_image_url/);
});

test("contextual references link to an incomplete Location (discovery ≠ context); an unlisted one is shown by name only", () => {
  const incomplete = { slug: "corner-shop", is_demo: false, logo_url: null, cover_image_url: COVER };
  assert.equal(LINKS.publicLocationHref(incomplete), "/location/corner-shop", "Event → Location keeps working");
  assert.equal(LINKS.publicLocationHref({ ...incomplete, is_demo: true }), null, "unlisted has no page");
  for (const f of [
    "src/app/(public)/event/[slug]/EventPublicView.tsx",
    "src/components/event/EventLocationFeature.tsx",
    "src/components/EventScheduleSummary.tsx",
    "src/components/EventOccurrenceQuickView.tsx",
    "src/components/EventLocationCard.tsx",
    "src/components/AppearanceCard.tsx",
    "src/components/AppearanceQuickView.tsx",
  ]) assert.match(read(f), /publicLocationHref\(/, f);
  assert.match(read("src/components/EventLocationCard.tsx"), /<div className="flex items-center gap-3 rounded-xl border border-black\/10 bg-white p-2\.5">\{inner\}<\/div>/, "unlisted → name / address, no link");
  const card = read("src/components/OurLocations.tsx");
  assert.match(card, /if \(!href\) \{\s*return <div className="flex items-center gap-3 rounded-3xl/);
  // Discovery surfaces never take their candidates from the contextual helper.
  for (const f of ["src/lib/data.ts", "src/app/(public)/locations/page.tsx", "src/app/sitemap.ts"]) assert.doesNotMatch(read(f), /publicLocationHref/, f);
});

test("incomplete Location page: no fake hero / logo, intentionally unlisted, claim kept", () => {
  const view = read("src/app/(public)/location/[slug]/LocationPublicView.tsx");
  assert.match(view, /const heroImages = \[location\.cover_image_url, \.\.\.galleryImages\]\.filter\(isRenderableImageUrl\)/, "only images that can render");
  assert.match(view, /\{hasHero && \(/, "no cover → the hero block collapses");
  assert.match(view, /const logoUrl = isRenderableImageUrl\(location\.logo_url\)/);
  assert.doesNotMatch(view, /LocationMonogram|LocationCoverFallback/, "no manufactured logo / cover");
  assert.match(view, /\{!profileComplete && \(/);
  assert.match(view, /<ClaimButton type="location"/, "Claim stays available on an incomplete Location");
  // The personal-list card never draws a large blank placeholder.
  const card = read("src/components/LocationCard.tsx");
  assert.doesNotMatch(card, /bg-ink|PinGlyph/);
});

test("direct /location/[slug] keeps working for an incomplete Location (200) but is kept out of search engines and the sitemap", () => {
  const data = read("src/lib/data.ts");
  const bySlug = data.slice(data.indexOf("export async function getLocationBySlug"), data.indexOf("export interface LocationPlaceContext"));
  assert.match(bySlug, /\.eq\("is_demo", false\)/);
  assert.doesNotMatch(bySlug, /logo_url|cover_image_url|applyLocationDiscoveryFilter/, "the page itself is not gated on images");
  assert.match(read("src/app/(public)/location/[slug]/LocationPublicView.tsx"), /isLocationDiscoverable\(location\) \? \{\} : \{ robots: \{ index: false, follow: true \} \}/);
  assert.match(read("src/app/sitemap.ts"), /applyLocationDiscoveryFilter/);
});

// ═══ 2. Review semantics ═════════════════════════════════════════════════════

const S = DOMAIN.statusAfterOwnerEdit;
const edit = (before, after, noteBefore = null, noteAfter = noteBefore) => ({ relationshipsBefore: before, relationshipsAfter: after, noteBefore, noteAfter });

test("review matrix: a Live entry stays Live unless the edit adds a public claim", () => {
  // Stays live
  assert.equal(S("live", edit(["stocked"], ["stocked"])), "live", "products / dates only");
  assert.equal(S("live", edit(["stocked", "sold"], ["stocked"])), "live", "narrowing a relationship");
  assert.equal(S("live", edit(["stocked"], ["stocked"], "Ground floor", "")), "live", "clearing the note");
  assert.equal(S("live", edit(["stocked"], ["stocked"], "Ground floor", "Ground floor")), "live", "same note");
  // Returns to review
  assert.equal(S("live", edit(["stocked"], ["stocked", "served"])), "pending", "adding Served");
  assert.equal(S("live", edit(["stocked"], ["stocked", "sampled"])), "pending", "adding Sampled");
  assert.equal(S("live", edit(["stocked"], ["sold"])), "pending", "swapping to a relationship it wasn't approved for");
  assert.equal(S("live", edit(["stocked"], ["stocked"], null, "Official flagship partner")), "pending", "new public note text");
  assert.equal(S("live", edit(["stocked"], ["stocked"], "Ground floor", "Top floor")), "pending", "changed note text");
  // Pending / Declined
  assert.equal(S("pending", edit(["stocked"], ["stocked"])), "pending");
  assert.equal(S("pending", edit(["stocked"], ["stocked", "served"])), "pending");
  assert.equal(S("declined", edit(["stocked"], ["stocked"])), "declined", "ordinary upkeep never resubmits a declined entry");
  assert.equal(S("declined", edit(["stocked"], ["stocked", "served"])), "pending", "a new claim is a fresh submission");
});

test("review: bulk rule and single-entry rule are the same function; only adding a relationship can return entries to review", () => {
  for (const op of [
    { kind: "add_products", productIds: ["a"] },
    { kind: "remove_products", productIds: ["a"] },
    { kind: "apply_set", setId: "s" },
    { kind: "remove_relationships", relationships: ["sold"] },
    { kind: "remove_from_footprint" },
  ]) assert.equal(BULKD.bulkOpReturnsToReview(op), false, op.kind);
  assert.equal(BULKD.bulkOpReturnsToReview({ kind: "add_relationships", relationships: ["served"] }), true);
  const bulk = read("src/lib/business-availability-bulk.ts");
  const owner = read("src/lib/business-availability-owner.ts");
  const imp = read("src/lib/locator-import/server.ts");
  for (const src of [bulk, owner, imp]) assert.match(src, /statusAfterOwnerEdit/);
  assert.doesNotMatch(bulk, /returnToReview\(/, "product ops no longer touch status");
  assert.doesNotMatch(imp, /update\(\{ status: "pending", source: "business" \}\)\.eq\("id", availabilityId\)/, "attaching products in a re-import doesn't unlist");
});

// A small PostgREST-shaped in-memory database. Every READ is capped at 1,000 rows (the API's max-rows),
// updates are not — exactly the behaviour that makes an unpaged read silently drop rows at scale.
function makeDb(init = {}, { maxRows = 1000 } = {}) {
  const t = { business_location_availability: [], business_location_availability_products: [], business_locations: [], locations: [], products: [], business_product_sets: [], ...init };
  const reads = [];
  const val = (row, col) => row[col];
  return {
    t,
    reads,
    from(table) {
      const filters = [];
      let op = "select";
      let patch = null;
      let rowsIn = null;
      let opts = {};
      let range = null;
      let limit = null;
      let orderKey = null;
      let returning = false;
      const embed = (r) => (table === "business_location_availability" ? { ...r, locations: t.locations.find((l) => l.id === r.location_id) ?? null } : table === "business_location_availability_products" ? { ...r, products: t.products.find((p) => p.id === r.product_id) ?? null } : r);
      const matched = () => t[table].filter((r) => filters.every((f) => f(embed(r))));
      const run = () => {
        if (op === "insert") {
          const list = (Array.isArray(rowsIn) ? rowsIn : [rowsIn]).map((r, i) => ({ id: r.id ?? `ins-${t[table].length + i}`, ...r }));
          t[table].push(...list);
          return { data: list.map((r) => ({ id: r.id })), error: null };
        }
        if (op === "update") {
          const hit = matched();
          for (const r of hit) Object.assign(r, patch);
          return { data: returning ? hit.map((r) => ({ id: r.id })) : null, count: opts.count ? hit.length : null, error: null };
        }
        if (op === "delete") {
          const hit = new Set(matched().map((r) => r.id));
          t[table] = t[table].filter((r) => !hit.has(r.id));
          return { data: null, error: null };
        }
        let rows = matched().map(embed);
        if (orderKey) rows = [...rows].sort((a, b) => String(a[orderKey]).localeCompare(String(b[orderKey])));
        const total = rows.length;
        if (range) rows = rows.slice(range[0], range[1] + 1);
        if (limit !== null) rows = rows.slice(0, limit);
        rows = rows.slice(0, maxRows);
        reads.push({ table, returned: rows.length, total });
        return { data: opts.head ? null : rows, count: opts.count ? total : null, error: null };
      };
      const api = {
        select: (_cols, o) => {
          if (op === "update") returning = true;
          else opts = o ?? {};
          return api;
        },
        update: (p, o) => ((op = "update"), (patch = p), (opts = o ?? {}), api),
        insert: (r) => ((op = "insert"), (rowsIn = r), api),
        delete: () => ((op = "delete"), api),
        eq: (c, v) => (filters.push((r) => val(r, c) === v), api),
        in: (c, list) => (filters.push((r) => list.includes(val(r, c))), api),
        gt: (c, v) => (filters.push((r) => val(r, c) > v), api),
        is: (c, v) => (filters.push((r) => (val(r, c) ?? null) === v), api),
        not: (c, o, list) => {
          if (o === "in") {
            const ids = list.replace(/[()]/g, "").split(",");
            filters.push((r) => !ids.includes(val(r, c)));
          } else if (o === "is") {
            filters.push((r) => (val(r, c) ?? null) !== (list ?? null));
          }
          return api;
        },
        contains: (c, arr) => (filters.push((r) => arr.every((x) => (val(r, c) ?? []).includes(x))), api),
        or: () => api,
        order: (k) => ((orderKey = k), api),
        limit: (n) => ((limit = n), api),
        range: (a, b) => ((range = [a, b]), api),
        maybeSingle: async () => ({ data: matched().map(embed)[0] ?? null, error: null }),
        single: async () => ({ data: run().data?.[0] ?? null, error: null }),
        then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
      };
      return api;
    },
  };
}

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BIZ = "biz-1";
const locations = Array.from({ length: 3 }, (_, i) => ({ id: `loc-${i}`, name: `Place ${i}`, slug: `place-${i}`, city: "Newark", state: "NJ", logo_url: null, cover_image_url: null, is_demo: false }));
const entry = (n, over = {}) => ({ id: uuid(n), business_id: BIZ, location_id: `loc-${n % 3}`, relationship: "stocked", relationships: ["stocked"], status: "live", source: "admin", starts_on: null, ends_on: null, note: null, created_at: `2026-10-${String((n % 28) + 1).padStart(2, "0")}`, ...over });
const products = [{ id: "prod-1", business_id: BIZ, name: "Beans" }, { id: "prod-2", business_id: BIZ, name: "Tea" }];

test("single-entry edit: products, dates and narrowing keep a Live entry Live; a new relationship or note returns it to review", async () => {
  const db = makeDb({ business_location_availability: [entry(1, { relationships: ["stocked", "sold"], relationship: "stocked", note: "Back shelf" })], locations, products });
  const input = (over = {}) => ({ relationships: ["stocked", "sold"], productIds: [], timing: "ongoing", startsOn: null, endsOn: null, note: "Back shelf", ...over });
  const row = () => db.t.business_location_availability[0];

  let r = await OWNER.updateOwnerAvailability(db, BIZ, uuid(1), input({ productIds: ["prod-1", "prod-2"] }));
  assert.deepEqual([r.ok, r.changed, r.returnedToReview], [true, true, false]);
  assert.equal(row().status, "live", "adding products stays live");
  assert.equal(row().source, "admin", "source untouched while nothing about the claim changed");
  assert.equal(db.t.business_location_availability_products.length, 2);

  r = await OWNER.updateOwnerAvailability(db, BIZ, uuid(1), input({ productIds: ["prod-2"] }));
  assert.equal(row().status, "live", "removing a product stays live");

  r = await OWNER.updateOwnerAvailability(db, BIZ, uuid(1), input({ productIds: ["prod-2"], timing: "temporary", endsOn: "2027-01-31" }));
  assert.equal(row().status, "live", "changing dates stays live");

  r = await OWNER.updateOwnerAvailability(db, BIZ, uuid(1), input({ productIds: ["prod-2"], relationships: ["stocked"], timing: "temporary", endsOn: "2027-01-31" }));
  assert.equal(row().status, "live", "taking a relationship away only narrows");

  r = await OWNER.updateOwnerAvailability(db, BIZ, uuid(1), input({ productIds: ["prod-2"], relationships: ["stocked"], timing: "temporary", endsOn: "2027-01-31", note: null }));
  assert.equal(row().status, "live", "clearing the note stays live");

  r = await OWNER.updateOwnerAvailability(db, BIZ, uuid(1), input({ productIds: ["prod-2"], relationships: ["stocked", "served"], timing: "temporary", endsOn: "2027-01-31", note: null }));
  assert.deepEqual([r.ok, r.returnedToReview], [true, true]);
  assert.equal(row().status, "pending", "adding Served is a new claim");
  assert.equal(row().source, "business");

  // The place itself can never be changed by an edit.
  assert.equal(row().location_id, "loc-1");
});

test("bulk: Product Set / add / remove products never change status, at any size; add relationship returns only the entries that gain one", async () => {
  const total = 450; // spans multiple 200-entry chunks
  const rows = Array.from({ length: total }, (_, i) => entry(i + 1, { status: i % 10 === 0 ? "declined" : i % 7 === 0 ? "pending" : "live" }));
  const before = new Map(rows.map((r) => [r.id, r.status]));
  const db = makeDb({
    business_location_availability: rows,
    business_product_sets: [{ id: "set-1", business_id: BIZ, business_product_set_items: [{ product_id: "prod-1" }, { product_id: "prod-2" }] }],
    locations,
    products,
  });
  const drive = async (op) => {
    let cursor = null;
    let progress = BULKD.emptyBulkProgress();
    for (let i = 0; i < 50; i++) {
      const res = await BULK.bulkAvailability(db, BIZ, { kind: "filter", filter: BULKD.EMPTY_AVAILABILITY_FILTER }, op, cursor);
      assert.equal(res.ok, true, JSON.stringify(res));
      progress = BULKD.mergeBulkProgress(progress, res.progress);
      if (res.done || res.nextCursor === null) break;
      cursor = res.nextCursor;
    }
    return progress;
  };
  const statuses = () => new Map(db.t.business_location_availability.map((r) => [r.id, r.status]));
  const same = (a, b) => [...a].every(([k, v]) => b.get(k) === v);

  let p = await drive({ kind: "apply_set", setId: "set-1" });
  assert.equal(p.processed, total);
  assert.equal(p.changed, total, "every entry got the set's products");
  assert.equal(p.returnedToReview, 0);
  assert.ok(same(before, statuses()), "Product Set application leaves every status exactly as it was");

  p = await drive({ kind: "remove_products", productIds: ["prod-1"] });
  assert.equal(p.returnedToReview, 0);
  assert.ok(same(before, statuses()), "removing a product leaves every status alone");

  p = await drive({ kind: "add_products", productIds: ["prod-1"] });
  assert.equal(p.returnedToReview, 0);
  assert.ok(same(before, statuses()));

  p = await drive({ kind: "remove_relationships", relationships: ["featured"] });
  assert.equal(p.returnedToReview, 0, "nothing to remove here");
  assert.ok(same(before, statuses()));

  const liveBefore = [...before.values()].filter((s) => s === "live").length;
  p = await drive({ kind: "add_relationships", relationships: ["served"] });
  assert.equal(p.changed, total);
  assert.equal(p.returnedToReview, liveBefore, "exactly the Live entries are returned to review");
  assert.equal([...statuses().values()].filter((s) => s !== "pending").length, 0, "every entry that gained Served is now Pending Review");
});

// ═══ 3. No 1,000-row cap in admin ════════════════════════════════════════════

test("admin: counts, paging and Approve All / Decline All cover the COMPLETE set when it is far beyond 1,000", async () => {
  const total = 2600;
  const rows = Array.from({ length: total }, (_, i) => entry(i + 1, { status: i < 2200 ? "pending" : i < 2500 ? "live" : "declined", source: "business" }));
  const db = makeDb({ business_location_availability: rows, business_locations: [], locations, products });

  // Counts are database counts, not the length of a (capped) list.
  const counts = await OWNER.getOwnerAvailabilityCounts(db, BIZ);
  assert.deepEqual([counts.all, counts.pending, counts.live, counts.declined], [2600, 2200, 300, 100]);

  // Paging reads exactly one page, with the true total and a page far past row 1,000.
  const first = await OWNER.getOwnerAvailabilityPage(db, BIZ, BULKD.parseAvailabilityFilter({ status: "pending" }), 1);
  assert.equal(first.total, 2200);
  assert.equal(first.items.length, BULKD.AVAILABILITY_LIST_PAGE_SIZE);
  const deep = await OWNER.getOwnerAvailabilityPage(db, BIZ, BULKD.parseAvailabilityFilter({ status: "pending" }), 40);
  assert.equal(deep.page, 40);
  assert.equal(deep.items.length, BULKD.AVAILABILITY_LIST_PAGE_SIZE, "page 40 (entries 1,951–2,000) is reachable");
  const last = await OWNER.getOwnerAvailabilityPage(db, BIZ, BULKD.parseAvailabilityFilter({ status: "pending" }), 44);
  assert.equal(last.items.length, 2200 - 43 * BULKD.AVAILABILITY_LIST_PAGE_SIZE, "the final page holds the remainder");
  assert.ok(db.reads.every((r) => r.returned <= BULKD.AVAILABILITY_LIST_PAGE_SIZE || r.total === 0 || r.returned <= 1000));

  // Approve All: ONE statement over the complete pending set, reporting the real number.
  const approved = await OWNER.reviewAllPendingAvailability(db, BIZ, "live");
  assert.deepEqual([approved.ok, approved.changed, approved.left], [true, 2200, 0]);
  const after = await OWNER.getOwnerAvailabilityCounts(db, BIZ);
  assert.deepEqual([after.pending, after.live, after.declined], [0, 2500, 100]);

  // Decline All over a fresh >1,000 pending set.
  for (const r of db.t.business_location_availability.slice(0, 1500)) r.status = "pending";
  const declined = await OWNER.reviewAllPendingAvailability(db, BIZ, "declined");
  assert.deepEqual([declined.ok, declined.changed, declined.left], [true, 1500, 0]);
  assert.equal((await OWNER.getOwnerAvailabilityCounts(db, BIZ)).declined, 1600);
  // Another Business's entries are never touched.
  db.t.business_location_availability.push(entry(9000, { business_id: "other", status: "pending" }));
  await OWNER.reviewAllPendingAvailability(db, BIZ, "live");
  assert.equal(db.t.business_location_availability.at(-1).status, "pending");
});

test("admin: Approve All leaves pending entries for a place the Business operates (the database refuses those)", async () => {
  const rows = [entry(1, { status: "pending" }), entry(2, { status: "pending" }), entry(3, { status: "pending" })];
  const db = makeDb({ business_location_availability: rows, business_locations: [{ business_id: BIZ, location_id: "loc-1" }], locations, products });
  const res = await OWNER.reviewAllPendingAvailability(db, BIZ, "live");
  assert.deepEqual([res.ok, res.changed, res.left], [true, 2, 1]);
  assert.equal(db.t.business_location_availability.find((r) => r.location_id === "loc-1").status, "pending");
});

test("admin page: no unpaged read of the footprint; labelled with true totals; paged, filtered and searched in the database", () => {
  const page = read("src/app/admin/(protected)/businesses/[id]/page.tsx");
  assert.doesNotMatch(page, /getOwnerAvailability\(/);
  assert.doesNotMatch(page, /pendingAvailability|slice\(0, 25\)|Showing the first/);
  assert.match(page, /getOwnerAvailabilityCounts\(marketsAdmin, id\)/);
  assert.match(page, /getOwnerAvailabilityPage\(marketsAdmin, id, availabilityFilter/);
  assert.match(page, /Approve All \{availabilityCounts\.pending\.toLocaleString\(\)\}/);
  assert.match(page, /Decline All \{availabilityCounts\.pending\.toLocaleString\(\)\}/);
  assert.match(page, /Showing \{.*\} of \{availabilityPage\.total\.toLocaleString\(\)\}/);
  assert.match(page, /select\("id", \{ count: "exact", head: true \}\)\.eq\("business_id", id\)/, "Our Locations total is an exact count");
  assert.match(page, /admin-our-locations-paging/);
  const owner = read("src/lib/business-availability-owner.ts");
  assert.doesNotMatch(owner, /export async function getOwnerAvailability\(/, "the capped unpaged reader is gone");
  const reviewAll = owner.slice(owner.indexOf("export async function reviewAllPendingAvailability"), owner.indexOf("export async function searchAvailabilityLocations"));
  assert.doesNotMatch(reviewAll, /\.select\("id"\);\s*$/m, "the update never returns rows (a returned list would cap at 1,000)");
  assert.match(reviewAll, /\{ count: "exact" \}/);
});

test("market footprint: owner-side totals read in pages — no single read relies on a limit above 1,000", () => {
  const src = read("src/lib/business-market-footprint.ts");
  assert.match(src, /async function readAllRows/);
  assert.doesNotMatch(src, /\.limit\((MAX_PAGES \* PAGE|5000|2000)\)/);
});

// ═══ 4. Location hero geography ══════════════════════════════════════════════

test("Location hero: line 1 = parent-place descriptor (only if any); line 2 = City, State ZIP from the Location's own address — no dot, no Market label", () => {
  const view = read("src/app/(public)/location/[slug]/LocationPublicView.tsx");
  const hero = view.slice(view.indexOf("Hero geography"), view.indexOf("profileComplete &&"));
  assert.match(hero, /placeContext && placeContext\.ancestors\.length > 0 && \(/, "no descriptor → no blank line");
  assert.match(hero, /cityStateZip\(location\.city, location\.state, location\.postal_code\)/, "canonical address data");
  assert.doesNotMatch(hero, /placeContext\.geography/, "never the Market display label");
  // The two concepts are separate <p> lines; the only dot left is BETWEEN multiple parent places.
  assert.equal((hero.match(/<p /g) ?? []).length, 2);
  assert.doesNotMatch(hero.slice(hero.indexOf("data-testid")), /·/);
  const { cityStateZip } = FORMAT;
  assert.equal(cityStateZip("New York", "NY", "10010"), "New York, NY 10010");
  assert.equal(cityStateZip("New York", "NY", null), "New York, NY");
  assert.equal(cityStateZip(null, null, null), "");
});

// ═══ 5. Shared contextual navigation ═════════════════════════════════════════

test("contextual nav: every candidate section id exists in the rendered markup (no chip can point at nothing)", () => {
  const ALL = SRC.map(read).join("\n");
  for (const f of [
    "src/app/(public)/business/[slug]/BusinessPublicView.tsx",
    "src/app/(public)/location/[slug]/LocationPublicView.tsx",
    "src/app/(public)/event/[slug]/EventPublicView.tsx",
    "src/app/(public)/people/[slug]/page.tsx",
  ]) {
    const src = read(f);
    const block = src.slice(src.indexOf("buildSectionAnchors(["), src.indexOf("]);", src.indexOf("buildSectionAnchors([")));
    const ids = [...block.matchAll(/id: "([a-z-]+)"/g)].map((m) => m[1]);
    assert.ok(ids.length > 0, f);
    for (const id of ids) assert.match(ALL, new RegExp(`id=\\{?"${id}"`), `${f}: #${id}`);
    assert.match(src, /<SectionAnchorNav /, f);
  }
});

test("contextual nav: Overview + one real section is enough; Person page uses the shared component with real sections only", () => {
  const ANCH = SECTION;
  assert.deepEqual(ANCH.buildSectionAnchors([{ id: "brands", label: "Brands", present: true }]).map((i) => i.label), ["Overview", "Brands"]);
  assert.deepEqual(ANCH.buildSectionAnchors([{ id: "brands", label: "Brands", present: false }]), []);
  const person = read("src/app/(public)/people/[slug]/page.tsx");
  assert.match(person, /present: businesses\.length > 0/);
  assert.match(person, /<section id="brands"/);
  assert.match(person, /sectionAnchors\.length > 0 && \(/, "no empty wrapper when there is no nav");
});
