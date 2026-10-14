// Unified Event Import V1 — From Link / Paste Details / Upload are three
// INPUTS to the ONE Event Import engine: each produces the same
// EventCandidate, then the same attendance / privacy / matching / Review /
// persistence. Fake clients only: no network, no database, no AI calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import sharp from "sharp";

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
const T = await import("../src/lib/event-import/text-source.ts");
const R = await import("../src/lib/event-import/review.ts");
const TY = await import("../src/lib/event-import/types.ts");
const IMG = await import("../src/lib/event-import/image-source.ts");
const read = (p) => readFileSync(p, "utf8");

const NOW = Date.parse("2026-10-01T12:00:00Z");
const KNIX = `Knix x ACOTAR Pop-Up

October 15, 2026
12 PM–8 PM

541 W 25th St
New York, NY

Join Knix and A Court of Thorns and Roses for a special one-day pop-up at LAVAN Chelsea.

Shop the limited collection, take photos and pick up a free gift.
- Exclusive prints
- Giveaways`;

const LAVAN = { id: "loc-lavan", name: "LAVAN Chelsea", address: "541 W 25th St", city: "New York", state: "NY", postal_code: "10001" };

function deps(over = {}) {
  const calls = { matchLocations: [], ai: [] };
  return {
    calls,
    fetchPage: async () => {
      throw new Error("no fetch for pasted text / images");
    },
    ai: null,
    matchEvent: async () => null,
    getEvent: async () => null,
    matchLocations: async (v) => (calls.matchLocations.push(v), []),
    matchOrganizer: async () => null,
    matchExistingAppearance: async () => null,
    findScheduledBySourceUrl: async () => null,
    findEventBySourceUrl: async () => null,
    isRateLimited: () => false,
    now: () => NOW,
    ...over,
  };
}

/** A fake Anthropic client returning `output` and recording each request. */
function fakeAi(output, log = []) {
  return { log, messages: { parse: async (req) => (log.push(req), { stop_reason: "end_turn", parsed_output: output }) } };
}
const emptyAi = { title: null, schedule: [], venue_name: null, street_address: null, city: null, state: null, postal_code: null, organizer: null, organizer_evidence: null, multiple_events: false };

// ── PASTE DETAILS ─────────────────────────────────────────────────────────

test("paste: a real caption → the SAME EventCandidate shape as From Link (no fake link, no image)", async () => {
  const r = await E.analyzeEventText({ text: KNIX, businessId: "biz", rateKey: "u" }, deps());
  assert.equal(r.ok, true);
  assert.equal(r.kind, "single");
  const c = r.candidate;
  assert.equal(c.title, "Knix x ACOTAR Pop-Up");
  assert.equal(c.origin, "text");
  assert.equal(c.sourceUrl, "", "no invented external URL");
  assert.equal(c.imageUrl, null);
  assert.equal(c.platform, null);
  // Same fields the URL path fills (EventCandidate), nothing parallel.
  for (const key of ["title", "description", "imageUrl", "sourceUrl", "platform", "occurrences", "online", "organizer", "sources", "attendance", "locationVisibility", "persistAs"]) assert.ok(key in c, key);
  const review = R.reviewDefaults(c, r.matches, "participating", "Knix");
  assert.equal(review.sourceUrl, "");
  assert.equal(review.imageUrl, null);
});

test("paste: multiline description keeps paragraphs and list lines; consumed facts are not repeated", () => {
  const { candidate } = T.extractTextEventCandidate(KNIX, { now: NOW, origin: "text" });
  assert.equal(
    candidate.description,
    "Join Knix and A Court of Thorns and Roses for a special one-day pop-up at LAVAN Chelsea.\n\nShop the limited collection, take photos and pick up a free gift.\n- Exclusive prints\n- Giveaways"
  );
  assert.doesNotMatch(candidate.description, /541 W 25th|October 15/);
});

