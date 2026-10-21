// Business Manager redesign — navigation, Growth, Moments, Performance/QR and
// Findmi Here availability. Source-level guards for wiring + real calls into
// the pure modules (lib/growth.ts, lib/business-availability-domain.ts, the
// nav definition).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

const NAV = await import("../src/app/(public)/account/business/[id]/v2/business-nav.ts");
const G = await import("../src/lib/growth.ts");
const AV = await import("../src/lib/business-availability-domain.ts");
const PUBLIC_NAV = await import("../src/lib/navigation.ts");

const B = "src/app/(public)/account/business/[id]";
const read = (p) => readFileSync(p, "utf8");
const PAGE = read(`${B}/page.tsx`);

// ── Navigation ────────────────────────────────────────────────────────────
test("mobile bottom nav: Home · Findmi Here · Moments · Performance · More; Products and Growth stay reachable", () => {
  const mobile = NAV.BUSINESS_NAV.filter((n) => !n.desktopOnly).map((n) => n.label);
  assert.deepEqual(mobile, ["Home", "Findmi Here", "Moments", "Performance", "More"]);
  const desktop = NAV.BUSINESS_NAV.map((n) => n.label);
  assert.ok(desktop.includes("Products") && desktop.includes("Growth"), "the desktop rail keeps both");
  const more = read(`${B}/v2/MoreMenu.tsx`);
  assert.match(more, /tab=products/);
  assert.match(more, /tab=growth/);
  // Deep links keep working: Opportunities, QR and the old keys stay valid.
  for (const k of ["opportunities", "qr", "products", "growth", "moments", "performance"]) assert.ok(NAV.VALID_BUSINESS_TAB_KEYS.has(k), k);
});

test("shell: Opportunities lives under Growth; QR under Performance; Moments has its own section", () => {
  const shell = read(`${B}/v2/BusinessAppShell.tsx`);
  assert.match(shell, /growth|opportunities/);
  const fn = shell.slice(shell.indexOf("export function sectionForTab"));
  assert.match(fn, /moments/);
  assert.match(fn, /qr/);
  for (const p of ["opportunities/[recipientId]", "opportunities/explore/[listingId]", "opportunities/goals/new"]) {
    assert.match(read(`${B}/${p}/page.tsx`), /activeSection="growth"/, p);
  }
});

test("Findmi Here uses the Findmi mark, not a map pin — in the Business nav and in the public nav", () => {
  const icons = read("src/components/NavIcon.tsx");
  assert.match(icons, /case "findmi":/);
  assert.match(read(`${B}/v2/BusinessAppShell.tsx`), /presence: <NavIcon name="findmi"/);
  assert.match(read("src/lib/navigation.ts"), /href === "\/find" && \(item\.icon_key === "pin" \|\| !item\.icon_key\)/);
  assert.ok(PUBLIC_NAV.NAV_ICON_KEYS.includes("findmi"));
});

// ── Growth ────────────────────────────────────────────────────────────────
const audit = (o = {}) => ({ status: null, goalCount: 0, challengeCount: 0, completedAt: null, updatedAt: null, ...o });
const idea = (id, targeted, response = null) => ({ id, targeted, response });

test("Growth: with no signal it is a setup state; All-Brands ideas are not shown, targeted ones always are", () => {
  const none = G.summarizeGrowth({ audit: audit(), activeGoalCount: 0, matchesAwaitingResponse: 0, matchesInProgress: 0 });
  assert.equal(none.setupState, "not_started");
  assert.equal(none.hasSignal, false);
  const ideas = [idea("all", false), idea("mine", true)];
  assert.deepEqual(G.eligibleGrowthIdeas(ideas, none.hasSignal).map((i) => i.id), ["mine"]);
  const withGoal = G.summarizeGrowth({ audit: audit({ status: "in_progress", goalCount: 1 }), activeGoalCount: 0, matchesAwaitingResponse: 0, matchesInProgress: 0 });
  assert.equal(withGoal.hasSignal, true);
  assert.deepEqual(G.eligibleGrowthIdeas(ideas, withGoal.hasSignal).map((i) => i.id), ["all", "mine"]);
  // An active Opportunity goal alone is signal too.
  assert.equal(G.summarizeGrowth({ audit: null, activeGoalCount: 2, matchesAwaitingResponse: 0, matchesInProgress: 0 }).hasSignal, true);
});

