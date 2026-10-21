// Business Manager navigation performance — the architecture that makes tab
// switches feel like an app: a persistent shell (route-group layout), a
// content view that streams behind a destination-keyed Suspense boundary, one
// authorization pass per request, per-destination data, and instant tap
// feedback. Source-level guards plus real calls into the pure navigation
// helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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

const B = "src/app/(public)/account/business/[id]";
const read = (p) => readFileSync(p, "utf8");
const PAGE = read(`${B}/(manager)/page.tsx`);
const LAYOUT = read(`${B}/(manager)/layout.tsx`);
const NAV = await import(`../${B}/v2/business-nav.ts`);

test("persistent shell: the manager page and its layout live in a route group, URLs unchanged", () => {
  assert.ok(existsSync(`${B}/(manager)/page.tsx`) && existsSync(`${B}/(manager)/layout.tsx`));
  assert.ok(!existsSync(`${B}/page.tsx`), "no second page at the old path");
  // Standalone flows keep their own chrome and are not wrapped by the shell.
  for (const f of ["qr/new/page.tsx", "qr/page.tsx", "import-event/page.tsx", "pro-request/page.tsx"]) assert.ok(existsSync(`${B}/${f}`), f);
  assert.match(LAYOUT, /<BusinessAppShell \{\.\.\.shell\}>\{children\}<\/BusinessAppShell>/);
  assert.doesNotMatch(LAYOUT, /activeSection/, "the layout never fixes the highlight — the client navigation derives it");
  assert.doesNotMatch(PAGE, /<BusinessAppShell/, "the page returns the content view only");
});

