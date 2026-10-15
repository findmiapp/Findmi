// Event Occurrence details (event_occurrences.details) + occurrence-specific
// Locations through Admin structured import: Parse → Review → Save → Read.
// Fakes only — no network, no database, no production writes.
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

const SP = await import("../src/lib/event-import/structured-paste.ts");
const SM = await import("../src/lib/event-import/structured-merge.ts");
const O = await import("../src/lib/event-import/operator.ts");
const R = await import("../src/lib/event-import/review.ts");
const P = await import("../src/lib/event-import/persist.ts");
const D = await import("../src/lib/event-import/occurrence-details.ts");
const read = (p) => readFileSync(p, "utf8");
const NOW = Date.parse("2026-10-01T12:00:00Z");
const NO_MATCHES = { event: null, locations: [], organizerBusiness: null, existingAppearance: null };
const ET = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const GOOD_AMERICAN = `Event Name: Good American NYC Pop-Up
Primary Business: Good American
Location Name: The Canvas
Street Address: 335 W 35th St
City: New York
State: NY
ZIP: 10001
Start Time: 11:00 AM
End Time: 6:00 PM

Occurrence 1:
Date: October 15, 2026
Start Time: 11:00 AM
End Time: 6:00 PM
Programming: Emma Grede appearance and Dot Cakes activation.

Occurrence 2:
Date: October 16, 2026
Programming: Leora Café activation.

Occurrence 3:
Date: October 17, 2026

Occurrence 4:
Date: October 18, 2026
Details: Closing day
Last-chance styling sessions.`;

const STARBUCKS = `Event Name: Starbucks Refreshers NYC Tour
Primary Business: Starbucks

Occurrence 1:
Date: October 20, 2026
Start Time: 11:00 AM
End Time: 2:00 PM
Location Name: Location A
Street Address: 100 Example St
City: New York
State: NY
ZIP: 10001
Programming: Stop A programming.

Occurrence 2:
Date: October 21, 2026
Start Time: 12:00 PM
End Time: 3:00 PM
Location Name: Location B
Street Address: 200 Example St
City: New York
State: NY
ZIP: 10002
Programming: Stop B programming.

Occurrence 3:
Date: October 21, 2026
Start Time: 12:00 PM
End Time: 3:00 PM
Location Name: Location C
Street Address: 300 Example St
City: New York
State: NY
ZIP: 10003
Programming: Stop C programming.`;

/** Recording client: occurrence inserts return their rows with ids; updates are logged. */
function fakeClient({ failDetails = false } = {}) {
  const ops = [];
  let occSeq = 0;
  return {
    ops,
    rpc: async () => ({ data: null, error: { message: "unused" } }),
    from(table) {
      const chain = {
        select: () => chain,
        eq: (c, v) => (chain._eq = [...(chain._eq ?? []), [c, v]], chain),
        is: () => chain,
        in: () => chain,
        neq: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          const id = (chain._eq ?? []).find(([c]) => c === "id")?.[1];
          return { data: table === "locations" && id ? { id, name: "The Canvas", address: "335 W 35th St", city: "New York", state: "NY", postal_code: "10001", latitude: null, longitude: null } : null };
        },
        then: (res) => res({ data: [], error: null }),
        insert: (input) => {
          const rows = Array.isArray(input) ? input : [input];
          ops.push({ table, kind: "insert", rows });
          const withIds = rows.map((r) => ({ id: table === "event_occurrences" ? `occ-${++occSeq}` : `${table}-1`, ...r }));
          return {
            select: () => ({ single: async () => ({ data: withIds[0], error: null }), then: (cb) => cb({ data: withIds, error: null }) }),
            then: (cb) => cb({ error: null }),
          };
        },
        upsert: (row) => (ops.push({ table, kind: "upsert", rows: [row] }), Promise.resolve({ error: null })),
        update: (patch) => {
          const entry = { table, kind: "update", patch, id: null };
          ops.push(entry);
          const c = {
            eq: (col, v) => {
              if (col === "id") entry.id = v;
              return c;
            },
            then: (cb) => cb({ error: failDetails && "details" in patch ? { message: 'column "details" does not exist' } : null }),
          };
          return c;
        },
      };
      return chain;
    },
  };
}
const deps = (client) => ({ admin: client, storeImage: async () => null, geography: async () => null, uniqueEventSlug: async () => "e", propagateDates: async () => {}, findEventBySourceUrl: async () => null });
const save = async (candidate, review, client = fakeClient()) => {
  const n = P.normalizeReview(review);
  assert.equal(n.ok, true, n.error);
  const out = await P.persistDiscoveryEvent(n.value, null, deps(client));
  return { client, out, normalized: n.value };
};

