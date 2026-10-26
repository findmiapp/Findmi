// Admin Event Import — orchestration over Findmi's EXISTING import systems:
// each Event's own Event Link read by the Event URL importer (explicit
// values win), missing Businesses read by the existing Brand Import (logo,
// cover, description), Review Existing Event instead of discarding, and a
// 25-Event paste read one bounded request per Event. Fakes only — no
// network, no database, no production writes.
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
const O = await import("../src/lib/event-import/operator.ts");
const X = await import("../src/lib/event-import/existing-event.ts");
const T = await import("../src/lib/event-import/types.ts");
const BI = await import("../src/lib/admin/brand-import.ts");
const RUN = await import("../src/lib/admin/brand-import-runner.ts");
const A = await import("../src/app/admin/(protected)/events/import/actions.ts");
const read = (p) => readFileSync(p, "utf8");
const CLIENT = read("src/app/admin/(protected)/events/import/AdminEventImporter.tsx");
const ACTIONS = read("src/app/admin/(protected)/events/import/actions.ts");
const MULTI = read("src/app/(public)/account/business/[id]/import-event/MultiEventImport.tsx");

const NOW = Date.parse("2026-10-01T12:00:00Z");
const ET = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const eventPage = (o, extra = "") =>
  `<!doctype html><html><head><title>${o.name}</title>${o.image ? `<meta property="og:image" content="${o.image}">` : ""}${ld({ "@context": "https://schema.org", "@type": "Event", ...o })}</head><body><h1>${o.name}</h1>${extra}</body></html>`;
const place = (name, street, city = "New York", region = "NY", postalCode = "10001") => ({ "@type": "Place", name, address: { "@type": "PostalAddress", streetAddress: street, addressLocality: city, addressRegion: region, postalCode } });

const PAGES = {
  "https://goodamerican.com/pages/nyc-pop-up": eventPage({
    name: "Good American NYC Pop-Up Shop",
    startDate: "2026-10-15T10:00:00-04:00",
    endDate: "2026-10-15T19:00:00-04:00",
    image: "https://goodamerican.com/cdn/nyc-popup.jpg",
    description: "Shop exclusive denim drops, try on the newest fits and meet the Good American team at our NYC pop-up. Free entry all weekend.",
    location: place("The Canvas", "335 W 35th St"),
  }),
  "https://knix.com/pages/acotar": eventPage(
    {
      name: "Knix x ACOTAR Pop-Up Shop",
      startDate: "2026-10-17T12:00:00-04:00",
      endDate: "2026-10-17T20:00:00-04:00",
      image: ["https://knix.com/cdn/acotar-popup.jpg"],
      description: "Step into the world of A Court of Thorns and Roses with Knix. Limited-edition collection, photo moments and giveaways all day long.",
      location: place("LAVAN Chelsea", "541 W 25th St"),
      organizer: { "@type": "Organization", name: "Knix" },
      offers: { "@type": "Offer", url: "https://knix.com/rsvp/acotar", price: "0" },
    },
    `<a href="https://knix.com/rsvp/acotar">RSVP</a>`
  ),
  "https://miniverse.com/events/mini-break": eventPage({
    name: "Miniverse: Take a Mini Break",
    startDate: "2026-10-20T11:00:00-04:00",
    endDate: "2026-10-20T19:00:00-04:00",
    image: "https://miniverse.com/cdn/mini-break.jpg",
    description: "Make tiny food, tiny gifts and tiny memories at the free Miniverse pop-up in Astor Place Plaza, presented by MGA Entertainment.",
    location: place("Astor Place Plaza", "8th St & Lafayette St", "New York", "NY", "10003"),
    organizer: { "@type": "Organization", name: "MGA Entertainment" },
  }),
};

