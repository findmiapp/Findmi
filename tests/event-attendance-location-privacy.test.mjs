// Event attendance + location privacy, and the stale Edit Appearance save.
//
// Attendance is evidence-only (schema.org, page controls, a verified Luma
// Event page) and maps onto the EXISTING RSVP/Tickets actions; location
// visibility (exact / broad / hidden / none) keeps a withheld address out of
// storage, matching and the public page. Fake clients / fixtures only — no
// network, no production data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
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
const A = await import("../src/lib/event-import/attendance.ts");
const P = await import("../src/lib/event-import/persist.ts");
const R = await import("../src/lib/event-import/review.ts");
const C = await import("../src/lib/appearance-conversion.ts");
const S = await import("../src/lib/admin/appearance-stale-link.ts");
const L = await import("../src/lib/event-attendance.ts");
const CTA = await import("../src/components/EventScheduleCtas.tsx").catch(() => null);
const F = await import("./fixtures/event-sources.mjs");
const read = (p) => readFileSync(p, "utf8");

const NOW = Date.parse("2026-10-13T20:00:00Z");
const CORGI_NYC = "660d3744-dc88-4e91-856c-c0a296c9e776";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const nextData = (obj) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(obj)}</script>`;
const page = (head, body = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const EVENT = { "@context": "https://schema.org", "@type": "Event", name: "Harvest Supper", startDate: "2026-10-30T23:00:00Z", endDate: "2026-10-31T02:00:00Z" };
const PLACE = { "@type": "Place", name: "The Old Mill", address: { "@type": "PostalAddress", streetAddress: "12 Mill Rd", addressLocality: "Hudson", addressRegion: "NY" } };

function deps(html, over = {}) {
  const calls = { locations: [] };
  return {
    calls,
    d: {
      fetchPage: async (url) => ({ ok: true, url, html, bytes: html.length, redirects: 0, truncated: false, declaredBytes: null }),
      ai: null, matchEvent: async () => null, getEvent: async (id) => ({ slug: `s-${id}`, host_business_id: null }),
      matchLocations: async (v) => (calls.locations.push(v), [{ id: CORGI_NYC, name: v.name, address: v.address, city: v.city, state: v.state }]),
      matchPossibleLocations: async () => [], matchOrganizer: async () => null, matchExistingAppearance: async () => null,
      findScheduledBySourceUrl: async () => null, findEventBySourceUrl: async () => null, isRateLimited: () => false, now: () => NOW, ...over,
    },
  };
}
const analyze = async (url, html, over) => {
  const { d, calls } = deps(html, over);
  const out = await E.analyzeEventUrl({ url, businessId: "biz", rateKey: "t" }, d);
  return { out, calls };
};

// ── attendance ─────────────────────────────────────────────────────────

test("schema.org free Event with an offer link → Register, free, the offer link", async () => {
  const html = page(ld({ ...EVENT, location: PLACE, isAccessibleForFree: true, offers: { "@type": "Offer", price: "0", priceCurrency: "USD", url: "https://tickets.example.org/harvest" } }));
  const { out } = await analyze("https://oldmill.example.org/harvest", html);
  assert.equal(out.ok && out.kind, "single");
  assert.deepEqual(out.candidate.attendance, { url: "https://tickets.example.org/harvest", cta: "register", pricing: "free", price: null, registration: "unknown", basis: "structured" });
});

test("schema.org paid/ticketed Event → Get Tickets with the source's price", async () => {
  const html = page(ld({ ...EVENT, location: PLACE, offers: [{ "@type": "Offer", price: 25, priceCurrency: "USD", url: "https://tickets.example.org/harvest" }, { "@type": "Offer", price: "40.00", priceCurrency: "USD" }] }));
  const { out } = await analyze("https://oldmill.example.org/harvest", html);
  assert.equal(out.candidate.attendance.cta, "tickets");
  assert.equal(out.candidate.attendance.pricing, "paid");
  assert.equal(out.candidate.attendance.price, "$25–$40");
  assert.equal(out.candidate.attendance.url, "https://tickets.example.org/harvest");
});

test("explicit registration link on the page → Register to that link (never the page itself)", async () => {
  const html = page(ld({ ...EVENT, location: PLACE }), `<a href="https://forms.example.org/harvest-signup">Register</a><a href="#details">Details</a>`);
  const { out } = await analyze("https://oldmill.example.org/harvest", html);
  assert.equal(out.candidate.attendance.cta, "register");
  assert.equal(out.candidate.attendance.url, "https://forms.example.org/harvest-signup");
  assert.equal(out.candidate.attendance.basis, "page");
  assert.equal(out.candidate.attendance.pricing, "unknown", "free/paid never invented");
});

test("explicit RSVP wording → RSVP; explicit ticket wording → Get Tickets", async () => {
  const rsvp = await analyze("https://oldmill.example.org/harvest", page(ld({ ...EVENT, location: PLACE }), `<a href="https://rsvp.example.org/h">RSVP</a><p>Free admission</p>`));
  assert.equal(rsvp.out.candidate.attendance.cta, "rsvp");
  assert.equal(rsvp.out.candidate.attendance.pricing, "free");
  const tix = await analyze("https://oldmill.example.org/harvest", page(ld({ ...EVENT, location: PLACE }), `<a href="https://tix.example.org/h">Get Tickets</a>`));
  assert.equal(tix.out.candidate.attendance.cta, "tickets");
  // Mixed wording is ambiguous → falls back to pricing (unknown → Register).
  const mixed = await analyze("https://oldmill.example.org/harvest", page(ld({ ...EVENT, location: PLACE }), `<a href="https://x.example.org/a">RSVP</a><a href="https://x.example.org/b">Get Tickets</a>`));
  assert.equal(mixed.out.candidate.attendance.cta, "register");
});

test("explicit walk-in / no registration → no registration CTA", async () => {
  const html = page(ld({ ...EVENT, location: PLACE, offers: { "@type": "Offer", price: 0, url: "https://x.example.org/a" } }), `<p>No registration required — walk-ins welcome.</p>`);
  const { out } = await analyze("https://oldmill.example.org/harvest", html);
  assert.equal(out.candidate.attendance.cta, null);
  assert.equal(out.candidate.attendance.url, null);
  assert.equal(out.candidate.attendance.registration, "not_required");
});

test("a verified individual Luma Event page uses its own link to register", async () => {
  const { out } = await analyze("https://luma.com/spooktober-movie-night", F.lumaEventPage(F.CORGI_EVENTS[3]));
  assert.equal(out.ok && out.kind, "single");
  assert.equal(out.candidate.attendance.url, "https://luma.com/spooktober-movie-night");
  assert.equal(out.candidate.attendance.cta, "register", "free/paid unknown → Register (never RSVP / Get Tickets by assumption)");
  assert.equal(out.candidate.attendance.basis, "platform");
  assert.equal(out.candidate.attendance.pricing, "unknown");
});

test("Luma ticket facts from its own page record: is_free → Register; paid → Get Tickets with price", async () => {
  const e = F.CORGI_EVENTS[3];
  const withTicket = (ticket_info) =>
    page(`<title>${esc(e.name)} · Luma</title>${ld({ "@context": "https://schema.org", "@type": "Event", name: e.name, startDate: e.start, endDate: e.end, url: `https://luma.com/${e.slug}`, location: { "@type": "Place", name: e.place } })}`,
      nextData({ props: { pageProps: { initialData: { data: { event: { name: e.name, start_at: e.start, end_at: e.end, url: e.slug, geo_address_info: { mode: "shown", address: e.place, full_address: e.full, city: e.city, region: "New York" } }, ticket_info } } } } }));
  // ticket_info sits beside the event record on Luma; read only from THIS event's record.
  const freePage = withTicket({ is_free: true });
  const { out } = await analyze(`https://luma.com/${e.slug}`, freePage);
  assert.equal(out.candidate.attendance.cta, "register");
  const rec = A.pageRecordAttendance({ ticket_info: { is_free: false, price: { cents: 1500, currency: "USD" }, max_price: { cents: 3000, currency: "USD" }, require_approval: true } });
  assert.deepEqual(rec, { pricing: "paid", price: "$15–$30", registration: "required", hiddenLocation: false });
  const d = A.decideAttendance(A.combineEvidence(A.structuredAttendance(null, new URL("https://luma.com/x")), rec, A.pageAttendance([], [], new URL("https://luma.com/x"))), { lumaEventUrl: "https://luma.com/x" });
  assert.equal(d.cta, "tickets");
  // Unexpected types stay unknown.
  assert.deepEqual(A.pageRecordAttendance({ ticket_info: { is_free: "yes", price: 12 } }), { pricing: "unknown", price: null, registration: "unknown", hiddenLocation: false });
});

