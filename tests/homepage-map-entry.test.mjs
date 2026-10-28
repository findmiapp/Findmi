// Homepage Map entry — a direct /map link immediately left of the homepage
// Search field. Static guards (the button is a plain server Link; /map itself
// is out of scope and must not change).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Code only (doc comments describe what the button must NOT do).
const BTN = readFileSync("src/components/HomeMapButton.tsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const HOME = readFileSync("src/app/(public)/page.tsx", "utf8");

test("the whole Map button links directly to /map — nothing else", () => {
  assert.match(BTN, /<Link\s+href="\/map"/);
  assert.equal(BTN.split("href=").length - 1, 1, "exactly one destination");
  assert.doesNotMatch(BTN, /"use client"|onClick|geolocation|navigator\.|Modal|Dialog|useState/);
});

test("it sits immediately LEFT of Search in the same row, and Search behavior is unchanged", () => {
  assert.match(
    HOME,
    /<div className="mx-auto flex max-w-6xl items-stretch gap-2 px-4 pt-4 sm:gap-2\.5 sm:px-6">\s*<HomeMapButton \/>\s*<div className="min-w-0 flex-1">\s*<SearchBar marketSlug=\{marketSlug\} placeholder="Search anything you're into…" \/>/
  );
  assert.equal(HOME.split("<HomeMapButton />").length - 1, 1);
});

test("design: true black, no border, Aqua pin from the shared icon set, white single-line MAP, not heavy", () => {
  assert.match(BTN, /bg-\[#000000\]/);
  assert.doesNotMatch(BTN, /\bborder\b|\bring-|outline-|#333|bg-gray|bg-neutral|bg-ink|gradient/);
  assert.match(BTN, /rounded-full/, "same radius family as the Search pill");
  assert.match(BTN, /<NavIcon name="pin" className="[^"]*text-findmi"/);
  assert.match(BTN, />MAP<\/span>/);
  assert.match(BTN, /whitespace-nowrap text-sm font-semibold/);
  assert.doesNotMatch(BTN, /font-(bold|extrabold|black)|OPEN MAP|font-display/);
});

test("street motif: ≤4 faint 1px white paths, decorative and behind the content", () => {
  const paths = BTN.match(/<path /g) ?? [];
  assert.ok(paths.length >= 2 && paths.length <= 4, `${paths.length} paths`);
  assert.match(BTN, /stroke="rgba\(255,255,255,0\.1[0-6]\)"/);
  assert.match(BTN, /strokeWidth="1"/);
  assert.match(BTN, /<svg aria-hidden="true"[^>]*pointer-events-none absolute inset-0/);
  // Pin + label are positioned (relative) so they paint above the absolute motif.
  assert.match(BTN, /className="relative h-\[18px\]/);
  assert.match(BTN, /<span className="relative whitespace-nowrap/);
});

test("/map itself is untouched by this entry (no import of the button there)", () => {
  assert.doesNotMatch(readFileSync("src/app/(public)/map/page.tsx", "utf8"), /HomeMapButton/);
});