test("paste: date + time on adjacent lines → one dated occurrence (NY time); one-line forms too", () => {
  const { candidate } = T.extractTextEventCandidate(KNIX, { now: NOW, origin: "text" });
  assert.equal(candidate.occurrences.length, 1);
  assert.deepEqual([candidate.occurrences[0].start, candidate.occurrences[0].end, candidate.occurrences[0].hasTime], ["2026-10-15T16:00:00.000Z", "2026-10-16T00:00:00.000Z", true]);
  const one = T.extractTextEventCandidate("Fall Market\nSat, Oct 17, 11am–4pm at Pier 57\nCome by!", { now: NOW, origin: "text" }).candidate;
  assert.equal(one.occurrences[0].start, "2026-10-17T15:00:00.000Z");
  assert.equal(one.occurrences[0].venue.name, "Pier 57");
  const labelled = T.extractTextEventCandidate("Fall Market\nDate: October 17, 2026\nTime: 11 AM - 4 PM\nWhere: Pier 57", { now: NOW, origin: "text" }).candidate;
  assert.equal(labelled.occurrences[0].start, "2026-10-17T15:00:00.000Z");
  assert.equal(labelled.occurrences[0].venue.name, "Pier 57");
});

test("paste: venue + address → place on the date; the EXISTING Location matcher decides (strong → pre-linked)", async () => {
  const text = KNIX.replace("541 W 25th St", "LAVAN Chelsea\n541 W 25th St");
  const d = deps({ matchLocations: async (v) => (d.calls.matchLocations.push(v), [LAVAN]) });
  const r = await E.analyzeEventText({ text, businessId: "biz", rateKey: "u" }, d);
  assert.deepEqual(r.candidate.occurrences[0].venue, { name: "LAVAN Chelsea", address: "541 W 25th St", city: "New York", state: "NY", postalCode: null });
  assert.deepEqual(d.calls.matchLocations[0], { name: "LAVAN Chelsea", address: "541 W 25th St", city: "New York", state: "NY", postal_code: null });
  assert.equal(r.matches.locations[0].confidence, "strong");
  const review = R.reviewDefaults(r.candidate, r.matches, "hosting", "Knix");
  assert.equal(review.place.useLocationId, "loc-lavan");
  assert.equal(review.place.matchDecision, "use");
  // A name-only place is a possible match only — never linked silently.
  const d2 = deps({ matchLocations: async () => [], matchPossibleLocations: async () => [LAVAN] });
  const r2 = await E.analyzeEventText({ text: "Knix Pop-Up\nOctober 15, 2026 · 12 PM–8 PM · LAVAN Chelsea", businessId: "biz", rateKey: "u" }, d2);
  assert.equal(r2.matches.locations[0].confidence, "possible");
  assert.equal(R.reviewDefaults(r2.candidate, r2.matches, "hosting", "Knix").place.useLocationId, null);
});

test("paste: organizer only when the text says so — a brand in the name is not the organizer", () => {
  assert.equal(T.extractTextEventCandidate(KNIX, { now: NOW, origin: "text" }).candidate.organizer, null);
  const hosted = T.extractTextEventCandidate(`${KNIX}\n\nHosted by Bookish Events NYC.`, { now: NOW, origin: "text" }).candidate;
  assert.equal(hosted.organizer, "Bookish Events NYC");
  assert.equal(hosted.sources.organizer, "page");
  assert.equal(T.extractTextEventCandidate(`${KNIX}\n\nhosted by our friends downtown`, { now: NOW, origin: "text" }).candidate.organizer, null);
});

