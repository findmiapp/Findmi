// Admin Event Import — structured field syntax ("Event Name: …") read
// deterministically, Event Link kept, Business evidence matched (or created
// by explicit Admin Quick Create), explicit dates/times kept exactly, and
// Category / Formats resolved against the canonical vocabulary. Fakes only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/cache") return { url: "data:text/javascript,export const revalidatePath=()=>{};", shortCircuit: true };
    if (specifier === "@/lib/admin/requireAdminSupabase")
      return { url: "data:text/javascript,export async function requireAdminSupabase(){const c=globalThis.__ADMIN;if(!c)throw new Error('Unauthorized');return c;}", shortCircuit: true };
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

const E = await import("../src/lib/event-import/engine.ts");
const SP = await import("../src/lib/event-import/structured-paste.ts");
const SC = await import("../src/lib/event-import/schedule.ts");
const O = await import("../src/lib/event-import/operator.ts");
const R = await import("../src/lib/event-import/review.ts");
const A = await import("../src/app/admin/(protected)/events/import/actions.ts");
const read = (p) => readFileSync(p, "utf8");
const MULTI = read("src/app/(public)/account/business/[id]/import-event/MultiEventImport.tsx");
const CLIENT = read("src/app/admin/(protected)/events/import/AdminEventImporter.tsx");
const ACTIONS = read("src/app/admin/(protected)/events/import/actions.ts");
const BIZ_ACTIONS = read("src/app/(public)/account/business/[id]/import-event/actions.ts");
const ENGINE = read("src/lib/event-import/engine.ts");
const PARTS = read("src/app/(public)/account/business/[id]/import-event/ReviewParts.tsx");

const NOW = Date.parse("2026-10-01T12:00:00Z");
const GA_ID = "11111111-1111-4111-8111-111111111111";
const GOOD_AMERICAN = `Event Name: Good American NYC Pop-Up
Primary Business: Good American
Event Link: https://goodamerican.com/pages/nyc-pop-up
Description: Shop the latest Good American denim at the NYC pop-up.
Location Name: The Canvas
Street Address: 335 W 35th St
City: New York
State: NY
ZIP: 10001
Dates: October 15–18, 2026
Start Time: 11:00 AM
End Time: 6:00 PM
Category: Fashion & Style
Subcategory: Fashion
Formats: Pop-Up, Retail Experience
RSVP URL: https://partiful.com/e/good-american
Programming:
Oct 15: Opening day with a DJ set
Oct 17: Styling sessions 2–4 PM`;
const ET = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function deps(over = {}) {
  const calls = { organizers: [], ai: 0, rate: 0 };
  return {
    calls,
    fetchPage: async () => {
      throw new Error("never fetched");
    },
    ai: {
      complete: async () => {
        calls.ai += 1;
        return null;
      },
    },
    matchEvent: async () => null,
    getEvent: async () => null,
    matchLocations: async () => [],
    matchOrganizer: async (name) => (calls.organizers.push(name), name === "Good American" ? { id: GA_ID, name } : null),
    matchExistingAppearance: async () => null,
    findScheduledBySourceUrl: async () => null,
    findEventBySourceUrl: async () => null,
    isRateLimited: () => ((calls.rate += 1), false),
    now: () => NOW,
    ...over,
  };
}
const adminAnalyze = async (text, d = deps()) => O.asOperatorAnalysis(await E.analyzeEventText({ text, businessId: null, rateKey: "admin", structured: true }, d), { url: "", name: "Pasted Details", platform: null });
const block = (n, body) => `EVENT ${n}\n${body}\n=== END EVENT ${n} ===`;

