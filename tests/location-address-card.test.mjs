// Location page address card — street on line 1 (stronger), "City, ST ZIP"
// on line 2 (secondary, readable), from the Location's structured fields.
// Pin, card, chevron and Directions link are unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = readFileSync("src/app/(public)/location/[slug]/LocationPublicView.tsx", "utf8");

test("address card renders two deliberate lines from structured fields (no hardcoded address)", () => {
  assert.match(view, /const addressLine1 = location\.address\?\.trim\(\) \|\| null;/);
  assert.match(view, /const addressLine2 = cityStateZip\(location\.city, location\.state, location\.postal_code\) \|\| null;/);
  assert.match(view, /\{addressLine1 && <span className="block break-words text-sm font-semibold text-ink">\{addressLine1\}<\/span>\}/, "line 1: semibold, darker");
  assert.match(view, /\{addressLine2 && <span className="block break-words text-sm text-ink\/75">\{addressLine2\}<\/span>\}/, "line 2: regular, slightly lighter");
  assert.doesNotMatch(view, /121 East 27th/);
  assert.equal((view.match(/\{addressBlock\}/g) ?? []).length, 2, "both the linked and plain variants");
  assert.doesNotMatch(view, />\{fullAddress\}</, "no single joined line remains");
});

test("pin, chevron, Directions destination and card container are unchanged", () => {
  assert.match(view, /<a\n\s+href=\{directionsHref\}\n\s+target="_blank"\n\s+rel="noreferrer"\n\s+className="mt-2 flex min-h-11 w-full items-center gap-3 rounded-xl border border-black\/10 bg-white px-3\.5 py-2\.5/);
  assert.match(view, /<PinGlyph className="h-4 w-4 shrink-0 text-ink\/40" \/>\n\s+\{addressBlock\}\n\s+<ChevronIcon direction="right" className="h-4 w-4 shrink-0 text-ink\/40" \/>/);
  assert.match(view, /const mapsQuery = encodeURIComponent\(\[location\.name, fullAddress\]\.filter\(Boolean\)\.join\(", "\)\);/, "Directions query unchanged");
});
