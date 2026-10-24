// The pure rules behind guest Moment draft restore/merge/persist
// (lib/guest-moment-session.ts). The component-level lifecycle that uses
// them is exercised end to end in tests/guest-moment-reload.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const S = await import("../src/lib/guest-moment-session.ts");
const D = await import("../src/lib/guest-moment-draft.ts");
const { emptyMomentInitial } = await import("../src/lib/moment-composer.ts");

const EVENT = { value: "ev-1", label: "Spring Pop-Up", origin: "where", occurrence: { id: "occ-1", event_id: "ev-1", start_at: null, end_at: null, timezone: "UTC", location_id: null } };
const eventInitial = () => {
  const i = emptyMomentInitial();
  i.events = [EVENT];
  i.title = "Spring Pop-Up";
  i.entryDate = "2026-05-02";
  i.entryTime = "13:00";
  return i;
};
const draftWith = (patch = {}) => ({ ...D.emptyGuestMomentDraft(), ...patch });

test("a cold start is context-free; any prefill makes it contextual", () => {
  assert.equal(S.isColdInitial(emptyMomentInitial()), true);
  assert.equal(S.isColdInitial(eventInitial()), false);
});

test("a bare cold/prefill start is NOT a draft; the first real edit is; and once persisted, everything persists", () => {
  const cold = emptyMomentInitial();
  const base = S.snapshotSignature(S.snapshotFromInitial(cold));
  assert.equal(S.shouldPersistSnapshot(S.snapshotFromInitial(cold), base, false), false, "opening the composer writes nothing");
  assert.equal(S.shouldPersistSnapshot({ ...S.snapshotFromInitial(cold), title: "x" }, base, false), true, "first meaningful edit");
  assert.equal(S.shouldPersistSnapshot(S.snapshotFromInitial(cold), base, true), true, "after the first write, even a return-to-baseline edit is saved");
  const ev = eventInitial();
  assert.equal(S.shouldPersistSnapshot(S.snapshotFromInitial(ev), S.snapshotSignature(S.snapshotFromInitial(ev)), false), false, "an Event prefill alone is not a draft");
});

test("every preserved field changes the signature (title, story, date, time, location, manual place, events, businesses, products, photos, cover, caption)", () => {
  const base = S.snapshotFromInitial(emptyMomentInitial());
  const sig = S.snapshotSignature(base);
  const variants = [
    { title: "t" }, { notes: "n" }, { entryDate: "2000-01-01" }, { entryTime: "09:00" },
    { location: { value: "l", label: "L" } },
    { manual: { ...base.manual, city: "Austin" } },
    { events: [EVENT] },
    { businesses: [{ value: "b", label: "B" }] },
    { products: [{ value: "p", label: "P" }] },
    { media: [{ localId: "m1", isCover: false, caption: null }] },
  ];
  for (const v of variants) assert.notEqual(S.snapshotSignature({ ...base, ...v }), sig, JSON.stringify(Object.keys(v)));
  const m = { ...base, media: [{ localId: "m1", isCover: false, caption: null }] };
  assert.notEqual(S.snapshotSignature({ ...m, media: [{ localId: "m1", isCover: true, caption: null }] }), S.snapshotSignature(m), "cover");
  assert.notEqual(S.snapshotSignature({ ...m, media: [{ localId: "m1", isCover: false, caption: "c" }] }), S.snapshotSignature(m), "caption");
  assert.notEqual(
    S.snapshotSignature({ ...m, media: [{ localId: "a", isCover: false, caption: null }, { localId: "b", isCover: false, caption: null }] }),
    S.snapshotSignature({ ...m, media: [{ localId: "b", isCover: false, caption: null }, { localId: "a", isCover: false, caption: null }] }),
    "photo order"
  );
});

test("precedence: the draft wins; URL context only FILLS what is missing", () => {
  const draft = draftWith({ title: "My Words", notes: "Mine", entryDate: "2026-04-01", entryTime: "08:00" });
  const merged = S.mergeContextIntoDraft(draft, eventInitial());
  assert.equal(merged.title, "My Words");
  assert.equal(merged.notes, "Mine");
  assert.equal(merged.entryDate, "2026-04-01", "user-anchored date is kept");
  assert.deepEqual(merged.events.map((e) => e.value), ["ev-1"], "missing Event is added");
});

test("a prefill-only draft takes the URL's title/date/time; an empty draft never blocks context", () => {
  const merged = S.mergeContextIntoDraft(draftWith(), eventInitial());
  assert.equal(merged.title, "Spring Pop-Up");
  assert.equal(merged.entryDate, "2026-05-02");
  assert.equal(merged.entryTime, "13:00");
});

