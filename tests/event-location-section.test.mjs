// Event page — Location section polish: "Location" heading, one compact
// card (two-line name, structured address, Get Directions + View Location),
// rendered only for a real linked Location (never for a hidden one).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const card = read("src/components/event/EventLocationFeature.tsx");
const view = read("src/app/(public)/event/[slug]/EventPublicView.tsx");
const directions = read("src/components/event/DirectionsIconLink.tsx");

test("heading + canonical name/address (no aggressive one-line truncation)", () => {
  // One shared block (the Location page renders it as variant="self");
  // the Event page's default output is unchanged.
  assert.match(card, /heading = "Location",\n\s+sectionId = "location",/);
  assert.match(card, /<SectionHeading id=\{`\$\{sectionId\}-heading`\}>\{heading\}<\/SectionHeading>/);
  // Consolidation pass: same styling, and the name now links to a listed Location.
  assert.match(card, /\) : \(\n\s+<p className="line-clamp-2 break-words font-display text-card-title-lg font-bold leading-snug text-primary">[\s\S]{0,500}?\{location\.name\}/, "Event variant name styling unchanged");
  assert.doesNotMatch(card, /<p className="truncate font-display[^"]*">\{location\.name\}/, "name no longer forced onto one line");
  assert.match(card, /const street = location\.address\?\.trim\(\) \|\| null;/);
  assert.match(card, /const cityLine = cityStateZip\(location\.city, location\.state, location\.postal_code\) \|\| null;/);
  assert.match(card, /\{street && <span className="block break-words font-medium text-secondary">\{street\}<\/span>\}/);
  assert.match(card, /\{cityLine && <span className="block break-words text-muted">\{cityLine\}<\/span>\}/);
});

test("Get Directions (accent, same maps query + tracking) and View Location (canonical page); the shared contextual map", () => {
  assert.match(card, /variant="compact"/);
  assert.match(card, /const mapsQuery = \[location\.name, location\.address, cityState\(location\.city, location\.state\)\]\.filter\(Boolean\)\.join\(", "\);/, "Directions destination unchanged");
  assert.match(card, /event_name: "click_directions",\n\s+subject_type: "location",/);
  assert.match(directions, /className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1\.5 rounded-full bg-findmi px-4 text-sm font-bold text-white[^"]*"\n\s+>\n\s+\{glyph\}\n\s+Get Directions/);
  assert.match(card, /\{!self && publicLocationHref\(location\) && \([\s\S]{0,120}href=\{publicLocationHref\(location\)!\}[\s\S]{0,260}View Location/, "canonical page — only when it exists (lib/location-links.ts), never on the Location's own page");
  // Map Everywhere: the Findmi Map is live — the card carries the shared
  // contextual map (with its own View On Map) for a Location with real
  // coordinates; Directions above stays the external maps destination.
  assert.match(card, /<ContextMap results=\{\[geo\]\}/);
});

test("privacy: no section for a hidden location (canonicalLocation is null); no empty section", () => {
  assert.match(view, /const canonicalLocation = locationHidden \? null :/);
  assert.match(view, /const locationFeatureSection = canonicalLocation \? \(\n\s+<EventLocationFeature location=\{canonicalLocation\} placeContext=\{locationPlaceContext\} \/>\n\s+\) : null;/);
  assert.match(view, /locationHidden \? \(\n\s+<WhereFact name=\{HIDDEN_LOCATION_COPY\} lines=\{\[location\]\} \/>/, "hidden treatment in the facts band unchanged");
});

test("order: Location stays directly before Hosted By; mobile-safe card", () => {
  const block = view.slice(view.indexOf("{datesSection}"), view.indexOf("{detailsSection}"));
  assert.ok(block.indexOf("{locationFeatureSection}") < block.indexOf("{hostedBySection}"));
  assert.equal(block.split("{locationFeatureSection}").length - 1, 1, "Location rendered once");
  assert.match(card, /className="mt-3 rounded-2xl border border-black\/5 bg-white p-3\.5 sm:max-w-xl"/, "compact; never stretched on desktop");
  assert.match(card, /<div className="min-w-0 flex-1">/, "text column can shrink — no horizontal overflow");
});

test("the Location's own page reuses the same block: map + name + full address + Get Directions, no logo, no View Location", () => {
  const card = read("src/components/event/EventLocationFeature.tsx");
  assert.match(card, /\{self \? \(\n\s+\/\/[^\n]*\n\s+<p className="line-clamp-2 break-words text-sm font-bold leading-snug text-primary">\{location\.name\}<\/p>/, "a quiet bold name above the address");
  assert.match(card, /\{!self && \(\n\s+<div className="relative h-16 w-16/, "no logo on its own page");
  const loc = read("src/app/(public)/location/[slug]/LocationPublicView.tsx");
  assert.match(loc, /<EventLocationFeature location=\{location\} placeContext=\{placeContext\} variant="self" heading="On The Map" sectionId="map" \/>/);
  assert.doesNotMatch(loc, /<ContextMap /, "no second, barer map implementation");
});