test("paste: attendance evidence from the text itself (RSVP link, price, free, walk-in) — never invented", async () => {
  const rsvp = await E.analyzeEventText({ text: `${KNIX}\n\nRSVP: https://lu.ma/knix-acotar`, businessId: "b", rateKey: "u" }, deps());
  assert.deepEqual([rsvp.candidate.attendance.cta, rsvp.candidate.attendance.url], ["rsvp", "https://lu.ma/knix-acotar"]);
  assert.doesNotMatch(rsvp.candidate.description, /lu\.ma/, "the RSVP line is attendance, not description");
  assert.equal(rsvp.candidate.sourceUrl, "", "a link in the text is never made the Event's source link");
  const tickets = await E.analyzeEventText({ text: `${KNIX}\n\nTickets: $25\nGet tickets at https://tix.example.com/knix`, businessId: "b", rateKey: "u" }, deps());
  assert.deepEqual([tickets.candidate.attendance.cta, tickets.candidate.attendance.pricing, tickets.candidate.attendance.price], ["tickets", "paid", "$25"]);
  const walkIn = await E.analyzeEventText({ text: `${KNIX}\n\nFree\nNo RSVP required.`, businessId: "b", rateKey: "u" }, deps());
  assert.deepEqual([walkIn.candidate.attendance.cta, walkIn.candidate.attendance.pricing, walkIn.candidate.attendance.registration], [null, "free", "not_required"]);
  const none = await E.analyzeEventText({ text: `${KNIX}\n\nRSVP at the link in our bio`, businessId: "b", rateKey: "u" }, deps());
  assert.deepEqual([none.candidate.attendance.cta, none.candidate.attendance.url, none.candidate.attendance.pricing], [null, null, "unknown"]);
});

test("paste: missing/ambiguous fields stay unresolved for Review; nothing usable → plain error", async () => {
  const noPlace = await E.analyzeEventText({ text: "Knix x ACOTAR Pop-Up\nOctober 15, 2026\n12 PM–8 PM", businessId: "b", rateKey: "u" }, deps());
  assert.ok(noPlace.ok);
  assert.ok(noPlace.warnings.includes("We couldn't find where it's happening. Add the place below."));
  assert.equal(noPlace.candidate.locationVisibility, "none");
  const noDate = await E.analyzeEventText({ text: "Knix x ACOTAR Pop-Up\n541 W 25th St\nNew York, NY\nComing soon!", businessId: "b", rateKey: "u" }, deps());
  assert.ok(noDate.ok);
  assert.equal(noDate.candidate.occurrences.length, 0);
  assert.equal(noDate.candidate.place.address, "541 W 25th St", "a stated place survives without a date");
  assert.equal(R.reviewDefaults(noDate.candidate, noDate.matches, "hosting", "X").place.address, "541 W 25th St");
  assert.ok(noDate.warnings.includes("We couldn't find a date. Add it below."));
  // "12–8" without am/pm is ambiguous: the date is kept, the time is not guessed.
  const ambiguous = T.extractTextEventCandidate("KNIX x ACOTAR\nOCT 15\n12–8\nLAVAN CHELSEA\n541 W 25TH STREET", { now: NOW, origin: "image" }).candidate;
  assert.deepEqual([ambiguous.occurrences[0].start, ambiguous.occurrences[0].hasTime], ["2026-10-15", false]);
  assert.deepEqual(await E.analyzeEventText({ text: "Love this so much, can't wait!!", businessId: "b", rateKey: "u" }, deps()), { ok: false, code: "text_no_event" });
  assert.deepEqual(await E.analyzeEventText({ text: "hi", businessId: "b", rateKey: "u" }, deps()), { ok: false, code: "text_no_event" });
  assert.deepEqual(await E.analyzeEventText({ text: "x".repeat(12001), businessId: "b", rateKey: "u" }, deps()), { ok: false, code: "text_too_long" });
});

test("paste: multiple separate Events are never merged into one", async () => {
  const two = "Knix x ACOTAR Pop-Up Party\nOctober 15, 2026 · 12 PM–8 PM · LAVAN Chelsea\n\nFall Book Swap Brunch\nOctober 18, 2026 · 11 AM–2 PM · Pier 57";
  assert.deepEqual(await E.analyzeEventText({ text: two, businessId: "b", rateKey: "u" }, deps()), { ok: false, code: "multiple_events" });
  // One Event with several dates/stops is still ONE Event.
  const tour = "Knix Pop-Up Tour\n\nNYC\nOctober 15, 2026 · 12 PM–8 PM · LAVAN Chelsea\n\nBoston\nOctober 22, 2026 · 12 PM–8 PM · The Lot";
  const r = await E.analyzeEventText({ text: tour, businessId: "b", rateKey: "u" }, deps());
  assert.equal(r.ok, true);
  assert.equal(r.candidate.occurrences.length, 2);
  // The grounded reading may also flag it.
  const ai = fakeAi({ ...emptyAi, multiple_events: true });
  assert.deepEqual(await E.analyzeEventText({ text: "Two things this week\nCome to both!\nMore soon", businessId: "b", rateKey: "u" }, deps({ ai })), { ok: false, code: "multiple_events" });
});

