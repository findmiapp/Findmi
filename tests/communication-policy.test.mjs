// Step 1 — communication boundary + commercial Inquiry routing + Phase 0A
// code. Pure policy functions plus static guards over every enforcement
// point. No database. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canSendInThread,
  isDirectBusinessMessagingEnabled,
  isDirectOrganizationThread,
  isStructuredThread,
  organizationKeys,
} from "../src/lib/communication-policy.ts";
import {
  BUSINESS_INQUIRY_TOPIC_VALUES,
  COMMERCIAL_INQUIRY_TOPICS,
  isCommercialInquiryTopic,
} from "../src/lib/business-inquiry-topics.ts";

const read = (p) => readFileSync(p, "utf8");
const B1 = { entityType: "business", entityId: "b1" };
const B2 = { entityType: "business", entityId: "b2" };
const EV = { entityType: "event", entityId: "e1" };
const LOC = { entityType: "location", entityId: "l1" };
const ME = { entityType: "personal", entityId: null };
const thread = (subjectType, parties, hasOpportunity = false) => ({ subjectType, parties, hasOpportunity });

/** Body of an exported async function in a source file (up to the next export). */
function fnBody(src, name) {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = src.indexOf("\nexport ", start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

// ── the switch ─────────────────────────────────────────────────────────
test("the switch is server configuration: OFF unless exactly \"true\"", () => {
  assert.equal(isDirectBusinessMessagingEnabled({}), false, "unset → OFF");
  for (const v of ["", "false", "0", "1", "TRUE", "True", "yes", " true"]) {
    assert.equal(isDirectBusinessMessagingEnabled({ DIRECT_BUSINESS_MESSAGING_ENABLED: v }), false, JSON.stringify(v));
  }
  assert.equal(isDirectBusinessMessagingEnabled({ DIRECT_BUSINESS_MESSAGING_ENABLED: "true" }), true, "restorable by configuration alone");
  // Reads the live environment by default (server request time).
  const prev = process.env.DIRECT_BUSINESS_MESSAGING_ENABLED;
  delete process.env.DIRECT_BUSINESS_MESSAGING_ENABLED;
  assert.equal(isDirectBusinessMessagingEnabled(), false);
  process.env.DIRECT_BUSINESS_MESSAGING_ENABLED = "true";
  assert.equal(isDirectBusinessMessagingEnabled(), true);
  if (prev === undefined) delete process.env.DIRECT_BUSINESS_MESSAGING_ENABLED;
  else process.env.DIRECT_BUSINESS_MESSAGING_ENABLED = prev;
  // Documented, server-only.
  const envExample = read(".env.example");
  assert.match(envExample, /^DIRECT_BUSINESS_MESSAGING_ENABLED=$/m);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_DIRECT_BUSINESS_MESSAGING/);
});

// ── thread rules ───────────────────────────────────────────────────────
test("org-to-org threads are read-only in every direction (no Event/Location loophole)", () => {
  for (const [label, parties, actor] of [
    ["Business ↔ Business", [B1, B2], B1],
    ["Business → Event organizer", [B1, EV], B1],
    ["Event → Business", [EV, B1], EV],
    ["Business → Location / venue", [B1, LOC], B1],
    ["Location → Business", [B1, LOC], LOC],
  ]) {
    const t = thread("business_business_chat", parties);
    assert.equal(isDirectOrganizationThread(t), true, label);
    assert.equal(canSendInThread(t, actor, false), false, label);
    assert.equal(canSendInThread(t, actor, true), true, `${label}: restored when enabled`);
  }
});

test("structured Opportunity threads keep free-text replies", () => {
  const bySubject = thread("opportunity", [B1, EV]);
  const byAttachment = thread("event_business_chat", [B1, EV], true); // chat thread an Opportunity was attached to
  for (const t of [bySubject, byAttachment]) {
    assert.equal(isStructuredThread(t), true);
    assert.equal(canSendInThread(t, B1, false), true);
    assert.equal(canSendInThread(t, EV, false), true);
  }
});

test("consumer threads are unaffected, but a second organization can't join one", () => {
  const inquiry = thread("business_inquiry", [ME, B1]);
  assert.equal(canSendInThread(inquiry, B1, false), true, "the Business replies to its customer");
  assert.equal(canSendInThread(inquiry, ME, false), true, "the customer");
  assert.equal(canSendInThread(inquiry, B2, false), false, "replying as another Business would make it org-to-org");
  assert.equal(organizationKeys(inquiry.parties, B2).size, 2);
  const guestInquiry = thread("venue_inquiry", [LOC]);
  assert.equal(canSendInThread(guestInquiry, LOC, false), true);
});

test("Findmi-mediated requests have no organization party", () => {
  const request = thread("findmi_commercial_request", [ME]);
  assert.equal(isDirectOrganizationThread(request), false);
  assert.equal(canSendInThread(request, ME, false), true);
});

// ── commercial Inquiry routing ─────────────────────────────────────────
test("exactly Wholesale, Catering / Booking, Event / Pop-Up and Collaboration route to Findmi", () => {
  assert.deepEqual([...COMMERCIAL_INQUIRY_TOPICS].sort(), ["catering_booking", "collaboration", "event_popup", "wholesale"]);
  for (const t of COMMERCIAL_INQUIRY_TOPICS) assert.equal(isCommercialInquiryTopic(t), true, t);
  for (const t of ["general", "product_order", "other", "", null, undefined, "sampling_demo"]) assert.equal(isCommercialInquiryTopic(t), false, String(t));
  // Taxonomy unchanged this Step.
  assert.deepEqual([...BUSINESS_INQUIRY_TOPIC_VALUES], ["general", "product_order", "wholesale", "catering_booking", "event_popup", "collaboration", "other"]);
});

// ── server enforcement (static) ────────────────────────────────────────
const actions = read("src/app/(public)/connect/actions.ts");

test("every direct-message action is refused server-side before anything is written", () => {
  for (const name of ["messageBusiness", "messageEventOrganizer", "messageLocation"]) {
    const body = fnBody(actions, name);
    const guard = body.indexOf("if (!isDirectBusinessMessagingEnabled()) return { error: DIRECT_MESSAGING_PAUSED_MESSAGE };");
    assert.ok(guard > 0, `${name} guard`);
    for (const write of ["getOrCreateConversation(", "sendTextMessage("]) {
      const at = body.indexOf(write);
      assert.ok(at === -1 || guard < at, `${name}: guard precedes ${write}`);
    }
  }
});

test("replies check the thread policy after authorization and before sending", () => {
  const body = fnBody(actions, "sendReply");
  const auth = body.indexOf("isAuthorizedForConversation(");
  const facts = body.indexOf("getThreadMessagingFacts(admin, conversationId)");
  const check = body.indexOf("canSendInThread(facts, { entityType: actingEntityType, entityId: actingEntityId }, isDirectBusinessMessagingEnabled())");
  const send = body.indexOf("sendTextMessage(");
  assert.ok(auth > 0 && auth < facts && facts < check && check < send);
});

test("apply / invite never open a plain chat while paused, but still record participation", () => {
  for (const name of ["applyToEventPublic", "inviteBusinessToEventPublic"]) {
    const body = fnBody(actions, name);
    const paused = body.indexOf("if (!conversationId && !isDirectBusinessMessagingEnabled())");
    const chat = body.indexOf("getOrCreateConversation(");
    assert.ok(paused > 0 && paused < chat, `${name}: paused branch returns before the chat fallback`);
    assert.match(body, /findOpportunityConversation\(/);
    assert.match(body, /createOpportunity\(/, `${name} still records the structured Opportunity`);
  }
  // Every plain-chat creation in the module is one of the guarded paths above.
  assert.equal((actions.match(/getOrCreateConversation\(admin/g) ?? []).length, 5);
});

test("commercial Inquiries go to Findmi with no organization participant", () => {
  const body = fnBody(actions, "submitEntityInquiry");
  const branch = body.slice(body.indexOf("isCommercialInquiryTopic(rawTopic)"));
  assert.match(branch, /subjectType: "findmi_commercial_request"/);
  assert.match(branch, /targetEntityType: null,\s*targetEntityId: null/);
  assert.match(branch, /keepContactDetails: true/);
  assert.match(branch, /notifyAdmin\(/);
  assert.match(branch, /routedTo: "findmi"/);
  assert.ok(body.indexOf("isCommercialInquiryTopic(rawTopic)") < body.indexOf("subjectTypeFor(input.targetType)"), "routing decided before the direct path");
  // Product inquiries stay direct.
  assert.doesNotMatch(fnBody(actions, "submitProductInquiry"), /findmi_commercial_request/);
});

// ── UI mirrors the policy ──────────────────────────────────────────────
test("paused: the profile CTA is removed, never swapped for Invite/Apply", () => {
  const gate = read("src/lib/message-visibility.ts");
  // First statement, before any session/manager lookup: who the viewer
  // manages can't change a profile's CTA hierarchy.
  const paused = gate.indexOf("if (!isDirectBusinessMessagingEnabled()) return false;");
  assert.ok(paused > -1, "gate returns false while paused");
  assert.ok(paused < gate.indexOf("getServerSupabase()"), "decided before any viewer lookup");
  const button = read("src/components/MessageButton.tsx");
  // The client never reads the switch: it gets the server-read value as a prop.
  assert.doesNotMatch(button, /import[^;]*communication-policy/);
  assert.doesNotMatch(button, /process\.env/);
  assert.match(button, /messagingEnabled = false,/);
  assert.match(button, /const MESSAGING = messagingEnabled;/);
  for (const page of [
    "src/app/(public)/business/[slug]/BusinessPublicView.tsx",
    "src/app/(public)/event/[slug]/EventPublicView.tsx",
    "src/app/(public)/location/[slug]/LocationPublicView.tsx",
  ]) {
    assert.match(read(page), /messagingEnabled=\{isDirectBusinessMessagingEnabled\(\)\}/, page);
  }
  assert.match(button, /\{MESSAGING && mode === "message" && \(/);
  assert.match(button, /const entryMode: Mode = MESSAGING \? "message" : targetType === "event" \? "apply" : "invite";/);
  const threadPage = read("src/app/(public)/account/messages/[id]/page.tsx");
  assert.match(threadPage, /replyPaused \? \(/);
  assert.match(threadPage, /const messagingEnabled = isDirectBusinessMessagingEnabled\(\);/);
  const inquire = read("src/components/InquireButton.tsx");
  assert.match(inquire, /Your request goes to\s+Findmi, not directly to \{targetName\}/);
  assert.match(inquire, /Request sent to Findmi/);
  for (const f of ["src/components/InquireButton.tsx", "src/components/MessageButton.tsx", "src/lib/communication-policy.ts", "src/app/(public)/account/messages/[id]/page.tsx"]) {
    // Rendered copy only — historical code comments may still say "FINDMI".
    const code = read(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    assert.doesNotMatch(code, /FindMi|FINDMI/, f);
  }
});

// ── Opportunities stay independent of the switch ──────────────────────
test("structured Opportunity responses never depend on the messaging switch or conversations", () => {
  for (const f of ["src/lib/opportunity-listings.ts", "src/app/(public)/account/business/[id]/opportunities/actions.ts"]) {
    const src = read(f);
    assert.doesNotMatch(src, /communication-policy|DIRECT_BUSINESS_MESSAGING_ENABLED|isDirectBusinessMessagingEnabled/, f);
    assert.doesNotMatch(src, /from\("conversation/, f);
  }
  // In-thread accept/decline paths are not gated by the switch.
  for (const name of ["respondToInvitationInThread", "respondToApplicationInThread"]) {
    assert.doesNotMatch(fnBody(actions, name), /isDirectBusinessMessagingEnabled|canSendInThread/, name);
  }
});

// ── Phase 0A code ──────────────────────────────────────────────────────
test("PUBLIC_BUSINESS_COLUMNS excludes membership_status and every private column", () => {
  const src = read("src/lib/data.ts");
  const m = src.match(/export const PUBLIC_BUSINESS_COLUMNS =([\s\S]*?);/);
  assert.ok(m);
  const cols = m[1].match(/"([^"]*)"/g).join("").replace(/"/g, "").split(",").map((c) => c.trim()).filter(Boolean);
  for (const privateCol of ["membership_status", "lead_status", "email", "phone", "plan_tier", "plan_expires_at", "stripe_account_id", "marketplace_fee_percent", "payout_method"]) {
    assert.ok(!cols.includes(privateCol), privateCol);
  }
  for (const kept of ["id", "slug", "name", "publication_status", "is_demo", "accepts_inquiries", "inquiry_topics"]) assert.ok(cols.includes(kept), kept);
});
