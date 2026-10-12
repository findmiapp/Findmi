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

test("carousel: the first press stops auto-rotation for good — a touched slide can't be swapped while its destination loads", () => {
  const c = code(CAROUSEL);
  assert.match(c, /const \[stopped, setStopped\] = useState\(false\);/);
  assert.match(c, /if \(count < 2 \|\| paused \|\| stopped\) return;/, "state tears the interval down");
  assert.match(c, /setInterval\(\(\) => \{\s*if \(stoppedRef\.current\) return;/, "a tick due before React re-renders is skipped");
  const down = c.slice(c.indexOf("function handlePointerDown"), c.indexOf("function handlePointerUp"));
  assert.ok(down.indexOf("stoppedRef.current = true;") < down.indexOf('if (e.pointerType !== "touch") return;'), "every pointer type, before the touch-only swipe tracking");
  assert.match(down, /setStopped\(true\);/);
  assert.doesNotMatch(c, /heldRef|addEventListener\("pointerup"/, "the superseded d874d87 hold/release is gone — no stacked touch hacks");
});

test("carousel: the first tap navigates — a press never consumes the click, swaps or remounts the tapped card", () => {
  const c = code(CAROUSEL);
  const down = c.slice(c.indexOf("function handlePointerDown"), c.indexOf("function handlePointerUp"));
  assert.doesNotMatch(down, /setIndex|preventDefault|stopPropagation|goTo|setPointerCapture/, "pressing a card changes nothing but the rotation flag");
  assert.doesNotMatch(c, /suppressClickRef|lastAutoAdvanceRef|AIM_GUARD_MS/, "the rejected restore-then-second-tap guard is gone");
  // The ONLY click suppression is a recognized swipe.
  const capture = c.slice(c.indexOf("onClickCapture="), c.indexOf("onClickCapture=") + 200);
  assert.match(capture, /if \(justSwipedRef\.current\) \{\s*e\.preventDefault\(\);/);
  assert.equal((c.match(/preventDefault\(\)/g) ?? []).length, 1, "no other code path blocks a link activation");
  // Stopping rotation is a ref + state flip; the slide key (which would
  // remount the card under the finger) depends only on index.
  assert.match(c, /key=\{bulletins\[index\]\.id\}/);
});

test("carousel: a tap during or right after an automatic transition opens the card it lands on", () => {
  const c = code(CAROUSEL);
  // The interval is the only automatic slide change, and it is blocked the
  // moment a press starts (ref), so the card under the finger cannot be
  // replaced between press and click; whichever card is under the finger —
  // even mid-fade-in — receives the click and navigates.
  const tick = c.slice(c.indexOf("setInterval("), c.indexOf("ROTATE_INTERVAL_MS);"));
  assert.match(tick, /if \(stoppedRef\.current\) return;\s*setIndex\(\(i\) => \(i \+ 1\) % count\);/);
  assert.equal((c.match(/setIndex\(/g) ?? []).length, 2, "only the auto tick and goTo (controls/swipe) change slides — never a press");
});

test("carousel: hover/focus pause, swipe, controls and timing preserved", () => {
  const c = code(CAROUSEL);
  assert.match(c, /const ROTATE_INTERVAL_MS = 3000;/);
  assert.match(c, /const TRANSITION_MS = 300;/);
  assert.match(c, /onMouseEnter=\{\(\) => setPaused\(true\)\}/);
  assert.match(c, /onFocusCapture=\{\(\) => setPaused\(true\)\}/);
  assert.match(c, /if \(count < 2 \|\| paused \|\| stopped\) return;/, "hover/focus pause still gates rotation");
  assert.match(c, /goTo\(deltaX < 0 \? index \+ 1 : index - 1\);/);
  assert.match(c, /if \(justSwipedRef\.current\) \{\s*e\.preventDefault\(\);/, "a swipe still never doubles as a tap");
  for (const label of ['"Previous announcement"', '"Next announcement"']) assert.ok(c.includes(`aria-label=${label}`), label);
  // Controls are siblings of the slide, never inside the card link.
  const slide = c.indexOf("<HomepageBulletin bulletin={bulletins[index]} />");
  assert.ok(slide > 0 && slide < c.indexOf('aria-label="Previous announcement"'));
});
