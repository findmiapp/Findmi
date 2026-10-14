// Event UX pass — public Event page section order, and Findmi Place-first
// "Where" on manual Event creation/editing (Admin + Business share
// EventLocationField). Pure state rules + source wiring; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const W = await import("../src/lib/event-location-field.ts");
const read = (p) => readFileSync(p, "utf8");

const CORGI = { id: "660d3744-dc88-4e91-856c-c0a296c9e776", name: "Corgi Cafe NYC", slug: "corgi-cafe-nyc", category: "Cafe", address: "121 East 27th Street", city: "New York", state: "NY", postal_code: "10016" };
const OTHER = { id: "11111111-2222-3333-4444-555555555555", name: "Pier 34", slug: "pier-34", category: null, address: "Pier 34", city: "New York", state: "NY", postal_code: null };
const MANUAL = { venue_name: "The Old Mill", address: "12 Mill Rd", city: "Hudson", state: "NY", postal_code: "12534" };

// ── public Event page order ──────────────────────────────────────────

test("public Event page: Dates → Moments → What's Happening → Findmi Here → (Photos) → Location → Hosted By", () => {
  const view = read("src/app/(public)/event/[slug]/EventPublicView.tsx");
  const block = view.slice(view.indexOf("{datesSection}"), view.indexOf("{detailsSection}"));
  const order = ["{datesSection}", "{momentsSection}", "{overviewSection}", "{lineupSection}", "{mediaSection}", "{locationFeatureSection}", "{hostedBySection}", "{placeSection}", "{productsSection}"];
  const positions = order.map((s) => block.indexOf(s));
  assert.ok(positions.every((p) => p >= 0), "every section still rendered once");
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "in the required order");
  for (const s of order) assert.equal(block.split(s).length - 1, 1, `${s} appears exactly once`);
  // Empty sections keep their omission rules (unchanged definitions).
  assert.match(view, /const overviewSection =\n\s+event\.description \? \(/, "What's Happening omitted with no description");
  assert.match(view, /const locationFeatureSection = canonicalLocation \? \(/, "Location omitted without a canonical Location (incl. hidden)");
  assert.match(view, /const canonicalLocation = locationHidden \? null :/, "hidden-location rule untouched");
});

// ── Place-first Where ─────────────────────────────────────────────────

test("new Event: Place search first, manual fields collapsed, nothing submitted yet", () => {
  const s = W.initialWhereState(null, null);
  assert.equal(s.manualOpen, false);
  assert.deepEqual(W.whereSubmission(s), { location_id: "", venue_name: "", address: "", city: "", state: "", postal_code: "" });
});

test("selecting an existing Findmi Place submits its canonical id and its own venue/address", () => {
  const s = W.selectPlace(W.initialWhereState(null, null), CORGI);
  assert.deepEqual(W.whereSubmission(s), { location_id: CORGI.id, venue_name: "Corgi Cafe NYC", address: "121 East 27th Street", city: "New York", state: "NY", postal_code: "10016" });
  assert.equal(s.manualOpen, false, "no manual retyping");
});

test("changing the Place changes the submitted Location; clearing removes it", () => {
  const picked = W.selectPlace(W.initialWhereState(null, null), CORGI);
  const changed = W.selectPlace(W.clearPlace(picked), OTHER);
  assert.equal(W.whereSubmission(changed).location_id, OTHER.id);
  assert.equal(W.whereSubmission(changed).venue_name, "Pier 34");
  // Direct re-selection (no clear in between) also replaces it.
  assert.equal(W.whereSubmission(W.selectPlace(picked, OTHER)).location_id, OTHER.id);
  const cleared = W.clearPlace(picked);
  assert.deepEqual(W.whereSubmission(cleared), { location_id: "", venue_name: "", address: "", city: "", state: "", postal_code: "" }, "no stale id or address");
});

test("switching Place → manual never submits the old canonical Location or its address", () => {
  const manual = W.openManualVenue(W.selectPlace(W.initialWhereState(null, null), CORGI));
  assert.equal(manual.manualOpen, true);
  assert.equal(manual.selected, null);
  const sub = W.whereSubmission(manual);
  assert.equal(sub.location_id, "");
  assert.equal(sub.venue_name, "", "old Place text is not carried into manual fields");
  const typed = { ...manual, manual: { ...MANUAL } };
  assert.deepEqual(W.whereSubmission(typed), { location_id: "", ...MANUAL });
  // Cancelling manual entry drops what was typed.
  assert.deepEqual(W.whereSubmission(W.cancelManualVenue(typed)), { location_id: "", venue_name: "", address: "", city: "", state: "", postal_code: "" });
  // Picking a Place after typing manually submits only the Place.
  assert.equal(W.whereSubmission(W.selectPlace(typed, CORGI)).location_id, CORGI.id);
  assert.equal(W.whereSubmission(W.selectPlace(typed, CORGI)).venue_name, "Corgi Cafe NYC");
});

test("edit: an Event with a canonical Location restores the selected Place; save-without-change keeps it", () => {
  const s = W.initialWhereState(CORGI, { venue_name: "Corgi Cafe NYC", address: "121 East 27th Street", city: "New York", state: "NY", postal_code: "10016" });
  assert.equal(s.selected.id, CORGI.id);
  assert.equal(s.manualOpen, false);
  assert.equal(W.whereSubmission(s).location_id, CORGI.id, "opening + saving keeps the Location");
});

test("edit: a manual-venue Event (no Location) shows and preserves its manual fields", () => {
  const s = W.initialWhereState(null, MANUAL);
  assert.equal(s.manualOpen, true);
  assert.deepEqual(W.whereSubmission(s), { location_id: "", ...MANUAL }, "save-without-change preserves manual venue");
});

test("EventLocationField: Place first, then 'Add Venue Details Manually'; every transition through the shared rules", () => {
  const f = read("src/components/account/EventLocationField.tsx");
  assert.match(f, />Where<\/span>/);
  assert.ok(f.indexOf("<PlaceFindOrCreate") < f.lastIndexOf("Add Venue Details Manually"), "search before the manual option");
  assert.match(f, /useState<WhereFieldState<SelectedLocationDetail>>\(\(\) => initialWhereState\(initialLocation, initialManual\)\)/);
  assert.match(f, /<input type="hidden" name="location_id" value=\{submitted\.location_id\} \/>/);
  assert.match(f, /onSelect=\{\(place\) => setWhere\(\(w\) => selectPlace\(w, place\)\)\}/);
  assert.match(f, /onClick=\{\(\) => setWhere\(clearPlace\)\}[\s\S]{0,140}Change Place/);
  assert.match(f, /onClick=\{\(\) => setWhere\(openManualVenue\)\}/);
  assert.match(f, /onClick=\{\(\) => setWhere\(cancelManualVenue\)\}/);
  for (const label of ["Venue Name", "Address", "City", "State", "Postal Code"]) assert.match(f, new RegExp(`>${label}</span>`));
  assert.doesNotMatch(f, /Enter venue text only|Remove Location \/ Use manual venue|>ZIP</);
});

test("both creation surfaces use the shared field; the server persists the Place on the date (no second relationship)", () => {
  assert.match(read("src/app/admin/(protected)/events/EventForm.tsx"), /<EventLocationField\n\s+initialLocation=\{initialLocation\}\n\s+initialManual=\{initialManual\}/);
  assert.match(read("src/components/EventGeographyFields.tsx"), /<EventLocationField/, "Business Host an Event (create)");
  const bizEdit = read("src/app/(public)/account/event/[id]/page.tsx");
  assert.match(bizEdit, /initialLocation=\{matchedEventLocation\}/, "Business Event Manager (edit)");
  assert.match(bizEdit, /const matchedLocationRow =\n\s+occurrenceLocationRow \?\?/, "edit restores the occurrence's canonical Location first");
  const admin = read("src/app/admin/(protected)/events/EventForm.tsx");
  assert.match(admin, /primaryOccurrenceLocationId/, "Admin edit restores the Primary Date's Location");
  // Persistence: location_id lives on event_occurrences (events has none).
  const memberActions = read("src/app/(public)/account/event/actions.ts");
  assert.match(memberActions, /\.from\("event_occurrences"\)\n\s+\.update\(\{\n\s+location_id: locationId,/);
  assert.doesNotMatch(memberActions, /from\("events"\)[^;]*\.update\(\{[^}]*location_id/);
  // No automatic Location creation from manual text in the field.
  assert.doesNotMatch(read("src/lib/event-location-field.ts"), /createInline|insert|from\(/);
});

test("privacy: a hidden Event's Location save never republishes the address; selecting a public Place stays exact", () => {
  const memberActions = read("src/app/(public)/account/event/actions.ts");
  const i = memberActions.indexOf("export async function updateMemberEventLocation");
  const fn = memberActions.slice(i, memberActions.indexOf("export async function", i + 10));
  const guard = fn.indexOf("if ((await fetchHiddenEventIds(admin, [eventId])).has(eventId))");
  assert.ok(guard > 0 && guard < fn.indexOf('.from("events")\n    .update(payload)'), "guard before the Event write");
  assert.match(fn.slice(guard, guard + 220), /venue_name: null, address: null, postal_code: null, latitude: null, longitude: null/);
  // Admin's Hidden save rule (9c8ea4c) is unchanged.
  assert.match(read("src/app/admin/(protected)/events/actions.ts"), /if \(str\(formData, "location_visibility"\) === "hidden"\) \{\n\s+Object\.assign\(payload, \{ venue_name: null, address: null, postal_code: null, latitude: null, longitude: null \}\);/);
  // Ordinary manual creation with a chosen public Place: exact semantics
  // (the canonical id is submitted as-is).
  assert.equal(W.whereSubmission(W.selectPlace(W.initialWhereState(null, null), CORGI)).location_id, CORGI.id);
});