function deps(over = {}) {
  const calls = { fetched: [], inFlight: 0, maxInFlight: 0, organizers: [] };
  return {
    calls,
    fetchPage: async (url) => {
      calls.fetched.push(url.href);
      calls.inFlight += 1;
      calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight);
      await new Promise((r) => setTimeout(r, 5));
      calls.inFlight -= 1;
      const html = PAGES[url.href] ?? (url.href.startsWith("https://series.example.com/") ? eventPage({ name: `Series ${url.pathname}`, startDate: "2026-11-02T18:00:00-05:00", endDate: "2026-11-02T21:00:00-05:00", location: place("Hall", "1 Main St") }) : null);
      if (url.href.includes("broken")) return { ok: false, code: "blocked_destination", redirects: 0 };
      return html ? { ok: true, url, html, bytes: html.length, redirects: 0, truncated: false, declaredBytes: null } : { ok: false, code: "http_error", redirects: 0, status: 404 };
    },
    ai: null,
    matchEvent: async () => null,
    getEvent: async (id) => ({ slug: `slug-${id}`, host_business_id: null }),
    matchLocations: async (v) => (v.name === "LAVAN Chelsea" ? [{ id: "loc-lavan", name: "LAVAN Chelsea", address: "541 W 25th St", city: "New York", state: "NY", postal_code: "10001" }] : []),
    matchOrganizer: async (name) => (calls.organizers.push(name), name === "Good American" ? { id: "biz-good-american", name: "Good American" } : null),
    matchExistingAppearance: async () => null,
    findScheduledBySourceUrl: async () => null,
    findEventBySourceUrl: async (url) => (url === "https://goodamerican.com/pages/nyc-pop-up" ? { id: "ev-good-american", name: "Good American NYC Pop-Up", startAt: "2026-10-15T15:00:00Z", venueName: "The Canvas", city: "New York" } : null),
    isRateLimited: () => false,
    now: () => NOW,
    ...over,
  };
}

const GOOD_AMERICAN = `Event Name: Good American NYC Pop-Up
Primary Business: Good American
Event Link: https://goodamerican.com/pages/nyc-pop-up
Location Name: The Canvas
Street Address: 335 W 35th St
City: New York
State: NY
ZIP: 10001
Dates: October 15–18, 2026
Start Time: 11:00 AM
End Time: 6:00 PM
Programming:
Oct 15: Opening day DJ set`;
const KNIX = `Event Name: Knix x ACOTAR Pop-Up
Primary Business: Knix
Business Website: knix.com
Event Link: https://knix.com/pages/acotar
Date: Oct 17, 2026
Location Name: LAVAN Chelsea
Street Address: 541 W 25th St
City: New York
State: NY`;
const MINIVERSE = `Event Name: Miniverse: Take a Mini Break
Primary Business: MGA Entertainment
Featured Brand: MGA's Miniverse
Business Website: https://www.mgae.com
Event Link: https://miniverse.com/events/mini-break
Date: Oct 20, 2026
Start Time: 11 AM
End Time: 7 PM`;
const enrich = (text, d = deps()) => E.analyzeAdminSourceEvent({ text, rateKey: "admin" }, d);

// ── EVENT LINK ENRICHMENT ─────────────────────────────────────────────────

test("Knix: the Event Link is read by the existing URL importer — image, description, times, RSVP filled; explicit name kept", async () => {
  const d = deps();
  const r = await enrich(KNIX, d);
  assert.equal(r.ok, true);
  assert.deepEqual(d.calls.fetched, ["https://knix.com/pages/acotar"], "only the Event Link — the Business Website is never fetched here");
  const c = r.candidate;
  assert.equal(c.title, "Knix x ACOTAR Pop-Up", "explicit name wins over the page's name");
  assert.equal(c.imageUrl, "https://knix.com/cdn/acotar-popup.jpg");
  assert.match(c.description, /A Court of Thorns and Roses/);
  assert.deepEqual(c.occurrences.map((o) => [ET(o.start), ET(o.end), o.venue.name]), [["Oct 17, 12:00 PM", "Oct 17, 8:00 PM", "LAVAN Chelsea"]]);
  assert.deepEqual(c.attendance && { cta: c.attendance.cta, url: c.attendance.url }, { cta: "rsvp", url: "https://knix.com/rsvp/acotar" });
  assert.equal(c.sourceUrl, "https://knix.com/pages/acotar");
  assert.equal(c.structured.businessWebsite, "https://knix.com/", "Business Website kept apart from the Event Link");
  assert.deepEqual(c.structured.source, { status: "read", filled: ["description", "image", "organizer", "times", "RSVP / tickets"] });
  assert.equal(r.matches.locations[0].id, "loc-lavan", "existing Location matching unchanged");
  const review = O.operatorReviewDefaults(c, r.matches);
  assert.equal(review.imageUrl, "https://knix.com/cdn/acotar-popup.jpg", "image previewed in Review (stored by Findmi only on save)");
  assert.equal(review.place.useLocationId, "loc-lavan");
});

