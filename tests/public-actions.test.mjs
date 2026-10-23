// Public Actions — the shared public entity action bar (Business, Location,
// Event): entity-controlled actions (0–3), canonical action types and their
// routing, custom-label rules, the configured/legacy resolution, the save path,
// Opportunities about an entity, the sign-in continuation and acting-Business
// flow, removal of the old "For Your Business" block, and the Growth / Inquiry
// corrections. In-memory fake client; no network, no database. The 360 / 390 /
// 412px layouts are checked in the browser QA pass; their guards are below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fakeDb } from "./helpers/fake-postgrest.mjs";

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

const D = await import("../src/lib/public-actions-domain.ts");
const S = await import("../src/lib/public-actions.ts");
const L = await import("../src/lib/business-targets.ts");
const read = (p) => readFileSync(p, "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const BAR = "src/components/public-actions/EntityActionBar.tsx";
const EDITOR = "src/components/public-actions/PublicActionsEditor.tsx";
const ACTIONS = "src/app/(public)/account/public-actions-actions.ts";
const BIZ = "src/app/(public)/business/[slug]/BusinessPublicView.tsx";
const LOC = "src/app/(public)/location/[slug]/LocationPublicView.tsx";
const EVT = "src/app/(public)/event/[slug]/EventPublicView.tsx";
const V2 = "src/app/(public)/account/business/[id]/v2";
const MIGRATION = "supabase/migrations/20261109000000_entity_public_actions.sql";

const u = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const B_ROSE = u(1), B_MOCKTAIL = u(2), L_SOHO = u(10), L_OTHER = u(11), E_MARKET = u(20), O_SOHO = u(30), O_EVENT = u(31), O_CLOSED = u(32);
const cfg = (type, extra = {}) => ({ type, label: null, enabled: true, opportunityListingId: null, ...extra });
const ALL = { generalInquiry: true, participation: true, website: "https://example.com" };

// ── 0 / 1 / 2 / 3 per kind (1–7) ───────────────────────────────────────────

for (const [kind, three] of [
  ["business", ["booking", "wholesale", "collaboration"]],
  ["location", ["placement", "pop_up", "sampling"]],
  ["event", ["event_participation", "sponsorship", "vending"]],
]) {
  test(`1–6. ${kind}: 0, 1, 2 and 3 actions resolve in order with matching layouts`, () => {
    for (let n = 0; n <= 3; n++) {
      const list = n ? three.slice(0, n).map((t) => cfg(t)) : null;
      const out = S.resolvePublicActions(kind, list, { ...ALL, generalInquiry: false }, []);
      assert.deepEqual(out.map((a) => a.type), three.slice(0, n));
      assert.deepEqual(out.map((a) => a.slot), three.slice(0, n).map((_, i) => i + 1));
      assert.deepEqual(D.actionBarLayout(n), { cols: n, compact: n === 3 });
    }
    assert.equal(D.validatePublicActions(kind, three.map((t) => ({ type: t }))).ok, true);
  });
}

test("7. a fourth action is rejected (validation, render cap and the database)", () => {
  const r = D.validatePublicActions("business", ["booking", "wholesale", "collaboration", "content"].map((type) => ({ type })));
  assert.deepEqual(r, { ok: false, error: "Choose up to 3 actions." });
  assert.equal(S.resolvePublicActions("business", ["booking", "wholesale", "collaboration", "content"].map((t) => cfg(t)), ALL, []).length, 3);
  const sql = read(MIGRATION);
  assert.match(sql, /check \(display_order between 1 and 3\)/);
  assert.match(sql, /create unique index if not exists entity_public_actions_entity_order_key\s+on public\.entity_public_actions \(coalesce\(business_id, location_id, event_id\), display_order\);/);
});

test("8. custom label validation: trimmed, safe, ≤ 20, fits three buttons, Title Case, empty = default", () => {
  assert.deepEqual(D.validateActionLabel("  partner   with us "), { ok: true, value: "Partner With Us" });
  assert.deepEqual(D.validateActionLabel("Book The Trailer"), { ok: true, value: "Book The Trailer" });
  assert.deepEqual(D.validateActionLabel("stock our products"), { ok: true, value: "Stock Our Products" });
  assert.deepEqual(D.validateActionLabel("BBQ Catering"), { ok: true, value: "BBQ Catering" }, "typed capitals are kept");
  assert.deepEqual(D.validateActionLabel("   "), { ok: true, value: null }, "never an empty button — falls back to the default");
  assert.equal(D.validateActionLabel("A very long button label").ok, false, "> 20");
  assert.equal(D.validateActionLabel("<script>").ok, false, "safe text only");
  assert.equal(D.validateActionLabel("https://evil.example").ok, false, "no links");
  assert.equal(D.validateActionLabel("Supercalifragilistic").ok, false, "a word too long for the 3-up button");
  assert.equal(D.validateActionLabel("Abcdef Abcdef Abcdef").ok, false, "would wrap past two lines");
  assert.equal(D.PUBLIC_ACTION_LABEL_MAX, 20);
  for (const t of D.PUBLIC_ACTION_TYPES) assert.ok(D.labelFits(D.PUBLIC_ACTION_DEFAULT_LABELS[t]), `default ${t} fits`);
  assert.match(read(MIGRATION), /char_length\(custom_label\) between 1 and 20 and custom_label = btrim\(custom_label\)/);
});

test("9. a custom label never changes the canonical action", () => {
  const [a] = S.resolvePublicActions("business", [cfg("booking", { label: "Book The Trailer" })], ALL, []);
  assert.deepEqual([a.type, a.route, a.intent, a.label], ["booking", "commercial_inquiry", "booking", "Book The Trailer"]);
  const [b] = S.resolvePublicActions("business", [cfg("general_inquiry", { label: "Wholesale" })], ALL, []);
  assert.deepEqual([b.route, b.intent], ["general_inquiry", null], "a label reading 'Wholesale' is still a General Inquiry");
  assert.doesNotMatch(strip(read(ACTIONS)), /\.label|custom_label/, "the server routes by type only");
});

// ── Routing (10–20) ────────────────────────────────────────────────────────

test("10–18. commercial actions → Commercial Inquiry with that exact intent", () => {
  const cases = [
    ["business", "booking"], ["business", "wholesale"], ["business", "collaboration"], ["business", "sponsorship"], ["business", "sampling"],
    ["business", "activation"], ["location", "pop_up"], ["business", "content"], ["location", "placement"],
  ];
  for (const [kind, type] of cases) {
    assert.ok(D.isActionCompatible(kind, type), `${kind}:${type}`);
    assert.equal(D.actionRoute(type), "commercial_inquiry");
    assert.equal(D.actionIntent(type), type);
    assert.equal(D.actionTitle(type).endsWith(" Inquiry"), true);
  }
  assert.equal(D.actionTitle("pop_up"), "Pop-Up Inquiry");
  const a = read(ACTIONS);
  assert.match(a, /const intent = actionIntent\(action\.type\);/);
  assert.match(a, /addBusinessTarget\(admin, businessId, \{ kind, counterpartyId: entityId, intents: \[intent\], source: "business", userId: ctx\.userId \}\)/);
  assert.match(a, /return \{ ok: true, href: `\$\{href\}&inquire=\$\{intent\}` \};/, "opens that intent's composer");
});

test("entity-type compatibility: no nonsensical combinations", () => {
  assert.equal(D.isActionCompatible("business", "event_participation"), false);
  assert.equal(D.isActionCompatible("location", "event_participation"), false);
  assert.equal(D.isActionCompatible("event", "event_participation"), true);
  assert.equal(D.isActionCompatible("business", "placement"), false);
  assert.equal(D.isActionCompatible("event", "wholesale"), false);
  assert.equal(D.isActionCompatible("location", "wholesale"), false);
  assert.equal(D.validatePublicActions("business", [{ type: "event_participation" }]).ok, false);
  assert.match(read(MIGRATION), /check \(action_type <> 'event_participation' or event_id is not null\)/);
});

test("19. Event Participation → the existing participation application, never an Inquiry", () => {
  assert.equal(D.actionRoute("event_participation"), "event_participation");
  assert.equal(D.actionIntent("event_participation"), null);
  assert.equal(S.resolvePublicActions("event", [cfg("event_participation")], { ...ALL, participation: false }, []).length, 0, "only while applications are open");
  const bar = read(BAR);
  assert.match(bar, /if \(a\.route === "event_participation"\)\s*return <MessageButton key=\{a\.slot\} targetType="event"/);
  assert.match(read("src/components/MessageButton.tsx"), /applyToEventPublic/);
  assert.match(read(EVT), /participation: Boolean\(event\.vendor_applications_enabled && !vendorDeadlinePassed\)/);
});

test("20. Opportunity → one specific existing listing, only while it's open and about this entity", async () => {
  const t = seed();
  const ids = await S.entityOpportunityIds(fakeDb(t), "location", L_SOHO);
  assert.deepEqual(ids, [O_SOHO], "closed / private / elsewhere excluded");
  assert.deepEqual(await S.entityOpportunityIds(fakeDb(t), "business", B_ROSE), [O_EVENT, O_SOHO].sort(), "a Business: at places it operates, for Events it hosts");
  assert.equal(S.resolvePublicActions("location", [cfg("opportunity", { opportunityListingId: O_CLOSED })], ALL, ids).length, 0);
  assert.equal(S.resolvePublicActions("location", [cfg("opportunity", { opportunityListingId: O_SOHO })], ALL, ids)[0].opportunityListingId, O_SOHO);
  assert.match(read(ACTIONS), /href: `\/account\/business\/\$\{businessId\}\/opportunities\/explore\/\$\{action\.opportunityListingId\}`/);
  assert.match(read(MIGRATION), /check \(\(action_type = 'opportunity'\) = \(opportunity_listing_id is not null\)\)/);
});

test("website → the entity's own saved, safe site only (never a free URL)", () => {
  assert.equal(S.resolvePublicActions("business", [cfg("website")], { ...ALL, website: null }, []).length, 0);
  assert.equal(S.resolvePublicActions("business", [cfg("website")], ALL, [])[0].href, "https://example.com");
  assert.doesNotMatch(read(MIGRATION), /_url\b/, "no URL column");
});

// ── Signed out, acting Business, relationships (21–30) ─────────────────────

test("21. the action bar is public: rendered for everyone (no auth gate)", () => {
  const bar = strip(read(BAR));
  assert.doesNotMatch(bar, /useBusinesses|getCurrentUser|authenticated/);
  for (const p of [BIZ, LOC, EVT]) assert.match(read(p), /<EntityActionBar/);
});

test("22. signed-out continuation: sign in returns to this page and this action", () => {
  const bar = read(BAR);
  assert.match(bar, /const next = `\$\{pagePath\}\?act=\$\{isOpps \? "opportunities" : sheet\.slot\}`;/);
  assert.match(bar, /href=\{`\/login\?next=\$\{encodeURIComponent\(next\)\}`\}/);
  assert.match(bar, /href=\{`\/signup\?next=\$\{encodeURIComponent\(next\)\}`\}/);
  assert.match(bar, /act = url\.searchParams\.get\("act"\);/, "back on the page, the action continues");
  assert.match(bar, /url\.searchParams\.delete\("act"\);/, "and the parameter is cleared");
});

test("23/24. one Business continues; several → 'Which Business are you contacting them as?' in the sheet", () => {
  const bar = read(BAR);
  assert.match(bar, /if \(c\.businesses\.length === 1\) setChosen\(c\.businesses\[0\]\.id\);/);
  assert.match(bar, /Which Business are you contacting them as\?/);
  assert.match(bar, /disabled=\{!chosen \|\| pending\}/, "never chosen silently");
  const a = read(ACTIONS);
  assert.match(a, /if \(!ctx\.businesses\.some\(\(b\) => b\.id === businessId\)\) return \{ ok: false, error: "Choose one of your Businesses\." \};/, "the server re-checks the acting Business");
  assert.match(a, /isPageManagerRole\(r\.role\)\)/, "owners / managers only");
  assert.match(a, /\.filter\(\(r\) => !\(kind === "business" && r\.b\.id === entityId\)\)/, "never the entity itself");
});

