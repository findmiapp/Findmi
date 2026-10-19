// Event Import participant extraction orchestration — a COMPLETE Event
// link (title, dates, venue, city all in the page's own structured data)
// never reached the AI step (engine.ts gated it behind needsAiAssist), so
// explicit "Hosted by the X & Y teams" evidence never became involved-
// Business candidates; and Apply To Existing Event ignored the operator's
// resolved involved Businesses. These tests drive the REAL engine
// orchestration (analyzeEventUrl) with a stubbed AI client and fake
// fetch/match deps — no network, no database, no production writes.
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
const X = await import("../src/lib/event-import/existing-event.ts");
const P = await import("../src/lib/event-import/persist.ts");
const A = await import("../src/app/admin/(protected)/events/import/actions.ts");

const NOW = Date.parse("2026-10-19T12:00:00Z");
const TITLE = "Example Apps Week Cafe";
const VENUE = "Example Coffee Chelsea";

function lumaPage(description, bodyText = description) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: TITLE,
    startDate: "2026-10-22T09:00:00-04:00",
    endDate: "2026-10-22T12:00:00-04:00",
    description,
    image: "https://images.lumacdn.com/event-covers/example.jpg",
    location: { "@type": "Place", name: VENUE, address: { "@type": "PostalAddress", streetAddress: "123 Example Ave", addressLocality: "New York", addressRegion: "NY" } },
  };
  return `<html><head><title>${TITLE}</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><h1>${TITLE}</h1><p>${bodyText.replace(/&/g, "&amp;")}</p></body></html>`;
}

/** AI stub: records every request; answers with `output`. The output also
 * proposes a DIFFERENT title / venue / organizer, to prove the involved-
 * Business pass never lets those through. */
function aiStub(otherBusinesses, organizer = { name: "Alpha", evidence: "Hosted by the Alpha & Beta teams", type: "organization" }) {
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
              title: "A Different Title",
              schedule: [{ date: "2026-12-01", start_time: "18:00", end_time: null, venue_name: "Elsewhere", street_address: null, city: null, evidence: "Hosted by" }],
              venue_name: "Elsewhere",
              street_address: "1 Other St",
              city: "Boston",
              state: "MA",
              postal_code: null,
              organizer: organizer?.name ?? null,
              organizer_evidence: organizer?.evidence ?? null,
              organizer_entity_type: organizer?.type ?? "unknown",
              other_businesses: otherBusinesses.map((b) => ({ entity_type: "organization", ...b })),
            },
          };
        },
      },
    },
  };
}

function deps(html, ai, extra = {}) {
  return {
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
  };
}

const ALPHA_BETA = [
  { name: "Alpha", evidence: "Hosted by the Alpha & Beta teams" },
  { name: "Beta", evidence: "Hosted by the Alpha & Beta teams" },
];

async function analyze(html, ai, extra) {
  const a = await E.analyzeEventUrl({ url: "https://luma.com/exmpl123?tk=ABC123", businessId: null, rateKey: `t-${Math.random()}` }, deps(html, ai, extra));
  assert.equal(a.ok, true, JSON.stringify(a));
  return a.candidate ?? a.events?.[0]?.candidate;
}

const FIXTURE = lumaPage("Coffee and demos all morning. Hosted by the Alpha & Beta teams.");

// ── 1–3. Complete link input: extraction runs, fields stay authoritative ──

test("1. a COMPLETE Event link (title, dates, venue, city present) still invokes the involved-Business pass", async () => {
  const baseline = await analyze(FIXTURE, null);
  // The page's own data is complete — the fill-in AI step would never run.
  assert.equal(baseline.title, TITLE);
  assert.ok(baseline.occurrences.length > 0);
  assert.equal(baseline.occurrences[0].venue.name, VENUE);
  const ai = aiStub(ALPHA_BETA);
  await analyze(FIXTURE, ai.client);
  assert.equal(ai.calls.length, 1, "exactly one bounded extraction call");
  assert.match(ai.calls[0].messages[0].content, /Hosted by the Alpha & Beta teams/);
});

test("2. existing structured fields are never overwritten by the involved-Business pass", async () => {
  const baseline = await analyze(FIXTURE, null);
  const ai = aiStub(ALPHA_BETA);
  const enriched = await analyze(FIXTURE, ai.client);
  const { otherBusinesses: _a, ...before } = baseline;
  const { otherBusinesses: _b, ...after } = enriched;
  assert.deepEqual(after, before, "title, dates, venue, address, image, links, organizer, sources — all identical");
  assert.equal(enriched.title, TITLE);
  assert.equal(enriched.occurrences[0].venue.name, VENUE);
  assert.notEqual(enriched.organizer, "Alpha");
});