test("Growth: every number is a real count; setup copy explains value rather than demanding completion", () => {
  const s = G.summarizeGrowth({ audit: audit({ status: "in_progress", goalCount: 2, challengeCount: 1 }), activeGoalCount: 1, matchesAwaitingResponse: 2, matchesInProgress: 3 });
  assert.deepEqual([s.goalCount, s.preferencesAnswered, s.preferencesTotal, s.matchesAwaitingResponse, s.matchesInProgress], [3, 2, 5, 2, 3]);
  assert.match(G.GROWTH_SETUP_COPY.body, /Set your goals and preferences so Findmi can surface more relevant opportunities/);
  assert.doesNotMatch(read("src/lib/growth.ts"), /Residential Sampling|Workplace Activation/, "no hard-coded universal ideas");
  const panel = read(`${B}/v2/GrowthPanel.tsx`);
  assert.match(panel, /Your Goals/);
  assert.match(panel, /Opportunities/);
  assert.match(panel, /Preferences/);
  assert.match(panel, /GROWTH_SETUP_COPY\.improve/);
  assert.doesNotMatch(panel, /Math\.random|mock|demo/i);
});

test("Home no longer shows the Brand Audit card; the audit becomes Growth Setup (route and data unchanged)", () => {
  const home = read(`${B}/v2/BusinessHome.tsx`);
  assert.doesNotMatch(home, /Brand Audit/);
  assert.match(read(`${B}/brand-audit/page.tsx`), /Growth Setup/);
  assert.ok(readdirSync(`${B}/brand-audit`).includes("page.tsx"), "/brand-audit still exists");
  assert.match(PAGE, /<GrowthView\s/);
  assert.match(PAGE, /getIdeasForBusiness\(id\)/);
});

// ── Moments ───────────────────────────────────────────────────────────────
test("Moments tab: media-first grid over the existing Moments tables, posted as this Business", () => {
  assert.match(PAGE, /activeTab === "moments" && <MomentsView/);
  const lib = read("src/lib/business-moments.ts");
  assert.match(lib, /\.eq\("author_business_id", businessId\)/);
  assert.match(lib, /from\("journal_entries"\)/);
  assert.match(lib, /\/my-world\/journal\/new\?business=\$\{id\}&postAs=\$\{id\}/, "reuses the existing composer");
  const view = read(`${B}/v2/MomentsView.tsx`);
  assert.match(view, /Add A Moment/);
  assert.match(view, /aspect-\[4\/5\]/);
  assert.match(read(`${B}/v2/BusinessHome.tsx`), /<MomentsStrip/);
  assert.match(view, /if \(moments\.length === 0\) return null;/, "Home strip omitted when empty");
});

// ── Performance / QR ──────────────────────────────────────────────────────
test("Performance: QR codes are a prominent view; Create QR Code is one tap; the list is searchable and filterable", () => {
  const views = read(`${B}/v2/PerformanceViews.tsx`);
  assert.match(views, /Create QR Code/);
  assert.match(views, /Manage QR Codes/);
  assert.match(views, /QR Codes/);
  assert.match(PAGE, /<PerformanceViewTabs basePath=\{basePath\} view="overview" \/>/);
  assert.match(PAGE, /<QrSnapshot/);
  const list = read(`${B}/QrCampaignGroups.tsx`);
  assert.match(list, /"use client"/);
  assert.match(list, /placeholder="Search QR Codes"/);
  assert.match(list, /STATUS_FILTERS/);
  assert.match(list, /KIND_FILTERS/);
  assert.match(list, /c\.contextSummary/);
  // Free owners keep QR (never plan-gated); Pro analytics gate is unchanged.
  assert.match(PAGE, /UpgradeLockedTab[\s\S]{0,200}tabKey="performance"/);
  assert.doesNotMatch(read(`${B}/v2/PerformanceViews.tsx`), /UpgradeLockedTab|\bpro\b/);
});