/** Recording Supabase fake (Business rows answer the Business matcher). */
function fakeClient({ businesses = [] } = {}) {
  const ops = [];
  return {
    ops,
    rpc: async (name) => (ops.push({ table: `rpc:${name}` }), { data: null, error: { message: "unused" } }),
    from(table) {
      let id = null;
      const eqs = {};
      const rows = () => (table === "businesses" ? businesses : []).filter((r) => Object.entries(eqs).every(([k, v]) => k in r ? r[k] === v : true));
      const chain = {
        select: () => chain,
        eq: (c, v) => ((c === "id" ? (id = v) : c !== "is_demo" ? (eqs[c] = v) : null), chain),
        is: () => chain,
        in: () => chain,
        neq: () => chain,
        or: () => chain,
        filter: () => chain,
        ilike: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: rows().find((r) => r.id === id) ?? null, error: null }),
        then: (res) => res({ data: id ? rows().filter((r) => r.id === id) : rows(), error: null }),
        insert: (input) => {
          const list = Array.isArray(input) ? input : [input];
          ops.push({ table, kind: "insert", rows: list });
          const n = ops.filter((o) => o.table === table && o.kind === "insert").length;
          return {
            select: () => ({
              single: async () => ({ data: { id: `${table}-${n}`, ...list[0] }, error: null }),
              then: (cb) => cb({ data: list.map((_, i) => ({ id: `${table}-${n}-${i}` })), error: null }),
            }),
            then: (cb) => cb({ error: null }),
          };
        },
        upsert: (row) => (ops.push({ table, kind: "upsert", rows: Array.isArray(row) ? row : [row] }), Promise.resolve({ error: null })),
        update: (patch) => {
          ops.push({ table, kind: "update", rows: [patch] });
          const c = { eq: () => c, select: () => c, maybeSingle: async () => ({ data: null }), then: (cb) => cb({ error: null }) };
          return c;
        },
      };
      return chain;
    },
  };
}
const bizRow = (over = {}) => ({ id: GA_ID, slug: "good-american", name: "Good American", city: null, state: null, website_url: null, instagram_url: null, publication_status: "live", archived_at: null, trashed_at: null, ...over });

// ── 1. LABELS ─────────────────────────────────────────────────────────────

test("1. `Event Name: Good American NYC Pop-Up` becomes exactly `Good American NYC Pop-Up` (no AI rediscovery)", async () => {
  const d = deps();
  const r = await adminAnalyze(block(1, GOOD_AMERICAN) + "\n\n" + block(2, GOOD_AMERICAN.replace("Good American NYC Pop-Up", "Knix x ACOTAR").replace(/Primary Business: .*/, "Primary Business: Knix")), d);
  assert.equal(r.events[0].candidate.title, "Good American NYC Pop-Up");
  assert.equal(r.events[1].candidate.title, "Knix x ACOTAR");
  assert.equal(r.events[0].candidate.description, "Shop the latest Good American denim at the NYC pop-up.", "Description label stripped; no other field leaks in");
  assert.equal(d.calls.ai, 0, "explicit values are never re-read by the AI step");
  const review = O.operatorReviewDefaults(r.events[0].candidate, r.events[0].matches);
  assert.equal(review.title, "Good American NYC Pop-Up");
  assert.equal(review.place.venueName, "The Canvas");
  assert.equal(review.place.address, "335 W 35th St");
  assert.equal(review.place.city, "New York");
  assert.equal(review.place.state, "NY");
  assert.equal(review.place.postalCode, "10001");
});

// ── 2. LINKS ──────────────────────────────────────────────────────────────

