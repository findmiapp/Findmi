// Guest-First Experience Completion pass, Part A — the local guest
// Moment draft (lib/guest-moment-draft.ts). Pure, DOM-free behavioral
// tests using an in-memory storage mock, same convention as
// lib/account-follow-client.ts's own FollowStorage tests
// (tests/follow-toggle.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";

const D = await import("../src/lib/guest-moment-draft.ts");

function memStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    _map: map,
  };
}

test("round-trips a draft through write/read exactly", () => {
  const s = memStorage();
  const draft = { ...D.emptyGuestMomentDraft(), title: "Saturday Market" };
  D.writeGuestMomentDraft(draft, s, 1000);
  const back = D.readGuestMomentDraft(s, 1000);
  assert.equal(back.title, "Saturday Market");
  assert.equal(back.draftId, draft.draftId);
});

test("no storage, no draft — never throws", () => {
  assert.equal(D.readGuestMomentDraft(null), null);
  assert.doesNotThrow(() => D.writeGuestMomentDraft(D.emptyGuestMomentDraft(), null));
  assert.doesNotThrow(() => D.clearGuestMomentDraft(null));
});

test("nothing written yet reads as null", () => {
  assert.equal(D.readGuestMomentDraft(memStorage(), 1000), null);
});

test("a malformed/foreign record is ignored, never thrown on", () => {
  const s = memStorage();
  s.setItem("findmi_guest_moment_draft_v1", "{not json");
  assert.equal(D.readGuestMomentDraft(s, 1000), null);
  s.setItem("findmi_guest_moment_draft_v1", JSON.stringify({ hello: "world" }));
  assert.equal(D.readGuestMomentDraft(s, 1000), null);
});

test("a draft from a newer version is never read as this version's shape", () => {
  const s = memStorage();
  s.setItem("findmi_guest_moment_draft_v1", JSON.stringify({ ...D.emptyGuestMomentDraft(), version: 2 }));
  assert.equal(D.readGuestMomentDraft(s, 1000), null);
});

test("a stale draft (older than 14 days) is treated as abandoned", () => {
  const s = memStorage();
  const T0 = Date.UTC(2026, 0, 1);
  D.writeGuestMomentDraft(D.emptyGuestMomentDraft(), s, T0);
  assert.ok(D.readGuestMomentDraft(s, T0 + 60 * 60 * 1000) !== null, "still fresh an hour later");
  assert.equal(D.readGuestMomentDraft(s, T0 + 15 * 24 * 60 * 60 * 1000), null, "abandoned after 15 days");
});

test("clear removes it; a cleared draft reads as null", () => {
  const s = memStorage();
  D.writeGuestMomentDraft(D.emptyGuestMomentDraft(), s, 1000);
  D.clearGuestMomentDraft(s);
  assert.equal(D.readGuestMomentDraft(s, 1000), null);
});

test("a write failure (quota, private browsing) is swallowed, never thrown", () => {
  const s = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {},
  };
  assert.doesNotThrow(() => D.writeGuestMomentDraft(D.emptyGuestMomentDraft(), s, 1000));
});

test("emptyGuestMomentDraft mirrors emptyMomentInitial's own defaults — no account/server fields guessed", () => {
  const draft = D.emptyGuestMomentDraft();
  assert.equal(draft.serverEntryId, null);
  assert.equal(draft.intendedAction, null);
  assert.deepEqual(draft.events, []);
  assert.deepEqual(draft.businesses, []);
  assert.deepEqual(draft.products, []);
  assert.deepEqual(draft.media, []);
  assert.equal(draft.location, null);
});

test("every draft gets its own fresh id — never two drafts sharing an identity by accident", () => {
  const a = D.emptyGuestMomentDraft();
  const b = D.emptyGuestMomentDraft();
  assert.notEqual(a.draftId, b.draftId);
});
