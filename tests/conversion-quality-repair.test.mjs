// Corgi conversion quality repair: (1) existing-Event matching needs real
// title identity — same day + same place alone is never a match; (2) Event
// descriptions keep their paragraphs/line breaks and survive "<"/">" and
// lengths past the old 2,000 cap. Fixtures mirror the production Corgi
// rows (titles, NY times, venue, city). No network, no production data.
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

const M = await import("../src/lib/admin/appearance-matching.ts");
const FH = await import("../src/lib/admin/form-helpers.ts");
const D = await import("../src/lib/event-import/description.ts");
const X = await import("../src/lib/event-import/extract.ts");
const E = await import("../src/lib/event-import/engine.ts");
const C = await import("../src/lib/appearance-conversion.ts");
const read = (p) => readFileSync(p, "utf8");

// ── Production-shaped Corgi Events already on Findmi ────────────────────
const QSBS = { id: "d05861f9-b21d-4974-ac1f-ad277c67244d", name: "QSBS: Guide to a Tax-Free Exit, presented by Wells Fargo and BakerTilly", venue_name: "Corgi Cafe NYC", city: "Manhattan", start_at: "2026-10-15T14:00:00+00:00" };
const TERM = { id: "78ec1948-c4ee-441a-ae48-d7edd7bf2e43", name: "Term Sheet Teardown: Clauses, Catches & Negotiation Tactics, presented by Wells Fargo and Cooley LLP", venue_name: "Corgi Cafe NYC", city: "Manhattan", start_at: "2026-10-20T14:00:00+00:00" };
const PANCAKE = { id: "d719cb92-9eee-455f-86a7-6b77f348828b", name: "A Pancake Social by Sent & Corgi", venue_name: "Corgi Cafe NYC", city: "Manhattan", start_at: "2026-10-21T14:00:00+00:00" };
const EVENTS = [QSBS, TERM, PANCAKE];

// The three former false matches (their own titles / NY dates / times).
const SPOOK = { title: "Spooktober Movie Night - The Drama", date: "2026-10-15", startIso: "2026-10-15T23:00:00.000Z", venue_name: "Corgi Cafe", city: "Manhattan" };
const AFTER = { title: "Founders After Hours: A Mixer", date: "2026-10-20", startIso: "2026-10-20T22:00:00.000Z", venue_name: "Corgi Cafe", city: "Manhattan" };
const BUILT = { title: "Built in Person: How Great Companies Scale IRL", date: "2026-10-21", startIso: "2026-10-21T22:00:00.000Z", venue_name: "Corgi Cafe", city: "Manhattan" };

// ── 1. MATCHING ──────────────────────────────────────────────────────────
test("the three Corgi false matches no longer match anything", () => {
  assert.equal(M.bestEventMatch(SPOOK, EVENTS), null, "Spooktober ≠ QSBS");
  assert.equal(M.bestEventMatch(AFTER, EVENTS), null, "Founders After Hours ≠ Term Sheet Teardown");
  assert.equal(M.bestEventMatch(BUILT, EVENTS), null, "Built in Person ≠ A Pancake Social");
});

test("same day + same city, unrelated title → no match (not even weak)", () => {
  assert.equal(M.scoreEventMatch({ title: "Saturday Book Swap", date: "2026-10-15", city: "Manhattan" }, QSBS), null);
});

test("same day + same venue, unrelated title → no match", () => {
  assert.equal(M.scoreEventMatch({ title: "Corgi Cafe Trivia", date: "2026-10-15", venue_name: "Corgi Cafe NYC", city: "Manhattan" }, QSBS), null, "venue words in the title don't count as Event identity either… unless they overlap the Event's own title");
});

test("punctuation / casing differences still match strongly", () => {
  const m = M.bestEventMatch({ title: "qsbs guide to a tax free exit presented by wells fargo and bakertilly", date: "2026-10-15", startIso: "2026-10-15T14:00:00.000Z", city: "Manhattan" }, EVENTS);
  assert.deepEqual([m?.id, m?.confidence], [QSBS.id, "strong"]);
});

