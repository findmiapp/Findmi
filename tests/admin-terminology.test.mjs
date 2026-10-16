// Admin Terminology Normalization — LABELS ONLY. One Admin lifecycle
// vocabulary (PUBLISHED / DRAFT / PAUSED / ARCHIVED / TRASHED), moderation
// kept separate (NEEDS REVIEW / REJECTED), the same action verbs everywhere
// (Publish / Unpublish / Pause / Resume / Approve / Reject / Archive /
// Restore / Move To Trash / Delete Permanently). States and mutations are
// unchanged; public wording is untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

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

const PUB = await import("../src/lib/event-publication.ts");
const EV = await import("../src/lib/admin/event-lifecycle.ts");
const EL = await import("../src/lib/admin/lifecycle-eligibility.ts");
const LC = await import("../src/lib/admin/location-lifecycle.ts");
const read = (p) => readFileSync(p, "utf8");
const label = (e) => PUB.EVENT_VISIBILITY_LABEL[PUB.eventVisibility(e)];
const BAR_E = read("src/app/admin/(protected)/events/EventBulkActionBar.tsx");
const BAR_B = read("src/app/admin/(protected)/businesses/BusinessBulkActionBar.tsx");

test("1–4. Event states read PUBLISHED / DRAFT / ARCHIVED / TRASHED", () => {
  assert.equal(label({ is_demo: false }), "Published");
  assert.equal(label({ is_demo: true }), "Draft");
  assert.equal(label({ is_demo: false, archived_at: "x" }), "Archived");
  assert.equal(label({ is_demo: false, trashed_at: "x" }), "Trashed");
  // Legacy moderation flags stay separate: Needs Review / Rejected.
  const list = read("src/app/admin/(protected)/events/EventBulkListClient.tsx");
  assert.match(list, /e\.publication_status === "pending_review"\) return \{ label: "Needs Review"/);
  assert.match(list, /e\.publication_status === "rejected"\) return \{ label: "Rejected"/);
});

