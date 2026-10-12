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

test("carousel: a press within AIM_GUARD_MS of an automatic rotation restores the aimed slide instead of opening one never seen", () => {
  const c = code(CAROUSEL);
  assert.match(c, /const AIM_GUARD_MS = TRANSITION_MS;/, "only while the incoming slide is still fading in (300ms)");
  assert.match(c, /setIndex\(\(i\) => \{\s*lastAutoAdvanceRef\.current = \{ at: Date\.now\(\), from: i \};\s*return \(i \+ 1\) % count;/, "only AUTOMATIC rotation is recorded");
  assert.doesNotMatch(c.slice(c.indexOf("function goTo"), c.indexOf("function handlePointerDown")), /lastAutoAdvanceRef/, "manual navigation never arms the guard");
  const down = c.slice(c.indexOf("function handlePointerDown"), c.indexOf("function handlePointerUp"));
  assert.match(down, /suppressClickRef\.current = false;/, "a stale suppression never leaks into a later tap");
  assert.match(down, /if \(recent && Date\.now\(\) - recent\.at < AIM_GUARD_MS && \(e\.target as Element\)\.closest\("a"\)\) \{\s*suppressClickRef\.current = true;\s*setIndex\(recent\.from\);/);
  assert.match(down, /lastAutoAdvanceRef\.current = null;/, "one-shot: the next press navigates normally");
  assert.match(c, /if \(justSwipedRef\.current \|\| suppressClickRef\.current\) \{\s*suppressClickRef\.current = false;\s*e\.preventDefault\(\);/);
  assert.match(c.slice(c.indexOf("function handlePointerCancel")), /suppressClickRef\.current = false;/);
});

test("carousel: hover/focus pause, swipe, controls and timing preserved", () => {
  const c = code(CAROUSEL);
  assert.match(c, /const ROTATE_INTERVAL_MS = 3000;/);
  assert.match(c, /const TRANSITION_MS = 300;/);
  assert.match(c, /onMouseEnter=\{\(\) => setPaused\(true\)\}/);
  assert.match(c, /onFocusCapture=\{\(\) => setPaused\(true\)\}/);
  assert.match(c, /if \(count < 2 \|\| paused \|\| stopped\) return;/, "hover/focus pause still gates rotation");
  assert.match(c, /goTo\(deltaX < 0 \? index \+ 1 : index - 1\);/);
  assert.match(c, /if \(justSwipedRef\.current \|\| suppressClickRef\.current\) \{[^}]*e\.preventDefault\(\);/, "a swipe still never doubles as a tap");
  for (const label of ['"Previous announcement"', '"Next announcement"']) assert.ok(c.includes(`aria-label=${label}`), label);
  // Controls are siblings of the slide, never inside the card link.
  const slide = c.indexOf("<HomepageBulletin bulletin={bulletins[index]} />");
  assert.ok(slide > 0 && slide < c.indexOf('aria-label="Previous announcement"'));
});
