// Real-world Event Import entity + occurrence resolution — modeled on the
// live acceptance import of a Luma Event (a referral ?tk= link, a private
// registration-only address in New York, NY, two HUMAN hosts named in
// "Hosted by A & B", collaborating organizations, and one continuous span
// "Oct 19, 10:00 AM – Oct 20, 4:00 PM"). Failures it exposed:
//   1. two people were proposed as ONE Business ("A & B");
//   2. an AI "organizer" became a Business candidate merely by hosting;
//   3. "EHVM × Tangent" collaboration notation was not a recognized cue;
//   4. Review said "Ready" while a candidate still needed Match / Create /
//      Ignore;
//   5. the end of a span into a later day was dropped in Review ("Ends:
//      unknown") although the source published it.
// Every test drives the REAL engine (analyzeEventUrl) / review / persist
// functions with fake fetch + AI + database — no network, no Production.
import { test } from "node:test";
import assert from "node:assert/strict";
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
const AI = await import("../src/lib/event-import/ai.ts");
const R = await import("../src/lib/event-import/review.ts");
const P = await import("../src/lib/event-import/persist.ts");
const O = await import("../src/lib/event-import/operator.ts");
const X = await import("../src/lib/event-import/existing-event.ts");

const NOW = Date.parse("2026-10-18T12:00:00Z");
const TITLE = "Example Capital Cowork";
const IMAGE = "https://images.lumacdn.com/event-covers/example-capital.jpg";
const START = "2026-10-19T10:00:00-04:00";
const END = "2026-10-20T16:00:00-04:00";
const HOSTS = "Hosted by Jane Smith & John Doe";
const DESCRIPTION = "Two days of focused coworking for app builders, brought to you by Northwind × Contoso.";

/** A Luma-shaped page: JSON-LD Event (people typed as Person, a city-only
 * place), Luma's own record saying the address is obfuscated, visible
 * "Hosted by" line. */
function lumaPage({ start = START, end = END, description = DESCRIPTION, hosts = HOSTS, organizer = [{ "@type": "Person", name: "Jane Smith" }, { "@type": "Person", name: "John Doe" }] } = {}) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: TITLE,
    startDate: start,
    ...(end ? { endDate: end } : {}),
    description,
    image: IMAGE,
    organizer,
    location: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "New York", addressRegion: "NY" } },
  };
  const next = { props: { pageProps: { initialData: { data: { event: { name: TITLE, start_at: start, end_at: end, url: "exmplcap", geo_address_info: { mode: "obfuscated", city: "New York", region: "New York" } } } } } } };
  return `<html><head><title>${TITLE}</title><script type="application/ld+json">${JSON.stringify(ld)}</script><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script></head><body><h1>${TITLE}</h1><p>${hosts.replace(/&/g, "&amp;")}</p><p>${description.replace(/&/g, "&amp;")}</p></body></html>`;
}

/** AI stub returning `out` merged over a "nothing found" answer; records calls. */
function aiStub(out = {}) {
  const calls = [];
  return {
    calls,
    client: {
      messages: {
        parse: async (body) => {
          calls.push(body);
          return {
            stop_reason: "end_turn",
            parsed_output: {
              title: "Something Else Entirely",
              schedule: [],
              venue_name: "Invented Hall",
              street_address: "99 Invented St",
              city: "Boston",
              state: "MA",
              postal_code: null,
              organizer: null,
              organizer_evidence: null,
              organizer_entity_type: "unknown",
              other_businesses: [],
              ...out,
            },
          };
        },
      },
    },
  };
}

const deps = (html, ai, extra = {}) => ({
  fetchPage: async (url) => ({ ok: true, url, html, bytes: html.length, redirects: 0, truncated: false, declaredBytes: null }),
  ai,
  matchEvent: async () => null,
  getEvent: async () => null,
  matchLocations: async () => [],
  matchPossibleLocations: async () => [],
  matchOrganizer: async () => null,
  matchExistingAppearance: async () => null,
  findScheduledBySourceUrl: async () => null,
  findEventBySourceUrl: async () => null,
  isRateLimited: () => false,
  now: () => NOW,
  involvedBusinesses: true,
  ...extra,
});

async function analyze(html, ai, extra) {
  const a = await E.analyzeEventUrl({ url: "https://luma.com/exmplcap?tk=IpHZfK", businessId: null, rateKey: `r-${Math.random()}` }, deps(html, ai, extra));
  assert.equal(a.ok, true, JSON.stringify(a));
  return { analysis: a, candidate: a.candidate ?? a.events?.[0]?.candidate };
}