test("QR creator: searchable pickers; Entire Event vs Specific Occurrence; server verifies the occurrence belongs to the event", () => {
  const creator = read(`${B}/qr/new/QrIntelligentCreator.tsx`);
  assert.match(creator, /QrOptionPicker/);
  assert.match(creator, /Entire Event/);
  assert.match(creator, /Specific Occurrence/);
  assert.match(creator, /contextOccurrenceId: contextType === "event" && occurrenceScope === "specific" \? occurrenceId : null/);
  const picker = read(`${B}/qr/new/QrOptionPicker.tsx`);
  assert.match(picker, /type="search"/);
  assert.match(picker, /options\.length > 5/);
  const actions = read("src/app/(public)/account/business/qr-manager-actions.ts");
  assert.match(actions, /occurrence\.event_id !== eventId/, "an occurrence of a different Event is refused");
  assert.match(actions, /event_occurrence_id: eventOccurrenceId/, "stored in the existing column");
  const mgr = read("src/lib/qr-manager.ts");
  assert.match(mgr, /from\("event_occurrences"\)/);
  assert.match(mgr, /"All Dates"/, "an Entire-Event QR says so in the list");
  // Destination validation + tracking untouched.
  assert.match(actions, /validateCustomDestination\(destinationUrl\)/);
  assert.match(actions, /resolveAndVerifyDestination\(admin, input\.businessId/);
});

// ── Findmi Here availability ──────────────────────────────────────────────
test("availability: relationship, products, timing and dates validate; an Until/Range needs real dates", () => {
  const ok = (o) => AV.validateAvailabilityRequest({ locationId: "loc", relationship: "stocked", productIds: [], timing: "ongoing", startsOn: null, endsOn: null, note: null, ...o });
  assert.equal(ok({}).ok, true);
  assert.equal(ok({ relationship: "owned" }).ok, false);
  assert.equal(ok({ locationId: "" }).ok, false);
  assert.equal(ok({ timing: "temporary" }).ok, false, "Until needs an end date");
  assert.deepEqual(ok({ timing: "temporary", endsOn: "2026-12-31" }).value.endsOn, "2026-12-31");
  assert.equal(ok({ timing: "date_range", startsOn: "2026-12-31", endsOn: "2026-12-01" }).ok, false, "end before start");
  assert.equal(ok({ timing: "ongoing", startsOn: "2026-01-01", endsOn: "2026-02-01" }).value.endsOn, null, "ongoing ignores stray dates");
  assert.deepEqual(ok({ productIds: ["a", "a", "b"] }).value.productIds, ["a", "b"]);
  assert.equal(ok({ productIds: Array.from({ length: 26 }, (_, i) => `p${i}`) }).ok, false);
  assert.equal(AV.availabilityTiming(null, null), "ongoing");
  assert.equal(AV.availabilityTiming(null, "2026-12-31"), "temporary");
  assert.equal(AV.availabilityTiming("2026-12-01", "2026-12-31"), "date_range");
  assert.equal(AV.isAvailabilityInEffect(null, "2026-10-01", "2026-10-21"), false, "expired temporary rows stop showing");
  assert.equal(AV.isAvailabilityInEffect("2026-11-01", null, "2026-10-21"), false, "not yet started");
  assert.equal(AV.isAvailabilityInEffect(null, null, "2026-10-21"), true);
});

test("availability: owner submissions are pending/business-sourced, scoped to the Business, and need owner/manager", () => {
  const owner = read("src/lib/business-availability-owner.ts");
  assert.match(owner, /status: "pending"/);
  assert.match(owner, /source: "business"/);
  assert.match(owner, /\.eq\("business_id", businessId\)\.in\("id", v\.productIds\)/, "only this Business's own Products");
  assert.match(owner, /ALREADY_OUR_LOCATION_ERROR/, "Our Locations collision rule kept");
  assert.match(owner, /\.eq\("id", availabilityId\)\s*\.eq\("business_id", businessId\)/, "an id from another Business never matches");
  const actions = read(`${B}/availability-actions.ts`);
  assert.match(actions, /"use server"/);
  assert.match(actions, /requireBusinessMember\(businessId\)/);
  assert.match(actions, /membership\.viaAdmin \|\| isManagingRole\(membership\.role\)/);
  const view = read(`${B}/v2/AvailableAtView.tsx`);
  for (const w of ["Where", "How are you there?", "What?", "When?", "Pending Review"]) assert.ok(view.includes(w) || read("src/lib/business-availability-domain.ts").includes(w), w);
  assert.match(read(`${B}/v2/PresenceViews.tsx`), /key: "find-us", label: "Find Us At"/);
  assert.match(read("src/app/admin/(protected)/businesses/availability-actions.ts"), /adminReviewFindUsAt/);
});

test("availability migration (first draft guards) — superseded by the audited checks below", () => {
  const file = readdirSync("supabase/migrations").find((f) => f.endsWith("_business_availability_details.sql"));
  assert.ok(file);
  const sql = read(`supabase/migrations/${file}`).replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /\bdrop\s+(table|column)\b|\bdelete\s+from\b|\btruncate\b/i);
  assert.match(sql, /add column if not exists status text not null default 'live'/);
  assert.match(sql, /add column if not exists source text not null default 'admin'/);
  assert.match(sql, /create table if not exists public\.business_location_availability_products/);
  assert.match(sql, /grant select on public\.business_location_availability_products to anon, authenticated/);
  const lib = read("src/lib/business-location-availability.ts");
  assert.match(lib, /eq\("status", "live"\)/);
  assert.match(lib, /starts_on\.is\.null,starts_on\.lte/);
  assert.match(lib, /isMissingDetailColumn/, "fails safe before the migration is applied");
});