test("25/26. no managed-Business list and no 'For Your Business' block on public pages", () => {
  assert.equal(existsSync("src/components/relationships/ForYourBusiness.tsx"), false);
  assert.equal(existsSync("src/app/(public)/account/relationship-actions.ts"), false);
  for (const p of [BIZ, LOC, EVT]) {
    const s = read(p);
    assert.doesNotMatch(s, /ForYourBusiness|For Your Business|isn&rsquo;t told|Interested in working/);
  }
  assert.doesNotMatch(strip(read(BAR)), /useBusinesses/, "the bar never lists the viewer's Businesses");
});

test("27. no private Target fields reach the public flow", () => {
  const a = strip(read(ACTIONS));
  assert.doesNotMatch(a, /\.context\b|next_action|internal_notes|target_activity|getTargetActivity/);
  assert.match(a, /status: r\?\.status \? TARGET_STATUS_LABELS\[r\.status\] : null/, "only the acting Business's own state label");
  assert.match(read(BAR), /\{acting\?\.status && acting\.relationshipHref && \(/, "shown only once a Business is acting");
});

test("28/29. an existing Target is reused (intent added), never duplicated", async () => {
  const t = seed();
  t.business_targets = [{ id: u(50), business_id: B_MOCKTAIL, target_location_id: L_SOHO, target_business_id: null, target_event_id: null, status: "in_conversation", intents: ["placement"] }];
  const res = await L.addBusinessTarget(fakeDb(t), B_MOCKTAIL, { kind: "location", counterpartyId: L_SOHO, intents: ["pop_up"], source: "business", userId: null });
  assert.deepEqual([res.ok, res.existing, res.id], [true, true, u(50)]);
  assert.equal(t.business_targets.length, 1);
  assert.deepEqual(t.business_targets[0].intents, ["placement", "pop_up"]);
});

test("30. no automatic Inquiry send — the composer opens; the person writes and sends", () => {
  const a = strip(read(ACTIONS));
  assert.doesNotMatch(a, /sendCommercialInquiry|commercial_inquiries|createConversation/);
  const p = read(`${V2}/InquiryPanel.tsx`);
  assert.match(p, /const arriving = canEdit && initialIntent && choices\.includes\(initialIntent\) \? initialIntent : null;/);
  assert.match(p, /const \[message, setMessage\] = useState\(""\);/, "the message starts empty");
  assert.match(read("src/app/(public)/account/business/[id]/(manager)/page.tsx"), /isCommercialIntent\(rawSearchParams\.inquire\)/);
  assert.match(read(BAR), /Next, write your message\. Nothing is sent until you send it\./);
});

// ── Native Rose / legacy Inquire (31, 32) ──────────────────────────────────

test("31. The Native Rose's INQUIRE is preserved: with nothing configured, a Business keeps its Inquire button", () => {
  const out = S.resolvePublicActions("business", null, { generalInquiry: true, legacyInquireLabel: null }, []);
  assert.deepEqual(out.map((a) => [a.type, a.route, a.label]), [["general_inquiry", "general_inquiry", "Inquire"]]);
  assert.equal(S.resolvePublicActions("business", null, { generalInquiry: true, legacyInquireLabel: "Book a Tasting" }, [])[0].label, "Book a Tasting");
  assert.deepEqual(S.resolvePublicActions("business", null, { generalInquiry: false }, []), [], "Inquiries off → nothing fabricated");
  assert.deepEqual(S.resolvePublicActions("location", null, ALL, []), [], "Locations / Events: nothing fabricated");
  assert.deepEqual(S.resolvePublicActions("event", null, ALL, []), []);
});

test("32. Native Rose canonical flow: General Inquiry is the same existing Inquire form (topics, guest, Findmi routing)", () => {
  const bar = read(BAR);
  assert.match(bar, /if \(a\.route === "general_inquiry"\)\s*return <InquireButton key=\{a\.slot\} targetType=\{kind\} targetId=\{entityId\} targetName=\{entityName\} label=\{a\.label\} topics=\{kind === "business" \? inquiryTopics : undefined\}/);
  const biz = read(BIZ);
  assert.match(biz, /generalInquiry: canInquire,\s*legacyInquireLabel: business\.inquiry_cta_label,/);
  assert.match(biz, /const canInquire = pro && business\.accepts_inquiries && enabledInquiryTopics\.length > 0;/, "same gate as before");
  assert.match(biz, /inquiryTopics=\{enabledInquiryTopics\}/);
  assert.doesNotMatch(biz, /<InquireButton/, "one Inquire entry point on the page — the action bar");
  assert.match(read("src/app/(public)/connect/actions.ts"), /if \(input\.targetType === "business" && isCommercialInquiryTopic\(rawTopic\)\)/, "its commercial topics still go to Findmi");
});

test("Business page order: identity → short bio → action bar → Featured Appearance → tabs", () => {
  const s = read(BIZ);
  const at = ["<BusinessShortDescription", "<EntityActionBar", "Featured Appearance</h2>", "<SectionAnchorNav"].map((m) => s.indexOf(m));
  assert.ok(at.every((i) => i > 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test("Location / Event placement: close to identity, before the public story", () => {
  const l = read(LOC);
  assert.ok(l.indexOf("<EntityActionBar") > l.indexOf("<LocationHoursStatus") && l.indexOf("<EntityActionBar") < l.indexOf("<FeaturedLocationHappeningCard"));
  const e = read(EVT);
  assert.ok(e.indexOf("<EntityActionBar") > e.indexOf("{actions}") && e.indexOf("<EntityActionBar") < e.indexOf("{datesSection}"));
});

test("33. public Opportunities preserved: a compact count + Explore Opportunities", () => {
  const bar = read(BAR);
  assert.match(bar, /\{opportunityCount === 1 \? "1 Opportunity" : `\$\{opportunityCount\} Opportunities`\}/);
  assert.match(bar, /Explore Opportunities/);
  assert.match(read(ACTIONS), /ids\.length === 1 \? `\/account\/business\/\$\{businessId\}\/opportunities\/explore\/\$\{ids\[0\]\}` : `\/account\/business\/\$\{businessId\}\?tab=opportunities&view=explore`/);
});

// ── Save path + manager configuration ──────────────────────────────────────

test("save: replaces the entity's actions (slots 1..n), round-trips, cascades with the entity", async () => {
  const t = seed();
  const db = fakeDb(t);
  const checked = D.validatePublicActions("business", [{ type: "booking", label: "book the trailer" }, { type: "wholesale" }, { type: "collaboration", label: "Partner With Us", enabled: false }]);
  assert.equal(checked.ok, true);
  assert.deepEqual(await S.savePublicActions(db, "business", B_ROSE, checked.value, null), { ok: true });
  assert.deepEqual(t.entity_public_actions.map((r) => [r.display_order, r.action_type, r.custom_label, r.enabled]), [[1, "booking", "Book The Trailer", true], [2, "wholesale", null, true], [3, "collaboration", "Partner With Us", false]]);
  const back = await S.readPublicActions(fakeDb(t), "business", B_ROSE);
  assert.deepEqual(back.map((a) => a.type), ["booking", "wholesale", "collaboration"]);
  assert.deepEqual(S.resolvePublicActions("business", back, ALL, []).map((a) => a.label), ["Book The Trailer", "Wholesale"], "a switched-off action isn't shown");
  await S.savePublicActions(fakeDb(t), "business", B_ROSE, [D.validatePublicActions("business", [{ type: "content" }]).value[0]], null);
  assert.deepEqual(t.entity_public_actions.map((r) => r.action_type), ["content"], "replaced, not appended");
  assert.match(read(MIGRATION), /references public\.businesses\(id\) on delete cascade/);
});

test("save: an Opportunity action must point at an open Opportunity about this entity", async () => {
  const t = seed();
  const bad = await S.savePublicActions(fakeDb(t), "location", L_SOHO, [cfg("opportunity", { opportunityListingId: O_CLOSED })], null);
  assert.equal(bad.ok, false);
  assert.equal((await S.savePublicActions(fakeDb(t), "location", L_SOHO, [cfg("opportunity", { opportunityListingId: O_SOHO })], null)).ok, true);
});

test("manager configuration: owners / managers only, in each entity's existing settings area", () => {
  const a = read(ACTIONS);
  assert.match(a, /const membership = kind === "business" \? await requireBusinessMember\(entityId\) : kind === "location" \? await requireLocationMember\(entityId\) : await requireEventMember\(entityId\);/);
  assert.match(a, /if \(!membership\.viaAdmin && !isPageManagerRole\(membership\.role\)\) return \{ ok: false, error: "Only an owner or manager can change Public Actions\." \};/);
  assert.match(a, /const checked = validatePublicActions\(kind, items\);/);
  assert.match(read("src/app/(public)/account/business/[id]/(manager)/page.tsx"), /<PublicActionsEditor\s+kind="business"/);
  assert.match(read("src/app/(public)/account/location/[id]/page.tsx"), /tab === "profile" && canActForLocation && admin \? await getPublicActionsEditorData\(admin, "location", id\)/);
  assert.match(read("src/app/(public)/account/event/[id]/page.tsx"), /tab === "details" && canManageEventPage \? await getPublicActionsEditorData\(admin!, "event", id\)/);
  const e = read(EDITOR);
  for (const m of ["Choose up to {MAX_PUBLIC_ACTIONS} actions visitors can take from your page.", "Button Label", "Show on my page", "+ Add Action", "Preview", 'aria-label="Move up"', "Remove"]) assert.ok(e.includes(m), m);
  assert.match(e, /maxLength=\{PUBLIC_ACTION_LABEL_MAX\}/);
  assert.match(e, /autoCapitalize="words"/);
});

test("schema: one generalized table, one typed entity, server-only, additive", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /check \(num_nonnulls\(business_id, location_id, event_id\) = 1\)/);
  assert.match(sql, /alter table public\.entity_public_actions enable row level security;/);
  assert.match(sql, /revoke all on public\.entity_public_actions from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /\bdrop\b|alter table public\.(businesses|locations|events)\b/i);
  assert.match(read("src/lib/public-actions.ts"), /if \(!isMissingPublicActionsTable\(error\)\) console\.error/, "until applied, pages keep their existing behavior");
});

// ── Growth / Inquiry corrections (34–37) ───────────────────────────────────

test("34/35. Growth → Targets: Add Target · Search by name / Discover · Explore what's out there", () => {
  const v = read(`${V2}/TargetsView.tsx`);
  assert.match(v, /Add Target<\/span>\s*<span className="text-metadata text-muted">Search by name<\/span>/);
  assert.match(v, /Discover<\/span>\s*<span className="text-metadata text-muted">Explore what&rsquo;s out there<\/span>/);
  assert.match(v, /Your commercial working list — the Places, Businesses and Events you&rsquo;re tracking\./);
  assert.match(v, /flex min-h-\[72px\] flex-col items-start justify-center gap-1 rounded-2xl border border-findmi\/40 bg-white/, "balanced cards");
});

test("36/37. + New Inquiry is a real secondary button; composer collapsed until tapped", () => {
  const p = read(`${V2}/InquiryPanel.tsx`);
  assert.match(p, /className=\{secondaryBtn\}>\s*<span aria-hidden="true">\+<\/span> New Inquiry/);
  assert.match(p, /const secondaryBtn = "flex h-10 w-fit[^"]*border border-findmi\/40[^"]*text-button font-bold/);
  assert.match(p, /const \[composing, setComposing\] = useState\(Boolean\(arriving\)\);/);
});

// ── Layout guards (38–44; measured in the browser QA pass) ─────────────────

test("38–44. equal columns, three-up tightens type, labels balance on ≤ 2 lines, nothing overflows", () => {
  const bar = read(BAR);
  assert.match(bar, /const grid = cols === 3 \? "grid-cols-3" : cols === 2 \? "grid-cols-2" : "grid-cols-1";/);
  assert.match(bar, /text-\[11px\] font-bold uppercase leading-tight tracking-normal \[text-wrap:balance\]/);
  assert.match(bar, /w-full min-w-0/);
  assert.doesNotMatch(bar, /whitespace-nowrap|overflow-x/);
});

// ── Regressions (45–50) ────────────────────────────────────────────────────

test("45–47. public pages keep their consumer layer", () => {
  assert.match(read(BIZ), /<FollowButton businessId=\{business\.id\}/);
  assert.match(read(BIZ), /<FeaturedAppearanceCard/);
  assert.match(read(LOC), /<LocationFollowButton/);
  assert.match(read(LOC), /label="Contact"/, "the Location's existing Contact stays in its utility row");
  assert.match(read(EVT), /\{datesSection\}/);
  assert.match(read(EVT), /label="Contact organizer"/);
});

test("48–50. Commercial Inquiry, Opportunity and Event participation stay their own workflows", () => {
  assert.match(read("src/lib/commercial-inquiries-domain.ts"), /if \(kind === "event" && intent === "event_participation"\) return "event_participation";/);
  assert.doesNotMatch(strip(read("src/lib/public-actions.ts")), /opportunity_recipients|\.insert\(\{[^}]*conversation/);
  assert.match(read("src/components/MessageButton.tsx"), /const triggerLabel = label \?\? \(MESSAGING \? "Message" : targetType === "event" \? "Apply to Vend" : "Invite to Event"\);/);
});

function seed() {
  return {
    businesses: [{ id: B_ROSE, name: "The Native Rose" }, { id: B_MOCKTAIL, name: "Mocktail Mart" }],
    locations: [{ id: L_SOHO, name: "Babylist Soho", archived_at: null, trashed_at: null }, { id: L_OTHER, name: "Elsewhere", archived_at: null, trashed_at: null }],
    business_locations: [{ id: u(60), business_id: B_ROSE, location_id: L_SOHO }],
    events: [{ id: E_MARKET, host_business_id: B_ROSE }],
    opportunity_listings: [
      { id: O_SOHO, title: "Lobby Sampling", location_id: L_SOHO, event_id: null, status: "open", visibility: "discoverable", response_deadline: null, created_at: "2026-10-01" },
      { id: O_EVENT, title: "Market Sponsor", location_id: null, event_id: E_MARKET, status: "open", visibility: "discoverable", response_deadline: null, created_at: "2026-10-01" },
      { id: O_CLOSED, title: "Old", location_id: L_SOHO, event_id: null, status: "closed", visibility: "discoverable", response_deadline: null, created_at: "2026-09-01" },
      { id: u(33), title: "Private", location_id: L_SOHO, event_id: null, status: "open", visibility: "private", response_deadline: null, created_at: "2026-10-01" },
      { id: u(34), title: "Elsewhere", location_id: L_OTHER, event_id: null, status: "open", visibility: "discoverable", response_deadline: null, created_at: "2026-10-01" },
    ],
    entity_public_actions: [],
    business_targets: [],
  };
}