// The realistic failing AI answer: hosts as organizer (people), AND the same
// two people mis-typed as one organization, plus the real collaborators.
const REALISTIC = {
  organizer: "Jane Smith & John Doe",
  organizer_evidence: HOSTS,
  organizer_entity_type: "person",
  other_businesses: [
    { name: "Jane Smith & John Doe", evidence: HOSTS, entity_type: "organization" },
    { name: "Northwind", evidence: "brought to you by Northwind × Contoso", entity_type: "organization" },
    { name: "Contoso", evidence: "brought to you by Northwind × Contoso", entity_type: "organization" },
  ],
};

// ── 1, 5, 8. Complete link: bounded pass; separate organizations; fields kept ──

test("1. complete Event-link metadata still runs ONE bounded involved-Business extraction", async () => {
  const ai = aiStub(REALISTIC);
  const { candidate } = await analyze(lumaPage(), ai.client);
  assert.equal(ai.calls.length, 1);
  assert.equal(candidate.title, TITLE);
  assert.match(ai.calls[0].messages[0].content, /Northwind × Contoso/);
});

test("2/5. two human hosts never become one Business; the real collaborators become SEPARATE candidates", async () => {
  const { candidate } = await analyze(lumaPage(), aiStub(REALISTIC).client);
  assert.deepEqual(candidate.otherBusinesses, ["Northwind", "Contoso"]);
  assert.ok(!candidate.otherBusinesses.some((n) => /Jane|John/.test(n)));
});

test("2b. 'A & B' human hosts are rejected even WITHOUT structured Person data (the joined-name rule)", async () => {
  const html = lumaPage({ organizer: undefined });
  const { candidate } = await analyze(html, aiStub(REALISTIC).client);
  assert.deepEqual(candidate.otherBusinesses, ["Northwind", "Contoso"]);
});

test("2c. a single human host the AI types as a person is rejected", async () => {
  const html = lumaPage({ hosts: "Hosted by Jane Smith", description: "Two days of coworking.", organizer: undefined });
  const ai = aiStub({ organizer: "Jane Smith", organizer_evidence: "Hosted by Jane Smith", organizer_entity_type: "person", other_businesses: [{ name: "Jane Smith", evidence: "Hosted by Jane Smith", entity_type: "person" }] });
  const { candidate } = await analyze(html, ai.client);
  assert.equal(candidate.otherBusinesses ?? null, null);
});

test("2d. a structured schema.org Person never becomes a candidate even if the AI mis-types it", async () => {
  const html = lumaPage({ hosts: "Hosted by Jane Smith", description: "Two days of coworking.", organizer: [{ "@type": "Person", name: "Jane Smith" }] });
  const ai = aiStub({ other_businesses: [{ name: "Jane Smith", evidence: "Hosted by Jane Smith", entity_type: "organization" }] });
  const { candidate } = await analyze(html, ai.client);
  assert.equal(candidate.otherBusinesses ?? null, null);
});

test("3. a human organizer returned by the AI does NOT become a Business candidate", async () => {
  const ai = aiStub({ organizer: "Jane Smith & John Doe", organizer_evidence: HOSTS, organizer_entity_type: "person" });
  const { candidate } = await analyze(lumaPage({ description: "Two days of coworking." }), ai.client);
  assert.equal(candidate.otherBusinesses ?? null, null);
});

test("4. a genuinely organizational organizer with grounded evidence stays eligible", async () => {
  const html = lumaPage({ hosts: "Hosted by Northwind Labs", description: "Two days of coworking.", organizer: [{ "@type": "Organization", name: "Someone Else" }] });
  const ai = aiStub({ organizer: "Northwind Labs", organizer_evidence: "Hosted by Northwind Labs", organizer_entity_type: "organization" });
  const { candidate } = await analyze(html, ai.client);
  assert.deepEqual(candidate.otherBusinesses, ["Northwind Labs"]);
});

test("6. weak proper nouns (no involvement wording) produce nothing and make no AI call", async () => {
  const html = lumaPage({ hosts: "Bring a laptop.", description: "Coffee from Northwind all day in Midtown.", organizer: undefined });
  const ai = aiStub({ other_businesses: [{ name: "Northwind", evidence: "Coffee from Northwind all day", entity_type: "organization" }] });
  const { candidate } = await analyze(html, ai.client);
  assert.equal(ai.calls.length, 0);
  assert.equal(candidate.otherBusinesses ?? null, null);
});

test("6b. a bare proper noun quoted without a cue is rejected even when the page has a cue elsewhere", async () => {
  const ai = aiStub({ other_businesses: [{ name: "Midtown", evidence: "Two days of focused coworking for app builders", entity_type: "organization" }] });
  const { candidate } = await analyze(lumaPage(), ai.client);
  assert.equal(candidate.otherBusinesses ?? null, null);
});