test("the page returns the content view directly; the tap itself paints the destination skeleton", () => {
  assert.match(PAGE, /return <ManagerContent id=\{id\} rawSearchParams=\{rawSearchParams\} \/>;/);
  assert.match(PAGE, /async function ManagerContent\(/);
  assert.doesNotMatch(PAGE, /<Suspense/, "a server Suspense fallback delays the reveal of fast content by ~300ms (React's fallback throttle)");
  // The page wrapper itself reads nothing but the URL.
  const wrapper = PAGE.slice(PAGE.indexOf("export default async function ManageBusinessPage"), PAGE.indexOf("async function ManagerContent("));
  assert.doesNotMatch(wrapper, /getManagerCore|admin\.from|await get[A-Z]/);
  assert.match(wrapper, /LEGACY_TAB_REDIRECTS\[tab\]/, "redirect-only keys bounce before anything renders");
  assert.ok(!existsSync(`${B}/(manager)/loading.tsx`), "loading.tsx does not re-trigger on ?tab= changes");
  const skel = read(`${B}/v2/ManagerSkeleton.tsx`);
  assert.match(skel, /data-manager-skeleton/);
  assert.doesNotMatch(skel, /animate-spin/, "a placeholder shaped like the destination, not a spinner");
  assert.match(read(`${B}/v2/ManagerNav.tsx`), /<ManagerSkeleton tab=\{pendingTab\} \/>/);
});

test("destination grouping: Growth tabs are one destination, Performance + QR are one, everything else is its own", () => {
  assert.equal(NAV.destinationGroup("growth"), "growth");
  assert.equal(NAV.destinationGroup("opportunities"), "growth");
  assert.equal(NAV.destinationGroup("performance"), "performance");
  assert.equal(NAV.destinationGroup("qr"), "performance");
  for (const t of ["overview", "moments", "findmi-here", "more", "profile", "settings", "orders", "inquiries", "products"]) assert.equal(NAV.destinationGroup(t), t);
  // Unknown / null / referral render Overview, legacy keys follow their redirect — the highlight matches what renders.
  assert.equal(NAV.canonicalTab(null), "overview");
  assert.equal(NAV.canonicalTab("bogus"), "overview");
  assert.equal(NAV.canonicalTab("referral"), "overview");
  assert.equal(NAV.canonicalTab("gallery"), "profile");
  assert.equal(NAV.canonicalTab("followers"), "performance");
  assert.equal(NAV.sectionForTab("opportunities"), "growth");
  assert.equal(NAV.sectionForTab("qr"), "performance");
});

test("one authorization pass per request: shared manager context + a request-scoped getUser", () => {
  const ctx = read(`${B}/managerContext.ts`);
  assert.match(ctx, /export const getManagerCore = cache\(/);
  assert.match(ctx, /export const getShellExtras = cache\(/);
  assert.match(ctx, /requireBusinessMember\(id\)/);
  // Authorization and the Business row share one round trip.
  assert.match(ctx, /Promise\.all\(\[\s*requireBusinessMember/);
  assert.match(PAGE, /await getManagerCore\(id\)/, "the page authorizes for itself — a layout is not re-run on a ?tab= switch");
  assert.match(LAYOUT, /getManagerShellProps\(id\)/);
  const server = read("src/lib/supabase/server.ts");
  assert.match(server, /export const getCurrentUser = cache\(/);
  assert.match(read("src/lib/permissions.ts"), /await getCurrentUser\(\)/);
  // Sub-page shell loader reuses the same context (no second copy of the logic).
  assert.match(read(`${B}/opportunities/loadBusinessShell.ts`), /getManagerCore/);
});

test("data is per destination: heavy reads only run where they render", () => {
  // Gating predicates exist and are used.
  for (const g of ["const onHome", "const onUpcoming", "const onPast", "const onFindUs", "const onProducts", "const onSettings", "const onOrders", "const onMore"]) assert.ok(PAGE.includes(g), g);
  // Markets / orders / followers / QR / products / events are each gated.
  assert.match(PAGE, /whenP\(onHome \|\| onOrders \|\| \(onMore && pro\), \(\) => getBusinessOrderSummary/);
  assert.match(PAGE, /whenP\(onOrders, \(\) => getBusinessOrderList/);
  assert.match(PAGE, /const marketsPromise = whenP\(onHome \|\| onSettings, loadMarkets/);
  assert.match(PAGE, /whenP\(onHome \|\| onPerformance, \(\) => getBusinessFollowerSummary/);
  assert.match(PAGE, /whenP\(onUpcoming \|\| onProducts, loadQrByEntity/);
  assert.match(PAGE, /whenP\(onProducts \|\| onFindUs, loadProducts/);
  assert.match(PAGE, /const needsSchedule = onHome \|\| onUpcoming/);
  assert.match(PAGE, /const needsHosted = onHome \|\| onUpcoming \|\| onPast/);
  // The platform-wide Event/occurrence reads (Add picker + orphan participations) are Upcoming-only.
  assert.match(PAGE, /if \(onUpcoming\) \{\s*\/\/ Picker: upcoming, non-demo events/);
  // No unconditional heavy await remains at the top level of the content view.
  const body = PAGE.slice(PAGE.indexOf("async function ManagerContent("));
  const unconditional = [...body.matchAll(/^ {2}const [^=]+= await (get[A-Za-z]+)\(/gm)].map((m) => m[1]);
  assert.deepEqual(unconditional.filter((n) => n !== "getManagerCore"), [], "every other read goes through whenP/rowsWhen");
  // Independent reads start together.
  assert.match(PAGE, /\] = await Promise\.all\(\[\s*whenP\(onProfile \|\| onProducts, \(\) => getCategories\(\)/);
  assert.match(PAGE, /const dashboardPromise = whenP\(/, "Home's dashboard resolves behind only the inputs it needs");
});

test("instant tap feedback: pending highlight + skeleton on the same frame, safe under rapid taps", () => {
  const nav = read(`${B}/v2/ManagerNav.tsx`);
  assert.match(nav, /"use client"/);
  assert.match(nav, /onClick=\{\(e\) => isPlainLeftClick\(e\) && start\(item\.tab\)\}/, "primary nav marks the tap pending");
  assert.match(nav, /enteringNew/, "a different destination swaps in its skeleton at once");
  assert.match(nav, /setTimeout\(clear, PENDING_TIMEOUT_MS\)/, "a tap that never lands can't strand the highlight");
  assert.match(nav, /addEventListener\("popstate", clear\)/, "Back/Forward drops a pending tap");
  assert.match(nav, /e\.defaultPrevented/, "delegated link clicks react only after Next has claimed them");
  assert.doesNotMatch(nav, /onClickCapture/, "capture-phase handling swapped the link out from under Next (full page load)");
  assert.match(nav, /button === 0 && !e\.metaKey/, "modified clicks never start a pending state");
  const tabs = read(`${B}/v2/OptimisticTabs.tsx`);
  assert.match(tabs, /e\.button !== 0 \|\| e\.metaKey/);
  for (const f of ["GrowthNav", "PresenceViews", "MomentsView", "OpportunitiesView", "PerformanceViews"]) {
    assert.match(read(`${B}/v2/${f}.tsx`), /<OptimisticTabs/, `${f} highlights on tap`);
  }
  assert.match(read(`${B}/v2/BusinessAppShell.tsx`), /<ManagerContentFrame>\{children\}<\/ManagerContentFrame>/);
});
