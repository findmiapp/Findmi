// Taxonomy V2 — Pass 2: staged Category trees, legacy → V2 mapping,
// deterministic backfill. The REAL manifests (src/lib/taxonomy/v2.ts +
// v2-legacy.ts), the REAL migration text and a read-only snapshot of the
// production V1 category rows (tests/fixtures/taxonomy/v1-categories.json).
// The migration itself was also applied twice to a scratch Postgres loaded
// with a production-shaped snapshot (idempotent; see the Pass 2 report).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { transform } = require("sucrase");
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith("./") && ctx.parentURL?.endsWith(".ts")) return { url: pathToFileURL(resolve(dirname(fileURLToPath(ctx.parentURL)), `${spec}.ts`)).href, shortCircuit: true };
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url.endsWith(".ts")) return { format: "module", source: transform(readFileSync(fileURLToPath(url), "utf8"), { transforms: ["typescript"] }).code, shortCircuit: true };
    return next(url, ctx);
  },
});

const ROOT = process.cwd();
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const T = await import(pathToFileURL(join(ROOT, "src/lib/taxonomy/v2.ts")).href);
const L = await import(pathToFileURL(join(ROOT, "src/lib/taxonomy/v2-legacy.ts")).href);
const V1 = JSON.parse(read("tests/fixtures/taxonomy/v1-categories.json"));
const SQL = read("supabase/migrations/20261117000000_taxonomy_v2_staged_categories.sql");
const KINDS = ["event", "business", "location", "product"];
const LEGACY_KINDS = ["business", "event", "event_format", "location", "product"];
const v1Slugs = (k) => V1[k].map(([s]) => s);

test("the migration embeds the generated trees + mappings verbatim, inside one transaction", () => {
  const generated = execFileSync(process.execPath, ["scripts/taxonomy-v2-pass2-sql.mjs"], { cwd: ROOT, encoding: "utf8" });
  assert.ok(SQL.includes(generated), "re-run: node scripts/taxonomy-v2-pass2-sql.mjs and paste into the migration");
  assert.match(SQL, /^begin;$/m);
  assert.match(SQL.trimEnd(), /commit;$/);
});

test("snapshot sanity: 302 V1 rows, all five kinds", () => {
  assert.equal(LEGACY_KINDS.reduce((n, k) => n + V1[k].length, 0), 302);
  assert.deepEqual(LEGACY_KINDS.map((k) => V1[k].length), [29, 67, 16, 20, 170]);
});

test("trees: the approved structure, kind-scoped slugs, depth limits, Event Domain ONE level, no Services product", () => {
  assert.deepEqual(T.V2_EVENT_DOMAINS.map((d) => d.name), ["Food & Drink", "Arts & Culture", "Music & Nightlife", "Entertainment", "Shopping & Style", "Beauty & Wellness", "Sports & Fitness", "Outdoors & Nature", "Business & Tech", "Community & Causes", "Home & Lifestyle"]);
  assert.ok(T.V2_EVENT_DOMAINS.every((d) => !d.children));
  assert.deepEqual(T.V2_BUSINESS_TREE.map((d) => d.name), ["Food & Beverage", "Fashion & Apparel", "Beauty & Personal Care", "Health & Wellness", "Home & Living", "Arts & Makers", "Kids & Baby", "Pets", "Media & Entertainment", "Events & Hospitality", "Services"]);
  assert.deepEqual(T.V2_BUSINESS_TREE[0].children.map((d) => d.name), ["Coffee & Tea", "Bakery & Desserts", "Restaurants & Food Service", "Packaged Food", "Beverages", "Alcoholic Beverages", "Non-Alcoholic Beverages"]);
  assert.deepEqual(T.V2_LOCATION_TREE.map((d) => d.name), ["Food & Drink", "Shopping", "Arts & Culture", "Event & Community Spaces", "Outdoors", "Health & Wellness", "Hospitality", "Work & Education", "Landmarks"]);
  assert.deepEqual(T.V2_LOCATION_TREE[0].children.map((d) => d.name), ["Café & Coffee Shop", "Bakery", "Restaurant", "Bar", "Food Hall", "Specialty Food Shop"]);
  assert.deepEqual(T.V2_PRODUCT_TREE.map((d) => d.name), ["Food & Snacks", "Beverages", "Beauty & Personal Care", "Apparel", "Accessories & Jewelry", "Home & Living", "Art & Collectibles", "Craft & Maker Goods", "Books & Media", "Stationery & Paper", "Kids & Baby", "Pets", "Wellness"]);
  for (const k of KINDS) {
    const nodes = L.v2Nodes(k);
    const slugs = nodes.map((x) => x.slug);
    assert.equal(new Set(slugs).size, slugs.length, `${k}: unique`);
    assert.ok(Math.max(...nodes.map((x) => x.depth)) <= T.CATEGORY_MAX_DEPTH[k], `${k}: depth`);
  }
  assert.ok(!L.v2Nodes("product").some((x) => /servic/.test(x.slug)), "no Services product category");
});