test("7. evidence absent from the source is rejected", async () => {
  const ai = aiStub({ other_businesses: [{ name: "Fabrikam", evidence: "sponsored by Fabrikam", entity_type: "organization" }] });
  const { candidate } = await analyze(lumaPage(), ai.client);
  assert.equal(candidate.otherBusinesses ?? null, null);
});

test("8. existing structured fields are unchanged by the participant pass", async () => {
  const { candidate: before } = await analyze(lumaPage(), null);
  const { candidate: after } = await analyze(lumaPage(), aiStub(REALISTIC).client);
  const { otherBusinesses: _a, ...b } = before;
  const { otherBusinesses: _b, ...c } = after;
  assert.deepEqual(c, b);
});

test("collab notation: '×' / ' x ' between names is an involvement cue; '5 x 7' is not", () => {
  assert.equal(AI.hasInvolvementEvidence("EHVM × Tangent"), true);
  assert.equal(AI.hasInvolvementEvidence("Knix x Nordstrom pop-up"), true);
  assert.equal(AI.hasInvolvementEvidence("prints 5 x 7 inches"), false);
  assert.equal(AI.hasInvolvementEvidence("an x-ray of the market"), false);
});

test("joined-name rule keeps real single names joined by '&'", () => {
  for (const n of ["Ben & Jerry's", "Bed Bath & Beyond", "Procter & Gamble", "Johnson & Johnson", "Crate & Barrel"]) assert.equal(AI.namesSeveralParties(n), false, n);
  for (const n of ["Jane Smith & John Doe", "Evelyn Ray and Sam Lee", "Ana Diaz, Bo Kim"]) assert.equal(AI.namesSeveralParties(n), true, n);
});

// ── 9–10. Status: unresolved candidates are review work ─────────────────

test("9–10. unresolved involved-Business candidates → Needs Review; once each is matched or ignored → Ready", async () => {
  const { analysis, candidate } = await analyze(lumaPage(), aiStub(REALISTIC).client);
  const matches = analysis.matches ?? analysis.events?.[0]?.matches;
  const review = O.operatorReviewDefaults(candidate, matches);
  const names = R.involvedBusinessNames(candidate);
  assert.deepEqual(names, ["Northwind", "Contoso"]);
  assert.equal(R.batchItemStatus(review, matches, names).kind, "needs_review");
  const partly = { ...review, otherBusinessChoices: { Northwind: "ignored" } };
  assert.equal(R.batchItemStatus(partly, matches, names).kind, "needs_review", "one still open");
  const resolved = { ...review, otherBusinessChoices: { Northwind: "ignored", Contoso: { id: "c0000000-0000-4000-8000-000000000001", name: "Contoso" } } };
  assert.equal(R.batchItemStatus(resolved, matches, names).kind, "ready");
  // Non-operator callers (no candidates passed) are unchanged.
  assert.equal(R.batchItemStatus(review, matches).kind, "ready");
});

// ── 11–14. Earlier repairs still hold on this page shape ────────────────

test("11–14. referral URL, private/TBA location, no venue-as-address, image — all preserved", async () => {
  const { candidate } = await analyze(lumaPage(), aiStub(REALISTIC).client);
  assert.equal(candidate.sourceUrl, "https://luma.com/exmplcap", "tk stripped");
  assert.equal(candidate.locationVisibility, "hidden");
  const v = candidate.occurrences[0].venue;
  assert.equal(v.name, null, "no fabricated place");
  assert.equal(v.address, null, "no fabricated street address");
  assert.equal(v.city, "New York");
  assert.equal(v.state, "NY");
  assert.equal(candidate.imageUrl, IMAGE);
  assert.equal(candidate.description, DESCRIPTION);
});

// ── Timing: one continuous span into a later day ─────────────────────────

const endIso = new Date(END).toISOString();
const startIso = new Date(START).toISOString();