test("2. Event Link / Source URL survive analysis → Review → saved as events.external_url (the one Event link column)", async () => {
  const r = await adminAnalyze(GOOD_AMERICAN);
  const review = O.operatorReviewDefaults(r.events[0].candidate, r.events[0].matches);
  assert.equal(review.sourceUrl, "https://goodamerican.com/pages/nyc-pop-up");
  assert.deepEqual(review.attendance, { cta: "rsvp", url: "https://partiful.com/e/good-american" }, "RSVP URL is attendance evidence");
  globalThis.__ADMIN = fakeClient();
  const saved = await A.adminCommitEventImportBatch([{ review, businessId: null }]);
  assert.equal(saved.ok, true);
  const ev = globalThis.__ADMIN.ops.find((o) => o.table === "events" && o.kind === "insert").rows[0];
  assert.equal(ev.external_url, "https://goodamerican.com/pages/nyc-pop-up");
  globalThis.__ADMIN = undefined;
  // Source URL alone is the same column; two different links keep the Event Link and say so.
  const src = SP.extractStructuredEvent(GOOD_AMERICAN.replace("Event Link:", "Source URL:"), { now: NOW });
  assert.equal(src.candidate.sourceUrl, "https://goodamerican.com/pages/nyc-pop-up");
  const both = SP.extractStructuredEvent(`${GOOD_AMERICAN}\nSource URL: https://instagram.com/p/abc`, { now: NOW });
  assert.equal(both.candidate.sourceUrl, "https://goodamerican.com/pages/nyc-pop-up");
  assert.ok(both.candidate.structured.notes.some((n) => /Source URL isn't saved/.test(n)));
  // Never fetched: deps().fetchPage throws, and analysis above succeeded.
});

// ── 3–7. BUSINESS ─────────────────────────────────────────────────────────

test("3–4. `Primary Business: Good American` is Business matching evidence; an existing Business is pre-selected", async () => {
  const d = deps();
  const r = await adminAnalyze(GOOD_AMERICAN.replace("Primary Business: Good American", "Primary Business: Good American\nOrganizer: Good American Events Team"), d);
  assert.deepEqual(d.calls.organizers, ["Good American"], "the Business field, not the organizer text");
  assert.deepEqual(O.suggestedEventBusiness(r.events[0].matches), { id: GA_ID, name: "Good American" });
  assert.equal(r.events[0].candidate.organizer, "Good American Events Team", "organizer stays its own text field");

  // The Admin matcher: exactly one real Business with that exact name (live or pending review).
  globalThis.__ADMIN = fakeClient({ businesses: [bizRow({ publication_status: "pending_review" })] });
  const live = await A.adminAnalyzeEventText(GOOD_AMERICAN);
  assert.equal(live.ok, true);
  assert.deepEqual(live.events[0].matches.organizerBusiness, { id: GA_ID, name: "Good American" });
  // Ambiguous (two exact names) or trashed → unresolved, never a guess.
  globalThis.__ADMIN = fakeClient({ businesses: [bizRow(), bizRow({ id: "22222222-2222-4222-8222-222222222222", slug: "good-american-2" })] });
  assert.equal((await A.adminAnalyzeEventText(GOOD_AMERICAN)).events[0].matches.organizerBusiness, null);
  globalThis.__ADMIN = fakeClient({ businesses: [bizRow({ trashed_at: "2026-09-01T00:00:00Z" })] });
  assert.equal((await A.adminAnalyzeEventText(GOOD_AMERICAN)).events[0].matches.organizerBusiness, null);
  globalThis.__ADMIN = undefined;
  assert.match(ACTIONS, /structured: true \}, operatorDeps\(admin\)\)/);
});