test("Good American: explicit dates/times stay authoritative (four dates, 11–6), the page fills only image/description; existing Event found by its link", async () => {
  const r = await enrich(GOOD_AMERICAN);
  const c = r.candidate;
  assert.equal(c.occurrences.length, 4, "no phantom or dropped dates");
  assert.deepEqual(c.occurrences.map((o) => [ET(o.start), ET(o.end)]), [
    ["Oct 15, 11:00 AM", "Oct 15, 6:00 PM"],
    ["Oct 16, 11:00 AM", "Oct 16, 6:00 PM"],
    ["Oct 17, 11:00 AM", "Oct 17, 6:00 PM"],
    ["Oct 18, 11:00 AM", "Oct 18, 6:00 PM"],
  ]);
  assert.equal(c.imageUrl, "https://goodamerican.com/cdn/nyc-popup.jpg");
  assert.match(c.description, /exclusive denim drops/);
  assert.ok(c.structured.notes.some((n) => /different time on 2026-10-15; your time was kept/.test(n)), "a disagreement is reported, never applied");
  assert.equal(c.structured.programming[0].text, "Oct 15: Opening day DJ set", "programming kept as evidence");
  assert.ok(c.occurrences.every((o) => o.venue.name === "The Canvas"), "programming never becomes a place");
  assert.deepEqual(r.matches.organizerBusiness, { id: "biz-good-american", name: "Good American" }, "existing Business matched, not recreated");
  assert.equal(r.matches.event?.id, "ev-good-american", "the Event already on Findmi with this link");
  assert.equal(O.operatorReviewDefaults(c, r.matches).useEventId, "ev-good-american", "→ Review Existing Event, never a duplicate");
});

test("explicit structured values override fetched ones (description, place)", async () => {
  const r = await enrich(`${KNIX}\nDescription: Our own researched description.\nRSVP URL: https://partiful.com/e/knix`);
  assert.equal(r.candidate.description, "Our own researched description.");
  assert.equal(r.candidate.attendance.url, "https://partiful.com/e/knix", "explicit RSVP URL wins");
  assert.ok(!r.candidate.structured.source.filled.includes("description"));
  // No explicit place → the page's place fills it.
  const mini = await enrich(MINIVERSE);
  assert.deepEqual([mini.candidate.occurrences[0].venue.name, mini.candidate.occurrences[0].venue.address], ["Astor Place Plaza", "8th St & Lafayette St"]);
  assert.ok(mini.candidate.structured.source.filled.includes("place"));
  assert.deepEqual([ET(mini.candidate.occurrences[0].start), ET(mini.candidate.occurrences[0].end)], ["Oct 20, 11:00 AM", "Oct 20, 7:00 PM"]);
  assert.deepEqual(mini.candidate.structured.otherBusinesses, ["MGA's Miniverse"], "Featured Brand is evidence only");
  assert.equal(mini.candidate.structured.business, "MGA Entertainment");
});