test("a Luma calendar page never uses the platform fallback", async () => {
  const { out } = await analyze("https://luma.com/usecorginyc", F.lumaCalendar());
  assert.equal(out.ok && out.kind, "multi");
  for (const e of out.events) {
    assert.equal(e.candidate.attendance.url, null, `${e.candidate.title}: no attendance link from a calendar listing`);
    assert.equal(e.candidate.attendance.cta, null);
  }
  assert.equal(A.isLumaEventUrl("https://luma.com/calendar/cal-123"), false);
  assert.equal(A.isLumaEventUrl("https://luma.com/user/someone"), false);
  assert.equal(A.isLumaEventUrl("https://luma.com/nyc"), false);
  assert.equal(A.isLumaEventUrl("https://lu.ma/spooktober-movie-night"), true);
});

test("an arbitrary source link never becomes the attendance link by itself", async () => {
  const { out } = await analyze("https://oldmill.example.org/harvest", page(ld({ ...EVENT, location: PLACE }), `<h1>Harvest Supper</h1><p>Join us.</p>`));
  assert.equal(out.candidate.sourceUrl, "https://oldmill.example.org/harvest");
  assert.deepEqual(out.candidate.attendance, { ...A.UNKNOWN_ATTENDANCE });
  // Registration correctness pass (approved precedence rule 4 — "Event Link
  // itself ONLY when that URL genuinely functions as the registration or
  // ticket destination"): an Eventbrite single-Event page (/e/…) IS that
  // destination, like a verified Luma Event page. A listing page is not.
  const eb = await analyze("https://www.eventbrite.com/e/harvest-supper-123", page(ld({ ...EVENT, location: PLACE })));
  assert.equal(eb.out.candidate.attendance.url, "https://www.eventbrite.com/e/harvest-supper-123");
  assert.equal(A.isRegistrationPlatformEventUrl("https://www.eventbrite.com/d/ny--new-york/events/"), false, "a listing page is not one Event");
  assert.equal(A.isRegistrationPlatformEventUrl("https://partiful.com/e/AbCd1234"), true);
  assert.equal(A.isRegistrationPlatformEventUrl("https://www.fujikina.com/nyc-2026"), false, "an informational Event Link is never the RSVP");
});

