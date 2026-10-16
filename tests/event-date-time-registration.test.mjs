// Event date/time precision + registration correctness — the approved
// implementation pass (spec tests 1–66). Fakes and pure functions only: no
// network, no database, no production writes. The database-level authority
// semantics (constraints + triggers) are asserted against the migration's
// own SQL here and were exercised on a throwaway local Postgres 16 (see the
// final report); this file never touches a database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { orPredicate, withDates } from "./helpers/postgrest-or.mjs";

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
const R = await import("../src/lib/event-import/review.ts");
const O = await import("../src/lib/event-import/operator.ts");
const P = await import("../src/lib/event-import/persist.ts");
const A = await import("../src/lib/event-import/attendance.ts");
const L = await import("../src/lib/event-import/attendance-links.ts");
const SM = await import("../src/lib/event-import/structured-merge.ts");
const T = await import("../src/lib/event-time.ts");
const DI = await import("../src/lib/event-date-input.ts");
const CAL = await import("../src/lib/calendar.ts");
const SYNC = await import("../src/lib/appearance-event-sync.ts");
const ST = await import("../src/lib/schedule-time.ts");
const read = (p) => readFileSync(p, "utf8");
const NOW = Date.parse("2026-10-01T12:00:00Z");
const NO_MATCHES = { event: null, locations: [], organizerBusiness: null, existingAppearance: null };
const MIGRATION = read("supabase/migrations/20261019000000_event_date_time_precision.sql");
const PUBLIC_VIEW = read("src/app/(public)/event/[slug]/EventPublicView.tsx");

// ── fixtures ────────────────────────────────────────────────────────────

const TRACE = `Event Name: TRACE The Presale Marketplace × Shopify
Primary Business: TRACE
Location Name: Shopify New York
City: New York
State: NY
Date: October 24, 2026
Start Time: 11:00 AM
RSVP: https://partiful.com/e/trace2026
Event Link: https://www.tracemarket.com/presale`;

const FUJIKINA = `Event Name: FUJIKINA NYC 2026
Primary Business: Fujifilm
Event Link: https://www.fujikina.com/nyc-2026
Tickets: https://www.eventbrite.com/e/fujikina-nyc-2026-123456
Register: https://fujikina.com/register

Occurrence 1:
Date: October 16, 2026
Location Name: World Press Photo
City: New York
State: NY
Programming: 4:30 PM — Art March stop

Occurrence 2:
Date: October 16, 2026
Location Name: Magnum Photos
City: New York
State: NY

Occurrence 3:
Date: October 16, 2026
Location Name: Fujifilm Brand House
City: New York
State: NY

Occurrence 4:
Date: October 17, 2026
Location Name: Fujifilm Brand House
City: New York
State: NY
Start Time: 10:00 AM
End Time: 6:00 PM

Occurrence 5:
Date: October 18, 2026
Location Name: International Center of Photography
City: New York
State: NY`;

const BLISS = `Event Name: Bliss Lemon & Sage Stand
Primary Business: Bliss
Location Name: Bliss Stand
City: New York
State: NY
Date: October 20, 2026
Start Time: 12:00 PM
End Time: 5:00 PM`;

const extract = (text) => SP.extractStructuredEvent(text, { now: NOW });
const reviewOf = (text, intent = "participating") => ({ ...R.reviewDefaults(extract(text).candidate, NO_MATCHES, intent), asEvent: true });

/** Recording client for persistDiscoveryEvent (inserts return their rows with ids). */
function fakeClient() {
  const ops = [];
  let seq = 0;
  return {
    ops,
    rpc: async () => ({ data: null, error: { message: "unused" } }),
    from(table) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        in: () => chain,
        neq: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: null }),
        then: (res) => res({ data: [], error: null }),
        insert: (input) => {
          const rows = Array.isArray(input) ? input : [input];
          ops.push({ table, kind: "insert", rows });
          const withIds = rows.map((r) => ({ id: `${table}-${++seq}`, ...r }));
          return {
            select: () => ({ single: async () => ({ data: withIds[0], error: null }), then: (cb) => cb({ data: withIds, error: null }) }),
            then: (cb) => cb({ error: null }),
          };
        },
        upsert: (row) => (ops.push({ table, kind: "upsert", rows: [row] }), Promise.resolve({ error: null })),
        update: (patch) => {
          ops.push({ table, kind: "update", patch });
          const c = { eq: () => c, then: (cb) => cb({ error: null }) };
          return c;
        },
      };
      return chain;
    },
  };
}
const deps = (client) => ({ admin: client, storeImage: async (u) => `stored:${u}`, geography: async () => null, uniqueEventSlug: async () => "e", propagateDates: async () => {}, findEventBySourceUrl: async () => null });
async function save(review) {
  const n = P.normalizeReview(review);
  assert.equal(n.ok, true, n.error);
  const client = fakeClient();
  const out = await P.persistDiscoveryEvent(n.value, null, deps(client));
  assert.equal(out.ok, true, out.error);
  const event = client.ops.find((o) => o.table === "events" && o.kind === "insert").rows[0];
  const occurrences = client.ops.find((o) => o.table === "event_occurrences" && o.kind === "insert").rows;
  const details = client.ops.filter((o) => o.table === "event_occurrences" && o.kind === "update").map((o) => o.patch.details);
  return { n: n.value, event, occurrences, details, client };
}

// ── REGISTRATION ────────────────────────────────────────────────────────