test("a source that can't be read keeps the Event with its explicit values and the reason (never dropped)", async () => {
  const r = await enrich(KNIX.replace("https://knix.com/pages/acotar", "https://broken.example.com/e"));
  assert.equal(r.ok, true);
  assert.equal(r.candidate.title, "Knix x ACOTAR Pop-Up");
  assert.equal(r.candidate.occurrences.length, 1);
  assert.equal(r.candidate.structured.source.status, "failed");
  assert.ok(r.warnings.some((w) => /^Event Link not read:/.test(w)));
  // A calendar page (several Events) is never merged into one Event.
  const calendar = `<!doctype html><html><head>${ld([
    { "@type": "Event", name: "A", startDate: "2026-10-21T10:00:00-04:00", location: place("X", "1 A St") },
    { "@type": "Event", name: "B", startDate: "2026-10-22T10:00:00-04:00", location: place("Y", "2 B St") },
  ])}</head><body></body></html>`;
  const multi = await enrich(KNIX, deps({ fetchPage: async (url) => ({ ok: true, url, html: calendar, bytes: calendar.length, redirects: 0, truncated: false, declaredBytes: null }) }));
  assert.ok(["several_events", "read"].includes(multi.candidate.structured.source.status));
  assert.equal(multi.candidate.title, "Knix x ACOTAR Pop-Up");
});

// ── 25 EVENTS ─────────────────────────────────────────────────────────────

test("25 Events: instant structured reading, then one bounded request per Event (3 at a time); one failed source never costs the batch", async () => {
  const blocks = Array.from({ length: 25 }, (_, i) => {
    const n = i + 1;
    const link = n === 13 ? "https://broken.example.com/e13" : `https://series.example.com/e${n}`;
    return `EVENT ${n}\nEvent Name: Series Night ${n}\nEvent Link: ${link}\nDate: Nov 2, 2026\nLocation Name: Hall\nStreet Address: 1 Main St\nCity: New York\nState: NY\n=== END EVENT ${n} ===`;
  });
  const paste = blocks.join("\n\n");
  const fast = deps();
  const first = await E.analyzeEventText({ text: paste, businessId: null, rateKey: "admin", structured: true }, fast);
  assert.equal(first.events.length, 25);
  assert.equal(fast.calls.fetched.length, 0, "the paste itself never fetches");

  const segments = O.segmentTextByKey(paste);
  assert.equal(segments.size, 25);
  assert.match(segments.get("pasted-event-13"), /Series Night 13/);
  const d = deps();
  const results = new Map();
  await RUN.runWithConcurrency([...segments.keys()], 3, async (key) => {
    results.set(key, await enrich(segments.get(key), d));
    return "done";
  });
  assert.equal(results.size, 25, "every Event has a result");
  assert.ok(d.calls.maxInFlight <= 3, `at most 3 source reads at once (saw ${d.calls.maxInFlight})`);
  const statuses = [...results.values()].map((r) => r.ok && r.candidate.structured.source.status);
  assert.equal(statuses.filter((s) => s === "read").length, 24);
  assert.equal(results.get("pasted-event-13").candidate.structured.source.status, "failed");
  assert.equal(results.get("pasted-event-13").candidate.title, "Series Night 13", "the failed one stays, with its details");
  assert.match(CLIENT, /const EVENT_SOURCE_CONCURRENCY = 3;/);
  assert.match(CLIENT, /await adminEnrichPastedEvent\(segments\.get\(key\)!\)/);
  assert.match(ACTIONS, /const ENRICH_MAX_PER_WINDOW = 150;/, "source reads have their own bound, so 25 Events never hit the per-person limit");
});

// ── BUSINESS: THE EXISTING BRAND IMPORT ───────────────────────────────────

