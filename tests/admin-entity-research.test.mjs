// Admin Ingestion Orchestration Completion + Contextual Entity Research V1.
// Event Import prepares missing Primary Businesses and missing Locations
// for operator review (never creates them): Findmi match first, explicit
// pasted values, the supplied official website through the existing
// extractor, and only then Anthropic's server-side web search to find /
// corroborate the official site — once per entity per batch, capped.
// Fakes only — no network, no Anthropic call, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const RS = await import("../src/lib/entity-research.ts");
const PR = await import("../src/lib/entity-prepare.ts");
const SP = await import("../src/lib/event-import/structured-paste.ts");
const O = await import("../src/lib/event-import/operator.ts");
const R = await import("../src/lib/event-import/review.ts");
const LP = await import("../src/lib/location-import/parse.ts");
const read = (p) => readFileSync(p, "utf8");
const NOW = Date.parse("2026-10-14T12:00:00Z");

// ── The three production Events ─────────────────────────────────────────

const KOOM = `Event Name: KOOM HAUS 2026
Primary Business: KOOM
Event Link: https://luma.com/wmo9zjre
Location Name: Iron23
Street Address: 29 W 23rd St
City: New York
State: NY
ZIP: 10010

Occurrence 1:
Date: October 16, 2026
Start Time: 12 PM
End Time: 8 PM

Occurrence 2:
Date: October 17, 2026
Start Time: 12 PM
End Time: 8 PM

Occurrence 3:
Date: October 18, 2026
Start Time: 12 PM
End Time: 6 PM`;

const HAOR = `Event Name: HAOR × OUWR
Primary Business: HAOR
Business Website: https://www.haor.kr
Location Name: Parasol Projects
Street Address: 21 Spring Street
City: New York
State: NY
ZIP: 10012

Occurrence 1:
Date: October 16, 2026
Start Time: 11 AM
End Time: 7 PM

Occurrence 2:
Date: October 17, 2026
Start Time: 11 AM
End Time: 7 PM`;

const BURTS = `Event Name: Burt's Bees Find Your Buzz
Primary Business: Burt's Bees
Business Website: https://www.burtsbees.com
Location Name: High Line Nine
Street Address: 507 W 27th Street
City: New York
State: NY
Date: October 18, 2026
Start Time: 10 AM
End Time: 6 PM`;

const extract = (t) => SP.extractStructuredEvent(t, { now: NOW }).candidate;
const NO_MATCHES = { event: null, locations: [], organizerBusiness: null, existingAppearance: null };
const evidenceOf = (v) => {
  const base = { name: v.name, address: v.address, city: v.city, state: v.state, postalCode: v.postalCode };
  return { ...base, key: LP.locationEvidenceKey(base), labels: ["x"], website: v.website ?? null, phone: null, category: null, description: null, warnings: [] };
};

// ── Fakes ───────────────────────────────────────────────────────────────

const hit = (url, title) => ({ type: "web_search_result", url, title, encrypted_content: "x" });
function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (body) => {
          calls.push(body);
          const r = typeof responses === "function" ? responses(body) : responses;
          if (r instanceof Error) throw r;
          return r;
        },
      },
    },
  };
}
const answer = (hits, verdict, stop = "end_turn") => ({
  model: "claude-opus-5-5",
  stop_reason: stop,
  usage: { input_tokens: 10, output_tokens: 10, server_tool_use: { web_search_requests: 1 } },
  content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "q" } }, { type: "web_search_tool_result", tool_use_id: "s1", content: hits }, { type: "text", text: JSON.stringify(verdict) }],
});
const ENABLED = { ENTITY_RESEARCH_ENABLED: "1", ANTHROPIC_API_KEY: "sk-test" };

// ── Anthropic web search: shape + limits ────────────────────────────────

