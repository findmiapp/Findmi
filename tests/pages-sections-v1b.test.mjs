// Pages + Sections V1B — Entity Results (Manual / Dynamic / Hybrid with
// includes, exclusions and pins), Text & Editorial, Map, the Guide section
// tree, the Admin authoring surface and the additive migration. Pure logic
// runs directly; route / Admin structure is proven at source level (no JSX
// harness), same as the V1A suite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/headers") return { url: "data:text/javascript,export const cookies=async()=>({get(){return undefined}});export const headers=async()=>new Map();", shortCircuit: true };
    if (specifier === "react") return { url: "data:text/javascript,export const cache=(f)=>f", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const P = await import("../src/lib/page-sections.ts");
const S = await import("../src/lib/section-types.ts");
const G = await import("../src/lib/guides.ts");
const H = await import("../src/lib/homepage-rows.ts");

const ROOT = process.cwd();
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const SQL = read("supabase/migrations/20261120000000_pages_sections_v1b.sql");
const VIEW = read("src/components/guides/GuideView.tsx");
const ACTIONS = read("src/app/admin/(protected)/site/pages/actions.ts");
const EDITOR = read("src/app/admin/(protected)/site/pages/[id]/page.tsx");
const LIST = read("src/app/admin/(protected)/site/pages/page.tsx");
const PREVIEW = read("src/app/admin/(protected)/site/pages/[id]/preview/page.tsx");
const RESOLVER = read("src/lib/page-sections-server.ts");
const FORM = read("src/components/admin/pages/EntityResultsForm.tsx");
const HOME = read("src/app/(public)/page.tsx");

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ref = (kind, n) => ({ kind, id: id(n) });

const row = (o = {}) => ({
  id: "r1",
  title: "Section",
  subtitle: null,
  content_type: null,
  mode: "dynamic",
  category_slug: null,
  featured_only: false,
  time_window: null,
  item_limit: 8,
  curated_ids: [],
  pinned_ids: [],
  is_visible: true,
  sort_order: 10,
  page_id: "p1",
  parent_id: null,
  section_type: "entity_results",
  config: {},
  market_slug: null,
  area_slug: null,
  created_at: "",
  updated_at: "",
  ...o,
});

// ------------------------------------------------------------ migration

test("migration: additive + idempotent — one jsonb column, widened checks, no data written", () => {
  assert.match(SQL, /add column if not exists config jsonb not null default '\{\}'::jsonb/);
  assert.match(SQL, /jsonb_typeof\(config\) = 'object' and pg_column_size\(config\) <= 32768/);
  assert.match(SQL, /array\['feed', 'group', 'entity_results', 'rich_text', 'map'\]/);
  assert.match(SQL, /section_type = 'feed' and content_type = any \(array\['businesses', 'events', 'products', 'business_showcase'\]\)/, "feed rule unchanged");
  assert.match(SQL, /section_type in \('group', 'entity_results', 'rich_text', 'map'\) and content_type is null/);
  for (const c of ["homepage_rows_config_check", "homepage_rows_section_type_check", "homepage_rows_content_type_check"]) assert.match(SQL, new RegExp(`drop constraint if exists ${c};`));
  const code = SQL.replace(/--.*$/gm, "");
  assert.doesNotMatch(code, /\b(insert into|update public\.|delete from|drop table|drop column|create table|truncate|rename)\b/i);
  assert.doesNotMatch(code, /policy|grant|trigger/i, "policies, grants and the group triggers untouched");
  assert.match(code, /^\s*begin;[\s\S]*commit;\s*$/);
});

// ------------------------------------------------------------ fail-closed

test("fail closed: V1B Sections never reach the homepage or legacy feed paths", async () => {
  const valid = row({ config: P.defaultEntityConfig("events") });
  assert.equal(S.isLegacyFeedRow(valid), false);
  assert.deepEqual(await H.resolveHomepageRowItems(valid), { contentType: "unsupported", items: [] });
  assert.equal(H.findPrimaryBusinessesRowId([valid]), null);
  assert.match(HOME, /const homepageRows = allHomepageRows\.filter\(isLegacyFeedRow\);/, "homepage composition untouched");
  assert.match(ACTIONS, /if \(page\.is_system && isPageSectionKind\(choice\.sectionType\)\) redirect/, "no V1B Sections on the system Homepage");
  assert.match(ACTIONS, /The legacy Feed \/ Group form never rewrites a V1B Section/);
});

test("Guide tree: valid V1B Sections render in order; invalid / missing config and unknown types are skipped; Groups may hold them", () => {
  const rows = [
    row({ id: "text", sort_order: 10, section_type: "rich_text", config: { body: "Hello" } }),
    row({ id: "today", sort_order: 20, config: P.defaultEntityConfig("events") }),
    row({ id: "bad", sort_order: 25, config: { scope: "events", mode: "dynamic", sneaky: true } }),
    row({ id: "nocfg", sort_order: 26, config: undefined }),
    row({ id: "banner", sort_order: 27, section_type: "banner", config: {} }),
    row({ id: "wrongct", sort_order: 28, content_type: "events", config: P.defaultEntityConfig("events") }),
    row({ id: "hidden", sort_order: 29, is_visible: false, config: P.defaultEntityConfig("brands") }),
    row({ id: "grp", sort_order: 30, section_type: "group", title: "Race Weekend" }),
    row({ id: "g-map", parent_id: "grp", sort_order: 2, section_type: "map", config: { sections: [] } }),
    row({ id: "g-brands", parent_id: "grp", sort_order: 1, config: P.defaultEntityConfig("brands") }),
    row({ id: "g-bad", parent_id: "grp", sort_order: 3, section_type: "map", config: { sections: ["not-a-uuid"] } }),
    row({ id: "legacy", sort_order: 40, section_type: "feed", content_type: "events", config: {} }),
  ];
  const tree = G.buildGuideSections(rows);
  assert.deepEqual(tree.map((n) => `${n.kind}:${n.row.id}`), ["block:text", "block:today", "group:grp", "feed:legacy"]);
  assert.equal(tree[1].section.kind, "entity_results");
  assert.deepEqual(tree[2].children.map((c) => c.id), ["g-brands", "g-map"]);
  assert.equal(G.guideBlockOf(rows[2]), null, "unknown config key → not rendered");
});

// ------------------------------------------------------------ config

test("config validation is strict and scope-aware", () => {
  assert.equal(P.parseSectionConfig("entity_results", { scope: "events", mode: "dynamic", extra: 1 }).ok, false);
  assert.equal(P.parseSectionConfig("entity_results", { scope: "moments", mode: "dynamic" }).ok, false);
  assert.equal(P.parseSectionConfig("entity_results", { scope: "events", mode: "dynamic", limit: 99 }).ok, false, "≤ 24 items");
  assert.equal(P.parseSectionConfig("entity_results", { scope: "events", mode: "dynamic", filters: { from: "2026-11-02", to: "2026-10-26" } }).ok, false, "range ends before it starts");
  assert.equal(P.parseSectionConfig("entity_results", { scope: "events", mode: "dynamic", filters: { taxonomyV2: ["x"] } }).ok, false, "no Taxonomy V2 filter");
  assert.equal(P.parseSectionConfig("entity_results", { scope: "events", mode: "dynamic", includes: Array.from({ length: 51 }, (_, i) => ref("event", i)) }).ok, false, "≤ 50 refs");

  const r = P.parseSectionConfig("entity_results", {
    scope: "brands",
    mode: "hybrid",
    filters: { when: "today", categories: ["food", "food"], text: "coffee", free: true, featured: true, places: [id(1)] },
    includes: [ref("business", 1), ref("event", 2), ref("business", 1), ref("business", 3)],
    pins: [ref("business", 3), ref("business", 4)],
    excludes: [ref("business", 4)],
  });
  assert.ok(r.ok);
  const c = r.value.config;
  assert.deepEqual(c.filters, { categories: ["food"], text: "coffee", featured: true }, "only what Brands can answer; deduped");
  assert.deepEqual(c.excludes, [ref("business", 4)]);
  assert.deepEqual(c.pins, [ref("business", 3)], "an excluded entity is never pinned");
  assert.deepEqual(c.includes, [ref("business", 1)], "wrong-kind, duplicate and already-pinned refs dropped");
  assert.equal(c.limit, 12);
  assert.equal(c.layout, "carousel");

  const d = P.parseSectionConfig("entity_results", { scope: "events", mode: "dynamic", filters: { date: "2026-11-01", from: "2026-10-26", to: "2026-11-02", when: "weekend" } });
  assert.deepEqual(d.value.config.filters, { date: "2026-11-01" }, "a single date beats a range and a window");
  const e = P.parseSectionConfig("entity_results", { scope: "events", mode: "dynamic", filters: { from: "2026-10-26", to: "2026-11-02", when: "weekend" } });
  assert.deepEqual(e.value.config.filters, { from: "2026-10-26", to: "2026-11-02" });
});

test("Events & Appearances scope keeps every supported filter; Products keep text / featured / brand only", () => {
  const all = { when: "upcoming", categories: ["running"], formats: ["pop-up"], text: "medal", brands: [id(1)], places: [id(2)], free: true, family: true, rsvp: true, tickets: true, featured: true, endingSoon: true, justAnnounced: true };
  const ev = P.parseSectionConfig("entity_results", { scope: "events", mode: "dynamic", filters: all });
  assert.deepEqual(Object.keys(ev.value.config.filters).sort(), Object.keys(all).sort());
  const pr = P.parseSectionConfig("entity_results", { scope: "products", mode: "dynamic", filters: all });
  assert.deepEqual(Object.keys(pr.value.config.filters).sort(), ["brands", "featured", "text"]);
  const pl = P.parseSectionConfig("entity_results", { scope: "places", mode: "dynamic", filters: all });
  assert.deepEqual(Object.keys(pl.value.config.filters).sort(), ["categories", "text"]);
});

// ------------------------------------------------------------ composition

const resolved = new Map([
  ["event:a", "A"],
  ["event:b", "B"],
  ["appearance:p", "P"],
]);
const dyn = ["event:x", "event:b", "event:y", "event:z", "appearance:p"].map((key) => ({ key, item: key.split(":")[1].toUpperCase() }));
const R = (kind, i) => ({ kind, id: i });
const compose = (mode, o = {}) => P.composeEntityResults({ mode, pins: [], includes: [], excludes: [], resolved, dynamic: dyn, limit: 24, ...o });

test("Manual: only the picks, in order; unresolvable picks drop out; filters and exclusions don't apply", () => {
  const out = compose("manual", { includes: [R("event", "b"), R("event", "gone"), R("event", "a")], pins: [R("appearance", "p")] });
  assert.deepEqual(out.map((o) => [o.key, o.origin]), [["event:b", "included"], ["event:a", "included"]]);
});

test("Dynamic: the query's results minus exclusions; picks and pins ignored", () => {
  const out = compose("dynamic", { includes: [R("event", "a")], pins: [R("event", "a")], excludes: [R("event", "y")], limit: 3 });
  assert.deepEqual(out.map((o) => o.key), ["event:x", "event:b", "event:z"]);
  assert.ok(out.every((o) => o.origin === "auto"));
});

test("Hybrid: pins first, then picks, then the query fills; no duplicates; exclusions always win; limit last", () => {
  const out = compose("hybrid", { pins: [R("appearance", "p")], includes: [R("event", "a"), R("event", "b")], excludes: [R("event", "x")], limit: 5 });
  assert.deepEqual(out.map((o) => [o.key, o.origin]), [
    ["appearance:p", "pinned"],
    ["event:a", "included"],
    ["event:b", "included"],
    ["event:y", "auto"],
    ["event:z", "auto"],
  ]);
  const ex = compose("hybrid", { pins: [R("event", "a")], excludes: [R("event", "a")] });
  assert.ok(!ex.some((o) => o.key === "event:a"), "an excluded pin never shows");
  assert.deepEqual(P.manualRefs({ mode: "dynamic", pins: [R("event", "a")], includes: [R("event", "b")] }), []);
  assert.deepEqual(P.manualRefs({ mode: "manual", pins: [R("event", "a")], includes: [R("event", "b")] }), [R("event", "b")]);
});

test("Preview Results actions: pin / unpin, exclude / restore, include / remove — persisted by stable id", () => {
  let c = P.defaultEntityConfig("events");
  c = P.applyRefAction(c, "pin", ref("appearance", 1));
  assert.equal(c.mode, "hybrid", "a pin switches Dynamic to Hybrid so it takes effect");
  assert.deepEqual(c.pins, [ref("appearance", 1)]);
  c = P.applyRefAction(c, "exclude", ref("appearance", 1));
  assert.deepEqual(c.pins, [], "excluding removes the pin");
  assert.deepEqual(c.excludes, [ref("appearance", 1)]);
  c = P.applyRefAction(c, "restore", ref("appearance", 1));
  assert.deepEqual(c.excludes, []);
  c = P.applyRefAction(c, "include", ref("event", 2));
  assert.deepEqual(c.includes, [ref("event", 2)]);
  c = P.applyRefAction(c, "remove", ref("event", 2));
  assert.deepEqual(c.includes, []);
  assert.throws(() => P.applyRefAction(c, "pin", { kind: "event", id: "nope" }), "only real ids");
  assert.deepEqual(P.applyRefAction(P.defaultEntityConfig("brands"), "pin", ref("event", 3)).pins, [], "wrong kind for the scope is dropped");
});

test("Admin form → config (unchecked lists stay saved across modes)", () => {
  const fd = new FormData();
  for (const [k, v] of [["mode", "manual"], ["when", "weekend"], ["from", "2026-10-26"], ["to", "2026-11-02"], ["category", "running"], ["format", "pop-up"], ["text", " shakeout "], ["flag", "free"], ["flag", "bogus"], ["brand", id(5)], ["place", id(6)], ["include", `event:${id(1)}`], ["pin", `appearance:${id(2)}`], ["exclude", `event:${id(3)}`], ["exclude", "garbage"], ["limit", "8"], ["layout", "grid"]]) fd.append(k, v);
  const parsed = P.parseSectionConfig("entity_results", P.entityConfigFromForm("events", fd));
  assert.ok(parsed.ok, parsed.error);
  const c = parsed.value.config;
  assert.equal(c.mode, "manual");
  assert.deepEqual(c.filters, { from: "2026-10-26", to: "2026-11-02", categories: ["running"], formats: ["pop-up"], text: "shakeout", brands: [id(5)], places: [id(6)], free: true });
  assert.deepEqual(c.pins, [ref("appearance", 2)], "kept while Manual, ready if switched back to Hybrid");
  assert.deepEqual(c.excludes, [ref("event", 3)]);
  assert.equal(c.limit, 8);
  assert.equal(c.layout, "grid");
});

// ------------------------------------------------------------ Text & Editorial

test("Text & Editorial: paragraphs, bullets, small headings and SAFE links only — never HTML", () => {
  const blocks = P.parseRichText("Race week is here.\nLine two.\n\n### Getting There\n- Take the [subway](https://mta.info)\n- See [events](/events)\n\n<script>alert(1)</script> [bad](javascript:alert(1)) [admin](/admin/x) [proto](//evil.com) [http](http://x.com)");
  assert.deepEqual(blocks[0], { type: "p", spans: [{ text: "Race week is here.\nLine two." }] });
  assert.deepEqual(blocks[1], { type: "h3", text: "Getting There" });
  assert.deepEqual(blocks[2], { type: "ul", items: [[{ text: "Take the " }, { text: "subway", href: "https://mta.info" }], [{ text: "See " }, { text: "events", href: "/events" }]] });
  assert.equal(blocks[3].type, "p");
  assert.ok(blocks[3].spans.every((s) => !s.href), "unsafe destinations stay plain text");
  assert.equal(blocks[3].spans.map((s) => s.text).join(""), "<script>alert(1)</script> bad) admin proto http", "markup is text, never interpreted");
  assert.deepEqual(P.parseRichText("  \n\n "), []);
  assert.doesNotMatch(VIEW, /dangerouslySetInnerHTML/);

  assert.equal(P.parseSectionConfig("rich_text", { body: "x", cta_label: "Go" }).ok, false, "CTA needs both");
  assert.equal(P.parseSectionConfig("rich_text", { body: "x", cta_label: "Go", cta_url: "javascript:alert(1)" }).ok, false);
  assert.equal(P.parseSectionConfig("rich_text", { body: "x", image_url: "http://x/y.jpg" }).ok, false, "https images only");
  assert.equal(P.parseSectionConfig("rich_text", { body: "x".repeat(6001) }).ok, false);
  assert.ok(P.parseSectionConfig("rich_text", { body: "x", cta_label: "Course Map", cta_url: "/guides/course" }).ok);
  const fd = new FormData();
  fd.set("body", "Hi\r\n\r\nThere");
  fd.set("image_alt", "orphan alt");
  assert.deepEqual(P.richTextConfigFromForm(fd), { body: "Hi\n\nThere" }, "alt text without an image is dropped");
});

// ------------------------------------------------------------ summaries

test("collapsed Section summary lines", () => {
  const c = { ...P.defaultEntityConfig("events"), mode: "hybrid", filters: { from: "2026-10-26", to: "2026-11-02" }, pins: [ref("event", 1), ref("event", 2)], excludes: [ref("event", 3)] };
  assert.deepEqual(P.summarizeEntitySection(c, { count: 18, place: "NYC" }), { primary: "Events & Appearances · Hybrid · 18 results", secondary: "NYC · Oct 26 – Nov 2 · 2 pinned · 1 excluded" });
  assert.deepEqual(P.summarizeEntitySection({ ...P.defaultEntityConfig("brands"), mode: "manual", includes: [ref("business", 1)] }, { count: 1 }), { primary: "Brands · Manual · 1 result", secondary: "1 picked" });
  assert.equal(P.describeWhen({ when: "weekend" }), "This Weekend");
  assert.equal(P.describeWhen({ date: "2026-11-01" }), "Nov 1");
});

// ------------------------------------------------------------ resolver (source)

test("Entity Results resolve through the existing public read helpers and Discovery engine — no parallel query system", () => {
  assert.match(RESOLVER, /getCandidates\(scope\.marketSlug/);
  assert.match(RESOLVER, /executeDiscovery\(candidates\.filter\(keep\), eventsQuery\(f\), \{ now \}\)/);
  assert.match(RESOLVER, /searchBusinesses\(\{/);
  assert.match(RESOLVER, /getLocations\(\{ q: f\.text/);
  assert.match(RESOLVER, /getHomepageRowProducts\(\{/);
  assert.match(RESOLVER, /getEventsByIds\(eventIds\)/);
  assert.match(RESOLVER, /getLocations\(\{ ids: placeIds/);
  assert.match(RESOLVER, /\.eq\("status", "approved"\)/, "only approved Brand participation");
  assert.match(RESOLVER, /RESULTS_CAP = 48/);
  assert.doesNotMatch(RESOLVER, /getAdminSupabase|requireAdmin/, "public visibility rules, also in Admin preview");
  assert.doesNotMatch(RESOLVER, /taxonomy_v2|classifications/i, "no Taxonomy V2 wiring");
});

test("eventsQuery + date-range / Featured / Brand / Place predicates", async () => {
  const { eventsQuery, extraEventPredicate } = await import("../src/lib/page-sections-server.ts");
  assert.deepEqual(eventsQuery({ when: "weekend", rsvp: true, tickets: true, free: true, endingSoon: true, justAnnounced: true, text: "run" }), {
    entities: ["event", "appearance"], when: "weekend", access: ["rsvp", "tickets"], free: true, text: "run", endingSoonHours: 48, justAnnouncedDays: 14, limit: 48,
  });
  assert.equal(eventsQuery({ when: "weekend", from: "2026-10-26" }).when, undefined, "a range replaces the window");
  const item = (o) => ({ kind: "event", id: "e1", start_at: null, end_at: null, start_date: "2026-11-01", end_date: null, is_featured: false, related: ["e1"], location_id: null, ...o });
  const none = { brandEventIds: new Set(), placeEventIds: new Set() };
  assert.equal(extraEventPredicate({ from: "2026-10-26", to: "2026-11-02" }, none)(item()), true);
  assert.equal(extraEventPredicate({ from: "2026-11-03" }, none)(item()), false);
  assert.equal(extraEventPredicate({ featured: true }, none)(item()), false);
  assert.equal(extraEventPredicate({ featured: true }, none)(item({ is_featured: true })), true);
  assert.equal(extraEventPredicate({ brands: ["b1"] }, none)(item({ related: ["e1", "b1"] })), true, "host Brand");
  assert.equal(extraEventPredicate({ brands: ["b1"] }, { ...none, brandEventIds: new Set(["e1"]) })(item()), true, "approved participant");
  assert.equal(extraEventPredicate({ brands: ["b1"] }, none)(item()), false);
  assert.equal(extraEventPredicate({ places: ["l1"] }, none)(item({ kind: "appearance", location_id: "l1" })), true);
  assert.equal(extraEventPredicate({ places: ["l1"] }, { ...none, placeEventIds: new Set(["e1"]) })(item()), true);
  assert.equal(extraEventPredicate({ places: ["l1"] }, none)(item()), false);
});

// ------------------------------------------------------------ Guide renderer + Map

test("Guide renderer: Results use the shared Discovery tiles / Product cards; Map reuses ContextMap over located entities; empty Sections drop", () => {
  assert.match(VIEW, /config\.layout === "grid" \? <DiscoveryGrid items=\{tiles\} \/> : <DiscoveryRail items=\{tiles\} \/>/);
  assert.match(VIEW, /<ProductCard product=\{product\}/);
  assert.match(VIEW, /<ContextMap results=\{map\.results\} label=\{`Map of \$\{row\.title\}`\} tall \/>/);
  assert.match(VIEW, /l\.map\.results = items\.length \? await geoForItems\(items\) : \[\];/);
  assert.match(VIEW, /const keep = \(l: ResolvedGuideLeaf\) => l\.kind !== "map" \|\| l\.map\.results\.length > 0;/, "a Map with nothing located renders nothing");
  assert.match(VIEW, /return items\.length \? \{ kind: "results"/, "an empty Results Section renders nothing");
  assert.match(VIEW, /content_type: "entity_results", scope: config\.scope, mode: config\.mode/, "same discovery_section_impression event");
  assert.match(VIEW, /pageType: "guide"/);
  const geo = read("src/lib/geo-results-server.ts");
  assert.match(geo, /export async function geoForItems/);
  assert.match(geo, /eventRowResults\(eventRows\.filter/, "Events map through the same rule as the Events archive (hidden venues respected)");
  assert.match(geo, /brandResults\(brands, presence\)/);
});

// ------------------------------------------------------------ Admin

test("Admin: Title-first Create; Sections dominate; card-choice Add Section; compact cards; grouped settings; media image fields; selectors", () => {
  assert.match(LIST, /<TextField label="Title" name="title"[^>]*required \/>/);
  assert.doesNotMatch(LIST, /name="internal_name"/, "no duplicate Internal Name on Create");
  assert.match(ACTIONS, /const internalName = str\(formData, "internal_name"\) \?\? title;/);
  assert.ok(EDITOR.indexOf(">Sections</h2>") < EDITOR.indexOf(">Page Settings</h2>"), "Sections come first");
  for (const label of ["Events & Appearances", "Brands", "Places", "Products", "Text & Editorial", "Map"]) assert.ok(EDITOR.includes(`label: "${label}"`), label);
  assert.match(EDITOR, /name="kind" value="group"/, "Groups still available, not dominant");
  for (const g of ["Basics", "Hero", "Publishing", "SEO & Sharing", "Market & Area"]) assert.match(EDITOR, new RegExp(`<SettingsGroup title="${g}"`));
  assert.match(EDITOR, /<ImageField variant="media" label="Hero Image" name="hero_image_url"/);
  assert.match(EDITOR, /<ImageField variant="media" label="Share Image" name="og_image_url"/);
  assert.match(EDITOR, /<MarketAreaFields markets=\{markets\}/);
  assert.match(EDITOR, /Legacy Category/);
  assert.match(EDITOR, /<SectionCard/);
  assert.match(EDITOR, /<DiscoverySectionMovePanel/, "existing Move controls reused");
  assert.match(EDITOR, /<PreviewResults/);
  assert.match(FORM, /name="mode" value=\{m\}/);
  assert.match(FORM, /name="exclude"/);
  assert.match(FORM, /name="pin"/);
  assert.match(read("src/components/admin/ImageField.tsx"), /variant = "url"/, "every existing ImageField caller keeps the URL layout");
  assert.match(ACTIONS, /validateMarketArea\(str\(formData, "market_slug"\), str\(formData, "area_slug"\)\)/);
  assert.match(ACTIONS, /SECTION_LIMITS\.sectionsPerPage/);
  assert.match(ACTIONS, /auditSection\(supabase, "page_section_update", id, pageId, \{ ref_action: action/);
});

test("compact Admin Preview bar: one line, noindex, draft state, Back To Editor", () => {
  assert.match(PREVIEW, /py-1\.5/);
  assert.match(PREVIEW, /truncate text-xs font-bold text-amber-900/);
  assert.match(PREVIEW, /Draft Preview · Not Public/);
  assert.match(PREVIEW, /Back To Editor/);
  assert.match(PREVIEW, /robots: \{ index: false, follow: false \}/);
});

// ------------------------------------------------------------ acceptance case

test("acceptance: a Marathon-week style Guide composes from generic Sections only (no Marathon-specific code)", () => {
  const ev = (n, filters, extra = {}) => row({ id: `s${n}`, sort_order: n * 10, config: { ...P.defaultEntityConfig("events"), filters, ...extra } });
  const rows = [
    row({ id: "intro", sort_order: 5, section_type: "rich_text", config: { body: "Everything around race week.\n\n- [Course map](https://example.com/course)" } }),
    ev(1, { when: "today" }),
    ev(2, { from: "2026-10-26", to: "2026-11-02", featured: true }, { mode: "hybrid", pins: [ref("event", 9)] }),
    ev(3, { text: "shakeout", from: "2026-10-26", to: "2026-11-02" }),
    ev(4, { formats: ["pop-up"] }),
    ev(5, { categories: ["talks"] }),
    ev(6, { categories: ["nightlife"], when: "weekend" }),
    ev(7, { text: "cheer", date: "2026-11-01" }),
    ev(8, { text: "recovery", date: "2026-11-02" }),
    row({ id: "brands", sort_order: 90, config: { ...P.defaultEntityConfig("brands"), mode: "manual", includes: [ref("business", 1)] } }),
    row({ id: "map", sort_order: 100, section_type: "map", config: { sections: [] } }),
  ];
  const tree = G.buildGuideSections(rows);
  assert.equal(tree.length, 11);
  assert.deepEqual(tree.map((n) => n.section.kind), ["rich_text", ...Array(8).fill("entity_results"), "entity_results", "map"]);
  for (const f of ["src/lib/page-sections.ts", "src/lib/page-sections-server.ts", "src/components/guides/GuideView.tsx", "src/app/admin/(protected)/site/pages/actions.ts"]) {
    assert.doesNotMatch(read(f), /marathon/i, `${f} has no Marathon-specific logic`);
  }
});
