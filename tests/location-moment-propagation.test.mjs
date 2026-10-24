// Location Moment propagation — capture once, surface on connected places.
// Regression for the production case where a public Moment located at a
// kiosk INSIDE a plaza (and tagged to an Event date held at that kiosk)
// surfaced on the Business and the kiosk but never on the plaza's
// Location page, whose Moments read was exact-place only. Pure rules from
// src/lib/location-moment-scope.ts plus source guards on the read path.
// Fixture ids are synthetic — no production names are hard-coded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const S = await import("../src/lib/location-moment-scope.ts");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const DISTRIBUTION = code(readFileSync("src/lib/journal-distribution.ts", "utf8"));

const PLAZA = "11111111-1111-4111-8111-111111111111";
const KIOSK = "22222222-2222-4222-8222-222222222222"; // parent_location_id = PLAZA
const ELSEWHERE = "33333333-3333-4333-8333-333333333333";
const OCC_AT_KIOSK = "44444444-4444-4444-8444-444444444444";
const OCC_ELSEWHERE = "55555555-5555-4555-8555-555555555555";
const occurrencePlace = new Map([
  [OCC_AT_KIOSK, KIOSK],
  [OCC_ELSEWHERE, ELSEWHERE],
]);

test("a Moment located at a child place surfaces on the parent place", () => {
  const places = S.locationMomentPlaceIds(PLAZA, [KIOSK]);
  assert.deepEqual(places, [PLAZA, KIOSK]);
  assert.equal(S.momentSurfacesAtPlace({ locationId: KIOSK, occurrenceIds: [] }, places, occurrencePlace), true);
});

test("it still surfaces on the exact child place", () => {
  const places = S.locationMomentPlaceIds(KIOSK, []);
  assert.equal(S.momentSurfacesAtPlace({ locationId: KIOSK, occurrenceIds: [] }, places, occurrencePlace), true);
});

test("never on an ancestor's sibling or an unrelated place, and never upward to a child", () => {
  assert.equal(S.momentSurfacesAtPlace({ locationId: KIOSK, occurrenceIds: [] }, S.locationMomentPlaceIds(ELSEWHERE, []), occurrencePlace), false);
  // A Moment at the plaza is not "at" the kiosk inside it.
  assert.equal(S.momentSurfacesAtPlace({ locationId: PLAZA, occurrenceIds: [] }, S.locationMomentPlaceIds(KIOSK, []), occurrencePlace), false);
});

test("a Moment with no Location surfaces where its tagged Event date was held", () => {
  const places = S.locationMomentPlaceIds(PLAZA, [KIOSK]);
  assert.equal(S.momentSurfacesAtPlace({ locationId: null, occurrenceIds: [null, OCC_AT_KIOSK] }, places, occurrencePlace), true);
  assert.equal(S.momentSurfacesAtPlace({ locationId: null, occurrenceIds: [OCC_ELSEWHERE] }, places, occurrencePlace), false);
  // Event-level (no date) connections are never attributed to one place.
  assert.equal(S.momentSurfacesAtPlace({ locationId: null, occurrenceIds: [null] }, places, occurrencePlace), false);
});

test("filters are validated, de-duplicated, bounded and never empty", () => {
  assert.equal(S.locationMomentFilter([], []), null);
  assert.equal(S.locationMomentFilter([PLAZA, PLAZA, "x),or(1.eq.1"], []), `location_id.in.(${PLAZA})`);
  assert.equal(S.locationMomentFilter([PLAZA], [OCC_AT_KIOSK]), `location_id.in.(${PLAZA}),id.in.(${OCC_AT_KIOSK})`);
  assert.deepEqual(S.eligibleLocationEntryIds([]), [S.NO_MATCH_ID]);
  const many = Array.from({ length: 1000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  assert.equal(S.eligibleLocationEntryIds(many).length, S.LOCATION_MOMENT_ID_CAP);
});

test("the Location read path uses the scope (descendants + Event dates), not exact-place only", () => {
  assert.match(DISTRIBUTION, /getLocationDescendants\(subjectId\)/);
  assert.match(DISTRIBUTION, /locationMomentPlaceIds\(/);
  assert.match(DISTRIBUTION, /\.in\("event_occurrence_id", occIds\)/);
  assert.doesNotMatch(DISTRIBUTION, /query = query\.eq\("location_id", subjectId\)/);
});

test("visibility, moderation and display preferences still gate every Location Moment", () => {
  // Eligible ids come only from public + published rows…
  assert.match(DISTRIBUTION, /select\("id"\)\.eq\("visibility", "public"\)\.eq\("status", "published"\)\.or\(filter\)/);
  // …the page query restates both filters, and Hide From Profile / Featured
  // (entity_moment_display) apply to Location pages as before.
  assert.match(DISTRIBUTION, /\.eq\("visibility", "public"\)\s*\.eq\("status", "published"\)/);
  assert.match(DISTRIBUTION, /subjectType === "location" \|\| subjectType === "event"\) \? getEntityMomentDisplay/);
  assert.match(DISTRIBUTION, /query = query\.not\("id", "in", notInList\(hiddenIds\)\)/);
});