test("1. a pasted RSVP URL survives parsing", () => {
  const c = extract(TRACE).candidate;
  assert.deepEqual(c.structured.links.rsvp, { cta: "rsvp", url: "https://partiful.com/e/trace2026" });
  // Labels beyond the original five are read too (the root cause: they were dropped).
  for (const label of ["Registration", "Sign Up", "Reserve", "RSVP Link"]) {
    const t = extract(`Event Name: X\nDate: October 24, 2026\n${label}: https://example.com/go`).candidate;
    assert.equal(t.structured.links.rsvp?.url, "https://example.com/go", label);
  }
});

test("2. a pasted Ticket URL survives parsing — alongside an RSVP, both kept", () => {
  const c = extract(FUJIKINA).candidate;
  assert.equal(c.structured.links.tickets, "https://www.eventbrite.com/e/fujikina-nyc-2026-123456");
  assert.deepEqual(c.structured.links.rsvp, { cta: "register", url: "https://fujikina.com/register" });
  assert.equal(c.sourceUrl, "https://www.fujikina.com/nyc-2026", "the Event Link stays the Event Link");
});

test("3. an operator edit wins over enrichment", () => {
  const edited = { ...reviewOf(TRACE), attendance: { cta: "register", url: "https://operator.example/reg" }, ticketsUrl: null };
  const fresh = { ...edited, attendance: { cta: "rsvp", url: "https://page.example/rsvp" }, ticketsUrl: "https://page.example/tix" };
  const merged = O.fillReviewGaps(edited, fresh, { hadImage: false });
  assert.deepEqual(merged.attendance, { cta: "register", url: "https://operator.example/reg" });
  assert.equal(merged.ticketsUrl, "https://page.example/tix", "only the EMPTY ticket slot is filled");
  // Pasted values beat the page's evidenced value in Review defaults.
  assert.deepEqual(L.reviewAttendanceDefaults({ rsvp: { cta: "rsvp", url: "https://pasted/rsvp" }, tickets: null }, { cta: "rsvp", url: "https://page/rsvp" }), {
    attendance: { cta: "rsvp", url: "https://pasted/rsvp" },
    ticketsUrl: null,
  });
});

test("4. an extracted registration URL reaches Review", () => {
  const candidate = { ...extract(BLISS).candidate, structured: undefined, attendance: { ...A.UNKNOWN_ATTENDANCE, cta: "register", url: "https://bliss.example/register", basis: "control" } };
  const r = R.reviewDefaults(candidate, NO_MATCHES, "participating");
  assert.deepEqual(r.attendance, { cta: "register", url: "https://bliss.example/register" });
  // Beside a pasted ticket link, the page's registration fills the empty RSVP slot.
  const base = extract(BLISS).candidate;
  const both = R.reviewDefaults({ ...base, structured: { ...base.structured, links: { rsvp: null, tickets: "https://t.example" }, pageAttendance: { cta: "register", url: "https://bliss.example/register" } } }, NO_MATCHES, "participating");
  assert.deepEqual([both.attendance, both.ticketsUrl], [{ cta: "register", url: "https://bliss.example/register" }, "https://t.example"]);
});

test("5. an extracted Ticket URL reaches Review", () => {
  const candidate = { ...extract(BLISS).candidate, structured: undefined, attendance: { ...A.UNKNOWN_ATTENDANCE, cta: "tickets", url: "https://tix.example/e/1", basis: "offer" } };
  const r = R.reviewDefaults(candidate, NO_MATCHES, "participating");
  assert.deepEqual(L.attendanceSlots(r), { rsvp: null, tickets: "https://tix.example/e/1" });
});

test("6. an informational Event Link is not automatically RSVP", () => {
  assert.equal(A.isRegistrationPlatformEventUrl("https://www.fujikina.com/nyc-2026"), false);
  assert.equal(A.isRegistrationPlatformEventUrl("https://www.tracemarket.com/presale"), false);
  assert.equal(A.isRegistrationPlatformEventUrl("https://www.eventbrite.com/d/ny--new-york/events/"), false, "a listing page");
  const evidence = { pricing: "unknown", price: null, url: null, urlBasis: null, wording: null, registration: "unknown", hiddenLocation: false };
  assert.equal(A.decideAttendance(evidence, { lumaEventUrl: null }).url, null);
  // A pasted Event Link alone never becomes an attendance slot.
  const r = reviewOf(`Event Name: X\nDate: October 24, 2026\nEvent Link: https://www.fujikina.com/nyc-2026`);
  assert.equal(r.attendance, null);
  assert.equal(r.ticketsUrl ?? null, null);
  assert.equal(r.sourceUrl, "https://www.fujikina.com/nyc-2026");
});

test("7. a genuine registration Event Link can be used appropriately (single-Event platform pages)", () => {
  for (const url of ["https://lu.ma/trace-presale", "https://www.eventbrite.com/e/fujikina-nyc-2026-123456", "https://partiful.com/e/trace2026"]) {
    assert.equal(A.isRegistrationPlatformEventUrl(url), true, url);
  }
  const evidence = { pricing: "unknown", price: null, url: null, urlBasis: null, wording: null, registration: "unknown", hiddenLocation: false };
  const a = A.decideAttendance(evidence, { lumaEventUrl: "https://partiful.com/e/trace2026" });
  assert.deepEqual([a.url, a.cta, a.basis], ["https://partiful.com/e/trace2026", "register", "platform"]);
  // The engine only offers it for a verified single-Event page.
  assert.match(read("src/lib/event-import/engine.ts"), /isRegistrationPlatformEventUrl\(candidate\.sourceUrl\) && \(candidate\.sources\.title === "structured" \|\| record !== null\)/);
  // Whole-label CTA wording the spec lists (never a word inside copy).
  for (const w of ["Sign Up", "Reserve", "Reserve a Spot", "Book Now", "Book", "Attend", "Register"]) assert.equal(A.controlWording(w), "register", w);
  assert.equal(A.controlWording("Get Tickets"), "tickets");
  assert.equal(A.controlWording("RSVP"), "rsvp");
  assert.equal(A.controlWording("Book a table for dinner after the show"), null);
});