test("paste: the grounded AI reading fills only missing fields, and only with values the text supports", async () => {
  const log = [];
  const ai = fakeAi(
    {
      ...emptyAi,
      title: "Totally Different Title",
      venue_name: "LAVAN Chelsea",
      street_address: "541 W 25th St",
      organizer: "Knix",
      organizer_evidence: "Join Knix",
    },
    log
  );
  const r = await E.analyzeEventText({ text: KNIX, businessId: "b", rateKey: "u" }, deps({ ai }));
  assert.equal(log.length, 1, "called because the venue name was missing");
  assert.match(JSON.stringify(log[0].messages), /pasted_text/);
  assert.equal(r.candidate.title, "Knix x ACOTAR Pop-Up", "deterministic name kept");
  assert.equal(r.candidate.occurrences[0].venue.name, "LAVAN Chelsea", "evidenced venue name filled");
  assert.equal(r.candidate.sources.venue, "ai");
  assert.equal(r.candidate.organizer, null, "a featured brand is not the organizer");
  // An invented place is dropped by the sanitizer.
  const invented = fakeAi({ ...emptyAi, venue_name: "Madison Square Garden", city: "Miami" });
  const r2 = await E.analyzeEventText({ text: "Knix x ACOTAR Pop-Up\nOctober 15, 2026\n12 PM–8 PM", businessId: "b", rateKey: "u" }, deps({ ai: invented }));
  assert.equal(r2.candidate.occurrences[0].venue.name, null);
  assert.equal(r2.candidate.occurrences[0].venue.city, null);
  // AI is never asked for attendance; the text's own wording decides it.
  assert.doesNotMatch(read("src/lib/event-import/ai.ts"), /attendance|ticket|rsvp|price/i);
});

test("paste: rate limiting is the existing per-person Event Import limit", async () => {
  assert.deepEqual(await E.analyzeEventText({ text: KNIX, businessId: "b", rateKey: "u" }, deps({ isRateLimited: () => true })), { ok: false, code: "rate_limited" });
  const actions = read("src/app/(public)/account/business/[id]/import-event/actions.ts");
  assert.match(actions, /analyzeEventText\(\{ text: typeof text === "string" \? text : "", businessId, rateKey: ctx\.user\.id \}, defaultEventImportDeps\(ctx\.admin\)\)/);
  assert.match(actions, /analyzeEventImage\(\{ image: image\.image, businessId, rateKey: ctx\.user\.id \}, defaultEventImportDeps\(ctx\.admin\)\)/);
  assert.match(read("src/lib/event-import/engine.ts"), /isRateLimited: \(key\) => recordEventImportAnalysis\(key\)/);
});

test("paste: location privacy — 'address shared after registration' → hidden; no street/venue kept or matched", async () => {
  const d = deps();
  const text = "Secret Supper Club\nOctober 20, 2026 · 7 PM–10 PM\nThe Loft\n12 Mercer St\nNew York, NY\nAddress shared after registration.\nRegister: https://lu.ma/supper";
  const r = await E.analyzeEventText({ text, businessId: "b", rateKey: "u" }, d);
  assert.equal(r.candidate.locationVisibility, "hidden");
  assert.deepEqual(r.candidate.occurrences[0].venue, { name: null, address: null, postalCode: null, city: "New York", state: "NY" });
  assert.equal(d.calls.matchLocations.length, 0, "no Location is matched for a withheld address");
  assert.equal(R.reviewDefaults(r.candidate, r.matches, "hosting", "X").locationVisibility, "hidden");
  assert.deepEqual([r.candidate.attendance.cta, r.candidate.attendance.url], ["register", "https://lu.ma/supper"]);
});

// ── UPLOAD ────────────────────────────────────────────────────────────────