test("web search request: current server tool, direct calls, hard cap, low effort, refusal fallback, server-only", () => {
  const body = RS.researchRequest({ kind: "location", name: "Iron23", address: "29 W 23rd St", city: "New York", state: "NY", postalCode: "10010" });
  assert.equal(body.model, "claude-opus-5-5");
  assert.deepEqual(body.tools.length, 1);
  const tool = body.tools[0];
  assert.equal(tool.type, "web_search_20260318");
  assert.equal(tool.name, "web_search");
  assert.deepEqual(tool.allowed_callers, ["direct"]);
  assert.ok(tool.max_uses >= 1 && tool.max_uses <= RS.RESEARCH_MAX_USES_HARD, "hard per-entity search cap");
  assert.equal(RS.RESEARCH_MAX_USES_HARD, 3);
  assert.ok(tool.blocked_domains.includes("instagram.com"), "no social crawling");
  assert.deepEqual(body.output_config, { effort: "low" });
  assert.equal(body.fallbacks, "default");
  assert.deepEqual(body.betas, ["server-side-fallback-2026-07-01"]);
  assert.match(body.messages[0].content, /"street_address":"29 W 23rd St"/, "location research uses the address, never name alone");
  assert.doesNotMatch(JSON.stringify(body), /tool_choice/, "no forced tool use (400 on this model)");
  // Off unless explicitly enabled with a server-only key.
  assert.equal(RS.researchEnabled({}), false);
  assert.equal(RS.researchEnabled({ ENTITY_RESEARCH_ENABLED: "1" }), false);
  assert.equal(RS.researchEnabled(ENABLED), true);
  const src = read("src/lib/entity-research.ts");
  assert.match(src, /^import "server-only";/);
  assert.doesNotMatch(src, /NEXT_PUBLIC_/);
  for (const f of ["src/app/admin/(protected)/events/import/AdminEventImporter.tsx", "src/components/admin/location-import/EventLocationCreate.tsx"]) {
    assert.doesNotMatch(read(f), /from "@\/lib\/entity-research"/, `${f}: no client-side research import`);
  }
});

test("decision: only a result-backed, non-aggregator, entity-named site with high confidence is proposed", () => {
  const input = { kind: "business", name: "Burt's Bees" };
  const hits = [{ url: "https://www.burtsbees.com/about", title: "About Burt's Bees" }, { url: "https://en.wikipedia.org/wiki/Burt%27s_Bees", title: "Burt's Bees - Wikipedia" }];
  const ok = RS.decideResearch(input, hits, { website: "https://www.burtsbees.com", name: "Burt's Bees", confidence: "high", ambiguous: false }, 1);
  assert.equal(ok.status, "found");
  assert.equal(ok.website, "https://burtsbees.com/");
  assert.ok(ok.sources.some((s) => /wikipedia/.test(s.url)), "third-party sources corroborate (provenance)");
  // Fabricated (not in results) → never proposed.
  assert.equal(RS.decideResearch(input, hits, { website: "https://burts-bees-official.com", confidence: "high", ambiguous: false }).status, "not_found");
  // Aggregators / directories / ticketing never become the official site.
  const venue = { kind: "location", name: "Iron23", address: "29 W 23rd St", city: "New York" };
  const vhits = [{ url: "https://www.peerspace.com/pages/listings/iron23", title: "Iron23 - Peerspace" }, { url: "https://luma.com/wmo9zjre", title: "KOOM HAUS at Iron23" }];
  assert.equal(RS.decideResearch(venue, vhits, { website: "https://www.peerspace.com/pages/listings/iron23", confidence: "high", ambiguous: false }).status, "not_found");
  // Medium confidence or an ambiguity flag → Needs Review, nothing proposed.
  const iron = [{ url: "https://iron23.com/", title: "Iron23 | Event Space NYC" }];
  assert.equal(RS.decideResearch(venue, iron, { website: "https://iron23.com", confidence: "medium", ambiguous: false }).status, "ambiguous");
  assert.equal(RS.decideResearch(venue, iron, { website: "https://iron23.com", confidence: "high", ambiguous: true }).status, "ambiguous");
  assert.equal(RS.decideResearch(venue, iron, { website: "https://iron23.com", confidence: "high", ambiguous: false }).website, "https://iron23.com/");
  // Two different plausible sites and the verdict names neither → ambiguous.
  const two = [{ url: "https://koom.com/", title: "KOOM" }, { url: "https://koomstudio.co/", title: "KOOM Studio" }];
  const amb = RS.decideResearch({ kind: "business", name: "KOOM" }, two, { website: null, confidence: "low", ambiguous: true });
  assert.equal(amb.status, "ambiguous");
  assert.deepEqual(amb.suggestions.sort(), ["koom.com", "koomstudio.co"]);
});