// ── PARSE ─────────────────────────────────────────────────────────────────

test("Programming / Details under an Occurrence become THAT date's details — never the name, dates, place or organizer", () => {
  const r = SP.extractStructuredEvent(GOOD_AMERICAN, { now: NOW });
  const c = r.candidate;
  assert.equal(c.title, "Good American NYC Pop-Up");
  assert.equal(c.occurrences.length, 4);
  assert.deepEqual(c.occurrences.map((o) => [o.start.slice(0, 10) === o.start ? o.start : new Date(o.start).toLocaleDateString("en-CA", { timeZone: "America/New_York" }), o.details ?? null]), [
    ["2026-10-15", "Emma Grede appearance and Dot Cakes activation."],
    ["2026-10-16", "Leora Café activation."],
    ["2026-10-17", null],
    ["2026-10-18", "Closing day\nLast-chance styling sessions."],
  ], "each date keeps its own; line breaks kept; Details: is an alias");
  assert.deepEqual(c.occurrences.map((o) => [ET(o.start), ET(o.end)]), [
    ["Oct 15, 11:00 AM", "Oct 15, 6:00 PM"],
    ["Oct 16, 11:00 AM", "Oct 16, 6:00 PM"],
    ["Oct 17, 11:00 AM", "Oct 17, 6:00 PM"],
    ["Oct 18, 11:00 AM", "Oct 18, 6:00 PM"],
  ]);
  assert.ok(c.occurrences.every((o) => o.venue.name === "The Canvas"));
  assert.equal(c.organizer, null);
  assert.equal(c.description, null, "details are never folded into the Event description");
  assert.equal(c.structured.programming.length, 0, "no Event-level programming here");
  assert.equal(D.cleanOccurrenceDetails(`  a  \n\n\n\n b `), "a\n\nb");
  assert.equal(D.cleanOccurrenceDetails("x".repeat(2500)).length, 2000, "bounded like the column");
  assert.equal(D.cleanOccurrenceDetails("   "), null);
});

test("Starbucks-style tour: ONE Event, THREE occurrences, each at its own Location — the two same-time stops stay separate", () => {
  const c = SP.extractStructuredEvent(STARBUCKS, { now: NOW }).candidate;
  assert.equal(c.occurrences.length, 3);
  assert.deepEqual(c.occurrences.map((o) => [ET(o.start), o.venue.name, o.venue.address, o.venue.postalCode, o.details]), [
    ["Oct 20, 11:00 AM", "Location A", "100 Example St", "10001", "Stop A programming."],
    ["Oct 21, 12:00 PM", "Location B", "200 Example St", "10002", "Stop B programming."],
    ["Oct 21, 12:00 PM", "Location C", "300 Example St", "10003", "Stop C programming."],
  ]);
});