test("modest title variation on the same day/place still matches strongly", () => {
  const m = M.bestEventMatch({ title: "QSBS: Guide to a Tax-Free Exit", date: "2026-10-15", startIso: "2026-10-15T14:00:00.000Z", venue_name: "Corgi Cafe", city: "Manhattan" }, EVENTS);
  assert.deepEqual([m?.id, m?.confidence], [QSBS.id, "strong"]);
  const t = M.bestEventMatch({ title: "Term Sheet Teardown", date: "2026-10-20", venue_name: "Corgi Cafe NYC", city: "Manhattan" }, EVENTS);
  assert.deepEqual([t?.id, t?.confidence], [TERM.id, "strong"]);
});

test("strongly overlapping title + same date + same place → strong", () => {
  const m = M.bestEventMatch({ title: "A Pancake Social by Sent & Corgi", date: "2026-10-21", startIso: "2026-10-21T14:00:00.000Z", venue_name: "Corgi Cafe NYC", city: "Manhattan" }, EVENTS);
  assert.deepEqual([m?.id, m?.confidence], [PANCAKE.id, "strong"]);
});

test("same title but starts hours apart → only weak (time gap lowers confidence)", () => {
  const m = M.bestEventMatch({ title: "A Pancake Social by Sent & Corgi", date: "2026-10-21", startIso: "2026-10-21T22:00:00.000Z", city: "Manhattan" }, EVENTS);
  assert.deepEqual([m?.id, m?.confidence], [PANCAKE.id, "weak"]);
});

test("a different day never matches, however similar the title", () => {
  assert.equal(M.bestEventMatch({ title: QSBS.name, date: "2026-10-16", city: "Manhattan" }, EVENTS), null);
});

test("exact source link stays strong duplicate evidence (conversion refuses a second Event)", async () => {
  const appearance = {
    id: "spook", business_id: "corgi", title: "Spooktober Movie Night - The Drama", description: null, start_at: "2026-10-15T23:00:00+00:00", end_at: "2026-10-16T01:00:00+00:00",
    status: "confirmed", event_id: null, location_id: "loc", venue_name: "Corgi Cafe NYC", address: null, city: "Manhattan", state: "NY", latitude: null, longitude: null,
    external_url: "https://luma.com/4w2i8mkh", flyer_image_url: null, market_id: null, market_area_id: null,
  };
  const existing = { id: "existing-spook", external_url: "https://luma.com/4w2i8mkh" };
  const inserts = [];
  const from = (table) => {
    const f = [];
    const q = {
      select: () => q, is: () => q, neq: () => q, limit: () => q,
      eq: (k, v) => (f.push([k, v]), q),
      maybeSingle: async () => ({ data: table === "appearances" ? appearance : null }),
      then: (r) => r({ data: table === "events" && f.some(([k, v]) => k === "external_url" && v === existing.external_url) ? [existing] : [] }),
      insert: (row) => (inserts.push([table, row]), q),
    };
    return q;
  };
  const out = await C.convertAppearanceToEvent({ from }, "spook", { uniqueEventSlug: async () => "x" });
  assert.deepEqual([out.status, out.reason, out.eventId], ["skipped", "source_event_exists", "existing-spook"]);
  assert.equal(inserts.length, 0);
});

test("the engine's draft now carries the source's NY start time (enables the time-gap check)", () => {
  assert.match(read("src/lib/event-import/engine.ts"), /start_time: d\.hasTime \? new Date\(d\.start\)\.toLocaleTimeString\("en-GB", \{[^}]*timeZone: "America\/New_York" \}\) : null,/);
  assert.match(read("src/lib/admin/appearance-matching.ts"), /return localDateTimeToIso\(`\$\{draft\.date\}T\$\{time\}`\);/);
});