test("staged vs reused: a new V2 slug never collides with a live V1 row; every reused row exists in V1", () => {
  for (const k of KINDS)
    for (const x of L.v2Nodes(k)) {
      if (x.reuse) assert.ok(v1Slugs(k).includes(x.slug), `reused ${k}/${x.slug} exists in V1`);
      else assert.ok(!v1Slugs(k).includes(x.slug), `new ${k}/${x.slug} would collide with a live V1 row`);
    }
  // The migration fails loudly rather than silently reusing a colliding row.
  assert.match(SQL, /raise exception 'Taxonomy V2: expected % row %\/%'/);
  assert.match(SQL, /insert into public\.categories \(name, slug, kind, status, show_on_home\) values/);
  assert.doesNotMatch(SQL, /update public\.categories/i, "no V1 category row is ever modified");
  assert.doesNotMatch(SQL, /delete from public\.categories|delete from public\.(business|event|product)_categories|delete from public\.event_formats/i);
});

test("mapping: every V1 row mapped exactly once, statuses explicit, every target real", () => {
  const seen = new Set();
  for (const x of L.LEGACY_MAPPINGS) {
    const key = `${x.kind}/${x.slug}`;
    assert.ok(!seen.has(key), `duplicate ${key}`);
    seen.add(key);
    assert.ok(v1Slugs(x.kind).includes(x.slug), `${key} is a V1 row`);
  }
  for (const k of LEGACY_KINDS) for (const s of v1Slugs(k)) assert.ok(seen.has(`${k}/${s}`), `${k}/${s} unmapped`);
  const pools = {
    event_type: T.EVENT_TYPE_SEEDS.map((t) => t.slug),
    experience_mechanic: T.EXPERIENCE_MECHANIC_SEEDS.map((t) => t.slug),
    topic: T.TOPIC_SEEDS.map((t) => t.slug),
    business_model: [...T.BUSINESS_MODELS],
    audience: [...T.AUDIENCES],
  };
  for (const x of L.LEGACY_MAPPINGS)
    for (const t of x.targets) {
      if (t.dimension === "category") assert.ok(L.v2Nodes(L.categoryKindOf(x.kind)).some((n) => n.slug === t.value), `${x.kind}/${x.slug} → category ${t.value}`);
      else assert.ok(pools[t.dimension]?.includes(t.value), `${x.kind}/${x.slug} → ${t.dimension} ${t.value}`);
    }
  const counts = { deterministic: 0, review_required: 0, intentionally_unmapped: 0 };
  for (const x of L.LEGACY_MAPPINGS) counts[L.mappingStatus(x)]++;
  assert.deepEqual(counts, { deterministic: 251, review_required: 47, intentionally_unmapped: 4 });
  for (const x of L.LEGACY_MAPPINGS) if (L.mappingStatus(x) === "intentionally_unmapped") assert.ok(x.note || x.targets.length === 0);
});

