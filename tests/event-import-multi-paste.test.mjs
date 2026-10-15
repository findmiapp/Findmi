// Paste Details → several explicitly marked Events (EVENT n … === END
// EVENT n ===) → the EXISTING several-Events Review (kind "multi"). Each
// Event is read by the unchanged one-Event Paste Details path and matched
// on its own. Fakes only — no network, no database, no AI unless faked.
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
const S = await import("../src/lib/event-import/paste-segments.ts");
const TY = await import("../src/lib/event-import/types.ts");
const D = await import("../src/lib/event-import/diagnostics.ts");
const R = await import("../src/lib/event-import/review.ts");
const read = (p) => readFileSync(p, "utf8");

const NOW = Date.parse("2026-10-01T12:00:00Z");
function deps(over = {}) {
  const calls = { matchLocations: [], rate: 0, ai: 0 };
  return {
    calls,
    fetchPage: async () => {
      throw new Error("never fetched");
    },
    ai: null,
    matchEvent: async () => null,
    getEvent: async () => null,
    matchLocations: async (v) => (calls.matchLocations.push(v), v.name === "LAVAN Chelsea" ? [{ id: "loc-lavan", name: "LAVAN Chelsea", address: "541 W 25th St", city: "New York", state: "NY", postal_code: "10001" }] : []),
    matchOrganizer: async () => null,
    matchExistingAppearance: async () => null,
    findScheduledBySourceUrl: async () => null,
    findEventBySourceUrl: async () => null,
    isRateLimited: () => ((calls.rate += 1), false),
    now: () => NOW,
    ...over,
  };
}

const EV = {
  knix: `Knix x ACOTAR Pop-Up\n\nOctober 15, 2026\n12 PM–8 PM\n\nLAVAN Chelsea\n541 W 25th St\nNew York, NY\n\nShop the limited collection.`,
  swap: `Fall Book Swap Brunch\n\nOctober 18, 2026\n11 AM–2 PM\n\nPier 57\n25 11th Ave\nNew York, NY`,
  run: `Corgi Run Club\n\nOctober 24, 2026\n9 AM–11 AM\n\nThe Glasshouse\n660 12th Avenue\nNew York, NY`,
};
const block = (n, body) => `EVENT ${n}\n\n${body}\n\n=== END EVENT ${n} ===`;
const paste = (...bodies) => bodies.map((b, i) => block(i + 1, b)).join("\n\n");
const analyze = (text, d = deps()) => E.analyzeEventText({ text, businessId: "biz", rateKey: "u" }, d);

// ── SEGMENTATION ──────────────────────────────────────────────────────────

test("A + B. three marked Events → one multi result with three independent Events", async () => {
  const d = deps();
  const r = await analyze(paste(EV.knix, EV.swap, EV.run), d);
  assert.equal(r.ok, true);
  assert.equal(r.kind, "multi");
  assert.deepEqual(r.source, { url: "", name: "Pasted Details", platform: null });
  assert.deepEqual(r.events.map((e) => e.key), ["pasted-event-1", "pasted-event-2", "pasted-event-3"]);
  assert.deepEqual(r.events.map((e) => e.candidate.title), ["Knix x ACOTAR Pop-Up", "Fall Book Swap Brunch", "Corgi Run Club"]);
  assert.deepEqual(r.events.map((e) => e.candidate.occurrences[0].start.slice(0, 10)), ["2026-10-15", "2026-10-18", "2026-10-24"]);
  assert.ok(r.events.every((e) => e.candidate.occurrences[0].hasTime), "each keeps its own time");
  assert.deepEqual(r.events.map((e) => e.candidate.occurrences[0].venue.address), ["541 W 25th St", "25 11th Ave", "660 12th Avenue"]);
  assert.ok(r.events.every((e) => !e.past && e.alreadyOnSchedule === null));
  assert.equal(d.calls.rate, 1, "one paste = one request against the per-person limit");
});