test("timing: Oct 19 10:00 AM → Oct 20 4:00 PM stays ONE occurrence with its real end, through Review and persistence", async () => {
  const { analysis, candidate } = await analyze(lumaPage(), null);
  assert.equal(candidate.occurrences.length, 1, "one source interval → one occurrence (never split into invented per-day times)");
  assert.equal(candidate.occurrences[0].start, startIso);
  assert.equal(candidate.occurrences[0].end, endIso);
  const matches = analysis.matches ?? analysis.events?.[0]?.matches;
  const review = O.operatorReviewDefaults(candidate, matches);
  assert.equal(review.occurrences.length, 1);
  assert.deepEqual(
    { date: review.occurrences[0].date, startTime: review.occurrences[0].startTime, endTime: review.occurrences[0].endTime, endDate: review.occurrences[0].endDate },
    { date: "2026-10-19", startTime: "10:00", endTime: "16:00", endDate: "2026-10-20" },
    "the end is no longer dropped ('Ends: unknown')"
  );
  assert.equal(R.occurrenceSummary(review.occurrences[0]).time, "10:00 AM – Tue, Oct 20, 4:00 PM");
  const n = P.normalizeReview({ ...review, intent: "participating", asEvent: true });
  assert.equal(n.ok, true, JSON.stringify(n));
  assert.equal(n.value.occurrences.length, 1);
  assert.equal(n.value.occurrences[0].start, startIso);
  assert.equal(n.value.occurrences[0].end, endIso);
  assert.deepEqual(P.parentEventRange(n.value.occurrences), { start_date: "2026-10-19", end_date: "2026-10-20", start_at: startIso, end_at: endIso });
});

test("timing: persistence writes the full span to the occurrence (no new schema)", async () => {
  const { analysis, candidate } = await analyze(lumaPage(), null);
  const review = O.operatorReviewDefaults(candidate, analysis.matches ?? analysis.events?.[0]?.matches);
  const n = P.normalizeReview({ ...review, intent: "participating", asEvent: true });
  const admin = fakePersistAdmin();
  const r = await P.persistDiscoveryEvent(n.value, null, persistDeps(admin), []);
  assert.equal(r.ok, true, JSON.stringify(r));
  const written = admin.ops.filter((o) => o.kind === "insert").flatMap((o) => o.rows);
  assert.ok(written.some((row) => Object.values(row).includes(endIso)), "the real end instant is stored");
  assert.equal(admin.ops.some((o) => o.table === "appearances"), false);
});

test("timing: two genuine source occurrences stay two; never collapsed", async () => {
  const ld = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: TITLE,
    startDate: "2026-10-19T10:00:00-04:00",
    endDate: "2026-10-20T16:00:00-04:00",
    location: { "@type": "Place", name: "Example Hall", address: { "@type": "PostalAddress", streetAddress: "1 Example Ave", addressLocality: "New York", addressRegion: "NY" } },
    subEvent: [
      { "@type": "Event", name: "Day 1", startDate: "2026-10-19T10:00:00-04:00", endDate: "2026-10-19T18:00:00-04:00" },
      { "@type": "Event", name: "Day 2", startDate: "2026-10-20T09:00:00-04:00", endDate: "2026-10-20T16:00:00-04:00" },
    ],
  };
  const html = `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><h1>${TITLE}</h1></body></html>`;
  const { analysis, candidate } = await analyze(html, null);
  assert.equal(candidate.occurrences.length, 2);
  const review = O.operatorReviewDefaults(candidate, analysis.matches ?? analysis.events?.[0]?.matches);
  assert.deepEqual(review.occurrences.map((o) => [o.date, o.startTime, o.endTime, o.endDate ?? null]), [
    ["2026-10-19", "10:00", "18:00", null],
    ["2026-10-20", "09:00", "16:00", null],
  ]);
});

test("timing: date-only, start-only, same-day and true overnight are unchanged", () => {
  assert.deepEqual(R.reviewDateFor({ start: "2026-10-19", end: null, hasTime: false }), { date: "2026-10-19", startTime: "", endTime: "" });
  assert.deepEqual(R.reviewDateFor({ start: "2026-10-19T14:00:00.000Z", end: null, hasTime: true }), { date: "2026-10-19", startTime: "10:00", endTime: "" });
  assert.deepEqual(R.reviewDateFor({ start: "2026-10-19T14:00:00.000Z", end: "2026-10-19T20:00:00.000Z", hasTime: true }), { date: "2026-10-19", startTime: "10:00", endTime: "16:00" });
  // 10 PM → 2 AM: still the after-midnight shorthand, no end date.
  assert.deepEqual(R.reviewDateFor({ start: "2026-10-20T02:00:00.000Z", end: "2026-10-20T06:00:00.000Z", hasTime: true }), { date: "2026-10-19", startTime: "22:00", endTime: "02:00" });
  const base = { intent: "participating", title: "T", sharedPlace: false, occurrences: [], asEvent: true };
  const one = (o) => P.normalizeReview({ ...base, occurrences: [{ place: {}, ...o }] });
  const overnight = one({ date: "2026-10-19", startTime: "22:00", endTime: "02:00" });
  assert.equal(overnight.value.occurrences[0].end, "2026-10-20T06:00:00.000Z");
  assert.equal(one({ date: "2026-10-19", startTime: "", endTime: "" }).value.occurrences[0].start, null);
  assert.equal(one({ date: "2026-10-19", startTime: "10:00", endTime: "" }).value.occurrences[0].end, null);
  // A cross-day end needs its time, and can't precede the start.
  assert.equal(one({ date: "2026-10-19", startTime: "10:00", endTime: "", endDate: "2026-10-20" }).ok, false);
  assert.equal(one({ date: "2026-10-19", startTime: "10:00", endTime: "16:00", endDate: "2026-10-18" }).ok, false);
});