const png = await sharp({ create: { width: 400, height: 500, channels: 3, background: "#14B0BC" } }).png().toBuffer();
const jpg = await sharp({ create: { width: 400, height: 500, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
const webp = await sharp({ create: { width: 400, height: 500, channels: 3, background: "#000000" } }).webp().toBuffer();
const gif = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#000000" } }).gif().toBuffer();

test("upload: JPG, PNG and WebP accepted (by their real bytes); anything else refused with plain copy", async () => {
  for (const [buf, type, name] of [[png, "image/png", "flyer.png"], [jpg, "image/jpeg", "flyer.jpg"], [webp, "image/webp", "flyer.webp"]]) {
    const r = await IMG.readEventImportImage(new File([buf], name, { type }));
    assert.equal(r.ok, true, name);
    assert.equal(r.image.mediaType, type);
    assert.equal(r.image.base64, buf.toString("base64"));
  }
  // A JPEG mislabeled as .png is read as what it really is.
  assert.equal((await IMG.readEventImportImage(new File([jpg], "x.png", { type: "image/png" }))).image.mediaType, "image/jpeg");
  assert.deepEqual(await IMG.readEventImportImage(new File([gif], "a.gif", { type: "image/gif" })), { ok: false, code: "unsupported_image" });
  assert.deepEqual(await IMG.readEventImportImage(new File(["<svg/>"], "a.svg", { type: "image/svg+xml" })), { ok: false, code: "unsupported_image" });
  assert.deepEqual(await IMG.readEventImportImage(new File(["%PDF-1.4"], "a.pdf", { type: "application/pdf" })), { ok: false, code: "unsupported_image" });
  assert.deepEqual(await IMG.readEventImportImage(null), { ok: false, code: "unsupported_image" });
  assert.deepEqual(await IMG.readEventImportImage(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" })), { ok: false, code: "image_too_large" });
  assert.equal(TY.EVENT_IMPORT_FAILURE_COPY.unsupported_image, "Upload a JPG, PNG or WebP image.");
  assert.equal(TY.EVENT_IMPORT_IMAGE_ACCEPT, "image/jpeg,image/png,image/webp");
});

const FLYER_TEXT = "KNIX x ACOTAR\nONE DAY POP-UP\nOCT 15\n12–8\nLAVAN CHELSEA\n541 W 25TH STREET";

test("upload: the image reaches the multimodal reading; its visible text → the SAME EventCandidate shape", async () => {
  const log = [];
  const ai = fakeAi(
    {
      ...emptyAi,
      visible_text: FLYER_TEXT,
      schedule: [{ evidence: "OCT 15\n12–8", date: "2026-10-15", start_time: "12:00", end_time: "20:00", venue_name: null, street_address: null }],
    },
    log
  );
  const image = { mediaType: "image/png", base64: png.toString("base64") };
  const r = await E.analyzeEventImage({ image, businessId: "biz", rateKey: "u" }, deps({ ai }));
  assert.equal(log.length, 1);
  const content = log[0].messages[0].content;
  assert.deepEqual(content[0], { type: "image", source: { type: "base64", media_type: "image/png", data: image.base64 } });
  assert.equal(r.ok, true);
  const c = r.candidate;
  assert.equal(c.origin, "image");
  assert.equal(c.title, "KNIX x ACOTAR");
  assert.deepEqual(c.occurrences[0].venue, { name: "LAVAN CHELSEA", address: "541 W 25TH STREET", city: null, state: null, postalCode: null });
  // The evidenced time on the same date ("12–8") is used; nothing else.
  assert.deepEqual([c.occurrences[0].start, c.occurrences[0].end], ["2026-10-15T16:00:00.000Z", "2026-10-16T00:00:00.000Z"]);
  const text = await E.analyzeEventText({ text: KNIX, businessId: "biz", rateKey: "u" }, deps());
  assert.deepEqual(Object.keys(c).sort(), Object.keys(text.candidate).sort(), "same candidate shape as Paste Details");
});

test("upload: facts not visible in the image are dropped; the image is never the Event cover", async () => {
  const ai = fakeAi({
    ...emptyAi,
    visible_text: FLYER_TEXT,
    title: "Knix Holiday Gala",
    organizer: "Knix",
    organizer_evidence: "presented by Knix",
    city: "Brooklyn",
    schedule: [{ evidence: "Dec 31, 9pm", date: "2026-12-31", start_time: "21:00", end_time: null, venue_name: null, street_address: null }],
  });
  const r = await E.analyzeEventImage({ image: { mediaType: "image/jpeg", base64: jpg.toString("base64") }, businessId: "b", rateKey: "u" }, deps({ ai }));
  assert.equal(r.candidate.title, "KNIX x ACOTAR");
  assert.equal(r.candidate.organizer, null);
  assert.equal(r.candidate.occurrences[0].venue.city, null);
  assert.deepEqual(r.candidate.occurrences.map((o) => o.start), ["2026-10-15"], "a date not on the flyer is never added");
  assert.equal(r.candidate.imageUrl, null, "evidence only — not the Event's image");
  assert.equal(R.reviewDefaults(r.candidate, r.matches, "hosting", "Knix").imageUrl, null);
  assert.doesNotMatch(read("src/lib/event-import/image-source.ts").replace(/\/\/.*$/gm, ""), /storage|storePublicImage|upload\(/i, "the uploaded image is never stored");
  const ui = read("src/app/(public)/account/business/[id]/import-event/EventImporter.tsx");
  assert.match(ui, /candidate\.origin === "image" && !joiningExisting[\s\S]{0,260}won&rsquo;t be shown as the Event image/);
});

test("upload: failures are safe and readable (no AI, unreadable image, multiple Events)", async () => {
  const image = { mediaType: "image/png", base64: png.toString("base64") };
  assert.deepEqual(await E.analyzeEventImage({ image, businessId: "b", rateKey: "u" }, deps({ ai: null })), { ok: false, code: "image_unavailable" });
  const blank = fakeAi({ ...emptyAi, visible_text: "" });
  assert.deepEqual(await E.analyzeEventImage({ image, businessId: "b", rateKey: "u" }, deps({ ai: blank })), { ok: false, code: "image_no_event" });
  const failing = { messages: { parse: async () => { throw new Error("upstream 529 overloaded secret-key"); } } };
  assert.deepEqual(await E.analyzeEventImage({ image, businessId: "b", rateKey: "u" }, deps({ ai: failing })), { ok: false, code: "image_no_event" });
  const multi = fakeAi({ ...emptyAi, visible_text: FLYER_TEXT, multiple_events: true });
  assert.deepEqual(await E.analyzeEventImage({ image, businessId: "b", rateKey: "u" }, deps({ ai: multi })), { ok: false, code: "multiple_events" });
  const scenery = fakeAi({ ...emptyAi, visible_text: "Welcome" });
  assert.deepEqual(await E.analyzeEventImage({ image, businessId: "b", rateKey: "u" }, deps({ ai: scenery })), { ok: false, code: "image_no_event" });
  assert.deepEqual(await E.analyzeEventImage({ image, businessId: "b", rateKey: "u" }, deps({ ai: multi, isRateLimited: () => true })), { ok: false, code: "rate_limited" });
  for (const code of ["text_no_event", "text_too_long", "image_no_event", "unsupported_image", "image_too_large", "image_unavailable", "multiple_events"]) {
    assert.ok(TY.EVENT_IMPORT_FAILURE_COPY[code], code);
    assert.doesNotMatch(TY.EVENT_IMPORT_FAILURE_COPY[code], /error|stack|anthropic|claude|api|http|null/i, code);
  }
  assert.equal(TY.EVENT_IMPORT_FAILURE_COPY.multiple_events, "This looks like it contains multiple Events. Try one Event at a time.");
  assert.match(TY.EVENT_IMPORT_FAILURE_COPY.text_no_event, /^We couldn't find enough Event information in that text\./);
  assert.equal(TY.EVENT_IMPORT_FAILURE_COPY.image_no_event, "We couldn't find enough Event information in that image.");
});

// ── SHARED PIPELINE ───────────────────────────────────────────────────────

test("shared: three inputs, one engine, one Review, one save path", () => {
  const actions = read("src/app/(public)/account/business/[id]/import-event/actions.ts");
  for (const fn of ["analyzeEventImport", "analyzeEventImportText", "analyzeEventImportImage"]) {
    const i = actions.indexOf(`export async function ${fn}(`);
    assert.ok(i > 0, fn);
    const body = actions.slice(i, actions.indexOf("\n}\n", i));
    assert.match(body, /const ctx = await authorize\(businessId\);/, `${fn} authorizes`);
    assert.match(body, /publicImportAnalysis\(/, `${fn} never exposes diagnostics`);
  }
  // Exactly one commit path (single + batch) — no paste/upload persistence.
  assert.equal(actions.match(/persistEventImport\(/g).length, 1);
  const ui = read("src/app/(public)/account/business/[id]/import-event/EventImporter.tsx");
  assert.match(ui, /\{ key: "link", label: "From Link" \},\s*\{ key: "text", label: "Paste Details" \},\s*\{ key: "image", label: "Upload" \}/);
  assert.match(ui, />Import Event</);
  assert.match(ui, /if \(method === "link"\) showAnalysis\(await analyzeEventImport\(businessId, url\)\);\s*else if \(method === "text"\) showAnalysis\(await analyzeEventImportText\(businessId, pasted\)\);/);
  assert.match(ui, /showAnalysis\(await analyzeEventImportImage\(businessId, form\)\)/);
  assert.equal(ui.match(/setStep\(\{ kind: "review"/g).length, 1, "one Review for every input");
  assert.equal(ui.match(/commitEventImport\(/g).length, 1, "one save");
  assert.match(ui, /<WhenWhereEditor key=\{reviewVersion\} review=\{review\} set=\{set\} matches=\{matches\} initialPast=\{initialPast\} \/>/);
  assert.doesNotMatch(read("src/lib/event-import/text-source.ts"), /from\(|\.insert\(|\.update\(|fetch\(/, "the text adapter is pure");
  // Entry points now say Import Event.
  assert.match(read("src/app/(public)/account/event/new/page.tsx"), /import-event\?intent=hosting`\} className=\{`mt-3 \$\{primaryButtonClass\}`\}>\s*Import Event/);
});

test("shared: From Link still runs the existing URL engine unchanged", async () => {
  const engine = read("src/lib/event-import/engine.ts");
  const url = engine.slice(engine.indexOf("export async function analyzeEventUrl"), engine.indexOf("// ── Paste Details / Upload"));
  assert.match(url, /const source = classifySource\(page\.html, page\.url, now\);/, "calendar / multi-Event detection");
  assert.match(url, /if \(needsAiAssist\(candidate\)\) candidate = \(await assistWithAi\(/);
  assert.match(url, /isLumaEventUrl\(candidate\.sourceUrl\)/);
  assert.doesNotMatch(url, /text-source|extractTextEventCandidate|readEventTextWithAi/);
});

test("shared: participating vs hosting semantics are the flow's, never inferred from the text", async () => {
  const text = `${KNIX}\n\nHosted by Knix.`;
  const r = await E.analyzeEventText({ text, businessId: "biz", rateKey: "u" }, deps());
  assert.equal(r.candidate.organizer, "Knix");
  // Where I'll Be: the Business participates — its own name as a (text)
  // organizer is not carried over as someone else's organizer.
  const participating = R.reviewDefaults(r.candidate, r.matches, "participating", "Knix");
  assert.equal(participating.intent, "participating");
  assert.equal(participating.organizer, null);
  // Without a source link, a participating import stays a schedule item
  // (the existing save rule); hosting creates the Business's own Event.
  assert.equal(r.candidate.persistAs, "schedule_item");
  assert.equal(participating.asEvent, false);
  const hosting = R.reviewDefaults(r.candidate, r.matches, "hosting", "Knix");
  assert.equal(hosting.intent, "hosting");
  // A brand on a flyer never makes it the host: intent comes from the entry point only.
  assert.doesNotMatch(read("src/lib/event-import/text-source.ts"), /intent|host_business_id|hosting/);
});