test("research runs once per entity (cache + in-flight sharing), is budgeted, and fails safe", async () => {
  RS.resetEntityResearch();
  const client = fakeClient(answer([hit("https://www.burtsbees.com/", "Burt's Bees | Official Site")], { website: "https://www.burtsbees.com/", name: "Burt's Bees", confidence: "high", ambiguous: false }));
  const q = { kind: "business", name: "Burt's Bees" };
  const [a, b] = await Promise.all([RS.researchEntity(q, client, { now: NOW }), RS.researchEntity({ ...q, name: "burts bees" }, client, { now: NOW })]);
  const c = await RS.researchEntity(q, client, { now: NOW + 1000 });
  assert.equal(client.calls.length, 1, "10 Events naming Burt's Bees → one research request");
  assert.equal(a.website, "https://burtsbees.com/");
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
  // No client (research off) → no call, "disabled".
  assert.equal((await RS.researchEntity({ kind: "business", name: "KOOM" }, null)).status, "disabled");
  // Unfinished / refused turn, or a thrown error → "failed" (never retried).
  RS.resetEntityResearch();
  assert.equal((await RS.researchEntity({ kind: "business", name: "X1" }, fakeClient(answer([], {}, "pause_turn")), { now: NOW })).status, "failed");
  assert.equal((await RS.researchEntity({ kind: "business", name: "X2" }, fakeClient(new Error("boom")), { now: NOW })).status, "failed");
  // Batch protection: an hourly per-instance ceiling.
  RS.resetEntityResearch();
  const many = fakeClient(answer([], { website: null, confidence: "low", ambiguous: false }));
  for (let i = 0; i < RS.RESEARCH_MAX_PER_HOUR; i++) await RS.researchEntity({ kind: "business", name: `Brand ${i}` }, many, { now: NOW });
  assert.equal((await RS.researchEntity({ kind: "business", name: "One More" }, many, { now: NOW })).status, "budget_exhausted");
  assert.equal(many.calls.length, RS.RESEARCH_MAX_PER_HOUR);
  RS.resetEntityResearch();
});

// ── Business preparation ────────────────────────────────────────────────

function bizDeps({ matches = [], research } = {}) {
  const calls = { research: 0 };
  return {
    calls,
    findMatches: async () => matches,
    research: async (q) => (calls.research++, research ? research(q) : RS.EMPTY_RESEARCH("not_found")),
  };
}
const found = (website, extra = {}) => ({ ...RS.EMPTY_RESEARCH("found"), website, name: "X", sources: [{ url: website, title: "Official" }], searches: 1, ...extra });

test("CASE 1 KOOM — no website: a Business candidate is PREPARED (research eligible), never just 'No Business Linked'", async () => {
  const c = extract(KOOM);
  assert.equal(O.eventBusinessEvidence(c), "KOOM");
  assert.equal(c.structured.businessWebsite, null);
  const d = bizDeps({ research: () => found("https://koom.example/") });
  const r = await PR.prepareBusiness({ name: "KOOM", website: null, websiteReadFailed: false, eventName: c.title }, d);
  assert.equal(d.calls.research, 1);
  assert.deepEqual([r.status, r.source, r.website], ["website", "research", "https://koom.example/"]);
  // Research off / not found → still a prepared minimal Business.
  const none = await PR.prepareBusiness({ name: "KOOM", website: null, websiteReadFailed: false }, bizDeps());
  assert.equal(none.status, "no_website");
});

test("CASE 2 HAOR — the supplied website is tried first; a successful read needs NO search", async () => {
  const c = extract(HAOR);
  assert.equal(c.structured.businessWebsite, "https://www.haor.kr/");
  const d = bizDeps({ research: () => found("https://haor.kr/") });
  const ok = await PR.prepareBusiness({ name: "HAOR", website: c.structured.businessWebsite, websiteReadFailed: false }, d);
  assert.deepEqual([ok.status, ok.source, d.calls.research], ["website", "pasted", 0]);
  // Failed / incomplete extraction may fall back to research.
  const failed = await PR.prepareBusiness({ name: "HAOR", website: c.structured.businessWebsite, websiteReadFailed: true }, d);
  assert.equal(d.calls.research, 1);
  assert.equal(failed.sameAsFailed, true, "research found the same site Brand Import couldn't read");
});