test("Location precedence: explicit occurrence place > Event-level place > fetched source place", () => {
  const mixed = SP.extractStructuredEvent(
    `Event Name: Mixed Stops\nLocation Name: Main Hall\nStreet Address: 1 Main St\nCity: New York\nState: NY\nStart Time: 10 AM\nEnd Time: 2 PM\n\nOccurrence 1:\nDate: Nov 2, 2026\n\nOccurrence 2:\nDate: Nov 3, 2026\nLocation Name: Annex\nStreet Address: 9 Side St`,
    { now: NOW }
  ).candidate;
  assert.deepEqual(mixed.occurrences.map((o) => [o.venue.name, o.venue.address, o.venue.city]), [
    ["Main Hall", "1 Main St", "New York"],
    ["Annex", "9 Side St", "New York"],
  ], "no place → the Event's; its own place → kept (city/state completed only when it gave none)");
  const source = { ...mixed, occurrences: mixed.occurrences.map((o) => ({ ...o, venue: { name: "Somewhere Else", address: "5 Other Ave", city: "Brooklyn", state: "NY", postalCode: null } })) };
  const merged = SM.mergeSourceIntoStructured(mixed, source);
  assert.deepEqual(merged.candidate.occurrences.map((o) => o.venue.name), ["Main Hall", "Annex"], "a fetched place never overwrites an explicit one");
  assert.ok(!merged.filled.includes("place"));
});

// ── REVIEW → SAVE ─────────────────────────────────────────────────────────

test("Starbucks: Review keeps three places; saving writes three occurrence rows, each with its own place and its own details", async () => {
  const c = SP.extractStructuredEvent(STARBUCKS, { now: NOW }).candidate;
  const review = O.operatorReviewDefaults(c, NO_MATCHES);
  assert.equal(review.sharedPlace, false, "different places → per-date places");
  assert.deepEqual(review.occurrences.map((o) => [o.place.venueName, o.details]), [
    ["Location A", "Stop A programming."],
    ["Location B", "Stop B programming."],
    ["Location C", "Stop C programming."],
  ]);
  const { client, out, normalized } = await save(c, review);
  assert.equal(out.ok, true);
  assert.equal(normalized.occurrences.length, 3, "same date/time, different place → not deduplicated");
  const rows = client.ops.find((o) => o.table === "event_occurrences" && o.kind === "insert").rows;
  assert.deepEqual(rows.map((r) => [r.venue_name, r.address, r.postal_code]), [
    ["Location A", "100 Example St", "10001"],
    ["Location B", "200 Example St", "10002"],
    ["Location C", "300 Example St", "10003"],
  ]);
  assert.ok(!rows.some((r) => "details" in r), "the insert itself never needs the new column");
  const details = client.ops.filter((o) => o.table === "event_occurrences" && o.kind === "update" && "details" in o.patch);
  assert.deepEqual(details.map((u) => [u.id, u.patch.details]), [
    ["occ-1", "Stop A programming."],
    ["occ-2", "Stop B programming."],
    ["occ-3", "Stop C programming."],
  ], "each row gets ITS date's details — matched by start time + place, not position");
});

test("same Event, four dates, ONE canonical Location: one Quick Create resolves every date; no four Locations", async () => {
  const c = SP.extractStructuredEvent(GOOD_AMERICAN, { now: NOW }).candidate;
  let review = O.operatorReviewDefaults(c, NO_MATCHES);
  assert.equal(review.sharedPlace, true, "one place for every date");
  const key = R.placeKeyFor(review.place);
  const created = { key, id: "aaaaaaaa-0000-4000-8000-0000000000aa", name: "The Canvas", address: "335 W 35th St", city: "New York", state: "NY", postalCode: "10001" };
  review = R.selectCreatedLocation(review, "shared", created);
  const { client } = await save(c, review);
  const rows = client.ops.find((o) => o.table === "event_occurrences" && o.kind === "insert").rows;
  assert.equal(rows.length, 4);
  assert.deepEqual([...new Set(rows.map((r) => r.location_id))], [created.id], "all four dates → the one Location");
  const details = client.ops.filter((o) => o.kind === "update" && "details" in o.patch).map((u) => u.patch.details);
  assert.deepEqual(details, ["Emma Grede appearance and Dot Cakes activation.", "Leora Café activation.", "Closing day\nLast-chance styling sessions."]);
});

