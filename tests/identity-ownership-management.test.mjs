// Identity, creation permissions, ownership/management and Admin control.
// Real functions where pure; the Admin ownership actions run against a
// recording fake client (redirect stubbed to throw) so the tests prove
// exactly which relationships each action changes — and which it never
// touches. No network, no Production data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/cache") return { url: "data:text/javascript,export const revalidatePath=()=>{};", shortCircuit: true };
    if (specifier === "next/navigation")
      return { url: "data:text/javascript,export function redirect(u){const e=new Error('REDIRECT');e.url=u;throw e;}export function notFound(){throw new Error('NOT_FOUND')}", shortCircuit: true };
    if (specifier === "@/lib/admin/requireAdminSupabase")
      return { url: "data:text/javascript,export async function requireAdminSupabase(){return globalThis.__ADMIN;}", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const C = await import("../src/lib/capabilities.ts");
const PLAN = await import("../src/lib/admin/ownership-plan.ts");
const OA = await import("../src/app/admin/(protected)/ownership/actions.ts");
const EM = await import("../src/lib/admin/entity-management.ts");
const AH = await import("../src/lib/account-home.ts");
const S = await import("../src/lib/save-organization.ts");
const read = (p) => readFileSync(p, "utf8");

const EVENT = "7d348430-bb8a-4be5-8cd3-dfcd93de69f0";
const FREE_BEAN = "74e85bce-7a8f-4200-8814-9b948c1786ca";
const PERSONAL_MEMBER = "a0000000-0000-4000-8000-0000000000aa";
const LOC = "c0000000-0000-4000-8000-000000000001";
const CLAIM = "d0000000-0000-4000-8000-000000000001";

/** Recording fake of the service-role client. `rows[table]` answers
 * select().maybeSingle(); every write and RPC is recorded in `ops`. */
function fakeAdmin(rows = {}, { rpcError = null } = {}) {
  const ops = [];
  return {
    ops,
    rpc: async (name, args) => (ops.push({ op: "rpc", name, args }), { data: null, error: rpcError }),
    from(table) {
      const state = { table, op: "select", filters: {}, patch: null };
      const chain = {
        select: () => chain,
        eq: (c, v) => ((state.filters[c] = v), chain),
        in: (c, v) => ((state.filters[c] = v), chain),
        update: (patch) => ((state.op = "update"), (state.patch = patch), chain),
        delete: () => ((state.op = "delete"), chain),
        insert: async (row) => (ops.push({ op: "insert", table, row }), { error: null }),
        maybeSingle: async () => ({ data: (rows[table] ?? null) }),
        then: (res) => {
          if (state.op !== "select") ops.push({ op: state.op, table, filters: { ...state.filters }, patch: state.patch });
          return res({ data: rows[table] ?? null, error: null });
        },
      };
      return chain;
    },
  };
}
async function run(fn) {
  try {
    await fn();
  } catch (e) {
    if (e.message === "REDIRECT") return e.url;
    throw e;
  }
  return null;
}
const fd = (entries) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

// ── IDENTITY / CREATION ────────────────────────────────────────────────

test("capability matrix: Personal never publishes Events/Products/Where I'll Be; Pages do", () => {
  assert.deepEqual([...C.CAPABILITIES.personal], ["moment", "business", "location"]);
  for (const what of ["event", "product", "where_ill_be"]) assert.equal(C.can("personal", what), false, what);
  for (const what of ["event", "product", "where_ill_be", "location", "moment"]) assert.equal(C.can("business", what), true, what);
  assert.equal(C.can("location", "event"), true);
  assert.equal(C.can("location", "child_location"), true);
  assert.equal(C.can("location", "where_ill_be"), false, "no Where I'll Be for a Location just for symmetry");
  assert.equal(C.can("location", "product"), false, "Location-owned Products need a schema change (products.business_id)");
});

test("Event creation context: Personal refused; Business host OK; Location Owner/Manager OK; Staff refused", () => {
  assert.deepEqual(C.eventCreationContext({ businessId: null, businessEligible: false, locationId: null, locationRole: null }), { ok: false, reason: "personal" });
  assert.deepEqual(C.eventCreationContext({ businessId: "b", businessEligible: true, locationId: null, locationRole: null }), { ok: true, identity: "business" });
  assert.deepEqual(C.eventCreationContext({ businessId: null, businessEligible: false, locationId: LOC, locationRole: "manager" }), { ok: true, identity: "location" });
  assert.deepEqual(C.eventCreationContext({ businessId: null, businessEligible: false, locationId: LOC, locationRole: "staff" }), { ok: false, reason: "location_role" });
});

test("server enforcement: createMemberEvent refuses Personal / non-managers, regardless of how the flow was entered", () => {
  const actions = read("src/app/(public)/account/event/actions.ts");
  assert.match(actions, /const creationContext = eventCreationContext\(\{/);
  assert.match(actions, /locationRole = \(await requireLocationMember\(locationHintId\)\)\.role;/);
  assert.match(actions, /if \(!creationContext\.ok\) \{\s*\n\s*fail\(/);
  const page = read("src/app/(public)/account/event/new/page.tsx");
  assert.match(page, /if \(!businessContext && !managedLocation\) return <ChooseEventPage userId=\{user\.id\} \/>;/);
  assert.match(page, /Choose who is publishing this Event\./);
});

test("Account Home UX Correction pass: Create Event IS restored as a universal global entry point — never a Personal publishing path", () => {
  const menu = read("src/components/QuickCreateMenu.tsx");
  assert.match(menu, /href="\/account\/event\/new"/);
  assert.match(menu, /label="Create Event"/);
  // Still a plain Link, same mechanism as Add A Business/Add A Location —
  // no second auth/redirect system invented for it.
  assert.match(menu, /<MenuLink\s*\n\s*href="\/account\/event\/new"/);
  // Signed-out: the route itself explains + offers Log In/Create Account,
  // never a bare redirect, never anonymous or Personal publication.
  const page = read("src/app/(public)/account/event/new/page.tsx");
  assert.match(page, /if \(!user\) \{/);
  assert.match(page, /Events on Findmi are published through a Business or Location Page\./);
  assert.match(page, /href=\{`\/login\?next=\$\{encodeURIComponent\(next\)\}`\}/);
  assert.match(page, /href=\{`\/signup\?next=\$\{encodeURIComponent\(next\)\}`\}/);
  // The chooser shows real Page identity media (logo/cover), same
  // rounded-square + fallback language as AccountContextSwitcher — never
  // a second image system — and still never a Personal creation form.
  assert.match(page, /business:businesses\(id, name, logo_url\)/);
  assert.match(page, /location:locations\(id, name, logo_url, cover_image_url\)/);
  assert.match(page, /rounded-xl border border-black\/\[0\.06\] bg-white/);
  assert.match(page, /\{p\.name\.charAt\(0\)\.toUpperCase\(\)\}/);
  // No eligible Page: guidance, never a dead end.
  assert.match(page, /Events on Findmi are published by a Page you manage\./);
  assert.match(page, /Add A Business/);
  assert.match(page, /Add A Location/);
});

test("Products and Where I'll Be still require a Business; Personal can create Moments and submit Businesses/Locations", () => {
  const biz = read("src/app/(public)/account/business/actions.ts");
  assert.match(biz, /export async function createMemberProduct[\s\S]{0,200}requireBusinessMemberWithDetails\(/);
  assert.match(biz, /export async function addManualAppearance[\s\S]{0,300}requireAuthorizedBusinessMember\(/);
  const menu = read("src/components/QuickCreateMenu.tsx");
  // Consolidation pass: Add Business opens the ONE canonical onboarding (search first).
  for (const href of ["/my-world/journal/new", "/join/brand", "/account/location/new"]) assert.ok(menu.includes(`href="${href}"`), href);
});

// ── LOCATION SUBMISSION ────────────────────────────────────────────────

const LOC_ACTIONS = read("src/app/(public)/account/location/actions.ts");
const LOC_START = LOC_ACTIONS.indexOf("export async function createMemberLocation");
const createLoc = LOC_ACTIONS.slice(LOC_START, LOC_ACTIONS.indexOf("\n}\n", LOC_START));

test("submitting a Location grants management ONLY of that new Location, ONLY in a managed context (no create_owned_location)", () => {
  assert.doesNotMatch(createLoc, /rpc\("create_owned_location"/);
  // "Pending does not mean unmanageable": a Business owner/manager adding
  // its own place (or a parent-Location manager) keeps managing it while
  // it awaits review. A generic "just adding it" submission grants nothing.
  assert.equal((createLoc.match(/from\("location_members"\)/g) ?? []).length, 1);
  assert.match(createLoc, /if \(user && \(businessId \|\| parentLocationId\)\) \{/);
  // Unlisted + pending review through the one moderation rule (lib/location-review.ts).
  assert.match(createLoc, /\.from\("locations"\)\s*\.insert\(\{[\s\S]*?\.\.\.newLocationModeration\("member"\),/);
});

test("location_claim_requests/'manage' intent infrastructure stays intact even though this UI never sends it any more", () => {
  // Location Creation + Icon Consistency pass — the chooser removed the
  // "I Manage This Location" choice from this form entirely (context is
  // resolved before the form now, and selecting a Business/adding
  // generically never requests management — see
  // tests/location-creation-context.test.mjs). The server-side claim
  // mechanism itself is untouched/not deleted, just unreachable from
  // this one UI now.
  assert.match(createLoc, /if \(intent === "manage"\) \{[\s\S]*?\.from\("location_claim_requests"\)\.insert\(\{\s*\n\s*user_id: user!\.id,\s*\n\s*location_id: locationId,/);
  assert.match(createLoc, /if \(!intent\) fail\(/, "a choice is required");
  assert.equal(C.parseLocationIntent("manage"), "manage");
  assert.equal(C.parseLocationIntent("adding"), "adding");
  assert.equal(C.parseLocationIntent("owner"), null);
  const page = read("src/app/(public)/account/location/new/page.tsx");
  assert.doesNotMatch(page, /I Manage This Location|Your Connection To This Location/);
  assert.match(page, /I&rsquo;m Just Adding It To Findmi|I'm Just Adding It To Findmi/);
  assert.match(page, /<input type="hidden" name="intent" value="adding" \/>/);
});

test("child Location: parent must be managed (Owner/Manager); hierarchy is set, management is not", () => {
  assert.match(createLoc, /canManageParent = isPageManagerRole\(\(await requireLocationMember\(parentLocationId\)\)\.role\);/);
  assert.match(createLoc, /\.\.\.\(parentLocationId \? \{ parent_location_id: parentLocationId \} : \{\}\)/);
  // Permissions never read the hierarchy.
  assert.doesNotMatch(read("src/lib/permissions.ts"), /parent_location_id/);
  assert.match(read("src/app/(public)/account/location/[id]/page.tsx"), /href=\{`\/account\/location\/new\?parent_location_id=\$\{id\}`\}/);
});

test("a Business adding a Location keeps the Business↔Location relationship independent of management", () => {
  assert.match(createLoc, /const linked = await linkBusinessLocation\(admin, businessId, locationId\);/);
  assert.doesNotMatch(createLoc, /business_members"\)\.insert/);
});

test("a failed management-claim insert is never silently dropped, never retried as a duplicate, and never deletes the Location", () => {
  // The error is captured, not ignored.
  assert.match(createLoc, /const \{ error: claimError \} = await admin\.from\("location_claim_requests"\)\.insert\(\{/);
  assert.match(createLoc, /if \(claimError\) \{\s*\n\s*claimRequestError = /);
  // Exactly one insert attempt — no retry-as-duplicate-request loop.
  assert.equal((createLoc.match(/\.from\("location_claim_requests"\)\.insert\(/g) ?? []).length, 1);
  // The already-created Location is never rolled back to "simulate"
  // atomicity — it stays, for Admin review, regardless of the claim outcome.
  assert.doesNotMatch(createLoc, /\.from\("locations"\)\.delete\(/);
  // Every redirect branch (Business-linked, child-of-a-Location, default)
  // accounts for the failure instead of unconditionally claiming success.
  const afterCreate = createLoc.slice(createLoc.indexOf("revalidatePath(\"/account\");"));
  const businessBranch = afterCreate.slice(afterCreate.indexOf("if (businessId) {"), afterCreate.indexOf("if (parentLocationId) {"));
  assert.match(businessBranch, /claimRequestError/);
  const parentBranch = afterCreate.slice(afterCreate.indexOf("if (parentLocationId) {"), afterCreate.indexOf("if (!user) redirect"));
  assert.match(parentBranch, /claimRequestError/);
  // Consolidation pass: success lands on the "Location submitted" next step.
  assert.match(afterCreate, /if \(claimRequestError\) redirect\(`\/account\?error=\$\{encodeURIComponent\(claimRequestError\)\}`\);/);
  assert.match(afterCreate, /new URLSearchParams\(\{ submitted: locationId, context: "generic" \}\)/);
  // The truthful message says what actually happened: the Location is in,
  // the request for management specifically is what failed.
  assert.match(createLoc, /Location was submitted, but your management request could not be recorded/);
});

// ── ADMIN: EVENT OWNERSHIP & MANAGEMENT ────────────────────────────────

test("Free Bean plan: host already Free Bean → only the Personal management relationship is removed, never called a reassignment", () => {
  const plan = PLAN.planEventReassignment({
    eventName: "Free Bean / Free Coffee NYC Pop-Up Cafe",
    currentHost: { id: FREE_BEAN, name: "Free Bean" },
    nextHost: { id: FREE_BEAN, name: "Free Bean" },
    directManagers: [{ memberId: PERSONAL_MEMBER, label: "Personal Account" }],
    removeDirect: true,
  });
  assert.equal(plan.hostBusinessId, FREE_BEAN);
  assert.deepEqual(plan.removeMemberIds, [PERSONAL_MEMBER]);
  assert.match(plan.message, /Free Bean stays the managing Page/);
  assert.match(plan.message, /Direct management will be removed for: Personal Account\./);
  assert.match(plan.message, /will not recreate the Event or change its dates, Location, participating Businesses, media, URLs, analytics or Findmi Here appearances/);
  // The Free Bean scenario never implies the host is changing — the host
  // was already Free Bean, so this must read as a removal, not a
  // reassignment.
  assert.equal(plan.hostChanged, false);
  assert.equal(plan.actionable, true);
  assert.equal(plan.title, "Remove Direct Management For Free Bean / Free Coffee NYC Pop-Up Cafe?");
});

test("plan: an actual host change always uses Reassign language, regardless of manager removal", () => {
  const changed = PLAN.planEventReassignment({
    eventName: "Free Bean / Free Coffee NYC Pop-Up Cafe",
    currentHost: { id: FREE_BEAN, name: "Free Bean" },
    nextHost: { id: PERSONAL_MEMBER, name: "A Different Business" },
    directManagers: [],
    removeDirect: false,
  });
  assert.equal(changed.hostChanged, true);
  assert.equal(changed.actionable, true);
  assert.equal(changed.title, "Reassign This Event To A Different Business?");
  assert.match(changed.message, /will become the managing Page/);

  const noPriorHost = PLAN.planEventReassignment({
    eventName: "New Event",
    currentHost: null,
    nextHost: { id: FREE_BEAN, name: "Free Bean" },
    directManagers: [],
    removeDirect: false,
  });
  assert.equal(noPriorHost.hostChanged, true);
  assert.equal(noPriorHost.title, "Reassign This Event To Free Bean?");
});

test("plan: same host + nothing selected for removal is not actionable (cannot submit)", () => {
  const plan = PLAN.planEventReassignment({
    eventName: "Free Bean / Free Coffee NYC Pop-Up Cafe",
    currentHost: { id: FREE_BEAN, name: "Free Bean" },
    nextHost: { id: FREE_BEAN, name: "Free Bean" },
    directManagers: [{ memberId: PERSONAL_MEMBER, label: "Personal Account" }],
    removeDirect: false,
  });
  assert.equal(plan.hostChanged, false);
  assert.deepEqual(plan.removeMemberIds, []);
  assert.equal(plan.actionable, false, "nothing would change — the UI must disable submission");
  const controls = read("src/app/admin/(protected)/ownership/OwnershipControls.tsx");
  assert.match(controls, /disabled=\{!plan \|\| !plan\.actionable\}/);
});

test("Event reassign form: direct-management removal is opt-in, never preselected by default", () => {
  const controls = read("src/app/admin/(protected)/ownership/OwnershipControls.tsx");
  assert.match(controls, /const \[removeDirect, setRemoveDirect\] = useState\(false\);/);
  assert.doesNotMatch(controls, /useState\(directManagers\.length > 0\)/);
  // The confirm action's own label must match what the plan says it is.
  assert.match(controls, /confirmLabel=\{plan\.hostChanged \? "Confirm Reassignment" : "Confirm Removal"\}/);
});

test("reassignment changes ONLY events.host_business_id + the chosen event_members row; the Event graph is untouched", async () => {
  const admin = fakeAdmin({ businesses: { id: FREE_BEAN }, event_members: { id: PERSONAL_MEMBER, role: "owner" } });
  globalThis.__ADMIN = admin;
  const url = await run(() => OA.reassignEventManagingPage(EVENT, fd([["business_id", FREE_BEAN], ["remove_member_id", PERSONAL_MEMBER]])));
  assert.match(url, /ownership=reassigned/);
  assert.deepEqual(admin.ops, [
    { op: "update", table: "events", filters: { id: EVENT }, patch: { host_business_id: FREE_BEAN } },
    { op: "rpc", name: "remove_event_owner", args: { p_event_id: EVENT } },
  ]);
  const touched = new Set(admin.ops.map((o) => o.table).filter(Boolean));
  for (const t of ["event_occurrences", "event_businesses", "appearances", "locations", "event_gallery_images", "analytics_events"]) assert.equal(touched.has(t), false, t);
});

test("reassignment without removing direct managers keeps them; a missing Business changes nothing", async () => {
  let admin = fakeAdmin({ businesses: { id: FREE_BEAN } });
  globalThis.__ADMIN = admin;
  await run(() => OA.reassignEventManagingPage(EVENT, fd([["business_id", FREE_BEAN]])));
  assert.deepEqual(admin.ops.map((o) => `${o.op}:${o.table ?? o.name}`), ["update:events"]);
  admin = fakeAdmin({ businesses: null });
  globalThis.__ADMIN = admin;
  const url = await run(() => OA.reassignEventManagingPage(EVENT, fd([["business_id", FREE_BEAN]])));
  assert.match(url, /ownership_error=/);
  assert.deepEqual(admin.ops, []);
});

test("Event panel reads management separately from participation", async () => {
  const rows = { event_members: [], event_businesses: [{ business_id: FREE_BEAN, status: "approved", business: { name: "Free Bean" } }], event_claim_requests: [], businesses: { id: FREE_BEAN, name: "Free Bean", slug: "free-bean" }, profiles: [] };
  const admin = fakeAdmin(rows);
  admin.auth = { admin: { getUserById: async () => ({ data: { user: null } }) } };
  const m = await EM.getEventManagement(admin, EVENT, FREE_BEAN);
  assert.equal(m.managingPage.name, "Free Bean");
  assert.deepEqual(m.participants.map((p) => p.name), ["Free Bean"]);
  assert.deepEqual(m.directManagers, []);
  const panel = read("src/app/admin/(protected)/ownership/OwnershipPanels.tsx");
  assert.match(panel, /Participating Businesses \(not management\)/);
  assert.match(panel, /Ownership &amp; Management/);
  assert.match(read("src/app/admin/(protected)/ownership/OwnershipControls.tsx"), /confirmLabel=\{plan\.hostChanged \? "Confirm Reassignment" : "Confirm Removal"\}/);
  assert.match(read("src/app/admin/(protected)/ownership/OwnershipControls.tsx"), /entity="businesses"/, "searchable existing Businesses only");
});

// ── ADMIN: LOCATION REVIEW ─────────────────────────────────────────────

test("Approve + Assign: existing claim approval + listing approval; hierarchy untouched", async () => {
  const admin = fakeAdmin();
  globalThis.__ADMIN = admin;
  await run(() => OA.reviewLocationSubmission(LOC, fd([["decision", "approve_assign"], ["claim_id", CLAIM]])));
  assert.deepEqual(admin.ops, [
    { op: "rpc", name: "approve_location_claim", args: { p_claim_id: CLAIM } },
    { op: "update", table: "locations", filters: { id: LOC }, patch: { is_demo: false } },
  ]);
});

test("Approve + Leave Unclaimed is valid: the request is declined, the Location approved, nobody assigned", async () => {
  const admin = fakeAdmin();
  globalThis.__ADMIN = admin;
  await run(() => OA.reviewLocationSubmission(LOC, fd([["decision", "approve_unclaimed"], ["claim_id", CLAIM]])));
  assert.equal(admin.ops.length, 2);
  assert.equal(admin.ops[0].table, "location_claim_requests");
  assert.equal(admin.ops[0].patch.status, "rejected");
  assert.deepEqual(admin.ops[1], { op: "update", table: "locations", filters: { id: LOC }, patch: { is_demo: false } });
  assert.ok(!admin.ops.some((o) => o.table === "location_members" || o.name === "approve_location_claim"));
});

test("Decline Request leaves the Location itself unchanged; approval alone never grants management", async () => {
  let admin = fakeAdmin();
  globalThis.__ADMIN = admin;
  await run(() => OA.reviewLocationSubmission(LOC, fd([["decision", "decline_request"], ["claim_id", CLAIM]])));
  assert.deepEqual(admin.ops.map((o) => o.table), ["location_claim_requests"]);
  admin = fakeAdmin();
  globalThis.__ADMIN = admin;
  await run(() => OA.reviewLocationSubmission(LOC, fd([["decision", "publish"]])));
  assert.deepEqual(admin.ops, [{ op: "update", table: "locations", filters: { id: LOC }, patch: { is_demo: false } }]);
  for (const d of ["approve_assign", "approve_unclaimed", "decline_request", "publish"]) assert.equal(PLAN.isLocationReviewDecision(d), true);
  assert.equal(PLAN.planLocationReview("publish").approveRequest, false);
});

test("removing a Location Owner uses the existing owner RPC; managers are a plain row delete; nothing touches hierarchy", async () => {
  let admin = fakeAdmin({ location_members: { role: "owner" } });
  globalThis.__ADMIN = admin;
  await run(() => OA.removeLocationManager(LOC, CLAIM));
  assert.deepEqual(admin.ops, [{ op: "rpc", name: "remove_location_owner", args: { p_location_id: LOC } }]);
  admin = fakeAdmin({ location_members: { role: "manager" } });
  globalThis.__ADMIN = admin;
  await run(() => OA.removeLocationManager(LOC, CLAIM));
  assert.deepEqual(admin.ops.map((o) => `${o.op}:${o.table}`), ["delete:location_members"]);
  assert.doesNotMatch(read("src/app/admin/(protected)/ownership/actions.ts"), /parent_location_id: /);
});

// ── ACCOUNT HOME ───────────────────────────────────────────────────────

const HOME = read("src/app/(public)/account/page.tsx");

test("Pages I Manage = real Pages (Businesses, Locations); directly-managed Events are listed separately", () => {
  const pages = HOME.slice(HOME.indexOf("const managedEntities: ManagedEntity[] = ["), HOME.indexOf("const managedEvents"));
  assert.doesNotMatch(pages, /myEvents/);
  assert.match(pages, /\.\.\.myLocations\.map\(/);
  assert.match(pages, /\.\.\.myBusinesses\.map\(/);
  assert.match(HOME, /<HomeSection id="events-you-manage" title="Events You Manage">/);
  assert.match(HOME, /managedEvents\.slice\(0, MANAGING_PREVIEW\)/);
  assert.match(HOME, /const MANAGING_PREVIEW = 3;/);
});

test("Saved labels: All Saved · Want · Must Do · Have & Been (no implementation-level wording)", () => {
  assert.deepEqual(S.SAVED_COLLECTIONS.map((c) => c.label), ["All Saved", "Want", "Must Do", "Have & Been"]);
  assert.doesNotMatch(JSON.stringify(S.SAVED_COLLECTIONS), /Interested|Must Dos/);
});

test("Products You Might Like: deterministic Brand diversity (max 2 per Brand while alternatives exist)", () => {
  const p = (id, b) => ({ id, business_id: b });
  const ranked = [p(1, "A"), p(2, "A"), p(3, "A"), p(4, "A"), p(5, "B"), p(6, "C"), p(7, "B"), p(8, "B")];
  assert.deepEqual(AH.diversifyByBrand(ranked, 6).map((x) => x.id), [1, 2, 5, 6, 7, 3]);
  // No alternatives → one Brand may fill the rail (never empties it).
  assert.deepEqual(AH.diversifyByBrand([p(1, "A"), p(2, "A"), p(3, "A")], 3).map((x) => x.id), [1, 2, 3]);
  assert.deepEqual(AH.diversifyByBrand(ranked, 6), AH.diversifyByBrand(ranked, 6), "no randomness");
});

test("From Pages You Follow has no misleading See All; Upcoming Events stays follow-derived", () => {
  assert.match(HOME, /<HomeSection id="from-brands" title="From Pages You Follow">/);
  assert.match(HOME, /getPersonalUpcoming\(\s*\{\s*savedEvents: \[\],/);
});

test("Personal nav: no operator 'Schedule'; the route remains and Business More keeps a Schedule entry", () => {
  const shell = read("src/app/(public)/account/PersonalAppShell.tsx");
  assert.doesNotMatch(shell, /key: "schedule"/);
  assert.match(shell, /grid max-w-lg grid-cols-4/);
  // Business Manager Flow pass: More's Schedule is this Business's own schedule.
  assert.match(read("src/app/(public)/account/business/[id]/v2/MoreMenu.tsx"), /href: to\("schedule"\), label: "Schedule"/);
  assert.ok(read("src/app/(public)/account/schedule/page.tsx").length > 0);
});