test("8–9. RSVP and Ticket URLs survive Event creation (separate columns)", async () => {
  const { event } = await save(reviewOf(FUJIKINA));
  assert.equal(event.rsvp_url, "https://fujikina.com/register");
  assert.equal(event.rsvp_enabled, true);
  assert.equal(event.tickets_url, "https://www.eventbrite.com/e/fujikina-nyc-2026-123456");
  assert.equal(event.tickets_enabled, true);
  assert.equal(event.external_url, "https://www.fujikina.com/nyc-2026");
  const trace = await save(reviewOf(TRACE));
  assert.equal(trace.event.rsvp_url, "https://partiful.com/e/trace2026");
  assert.equal(trace.event.tickets_url, undefined, "no ticket link invented");
});

test("10. Event editing preserves valid URLs", () => {
  const form = read("src/app/admin/(protected)/events/EventForm.tsx");
  assert.match(form, /name="rsvp_url" type="url" defaultValue=\{event\?\.rsvp_url\}/);
  assert.match(form, /name="tickets_url" type="url" defaultValue=\{event\?\.tickets_url\}/);
  const actions = read("src/app/admin/(protected)/events/actions.ts");
  assert.match(actions, /rsvp_url: str\(formData, "rsvp_url"\)/);
  assert.match(actions, /tickets_url: str\(formData, "tickets_url"\)/);
});

test("11 / 66. absent enrichment never erases an existing URL or other good data", async () => {
  const EE = await import("../src/lib/event-import/existing-event.ts");
  const snapshot = { id: "e", name: "Bliss", slug: "bliss", coverImageUrl: "https://img", description: "Good", externalUrl: "https://bliss", attendanceUrl: "https://bliss/rsvp", ticketsUrl: "https://bliss/tix", organizerName: "Bliss", categoryIds: [], formatIds: [], businesses: [], occurrenceCount: 1, occurrencesWithoutLocation: 0 };
  const empty = EE.proposalFromReview({}, null);
  assert.deepEqual(EE.compareExistingEvent(snapshot, empty), [], "nothing proposed → nothing to write");
  // A fresh reading with no links never clears an operator's slot.
  const review = { ...reviewOf(TRACE), description: "Keep me" };
  const merged = O.fillReviewGaps(review, { ...review, attendance: null, ticketsUrl: null, description: "", occurrences: [] }, { hadImage: true });
  assert.deepEqual(merged.attendance, review.attendance);
  assert.equal(merged.description, "Keep me");
  // RSVP and Tickets compare separately — one never overwrites the other.
  const p = EE.proposalFromReview({ attendance: { cta: "tickets", url: "https://new/tix" } }, null);
  assert.deepEqual(EE.compareExistingEvent({ ...snapshot, ticketsUrl: null }, p).map((c) => [c.field, c.kind]), [["tickets", "fill"]]);
});

