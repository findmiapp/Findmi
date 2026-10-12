// Homepage Bulletin click target — the whole visible card is the one link
// whenever a Bulletin has a destination (title, body, thumbnail and the
// optional CTA all resolve to the same href), and the carousel never
// rotates the slide out from under an in-progress tap. Source-level guards
// (this suite has no JSX rendering harness); no network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CARD = readFileSync("src/components/HomepageBulletin.tsx", "utf8");
const CAROUSEL = readFileSync("src/components/HomepageBulletinCarousel.tsx", "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

test("card: one link wraps ALL visible content (thumbnail, title, body, CTA) for internal and external destinations", () => {
  const c = code(CARD);
  assert.match(c, /<Link href=\{bulletin\.href\} onClick=\{handleClick\} className=\{className\}>\s*\{content\}\s*<\/Link>/);
  assert.match(c, /<a href=\{bulletin\.href\} target="_blank" rel="noopener noreferrer" onClick=\{handleClick\} className=\{className\}>\s*\{content\}\s*<\/a>/);
  const content = c.slice(c.indexOf("const content = ("), c.indexOf("const className ="));
  for (const part of ["bulletin.thumbnailUrl", "bulletin.headline", "bulletin.supportingText", "bulletin.ctaText"]) {
    assert.ok(content.includes(part), `${part} is inside the linked content`);
  }
  // The card itself carries the border/padding, so no visible area sits outside the link.
  assert.match(c, /const className =\s*"flex items-center gap-3 rounded-2xl border border-black\/10 bg-white p-3/);
});

test("CTA: plain text inside the card link — same destination, never a nested link/button or a click blocker", () => {
  const c = code(CARD);
  const content = c.slice(c.indexOf("const content = ("), c.indexOf("const className ="));
  assert.match(content, /<span className="[^"]*">\s*\{bulletin\.ctaText\}/);
  assert.doesNotMatch(content, /<a\s|<Link|<button|onClick|stopPropagation|preventDefault|pointer-events-none/);
  assert.match(c, /const showCta = Boolean\(bulletin\.href && bulletin\.ctaText\);/, "a CTA only ever shows with a real destination");
});

test("no destination: identical content in a plain wrapper — never a fake link", () => {
  const c = code(CARD);
  assert.match(c, /if \(!bulletin\.href\) \{\s*return <div className=\{className\}>\{content\}<\/div>;/);
  assert.equal((c.match(/<Link /g) ?? []).length, 1);
  assert.equal((c.match(/<a /g) ?? []).length, 1);
});

test("carousel: a pointer held on a slide blocks auto-rotation until after release", () => {
  const c = code(CAROUSEL);
  assert.match(c, /const heldRef = useRef\(false\);/);
  assert.match(c, /setInterval\(\(\) => \{\s*if \(heldRef\.current\) return;\s*setIndex/, "a tick due mid-tap is skipped, not applied");
  const down = c.slice(c.indexOf("function handlePointerDown"), c.indexOf("function handlePointerUp"));
  assert.ok(down.indexOf("heldRef.current = true;") < down.indexOf('if (e.pointerType !== "touch") return;'), "held for every pointer type, before the touch-only swipe tracking");
  assert.match(down, /window\.addEventListener\("pointerup", release\);/, "released wherever the pointer lifts");
  assert.match(down, /window\.addEventListener\("pointercancel", release\);/);
  assert.match(down, /setTimeout\(\(\) => \{\s*heldRef\.current = false;\s*\}, 0\);/, "released only after the tap's click dispatches");
  assert.match(down, /window\.removeEventListener\("pointerup", release\);\s*window\.removeEventListener\("pointercancel", release\);/, "no leaked listeners");
});

test("carousel: hover/focus pause, swipe, controls and timing preserved", () => {
  const c = code(CAROUSEL);
  assert.match(c, /const ROTATE_INTERVAL_MS = 3000;/);
  assert.match(c, /const TRANSITION_MS = 300;/);
  assert.match(c, /onMouseEnter=\{\(\) => setPaused\(true\)\}/);
  assert.match(c, /onFocusCapture=\{\(\) => setPaused\(true\)\}/);
  assert.match(c, /if \(count < 2 \|\| paused\) return;/);
  assert.match(c, /goTo\(deltaX < 0 \? index \+ 1 : index - 1\);/);
  assert.match(c, /if \(justSwipedRef\.current\) \{\s*e\.preventDefault\(\);/, "a swipe still never doubles as a tap");
  for (const label of ['"Previous announcement"', '"Next announcement"']) assert.ok(c.includes(`aria-label=${label}`), label);
  // Controls are siblings of the slide, never inside the card link.
  const slide = c.indexOf("<HomepageBulletin bulletin={bulletins[index]} />");
  assert.ok(slide > 0 && slide < c.indexOf('aria-label="Previous announcement"'));
});