// ── Dry run: the three skipped items through the REAL analysis + matcher ──
function lumaPage({ name, start, end, desc }) {
  const ld = { "@context": "https://schema.org", "@type": "Event", name, startDate: start, endDate: end, description: desc, image: "https://images.lumacdn.com/x.jpg", organizer: { "@type": "Organization", name: "Corgi NYC" }, location: { "@type": "Place", name: "Corgi Cafe NYC", address: { "@type": "PostalAddress", streetAddress: "121 East 27th Street", addressLocality: "New York", addressRegion: "NY" } } };
  return `<!doctype html><html><head><title>${name}</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;
}
const deps = (html) => ({
  fetchPage: async (url) => ({ ok: true, url, html, bytes: html.length, redirects: 0, truncated: false, declaredBytes: null }),
  ai: null,
  // The real matcher over the production-shaped Corgi Events.
  matchEvent: async (draft) => M.bestEventMatch({ title: draft.title, date: draft.date, startIso: draft.start_time ? FH.localDateTimeToIso(`${draft.date}T${draft.start_time}`) : null, venue_name: draft.venue_name, city: draft.city }, EVENTS),
  getEvent: async () => ({ slug: "x", host_business_id: null }),
  matchLocations: async () => [], matchPossibleLocations: async () => [], matchOrganizer: async () => null, matchExistingAppearance: async () => null,
  findScheduledBySourceUrl: async () => null, findEventBySourceUrl: async () => null, isRateLimited: () => false, now: () => Date.parse("2026-10-14T12:00:00Z"),
});

for (const [label, url, page] of [
  ["Spooktober Movie Night", "https://luma.com/4w2i8mkh", { name: "Spooktober Movie Night - The Drama", start: "2026-10-15T19:00:00-04:00", end: "2026-10-15T21:00:00-04:00" }],
  ["Founders After Hours", "https://luma.com/eogbfesu", { name: "Founders After Hours: A Mixer", start: "2026-10-20T18:00:00-04:00", end: "2026-10-20T19:30:00-04:00" }],
  ["Built in Person", "https://luma.com/corginyc-ervo", { name: "Built in Person: How Great Companies Scale IRL", start: "2026-10-21T18:00:00-04:00", end: "2026-10-21T20:30:00-04:00" }],
]) {
  test(`dry run — ${label}: its own single Event, no false strong match`, async () => {
    const a = await E.analyzeEventUrl({ url, businessId: "corgi", rateKey: `dry-${url}` }, deps(lumaPage({ ...page, desc: `${page.name}.\n\nDetails here.` })));
    assert.equal(a.ok, true);
    assert.equal(a.kind, "single");
    assert.equal(a.candidate.title, page.name);
    assert.equal(a.candidate.occurrences[0].start, new Date(page.start).toISOString());
    assert.equal(a.candidate.organizer, "Corgi NYC");
    assert.equal(a.matches.event, null, "no existing Event claimed");
  });
}

// ── 2. DESCRIPTION ───────────────────────────────────────────────────────
test("paragraph breaks and useful line breaks are kept; whitespace normalized", () => {
  const out = D.cleanEventDescription("Join us!   Coffee  &  bagels.\r\n\r\n\r\n\r\nSchedule:\n10:00 AM — Arrival   \n10:30 AM — Workshop\n\n\n\nSee you there.");
  assert.equal(out, "Join us! Coffee & bagels.\n\nSchedule:\n10:00 AM — Arrival\n10:30 AM — Workshop\n\nSee you there.");
});

test("stray < and > no longer delete the description", () => {
  assert.equal(D.cleanEventDescription("We <3 founders -> come say hi > 5pm"), "We <3 founders -> come say hi > 5pm");
  assert.equal(X.plainDescription("Founders <3 pancakes. Arrive > 10am."), "Founders <3 pancakes. Arrive > 10am.", "plain text with < > isn't treated as HTML");
});

test("HTML descriptions become plain text with their paragraphs; markup never persists", () => {
  const out = X.plainDescription("<p>Join us for <b>QSBS</b>.</p><p>Schedule:<br>10:00 — Coffee<br>10:30 — Workshop</p><ul><li>Founders</li><li>Investors</li></ul><p>Q&amp;A &lt;after&gt;</p>");
  assert.equal(out, "Join us for QSBS.\n\nSchedule:\n10:00 — Coffee\n10:30 — Workshop\n\n• Founders\n• Investors\n\nQ&A <after>");
  assert.doesNotMatch(out, /<\/?(p|b|br|ul|li)\b/);
});

test("control/invisible characters removed", () => {
  assert.equal(D.cleanEventDescription("A\u0000B​ C\u0007\tD"), "A B C D".replace("A B", "A B"));
});

test("descriptions past the old 2,000 cap survive (limit is now 5,000)", () => {
  assert.equal(D.EVENT_DESCRIPTION_MAX, 5000);
  assert.equal(X.EVENT_DESCRIPTION_MAX, 5000);
  const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} explains one more detail of the evening in plain words.`).join("\n\n");
  assert.ok(long.length > 2000 && long.length < 5000);
  assert.equal(D.cleanEventDescription(long), long);
});