test("CASE 3 Burt's Bees — no_metadata is not a dead end: research corroborates the official site", async () => {
  const c = extract(BURTS);
  const d = bizDeps({ research: () => found("https://burtsbees.com/", { sources: [{ url: "https://www.burtsbees.com/", title: "Burt's Bees" }] }) });
  const r = await PR.prepareBusiness({ name: "Burt's Bees", website: c.structured.businessWebsite, websiteReadFailed: true, eventName: c.title }, d);
  assert.equal(r.status, "website");
  assert.equal(r.source, "research");
  assert.equal(r.sameAsFailed, true, "→ the prepared minimal Business carries the corroborated website");
  assert.equal(r.research.sources[0].url, "https://www.burtsbees.com/");
  // The Event image is untouched by any of this (still the extractor's).
  assert.doesNotMatch(read("src/lib/entity-prepare.ts"), /imageUrl|image-guard|cover_image/);
});

test("existing Business → selected, zero research; ambiguous research → no silent match / create", async () => {
  const d = bizDeps({ matches: [{ id: "b1", name: "Burt's Bees", isPublic: true, reasons: ["website"] }] });
  const r = await PR.prepareBusiness({ name: "Burt's Bees", website: "https://www.burtsbees.com/", websiteReadFailed: true }, d);
  assert.equal(r.status, "existing");
  assert.equal(d.calls.research, 0);
  const amb = await PR.prepareBusiness({ name: "KOOM", website: null, websiteReadFailed: false }, bizDeps({ research: () => ({ ...RS.EMPTY_RESEARCH("ambiguous"), suggestions: ["koom.com", "koomstudio.co"] }) }));
  assert.equal(amb.status, "no_website", "nothing linked or created");
  assert.equal(amb.research.status, "ambiguous");
});

// ── Location preparation ────────────────────────────────────────────────

const site = (url, facts = {}) => ({
  ok: true,
  finalUrl: url,
  facts: { name: null, address: null, city: null, state: null, postalCode: null, phone: "212-555-0123", description: "An event space.", hours: null, latitude: null, longitude: null, types: ["EventVenue"], multipleAddresses: false, ...facts },
  logo: { sourceUrl: `${url}logo.png`, preview: "data:image/webp;base64,AA" },
  cover: null,
  mediaChecked: 2,
});
function locDeps({ candidates = [], readWebsite, research } = {}) {
  const calls = { research: 0, reads: [] };
  return {
    calls,
    findCandidates: async () => candidates,
    readWebsite: async (url, supplied) => (calls.reads.push(url), readWebsite ? readWebsite(url, supplied) : site(url)),
    research: async (q) => (calls.research++, research ? research(q) : RS.EMPTY_RESEARCH("not_found")),
    categories: async () => [{ id: "cat-venue", name: "Event Venue", slug: "event-venue" }],
  };
}

test("CASE 1 Iron23 — prepared automatically; no Location Website → research (with the address) → the SAME Location Import reader", async () => {
  const c = extract(KOOM);
  const v = c.occurrences[0].venue;
  const d = locDeps({ research: (q) => (assert.equal(q.address, "29 W 23rd St"), found("https://iron23.com/")) });
  const p = await PR.prepareLocation(evidenceOf(v), d, { eventName: c.title });
  assert.equal(p.resolution.kind, "new");
  assert.equal(d.calls.research, 1);
  assert.deepEqual(d.calls.reads, ["https://iron23.com/"], "deterministic extraction does the heavy lifting");
  assert.deepEqual(p.website, { url: "https://iron23.com/", source: "research", read: "read" });
  assert.equal(p.proposal.sources.website, "research");
  assert.equal(p.proposal.phone, "212-555-0123");
  assert.equal(p.proposal.sources.phone, "website");
  assert.equal(p.proposal.categoryId, "cat-venue");
  assert.equal(p.proposal.name, "Iron23", "pasted identity wins");
});

