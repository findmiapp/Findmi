// Unified Commercial UX Pass — One Entity. One Relationship Context. Many Views.
// The canonical relationship deep-link helper, Connect (Target only), the
// owner-only relationship read for public entity pages, contextual
// Opportunities from the ONE Opportunity system, the Business Manager
// surfaces (Targets / Add / Discover / workspace / Inquiry) and the public
// For Your Business section. In-memory fake client; no network, no database.
// Items 55–60 (360 / 390 / 412px, overflow, bottom-nav clearance, client
// exceptions) are checked in the browser QA pass; the source-level guards for
// them are at the end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const R = await import("../src/lib/relationship-links.ts");
const X = await import("../src/lib/relationship-context.ts");
const L = await import("../src/lib/business-targets.ts");
const F = await import("../src/lib/business-follow-ups.ts");
const Q = await import("../src/lib/business-requests.ts");
const read = (p) => readFileSync(p, "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const V2 = "src/app/(public)/account/business/[id]/v2";
const PAGE = "src/app/(public)/account/business/[id]/(manager)/page.tsx";
const ACTIONS = "src/app/(public)/account/business/[id]/target-actions.ts";
const CONNECT = "src/components/relationships/ConnectControl.tsx";
const DETAIL = "src/app/(public)/account/business/[id]/inquiries/[inquiryId]/page.tsx";
const LOC_PAGE = "src/app/(public)/location/[slug]/LocationPublicView.tsx";
const BIZ_PAGE = "src/app/(public)/business/[slug]/BusinessPublicView.tsx";
const EVT_PAGE = "src/app/(public)/event/[slug]/EventPublicView.tsx";

// ── Fixture (mirrors the read-only production facts; invented ids) ─────────
const u = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const B_MOCKTAIL = u(1), B_BABYLIST = u(2), B_LAVAZZA = u(3), B_STAFFED = u(4);
const L_430 = u(10), L_SOHO = u(11), L_NEW = u(12), L_OURS = u(13);
const E_MARKET = u(20);
const T_430 = u(30), T_SOHO = u(31), T_BABYLIST_BIZ = u(32);
const Q_430 = u(40), Q_CLOSED = u(41);
const OL_430 = u(50), OL_EVENT = u(51), OL_HOSTED = u(52), OL_ELSEWHERE = u(53);

function seed() {
  return {
    businesses: [
      { id: B_MOCKTAIL, name: "Mocktail Mart", is_demo: false, publication_status: "live", archived_at: null, trashed_at: null },
      { id: B_BABYLIST, name: "Babylist", is_demo: false, publication_status: "live", archived_at: null, trashed_at: null },
      { id: B_LAVAZZA, name: "Lavazza", is_demo: false, publication_status: "live", archived_at: null, trashed_at: null },
    ],
    locations: [
      { id: L_430, name: "430 W. Broadway", archived_at: null, trashed_at: null },
      { id: L_SOHO, name: "Babylist Soho", archived_at: null, trashed_at: null },
      { id: L_NEW, name: "Corner Shop", archived_at: null, trashed_at: null },
      { id: L_OURS, name: "Mocktail Mart HQ", archived_at: null, trashed_at: null },
    ],
    business_locations: [
      { id: u(60), business_id: B_MOCKTAIL, location_id: L_OURS },
      { id: u(61), business_id: B_BABYLIST, location_id: L_SOHO },
    ],
    events: [{ id: E_MARKET, name: "SoHo Market", host_business_id: B_BABYLIST, is_demo: false, publication_status: "live", archived_at: null, trashed_at: null }],
    business_targets: [
      { id: T_430, business_id: B_MOCKTAIL, target_location_id: L_430, target_business_id: null, target_event_id: null, status: "in_conversation", intents: ["placement", "pop_up"], notes: "PRIVATE CONTEXT", next_action: "PRIVATE NEXT STEP", internal_notes: "FINDMI INTERNAL" },
      { id: T_SOHO, business_id: B_MOCKTAIL, target_location_id: L_SOHO, target_business_id: null, target_event_id: null, status: "in_conversation", intents: ["placement"], notes: "PRIVATE CONTEXT", next_action: "Find contact info for partnerships director", internal_notes: null },
      { id: T_BABYLIST_BIZ, business_id: B_LAVAZZA, target_location_id: null, target_business_id: B_BABYLIST, target_event_id: null, status: "target", intents: ["collaboration"], notes: "LAVAZZA SECRET", next_action: null, internal_notes: null },
    ],
    commercial_inquiries: [
      { id: Q_430, sender_business_id: B_MOCKTAIL, counterparty_location_id: L_430, counterparty_business_id: null, counterparty_event_id: null, intent: "pop_up", status: "sent" },
      { id: Q_CLOSED, sender_business_id: B_MOCKTAIL, counterparty_location_id: L_SOHO, counterparty_business_id: null, counterparty_event_id: null, intent: "placement", status: "withdrawn" },
    ],
    opportunity_recipients: [],
    opportunity_listings: [],
    business_target_activity: [],
  };
}
const MINE = [{ id: B_MOCKTAIL, name: "Mocktail Mart", role: "owner" }];
const writes = (db) => db.calls.filter((c) => c.op !== "select");
const cand = (listingId, extra = {}) => ({ listingId, title: `Opp ${listingId.slice(6, 8)}`, type: "activation", geo: { locationId: null, marketId: null, areaId: null }, recipientId: null, eventId: null, responseDeadline: null, startsAt: null, ...extra });

// ── Deep links (27, 38–44) ─────────────────────────────────────────────────

test("40. Location relationship deep link: by place (works with or without a Target)", () => {
  assert.equal(R.relationshipHref(B_MOCKTAIL, { kind: "location", locationId: L_430 }), `/account/business/${B_MOCKTAIL}?tab=growth&view=targets&loc=${L_430}`);
  assert.deepEqual(R.relationshipRefFor("location", { targetId: T_430, locationId: L_430 }), { kind: "location", locationId: L_430 });
});

test("41. Business relationship deep link: by Target", () => {
  assert.equal(R.relationshipHref(B_LAVAZZA, R.relationshipRefFor("business", { targetId: T_BABYLIST_BIZ })), `/account/business/${B_LAVAZZA}?tab=growth&view=targets&tgt=${T_BABYLIST_BIZ}`);
});

test("42. Event relationship deep link: by Target", () => {
  assert.equal(R.relationshipHref(B_MOCKTAIL, R.relationshipRefFor("event", { targetId: u(99) })), `/account/business/${B_MOCKTAIL}?tab=growth&view=targets&tgt=${u(99)}`);
  assert.deepEqual(R.relationshipParams({ kind: "business", targetId: u(99) }), { tgt: u(99), loc: null, pt: null }, "in-place nav clears legacy pt");
});

test("43/44. legacy ?loc= and ?pt= keep resolving in the Business Manager page", () => {
  const page = read(PAGE);
  assert.match(page, /typeof rawSearchParams\.loc === "string" \? rawSearchParams\.loc : ""/);
  assert.match(page, /const legacyPt = workspaceDoor && !requestedLoc && typeof rawSearchParams\.pt === "string"/);
  assert.match(page, /getBusinessTarget\(admin, id, requestedTgt \|\| legacyPt\)/);
});

test("27. ONE helper: no surface builds relationship links inline", () => {
  const files = [`${V2}/TargetsView.tsx`, `${V2}/DiscoverView.tsx`, `${V2}/GeographyViews.tsx`, "src/lib/business-follow-ups.ts", "src/lib/relationship-context.ts", ACTIONS, DETAIL];
  for (const f of files) assert.doesNotMatch(strip(read(f)), /[&?](loc|tgt)=\$\{/, f);
  assert.match(read(`${V2}/TargetsView.tsx`), /relationshipParams\(t\.locationId \?/);
  assert.match(read(`${V2}/GeographyViews.tsx`), /relationshipParams\(\{ kind: "location", locationId: row\.place\.id \}\)/, "By Market");
});

test("38. Follow-Up deep link → the relationship workspace", () => {
  const today = "2026-10-23";
  const [place, biz] = F.buildFollowUps({
    basePath: `/account/business/${B_MOCKTAIL}`,
    today,
    targets: [
      { targetId: T_SOHO, kind: "location", locationId: L_SOHO, title: "Babylist Soho", status: "in_conversation", nextAction: "Find contact info for partnerships director", nextActionAt: "2026-10-23" },
      { targetId: T_BABYLIST_BIZ, kind: "business", locationId: null, title: "Babylist", status: "target", nextAction: "Intro", nextActionAt: "2026-10-30" },
    ],
  });
  assert.equal(place.href, R.relationshipHref(B_MOCKTAIL, { kind: "location", locationId: L_SOHO }));
  assert.equal(biz.href, R.relationshipHref(B_MOCKTAIL, { kind: "business", targetId: T_BABYLIST_BIZ }));
  // Home's Inbox / Follow-Ups row opens that exact workspace.
  assert.match(read("src/lib/home-inbox.ts"), /href: f\.href,/);
  assert.match(read(`${V2}/HomeInbox.tsx`), /<Link\s+href=\{item\.href\}/);
});

test("39. Request deep links: Inquiry → Inquiry, Opportunity → Opportunity — never a generic Open", () => {
  const built = Q.buildBusinessRequests({
    basePath: "/b",
    opportunities: [{ recipientId: "r1", title: "Lobby Sampling", placeName: null, group: "for_you", offeredAt: "2026-10-01" }],
    invitations: [],
    newOrderCount: 0,
    inquiries: [{ id: Q_430, senderName: "Mocktail Mart", intent: "pop_up", counterpartyName: null, createdAt: "2026-10-22" }],
  });
  assert.deepEqual(built.map((r) => [r.href, r.actionLabel]), [["/b/opportunities/r1", "Review Opportunity"], [`/b/inquiries/${Q_430}`, "Review Inquiry"]]);
  assert.doesNotMatch(read("src/lib/business-requests.ts"), /actionLabel: "(Open|Review)"/);
});

// ── Connect (13, 1–5, 20, 21) ──────────────────────────────────────────────

test("2. Connect creates the Target only — through the existing authorized path", async () => {
  const tables = seed();
  const db = fakeDb(tables);
  const res = await L.addBusinessTarget(db, B_MOCKTAIL, { kind: "location", counterpartyId: L_NEW, intents: ["placement"], source: "business", userId: null });
  assert.equal(res.ok, true);
  assert.deepEqual(writes(db).map((c) => `${c.op}:${c.table}`), ["insert:business_targets"]);
  const action = read(ACTIONS);
  const body = action.slice(action.indexOf("export async function connectAction"), action.indexOf("export async function addTargetAction"));
  assert.match(body, /const auth = await authorizeWrite\(businessId\);\s*if \(!auth\.ok\) return auth;/, "authorized first");
  assert.match(body, /addBusinessTarget\(admin, businessId,/);
  assert.match(body, /href: relationshipHref\(businessId, relationshipRefFor\(kind,/, "then opens the workspace");
});

test("3/4/5. Connect never sends an Inquiry, creates an Opportunity, Find Us Here or Appearance", () => {
  const action = read(ACTIONS);
  const body = strip(action.slice(action.indexOf("export async function connectAction"), action.indexOf("export async function addTargetAction")));
  assert.doesNotMatch(body, /commercial_inquiries|sendCommercialInquiry|opportunity_|business_availability|appearances|createConversation|notify/);
  assert.doesNotMatch(strip(read(CONNECT)), /sendInquiry|Inquiry\(|opportunit|appearance|availability/i);
});

test("13. Connect on an existing Target opens it — never a second Target, intents untouched", async () => {
  const action = read(ACTIONS);
  assert.match(action, /if \(row\) return \{ ok: true, existing: true, href: relationshipHref\(businessId, relationshipRefFor\(kind, \{ targetId: row\.id, locationId: row\.target_location_id \}\)\) \};/);
  const tables = seed();
  const again = await L.addBusinessTarget(fakeDb(tables), B_MOCKTAIL, { kind: "location", counterpartyId: L_430, intents: ["placement"], source: "business", userId: null });
  assert.equal(again.existing, true);
  assert.equal(tables.business_targets.filter((t) => t.business_id === B_MOCKTAIL && t.target_location_id === L_430).length, 1);
});

test("Connect is one deliberate step: what it's about, then Connect; Event Participation is excluded", () => {
  const c = read(CONNECT);
  assert.match(c, /const exclude: CommercialIntent\[\] = kind === "event" \? \["event_participation"\] : \[\];/);
  assert.match(c, /<IntentPicker kind=\{kind\} value=\{intents\} onChange=\{setIntents\} disabled=\{pending\} exclude=\{exclude\} \/>/);
  assert.match(c, /\{CONNECT_HINT\}/);
  assert.match(c, /disabled=\{pending \|\| intents\.length === 0\}/);
  assert.match(c, /router\.push\(res\.href\)/);
  assert.equal(R.CONNECT_HINT, "Starts a private relationship for your Business. Nothing is sent until you choose to.");
});

test("18. self Business blocked: never offered, and refused by the Target path", async () => {
  const rows = await X.getEntityRelationships(fakeDb(seed()), [{ id: B_BABYLIST, name: "Babylist", role: "owner" }], "business", B_BABYLIST);
  assert.deepEqual(rows, []);
  const res = await L.addBusinessTarget(fakeDb(seed()), B_BABYLIST, { kind: "business", counterpartyId: B_BABYLIST, intents: ["collaboration"], source: "business", userId: null });
  assert.equal(res.ok, false);
});

test("own Location: refused by the Target path", async () => {
  const res = await L.addBusinessTarget(fakeDb(seed()), B_MOCKTAIL, { kind: "location", counterpartyId: L_OURS, intents: ["placement"], source: "business", userId: null });
  assert.equal(res.ok, false);
});

// ── Relationship read for public pages (11–17, 29–33, 45, 46) ──────────────

test("45. 430 W. Broadway read model: In Conversation · Pop-Up Inquiry · Sent · Open Relationship", async () => {
  const db = fakeDb(seed());
  const [r] = await X.getEntityRelationships(db, MINE, "location", L_430);
  assert.equal(r.status, "in_conversation");
  assert.deepEqual(r.inquiries, [{ id: Q_430, intent: "pop_up", status: "sent" }]);
  assert.equal(r.href, R.relationshipHref(B_MOCKTAIL, { kind: "location", locationId: L_430 }));
  assert.deepEqual(r.opportunities, []);
  assert.deepEqual(writes(db), [], "read-only");
});

test("46. Babylist Soho read model: In Conversation, no Inquiry (a withdrawn one never shows)", async () => {
  const [r] = await X.getEntityRelationships(fakeDb(seed()), MINE, "location", L_SOHO);
  assert.equal(r.status, "in_conversation");
  assert.deepEqual(r.inquiries, []);
});

test("29–33. owner-only: never another Business's Target, Context, Next Step, Activity or Findmi Internal", async () => {
  const rows = await X.getEntityRelationships(fakeDb(seed()), MINE, "business", B_BABYLIST);
  assert.equal(rows[0].status, null, "Lavazza's Target on Babylist is invisible to Mocktail Mart");
  const json = JSON.stringify([rows, await X.getEntityRelationships(fakeDb(seed()), MINE, "location", L_430)]);
  for (const secret of ["PRIVATE CONTEXT", "PRIVATE NEXT STEP", "FINDMI INTERNAL", "LAVAZZA SECRET", "partnerships director"]) assert.ok(!json.includes(secret), secret);
  const src = strip(read("src/lib/relationship-context.ts"));
  assert.match(src, /select\("id, business_id, status, target_location_id"\)\.in\("business_id", ids\)/, "only the viewer's own Businesses");
  assert.doesNotMatch(src, /notes|next_action|internal|activity/);
});

test("bounded: one Target read and one Inquiry read for all of the viewer's Businesses", async () => {
  const db = fakeDb(seed());
  const many = Array.from({ length: 14 }, (_, i) => ({ id: u(200 + i), name: `B${i}`, role: "owner" }));
  const rows = await X.getEntityRelationships(db, many, "location", L_430);
  assert.equal(rows.length, 10);
  assert.equal(db.calls.filter((c) => c.table === "business_targets").length, 1);
  assert.equal(db.calls.filter((c) => c.table === "commercial_inquiries").length, 1);
});

// ── Opportunities (22–27) ──────────────────────────────────────────────────

test("23. Location Opportunity contextual: listed at this exact place", async () => {
  const items = await X.contextualOpportunities(fakeDb(seed()), B_MOCKTAIL, "location", L_430, [cand(OL_430, { geo: { locationId: L_430 } }), cand(OL_ELSEWHERE, { geo: { locationId: L_NEW } })]);
  assert.deepEqual(items.map((o) => [o.reason, o.path]), [["At This Place", `/account/business/${B_MOCKTAIL}/opportunities/explore/${OL_430}`]]);
});

test("24. Event Opportunity contextual: listed for this Event", async () => {
  const items = await X.contextualOpportunities(fakeDb(seed()), B_MOCKTAIL, "event", E_MARKET, [cand(OL_EVENT, { eventId: E_MARKET, recipientId: "rcp" }), cand(OL_430, { geo: { locationId: L_430 } })]);
  assert.deepEqual(items.map((o) => [o.reason, o.sentToYou, o.path]), [["For This Event", true, `/account/business/${B_MOCKTAIL}/opportunities/rcp`]]);
});

test("22. Business Opportunity contextual: at a place it operates or an Event it hosts (canonical links only)", async () => {
  const items = await X.contextualOpportunities(fakeDb(seed()), B_MOCKTAIL, "business", B_BABYLIST, [cand(OL_HOSTED, { eventId: E_MARKET }), cand(OL_430, { geo: { locationId: L_SOHO } }), cand(OL_ELSEWHERE, { geo: { locationId: L_NEW } })]);
  assert.deepEqual(items.map((o) => o.reason).sort(), ["At Their Place", "For Their Event"]);
});

test("25. relationship Opportunity contextual: the Target workspace shows the same Opportunities", () => {
  assert.match(read(PAGE), /contextualOpportunities\(admin, id, opened\.kind, opened\.counterparty\.id\)/);
  const ws = read(`${V2}/TargetWorkspace.tsx`);
  assert.match(ws, /<h3 id="ws-opps"[^>]*>Opportunities<\/h3>/);
  assert.match(read(`${V2}/RelationshipWorkspace.tsx`), /\{data\.opportunities\.length > 0 && \(/, "places: only when there are any");
});

test("26. Opportunity action: Explore Opportunity opens the existing system — never an Inquiry", () => {
  const list = read("src/components/relationships/ContextualOpportunityList.tsx");
  assert.match(list, /<Link href=\{o\.path\}[^>]*>\s*\{RELATIONSHIP_ACTIONS\.opportunity\}/);
  assert.equal(R.RELATIONSHIP_ACTIONS.opportunity, "Explore Opportunity");
  assert.doesNotMatch(strip(list), /inquir/i);
});

test("27. no Opportunity duplication: one candidate read, deduped by listing, capped, deterministic", async () => {
  const src = read("src/lib/relationship-context.ts");
  assert.match(src, /candidates \?\? \(await getOpportunityCandidates\(admin, viewerBusinessId\)\)/);
  assert.doesNotMatch(strip(src), /\.insert\(|\.update\(|opportunity_recipients/);
  const many = Array.from({ length: 8 }, (_, i) => cand(u(300 + i), { geo: { locationId: L_430 }, responseDeadline: `2026-11-${10 + i}` }));
  const items = await X.contextualOpportunities(fakeDb(seed()), B_MOCKTAIL, "location", L_430, [...many].reverse());
  assert.equal(items.length, 5);
  assert.equal(new Set(items.map((o) => o.path)).size, 5);
  assert.deepEqual(items.map((o) => o.path), (await X.contextualOpportunities(fakeDb(seed()), B_MOCKTAIL, "location", L_430, many)).map((o) => o.path));
});

test("Growth → Opportunities is the broad marketplace lens", () => {
  assert.match(read(`${V2}/OpportunitiesView.tsx`), /Browse commercial opportunities available to your Business\./);
});

// ── Business Manager surfaces (1, 6–10, 28, 34–37) ─────────────────────────

test("1. Discover untracked entity → Connect", () => {
  const v = read(`${V2}/DiscoverView.tsx`);
  assert.match(v, /\) : canEdit \? \(\s*<ConnectControl businessId=\{businessId\} kind=\{kind\} counterpartyId=\{r\.id\} \/>/);
});

test("6. Discover existing Target → Open Relationship", () => {
  const v = read(`${V2}/DiscoverView.tsx`);
  assert.match(v, /\) : openHref \? \(\s*<Link href=\{openHref\}[^>]*>\s*\{RELATIONSHIP_ACTIONS\.open\}/);
});

test("7. Discover shows the viewer's own Inquiry state (one batched read)", () => {
  const s = read("src/lib/discovery/commercial-server.ts");
  assert.match(s, /inquiry: \{ intent: CommercialIntent; status: InquiryStatus \} \| null/);
  assert.match(s, /\.from\("commercial_inquiries"\)[\s\S]{0,200}\.eq\("sender_business_id", /);
  assert.match(read(`${V2}/DiscoverView.tsx`), /\{intentLabel\(r\.inquiry\.intent\)\} Inquiry · \{INQUIRY_STATUS_LABELS\[r\.inquiry\.status\]\}/);
});

test("8. no View / Open / Targeted redundancy", () => {
  const v = strip(read(`${V2}/DiscoverView.tsx`));
  assert.doesNotMatch(v, /Targeted/);
  assert.doesNotMatch(v, />\s*Open\s*</);
  assert.doesNotMatch(v, /addTargetAction/);
  assert.match(v, /const VIEW_LABEL = \{ location: "View Place", business: "View Business", event: "View Event" \} as const;/, "the public page is one quiet secondary link");
});

test("9. Add Target / Discover: the two equal doors on Growth → Targets", () => {
  const v = read(`${V2}/TargetsView.tsx`);
  assert.match(v, /<span className="text-button font-bold text-findmi-700">Add Target<\/span>\s*<span[^>]*>Search by name<\/span>/);
  assert.match(v, /<span className="text-button font-bold text-findmi-700">Discover<\/span>\s*<span[^>]*>Explore what&rsquo;s out there<\/span>/);
  assert.match(v, /Targets are private\. Your Targets, Context, Next Steps and Activity are never shared with them\./, "one privacy line");
});

test("10. Add an existing Target: its state + Open Relationship, never a duplicate", () => {
  const v = read(`${V2}/TargetsView.tsx`);
  assert.match(v, /if \(c\.target\) return open\(c\.kind, c\.target\.id, c\.kind === "location" \? c\.id : null\);/);
  assert.match(v, /<Chip tone=\{TARGET_STATUS_TONE\[c\.target\.status\]\}>\{TARGET_STATUS_LABELS\[c\.target\.status\]\}<\/Chip>\s*<span[^>]*>Open Relationship<\/span>/);
});

test("Relationship workspace hierarchy: Current Relationship → Next Step → Context → Activity → Presence → Opportunities → Appearances", () => {
  const w = read(`${V2}/RelationshipWorkspace.tsx`);
  const at = ["<InquiryPanel", "<NextCard", "<SummaryBlock", "<ActivityFeed", "<Presence {...props} />", 'id="ws-opps"', 'id="ws-appear"'].map((m) => w.indexOf(m));
  assert.ok(at.every((i) => i > 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  const t = read(`${V2}/TargetWorkspace.tsx`);
  const tat = ["<InquiryPanel", "<NextCard", "<ActivityFeed", 'id="ws-opps"'].map((m) => t.indexOf(m));
  assert.deepEqual([...tat].sort((a, b) => a - b), tat);
});

test("28. Presence remains factual and separate from Target state; shown only when there's something true to say", () => {
  const w = read(`${V2}/RelationshipWorkspace.tsx`);
  assert.match(w, /if \(!presence && !canAdd\) return null;/);
  assert.equal((w.match(/<h3 id="ws-presence" className=\{sectionTitle\}>Presence<\/h3>/g) ?? []).length, 2);
});

test("34. Inquiry is the shared state: Current Relationship shows Intent Inquiry · Status + mediation + Open Conversation", () => {
  const p = read(`${V2}/InquiryPanel.tsx`);
  assert.match(p, /Current Relationship/);
  assert.match(p, /\{MEDIATION_LINE\}/);
  assert.match(p, /Open Conversation/);
  assert.equal(R.MEDIATION_LINE, "Findmi is helping make the connection.");
});

test("36. composer collapsed: opened only on a deliberate tap", () => {
  const p = read(`${V2}/InquiryPanel.tsx`);
  assert.match(p, /const \[composing, setComposing\] = useState\(Boolean\(arriving\)\);/, "closed unless arriving from a public action for that intent");
  assert.match(p, /No Inquiry Yet/);
});

test("37. New Inquiry only when a compatible intent remains", () => {
  const p = read(`${V2}/InquiryPanel.tsx`);
  assert.match(p, /choices\.length === 0 \? null/);
  assert.match(p, /New Inquiry/);
});

test("35. Inquiry detail: simple hierarchy; Conversation only for authorized participants", () => {
  const d = read(DETAIL);
  const at = ["{other.name}</h1>", "{intentLabel(inquiry.intent)} Inquiry ·", "{MEDIATION_LINE}", "isn&rsquo;t managed on Findmi yet. We&rsquo;ll help route your Inquiry.", "<InquiryActions", 'id="inquiry-conversation"', "Inquiry Details"].map((m) => d.indexOf(m));
  assert.ok(at.every((i) => i > 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at, "metadata is secondary, after the Conversation");
  assert.match(d, /open && inquiry\.role === "sender" && inquiry\.findmiOnly/);
  assert.match(d, /const inquiry = await getInquiryForBusiness\(admin, id, inquiryId\);\s*if \(!inquiry\) notFound\(\);/, "only the sender or the routed party");
  assert.match(d, /getConversationThread\(admin, inquiry\.conversationId, user\.id\)/, "the thread checks participation");
  assert.match(d, /relationshipHref\(id, relationshipRefFor\(inquiry\.counterparty\.kind,/, "back to the relationship via the one helper");
});

test("no new tables or migrations in this pass", () => {
  const added = ["relationship", "open_to", "map_"].filter((k) => readFileSync("supabase/migrations/20261108000000_commercial_inquiries.sql", "utf8").includes(`create table if not exists public.${k}`));
  assert.deepEqual(added, []);
});

// ── Regressions (47–54) ────────────────────────────────────────────────────

test("47/48. Opportunity threads and Commercial Inquiry stay separate canonical workflows", () => {
  assert.doesNotMatch(strip(read("src/lib/relationship-context.ts")), /conversations|commercial_inquiries"\)\.insert/);
  assert.match(read("src/lib/commercial-inquiries.ts"), /commercial_inquiry/);
});

test("49. Event participation regression: Apply to Vend default label unchanged elsewhere", () => {
  assert.match(read(EVT_PAGE), /<MessageButton\s+size="compact"\s+targetType="event"/, "the existing contact-row trigger is untouched");
});

test("50. Find Us Here regression: Presence still offers the factual add path for editors", () => {
  assert.match(read(`${V2}/RelationshipWorkspace.tsx`), /When you&rsquo;re available here, add this place to your public footprint\./);
});

test("51/52. Home Requests and Follow-Ups keep their ordering inside Home's one Inbox / Follow-Ups list", () => {
  assert.match(read("src/lib/home-inbox.ts"), /\.\.\.requests\.map\(requestItem\)/);
  assert.match(read("src/lib/business-requests.ts"), /actionLabel: "Review Inquiry"/);
  assert.match(read("src/lib/business-follow-ups.ts"), /items\.sort\(\(a, b\) => a\.rank - b\.rank/);
});

test("53/54. Discover and Add keep the read-only search and the authorized add", () => {
  assert.match(read(`${V2}/TargetsView.tsx`), /addTargetAction\(/);
  assert.match(read(ACTIONS), /export async function addTargetAction\(/);
});

// ── Mobile guards (55–60; verified in the browser QA pass) ─────────────────