test("5–6. a missing Business is created ONLY by explicit Admin Quick Create — pending review, no owner/membership/Pro/verification/hosting/participation", async () => {
  // No Business → nothing suggested, nothing created by analysis.
  globalThis.__ADMIN = fakeClient();
  const r = await A.adminAnalyzeEventText(GOOD_AMERICAN);
  assert.equal(r.events[0].matches.organizerBusiness, null);
  assert.equal(globalThis.__ADMIN.ops.length, 0, "analysis never writes");

  const form = new FormData();
  form.set("name", "Good American");
  const created = await A.adminCreateImportBusiness(form);
  assert.equal(created.status, "created");
  const ops = globalThis.__ADMIN.ops;
  assert.equal(ops.length, 1, "exactly one write: the Business row");
  const row = ops[0].rows[0];
  assert.equal(ops[0].table, "businesses");
  assert.deepEqual(
    { name: row.name, slug: row.slug, publication_status: row.publication_status, plan_tier: row.plan_tier, verified: row.verified, founding_member: row.founding_member, is_demo: row.is_demo, commerce_enabled: row.commerce_enabled, website_url: row.website_url },
    { name: "Good American", slug: "good-american", publication_status: "pending_review", plan_tier: "free", verified: false, founding_member: false, is_demo: false, commerce_enabled: false, website_url: null }
  );
  assert.ok(!("is_pro_member" in row) && !("membership_status" in row) && !("plan_source" in row), "no Pro / membership");
  assert.ok(!ops.some((o) => /members|claim|event_businesses|events|rpc:/.test(o.table)), "no ownership, claim, hosting or participation");

  // A likely existing Business is offered instead of a duplicate.
  globalThis.__ADMIN = fakeClient({ businesses: [bizRow({ publication_status: "pending_review" })] });
  const dup = await A.adminCreateImportBusiness(form);
  assert.equal(dup.status, "duplicates");
  assert.deepEqual(dup.duplicates, [{ id: GA_ID, name: "Good American", isPublic: false }]);
  assert.equal(globalThis.__ADMIN.ops.length, 0);
  // Explicit override creates anyway; no Admin session → nothing.
  form.set("force", "1");
  assert.equal((await A.adminCreateImportBusiness(form)).status, "created");
  globalThis.__ADMIN = undefined;
  assert.equal((await A.adminCreateImportBusiness(form)).status, "error");
  // UI: only on the Admin's click, prefilled from the source's Business name.
  assert.match(CLIENT, /\+ Create New Business/);
  assert.match(CLIENT, /setName\(evidence \?\? ""\);/);
  // Orchestration completion: the fallback is now a PREPARED minimal Business (never a dead end).
  assert.match(CLIENT, /\{!initial && !existing && prep\?\.status !== "pending" && prepared\?\.status !== "existing" && read\?\.status !== "ready" && !\(read && PENDING_READ\.has\(read\.status\)\) && \(!website \|\| read\?\.status === "failed"\) && \(\n\s+<QuickCreateBusiness/);
});

test("7. a Business created for one Event is reused for the same Business named elsewhere in the batch", () => {
  assert.equal(O.businessEvidenceKey("Good American"), O.businessEvidenceKey("GOOD AMERICAN, Inc."));
  assert.notEqual(O.businessEvidenceKey("Good American"), O.businessEvidenceKey("Knix"));
  assert.match(MULTI, /if \(evKey\) for \(const e of events\) if \(e\.key !== fromKey && !next\[e\.key\] && evidenceKeyOf\(e\) === evKey\) next\[e\.key\] = b;/, "only unlinked Events naming the same Business");
  assert.match(MULTI, /nextBusiness\[e\.key\] = suggestedEventBusiness\(e\.matches\) \?\? createdBusinesses\[evidenceKeyOf\(e\)\] \?\? null;/, "Events reviewed later get it too");
  assert.match(MULTI, /onCreated: \(b\) => onBusinessCreated\(e\.key, b\),/);
});

// ── 8–12. OCCURRENCES ─────────────────────────────────────────────────────

test("8–11. Good American Oct 15–18 → exactly FOUR dates, each 11:00 AM–6:00 PM, chronological, no phantom dates (Review = saved)", async () => {
  const r = await adminAnalyze(GOOD_AMERICAN);
  const occ = r.events[0].candidate.occurrences;
  assert.equal(occ.length, 4, "programming lines never become dates");
  assert.deepEqual(occ.map((o) => [ET(o.start), ET(o.end)]), [
    ["Oct 15, 11:00 AM", "Oct 15, 6:00 PM"],
    ["Oct 16, 11:00 AM", "Oct 16, 6:00 PM"],
    ["Oct 17, 11:00 AM", "Oct 17, 6:00 PM"],
    ["Oct 18, 11:00 AM", "Oct 18, 6:00 PM"],
  ]);
  assert.ok(occ.every((o) => o.hasTime && o.venue.name === "The Canvas"));
  const review = O.operatorReviewDefaults(r.events[0].candidate, r.events[0].matches);
  assert.equal(review.occurrences.length, 4, "Review count = candidate count");
  assert.deepEqual(review.occurrences.map((o) => [o.date, o.startTime, o.endTime]), [
    ["2026-10-15", "11:00", "18:00"],
    ["2026-10-16", "11:00", "18:00"],
    ["2026-10-17", "11:00", "18:00"],
    ["2026-10-18", "11:00", "18:00"],
  ]);
  assert.deepEqual(R.batchItemStatus(review, r.events[0].matches).missing, []);
  globalThis.__ADMIN = fakeClient();
  await A.adminCommitEventImportBatch([{ review: { ...review, occurrences: [...review.occurrences].reverse() }, businessId: null }]);
  const saved = globalThis.__ADMIN.ops.find((o) => o.table === "event_occurrences").rows;
  assert.equal(saved.length, 4, "saved count = reviewed count");
  assert.deepEqual(saved.map((o) => o.start_at), [...saved.map((o) => o.start_at)].sort(), "chronological when saved, whatever the Review order");
  globalThis.__ADMIN = undefined;
});

test("9 + 12. Occurrence blocks keep their OWN times; a missing time is flagged on that date only — never invented", () => {
  const text = `Event Name: Miniverse: Take a Mini Break
Primary Business: MGA Entertainment
Location Name: Pier 57
Street Address: 25 11th Ave
City: New York
State: NY

Occurrence 2:
Date: Oct 18, 2026
Start Time: 12 PM
Programming: Mini-making workshop

Occurrence 1:
Date: Oct 17, 2026
Start Time: 10:00 AM
End Time: 4:00 PM

Occurrence 3:
Date: Oct 19, 2026
Time: 6 PM – 9 PM`;
  const r = SP.extractStructuredEvent(text, { now: NOW });
  assert.deepEqual(r.candidate.occurrences.map((o) => [o.start.slice(0, 10), o.hasTime, o.end ? ET(o.end) : null]), [
    ["2026-10-17", true, "Oct 17, 4:00 PM"],
    ["2026-10-18", true, null],
    ["2026-10-19", true, "Oct 19, 9:00 PM"],
  ]);
  assert.equal(ET(r.candidate.occurrences[0].start), "Oct 17, 10:00 AM");
  assert.equal(ET(r.candidate.occurrences[1].start), "Oct 18, 12:00 PM");
  assert.equal(ET(r.candidate.occurrences[2].start), "Oct 19, 6:00 PM");
  const review = O.operatorReviewDefaults(r.candidate, { event: null, locations: [], organizerBusiness: null, existingAppearance: null });
  // Event date/time precision (approved): a known start with no published
  // end is a VALID date (never given an invented end) — nothing is missing.
  // Only an end with no start still needs the operator.
  assert.deepEqual(R.batchItemStatus(review, { event: null, locations: [], organizerBusiness: null, existingAppearance: null }).missing, []);
  assert.deepEqual(R.datesMissingTime(review), [], "a start-only date is complete");
  assert.equal(review.occurrences.find((o) => o.date === "2026-10-18").endTime, "", "the end stays unknown");
  assert.match(MULTI, /m === END_WITHOUT_START \? `\$\{END_WITHOUT_START\} \(\$\{datesMissingTime\(review\)\.join\(", "\)\}\)`/);
  // A date with no time anywhere stays without one.
  const bare = SP.extractStructuredEvent("Event Name: Book Swap\nDate: Oct 20, 2026\nLocation Name: Pier 57\nCity: New York\nState: NY", { now: NOW });
  assert.deepEqual(bare.candidate.occurrences.map((o) => [o.start, o.hasTime]), [["2026-10-20", false]]);
  // Unreadable dates are left for Review with a note — never guessed.
  const bad = SP.extractStructuredEvent("Event Name: X Pop-Up\nDates: Oct 15–18 (weekend)\nCity: New York\nState: NY", { now: NOW });
  assert.equal(bad.candidate.occurrences.length, 0);
  assert.ok(bad.candidate.structured.notes.some((n) => /couldn't be read/.test(n)));
});

test("explicit date fields: ranges and lists expand exactly; anything else is refused", () => {
  const ctx = { now: NOW, yearHint: null };
  assert.deepEqual(SC.explicitDateList("October 15–18, 2026", ctx), ["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
  assert.deepEqual(SC.explicitDateList("Oct 15, Oct 16 and Oct 18, 2026", ctx), ["2026-10-15", "2026-10-16", "2026-10-18"]);
  assert.deepEqual(SC.explicitDateList("2026-10-15", ctx), ["2026-10-15"]);
  assert.equal(SC.explicitDateList("Oct 15–18 (weekend)", ctx), null);
  assert.equal(SC.explicitDateList("Oct 1 – Dec 31, 2026", ctx), null, "ranges longer than a month are not expanded");
});

// ── PROGRAMMING + TAXONOMY ────────────────────────────────────────────────

test("EVENT-level programming is reported as not saved (it belongs to no date) and never becomes a date or a place", async () => {
  const r = await adminAnalyze(block(1, GOOD_AMERICAN) + "\n\n" + block(2, GOOD_AMERICAN.replace("Good American NYC Pop-Up", "Second Pop-Up")));
  // Occurrence-level Programming is saved with its date (event_occurrences.details — see admin-occurrence-details.test.mjs).
  assert.ok(r.warnings.some((w) => /^EVENT 1: Event-level Programming isn't saved/.test(w)));
  assert.ok(r.events.every((e) => e.candidate.occurrences.every((o) => !/DJ|Styling/.test(`${o.venue.name}`))));
});

test("Category / Subcategory / Formats resolve to the canonical vocabulary; unknown values stay unresolved", () => {
  const categories = [
    { id: "c-fashion-style", name: "Fashion & Style", slug: "fashion-style", parent_id: null },
    { id: "c-fashion", name: "Fashion", slug: "fashion", parent_id: "c-fashion-style" },
    { id: "c-food", name: "Food & Drink", slug: "food-drink", parent_id: null },
  ];
  const formats = [
    { id: "f-popup", name: "Pop-Up", slug: "pop-up", parent_id: null },
    { id: "f-market", name: "Market", slug: "market", parent_id: null },
  ];
  assert.deepEqual(O.resolveStructuredTaxonomy({ category: "Fashion & Style", subcategory: "Fashion", formats: ["Pop-Up", "Retail Experience"] }, categories, formats), {
    categoryId: "c-fashion",
    formatIds: ["f-popup"],
    unresolved: ["Format “Retail Experience”"],
  });
  assert.equal(O.resolveStructuredTaxonomy({ category: "fashion and style", subcategory: null, formats: [] }, categories, formats).categoryId, "c-fashion-style");
  assert.deepEqual(O.resolveStructuredTaxonomy({ category: "Nightlife", subcategory: null, formats: [] }, categories, formats), { categoryId: null, formatIds: [], unresolved: ["Category “Nightlife”"] });
  const candidate = SP.extractStructuredEvent(GOOD_AMERICAN, { now: NOW }).candidate;
  const review = O.operatorReviewDefaults(candidate, { event: null, locations: [], organizerBusiness: null, existingAppearance: null }, { categories, formats });
  assert.equal(review.categoryId, "c-fashion");
  assert.deepEqual(review.formatIds, ["f-popup"]);
  assert.match(MULTI, /operatorReviewDefaults\(e\.candidate, e\.matches, \{ categories, formats \}\)/);
});

// ── 13–17. NOTHING ELSE CHANGES ───────────────────────────────────────────

test("13. unlabeled prose keeps the free-text reading; LABELED input uses the ONE structured reader for every caller (Consolidation pass)", async () => {
  const plain = `Fall Book Swap Brunch\n\nOctober 18, 2026\n11 AM–2 PM\n\nPier 57\n25 11th Ave\nNew York, NY`;
  const off = await E.analyzeEventText({ text: plain, businessId: "biz", rateKey: "u" }, deps());
  const on = await E.analyzeEventText({ text: plain, businessId: "biz", rateKey: "u", structured: true }, deps());
  assert.deepEqual(on, off, "Admin flag + free text = the unchanged free-text reading");
  assert.equal(off.candidate.structured, undefined);
  // Business Manager and Admin now share the deterministic reader: the
  // same labeled paste reads identically with or without the old flag.
  const business = await E.analyzeEventText({ text: GOOD_AMERICAN, businessId: "biz", rateKey: "u" }, deps());
  const admin = await E.analyzeEventText({ text: GOOD_AMERICAN, businessId: "biz", rateKey: "u", structured: true }, deps());
  assert.equal(business.candidate.title, "Good American NYC Pop-Up");
  assert.equal(business.candidate.structured.business, "Good American");
  assert.deepEqual(business.candidate, admin.candidate);
});

test("14–16. Business importer, URL import and Upload never need the structured flag (detection is automatic for pasted text)", () => {
  assert.doesNotMatch(BIZ_ACTIONS, /structured: true/);
  assert.match(BIZ_ACTIONS, /analyzeEventText\(\{ text: typeof text === "string" \? text : "", businessId, rateKey: ctx\.user\.id \}, defaultEventImportDeps\(ctx\.admin\)\)/);
  const url = ENGINE.slice(ENGINE.indexOf("export async function analyzeEventUrl"), ENGINE.indexOf("// ── Paste Details / Upload"));
  assert.doesNotMatch(url, /extractStructuredEvent|structured: true/);
  const image = ENGINE.slice(ENGINE.indexOf("export async function analyzeEventImage"), ENGINE.indexOf("function hiddenVenue"));
  assert.doesNotMatch(image, /extractStructuredEvent|structured/);
  // Business evidence falls back to the organizer exactly as before.
  assert.match(ENGINE, /const businessEvidence = candidate\.structured\?\.business \?\? candidate\.organizer;/);
});

test("17. Location Quick Create is unchanged (same default action, same shared core)", () => {
  assert.match(PARTS, /createAction = createInlinePlace,/);
  assert.match(read("src/app/(public)/account/location/actions.ts"), /return insertInlinePlace\(admin, formData\);/);
});