test("CASE 2 Parasol Projects — a pasted Location Website is read first (zero search); a failed one falls back to research", async () => {
  const c = extract(HAOR.replace("ZIP: 10012", "ZIP: 10012\nLocation Website: https://parasolprojects.com"));
  const v = c.occurrences[0].venue;
  assert.equal(v.website, "https://parasolprojects.com/");
  const d = locDeps();
  const p = await PR.prepareLocation(evidenceOf(v), d);
  assert.deepEqual([p.website.source, p.website.read, d.calls.research], ["pasted", "read", 0]);
  const failing = locDeps({ readWebsite: (url) => (url.includes("parasolprojects.com") ? { ok: false, code: "fetch_failed", detail: "x" } : site(url)), research: () => found("https://parasol.nyc/") });
  const q = await PR.prepareLocation(evidenceOf(v), failing);
  assert.equal(failing.calls.research, 1);
  assert.deepEqual(q.website, { url: "https://parasol.nyc/", source: "research", read: "read" });
  // Research confirming the same unreadable site → noted, no second read.
  const same = locDeps({ readWebsite: () => ({ ok: false, code: "fetch_failed", detail: "x" }), research: () => found("https://parasolprojects.com/") });
  const s = await PR.prepareLocation(evidenceOf(v), same);
  assert.equal(same.calls.reads.length, 1);
  assert.ok(s.proposal.notes.some((n) => /confirms the pasted website/.test(n)));
});

test("CASE 3 High Line Nine (no ZIP) — still specific enough; prepared; research failure never blocks manual create", async () => {
  const c = extract(BURTS);
  const v = c.occurrences[0].venue;
  assert.equal(v.postalCode, null);
  const p = await PR.prepareLocation(evidenceOf(v), locDeps({ research: () => RS.EMPTY_RESEARCH("failed") }));
  assert.equal(p.resolution.kind, "new");
  assert.equal(p.proposal.name, "High Line Nine");
  assert.equal(p.proposal.address, "507 W 27th Street");
  assert.deepEqual(p.website, { url: null, source: null, read: "none" });
});

test("existing / ambiguous Location → zero research and zero website reads; research address conflict is flagged, pasted wins", async () => {
  const existing = { id: "l1", slug: "iron23", name: "Iron23", address: "29 West 23rd Street", city: "New York", state: "NY", postal_code: "10010", category: null, is_public: false };
  const ev = evidenceOf(extract(KOOM).occurrences[0].venue);
  const d = locDeps({ candidates: [existing] });
  const p = await PR.prepareLocation(ev, d);
  assert.equal(p.resolution.kind, "existing");
  assert.deepEqual([d.calls.research, d.calls.reads.length], [0, 0]);
  const amb = locDeps({ candidates: [{ ...existing, id: "l2", name: "Starrett-Lehigh Building" }] });
  assert.equal((await PR.prepareLocation(ev, amb)).resolution.kind, "ambiguous");
  assert.equal(amb.calls.research, 0);
  const conflict = await PR.prepareLocation(ev, locDeps({ research: () => ({ ...RS.EMPTY_RESEARCH("not_found"), address: { street: "31 W 23rd St", city: "New York", state: "NY", postalCode: null } }) }));
  assert.equal(conflict.proposal.address, "29 W 23rd St", "explicit value wins");
  assert.deepEqual(conflict.proposal.conflicts.find((x) => x.field === "address"), { field: "address", provided: "29 W 23rd St", website: "31 W 23rd St", from: "research" });
});

// ── Location Website structured input ───────────────────────────────────

test("Location Website: Event-level for Event-level places; an Occurrence's own wins for it", () => {
  const c = extract(`Event Name: Tour
Location Name: Iron23
Location Website: iron23.com
Street Address: 29 W 23rd St
City: New York
State: NY

Occurrence 1:
Date: October 16, 2026

Occurrence 2:
Date: October 17, 2026
Location Name: Parasol Projects
Location Website: https://parasolprojects.com
Street Address: 21 Spring Street

Occurrence 3:
Date: October 18, 2026
Location Name: High Line Nine
Street Address: 507 W 27th Street`);
  assert.deepEqual(c.occurrences.map((o) => [o.venue.name, o.venue.website ?? null]), [
    ["Iron23", "https://iron23.com/"],
    ["Parasol Projects", "https://parasolprojects.com/"],
    ["High Line Nine", null],
  ]);
  const review = O.operatorReviewDefaults(c, NO_MATCHES);
  assert.equal(review.occurrences[1].place.website, "https://parasolprojects.com/", "carried to Review as Location Import evidence");
  // Not an Event field: persistence maps explicit columns only.
  assert.doesNotMatch(read("src/lib/event-import/persist.ts"), /website: place\.website|location_website/);
});

// ── Same-place label ────────────────────────────────────────────────────