// ── Follow-up pass: create sheet, terminology, public detail, edit, migration, QR integrity ──
const QV2 = await import("../src/lib/qr-v2.ts");
const CA = await import("../src/app/(public)/account/business/[id]/v2/createActions.ts");

test("the full + Create sheet keeps every action incl. Add a Moment, plus Opportunities; Home's Quick Create is separate", () => {
  const labels = CA.orderedCreateActions("/b", "x").map((a) => a.label);
  assert.deepEqual(labels, ["Where I’ll Be", "Host an Event", "At a Location", "Add To Product Catalog", "Add a Moment", "Create A QR Code"]);
  assert.equal(CA.businessCreateActions("/b", "x").moment.href, "/my-world/journal/new?business=x&postAs=x", "the one existing composer");
  const sheet = read(`${B}/v2/AddToPresence.tsx`);
  assert.match(sheet, /Find An Opportunity/);
  assert.match(sheet, /Tell Findmi Your Goals/);
  assert.doesNotMatch(sheet, /journal\/new/, "no second composer / no re-typed route in the sheet");
  assert.match(read(`${B}/v2/BusinessHome.tsx`), /const quick = \[create\.where, create\.event, create\.product, create\.qr\];/);
});

test("no user-facing 'Brand Audit' wording remains (routes, tables and code names are unchanged)", () => {
  const files = [
    "src/components/admin/BusinessIntelligencePanel.tsx",
    "src/app/admin/(protected)/opportunities/intelligence/page.tsx",
    "src/app/admin/(protected)/opportunities/ideas/page.tsx",
    "src/app/admin/(protected)/page.tsx",
    "src/lib/brand-intelligence-domain.ts",
    "src/lib/brand-audit-domain.ts",
    "src/lib/brand-audit.ts",
    `${B}/brand-audit/page.tsx`,
    `${B}/brand-audit/BrandAuditFlow.tsx`,
  ];
  for (const f of files) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /["'`>][^"'`<>]*\bBrand Audits?\b[^"'`<>]*["'`<]|>\s*Brand Audit|Completed Audits|"No Audit"|Audit Complete/, f);
  }
  assert.ok(readdirSync(`${B}`).includes("brand-audit"), "route kept");
});