test("over 5,000: cut at a paragraph, else sentence, else word — never mid-word", () => {
  const para = Array.from({ length: 120 }, (_, i) => `Paragraph ${i + 1} is a complete thought about the event.`).join("\n\n");
  const p = D.cleanEventDescription(para);
  assert.ok(p.length <= 5000 && p.endsWith("about the event."), "ends on a paragraph boundary");
  const oneParagraph = Array.from({ length: 200 }, () => "This sentence keeps going on for a while.").join(" ");
  const s = D.cleanEventDescription(oneParagraph);
  assert.ok(s.length <= 5000 && s.endsWith("for a while."), "ends on a sentence boundary");
  const noPunct = Array.from({ length: 1000 }, () => "word").join(" ");
  const w = D.truncateDescription(noPunct, 5000);
  assert.ok(w.length <= 5000 && w.endsWith("word"), "word boundary as last resort");
});

test("extraction keeps structure end-to-end (JSON-LD description with newlines)", () => {
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({ "@type": "Event", name: "QSBS", startDate: "2026-10-15T10:00:00-04:00", description: "Intro line.\n\nSchedule:\n10:00 AM — Coffee\n10:30 AM — Workshop" })}</script></head><body></body></html>`;
  const { candidate } = X.extractEventCandidate(html, new URL("https://luma.com/corginyc-mjk0"));
  assert.equal(candidate.description, "Intro line.\n\nSchedule:\n10:00 AM — Coffee\n10:30 AM — Workshop");
});

test("persistence and the review form use the description rules (5,000, structure kept)", () => {
  assert.match(read("src/lib/event-import/persist.ts"), /description: cleanEventDescription\(review\.description\),/);
  assert.match(read("src/app/(public)/account/business/[id]/import-event/EventImporter.tsx"), /maxLength=\{EVENT_DESCRIPTION_MAX\}/);
  assert.doesNotMatch(read("src/lib/event-import/sources.ts"), /cleanText\(description, EVENT_DESCRIPTION_MAX\)/);
});

test("rendering: the Event page shows paragraphs as escaped text with pre-line wrapping", () => {
  const rmt = read("src/components/ReadMoreText.tsx");
  assert.match(rmt, /className=\{`whitespace-pre-line \$\{className\}/);
  assert.match(rmt, /\n\s*\{text\}\n/, "plain React text — never dangerouslySetInnerHTML");
  assert.doesNotMatch(rmt, /dangerouslySetInnerHTML/);
  assert.match(read("src/app/(public)/event/[slug]/EventPublicView.tsx"), /<ReadMoreText\s+text=\{event\.description\}/);
  assert.match(read("src/lib/jsonLd.ts"), /replace\(\/<\/g, "\\\\u003c"\)/, "JSON-LD escapes < wherever descriptions are embedded");
});