// ── 15–18. Participation architecture unchanged ─────────────────────────

function fakePersistAdmin() {
  const ops = [];
  return {
    ops,
    from(table) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        is: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: { id: `${table}-1` }, error: null }),
        then: (cb) => cb({ data: [], error: null }),
        insert: (input) => {
          const rows = Array.isArray(input) ? input : [input];
          ops.push({ table, kind: "insert", rows });
          return { select: () => ({ single: async () => ({ data: { id: `${table}-1`, ...rows[0] }, error: null }), then: (cb) => cb({ data: rows.map((_, i) => ({ id: `${table}-1-${i}` })), error: null }) }) };
        },
        upsert: (row) => (ops.push({ table, kind: "upsert", rows: Array.isArray(row) ? row : [row] }), Promise.resolve({ error: null })),
        update: () => ({ eq: () => ({ then: (cb) => cb({ error: null }) }) }),
      };
      return chain;
    },
  };
}
const persistDeps = (admin) => ({ admin, storeImage: async () => null, geography: async () => null, uniqueEventSlug: async () => "x", propagateDates: async () => {}, findEventBySourceUrl: async () => null });
const NORTHWIND = "a0000000-0000-4000-8000-000000000001";
const CONTOSO = "b0000000-0000-4000-8000-000000000002";

test("15–17. existing Event: only explicitly resolved participants persist, through event_businesses; no Appearance writes", async () => {
  const writes = [];
  const propagated = [];
  const client = {
    from(table) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        in: () => chain,
        maybeSingle: async () => ({ data: table === "events" ? { id: "e0000000-0000-4000-8000-000000000009", name: TITLE, slug: "x", cover_image_url: IMAGE, description: "d", external_url: null, rsvp_url: null, tickets_url: null, organizer_name: null } : null }),
        then: (res) => res({ data: table === "event_occurrences" ? [{ id: "o1", location_id: null }] : [], error: null }),
        upsert: async (r) => (writes.push({ table, row: r }), { error: null }),
        insert: async (r) => (writes.push({ table, row: r }), { error: null }),
        update: (patch) => (writes.push({ table, patch }), { eq: async () => ({ error: null }) }),
      };
      return chain;
    },
  };
  const proposal = { imageUrl: null, description: null, link: null, attendance: null, ticketsUrl: null, organizer: null, categoryId: null, formatIds: [], business: null };
  const EV = "e0000000-0000-4000-8000-000000000009";
  const r = await X.applyExistingEventEnrichment(client, EV, {}, proposal, { storeImage: async () => null, propagateDates: async (...a) => propagated.push(a) }, [CONTOSO]);
  assert.deepEqual(r, { ok: true, applied: [], participants: [CONTOSO] });
  assert.deepEqual(writes, [{ table: "event_businesses", row: { event_id: EV, business_id: CONTOSO, status: "approved", participation_scope: "all_dates" } }]);
  assert.equal(propagated.length, 1);
  assert.equal(writes.some((w) => w.table === "appearances"), false);
});

test("18. new-Event participant persistence remains intact", async () => {
  const { analysis, candidate } = await analyze(lumaPage(), aiStub(REALISTIC).client);
  const review = O.operatorReviewDefaults(candidate, analysis.matches ?? analysis.events?.[0]?.matches);
  const n = P.normalizeReview({ ...review, intent: "participating", asEvent: true });
  const admin = fakePersistAdmin();
  await P.persistDiscoveryEvent(n.value, null, persistDeps(admin), [NORTHWIND, CONTOSO]);
  const roster = admin.ops.filter((o) => o.table === "event_businesses").map((o) => o.rows[0]);
  assert.deepEqual(roster.map((x) => x.business_id).sort(), [NORTHWIND, CONTOSO].sort());
  for (const row of roster) assert.deepEqual([row.status, row.participation_scope], ["approved", "all_dates"]);
  assert.equal(admin.ops.some((o) => o.table === "appearances"), false);
});