test("I. Location matching stays attached to each Event independently", async () => {
  const r = await analyze(paste(EV.knix, EV.swap, EV.run));
  const [knix, swap] = r.events;
  assert.equal(knix.matches.locations.length, 1);
  assert.equal(knix.matches.locations[0].id, "loc-lavan");
  assert.deepEqual(swap.matches.locations, [], "no match leaks to another Event");
  // …and each row still feeds the existing Review defaults (strong match pre-linked).
  const rv = R.reviewDefaults(knix.candidate, knix.matches, "participating", "Biz");
  assert.equal(rv.place.useLocationId, "loc-lavan");
});

test("C. an ordinary one-Event paste (and a single marked Event) stays a single result", async () => {
  const plain = await analyze(EV.knix);
  assert.equal(plain.ok, true);
  assert.equal(plain.kind, "single");
  const one = await analyze(block(1, EV.knix));
  assert.equal(one.kind, "single");
  assert.equal(one.candidate.title, "Knix x ACOTAR Pop-Up", "the markers are not read as details");
});

test("D. unmarked text with several Events still gets the existing multiple-Events refusal", async () => {
  const two = "Knix x ACOTAR Pop-Up Party\nOctober 15, 2026 · 12 PM–8 PM · LAVAN Chelsea\n\nFall Book Swap Brunch\nOctober 18, 2026 · 11 AM–2 PM · Pier 57";
  assert.deepEqual(await analyze(two), { ok: false, code: "multiple_events" });
  // "Event 1:" prose labels are NOT the explicit markers.
  assert.equal(S.splitPastedEvents("Event 1: Brunch Oct 5\nEvent 2: Party Oct 6").kind, "none");
});

test("E. 26 marked Events → a clean max-25 rejection, nothing truncated", async () => {
  const bodies = Array.from({ length: 26 }, (_, i) => `Pop-Up Number ${i + 1}\nOctober ${(i % 28) + 1}, 2026\n12 PM–8 PM\nSome Hall\n${i + 10} Main St\nNew York, NY`);
  const r = await analyze(paste(...bodies));
  assert.deepEqual(r, { ok: false, code: "too_many_events", detail: "This paste has 26 Events." });
  assert.equal(TY.EVENT_IMPORT_FAILURE_COPY.too_many_events, "You can import up to 25 Events at a time.");
  assert.equal(S.PASTE_MAX_EVENTS, 25);
  // 25 is fine (structure only).
  const ok = S.splitPastedEvents(paste(...bodies.slice(0, 25)));
  assert.equal(ok.kind, "segments");
  assert.equal(ok.segments.length, 25);
});