test("AI cannot invent attendance: AI output never sets price / free / RSVP / tickets", async () => {
  const html = page(`<title>Harvest Supper</title>`, `<p>Harvest Supper</p><p>Oct 30, 7pm-10pm at The Old Mill, 12 Mill Rd, Hudson NY</p>`);
  const ai = {
    messages: {
      parse: async () => ({
        stop_reason: "end_turn",
        parsed_output: {
          title: "Harvest Supper", schedule: [{ evidence: "Oct 30, 7pm-10pm at The Old Mill, 12 Mill Rd, Hudson NY", date: "2026-10-30", start_time: "19:00", end_time: "22:00", venue_name: "The Old Mill", street_address: "12 Mill Rd" }],
          venue_name: "The Old Mill", street_address: "12 Mill Rd", city: "Hudson", state: "NY", postal_code: null, organizer: null, organizer_evidence: null,
          // Not in the schema — must be ignored entirely.
          price: "$10", is_free: true, rsvp_required: true, ticket_url: "https://evil.example/t",
        },
      }),
    },
  };
  const { out } = await analyze("https://oldmill.example.org/harvest", html, { ai });
  assert.equal(out.ok, true);
  assert.deepEqual(out.candidate.attendance, { ...A.UNKNOWN_ATTENDANCE });
  assert.doesNotMatch(read("src/lib/event-import/ai.ts"), /attendance|ticket|rsvp|price/i, "the AI step has no attendance fields");
});

