// Trust & Privacy Phase 2A: corrections / removal / reports rules,
// unmanaged-entity message routing, and platform vs Findmi-managed
// Opportunity copy. Pure rules + static guards; no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INTENT_REASONS, REPORT_REASONS, intentsFor, kindFor, validateReport } from "../src/lib/reports-domain.ts";
import { getBusinessOpportunityState } from "../src/lib/opportunity-listings-domain.ts";
import { sanitizeAuditDetail } from "../src/lib/admin/audit.ts";

const read = (p) => readFileSync(p, "utf8");
const ID = "11111111-2222-3333-4444-555555555555";

test("intents per content type", () => {
  assert.deepEqual(intentsFor("business"), ["correction", "removal", "report"]);
  assert.deepEqual(intentsFor("moment"), ["removal", "report"]);
  assert.deepEqual(intentsFor("message"), ["report"]);
  for (const list of Object.values(INTENT_REASONS)) for (const r of list) assert.ok(REPORT_REASONS.includes(r));
});

test("copyright and trademark removals are their own kinds", () => {
  assert.equal(kindFor("removal", "copyright"), "copyright");
  assert.equal(kindFor("removal", "trademark"), "trademark");
  assert.equal(kindFor("removal", "privacy"), "removal");
  assert.equal(kindFor("report", "spam_scam"), "report");
});

test("validation asks only for what each request needs", () => {
  const base = { entityType: "business", entityId: ID };
  assert.equal(validateReport({ ...base, intent: "correction", reason: "inaccurate" }).ok, false, "correction needs details");
  assert.equal(validateReport({ ...base, intent: "correction", reason: "inaccurate", details: "Hours are wrong" }).ok, true);
  assert.equal(validateReport({ ...base, intent: "removal", reason: "copyright", details: "My photo" }).ok, false, "rights complaint needs a relationship");
  assert.equal(validateReport({ ...base, intent: "removal", reason: "copyright", details: "My photo", relationship: "rights_holder" }).ok, true);
  assert.equal(validateReport({ ...base, intent: "report", reason: "spam_scam" }).ok, true, "a report can be reason-only");
  assert.equal(validateReport({ ...base, intent: "report", reason: "copyright" }).ok, false, "reason must fit the intent");
  assert.equal(validateReport({ ...base, entityId: "nope", intent: "report", reason: "other" }).ok, false);
  assert.equal(validateReport({ entityType: "message", entityId: ID, intent: "correction", reason: "inaccurate", details: "x" }).ok, false);
  assert.equal(validateReport({ ...base, intent: "report", reason: "other", email: "not-an-email" }).ok, false);
  assert.equal(validateReport({ ...base, intent: "report", reason: "other", evidenceUrl: "javascript:alert(1)" }).ok, false);
});

test("audit detail never keeps sensitive keys or long text", () => {
  const out = sanitizeAuditDetail({ role: "manager", password: "x", reset_link: "y", body: "z", message: "m", email: "e", count: 3, long: "a".repeat(500), nested: { a: 1 } });
  assert.deepEqual(Object.keys(out).sort(), ["count", "long", "role"]);
  assert.equal(out.long.length, 120);
});

test("Opportunity copy: only Findmi-managed says Findmi coordinates", () => {
  assert.match(getBusinessOpportunityState("open", "confirmed", "platform").message, /coordinate the engagement with the participating party/);
  assert.match(getBusinessOpportunityState("open", "confirmed").message, /participating party/, "default is platform");
  assert.match(getBusinessOpportunityState("open", "confirmed", "findmi_managed").message, /Findmi will coordinate/);
  assert.doesNotMatch(getBusinessOpportunityState("open", "interested").message, /will be in touch/);
});

test("static guards: unmanaged pages never receive a silent direct message", () => {
  const actions = read("src/app/(public)/connect/actions.ts");
  const entity = actions.slice(actions.indexOf("export async function submitEntityInquiry"), actions.indexOf("export interface SubmitProductInquiryInput"));
  assert.ok(entity.indexOf("entityHasRecipient(") > -1 && entity.indexOf("entityHasRecipient(") < entity.indexOf("subjectTypeFor(input.targetType)"), "recipient check before the direct path");
  assert.match(entity, /subjectType: "findmi_page_inquiry"/);
  const product = actions.slice(actions.indexOf("export async function submitProductInquiry"));
  assert.ok(product.indexOf("entityHasRecipient(") < product.indexOf('subjectType: "product_inquiry"'));
  assert.match(read("src/lib/message-visibility.ts"), /entityHasRecipient\(admin, targetType, targetId\)/);
  for (const page of ["src/app/(public)/business/[slug]/BusinessPublicView.tsx", "src/app/(public)/event/[slug]/EventPublicView.tsx", "src/app/(public)/location/[slug]/LocationPublicView.tsx"]) {
    const src = read(page);
    assert.match(src, /noRecipient=\{noRecipient\}/, page);
    assert.match(src, /<AboutThisPage /, page);
  }
  const inquire = read("src/components/InquireButton.tsx");
  assert.match(inquire, /so your message goes to Findmi, not to \{targetName\}/);
});

test("static guard: reports never delete or change the reported content", () => {
  const route = read("src/app/api/reports/route.ts");
  assert.doesNotMatch(route, /from\("[a-z_]+"\)\s*\.(delete|update|upsert)\(/);
  assert.match(route, /from\("content_reports"\)\s*\.insert/);
  assert.doesNotMatch(route, /ip_address|ip_hash/);
});