test("F. malformed explicit segmentation is rejected with the Event it concerns — never merged or dropped", () => {
  const cases = [
    [`EVENT 1\n${EV.knix}\n\nEVENT 2\n${EV.swap}\n=== END EVENT 2 ===`, /EVENT 1 needs its "=== END EVENT 1 ===" line before EVENT 2 starts/],
    [`${block(1, EV.knix)}\n\nEVENT 2\n${EV.swap}`, /EVENT 2 needs an "=== END EVENT 2 ===" line/],
    [`${block(1, EV.knix)}\n\nEVENT 2\n${EV.swap}\n=== END EVENT 3 ===`, /EVENT 2 ends with "END EVENT 3"/],
    [`${block(1, EV.knix)}\n\nstray notes here\n\n${block(2, EV.swap)}`, /text after "=== END EVENT 1 ===" that isn't inside an Event/],
    [`Here are my events:\n\n${block(1, EV.knix)}\n\n${block(2, EV.swap)}`, /text before the first EVENT line/],
    [`${block(1, EV.knix)}\n\n${block(1, EV.swap)}`, /EVENT 1 appears more than once/],
    [`${EV.knix}\n=== END EVENT 1 ===`, /text before the first EVENT line/],
  ];
  for (const [text, message] of cases) {
    const r = S.splitPastedEvents(text);
    assert.equal(r.kind, "error", String(message));
    assert.equal(r.code, "paste_malformed");
    assert.match(r.detail, message);
  }
});

test("G. empty / whitespace-only Events fail safely", async () => {
  const r = await analyze(`${block(1, EV.knix)}\n\nEVENT 2\n   \n\n=== END EVENT 2 ===`);
  assert.equal(r.ok, false);
  assert.equal(r.code, "paste_malformed");
  assert.equal(r.detail, "EVENT 2 is empty.");
});

test("an unreadable Event is never silently dropped: the others still reach Review, and a warning names it", async () => {
  const r = await analyze(paste(EV.knix, "Can't wait for this one!!! See you all there, it will be so much fun", EV.run));
  assert.equal(r.kind, "multi");
  assert.deepEqual(r.events.map((e) => e.key), ["pasted-event-1", "pasted-event-3"]);
  assert.ok(r.warnings.some((w) => /^EVENT 2 couldn't be read/.test(w)));
  // Nothing readable at all → the whole paste fails, naming each Event.
  const none = await analyze(paste("so excited!!! see you there friends", "omg best weekend ever honestly"));
  assert.equal(none.ok, false);
  assert.equal(none.code, "paste_no_events");
  assert.match(none.detail, /EVENT 1 couldn't be read.*EVENT 2 couldn't be read/);
});

test("a marked Event that is itself several Events is refused for that Event (the existing protection still applies)", async () => {
  const twoInOne = "Knix x ACOTAR Pop-Up Party\nOctober 15, 2026 · 12 PM–8 PM · LAVAN Chelsea\n\nFall Book Swap Brunch\nOctober 18, 2026 · 11 AM–2 PM · Pier 57";
  const r = await analyze(paste(EV.run, twoInOne));
  assert.equal(r.kind, "multi");
  assert.deepEqual(r.events.map((e) => e.key), ["pasted-event-1"]);
  assert.ok(r.warnings.some((w) => w === "EVENT 2 couldn't be read (it looks like more than one Event). Fix it and paste it again."));
});

test("size: the whole paste may be up to 60,000 characters; the AI assist is still per Event and bounded", async () => {
  const T = await import("../src/lib/event-import/text-source.ts");
  assert.equal(T.PASTE_MAX_CHARS, 60_000);
  assert.match(read("src/app/(public)/account/business/[id]/import-event/EventImporter.tsx"), /const PASTE_MAX = 60000;/);
  assert.deepEqual(await analyze("x".repeat(60_001)), { ok: false, code: "text_too_long" });
  // A fake AI is consulted only for an Event whose deterministic reading is incomplete.
  let calls = 0;
  const ai = { messages: { parse: async () => ((calls += 1), { stop_reason: "end_turn", parsed_output: null }) } };
  await analyze(paste(EV.knix, EV.swap), deps({ ai }));
  assert.equal(calls, 0, "complete Events need no AI");
  const engine = read("src/lib/event-import/engine.ts");
  assert.match(engine, /const allowAi = Date\.now\(\) - started \+ EVENT_AI_TIMEOUT_MS <= PASTE_AI_WINDOW_MS;/);
  assert.match(engine, /const PASTE_CONCURRENCY = 5;/);
});

// ── UI / CONTRACT ─────────────────────────────────────────────────────────

test("H. the several-Events Review shows a pasted source without any link; the importer routes multi to it", () => {
  const multi = read("src/app/(public)/account/business/[id]/import-event/MultiEventImport.tsx");
  assert.doesNotMatch(multi, /source\.url/, "the source URL is never rendered (no empty or broken link)");
  assert.match(multi, /\{source\.name \? ` from \$\{source\.name\}` : " from this page"\}/, "→ “from Pasted Details”");
  const importer = read("src/app/(public)/account/business/[id]/import-event/EventImporter.tsx");
  assert.match(importer, /if \(result\.kind === "multi"\) \{[\s\S]{0,200}setStep\(\{ kind: "multi", source: result\.source, events: result\.events, warnings: result\.warnings \}\);/);
  assert.match(importer, /error: result\.detail \? `\$\{EVENT_IMPORT_FAILURE_COPY\[result\.code\]\} \$\{result\.detail\}` : EVENT_IMPORT_FAILURE_COPY\[result\.code\]/);
  // The user-safe detail survives the consumer filter; admin diagnostics don't.
  assert.deepEqual(D.publicImportAnalysis({ ok: false, code: "paste_malformed", detail: "EVENT 2 is empty.", fetch: { status: 500 } }), { ok: false, code: "paste_malformed", detail: "EVENT 2 is empty." });
  assert.deepEqual(D.publicImportAnalysis({ ok: false, code: "server" }), { ok: false, code: "server" });
});