test("mapping semantics: Types vs Mechanics stay separate; no Benefits, no deterministic Audience; ambiguous V1 rows need review", () => {
  const byKey = new Map(L.LEGACY_MAPPINGS.map((x) => [`${x.kind}/${x.slug}`, x]));
  const det = (k) => byKey.get(k).targets.filter((t) => t.confidence === "deterministic");
  // Event Formats split cleanly into the two dimensions.
  for (const s of ["pop-up", "sampling", "brand-activation", "product-launch", "retail-experience", "sample-sale"]) assert.deepEqual(det(`event_format/${s}`).map((t) => t.dimension), ["experience_mechanic"], s);
  for (const s of ["market", "festival", "exhibition", "performance", "workshop", "conference", "networking", "talk-panel", "immersive-experience"]) assert.deepEqual(det(`event_format/${s}`).map((t) => t.dimension), ["event_type"], s);
  // No mapping ever claims a Benefit (Mechanics never prove Benefits).
  assert.ok(!L.LEGACY_MAPPINGS.some((x) => x.targets.some((t) => t.dimension === "benefit")));
  // Audience only ever as a suggestion.
  assert.ok(L.LEGACY_MAPPINGS.flatMap((x) => x.targets).filter((t) => t.dimension === "audience").every((t) => t.confidence === "review_required"));
  // The V1 catch-alls are not fabricated into truth.
  assert.equal(L.mappingStatus(byKey.get("event/markets-pop-ups")), "review_required");
  assert.equal(det("event/markets-pop-ups").length, 0, "Markets & Fairs holds immersive, pet and brand events");
  assert.equal(det("event/halloween-fall").length, 0, "a fall event is not a Halloween event");
  assert.deepEqual(det("business/coffee").map((t) => t.value), ["food-beverage"], "Coffee, Tea & Beverages → only the industry is proven");
  assert.deepEqual(det("location/park-outdoor-space").map((t) => t.value), ["outdoors"]);
  assert.deepEqual(det("business/retail").map((t) => `${t.dimension}:${t.value}`), ["business_model:retailer"], "Retail is a Business Model, not an industry");
  assert.equal(byKey.get("location/residential").targets.length, 0);
  // Services are not Products: no product mapping lands on a service concept.
  assert.ok(!L.LEGACY_MAPPINGS.filter((x) => x.kind === "product").some((x) => x.targets.some((t) => /servic/.test(t.value))));
});

test("Category → Topic implications are deterministic and point at real V2 nodes", () => {
  for (const imp of T.V2_CATEGORY_TOPIC_IMPLICATIONS) {
    assert.ok(L.v2Nodes(imp.kind).some((x) => x.slug === imp.slug), `${imp.kind}/${imp.slug}`);
    for (const t of imp.topics) assert.ok(T.TOPIC_SEEDS.some((x) => x.slug === t), t);
  }
  const has = (k, s) => T.V2_CATEGORY_TOPIC_IMPLICATIONS.some((x) => x.kind === k && x.slug === s);
  assert.ok(has("location", "cafe-coffee-shop"));
  assert.ok(!has("business", "coffee-tea"), "a Coffee & Tea business may be a tea brand");
  assert.ok(!has("location", "restaurant"), "Restaurant does not guarantee any Topic");
});