test("public Find Us At / Brands Available Here: Live + in-effect only, compact detail, no Pending/Declined exposure", () => {
  const lib = read("src/lib/business-location-availability.ts");
  assert.match(lib, /eq\("status", "live"\)/);
  assert.match(lib, /isAvailabilityInEffect/);
  assert.match(lib, /products!inner\(id, name, slug, is_active\)/);
  assert.match(lib, /eq\("products\.is_active", true\)/);
  const detail = read("src/components/AvailabilityDetail.tsx");
  assert.match(detail, /AVAILABILITY_RELATIONSHIP_LABELS\[detail\.relationship\]/);
  assert.match(detail, /availabilityWhenLabel/);
  assert.match(detail, /<details/, "progressive disclosure for more than two products");
  assert.match(detail, /if \(isDefault\) return null;/, "an entry with no extra detail looks exactly as before");
  // extends the existing surfaces rather than adding a parallel one
  assert.match(read("src/components/FindUsAt.tsx"), /<AvailabilityDetailLine detail=\{l\.detail\}/);
  assert.match(read("src/app/(public)/location/[slug]/LocationPublicView.tsx"), /<AvailabilityDetailLine detail=\{b\.detail\}/);
  assert.doesNotMatch((detail + read("src/components/FindUsAt.tsx")).replace(/\/\*[\s\S]*?\*\//g, ""), /status|pending|declined/i, "public components never see review state");
});

test("owner edit: any real change returns the entry to Pending Review; no-op saves don't; the place can't move", () => {
  const owner = read("src/lib/business-availability-owner.ts");
  const fn = owner.slice(owner.indexOf("export async function updateOwnerAvailability"), owner.indexOf("export async function removeOwnerAvailability"));
  assert.match(fn, /if \(unchanged\) return \{ ok: true, changed: false \};/);
  assert.match(fn, /status: "pending", source: "business"/);
  assert.match(fn, /\.eq\("id", availabilityId\)\s*\.eq\("business_id", businessId\)/, "scoped to this Business");
  assert.doesNotMatch(fn, /\.update\(\{[^}]*location_id/, "location is never updated");
  assert.match(fn, /Restore the previous links/);
  const view = read(`${B}/v2/AvailableAtView.tsx`);
  assert.match(view, /function PlaceForm/);
  assert.match(view, /updateAvailabilityAction\(businessId, initial\.id, fields\)/);
  assert.match(view, /Saving changes sends this back to Findmi for review/);
  assert.match(read(`${B}/availability-actions.ts`), /updateAvailabilityAction/);
});

test("availability migration (audited): live-only public policies, integrity triggers, checks, partial review index", () => {
  const sql = read("supabase/migrations/20261026000000_business_availability_details.sql").replace(/--.*$/gm, "");
  assert.match(sql, /create policy business_location_availability_public_read[\s\S]*?using \(status = 'live'\)/, "pending/declined never public");
  assert.match(sql, /drop policy if exists business_location_availability_public_read/);
  assert.match(sql, /where a\.id = availability_id and a\.status = 'live'/, "product links follow their parent");
  assert.match(sql, /check \(starts_on is null or ends_on is null or ends_on >= starts_on\)/);
  assert.match(sql, /char_length\(note\) <= 200/);
  assert.match(sql, /business_location_availability_guard/);
  assert.match(sql, /cannot be changed/);
  assert.match(sql, /bl\.business_id = new\.business_id and bl\.location_id = new\.location_id/, "Our Locations collision at the DB");
  assert.match(sql, /p\.business_id = a\.business_id/, "product must belong to the same Business");
  assert.match(sql, /create index if not exists business_location_availability_pending_idx[\s\S]*?where status = 'pending'/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /references public\.business_location_availability\(id\) on delete cascade/);
  assert.match(sql, /references public\.products\(id\) on delete cascade/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]*\b(anon|authenticated)\b/i, "writes stay service-role only");
  assert.doesNotMatch(sql, /\bdrop\s+(table|column)\b|\bdelete\s+from\b|\btruncate\b/i);
  const ls = readdirSync("supabase/migrations").sort();
  assert.equal(ls.at(-1), "20261026000000_business_availability_details.sql", "ordered after every existing migration");
});

test("QR occurrence authority: all-dates participation → every date; selected dates → only approved ones; Appearance-only → its date", () => {
  const occ = [{ id: "o1" }, { id: "o2" }, { id: "o3" }];
  const base = { occurrences: occ, eventLevel: null, appearances: [], approvedOccurrenceIds: new Set() };
  const ids = (o) => [...QV2.allowedQrOccurrenceIds({ ...base, ...o })].sort();
  assert.deepEqual(ids({ eventLevel: { participation_scope: "all_dates" } }), ["o1", "o2", "o3"]);
  assert.deepEqual(ids({ eventLevel: { participation_scope: null } }), ["o1", "o2", "o3"], "legacy rows = all dates");
  assert.deepEqual(ids({ eventLevel: { participation_scope: "selected_dates" }, approvedOccurrenceIds: new Set(["o2"]) }), ["o2"]);
  assert.deepEqual(ids({ eventLevel: { participation_scope: "selected_dates" } }), [], "selected dates with none approved");
  assert.deepEqual(ids({ appearances: [{ event_occurrence_id: "o3" }] }), ["o3"]);
  assert.deepEqual(ids({ appearances: [{ event_occurrence_id: null }] }), ["o1", "o2", "o3"], "an event-level Appearance covers the Event");
  assert.deepEqual(ids({ approvedOccurrenceIds: new Set(["o1", "ghost"]) }), ["o1"], "ids that aren't this Event's dates are ignored");
  assert.deepEqual(ids({}), [], "no participation → nothing");
});

test("QR integrity wiring: occurrence must belong to the Event AND be an allowed date; whole-Event and legacy QRs unchanged; scans keep attribution", () => {
  const actions = read("src/app/(public)/account/business/qr-manager-actions.ts");
  assert.match(actions, /occurrence\.event_id !== eventId \|\| occurrence\.status === "cancelled"/);
  assert.match(actions, /getBusinessQrAllowedOccurrences\(admin, input\.businessId/);
  assert.match(actions, /const eligible = await getBusinessQrEligibleEvents\(admin, input\.businessId\);[\s\S]{0,200}isn't associated with this business/, "Event authority checked first");
  assert.match(actions, /contextOccurrenceId\?: string \| null/);
  assert.match(actions, /let eventOccurrenceId: string \| null = null;/, "whole-Event QRs store null, exactly as before");
  const mgr = read("src/lib/qr-manager.ts");
  assert.match(mgr, /getBusinessQrAllowedOccurrences\(admin, businessId, rawByEvent\)/, "options only list allowed dates");
  const q = read("src/app/q/[code]/route.ts");
  assert.match(q, /event_occurrence_id: row\.event_occurrence_id/, "qr_scan keeps event + occurrence attribution");
  assert.match(q, /subjectType: "event_occurrence"/);
});
