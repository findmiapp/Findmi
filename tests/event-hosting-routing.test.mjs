// Business Manager → Host an Event routing: "What Are You Adding?" →
// Hosting An Event goes DIRECTLY to the canonical Host an Event page
// (/account/event/new?business_id=…), which itself offers Import Event or
// Create Manually. No second Import / Create Manually chooser in between.
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

const read = (f) => readFileSync(f, "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const B = "src/app/(public)/account/business/[id]";
const EI = await import(`../${B}/v2/eventIntent.ts`);
const CA = await import(`../${B}/v2/createActions.ts`);
const LINKS = await import("../src/lib/manager-links.ts");
const MC = await import(`../${B}/v2/managementCardItems.ts`);
const PAGE = code(read(`${B}/(manager)/page.tsx`));
const CHOOSER = code(read(`${B}/v2/AddEventChooser.tsx`));
const HOST = read("src/app/(public)/account/event/new/page.tsx");
const CANONICAL = "/account/event/new?business_id=b1";

test("1. Hosting An Event in the chooser links straight to the canonical Host an Event page", () => {
  assert.equal(EI.addEventIntentHref("/account/business/b1", "hosting", "b1"), CANONICAL);
  assert.equal(EI.hostEventHref("b1"), CANONICAL);
  assert.match(CHOOSER, /href=\{addEventIntentHref\(basePath, o\.intent, businessId\)\}/);
  assert.match(PAGE, /<AddEventChooser basePath=\{basePath\} businessId=\{id\} /);
});

test("2. no second Import / Create Manually chooser renders on the Business Manager; old ?compose=hosting links redirect", () => {
  assert.doesNotMatch(PAGE, /id="add-hosting"/);
  assert.doesNotMatch(PAGE, /composeIntent === "hosting" && \(/);
  assert.doesNotMatch(PAGE, /eventImportHref\(id, "hosting"\)/);
  assert.doesNotMatch(PAGE, />Create Manually</);
  assert.match(PAGE, /if \(composeIntent === "hosting"\) redirect\(hostEventHref\(id\)\);/);
  assert.equal(EI.parseComposeIntent("hosting"), "hosting", "older links still resolve — to the redirect");
});

test("3. the canonical Host an Event page still offers Import Event and the manual form", () => {
  assert.match(HOST, /Host an Event<\/h1>/);
  assert.match(HOST, /Already Have the Details\?/);
  assert.match(HOST, /href=\{`\/account\/business\/\$\{businessContext\.id\}\/import-event\?intent=hosting`\}/);
  assert.match(HOST, /Import Event/);
  assert.match(HOST, /Or Create Manually/);
  assert.match(HOST, /<input type="hidden" name="business_id" value=\{businessContext\.id\} \/>/);
});

test("4. Appearing At An Event keeps its separate flow (request-to-join composer, Import intent=participating)", () => {
  assert.equal(EI.addEventIntentHref("/account/business/b1", "appearing", "b1"), "/account/business/b1?tab=findmi-here&compose=1#going-somewhere");
  assert.match(PAGE, /const composeOpen = composeIntent === "appearing";/);
  assert.match(PAGE, /\{\(addHasDraft \|\| composeOpen\) && \(\s*<div id="going-somewhere"/);
  assert.match(PAGE, /href=\{eventImportHref\(id, "appearing"\)\}/);
  assert.equal(EI.eventImportHref("b1", "appearing"), "/account/business/b1/import-event?intent=participating");
});

test("5. every Business Manager hosting entry point resolves the same way", () => {
  // Quick Access + Add Event, the create sheet's Add An Event, and the
  // add-event link all open the one chooser; Hosting then goes to CANONICAL.
  const cards = MC.managementCards("b1");
  const events = cards.find((c) => c.key === "events");
  assert.equal(events.addHref, LINKS.managerHref("b1", "add-event"));
  assert.equal(LINKS.managerHref("b1", "add-event"), "/account/business/b1?tab=findmi-here&add=event");
  const actions = CA.businessCreateActions("/account/business/b1", "b1");
  assert.equal(actions.event.href, "/account/business/b1?tab=findmi-here&add=event");
  assert.match(PAGE, /initialOpen=\{addParam === ADD_EVENT_PARAM \|\| addParam === "presence"\}/, "the add-event link opens the chooser");
  // Any direct "Host an Event" action uses the same canonical page.
  for (const a of Object.values(actions)) {
    if (/\/account\/event\/new/.test(a.href)) assert.equal(a.href, CANONICAL, a.key);
  }
  // The Event import page's "create manually instead" for hosting goes there too.
  assert.match(read(`${B}/import-event/page.tsx`), /hosting: `\/account\/event\/new\?business_id=\$\{encodeURIComponent\(id\)\}`/);
});
