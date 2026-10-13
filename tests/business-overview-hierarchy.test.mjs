// B1 Business Command Center — /account/business/[id] Home (BusinessHome.tsx).
// Supersedes the earlier Information-Hierarchy pass's order. The Home for ONE
// Business now reads: Status → Create on Findmi → Needs Attention → Coming Up
// (Happening Now first) → Opportunities → Performance → Your Findmi Link.
// No JSX rendering harness exists in this node:test suite, so render order
// is proven with source-level guards (indexOf comparisons), the attention
// rules by calling buildNeedsAttentionItems itself, and every Create on
// Findmi destination against the receiving route's own source.
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

const BD = await import("../src/lib/business-dashboard.ts");

const B = "src/app/(public)/account/business/[id]";
const read = (p) => readFileSync(p, "utf8");
const HOME = read(`${B}/v2/BusinessHome.tsx`);
const PAGE = read(`${B}/page.tsx`);
const ADD = read(`${B}/v2/AddToPresence.tsx`);
const EVENT_NEW = read("src/app/(public)/account/event/new/page.tsx");
const ACCOUNT_HOME = read("src/app/(public)/account/page.tsx");

const at = (marker) => {
  const i = HOME.indexOf(marker);
  assert.ok(i !== -1, `expected marker: ${marker}`);
  return i;
};

test("Home hierarchy: Status → Create on Findmi → Needs Attention → Coming Up → Opportunities → Performance → Findmi Link", () => {
  const order = [
    'aria-label="Business status"',
    'aria-labelledby="create-on-findmi"',
    'aria-labelledby="needs-attention"',
    'aria-labelledby="coming-up"',
    'aria-labelledby="happening-now"',
    "<HomeOpportunities",
    'aria-labelledby="performance-snapshot"',
    'aria-labelledby="findmi-link"',
  ].map(at);
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], `marker #${i} out of order (${order.join(", ")})`);
  assert.doesNotMatch(HOME, /<Greeting \/>|aria-label="Quick actions"/, "the greeting header and the old quick-action row are replaced");
});