test("5–7. Publish / Unpublish / Archive keep the EXISTING mutations (ops unchanged)", () => {
  assert.deepEqual(EV.EVENT_PUBLISH_PATCH, { is_demo: false, publication_status: "live" });
  assert.deepEqual(EV.EVENT_HIDE_PATCH, { is_demo: true });
  assert.deepEqual(Object.keys(EV.eventShutDownPatch()), ["archived_at"]);
  assert.match(BAR_E, /\{ key: "live", label: "Publish",[^\n]*run: \(ids\) => bulkTransitionEvents\(ids, "live"\) \}/);
  assert.match(BAR_E, /\{ key: "hide", label: "Unpublish",[^\n]*run: \(ids\) => bulkTransitionEvents\(ids, "hide"\) \}/);
  assert.match(BAR_E, /\{ key: "shutdown", label: "Archive",[^\n]*run: \(ids\) => bulkTransitionEvents\(ids, "shutdown"\) \}/);
  for (const old of ["Make Live", '"Hide"', "Shut Down"]) assert.ok(!BAR_E.includes(`label: ${old.startsWith('"') ? old : `"${old}"`}`), old);
  const page = read("src/app/admin/(protected)/events/[id]/page.tsx");
  assert.match(page, /<form action=\{hideEvent\.bind\(null, id, null\)\}>[\s\S]{0,300}Unpublish/);
  assert.match(page, /<form action=\{shutDownEvent\.bind\(null, id, null\)\}>[\s\S]{0,300}Archive/);
  assert.doesNotMatch(page, />\s*(Hide|Shut Down)\s*</);
  const list = read("src/app/admin/(protected)/events/EventBulkListClient.tsx");
  assert.doesNotMatch(list, />\s*(Hide|Shut Down)\s*</);
  // Summaries use the same verbs.
  const r = { op: "shutdown", changed: ["a", "b", "c", "d"], already: [], inactive: [], missing: [], failed: [], changedSlugs: [] };
  assert.equal(EV.describeEventTransition(r), "4 Events Archived");
  assert.equal(EV.describeEventTransition({ ...r, op: "live", changed: ["a", "b", "c"] }), "3 Events Published");
  assert.equal(EV.describeEventTransition({ ...r, op: "hide", changed: ["a", "b"] }), "2 Events Unpublished");
  assert.match(BAR_E, /`Archive \$\{plural\(n\)\}\?/);
});

test("8. New Events is a VIEW (created in the last 7 days), never a row state", () => {
  assert.equal(PUB.NEW_EVENT_WINDOW_DAYS, 7);
  assert.ok(!Object.values(PUB.EVENT_VISIBILITY_LABEL).includes("New"));
  const list = read("src/app/admin/(protected)/events/EventBulkListClient.tsx");
  assert.match(list, /const badge = eventStatusBadge\(e\);/, "rows in New Events show their real state");
  assert.match(read("src/app/admin/(protected)/events/page.tsx"), /Unpublish or\n\s+Archive any of them here\./);
});

test("9–15. Business states: PUBLISHED / DRAFT / PAUSED / NEEDS REVIEW / REJECTED / ARCHIVED / TRASHED", () => {
  const b = (o) => EL.businessBadge({ is_demo: false, ...o }).label;
  assert.equal(b({ publication_status: "live" }), "Published");
  assert.equal(b({ publication_status: "draft" }), "Draft");
  assert.equal(b({ publication_status: "paused" }), "Paused");
  assert.equal(b({ publication_status: "pending_review" }), "Needs Review");
  assert.equal(b({ publication_status: "rejected" }), "Rejected");
  assert.equal(b({ publication_status: "live", archived_at: "x" }), "Archived");
  assert.equal(b({ publication_status: "live", trashed_at: "x" }), "Trashed");
  // The other Admin surfaces use the same words.
  assert.match(read("src/lib/admin/membership-queries.ts"), /pending_review: "Needs Review", live: "Published"/);
  for (const f of ["src/app/admin/(protected)/businesses/BusinessForm.tsx", "src/app/admin/(protected)/businesses/[id]/page.tsx"]) {
    assert.match(read(f), /\{ value: "pending_review", label: "Needs Review" \},\n\s+\{ value: "live", label: "Published" \},/, f);
  }
  assert.match(read("src/app/admin/(protected)/businesses/BusinessesFilterBar.tsx"), /Needs Review only/);
  assert.match(read("src/components/admin/PendingReviewPanel.tsx"), />Needs Review<\/p>/);
  assert.match(read("src/app/admin/(protected)/businesses/[id]/page.tsx"), /business\.publication_status === "live"\n\s+\? "Published"/);
  // The DB value itself is unchanged.
  assert.match(read("src/lib/admin/lifecycle-eligibility.ts"), /approve: \{ from: "pending_review", to: "live", notify: "live" \}/);
});

test("16–17. Approve / Reject remain the moderation actions; Pause / Resume the lifecycle ones", () => {
  assert.match(BAR_B, /\{ key: "approve", label: "Approve",/);
  assert.match(BAR_B, /\{ key: "reject", label: "Reject",/);
  assert.match(BAR_B, /\{ key: "pause", label: "Pause",/);
  assert.match(BAR_B, /\{ key: "resume", label: "Resume",/);
  assert.match(BAR_B, /Needs Review Businesses become Published on Findmi/);
  const panel = read("src/components/admin/BusinessLifecyclePanel.tsx");
  assert.match(panel, /Resume Business/, "Restore is reserved for Archive / Trash");
  assert.doesNotMatch(panel, /Restore Business|>Live:/);
  assert.equal(EL.businessEligibility("approve", { publication_status: "pending_review" }), "change");
});

test("18. Locations keep Published / Draft / Archived / Trashed; shared actions say Move To Trash / Delete Permanently", () => {
  assert.deepEqual(Object.values(LC.LOCATION_LIFECYCLE_LABEL), ["Published", "Draft", "Archived", "Trashed"]);
  assert.match(read("src/app/admin/(protected)/locations/LocationBulkActionBar.tsx"), /label=\{`Move To Trash\$\{count/);
  const shared = read("src/components/admin/LifecycleBulkActionBar.tsx");
  assert.match(shared, /Delete Permanently\{ids\.length/);
  assert.match(shared, /label="Move To Trash"/);
  for (const bar of [BAR_E, BAR_B]) assert.match(bar, /label: "Move To Trash"/);
});

test("19. no underlying lifecycle mutation changed (patches, rules, guards)", () => {
  assert.deepEqual(EL.BUSINESS_TRANSITION_RULE, {
    approve: { from: "pending_review", to: "live", notify: "live" },
    reject: { from: "pending_review", to: "rejected", notify: "rejected" },
    pause: { from: "live", to: "paused", notify: "paused" },
    resume: { from: "paused", to: "live", notify: "restored" },
  });
  assert.equal(EL.eventEligibility("live", { is_demo: true }), "change");
  assert.equal(EL.eventEligibility("shutdown", { is_demo: false, archived_at: "x" }), "already");
  const ev = read("src/lib/admin/event-lifecycle.ts");
  assert.match(ev, /\.update\(patch\)\.in\("id", toChange\)\.is\("trashed_at", null\)\.is\("archived_at", null\)/);
});

test("20. public / unrelated uses of Live, Active and Hidden are untouched", () => {
  // EVENT_VISIBILITY_LABEL is read only by Admin surfaces.
  const users = ["src/app/admin/(protected)/events/EventBulkListClient.tsx", "src/app/admin/(protected)/events/[id]/page.tsx"];
  for (const f of users) assert.match(read(f), /EVENT_VISIBILITY_LABEL/);
  // Public "happening live" and privacy wording are unchanged.
  assert.match(read("src/components/EventOccurrenceQuickView.tsx"), /Happening Now/);
  assert.match(read("src/lib/event-attendance.ts"), /HIDDEN_LOCATION_COPY/);
  assert.match(read("src/components/LocationHours.tsx"), /"Open Now"/);
  // Product moderation (a different entity) keeps its own wording.
  assert.match(read("src/app/admin/(protected)/products/ProductBulkListClient.tsx"), /"Pending Review"/);
});