test("3. explicit 'Hosted by the Alpha & Beta teams' evidence reaches otherBusinesses — and nothing is created", async () => {
  const ai = aiStub(ALPHA_BETA);
  const writes = [];
  const c = await analyze(FIXTURE, ai.client, {
    // Any attempt to create would surface through these; none exist on the
    // analysis path at all — the candidate is review-only.
    createBusiness: async () => writes.push("business"),
  });
  assert.deepEqual(c.otherBusinesses, ["Alpha", "Beta"]);
  assert.deepEqual(writes, []);
});

test("3b. an ORGANIZATION host the AI reports only as 'organizer' becomes an involved-Business candidate — the record's organizer is never replaced", async () => {
  const ai = aiStub([], { name: "Alpha", evidence: "Hosted by the Alpha & Beta teams", type: "organization" });
  const c = await analyze(FIXTURE, ai.client);
  assert.deepEqual(c.otherBusinesses, ["Alpha"]);
  assert.notEqual(c.organizer, "Alpha");
});

// ── 4. Weak prose: no candidates ─────────────────────────────────────────

test("4a. a complete page with no involvement wording makes no extra AI call", async () => {
  const ai = aiStub([{ name: "Gamma", evidence: "Gamma pastries" }]);
  const c = await analyze(lumaPage("Coffee and Gamma pastries all morning in Chelsea."), ai.client);
  assert.equal(ai.calls.length, 0);
  assert.equal(c.otherBusinesses ?? null, null);
});

test("4b. a bare proper noun quoted without an involvement cue is rejected, even when the page has a cue elsewhere", async () => {
  const html = lumaPage("Gamma pastries all morning. Hosted by the Alpha & Beta teams.");
  const ai = aiStub([{ name: "Gamma", evidence: "Gamma pastries all morning" }, ...ALPHA_BETA]);
  const c = await analyze(html, ai.client);
  assert.deepEqual(c.otherBusinesses, ["Alpha", "Beta"]);
});

test("4c. evidence not present verbatim on the page is rejected", async () => {
  const ai = aiStub([{ name: "Delta", evidence: "Sponsored by Delta" }], null);
  const c = await analyze(FIXTURE, ai.client);
  assert.equal(c.otherBusinesses ?? null, null);
});

test("4d. callers that do not opt in (non-Admin imports) make no extra AI call", async () => {
  const ai = aiStub(ALPHA_BETA);
  await analyze(FIXTURE, ai.client, { involvedBusinesses: undefined });
  assert.equal(ai.calls.length, 0);
});

// ── 5–7. Apply To Existing Event: explicitly resolved participants ───────

const EV = "eeeeeeee-0000-4000-8000-000000000009";
const ALPHA = "aaaaaaaa-0000-4000-8000-000000000001";
const BETA = "bbbbbbbb-0000-4000-8000-000000000002";
const EXISTING = "cccccccc-0000-4000-8000-000000000003";

function existingClient({ roster = [], businesses = [ALPHA, BETA, EXISTING] } = {}) {
  const writes = [];
  const propagated = [];
  const row = { id: EV, name: TITLE, slug: "x", cover_image_url: "https://findmi.storage/e.jpg", description: "Set.", external_url: "https://luma.com/exmpl123", rsvp_url: null, tickets_url: null, organizer_name: null };
  const client = {
    writes,
    propagated,
    from(table) {
      let ids = null;
      const result = () => {
        if (table === "event_businesses") return roster.map((id) => ({ business_id: id, status: "approved" }));
        if (table === "businesses") return (ids ?? businesses).filter((id) => businesses.includes(id)).map((id) => ({ id, name: id }));
        if (table === "event_occurrences") return [{ id: "o1", location_id: null }];
        return [];
      };
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        in: (_col, v) => ((ids = v), chain),
        maybeSingle: async () => ({ data: table === "events" ? row : null }),
        then: (res) => res({ data: result(), error: null }),
        update: (patch) => (writes.push({ table, kind: "update", patch }), { eq: async () => ({ error: null }) }),
        insert: async (r) => (writes.push({ table, kind: "insert", row: r }), { error: null }),
        upsert: async (r) => (writes.push({ table, kind: "upsert", row: r }), { error: null }),
        delete: () => chain,
      };
      return chain;
    },
  };
  return client;
}
const exDeps = (client) => ({ storeImage: async () => null, propagateDates: async (id, occ) => client.propagated.push([id, occ]) });
const PROPOSAL = { imageUrl: null, description: null, link: null, attendance: null, ticketsUrl: null, organizer: null, categoryId: null, formatIds: [], business: null };