test("backfill: confirmed facts only, V2 tables only, idempotent; unknown stays unknown", () => {
  const backfill = SQL.slice(SQL.indexOf("7. deterministic backfill"));
  // Only deterministic targets become assignments; review → suggestions.
  assert.equal((backfill.match(/x\.confidence = 'deterministic'/g) ?? []).length, 11);
  assert.match(backfill, /where x\.confidence = 'review_required'/);
  // Never written: the V1-read event attributes, price, setting, legacy fields.
  assert.doesNotMatch(SQL, /update public\.events/i);
  assert.doesNotMatch(SQL, /\b(price_kind|setting|is_free|family_friendly)\s*=/);
  assert.doesNotMatch(SQL, /insert into public\.(business_categories|event_categories|event_formats|product_categories)\b/);
  assert.doesNotMatch(SQL, /update public\.appearances/i, "Appearance Type is never inherited");
  // Entry modes: deterministic, but staged as suggestions (the live Map reads entry_modes).
  assert.match(backfill, /'entry_mode', to_jsonb\(v\.mode\), 'migration', 1\.000/);
  // Every insert is idempotent.
  for (const stmt of backfill.split(";").filter((s) => /insert into public\./.test(s) && !/location_hours \(/.test(s))) assert.match(stmt, /on conflict/, stmt.slice(0, 120));
  // Primary only when the entity has exactly one V2 value.
  assert.equal((backfill.match(/set is_primary = true\s+where not a\.is_primary and \(select count\(\*\)/g) ?? []).length, 5);
  // Hours: every day must be well-formed; an all-closed week is a suggestion; never invents.
  assert.match(backfill, /if open_days = 0 then/);
  assert.match(backfill, /'\{"hours_status": "event_only"\}'::jsonb/);
  assert.match(backfill, /and l\.hours_status is null\s+and not exists \(select 1 from public\.location_hours h where h\.location_id = l\.id\)/);
  assert.doesNotMatch(backfill, /update public\.locations set hours\b/, "locations.hours stays the live source");
});

test("staged rows never leak into V1: RLS, the V1 reference guard, and every service-role V1 reader", () => {
  assert.match(SQL, /alter policy "Public read categories" on public\.categories using \(status <> 'staged'\);/);
  for (const [table, col] of [["business_categories", "category_id"], ["event_categories", "category_id"], ["event_formats", "category_id"], ["product_categories", "category_id"], ["locations", "category_id"]])
    assert.match(SQL, new RegExp(`on public\\.${table} for each row execute function public\\.categories_v1_reference_guard\\('${col}'\\)`), table);
  assert.match(SQL, /function public\.categories_v1_reference_guard\(\)\nreturns trigger\nlanguage plpgsql\nsecurity definer/);
  // Service-role readers bypass RLS — each one excludes staged rows.
  const readers = [
    "src/app/admin/(protected)/locations/import/actions.ts",
    "src/app/api/webhooks/tally/route.ts",
    "src/lib/admin/queries.ts",
    "src/lib/admin/categoryForm.ts",
    "src/lib/discovery/commercial-server.ts",
    "src/lib/location-import/server.ts",
    "src/lib/event-formats-server.ts",
    "src/lib/event-categories-server.ts",
  ];
  for (const f of readers) assert.match(read(f), /\.neq\("status", STAGED_CATEGORY_STATUS\)/, f);
  assert.equal((read("src/app/(public)/account/business/actions.ts").match(/\.neq\("status", STAGED_CATEGORY_STATUS\)/g) ?? []).length, 2, "owner category validations");
  assert.equal((read("src/lib/admin/queries.ts").match(/\.neq\("status", STAGED_CATEGORY_STATUS\)/g) ?? []).length, 2, "admin count + list");
  assert.match(read("src/lib/category-status.ts"), /export const STAGED_CATEGORY_STATUS = "staged";/);
});

test("V2-only tables: server-only, kind-typed, tree-membership and depth guarded", () => {
  for (const t of ["category_tree_v2", "business_category_assignments", "event_category_assignments", "product_category_assignments"]) {
    assert.match(SQL, new RegExp(`create table if not exists public\\.${t} \\(`));
    assert.ok(SQL.slice(SQL.indexOf("5. access")).includes(`'${t}'`), `${t} locked down`);
  }
  assert.doesNotMatch(SQL, /create policy/i);
  for (const k of ["business", "event", "product"]) assert.match(SQL, new RegExp(`category_kind text not null default '${k}' check \\(category_kind = '${k}'\\)`));
  assert.match(SQL, /v_max := case new\.kind when 'event' then 1 when 'business' then 2 else 3 end;/);
  assert.match(SQL, /execute function public\.category_v2_member_guard\(\)/);
  assert.match(SQL, /create trigger location_categories_v2_guard/);
  for (const k of ["business", "event", "product"]) assert.match(SQL, new RegExp(`${k}_category_assignments_one_primary_idx on public\\.${k}_category_assignments \\(${k}_id\\) where is_primary`));
});

test("current V1 reads unchanged: no app code reads the V2 tables; V1 data readers untouched", () => {
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) files.push(p);
    }
  };
  walk(join(ROOT, "src"));
  const V2 = /from\("(category_tree_v2|business_category_assignments|event_category_assignments|product_category_assignments|location_categories|taxonomy_legacy_mappings|classification_suggestions)"\)/;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, V2, f);
    if (!/taxonomy[\\/]v2(-legacy)?\.ts$/.test(f)) assert.doesNotMatch(src, /lib\/taxonomy\/v2|taxonomy\/v2-legacy/, `${f} imports V2`);
  }
  // V1 public readers rely on RLS (anon client) and are not edited.
  assert.doesNotMatch(read("src/lib/data.ts"), /STAGED_CATEGORY_STATUS|category_tree_v2/);
  assert.match(read("src/lib/discovery/server.ts"), /from\("discovery_topics"\)/);
});