test("'Different Place Each Date' only when the dates really are at different places", () => {
  for (const t of [KOOM, HAOR]) {
    const review = O.operatorReviewDefaults(extract(t), NO_MATCHES);
    assert.equal(review.occurrences.length > 1, true);
    assert.equal(R.placesDiffer(review), false, "same Iron23 / Parasol on every date");
  }
  // Same place written per date (no shared place yet) — normalized evidence.
  const perDate = { sharedPlace: false, occurrences: [{ place: { venueName: "Iron23", address: "29 W 23rd St", useLocationId: null } }, { place: { venueName: "IRON23", address: "29 W 23rd St.", useLocationId: null } }] };
  assert.equal(R.placesDiffer(perDate), false);
  const tour = { sharedPlace: false, occurrences: [{ place: { venueName: "Iron23", address: "29 W 23rd St", useLocationId: null } }, { place: { venueName: "Parasol Projects", address: "21 Spring Street", useLocationId: null } }] };
  assert.equal(R.placesDiffer(tour), true);
  const parts = read("src/app/(public)/account/business/[id]/import-event/ReviewParts.tsx");
  assert.match(parts, /\{many && placesDiffer\(review\) && <span[^>]*>Different Place Each Date<\/span>\}/);
  assert.match(parts, /\{review\.sharedPlace \? "Set a Place per Date" : "Same Place for All Dates"\}/);
  assert.equal((parts.match(/Different Place Each Date/g) ?? []).length, 2, "the status (plus its comment) — never the action label");
});

// ── Orchestration wiring: dedupe, no auto-create, attach after create ──

test("batch orchestration: each Business / place prepared ONCE; nothing auto-created; created entities attach batch-wide", () => {
  const ui = read("src/app/admin/(protected)/events/import/AdminEventImporter.tsx");
  // Deduped by entity before any action call.
  assert.match(ui, /const key = businessEvidenceKey\(name\);\n\s+if \(!name \|\| !key \|\| e\.matches\.organizerBusiness \|\| todo\.has\(key\)\) continue;/);
  assert.match(ui, /if \(!key \|\| jobs\.has\(key\)\) continue;/);
  assert.match(ui, /if \(placeAsked\.current\.has\(key\)\) return;\n\s+placeAsked\.current\.add\(key\);/);
  // Existing canonical matches and a readable supplied website → no preparation (no research).
  assert.match(ui, /if \(e\.matches\.locations\.some\(\(l\) => l\.key === key && l\.confidence === "strong"\)\) continue;/);
  assert.match(ui, /if \(view && \(view\.status === "ready" \|\| view\.matchedBusiness \|\| view\.createdBusiness\)\) continue;/);
  // Only the Primary Business is auto-prepared.
  assert.match(ui, /function primaryBusinessOf\(e: SourceEventAnalysis\): string \| null \{\n\s+return e\.candidate\.structured\?\.business \?\? null;/);
  // A researched official website goes back through Brand Import.
  assert.match(ui, /const read = \(await readWebsites\(\[r\.prepared\.website\], run\)\)\[r\.prepared\.website\];/);
  // Preparation never creates: the prepare paths have no insert / create calls.
  for (const f of ["src/lib/entity-prepare.ts", "src/lib/entity-research.ts"]) assert.doesNotMatch(read(f), /\.insert\(|createImportedLocation|insertInlineBusiness|createBusinessFromCandidate/, f);
  const step = read("src/components/admin/location-import/EventLocationCreate.tsx");
  assert.match(step, /Review &amp; Create/);
  assert.match(step, /if \(r\.status === "created"\) \{\n\s+onCreated\(r\.location\.id\);\n\s+onSelected\(toCreated\(placeKey, r\.location\)\);/, "created → attached by place key (reused across the batch)");
  assert.match(step, /New Location · Ready For Review/);
  assert.match(ui, /New Business · Ready For Review/);
  // Business reuse after creation: every Event naming the same Business.
  const multi = read("src/app/(public)/account/business/[id]/import-event/MultiEventImport.tsx");
  assert.match(multi, /if \(evKey\) for \(const e of events\) if \(e\.key !== fromKey && !next\[e\.key\] && evidenceKeyOf\(e\) === evKey\) next\[e\.key\] = b;/);
  // Provenance labels.
  const editor = read("src/components/admin/location-import/LocationProposalEditor.tsx");
  for (const label of ["Official Website", "Web Research", "Pasted"]) assert.ok(editor.includes(`>${label}<`), label);
  assert.match(step, /Existing Findmi Data/);
});