const BRAND_PAGE = `<!doctype html><html><head><title>Knix</title><meta name="description" content="Knix makes leakproof underwear, bras and swimwear designed for every body, every day — comfortable, sustainable essentials made to be worn and loved."><meta property="og:image" content="https://knix.com/cdn/hero-cover.jpg">${ld({ "@type": "Organization", name: "Knix", url: "https://knix.com/", logo: "https://knix.com/cdn/logo.png", sameAs: ["https://www.instagram.com/knixwear/"] })}</head><body></body></html>`;
function brandHarness({ html = BRAND_PAGE, matches = [] } = {}) {
  const rows = new Map();
  const store = {
    async createBatch() {
      return "batch-1";
    },
    async getCandidate(id) {
      return rows.get(id) ?? null;
    },
    async countFreshProcessing() {
      return 0;
    },
    async claim(id) {
      const r = rows.get(id);
      r.status = "processing";
      return true;
    },
    async finish(id, attempt, patch) {
      Object.assign(rows.get(id), patch, { attempt_count: attempt });
      return true;
    },
  };
  const engine = {
    fetchHtml: async (url) => (html ? { ok: true, url: new URL(url.href), html, bytes: html.length, redirects: 0, truncated: false, declaredBytes: null } : { ok: false, code: "dns_failed", redirects: 0 }),
    findMatches: async () => matches,
    listCategories: async () => [{ id: "11111111-1111-4111-8111-111111111111", slug: "fashion", name: "Fashion" }],
    enrich: async () => ({ result: null, called: false, usage: null }),
    verifyImage: async () => true,
  };
  const add = (id, input) =>
    rows.set(id, { id, batch_id: "batch-1", status: "queued", attempt_count: 0, processing_started_at: null, submitted_input: input, normalized_host: "knix.com", ai_status: null, ai_model: null, ai_input_tokens: null, ai_output_tokens: null, ai_cache_creation_input_tokens: null, ai_cache_read_input_tokens: null, ai_estimated_cost_usd: null });
  return { rows, store, engine, add, run: (id) => BI.processBrandImportCandidate(id, { store, engine, now: () => NOW, log: () => {} }) };
}

