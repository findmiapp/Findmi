// Taxonomy V2 — Pass 1 foundation. The REAL domain module
// (src/lib/taxonomy/v2.ts) and the REAL migration text, checked against
// each other: vocabulary uniqueness, hierarchy integrity, alias targets,
// hours representation, CHECK lists, provenance, access, and that nothing
// reads V2 yet. (The migration itself was also applied twice to a scratch
// Postgres 16 with production-shaped tables — see the Pass 1 report.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { transform } = require("sucrase");
registerHooks({
  load(url, ctx, next) {
    if (url.endsWith(".ts")) return { format: "module", source: transform(readFileSync(fileURLToPath(url), "utf8"), { transforms: ["typescript"] }).code, shortCircuit: true };
    return next(url, ctx);
  },
});

const ROOT = process.cwd();
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const T = await import(pathToFileURL(join(ROOT, "src/lib/taxonomy/v2.ts")).href);
const V1 = await import(pathToFileURL(join(ROOT, "src/lib/discovery/attributes.ts")).href);
const MIGRATION = "supabase/migrations/20261116000000_taxonomy_v2_foundation.sql";
const SQL = read(MIGRATION);

const dupes = (xs) => xs.filter((x, i) => xs.indexOf(x) !== i);
/** The text[] literal of a named CHECK in the migration. */
const checkArray = (re) => {
  const m = re.exec(SQL);
  assert.ok(m, `CHECK not found: ${re}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};
const flatten = (nodes, depth = 1, parent = null) => nodes.flatMap((n) => [{ ...n, depth, parent }, ...flatten(n.children ?? [], depth + 1, n.slug)]);

test("the migration embeds the launch vocabulary generated from the domain module, verbatim", () => {
  const generated = execFileSync(process.execPath, ["scripts/taxonomy-v2-seed-sql.mjs"], { cwd: ROOT, encoding: "utf8" });
  assert.ok(SQL.includes(generated), "re-run: node scripts/taxonomy-v2-seed-sql.mjs and paste into the migration");
});

test("controlled vocabularies: unique slugs, the approved launch values, Types/Mechanics are terms — not Categories", () => {
  for (const v of T.TERM_VOCABULARIES) {
    const slugs = T.TERM_SEEDS[v].map((t) => t.slug);
    assert.deepEqual(dupes(slugs), [], v);
    for (const s of slugs) assert.match(s, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  }
  assert.equal(T.EVENT_TYPE_SEEDS.length, 23);
  assert.equal(T.EXPERIENCE_MECHANIC_SEEDS.length, 9);
  assert.equal(T.APPEARANCE_TYPE_SEEDS.length, 9);
  assert.deepEqual(T.APPEARANCE_TYPE_SEEDS.map((t) => t.name), ["Pop-Up", "Sampling & Demo", "Vendor Booth", "In-Store Appearance", "Activation", "Guest Appearance", "Mobile Stop", "Pickup Point", "Other"]);
  assert.match(SQL, /create table if not exists public\.taxonomy_terms \(/);
  assert.match(SQL, /vocabulary text not null check \(vocabulary in \('event_type', 'experience_mechanic', 'appearance_type', 'opportunity_category'\)\)/);
  assert.doesNotMatch(SQL, /categories_kind_check/, "the categories kind list is not extended with Types/Mechanics");
  assert.doesNotMatch(SQL, /insert into public\.categories/i, "no Category rows are seeded in Pass 1");
  // Typed joins: a term of the wrong vocabulary cannot be attached.
  assert.match(SQL, /foreign key \(term_id, vocabulary\) references public\.taxonomy_terms \(id, vocabulary\)/);
  assert.match(SQL, /execute function public\.taxonomy_term_column_guard\('appearance_type_id', 'appearance_type'\)/);
});

test("code-controlled dimensions: TS lists == the migration's CHECK lists, and V1 values stay valid", () => {
  assert.deepEqual(checkArray(/events_audience_check check \(audience <@ array\[([^\]]+)\]/), [...T.AUDIENCES]);
  assert.deepEqual(checkArray(/events_entry_modes_check check \(entry_modes <@ array\[([^\]]+)\]/), [...T.ENTRY_MODES]);
  assert.deepEqual(checkArray(/events_benefits_check check \(benefits <@ array\[([^\]]+)\]/), [...T.LEGACY_BENEFITS, ...T.BENEFITS]);
  assert.deepEqual(checkArray(/events_price_kind_check check \(price_kind is null or price_kind in \(([^)]+)\)/), [...T.PRICE_KINDS]);
  assert.deepEqual(checkArray(/events_setting_check check \(setting is null or setting in \(([^)]+)\)/), [...T.SETTINGS]);
  assert.deepEqual(checkArray(/business_models <@ array\[([^\]]+)\]/), [...T.BUSINESS_MODELS]);
  for (const v of V1.EVENT_AUDIENCES) assert.ok(T.AUDIENCES.includes(v), `V1 audience ${v}`);
  for (const v of V1.ENTRY_MODES) assert.ok(T.ENTRY_MODES.includes(v), `V1 entry mode ${v}`);
  for (const v of V1.EVENT_BENEFITS) assert.ok([...T.BENEFITS, ...T.LEGACY_BENEFITS].includes(v), `V1 benefit ${v}`);
  assert.ok(!T.BENEFITS.includes("free_admission"), "Free admission is price_kind, not a Benefit");
  assert.ok(T.ENTRY_MODES.includes("rsvp") && T.ENTRY_MODES.includes("registration"), "RSVP and Registration stay distinct");
  assert.ok(!T.PRICE_KINDS.includes("unknown"), "unknown price is NULL");
  assert.equal(T.OPEN_LATE_MINUTE, 22 * 60);
  // Unknown stays unknown: no new column defaults to a classification.
  assert.match(SQL, /add column if not exists price_kind text;/);
  assert.match(SQL, /add column if not exists setting text;/);
  assert.match(SQL, /add column if not exists all_day boolean;/);
  assert.match(SQL, /add column if not exists hours_status text;/);
});

test("services are not products; no ownership/identity attributes; no price level", () => {
  assert.ok(T.BUSINESS_MODELS.includes("service_provider"));
  assert.doesNotMatch(read("src/lib/taxonomy/v2.ts"), /product_type/);
  assert.doesNotMatch(SQL, /alter[^;]*product_type|update public\.products/i, "existing product_type rows untouched");
  for (const k of T.ATTRIBUTE_SEEDS.map((d) => d.key)) assert.doesNotMatch(k, /owned|black|women|lgbt/);
  assert.doesNotMatch(SQL, /price_level/);
});

test("Category trees (staged in Pass 2): unique slugs per kind, depth limits, Event Domain is ONE level", () => {
  const trees = { event: T.V2_EVENT_DOMAINS, location: T.V2_LOCATION_TREE, business: T.V2_BUSINESS_TREE, product: T.V2_PRODUCT_TREE };
  for (const [kind, tree] of Object.entries(trees)) {
    const nodes = flatten(tree);
    assert.deepEqual(dupes(nodes.map((x) => x.slug)), [], `${kind} slugs unique`);
    assert.ok(Math.max(...nodes.map((x) => x.depth)) <= T.CATEGORY_MAX_DEPTH[kind], `${kind} depth`);
    for (const x of nodes) assert.match(x.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  }
  assert.deepEqual(T.V2_EVENT_DOMAINS.map((d) => d.name), ["Food & Drink", "Arts & Culture", "Music & Nightlife", "Entertainment", "Shopping & Style", "Beauty & Wellness", "Sports & Fitness", "Outdoors & Nature", "Business & Tech", "Community & Causes", "Home & Lifestyle"]);
  assert.ok(T.V2_EVENT_DOMAINS.every((d) => !d.children), "no Event subcategories");
  // (Pass 2 refined the trees to the founder's staged structure; full
  // tree/mapping coverage lives in tests/taxonomy-v2-pass2.test.mjs.)
  const cafe = flatten(T.V2_LOCATION_TREE).find((x) => x.slug === "cafe-coffee-shop");
  assert.equal(cafe.parent, "food-drink");
  assert.deepEqual(T.V2_LOCATION_TREE.map((x) => x.name), ["Food & Drink", "Shopping", "Arts & Culture", "Event & Community Spaces", "Outdoors", "Health & Wellness", "Hospitality", "Work & Education", "Landmarks"]);
  for (const imp of T.V2_CATEGORY_TOPIC_IMPLICATIONS) {
    assert.ok(flatten(trees[imp.kind]).some((x) => x.slug === imp.slug), `${imp.kind}/${imp.slug} exists`);
    for (const t of imp.topics) assert.ok(T.TOPIC_SEEDS.some((x) => x.slug === t), t);
  }
});

test("Topics: unique, acyclic, obvious parents only, subject/occasion, applicable to the five entity types", () => {
  const slugs = T.TOPIC_SEEDS.map((t) => t.slug);
  assert.deepEqual(dupes(slugs), []);
  assert.equal(slugs.length, 53);
  const byslug = new Map(T.TOPIC_SEEDS.map((t) => [t.slug, t]));
  for (const t of T.TOPIC_SEEDS) {
    assert.ok(T.TOPIC_KINDS.includes(t.kind));
    const seen = new Set([t.slug]);
    for (let p = t.broader; p; p = byslug.get(p).broader) {
      assert.ok(byslug.has(p), `${t.slug} → ${p}`);
      assert.ok(!seen.has(p), `cycle at ${t.slug}`);
      seen.add(p);
    }
  }
  assert.ok(T.TOPIC_SEEDS.filter((t) => t.broader).length <= 12, "no complex hierarchy");
  assert.deepEqual([...T.DEFAULT_TOPIC_APPLIES_TO], ["business", "location", "event", "product", "appearance"]);
  assert.ok(!slugs.includes("kids") && !slugs.includes("family"), "Family/Kids are Audience, not Topics");
  assert.match(SQL, /execute function public\.topic_link_guard\('business'\)/);
  assert.match(SQL, /execute function public\.topics_hierarchy_guard\(\)/);
  assert.doesNotMatch(SQL, /alter table public\.discovery_topics|update public\.discovery_topics|insert into public\.discovery_topics/, "discovery_topics untouched");
  for (const e of ["business", "location", "event", "product", "appearance"]) assert.match(SQL, new RegExp(`create table if not exists public\\.${e}_topics \\(`));
  assert.doesNotMatch(SQL, /moment_topics|person_topics/);
});

test("aliases: normalized, unique per (phrase, dimension, target), every target exists, scoped where ambiguous", () => {
  const codes = { audience: T.AUDIENCES, entry_mode: T.ENTRY_MODES, price_kind: T.PRICE_KINDS, setting: T.SETTINGS, benefit: T.BENEFITS, business_model: T.BUSINESS_MODELS, attribute: T.ATTRIBUTE_SEEDS.map((d) => d.key), entity_type: T.TAXONOMY_ENTITY_TYPES };
  const ids = { topic: T.TOPIC_SEEDS.map((t) => t.slug), event_type: T.EVENT_TYPE_SEEDS.map((t) => t.slug), experience_mechanic: T.EXPERIENCE_MECHANIC_SEEDS.map((t) => t.slug), appearance_type: T.APPEARANCE_TYPE_SEEDS.map((t) => t.slug) };
  const keys = T.ALIAS_SEEDS.map((s) => `${T.normalizeAliasPhrase(s.phrase)}|${s.dimension}|${s.target}`);
  assert.deepEqual(dupes(keys), []);
  for (const s of T.ALIAS_SEEDS) {
    const pool = codes[s.dimension] ?? ids[s.dimension];
    assert.ok(pool, `${s.phrase}: dimension ${s.dimension} seeded`);
    assert.ok(pool.includes(s.target), `${s.phrase} → ${s.dimension}:${s.target}`);
    for (const e of s.entityTypes ?? []) assert.ok(T.TAXONOMY_ENTITY_TYPES.includes(e));
  }
  // One phrase may legitimately reach several concepts — each scoped.
  const popUp = T.ALIAS_SEEDS.filter((s) => s.phrase === "pop up");
  assert.deepEqual(popUp.map((s) => `${s.dimension}:${s.entityTypes}`), ["experience_mechanic:event", "appearance_type:appearance"]);
  assert.ok(!T.ALIAS_SEEDS.some((s) => s.phrase === "market" && s.dimension === "region"), "'market' never means a Region");
  assert.deepEqual(T.ALIAS_SEEDS.filter((s) => s.phrase === "kids").map((s) => s.dimension), ["audience"]);
  assert.match(SQL, /execute function public\.taxonomy_aliases_guard\(\)/);
  assert.match(SQL, /phrase = lower\(btrim\(regexp_replace\(phrase, '\\s\+', ' ', 'g'\)\)\)/);
});

test("Location multi-category: typed to location categories, one primary, legacy category_id untouched", () => {
  assert.match(SQL, /create table if not exists public\.location_categories \(/);
  assert.match(SQL, /category_kind text not null default 'location' check \(category_kind = 'location'\)/);
  assert.match(SQL, /foreign key \(category_id, category_kind\) references public\.categories \(id, kind\)/);
  assert.match(SQL, /location_categories_one_primary_idx on public\.location_categories \(location_id\) where is_primary/);
  assert.doesNotMatch(SQL, /alter table public\.locations (drop|alter) column (category_id|hours)/);
});

test("hours: the nine required examples are representable and valid; ambiguity is rejected", () => {
  const m = T.minutesOf;
  const base = { timezone: "America/New_York", exceptions: [] };
  const daily = (days, open, close) => days.map((weekday) => ({ weekday, openMinute: m(open), closeMinute: close }));
  const examples = {
    "1 café Mon 7–14 + 16–23": { ...base, status: "regular", weekly: [{ weekday: 1, openMinute: m("07:00"), closeMinute: m("14:00") }, { weekday: 1, openMinute: m("16:00"), closeMinute: m("23:00") }] },
    "2 bar Fri 17:00 → Sat 02:00": { ...base, status: "regular", weekly: [{ weekday: 5, openMinute: m("17:00"), closeMinute: 1440 + m("02:00") }] },
    "3 open 24 hours": { ...base, status: "regular", weekly: daily([1, 2, 3, 4, 5, 6, 7], "00:00", 1440) },
    "4 closed Sunday": { ...base, status: "regular", weekly: daily([1, 2, 3, 4, 5, 6], "10:00", m("18:00")) },
    "5 Mon 9–5, closed Christmas": { ...base, status: "regular", weekly: daily([1], "09:00", m("17:00")), exceptions: [{ startsOn: "2028-12-25", endsOn: "2028-12-25", kind: "closed", reason: "holiday", label: "Christmas", periods: [] }] },
    "6 Sat 10–8, special 8–23 one Saturday": { ...base, status: "regular", weekly: daily([6], "10:00", m("20:00")), exceptions: [{ startsOn: "2026-11-07", endsOn: "2026-11-07", kind: "special_hours", reason: "special_event", periods: [{ openMinute: m("08:00"), closeMinute: m("23:00") }] }] },
    "7 temporarily closed Oct 20–Nov 5": { ...base, status: "regular", weekly: daily([1, 2, 3, 4, 5, 6, 7], "07:00", m("15:00")), exceptions: [{ startsOn: "2026-10-20", endsOn: "2026-11-05", kind: "closed", reason: "temporary_closure", periods: [] }] },
    "8 unknown": { ...base, status: null, weekly: [] },
    "9 event-only venue": { ...base, status: "event_only", weekly: [] },
  };
  for (const [label, h] of Object.entries(examples)) assert.deepEqual(T.validateHours(h), [], label);
  // The bar's overnight period occupies Saturday 00:00–02:00 on the week circle.
  assert.deepEqual(T.weekRanges(examples["2 bar Fri 17:00 → Sat 02:00"].weekly[0]), [[4 * 1440 + 1020, 5 * 1440 + 120]]);
  // Sunday night wraps into Monday morning.
  assert.deepEqual(T.weekRanges({ weekday: 7, openMinute: 1200, closeMinute: 1620 }), [[6 * 1440 + 1200, 10080], [0, 180]]);
  const bad = (h) => assert.notDeepEqual(T.validateHours({ ...base, exceptions: [], ...h }), []);
  bad({ status: "regular", weekly: [{ weekday: 5, openMinute: 1020, closeMinute: 1560 }, { weekday: 6, openMinute: 60, closeMinute: 600 }] });
  bad({ status: "regular", weekly: [{ weekday: 7, openMinute: 1200, closeMinute: 1620 }, { weekday: 1, openMinute: 60, closeMinute: 300 }] });
  bad({ status: "regular", weekly: [{ weekday: 1, openMinute: 420, closeMinute: 900 }, { weekday: 1, openMinute: 840, closeMinute: 1000 }] });
  bad({ status: "regular", weekly: [{ weekday: 1, openMinute: 1440, closeMinute: 1500 }] });
  bad({ status: "regular", weekly: [{ weekday: 1, openMinute: 600, closeMinute: 600 + 1441 }] });
  bad({ status: "regular", weekly: [] });
  bad({ status: null, weekly: [{ weekday: 1, openMinute: 600, closeMinute: 900 }] });
  bad({ status: "event_only", weekly: [{ weekday: 1, openMinute: 600, closeMinute: 900 }] });
  bad({ status: "regular", weekly: [{ weekday: 1, openMinute: 600, closeMinute: 900 }], exceptions: [{ startsOn: "2026-12-24", endsOn: "2026-12-26", kind: "closed", periods: [] }, { startsOn: "2026-12-26", endsOn: "2026-12-27", kind: "closed", periods: [] }] });
  bad({ status: "regular", weekly: [{ weekday: 1, openMinute: 600, closeMinute: 900 }], exceptions: [{ startsOn: "2026-12-24", endsOn: "2026-12-24", kind: "closed", periods: [{ openMinute: 600, closeMinute: 700 }] }] });
  // The database enforces the same shape (minutes, not "24:00"; overnight via close > 1440).
  assert.match(SQL, /open_minute smallint not null check \(open_minute between 0 and 1439\)/);
  assert.match(SQL, /check \(close_minute > open_minute and close_minute <= open_minute \+ 1440\)/);
  assert.match(SQL, /weekday smallint not null check \(weekday between 1 and 7\)/);
  assert.match(SQL, /execute function public\.location_hours_overlap_guard\(\)/);
  assert.match(SQL, /execute function public\.location_hours_exceptions_guard\(\)/);
  assert.deepEqual(checkArray(/hours_status in \(([^)]+)\)\);/), [...T.HOURS_STATUSES]);
});

test("Event price/setting domain, Appearance Type and Mechanics-never-prove-Benefits", () => {
  assert.match(SQL, /price_kind is distinct from 'free' or \(price_min_cents is null and price_max_cents is null\)/);
  assert.match(SQL, /\(price_min_cents is null and price_max_cents is null\) or currency is not null/);
  assert.match(SQL, /add column if not exists appearance_type_id uuid references public\.taxonomy_terms \(id\)/);
  for (const t of T.TERM_VOCABULARIES.flatMap((v) => T.TERM_SEEDS[v].map((s) => ({ v, s }))))
    if (t.s.suggestsBenefits) {
      assert.equal(t.v, "experience_mechanic", "only Mechanics carry benefit hints");
      for (const b of t.s.suggestsBenefits) assert.ok(T.BENEFITS.includes(b));
    }
  assert.match(SQL, /\(vocabulary = 'experience_mechanic' or cardinality\(suggests_benefits\) = 0\)/);
  assert.doesNotMatch(SQL, /update public\.events set benefits|insert into public\.events/, "no Benefit is ever written");
});

test("attributes: typed, entity-scoped definitions; validation mirrors the trigger; dietary needs category scope", () => {
  const keys = T.ATTRIBUTE_SEEDS.map((d) => d.key);
  assert.deepEqual(dupes(keys), []);
  assert.equal(keys.length, 13);
  for (const d of T.ATTRIBUTE_SEEDS) {
    assert.ok(d.entityTypes.every((e) => T.ATTRIBUTE_ENTITY_TYPES.includes(e)));
    if (d.entityTypes.includes("product")) assert.equal(d.requiresCategoryScope, true, `${d.key} scoped`);
  }
  const defs = T.ATTRIBUTE_SEEDS.map((d) => ({ key: d.key, entityTypes: d.entityTypes, valueType: d.valueType, allowedValues: d.allowedValues }));
  assert.deepEqual(T.validateAttributes("location", { wifi: true, pet_friendly: false }, defs), []);
  assert.equal(T.validateAttributes("location", { wifi: "yes" }, defs).length, 1);
  assert.equal(T.validateAttributes("location", { vegan: true }, defs).length, 1);
  assert.equal(T.validateAttributes("product", { black_owned: true }, defs).length, 1);
  assert.equal(T.validateAttributes("product", [], defs).length, 1);
  const enumDefs = [{ key: "parking_type", entityTypes: ["location"], valueType: "multi_enum", allowedValues: ["street", "lot"] }];
  assert.deepEqual(T.validateAttributes("location", { parking_type: ["street"] }, enumDefs), []);
  assert.equal(T.validateAttributes("location", { parking_type: ["valet"] }, enumDefs).length, 1);
  assert.match(SQL, /execute function public\.validate_entity_attributes\('location'\)/);
  assert.match(SQL, /locations_attributes_idx on public\.locations using gin \(attributes jsonb_path_ops\)/);
});

test("provenance: one source vocabulary everywhere; suggestions are the only unconfirmed state", () => {
  const srcLists = [...SQL.matchAll(/source text not null check \(source in \(([^)]+)\)\)/g)].map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  assert.ok(srcLists.length >= 12, "every assignment table records its source");
  for (const l of srcLists) if (l.length !== 3) assert.deepEqual(l, [...T.PROVENANCE_SOURCES]);
  assert.match(SQL, /source text not null check \(source in \('migration', 'importer', 'suggestion'\)\)/, "suggestions come from machines/migration only");
  assert.deepEqual([...T.SUGGESTION_SOURCES], ["migration", "importer", "suggestion"]);
  assert.match(SQL, /status text not null default 'suggested' check \(status in \('suggested', 'confirmed', 'rejected'\)\)/);
  assert.match(SQL, /classification_suggestions_review_check check \(\(status = 'suggested'\) = \(reviewed_at is null\)\)/);
  assert.match(SQL, /create table if not exists public\.classification_field_sources \(/);
});

test("legacy compatibility: inactive drafts covering every V1 Event Format, pointing at seeded terms", () => {
  assert.equal(T.LEGACY_EVENT_FORMAT_MAPPINGS.length, 16);
  for (const m of T.LEGACY_EVENT_FORMAT_MAPPINGS)
    for (const t of m.targets) assert.ok(T.TERM_SEEDS[t.dimension].some((s) => s.slug === t.slug), `${m.legacySlug} → ${t.dimension}:${t.slug}`);
  assert.match(SQL, /status text not null default 'draft'/);
  assert.ok(!/'active', /.test(SQL.slice(SQL.indexOf("insert into public.taxonomy_legacy_mappings"))), "nothing seeded active");
});

test("access: every new table is server-only (RLS on, no anon/authenticated grants, no policies)", () => {
  const block = SQL.slice(SQL.indexOf("10. access"), SQL.indexOf("comment on table public.taxonomy_terms"));
  const created = [...SQL.matchAll(/create table if not exists public\.([a-z_]+) \(/g)].map((m) => m[1]);
  for (const t of created) assert.ok(block.includes(`'${t}'`), `${t} locked down`);
  assert.match(block, /enable row level security/);
  assert.match(block, /revoke all on public\.%I from public, anon, authenticated/);
  assert.doesNotMatch(SQL, /create policy/i, "no read policies yet");
  assert.doesNotMatch(SQL, /grant [a-z, ]+ to (anon|authenticated)/i);
  assert.match(SQL, /function public\.validate_entity_attributes\(\)\nreturns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = public, pg_temp/);
});

test("no accidental activation: nothing in the app reads V2 tables or imports the V2 module", () => {
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) files.push(p);
    }
  };
  walk(join(ROOT, "src"));
  const V2_TABLES = /from\("(taxonomy_terms|topics|(business|location|event|product|appearance|category)_topics|taxonomy_aliases|location_categories|location_hours[a-z_]*|attribute_definitions|attribute_definition_categories|event_type_assignments|event_mechanic_assignments|taxonomy_legacy_mappings|classification_suggestions|classification_field_sources)"\)/;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, V2_TABLES, f);
    if (!f.endsWith(join("taxonomy", "v2.ts"))) assert.doesNotMatch(src, /lib\/taxonomy\/v2|taxonomy\/v2"/, `${f} imports V2`);
  }
  // V1 discovery still uses its own vocabulary.
  assert.match(read("src/lib/discovery/server.ts"), /from\("discovery_topics"\)/);
});