test("12–13. public RSVP / Registration and Ticket CTAs render from their own fields (never from the Event Link)", () => {
  assert.match(PUBLIC_VIEW, /event\.rsvp_enabled \? resolveEventActionForm\("rsvp", event, event\.rsvp_url\)/);
  assert.match(PUBLIC_VIEW, /const rsvpLabel = rsvpActionLabel\(event\.rsvp_cta\)/);
  assert.match(PUBLIC_VIEW, /if \(event\.tickets_enabled && event\.tickets_url\) \{\s*customCtas\.push\(\{ label: "Get Tickets", href: event\.tickets_url/);
  assert.doesNotMatch(PUBLIC_VIEW, /href: event\.external_url[^\n]*(Get Tickets|RSVP|Register)/);
});

// ── DATE / TIME MODEL ───────────────────────────────────────────────────

const occ = (date, startTime = "", endTime = "", venueName = "Hall") => ({ ...R.emptyReviewOccurrence({ venueName, address: null, city: "New York", state: "NY", postalCode: null, useLocationId: null }), date, startTime, endTime });
const reviewWith = (occurrences) => ({ ...reviewOf(BLISS), occurrences, sharedPlace: false });

test("14–18. the three valid states; no date and end-without-start are rejected (import + editor)", () => {
  assert.equal(P.normalizeReview(reviewWith([occ("2026-10-16", "11:00", "19:00")])).ok, true);
  assert.equal(P.normalizeReview(reviewWith([occ("2026-10-16", "11:00")])).ok, true);
  assert.equal(P.normalizeReview(reviewWith([occ("2026-10-16")])).ok, true);
  assert.equal(P.normalizeReview(reviewWith([occ("")])).error, "Each date needs a day.");
  assert.equal(P.normalizeReview(reviewWith([occ("2026-10-16", "", "19:00")])).error, "An end time needs a start time. Add the start, or clear the end.");
  // The Admin editor's parser — the same rules.
  assert.equal(DI.parseOccurrenceDateTimes({ date: "2026-10-16", startLocal: "2026-10-16T11:00", endLocal: "2026-10-16T19:00" }).ok, true);
  assert.deepEqual(DI.parseOccurrenceDateTimes({ date: "2026-10-16", startLocal: "2026-10-16T11:00", endLocal: "" }), { ok: true, date: "2026-10-16", startIso: "2026-10-16T15:00:00.000Z", endIso: null });
  assert.deepEqual(DI.parseOccurrenceDateTimes({ date: "2026-10-16", startLocal: "", endLocal: "" }), { ok: true, date: "2026-10-16", startIso: null, endIso: null });
  assert.equal(DI.parseOccurrenceDateTimes({ date: "", startLocal: "", endLocal: "" }).ok, false);
  assert.equal(DI.parseOccurrenceDateTimes({ date: "2026-10-16", startLocal: "", endLocal: "2026-10-16T19:00" }).ok, false);
  assert.equal(DI.parseOccurrenceDateTimes({ date: "2026-10-16", startLocal: "2026-10-16T19:00", endLocal: "2026-10-16T11:00" }).ok, false);
  assert.equal(DI.parseEventDateTimes({ startLocal: "", endLocal: "", startDate: "", endDate: "" }).error, "A start date is required.");
});

test("19–20. no fake end and no fake start/end are generated", async () => {
  const { occurrences, event } = await save(reviewWith([occ("2026-10-24", "11:00"), occ("2026-10-25")]));
  assert.deepEqual(occurrences.map((o) => [o.occurrence_date, o.start_at, o.end_at]), [
    ["2026-10-24", "2026-10-24T15:00:00.000Z", null],
    ["2026-10-25", null, null],
  ]);
  assert.equal(event.end_at, null);
  assert.equal(event.end_date, "2026-10-25");
  // The editor never auto-fills an end in optional-time mode, and no
  // placeholder time convention is used for Event dates.
  assert.match(read("src/components/scheduling/DateTimeRangeFields.tsx"), /optionalTimes/);
  for (const f of ["src/lib/event-import/persist.ts", "src/lib/appearance-event-sync.ts", "src/app/admin/(protected)/events/actions.ts"]) {
    assert.doesNotMatch(read(f), /TIME_UNKNOWN_MARKER|time-tbd|T12:00:00/, f);
  }
  assert.doesNotMatch(read("src/lib/calendar.ts"), /2 \* 60 \* 60 \* 1000|7200000/, "no 2-hour calendar end");
});

test("21–25. occurrence authority semantics (migration SQL)", () => {
  assert.match(MIGRATION, /alter table public\.event_occurrences alter column occurrence_date set not null;/);
  assert.match(MIGRATION, /alter table public\.event_occurrences alter column start_at drop not null;/);
  assert.match(MIGRATION, /alter table public\.event_occurrences alter column end_at drop not null;/);
  assert.match(MIGRATION, /check \(end_at is null or \(start_at is not null and end_at > start_at\)\)/);
  assert.match(MIGRATION, /check \(start_at is null or \(start_at at time zone timezone\)::date = occurrence_date\)/);
  // 21/24: a known start decides the date; 22/23: with no start the date is never touched.
  const fn = MIGRATION.slice(MIGRATION.indexOf("function public.event_occurrences_sync_date"), MIGRATION.indexOf("drop trigger if exists trg_event_occurrences_sync_date"));
  assert.match(fn, /if new\.start_at is not null then\s+new\.occurrence_date := \(new\.start_at at time zone new\.timezone\)::date;\s+end if;/);
  assert.doesNotMatch(fn, /occurrence_date := null/);
  assert.match(MIGRATION, /before insert or update of start_at, timezone, occurrence_date on public\.event_occurrences/);
  // 25: clearing the end touches nothing else.
  assert.doesNotMatch(fn, /end_at/);
  // The editor writes the reviewed date with each row.
  assert.match(read("src/app/admin/(protected)/events/actions.ts"), /occurrence_date/);
});

test("26–29. parent Event authority semantics (migration SQL)", () => {
  assert.match(MIGRATION, /alter table public\.events alter column start_date set not null;/);
  assert.match(MIGRATION, /alter table public\.events alter column start_at drop not null;/);
  assert.match(MIGRATION, /check \(end_date is null or end_date >= start_date\)/);
  assert.match(MIGRATION, /check \(start_at is null or \(start_at at time zone 'America\/New_York'\)::date = start_date\)/);
  assert.match(MIGRATION, /check \(end_at is null or \(start_at is not null and end_date is not null and \(end_at at time zone 'America\/New_York'\)::date = end_date\)\)/);
  const fn = MIGRATION.slice(MIGRATION.indexOf("function public.events_sync_dates"), MIGRATION.indexOf("drop trigger if exists trg_events_sync_dates"));
  assert.match(fn, /if new\.start_at is not null then\s+new\.start_date :=/);
  assert.match(fn, /if new\.end_at is not null then\s+new\.end_date :=/);
  assert.doesNotMatch(fn, /start_date := null|end_date := null/);
  // Backfill only from existing real timestamps; no timestamp is updated.
  assert.doesNotMatch(MIGRATION, /set\s+(start_at|end_at)\s*=/i);
  assert.match(MIGRATION, /set occurrence_date = \(start_at at time zone timezone\)::date\s+where occurrence_date is null;/);
  assert.doesNotMatch(MIGRATION.replace(/--.*$/gm, ""), /appearances/, "the Appearances schema is untouched");
  // A date-only parent keeps its range (29) — pure parse used by the editor.
  assert.deepEqual(DI.parseEventDateTimes({ startLocal: "", endLocal: "", startDate: "2026-10-16", endDate: "2026-10-18" }), { ok: true, startIso: null, endIso: null, startDate: "2026-10-16", endDate: "2026-10-18" });
  assert.equal(DI.parseEventDateTimes({ startLocal: "", endLocal: "", startDate: "2026-10-18", endDate: "2026-10-16" }).ok, false);
});

test("30–31. parent range from mixed dates; FUJIKINA → Oct 16 – Oct 18 with no fabricated parent timestamps", async () => {
  const mixed = P.parentEventRange([
    { date: "2026-10-16", start: "2026-10-16T15:00:00.000Z", end: "2026-10-16T23:00:00.000Z" },
    { date: "2026-10-17", start: "2026-10-17T15:00:00.000Z", end: null },
    { date: "2026-10-18", start: null, end: null },
  ]);
  assert.deepEqual(mixed, { start_date: "2026-10-16", end_date: "2026-10-18", start_at: "2026-10-16T15:00:00.000Z", end_at: null });
  const { event } = await save(reviewOf(FUJIKINA));
  assert.deepEqual([event.start_date, event.end_date, event.start_at, event.end_at], ["2026-10-16", "2026-10-18", null, null]);
});

// ── MULTI-LOCATION / PROGRAMMING ────────────────────────────────────────

test("32–35. same date + different Locations stay distinct with null times; same date + same Location is still de-duplicated", async () => {
  const { occurrences } = await save(reviewOf(FUJIKINA));
  const oct16 = occurrences.filter((o) => o.occurrence_date === "2026-10-16").map((o) => o.venue_name).sort();
  assert.deepEqual(oct16, ["Fujifilm Brand House", "Magnum Photos", "World Press Photo"]);
  assert.ok(occurrences.filter((o) => o.occurrence_date === "2026-10-16").every((o) => o.start_at === null && o.end_at === null));
  const dup = P.normalizeReview(reviewWith([occ("2026-10-16", "", "", "Magnum Photos"), occ("2026-10-16", "", "", "Magnum Photos"), occ("2026-10-16", "", "", "World Press Photo")]));
  assert.deepEqual(dup.value.occurrences.map((o) => o.place.name), ["Magnum Photos", "World Press Photo"]);
  // Locations confirmed by id: identity uses the Location.
  const a = { date: "2026-10-16", start: null, place: { locationId: "loc-a" } };
  const b = { date: "2026-10-16", start: null, place: { locationId: "loc-b" } };
  assert.notEqual(P.importDateKey(a), P.importDateKey(b));
  assert.equal(P.importDateKey(a), P.importDateKey({ ...a }));
  // Created rows are matched back by date + start + place, never position.
  assert.equal(P.sameImportDateRow({ id: "1", occurrence_date: "2026-10-16", start_at: null, location_id: null, venue_name: "Magnum Photos" }, { date: "2026-10-16", start: null }, { location_id: null, venue_name: "World Press Photo" }), false);
});

test("36–38. mixed known/unknown times survive; Programming survives on its own date and never becomes hours", async () => {
  const { occurrences, details } = await save(reviewOf(FUJIKINA));
  const brand17 = occurrences.find((o) => o.occurrence_date === "2026-10-17");
  assert.deepEqual([brand17.start_at, brand17.end_at], ["2026-10-17T14:00:00.000Z", "2026-10-17T22:00:00.000Z"]);
  const wpp = occurrences.find((o) => o.venue_name === "World Press Photo");
  assert.deepEqual([wpp.start_at, wpp.end_at], [null, null], "4:30 PM Programming is not an opening time");
  assert.ok(details.includes("4:30 PM — Art March stop"));
  // Event Link enrichment can't fill a date that shares its day with other Locations.
  const page = [{ start: "2026-10-16T20:30:00.000Z", end: "2026-10-16T22:00:00.000Z", hasTime: true, venue: { name: "World Press Photo" } }];
  const pasted = extract(FUJIKINA).candidate.occurrences;
  assert.equal(SM.sourceTimeFor(pasted.find((o) => o.venue.name === "World Press Photo"), pasted, page), false);
});

test("39. the parent Event span never becomes occurrence hours", async () => {
  const { occurrences, event } = await save(reviewOf(FUJIKINA));
  assert.equal(occurrences.filter((o) => o.start_at).length, 1, "only the date that published hours has them");
  assert.ok(occurrences.every((o) => o.start_at === null || o.start_at !== event.start_at || event.start_at === null));
  const persist = read("src/lib/event-import/persist.ts");
  const insertRow = persist.slice(persist.indexOf("export function occurrenceInsertRow"));
  assert.doesNotMatch(insertRow.slice(0, insertRow.indexOf("\n}\n")), /range\.|start_date|end_date/, "a date's row takes only its own times");
});

// ── DISPLAY / DISCOVERY / EDITOR ────────────────────────────────────────

const TIMED = { id: "a", occurrence_date: "2026-10-16", start_at: "2026-10-16T15:00:00.000Z", end_at: "2026-10-16T23:00:00.000Z", timezone: "America/New_York" };
const START_ONLY = { id: "b", occurrence_date: "2026-10-16", start_at: "2026-10-16T15:00:00.000Z", end_at: null, timezone: "America/New_York" };
const DATE_ONLY = { id: "c", occurrence_date: "2026-10-16", start_at: null, end_at: null, timezone: "America/New_York" };

test("40–43. public formatting is truthful per state; Admin / Review shows Time Not Listed", () => {
  assert.equal(T.formatWhen(TIMED), "Fri, Oct 16 · 11:00 AM – 7:00 PM");
  assert.equal(T.formatWhen(START_ONLY), "Fri, Oct 16 · 11:00 AM");
  assert.equal(T.formatWhen(DATE_ONLY), "Friday, October 16");
  assert.equal(T.formatWhen(DATE_ONLY, { admin: true }), "Fri, Oct 16 · Time Not Listed");
  assert.equal(R.occurrenceSummary({ date: "2026-10-16", startTime: "", endTime: "" }).time, "Time Not Listed");
  assert.match(R.occurrenceSummary({ date: "2026-10-16", startTime: "11:00", endTime: "" }).time, /11:00 AM/);
  assert.doesNotMatch(R.occurrenceSummary({ date: "2026-10-16", startTime: "11:00", endTime: "" }).time, /–/);
  assert.equal(T.formatEventRange({ start_at: null, end_at: null, start_date: "2026-10-16", end_date: "2026-10-18" }), "Fri, Oct 16 – Sun, Oct 18");
});

test("44–45. the Event editor preserves a null end and null start/end", () => {
  assert.deepEqual(DI.parseEventDateTimes({ startLocal: "2026-10-24T11:00", endLocal: "", startDate: "2026-10-24", endDate: "" }), { ok: true, startIso: "2026-10-24T15:00:00.000Z", endIso: null, startDate: "2026-10-24", endDate: null });
  assert.deepEqual(DI.parseEventDateTimes({ startLocal: "", endLocal: "", startDate: "2026-10-16", endDate: "" }), { ok: true, startIso: null, endIso: null, startDate: "2026-10-16", endDate: null });
  const form = read("src/app/admin/(protected)/events/EventForm.tsx");
  assert.match(form, /optionalTimes/);
  assert.match(form, /dateName="start_date"/);
  assert.match(form, /endDateName="end_date"/);
});

test("46–49. Today, date filters and Upcoming include date-only / start-only dates by calendar date", () => {
  const rows = [TIMED, START_ONLY, DATE_ONLY, { ...DATE_ONLY, id: "d", occurrence_date: "2026-10-17" }].map(withDates);
  // Today = Oct 16 local.
  const today = orPredicate(T.occurrenceWindowOr("2026-10-16T04:00:00.000Z", "2026-10-17T04:00:00.000Z", "2026-10-16", "2026-10-16"));
  assert.deepEqual(rows.filter(today).map((r) => r.id), ["a", "b", "c"]);
  const weekend = orPredicate(T.occurrenceWindowOr("2026-10-17T04:00:00.000Z", "2026-10-19T04:00:00.000Z", "2026-10-17", "2026-10-18"));
  assert.deepEqual(rows.filter(weekend).map((r) => r.id), ["d"]);
  // Late on Oct 16 (after the timed end): the untimed Oct 16 dates are still upcoming.
  const late = orPredicate(T.occurrenceUpcomingOr("2026-10-17T02:00:00.000Z", "2026-10-16"));
  assert.deepEqual(rows.filter(late).map((r) => r.id), ["b", "c", "d"]);
  const nextDay = orPredicate(T.occurrenceUpcomingOr("2026-10-17T12:00:00.000Z", "2026-10-17"));
  assert.deepEqual(rows.filter(nextDay).map((r) => r.id), ["d"], "over once its calendar date passes");
  assert.equal(T.occursOnDate(DATE_ONLY, "2026-10-16"), true);
  // Parent Event filters too.
  const parent = withDates({ id: "p", start_at: null, end_at: null, start_date: "2026-10-16", end_date: "2026-10-18" });
  assert.equal(orPredicate(T.eventUpcomingOr("2026-10-18T20:00:00.000Z", "2026-10-18"))(parent), true);
  assert.equal(orPredicate(T.eventWindowOr("2026-10-17T04:00:00.000Z", "2026-10-18T04:00:00.000Z", "2026-10-17", "2026-10-17"))(parent), true);
});

test("50–51. Happening Now: never date-only, never start-only indefinitely", () => {
  const during = new Date("2026-10-16T18:00:00.000Z");
  assert.equal(T.isHappeningNow(TIMED, during), true);
  assert.equal(T.isHappeningNow(DATE_ONLY, during), false);
  assert.equal(T.isHappeningNow(START_ONLY, during), false);
  assert.equal(T.isHappeningNow(START_ONLY, new Date("2026-10-20T18:00:00.000Z")), false);
  assert.equal(T.temporalLabelFor(DATE_ONLY, during).live, false);
  assert.equal(ST.pickTodayOccurrence([DATE_ONLY, START_ONLY], during).auto, null, "two today, none live → no guess");
});

test("52. deterministic ordering without fake timestamps (date → start → untimed → id)", () => {
  const rows = [{ ...DATE_ONLY, id: "z" }, { ...DATE_ONLY, id: "y" }, START_ONLY, { ...TIMED, id: "x", start_at: "2026-10-16T13:00:00.000Z" }, { ...DATE_ONLY, id: "w", occurrence_date: "2026-10-15" }];
  assert.deepEqual([...rows].sort(T.compareChronological).map((r) => r.id), ["w", "x", "b", "y", "z"]);
});

test("53–54. calendar export: date-only is all-day; start-only has no Findmi end", () => {
  assert.deepEqual(CAL.icsTimeLines({ startAt: null, date: "2026-10-16" }), ["DTSTART;VALUE=DATE:20261016", "DTEND;VALUE=DATE:20261017"]);
  assert.deepEqual(CAL.icsTimeLines({ startAt: null, date: "2026-10-16", endDate: "2026-10-18" }), ["DTSTART;VALUE=DATE:20261016", "DTEND;VALUE=DATE:20261019"]);
  assert.deepEqual(CAL.icsTimeLines({ startAt: "2026-10-24T15:00:00.000Z", endAt: null }), ["DTSTART:20261024T150000Z"]);
  assert.deepEqual(CAL.icsTimeLines({ startAt: TIMED.start_at, endAt: TIMED.end_at }), ["DTSTART:20261016T150000Z", "DTEND:20261016T230000Z"]);
});

/** Fake client for ensureOccurrenceAppearance: one occurrence row; records appearance inserts. */
function syncClient(occurrence) {
  const inserts = [];
  return {
    inserts,
    from(table) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: table === "event_occurrences" ? occurrence : null }),
        insert: async (row) => (inserts.push({ table, row }), { error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
      return chain;
    },
  };
}
const EVENT_JOIN = { name: "FUJIKINA NYC 2026", venue_name: null, address: null, city: "New York", state: "NY", latitude: null, longitude: null };

test("55. a date-only occurrence is not mirrored to Appearances (no placeholder time)", async () => {
  const c = syncClient({ event_id: "ev", start_at: null, end_at: null, location_id: null, events: EVENT_JOIN });
  await SYNC.ensureOccurrenceAppearance(c, "occ-1", "biz-1");
  assert.deepEqual(c.inserts, []);
});

test("56. a start-only occurrence may mirror, with a null Appearance end", async () => {
  const c = syncClient({ event_id: "ev", start_at: "2026-10-24T15:00:00.000Z", end_at: null, location_id: null, events: EVENT_JOIN });
  await SYNC.ensureOccurrenceAppearance(c, "occ-1", "biz-1");
  assert.equal(c.inserts.length, 1);
  assert.equal(c.inserts[0].row.start_at, "2026-10-24T15:00:00.000Z");
  assert.equal(c.inserts[0].row.end_at, null);
  assert.equal(c.inserts[0].row.event_occurrence_id, "occ-1");
});

// ── ACCEPTANCE / REGRESSION ─────────────────────────────────────────────

test("57. Bliss: a fully timed Event stays valid and unchanged in shape", async () => {
  const { event, occurrences } = await save(reviewOf(BLISS));
  assert.deepEqual([event.start_date, event.end_date, event.start_at, event.end_at], ["2026-10-20", "2026-10-20", "2026-10-20T16:00:00.000Z", "2026-10-20T21:00:00.000Z"]);
  assert.equal(occurrences.length, 1);
  assert.equal(T.formatWhen({ ...occurrences[0], timezone: "America/New_York" }), "Tue, Oct 20 · 12:00 PM – 5:00 PM");
});

test("58. TRACE: a known start with an unknown end is accepted, kept null and shown truthfully", async () => {
  const r = reviewOf(TRACE);
  assert.deepEqual([r.occurrences[0].startTime, r.occurrences[0].endTime], ["11:00", ""]);
  assert.equal(R.batchItemStatus(r, NO_MATCHES).missing.includes(R.END_WITHOUT_START), false, "not blocked");
  const { event, occurrences } = await save(r);
  assert.deepEqual([occurrences[0].start_at, occurrences[0].end_at], ["2026-10-24T15:00:00.000Z", null]);
  assert.deepEqual([event.start_at, event.end_at, event.start_date, event.end_date], ["2026-10-24T15:00:00.000Z", null, "2026-10-24", "2026-10-24"]);
  assert.equal(T.formatWhen({ ...occurrences[0], timezone: "America/New_York" }), "Sat, Oct 24 · 11:00 AM");
});

test("59–62. FUJIKINA: unknown times, distinct Locations, registration + tickets and Programming all survive", async () => {
  const { event, occurrences, details } = await save(reviewOf(FUJIKINA));
  assert.equal(occurrences.length, 5);
  assert.equal(new Set(occurrences.map((o) => `${o.occurrence_date}|${o.venue_name}`)).size, 5);
  assert.equal(occurrences.filter((o) => o.start_at === null).length, 4);
  assert.equal(event.rsvp_url, "https://fujikina.com/register");
  assert.equal(event.tickets_url, "https://www.eventbrite.com/e/fujikina-nyc-2026-123456");
  assert.deepEqual(details, ["4:30 PM — Art March stop"]);
});

test("63–65. image, Business and Location preparation paths are intact", async () => {
  const withImage = { ...reviewOf(BLISS), imageUrl: "https://cdn.example/bliss.jpg" };
  const { event } = await save(withImage);
  assert.equal(event.cover_image_url, "stored:https://cdn.example/bliss.jpg", "re-hosted through storeImage, as before");
  // Business evidence and a confirmed Location are still carried through Review.
  assert.equal(O.eventBusinessEvidence(extract(BLISS).candidate), "Bliss");
  const n = P.normalizeReview({ ...reviewOf(FUJIKINA), occurrences: reviewOf(FUJIKINA).occurrences.map((o, i) => (i === 0 ? { ...o, place: { ...o.place, useLocationId: "aaaaaaaa-0000-4000-8000-000000000001" } } : o)) });
  assert.equal(n.value.occurrences.find((o) => o.place.locationId)?.place.locationId, "aaaaaaaa-0000-4000-8000-000000000001");
});

test("migration: the occurrence_date backfill suspends ONLY the updated_at trigger, for that one statement", () => {
  const sql = MIGRATION.replace(/--.*$/gm, "");
  const disable = sql.indexOf("alter table public.event_occurrences disable trigger trg_event_occurrences_updated_at;");
  const backfill = sql.indexOf("set occurrence_date = (start_at at time zone timezone)::date");
  const enable = sql.indexOf("alter table public.event_occurrences enable trigger trg_event_occurrences_updated_at;");
  assert.ok(disable > -1 && disable < backfill && backfill < enable, "disable → backfill → enable");
  assert.equal(sql.slice(disable, enable).match(/;/g).length, 2, "nothing else runs while it is disabled");
  assert.equal((sql.match(/disable trigger/g) ?? []).length, 1, "no other trigger is disabled");
  assert.doesNotMatch(sql, /disable trigger all|session_replication_role/i);
  assert.doesNotMatch(sql, /\b(begin|commit)\s*;/i, "runs inside the migration's own transaction");
  assert.ok(enable < sql.indexOf("alter column occurrence_date set not null"), "re-enabled before the rest of the migration");
});

// ── Live TRACE regression: the Admin pipeline with a blocked Event Link ──

const ENGINE = await import("../src/lib/event-import/engine.ts");
const blockedDeps = () => ({
  fetchPage: async () => ({ ok: false, code: "http_error", redirects: 0, status: 403 }),
  ai: null,
  matchEvent: async () => null,
  getEvent: async () => null,
  matchLocations: async () => [],
  matchOrganizer: async () => null,
  matchExistingAppearance: async () => null,
  findScheduledBySourceUrl: async () => null,
  findEventBySourceUrl: async () => null,
  isRateLimited: () => false,
  now: () => NOW,
});
const TRACE_LIVE = (links) => `Event Name: TRACE Pop-Up: Shop What's Next
Primary Business: TRACE
Location: Shopify New York
Address: 131 Greene Street, New York, NY 10012
${links}

Description: Meet TRACE, The Presale Marketplace. Try TRACE live and shop
jewelry, handbags and accessories from female-founded brands during its NYC
launch weekend at Shopify New York.

Occurrence 1:
Date: October 16, 2026
Start Time: 11:00 AM
End Time: 5:00 PM
Location: Shopify New York
Address: 131 Greene Street, New York, NY 10012`;
/** The Admin path end to end: enrichment (Event Link fetch blocked) → the Review the batch builds. */
async function adminReview(links) {
  const r = await ENGINE.analyzeAdminSourceEvent({ text: TRACE_LIVE(links), rateKey: "t" }, blockedDeps());
  assert.equal(r.ok && r.kind, "single");
  assert.equal(r.candidate.structured.source.status, "failed", "the Event Link fetch failed");
  return { review: O.operatorReviewDefaults(r.candidate, r.matches), candidate: r.candidate };
}
const SHOPIFY = "https://events.shopifyny.com/TRACE/mozart";

test("TRACE live: identical Event Link + RSVP URL, blocked fetch → the RSVP URL is in Review (cta RSVP), Ticket blank", async () => {
  const { review, candidate } = await adminReview(`Event Link: ${SHOPIFY}\nRSVP URL: ${SHOPIFY}`);
  assert.deepEqual(review.attendance, { cta: "rsvp", url: SHOPIFY });
  assert.equal(review.ticketsUrl, null);
  assert.equal(review.sourceUrl, SHOPIFY, "the same URL is also the Event Link — different fields, never de-duplicated");
  assert.deepEqual(L.attendanceSlots(review), { rsvp: { cta: "rsvp", url: SHOPIFY }, tickets: null });
  // Persisted to its own column.
  const n = P.normalizeReview(review);
  assert.equal(n.ok, true);
  assert.deepEqual(A.attendanceEventColumns(n.value.attendance, n.value.ticketsUrl), { rsvp_enabled: true, rsvp_url: SHOPIFY });
  assert.equal(n.value.sourceUrl, SHOPIFY);
  assert.equal(candidate.sourceUrl, SHOPIFY);
});

test("TRACE live: different Event Link + RSVP; identical Event Link + Ticket; RSVP + Ticket together", async () => {
  const diff = (await adminReview(`Event Link: https://trace.example/launch\nRSVP URL: ${SHOPIFY}`)).review;
  assert.deepEqual([diff.sourceUrl, diff.attendance, diff.ticketsUrl], ["https://trace.example/launch", { cta: "rsvp", url: SHOPIFY }, null]);
  const tix = (await adminReview(`Event Link: ${SHOPIFY}\nTicket URL: ${SHOPIFY}`)).review;
  assert.deepEqual(L.attendanceSlots(tix), { rsvp: null, tickets: SHOPIFY });
  assert.equal(tix.sourceUrl, SHOPIFY);
  const both = (await adminReview(`Event Link: ${SHOPIFY}\nRSVP URL: ${SHOPIFY}\nTicket URL: https://tix.example/trace`)).review;
  assert.deepEqual(L.attendanceSlots(both), { rsvp: { cta: "rsvp", url: SHOPIFY }, tickets: "https://tix.example/trace" });
});

test("TRACE live: an enrichment reading with no links never clears either slot", async () => {
  const { review } = await adminReview(`Event Link: ${SHOPIFY}\nRSVP URL: ${SHOPIFY}\nTicket URL: https://tix.example/trace`);
  const merged = O.fillReviewGaps(review, { ...review, attendance: null, ticketsUrl: null }, { hadImage: false });
  assert.deepEqual([merged.attendance, merged.ticketsUrl], [{ cta: "rsvp", url: SHOPIFY }, "https://tix.example/trace"]);
});

test("TRACE live (root cause): the RSVP link field is never squeezed out by its label select on a phone", () => {
  const parts = read("src/app/(public)/account/business/[id]/import-event/ReviewParts.tsx");
  const editor = parts.slice(parts.indexOf("export function AttendanceEditor"));
  const select = editor.slice(editor.indexOf("<select"), editor.indexOf("</select>"));
  // The shared inputClass is w-full; on the select it beat w-auto and left the
  // URL input ~26px wide at 390px, so a present RSVP URL looked missing.
  assert.match(select, /className=\{`\$\{inputClass\.replace\("w-full ", ""\)\} w-auto shrink-0`\}/);
  assert.match(read("src/app/(public)/account/business/[id]/import-event/ReviewParts.tsx"), /export const inputClass =\s*"w-full /);
  const input = editor.slice(editor.indexOf(`id={\`\${idPrefix}attendance-rsvp\`}`), editor.indexOf("/>", editor.indexOf(`id={\`\${idPrefix}attendance-rsvp\`}`)));
  assert.match(input, /min-w-0 flex-1/);
});