test("merge never duplicates: same Event stays once (and gains a missing occurrence); Business/Product union by id; draft Location is kept", () => {
  const draft = draftWith({
    notes: "x",
    events: [{ ...EVENT, occurrence: null }],
    businesses: [{ value: "b1", label: "One" }],
    location: { value: "mine", label: "My Place" },
  });
  const initial = eventInitial();
  initial.businesses = [{ value: "b1", label: "One" }, { value: "b2", label: "Two" }];
  initial.products = [{ value: "p1", label: "P" }];
  initial.location = { value: "theirs", label: "Their Place" };
  const merged = S.mergeContextIntoDraft(draft, initial);
  assert.equal(merged.events.length, 1);
  assert.equal(merged.events[0].occurrence.id, "occ-1");
  assert.deepEqual(merged.businesses.map((b) => b.value), ["b1", "b2"]);
  assert.deepEqual(merged.products.map((p) => p.value), ["p1"]);
  assert.equal(merged.location.value, "mine");
});

test("a described (manual) place is never replaced by the URL's Location", () => {
  const draft = draftWith({ manual: { name: "Corner stall", address: "", city: "", state: "", zip: "", suggest: false } });
  const initial = eventInitial();
  initial.location = { value: "loc", label: "Venue" };
  assert.equal(S.mergeContextIntoDraft(draft, initial).location, null);
});

test("a cold URL leaves the draft untouched", () => {
  const draft = draftWith({ title: "Keep" });
  assert.equal(S.mergeContextIntoDraft(draft, emptyMomentInitial()), draft);
});

test("startup decisions: guests restore the SAME Moment, are asked before a different context is mixed in; signed in converts ONLY on a cold resume round-trip, offers on a cold plain load, leaves a contextual load alone", () => {
  const draft = draftWith({ title: "d" });
  const cold = emptyMomentInitial();
  const ev = eventInitial();
  const d = (o) => S.decideGuestStartup({ authed: false, resume: false, initial: cold, draft, ...o }).kind;
  assert.equal(d({ draft: null }), "none");
  assert.equal(d({}), "restore", "guest, cold");
  // UX consolidation: a draft for a different context is never silently
  // merged with the newly opened Event — the guest chooses.
  assert.equal(d({ initial: ev }), "switch", "guest, a different (Event) context");
  // Reloading the Event-connected composer (the original Production bug)
  // still restores: the draft already carries that Event.
  assert.equal(d({ initial: ev, draft: draftWith({ title: "d", events: [EVENT] }) }), "restore", "guest, same Event — reload");
  assert.equal(d({ resume: true }), "restore", "a guest never converts");
  assert.equal(d({ authed: true, resume: true }), "convert");
  assert.equal(d({ authed: true }), "prompt");
  assert.equal(d({ authed: true, resume: true, initial: ev }), "none");
  assert.equal(d({ authed: true, initial: ev }), "none");
});

test("a restored decision carries the URL context merged in", () => {
  // Same Event (an occurrence the draft lacked is filled from the URL).
  const out = S.decideGuestStartup({ authed: false, resume: false, initial: eventInitial(), draft: draftWith({ notes: "n", title: "t", events: [{ ...EVENT, occurrence: null }] }) });
  assert.equal(out.kind, "restore");
  assert.deepEqual(out.draft.events.map((e) => e.value), ["ev-1"]);
  assert.equal(out.draft.events[0].occurrence.id, "occ-1");
  assert.equal(out.draft.title, "t");
});

test("draftHasUserContent: title, story, photos or a described place count; bare defaults do not", () => {
  assert.equal(S.draftHasUserContent(draftWith()), false);
  assert.equal(S.draftHasUserContent(draftWith({ title: " x " })), true);
  assert.equal(S.draftHasUserContent(draftWith({ notes: "x" })), true);
  assert.equal(S.draftHasUserContent(draftWith({ media: [{ localId: "m", isCover: false, caption: null }] })), true);
});

test("expiry: a stale draft reads as expired (for purging), never as restorable", () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
  const T0 = Date.UTC(2026, 0, 1);
  D.writeGuestMomentDraft(draftWith({ title: "old" }), storage, T0);
  const fresh = D.readGuestMomentDraftStatus(storage, T0 + 1000);
  assert.equal(fresh.draft.title, "old");
  assert.equal(fresh.expired, null);
  const stale = D.readGuestMomentDraftStatus(storage, T0 + 15 * 24 * 60 * 60 * 1000);
  assert.equal(stale.draft, null);
  assert.equal(stale.expired.title, "old");
  assert.equal(D.readGuestMomentDraftStatus(null).draft, null);
});