test("existing Admin RSVP / Get Tickets behavior unchanged; Register only relabels the RSVP action", () => {
  assert.equal(L.rsvpActionLabel(null), "RSVP");
  assert.equal(L.rsvpActionLabel(undefined), "RSVP");
  assert.equal(L.rsvpActionLabel("rsvp"), "RSVP");
  assert.equal(L.rsvpActionLabel("register"), "Register");
  assert.equal(L.rsvpActionLabel("bogus"), "RSVP");
  const ctas = read("src/components/EventScheduleCtas.tsx");
  assert.match(ctas, /label: "Get Tickets"/);
  assert.match(ctas, /label: c\.rsvpLabel \?\? "RSVP"/);
  const view = read("src/app/(public)/event/[slug]/EventPublicView.tsx");
  assert.match(view, /event\.tickets_enabled && event\.tickets_url\) \{\n\s+customCtas\.push\(\{ label: "Get Tickets"/);
  assert.match(view, /label: rsvpLabel, href: rsvpForm\.url/);
  // Admin save still writes the same RSVP/Tickets columns; the label and
  // visibility go in a separate, best-effort update only when sent.
  const admin = read("src/app/admin/(protected)/events/actions.ts");
  assert.match(admin, /rsvp_enabled: bool\(formData, "rsvp_enabled"\),\n\s+rsvp_url: str\(formData, "rsvp_url"\),\n\s+tickets_enabled: bool\(formData, "tickets_enabled"\),\n\s+tickets_url: str\(formData, "tickets_url"\),/);
  assert.match(admin, /formData\.has\("rsvp_cta"\) \|\| formData\.has\("location_visibility"\)/);
  assert.doesNotMatch(admin.slice(admin.indexOf("const payload = {"), admin.indexOf("// Location privacy, defense in depth")), /rsvp_cta|location_visibility/, "the main Admin payload is unchanged");
  if (CTA) {
    const sel = { ticket_url_override: null, rsvp_url_override: null, vendor_apply_url_override: null };
    const cfg = { ticketsEnabled: true, ticketsUrl: "https://t.example/x", rsvpEnabled: true, rsvp: { url: "https://r.example/x", displayMode: "external" }, vendorApplicationsEnabled: false, vendorApplication: null };
    assert.deepEqual(CTA.resolveEventCtas(sel, cfg).map((c) => c.label), ["Get Tickets", "RSVP"]);
    assert.deepEqual(CTA.resolveEventCtas(sel, { ...cfg, rsvpLabel: "Register" }).map((c) => c.label), ["Get Tickets", "Register"]);
  }
});

// ── location privacy ───────────────────────────────────────────────────

test("exact: a precise public place is matched to Findmi Locations as before", async () => {
  const { out, calls } = await analyze("https://oldmill.example.org/harvest", page(ld({ ...EVENT, location: PLACE })));
  assert.equal(out.candidate.locationVisibility, "exact");
  assert.equal(calls.locations.length, 1);
  assert.equal(out.matches.locations.length, 1);
});

test("broad: only 'New York, NY' public → city/state kept, no precise Location matched", async () => {
  const { out, calls } = await analyze("https://oldmill.example.org/roundtable", page(ld({ ...EVENT, name: "AI Founders Roundtable", location: { "@type": "Place", name: "New York, NY" } })));
  assert.equal(out.candidate.locationVisibility, "broad");
  assert.deepEqual(out.candidate.occurrences[0].venue, { name: null, address: null, city: "New York", state: "NY", postalCode: null });
  assert.equal(calls.locations.length, 0, "no Location lookup");
  assert.deepEqual(out.matches.locations, []);
});

test("hidden (Luma obfuscated): no venue/address kept, no Location matched — even if JSON-LD names a place", async () => {
  const e = { ...F.CORGI_EVENTS[6], slug: "eogbfesu" };
  const html = page(
    `<title>${esc(e.name)} · Luma</title>${ld({ "@context": "https://schema.org", "@type": "Event", name: e.name, startDate: e.start, endDate: e.end, url: `https://luma.com/${e.slug}`, location: { "@type": "Place", name: "Corgi Cafe NYC", address: { "@type": "PostalAddress", streetAddress: "121 East 27th Street", addressLocality: "New York", addressRegion: "NY" } } })}`,
    nextData({ props: { pageProps: { initialData: { data: { event: { name: e.name, start_at: e.start, end_at: e.end, url: e.slug, geo_address_info: { mode: "obfuscated", city: "New York", region: "New York" } } } } } } })
  );
  const { out, calls } = await analyze(`https://luma.com/${e.slug}`, html);
  assert.equal(out.candidate.locationVisibility, "hidden");
  for (const o of out.candidate.occurrences) {
    assert.equal(o.venue.name, null);
    assert.equal(o.venue.address, null);
    assert.equal(o.venue.postalCode, null);
    assert.equal(o.venue.city, "New York");
  }
  assert.equal(calls.locations.length, 0);
  assert.deepEqual(out.matches.locations, []);
  assert.ok(out.warnings.some((w) => /only after registration/.test(w)));
  assert.equal(out.candidate.attendance.url, `https://luma.com/${e.slug}`, "attendance path is prominent");
});

test("hidden via page wording ('Register to See Address'); none stays unset", async () => {
  const hidden = await analyze("https://oldmill.example.org/secret", page(ld({ ...EVENT, location: PLACE }), `<p>Register to See Address</p>`));
  assert.equal(hidden.out.candidate.locationVisibility, "hidden");
  assert.equal(hidden.out.candidate.occurrences[0].venue.name, null);
  const none = A.decideLocationVisibility({ occurrences: [{ venue: { name: null, address: null, city: null, state: null, postalCode: null } }], online: false }, false);
  assert.equal(none, "none");
  assert.equal(A.applyLocationVisibility({ occurrences: [{ start: "x", venue: { name: null, address: null, city: null, state: null, postalCode: null } }], online: false }, "none").occurrences[0].venue.name, null);
});

const reviewBase = (over = {}) => ({
  intent: "participating", title: "Founders After Hours", description: null, imageUrl: null, sourceUrl: "https://luma.com/eogbfesu",
  occurrences: [{ id: "d1", date: "2026-10-20", startTime: "18:00", endTime: "21:00", place: { venueName: null, address: null, city: null, state: null, postalCode: null, useLocationId: null } }],
  sharedPlace: true, place: { venueName: "Corgi Cafe NYC", address: "121 East 27th Street", city: "New York", state: "NY", postalCode: "10016", useLocationId: CORGI_NYC },
  organizer: null, useEventId: null, asEvent: true, ...over,
});

test("persisting a hidden-location Event never stores the venue, address or a Findmi Location", () => {
  const r = P.normalizeReview(reviewBase({ locationVisibility: "hidden", attendance: { cta: "register", url: "https://luma.com/eogbfesu" } }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.occurrences[0].place, { name: null, address: null, postalCode: null, locationId: null, city: "New York", state: "NY" });
  assert.deepEqual(r.value.attendance, { cta: "register", url: "https://luma.com/eogbfesu" });
  // broad: a precise place the person typed is their own → exact.
  const typed = P.normalizeReview(reviewBase({ locationVisibility: "broad" }));
  assert.equal(typed.value.locationVisibility, "exact");
  assert.equal(typed.value.occurrences[0].place.locationId, CORGI_NYC);
  // broad with no typed place: never a Location.
  const broad = P.normalizeReview(reviewBase({ locationVisibility: "broad", place: { venueName: null, address: null, city: "New York", state: "NY", postalCode: null, useLocationId: CORGI_NYC } }));
  assert.equal(broad.value.occurrences[0].place.locationId, null);
  assert.equal(broad.value.locationVisibility, "broad");
  // Attendance links must be https and a known action.
  assert.equal(P.normalizeReview(reviewBase({ attendance: { cta: "register", url: "javascript:alert(1)" } })).value.attendance, null);
  assert.equal(P.normalizeReview(reviewBase({ attendance: { cta: "buy", url: "https://x.example/a" } })).value.attendance, null);
});

// A minimal admin double recording every write.
function fakeAdmin({ appearance = null, failExtras = false } = {}) {
  const ops = [];
  let n = 0;
  const builder = (table) => {
    const api = {
      select: () => api, neq: () => api, is: () => api, in: () => api, limit: () => api, order: () => api, eq: () => api,
      maybeSingle: async () => ({ data: table === "appearances" ? appearance : null }),
      then: (resolve) => resolve({ data: [] }),
      insert: (input) => {
        const rows = Array.isArray(input) ? input : [input];
        ops.push({ op: "insert", table, rows });
        const ids = rows.map(() => `${table}-${++n}`);
        return { select: () => ({ single: async () => ({ data: { id: ids[0] }, error: null }), then: (r) => r({ data: ids.map((id) => ({ id })) }) }), then: (r) => r({ error: null }) };
      },
      upsert: (row, opts) => (ops.push({ op: "upsert", table, row, opts }), Promise.resolve({ error: null })),
      update: (patch) => {
        const rec = { op: "update", table, patch, where: [] };
        ops.push(rec);
        const isExtras = "rsvp_cta" in patch || "location_visibility" in patch;
        const chain = { eq: (k, v) => (rec.where.push([k, v]), chain), is: (k, v) => (rec.where.push([k, v]), chain), select: () => chain, maybeSingle: async () => ({ data: { id: "x" }, error: null }), then: (r) => r({ error: failExtras && isExtras ? { message: "column does not exist" } : null }) };
        return chain;
      },
    };
    return api;
  };
  return { ops, client: { from: builder, rpc: async (name, args) => (ops.push({ op: "rpc", name, args }), { data: { id: "hosted-event" }, error: null }) } };
}
function persistDeps(admin) {
  return {
    admin, userId: "u", businessId: "corgi", businessName: "Corgi",
    applyToEvent: async () => "applied", canHost: async () => true, storeImage: async (u) => `stored:${u}`, geography: async () => null,
    uniqueEventSlug: async (t) => t.toLowerCase().replace(/\W+/g, "-"), notifyNewEvent: async () => {}, propagateDates: async () => {}, findEventBySourceUrl: async () => null,
  };
}

test("rich Where I'll Be import: participation (never host), live, attendance on existing columns + extras best-effort", async () => {
  const r = P.normalizeReview(reviewBase({ locationVisibility: "hidden", attendance: { cta: "register", url: "https://luma.com/eogbfesu" } }));
  for (const failExtras of [false, true]) {
    const { ops, client } = fakeAdmin({ failExtras });
    const out = await P.persistEventImport(r.value, persistDeps(client));
    assert.equal(out.ok, true, "creation succeeds even before the migration is applied");
    const ev = ops.find((o) => o.op === "insert" && o.table === "events").rows[0];
    assert.equal(ev.host_business_id, null, "participant, not host");
    assert.equal(ev.is_demo, false);
    assert.equal(ev.publication_status, "live", "live by default");
    assert.equal(ev.rsvp_enabled, true);
    assert.equal(ev.rsvp_url, "https://luma.com/eogbfesu");
    assert.equal(ev.venue_name, null);
    assert.equal(ev.address, null);
    assert.ok(!("rsvp_cta" in ev) && !("location_visibility" in ev), "newer columns never in the core insert");
    assert.ok(!("is_featured" in ev), "Featured untouched");
    const extras = ops.find((o) => o.op === "update" && o.table === "events" && "rsvp_cta" in o.patch);
    assert.deepEqual(extras.patch, { rsvp_cta: "register", location_visibility: "hidden" });
    const occ = ops.find((o) => o.op === "insert" && o.table === "event_occurrences").rows[0];
    assert.equal(occ.location_id, null);
    assert.equal(occ.venue_name, null);
    assert.equal(ops.filter((o) => o.op === "insert" && o.table === "events").length, 1, "one Event");
    assert.equal(ops.filter((o) => o.op === "insert" && o.table === "appearances").length, 0, "Appearances only via the shared propagation");
    assert.ok(ops.some((o) => o.op === "upsert" && o.table === "event_businesses" && o.row.status === "approved"));
  }
  // Tickets map to the existing tickets columns; no label extra.
  const t = P.normalizeReview(reviewBase({ attendance: { cta: "tickets", url: "https://tix.example/a" } }));
  const { ops, client } = fakeAdmin();
  await P.persistEventImport(t.value, persistDeps(client));
  const ev = ops.find((o) => o.op === "insert" && o.table === "events").rows[0];
  assert.equal(ev.tickets_enabled, true);
  assert.equal(ev.tickets_url, "https://tix.example/a");
  assert.ok(!ops.some((o) => o.op === "update" && "rsvp_cta" in o.patch));
});

test("Review defaults carry only evidenced attendance and the source's visibility", () => {
  const cand = { title: "X", description: null, imageUrl: null, sourceUrl: "https://luma.com/x", platform: "Luma", occurrences: [], online: false, organizer: null, sources: {}, persistAs: "event",
    attendance: { url: "https://luma.com/x", cta: "register", pricing: "unknown", price: null, registration: "required", basis: "platform" }, locationVisibility: "hidden" };
  const matches = { event: null, locations: [], organizerBusiness: null, existingAppearance: null };
  const d = R.reviewDefaults(cand, matches, "participating");
  assert.deepEqual(d.attendance, { cta: "register", url: "https://luma.com/x" });
  assert.equal(d.locationVisibility, "hidden");
  assert.equal(R.reviewDefaults({ ...cand, attendance: undefined, locationVisibility: undefined }, matches, "participating").attendance, null);
});

// ── conversion ─────────────────────────────────────────────────────────

const LEGACY = {
  id: "f4055d1f-4f72-4ac1-8dd0-13a228f1b3c6", business_id: "corgi", title: "Founders After Hours: A Mixer", description: null,
  start_at: "2026-10-20T22:00:00+00:00", end_at: "2026-10-21T00:00:00+00:00", status: "confirmed", event_id: null, location_id: CORGI_NYC,
  venue_name: "Corgi Cafe NYC", address: "121 East 27th Street", city: "Manhattan", state: "NY", latitude: 40.7, longitude: -73.9,
  external_url: "https://luma.com/eogbfesu", flyer_image_url: null, market_id: "m1", market_area_id: null,
};
const recovered = (over = {}) => ({
  title: "Founders After Hours: A Mixer", description: "Meet founders.", imageUrl: null, sourceUrl: "https://luma.com/eogbfesu", platform: "Luma",
  occurrences: [{ start: "2026-10-20T22:00:00.000Z", end: "2026-10-21T00:00:00.000Z", hasTime: true, venue: { name: null, address: null, city: "New York", state: "NY", postalCode: null }, evidence: null }],
  online: false, organizer: "Corgi NYC", sources: { title: "structured", dates: "structured" }, persistAs: "event", ...over,
});
const convertDeps = (over) => ({ recovered: recovered(over), uniqueEventSlug: async () => "founders-after-hours", storeImage: async () => null });

test("conversion of a hidden-location source does NOT keep the legacy Location (keepPlace)", async () => {
  const { ops, client } = fakeAdmin({ appearance: LEGACY });
  const res = await C.convertAppearanceToEvent(client, LEGACY.id, convertDeps({ locationVisibility: "hidden", attendance: { url: "https://luma.com/eogbfesu", cta: "register", pricing: "unknown", price: null, registration: "required", basis: "platform" } }));
  assert.equal(res.status, "converted");
  const ev = ops.find((o) => o.op === "insert" && o.table === "events").rows[0];
  assert.deepEqual([ev.venue_name, ev.address, ev.latitude, ev.longitude], [null, null, null, null]);
  assert.equal(ev.city, "New York");
  assert.equal(ev.rsvp_enabled, true);
  assert.equal(ev.rsvp_url, "https://luma.com/eogbfesu");
  assert.equal(ev.host_business_id, null);
  const occ = ops.find((o) => o.op === "insert" && o.table === "event_occurrences").rows[0];
  assert.equal(occ.location_id, null, "never Corgi Cafe from history");
  assert.equal(occ.venue_name, null);
  const link = ops.find((o) => o.op === "update" && o.table === "appearances");
  assert.equal(link.patch.location_id, null);
  assert.equal(link.patch.venue_name, null);
  assert.equal(link.patch.address, null);
  assert.ok(res.warnings.some((w) => /only after registration/.test(w)));
  assert.deepEqual(ops.find((o) => o.op === "update" && o.table === "events" && "location_visibility" in o.patch).patch, { rsvp_cta: "register", location_visibility: "hidden" });
});

test("conversion of an exact source still keeps the confirmed Findmi Location (unchanged)", async () => {
  const { ops, client } = fakeAdmin({ appearance: LEGACY });
  const res = await C.convertAppearanceToEvent(client, LEGACY.id, convertDeps({ locationVisibility: "exact", occurrences: [{ ...recovered().occurrences[0], venue: { name: "Corgi Cafe", address: null, city: "New York", state: "NY", postalCode: null } }] }));
  assert.equal(res.status, "converted");
  const occ = ops.find((o) => o.op === "insert" && o.table === "event_occurrences").rows[0];
  assert.equal(occ.location_id, CORGI_NYC);
  assert.equal(occ.venue_name, "Corgi Cafe NYC");
  const link = ops.find((o) => o.op === "update" && o.table === "appearances");
  assert.ok(!("location_id" in link.patch), "the item's Location untouched");
  assert.equal(ops.filter((o) => o.op === "insert" && o.table === "appearances").length, 0, "no duplicate Appearance");
});

// ── public page ────────────────────────────────────────────────────────

test("public Event page: hidden location shows the registration message and no address / Location / directions", () => {
  assert.equal(L.isLocationHidden("hidden"), true);
  assert.equal(L.isLocationHidden(null), false);
  assert.equal(L.HIDDEN_LOCATION_COPY, "Location shared after registration");
  const view = read("src/app/(public)/event/[slug]/EventPublicView.tsx");
  assert.match(view, /const locationHidden = isLocationHidden\(event\.location_visibility\);/);
  assert.match(view, /event\.venue_name && !locationHidden \? findLocationByExactVenue/);
  assert.match(view, /const canonicalLocation = locationHidden \? null :/);
  assert.match(view, /const directionsHref = mapQuery && !locationHidden/);
  assert.match(view, /locationHidden \? \(\n\s+<WhereFact name=\{HIDDEN_LOCATION_COPY\} lines=\{\[location\]\} \/>/);
  assert.match(view, /where: locationHidden\n\s+\? \{ name: HIDDEN_LOCATION_COPY, href: null/);
  assert.match(view, /<EventScheduleSummary\n\s+locationHidden=\{locationHidden\}/);
  const summary = read("src/components/EventScheduleSummary.tsx");
  assert.match(summary, /locationHidden \? \(\n\s+<WhereFact name=\{HIDDEN_LOCATION_COPY\} lines=\{\[cityState\(selected\.city, selected\.state\)\]\} \/>/);
  // external_url remains the quiet "Event details" link, not an attendance action.
  assert.match(view, /event\.external_url && \(/);
  assert.doesNotMatch(view, /customCtas\.push\(\{[^}]*external_url/);
});

// ── stale Edit Appearance save ────────────────────────────────────────

test("stale save: convert → IDs persisted → a Save from the pre-conversion form is refused; a fresh form saves", async () => {
  // 1–3. A standalone item converts; the SAME row gets event + occurrence ids.
  const { ops, client } = fakeAdmin({ appearance: LEGACY });
  const res = await C.convertAppearanceToEvent(client, LEGACY.id, convertDeps({ locationVisibility: "exact", occurrences: [{ ...recovered().occurrences[0], venue: { name: "Corgi Cafe", address: null, city: "New York", state: "NY", postalCode: null } }] }));
  assert.equal(res.status, "converted");
  const link = ops.find((o) => o.op === "update" && o.table === "appearances");
  assert.equal(link.patch.event_id, res.eventId);
  assert.equal(link.patch.event_occurrence_id, res.occurrenceId);
  const stored = { eventId: res.eventId, occurrenceId: res.occurrenceId };

  // 4. The form rendered BEFORE conversion posts empty Related Event state.
  const stale = new FormData();
  stale.set("event_id", "");
  stale.set("loaded_event_id", "");
  stale.set("loaded_event_occurrence_id", "");
  assert.equal(S.isStaleAppearanceLink(S.loadedAppearanceLink(stale), stored), true, "refused — the link survives");

  // 5. The remounted form (rendered from the linked row) saves normally.
  const fresh = new FormData();
  fresh.set("event_id", res.eventId);
  fresh.set("loaded_event_id", res.eventId);
  fresh.set("loaded_event_occurrence_id", res.occurrenceId);
  assert.equal(S.isStaleAppearanceLink(S.loadedAppearanceLink(fresh), stored), false);

  // Intentional removal on a CURRENT form still works (existing semantics).
  const clear = new FormData();
  clear.set("event_id", "");
  clear.set("loaded_event_id", res.eventId);
  clear.set("loaded_event_occurrence_id", res.occurrenceId);
  assert.equal(S.isStaleAppearanceLink(S.loadedAppearanceLink(clear), stored), false);
  // A form without markers (new appearance) is never blocked.
  assert.equal(S.loadedAppearanceLink(new FormData()), null);
  assert.equal(S.isStaleAppearanceLink(null, stored), false);
});

test("stale save: the edit page remounts the form on a link change, and saveAppearance checks before writing", () => {
  const pageSrc = read("src/app/admin/(protected)/appearances/[id]/page.tsx");
  assert.match(pageSrc, /<AppearanceForm\n\s+key=\{`\$\{appearance\.event_id \?\? ""\}:\$\{appearance\.event_occurrence_id \?\? ""\}:\$\{appearance\.location_id \?\? ""\}`\}/);
  assert.doesNotMatch(pageSrc, /awaiting review|\(pending review\)/, "live-by-default copy");
  const form = read("src/app/admin/(protected)/appearances/AppearanceForm.tsx");
  assert.match(form, /name="loaded_event_id" value=\{appearance\.event_id \?\? ""\}/);
  assert.match(form, /name="loaded_event_occurrence_id" value=\{appearance\.event_occurrence_id \?\? ""\}/);
  const actions = read("src/app/admin/(protected)/appearances/actions.ts");
  const guard = actions.indexOf("isStaleAppearanceLink(loadedAppearanceLink(formData)");
  const write = actions.indexOf('.from("appearances").update(payload)');
  assert.ok(guard > 0 && write > guard, "guard runs before the update");
  assert.match(actions.slice(guard, write), /redirect\(errorRedirectUrl\(editPath, STALE_APPEARANCE_LINK_MESSAGE\)\)/);
});

test("migration: one additive, nullable, check-constrained migration; no data changes", () => {
  const sql = read("supabase/migrations/20261014010000_event_attendance_cta_and_location_visibility.sql");
  assert.match(sql, /add column if not exists rsvp_cta text/);
  assert.match(sql, /add column if not exists location_visibility text/);
  assert.match(sql, /rsvp_cta is null or rsvp_cta in \('rsvp', 'register'\)/);
  assert.match(sql, /location_visibility is null or location_visibility in \('exact', 'broad', 'hidden', 'none'\)/);
  const statements = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(statements, /\b(update|delete|insert|drop table|drop column|grant|policy)\b/i);
});