test("details are editable per date in Review and survive normalizeReview; an edit wins", () => {
  const c = SP.extractStructuredEvent(STARBUCKS, { now: NOW }).candidate;
  const review = O.operatorReviewDefaults(c, NO_MATCHES);
  review.occurrences[1] = { ...review.occurrences[1], details: "  Edited stop B.  " };
  const n = P.normalizeReview(review);
  assert.deepEqual(n.value.occurrences.map((o) => o.details), ["Stop A programming.", "Edited stop B.", "Stop C programming."]);
  const parts = read("src/app/(public)/account/business/[id]/import-event/ReviewParts.tsx");
  assert.match(parts, /Details For This Date/);
  assert.match(parts, /onChange=\{\(e\) => onChange\(\{ details: e\.target\.value \}\)\}/);
});

test("migration-tolerant: without the column the Event and its dates still save (details write fails quietly)", async () => {
  const c = SP.extractStructuredEvent(STARBUCKS, { now: NOW }).candidate;
  const { out, client } = await save(c, O.operatorReviewDefaults(c, NO_MATCHES), fakeClient({ failDetails: true }));
  assert.equal(out.ok, true);
  assert.equal(out.newEvent, true);
  assert.equal(client.ops.find((o) => o.table === "event_occurrences" && o.kind === "insert").rows.length, 3);
  assert.equal(client.ops.filter((o) => o.kind === "update" && "details" in o.patch).length, 1, "stops after the first failure");
});

test("hosting a single date with details creates its occurrence row (the details live there)", () => {
  assert.match(read("src/lib/event-import/persist.ts"), /if \(input\.occurrences\.length > 1 \|\| snaps\.some\(\(s\) => s\.location_id\) \|\| input\.occurrences\.some\(\(d\) => d\.details\)\) \{/);
});

// ── EDIT + READ + PUBLIC ──────────────────────────────────────────────────

test("existing editors write details best-effort; reads carry it; the public page shows ONLY the selected date's details", () => {
  const admin = read("src/app/admin/(protected)/events/actions.ts");
  assert.match(admin, /const key = `details_\$\{occ\.id\}`;\n\s+if \(!formData\.has\(key\)\) continue;/);
  assert.match(read("src/components/admin/EventOccurrencesEditor.tsx"), /name=\{`details_\$\{row\.id\}`\}/);
  const member = read("src/app/(public)/account/event/actions.ts");
  assert.match(member, /if \(!formData\.has\("details"\)\) return;/);
  assert.match(member, /if \(inserted\) await writeMemberDateDetails\(admin, inserted\.id, formData\);/);
  assert.match(member, /await writeMemberDateDetails\(admin, occurrenceId, formData\);/);
  assert.match(read("src/app/(public)/account/event/[id]/EventDateFieldsForm.tsx"), /name="details"\n\s+defaultValue=\{defaultValues\.details \?\? ""\}/);
  // Reads: occurrence rows come from select("*") (details included when the column exists).
  assert.match(read("src/lib/data.ts"), /\.from\("event_occurrences"\)\n\s+\.select\("\*"\)/);
  const summary = read("src/components/EventScheduleSummary.tsx");
  assert.match(summary, /const details = selected\.details\?\.trim\(\) \|\| null;/);
  assert.match(summary, /className="mt-3 whitespace-pre-line text-body text-secondary" data-occurrence-details=""/);
  assert.match(read("src/components/EventOccurrenceQuickView.tsx"), /\{occurrence\.details\?\.trim\(\) && <p className="mt-3 whitespace-pre-line text-sm text-ink\/70">\{occurrence\.details\.trim\(\)\}<\/p>\}/);
});

test("the migration is ONE additive, nullable column (+ a length check) — nothing else", () => {
  const sql = read("supabase/migrations/20261018000000_event_occurrence_details.sql").split("\n").filter((l) => !l.startsWith("--") && l.trim()).join("\n");
  assert.equal(
    sql,
    "alter table public.event_occurrences\n  add column if not exists details text;\nalter table public.event_occurrences\n  drop constraint if exists event_occurrences_details_length_check,\n  add constraint event_occurrences_details_length_check check (details is null or char_length(details) <= 2000);"
  );
});