test("missing Business with a website: the existing Brand Import reads name, description, logo and cover for inline review", async () => {
  const h = brandHarness();
  h.add("cand-knix", "knix.com");
  assert.deepEqual(await h.run("cand-knix"), { outcome: "processed", status: "ready" });
  const p = h.rows.get("cand-knix").proposal;
  assert.equal(p.name, "Knix");
  assert.match(p.about ?? p.sd ?? "", /leakproof underwear/);
  assert.equal(p.logo, "https://knix.com/cdn/logo.png");
  assert.equal(p.cover, "https://knix.com/cdn/hero-cover.jpg");
  // Admin Event Import runs exactly this — the same planning, store, engine and process call.
  assert.match(ACTIONS, /const plan = planBrandImport\(chunk\.join\("\\n"\)\);/);
  assert.match(ACTIONS, /return await processBrandImportCandidate\(candidateId, \{ store: supabaseBrandImportStore\(admin\), engine,/);
  assert.match(ACTIONS, /const created = await createBusinessFromCandidate\(batchId, candidateId, defaultCreateBusinessDeps\(admin\)\);/);
  assert.match(CLIENT, /<BrandReviewCard key=\{read\.updatedAt\}/);
  assert.match(CLIENT, /Use Logo/);
  assert.match(CLIENT, /Use Cover/);
});

test("Business website failure → that Business falls back to minimal Quick Create; the batch continues", async () => {
  const h = brandHarness({ html: null });
  h.add("cand-down", "down.example.com");
  assert.deepEqual(await h.run("cand-down"), { outcome: "processed", status: "failed" });
  // Orchestration completion: the fallback is now a PREPARED minimal Business (never a dead end).
  assert.match(CLIENT, /\{!initial && !existing && prep\?\.status !== "pending" && prepared\?\.status !== "existing" && read\?\.status !== "ready" && !\(read && PENDING_READ\.has\(read\.status\)\) && \(!website \|\| read\?\.status === "failed"\) && \(\n\s+<QuickCreateBusiness/);
  assert.match(CLIENT, /if \(outcome\.outcome === "busy"\) return "retry_later";/, "server busy → retried, not dropped");
});

test("a website that already belongs to a Business is matched and selected — never recreated", async () => {
  const h = brandHarness({ matches: [{ id: "biz-knix", slug: "knix", name: "Knix", reasons: ["website"], isPublic: true }] });
  h.add("cand-knix", "knix.com");
  assert.deepEqual(await h.run("cand-knix"), { outcome: "processed", status: "existing_business" });
  assert.equal(h.rows.get("cand-knix").matched_business_id, "biz-knix");
  assert.match(CLIENT, /if \(view\.matchedBusiness\) setResult\(/);
  assert.match(CLIENT, /if \(!initial && existing && !applied\.current\) \{/);
});

test("Business reads and creation are Admin-only and never auto-create; Featured / Participating Businesses reach operator Match/Create/Ignore, never auto-linked", async () => {
  globalThis.__ADMIN = undefined;
  assert.deepEqual(await A.adminStartBusinessReads(["knix.com"]), { ok: false, error: "Your Admin session has ended. Sign in again." });
  assert.deepEqual(await A.adminProcessBusinessRead("11111111-1111-4111-8111-111111111111"), { outcome: "error" });
  assert.equal((await A.adminCreateBusinessFromRead("11111111-1111-4111-8111-111111111111", "11111111-1111-4111-8111-111111111111", "", {})).ok, false);
  assert.deepEqual(await A.adminEnrichPastedEvent(KNIX), { ok: false, code: "server" });
  // Only an explicit click creates (BrandReviewCard → adminCreateBusinessFromRead).
  assert.equal((CLIENT.match(/adminCreateBusinessFromRead\(/g) ?? []).length, 1);
  assert.match(CLIENT, /onClick=\{create\} disabled=\{busy \|\| !name\.trim\(\) \|\| !categoryId\}/);
  // Explicit Involved-Business Resolution pass — the dead-end "Not linked"
  // line is now an actionable Match/Create/Ignore resolver, never an
  // automatic link.
  assert.match(CLIENT, /Named in the source, not Findmi&rsquo;s own structured data — match, create, or ignore\. Never linked automatically\./);
  assert.match(CLIENT, /onClick=\{\(\) => onChoose\("ignored"\)\}/);
  assert.match(CLIENT, /onClick=\{\(\) => onChoose\(\{ id: c\.id, name: c\.name \}\)\}/);
});

// ── REVIEW EXISTING EVENT ─────────────────────────────────────────────────

const EV1 = "eeeeeeee-0000-4000-8000-000000000001";
const SNAP = { id: EV1, name: "Good American NYC Pop-Up", slug: "ga", coverImageUrl: null, description: "Short.", externalUrl: null, attendanceUrl: null, organizerName: null, categoryIds: [], formatIds: ["f-1"], businesses: [], occurrenceCount: 4, occurrencesWithoutLocation: 0 };
const PROPOSAL = { imageUrl: "https://goodamerican.com/cdn/nyc-popup.jpg", description: "A much richer description from the source.", link: "https://goodamerican.com/pages/nyc-pop-up", attendance: null, organizer: null, categoryId: "11111111-1111-4111-8111-111111111111", formatIds: ["f-2"], business: { id: "11111111-2222-4333-8444-555555555555", name: "Good American" } };

test("existing Event: empty fields are offered to fill; populated ones conflict and need an explicit choice", () => {
  const cmp = Object.fromEntries(X.compareExistingEvent(SNAP, PROPOSAL).map((c) => [c.field, c.kind]));
  assert.deepEqual(cmp, { image: "fill", description: "conflict", link: "fill", category: "fill", formats: "conflict", business: "fill" });
  assert.equal(X.compareExistingEvent({ ...SNAP, description: "a much richer   description from the source." }, PROPOSAL).find((c) => c.field === "description").kind, "same");
});

function existingClient(snapshot) {
  const writes = [];
  const row = { id: snapshot.id, name: snapshot.name, slug: snapshot.slug, cover_image_url: snapshot.coverImageUrl, description: snapshot.description, external_url: snapshot.externalUrl, rsvp_url: null, tickets_url: null, organizer_name: null };
  return {
    writes,
    from(table) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        in: () => chain,
        neq: () => chain,
        maybeSingle: async () => ({ data: table === "events" ? row : null }),
        then: (res) => res({ data: table === "event_formats" ? snapshot.formatIds.map((id) => ({ category_id: id })) : table === "event_occurrences" ? [{ id: "o1", location_id: "l1" }] : table === "categories" ? [{ id: PROPOSAL.categoryId }] : [], error: null }),
        update: (patch) => (writes.push({ table, kind: "update", patch }), { eq: async () => ({ error: null }) }),
        insert: async (r) => (writes.push({ table, kind: "insert", row: r }), { error: null }),
        upsert: async (r) => (writes.push({ table, kind: "upsert", row: r }), { error: null }),
        delete: () => chain,
      };
      return chain;
    },
  };
}

test("existing Event enrichment writes ONLY chosen fields: fills empty ones, replaces a populated one only by explicit choice", async () => {
  const stored = [];
  const d = { storeImage: async (u) => (stored.push(u), "https://findmi.storage/event/ga.jpg"), propagateDates: async () => {} };
  // Default choices: fill the empty image + link; keep the conflicting description.
  let client = existingClient(SNAP);
  let r = await X.applyExistingEventEnrichment(client, EV1, { image: "fill", link: "fill", description: "fill" }, PROPOSAL, d);
  assert.deepEqual(r, { ok: true, applied: ["image", "link"] });
  assert.deepEqual(client.writes[0], { table: "events", kind: "update", patch: { cover_image_url: "https://findmi.storage/event/ga.jpg", external_url: "https://goodamerican.com/pages/nyc-pop-up" } });
  assert.deepEqual(stored, ["https://goodamerican.com/cdn/nyc-popup.jpg"], "image goes through the existing Event image path");
  // Explicit replace of the populated description.
  client = existingClient(SNAP);
  r = await X.applyExistingEventEnrichment(client, EV1, { description: "replace" }, PROPOSAL, d);
  assert.deepEqual(client.writes[0].patch, { description: "A much richer description from the source." });
  // Formats already set → never replaced from here; category/business fill when empty.
  client = existingClient(SNAP);
  r = await X.applyExistingEventEnrichment(client, EV1, { formats: "replace", category: "fill", business: "fill" }, PROPOSAL, d);
  assert.deepEqual(r.applied, ["category", "business"]);
  assert.ok(!client.writes.some((w) => w.table === "event_formats"));
  assert.deepEqual(client.writes.find((w) => w.table === "event_businesses").row, { event_id: EV1, business_id: PROPOSAL.business.id, status: "approved", participation_scope: "all_dates" });
  // Nothing chosen → nothing written.
  client = existingClient(SNAP);
  assert.deepEqual(await X.applyExistingEventEnrichment(client, EV1, {}, PROPOSAL, d), { ok: true, applied: [] });
  assert.equal(client.writes.length, 0);
  assert.match(CLIENT, /Apply To Existing Event/);
  assert.match(MULTI, /existingEventId: joining \? review\.useEventId : null,/);
});

// ── LOCATIONS + PROGRAMMING ───────────────────────────────────────────────

test("missing Location: Quick Create in Review; the same place repeated in the batch resolves together", async () => {
  const a = await enrich(KNIX.replace("LAVAN Chelsea", "Pier 57").replace("541 W 25th St", "25 11th Ave"));
  const b = await enrich(KNIX.replace("LAVAN Chelsea", "Pier 57").replace("541 W 25th St", "25 11th Ave").replace("Oct 17", "Oct 18"));
  assert.deepEqual(a.matches.locations, []);
  const keyA = O.operatorReviewDefaults(a.candidate, a.matches).place.matchKey;
  assert.equal(keyA, O.operatorReviewDefaults(b.candidate, b.matches).place.matchKey, "same normalized place → same key → one Quick Create serves both");
  assert.equal(keyA, T.venueKey({ name: "Pier 57", address: "25 11th Ave" }));
  assert.match(MULTI, /createAction: operator\?\.createLocation, render: operator\?\.renderLocationCreate \}\}/);
});

test("programming stays visible as 'Not Currently Saved To Findmi' evidence", () => {
  assert.match(CLIENT, /Programming · Not Currently Saved To Findmi/);
});