test("5. existing Event + resolved Business: Apply persists the participant through event_businesses + the existing date sync", async () => {
  const client = existingClient();
  const r = await X.applyExistingEventEnrichment(client, EV, {}, PROPOSAL, exDeps(client), [ALPHA, BETA]);
  assert.deepEqual(r, { ok: true, applied: [], participants: [ALPHA, BETA] });
  const roster = client.writes.filter((w) => w.table === "event_businesses").map((w) => w.row);
  assert.deepEqual(roster, [
    { event_id: EV, business_id: ALPHA, status: "approved", participation_scope: "all_dates" },
    { event_id: EV, business_id: BETA, status: "approved", participation_scope: "all_dates" },
  ]);
  assert.deepEqual(client.propagated, [[EV, ["o1"]]], "one existing date sync for the Event");
  // Structured fields untouched.
  assert.equal(client.writes.some((w) => w.table === "events"), false);
});

test("5b. a Business already approved on the Event is left exactly as it is", async () => {
  const client = existingClient({ roster: [ALPHA] });
  const r = await X.applyExistingEventEnrichment(client, EV, {}, PROPOSAL, exDeps(client), [ALPHA, BETA]);
  assert.deepEqual(r.participants, [BETA]);
  assert.deepEqual(client.writes.filter((w) => w.table === "event_businesses").map((w) => w.row.business_id), [BETA]);
});

test("6. ignored and unresolved candidates are never persisted (Admin action, end to end)", async () => {
  const client = existingClient();
  globalThis.__ADMIN = client;
  try {
    const review = {
      title: TITLE,
      otherBusinessChoices: { Alpha: { id: ALPHA, name: "Alpha" }, Beta: "ignored", Gamma: { id: "not-a-uuid", name: "Gamma" }, Delta: { id: "dddddddd-0000-4000-8000-000000000004", name: "Delta" } },
    };
    const r = await A.adminApplyExistingEvent(EV, review, null, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.participants, [ALPHA], "only the explicitly resolved, real Business");
    assert.deepEqual(client.writes.filter((w) => w.table === "event_businesses").map((w) => w.row.business_id), [ALPHA]);
    // No choices at all → nothing written.
    const empty = existingClient();
    globalThis.__ADMIN = empty;
    assert.deepEqual(await A.adminApplyExistingEvent(EV, { title: TITLE }, null, {}), { ok: true, applied: [] });
    assert.equal(empty.writes.length, 0);
  } finally {
    globalThis.__ADMIN = undefined;
  }
});

test("7. no direct Appearance creation on the existing-Event path", async () => {
  const client = existingClient();
  await X.applyExistingEventEnrichment(client, EV, {}, PROPOSAL, exDeps(client), [ALPHA, BETA]);
  assert.equal(client.writes.some((w) => w.table === "appearances" || w.table === "event_occurrence_businesses"), false);
});

// ── 8. New-Event participant persistence still works ────────────────────

function fakePersistAdmin() {
  const ops = [];
  return {
    ops,
    from(table) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
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

test("8. new-Event participant persistence still writes approved all_dates event_businesses rows, no appearances", async () => {
  const admin = fakePersistAdmin();
  const input = {
    intent: "participating",
    title: TITLE,
    description: null,
    imageUrl: null,
    sourceUrl: "https://luma.com/exmpl123",
    organizer: null,
    attendance: null,
    ticketsUrl: null,
    occurrences: [{ date: "2026-10-22", start: "2026-10-22T13:00:00.000Z", end: null, hasTime: true, place: { name: VENUE, address: null, city: "New York", state: "NY", postalCode: null, locationId: null } }],
    useEventId: null,
    categoryId: null,
    formatIds: [],
  };
  const r = await P.persistDiscoveryEvent(input, null, { admin, storeImage: async () => null, geography: async () => null, uniqueEventSlug: async () => "x", propagateDates: async () => {}, findEventBySourceUrl: async () => null }, [ALPHA, BETA]);
  assert.equal(r.ok, true);
  const roster = admin.ops.filter((o) => o.table === "event_businesses").map((o) => o.rows[0]);
  assert.deepEqual(roster.map((x) => x.business_id).sort(), [ALPHA, BETA].sort());
  for (const row of roster) assert.deepEqual([row.status, row.participation_scope], ["approved", "all_dates"]);
  assert.equal(admin.ops.some((o) => o.table === "appearances"), false);
});

// ── 9–10. Earlier repairs still hold ─────────────────────────────────────

test("9. referral URL normalization still strips Luma's tk parameter", async () => {
  const n = E.normalizeImportUrl("https://luma.com/exmpl123?tk=ABC123");
  assert.equal(n.ok, true);
  assert.equal(n.url.toString(), "https://luma.com/exmpl123");
  const c = await analyze(FIXTURE, aiStub(ALPHA_BETA).client);
  assert.equal(c.sourceUrl, "https://luma.com/exmpl123");
});

test("10. venue name and street address stay distinct after the involved-Business pass", async () => {
  const c = await analyze(FIXTURE, aiStub(ALPHA_BETA).client);
  const v = c.occurrences[0].venue;
  assert.equal(v.name, VENUE);
  assert.notEqual(v.address, VENUE, "the venue's name is never persisted as its street address");
  assert.equal(v.city, "New York");
});