test("Status is compact and never repeats the identity the context bar already shows", () => {
  const status = HOME.slice(at('aria-label="Business status"'), at('aria-labelledby="create-on-findmi"'));
  assert.doesNotMatch(status, /businessName|SupabaseImage|"Pro"|"Free"/);
  assert.match(status, /<Chip tone=\{status\.tone\}>\{status\.label\}<\/Chip>/);
  assert.match(status, /\{publicationStatus === "live" \? "View Public Profile" : "Preview"\}/);
  for (const s of ["live", "pending_review", "draft", "paused", "rejected"]) assert.match(HOME, new RegExp(`\\b${s}: \\{ label:`));
  assert.match(HOME, /pending_review: \{ label: "Pending Review", tone: "amber", line: "Visible to you now, live in discovery after Findmi reviews it\." \}/);
  // the page's separate Pending Review banner moved into this row (not shown twice)
  assert.doesNotMatch(PAGE, /business\.publication_status === "pending_review" && \(/);
  assert.match(PAGE, /publicationStatus=\{business\.publication_status\}/);
  assert.match(PAGE, /businessSlug=\{business\.slug \?\? null\}/);
});

test("Create on Findmi: exactly the five approved labels, in order, with the Findmi icon system", () => {
  const block = HOME.slice(HOME.indexOf("export function createOnFindmiActions"), HOME.indexOf("] as const;"));
  const labels = [...block.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Where I\u2019ll Be", "Host an Event", "Add To Product Catalog", "At a Location", "Create A QR Code"]);
  assert.deepEqual([...block.matchAll(/icon: "([^"]+)"/g)].map((m) => m[1]), ["compass", "calendar", "tag", "pin", "qr"]);
  assert.match(HOME, /<NavIcon name=\{action\.icon\}/);
  assert.doesNotMatch(HOME + ADD, /Go Somewhere|Host Something/);
});

test("route integrity: every Create on Findmi destination is an existing Business-scoped flow that reads its params", () => {
  const block = HOME.slice(HOME.indexOf("export function createOnFindmiActions"), HOME.indexOf("] as const;"));
  // Where I'll Be → Findmi Here (upcoming) request-to-join composer
  assert.match(block, /href: `\$\{basePath\}\?tab=findmi-here&compose=1`/);
  assert.match(PAGE, /const composeOpen = composeParam === "1";/);
  assert.match(PAGE, /\{\(addHasDraft \|\| composeOpen\) && \(\s*<div id="going-somewhere"/);
  // Host an Event → Event creation with this Business as host
  assert.match(block, /href: `\/account\/event\/new\?business_id=\$\{encodeURIComponent\(businessId\)\}`/);
  assert.match(EVENT_NEW, /business_id: businessIdParam,/);
  assert.match(EVENT_NEW, /<input type="hidden" name="business_id" value=\{businessContext\.id\} \/>/);
  // Add To Product Catalog → Products' Add Product panel
  assert.match(block, /href: `\$\{basePath\}\?tab=products&compose=1`/);
  assert.match(PAGE, /<details className="group" open=\{addProductHasDraft \|\| composeOpen\}>/);
  // At a Location → Findmi Here Locations add panel
  assert.match(block, /href: `\$\{basePath\}\?tab=findmi-here&view=locations&add=1`/);
  assert.match(PAGE, /addOpen=\{addParam === "1"\}/);
  // Create A QR Code → the Business QR creator route
  assert.match(block, /href: `\$\{basePath\}\/qr\/new`/);
  assert.ok(existsSync(`${B}/qr/new/page.tsx`));
  assert.match(read(`${B}/qr/new/page.tsx`), /await requireBusinessMember\(id\);/);
  // none of these routes is Pro-gated on the page (core Findmi stays open)
  for (const tab of ["products", "qr"]) assert.match(PAGE, new RegExp(`\\{activeTab === "${tab}" && \\(`));
});

test("the existing + Add sheet uses the same labels; the Event page titles a Business-hosted Event 'Host an Event'", () => {
  for (const t of ["Host an Event", "Where I’ll Be", "At a Location"]) assert.ok(ADD.includes(`"${t}"`), t);
  assert.match(EVENT_NEW, /\{businessContext \? "Host an Event" : "Add An Event"\}/);
  assert.match(PAGE, /<p className="text-card-title font-bold text-primary">Where I&rsquo;ll Be<\/p>/);
});

// ── Needs Attention rules (real function) ─────────────────────────────────
const base = { businessId: "biz", hasPrimaryMarket: true, pendingMarketRequestText: null, upcomingAppearances: [], newOrderCount: 0, profileIncomplete: false };

test("complete profile, geography assigned, nothing pending → no attention items (section omitted)", () => {
  assert.deepEqual(BD.buildNeedsAttentionItems(base), []);
  assert.match(HOME, /\{attention\.length > 0 && \(\s*<section aria-labelledby="needs-attention">/);
});

test("a Business with NO geography is valid: no attention item and never 'won't appear in general discovery'", () => {
  assert.deepEqual(BD.buildNeedsAttentionItems({ ...base, hasPrimaryMarket: false }), []);
  const src = read("src/lib/business-dashboard.ts");
  assert.doesNotMatch(src, /general discovery|No Findmi Market is assigned yet/);
  assert.doesNotMatch(HOME + PAGE, /won['’]t appear in general discovery|won&rsquo;t appear in general discovery/);
  // Settings: a missing area is described as optional, never as lost discovery
  assert.match(PAGE, /A Findmi area is optional\. It places your business in that area&rsquo;s browsing\./);
  assert.doesNotMatch(PAGE, /receives general discovery|live in the meantime/);
});

test("the owner's own pending Market Request is still surfaced", () => {
  const items = BD.buildNeedsAttentionItems({ ...base, hasPrimaryMarket: false, pendingMarketRequestText: "Hudson Valley" });
  assert.deepEqual(items.map((i) => i.id), ["pending-market"]);
  assert.match(items[0].message, /"Hudson Valley" is awaiting review/);
});

test("incomplete profile → Complete Profile; either description satisfies it (no new requirements)", () => {
  const items = BD.buildNeedsAttentionItems({ ...base, profileIncomplete: true });
  assert.deepEqual(items.map((i) => [i.id, i.actionLabel, i.actionHref]), [["incomplete-profile", "Complete Profile", "/account/business/biz?tab=profile"]]);
  assert.match(PAGE, /const profileIncomplete = !business\.logo_url \|\| !\(business\.short_description \|\| business\.description\) \|\| !currentCategoryId;/);
});

test("new Orders are ONE attention item (the duplicate Order tile is gone); pending Event Invitations join the list", () => {
  assert.equal(BD.buildNeedsAttentionItems({ ...base, newOrderCount: 2 })[0].message, "You have 2 new orders to review.");
  assert.doesNotMatch(HOME, /New Order\{newOrderCount === 1/);
  assert.doesNotMatch(HOME, /\(pendingInvitationCount > 0 \|\| newOrderCount > 0\) &&/);
  assert.match(HOME, /\.\.\.\(pendingInvitationCount > 0\s*\?\s*\[\s*\{\s*id: "event-invitations",/);
});

// ── Coming Up / Opportunities / Performance ───────────────────────────────
test("Coming Up: live cards first, then ≤4 rows; one empty line only when nothing is live or upcoming", () => {
  assert.match(PAGE, /comingUp=\{homeActivities\.comingUp\.slice\(0, 4\)\}/);
  assert.match(PAGE, /liveActivities=\{homeActivities\.live\}/);
  const coming = HOME.slice(at('aria-labelledby="coming-up"'), at("<HomeOpportunities"));
  assert.ok(coming.indexOf("<LiveCard") < coming.indexOf("<UpcomingRow"));
  assert.match(coming, /liveNow\.length === 0 && \(/);
  assert.match(coming, /Nothing scheduled yet\. Add <span[^>]*>Where I&rsquo;ll Be<\/span> or/);
});

test("Opportunities: existing data only, compact empty state, never Pro-gated", () => {
  assert.match(HOME, /<HomeOpportunities basePath=\{basePath\} items=\{opportunityItems\} \/>/);
  const opp = HOME.slice(HOME.indexOf("function HomeOpportunities"), HOME.indexOf("function SectionTitle"));
  assert.doesNotMatch(opp, /\bpro\b/);
  assert.match(opp, /Explore Opportunities/);
  assert.match(opp, /Tell Findmi What You Need/);
  assert.doesNotMatch(opp, /Browse Opportunities/, "no large promo card");
});

test("Performance: unchanged metric set and Free/Pro gating", () => {
  const perf = HOME.slice(at('aria-labelledby="performance-snapshot"'), HOME.indexOf("</section>", at('aria-labelledby="performance-snapshot"')));
  for (const l of ["Profile Views", "Actions", "QR Scans"]) assert.match(perf, new RegExp(`<MetricTile label="${l}"`));
  assert.match(perf, /linkLabel=\{pro \? "View Performance" : "Unlock Full Analytics"\}/);
  assert.match(HOME, /const change = pro \? metric\.changeLabel : null;/);
});

test("BusinessHome stays a pure presentation component; /account Home is not turned into a Business dashboard", () => {
  assert.doesNotMatch(HOME, /\bawait\b|\bfetch\(|\bsupabase\b|createClient/i);
  assert.doesNotMatch(HOME, /isBusinessPro|plan_tier|plan_expires_at/);
  assert.doesNotMatch(ACCOUNT_HOME, /createOnFindmiActions|BusinessHome/);
});
