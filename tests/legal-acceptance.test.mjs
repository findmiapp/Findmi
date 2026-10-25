// Legal acceptance foundation (Phase 2A): registry rules and static guards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LEGAL_ACCEPTANCE_CONTEXTS,
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_IDS,
  documentsForContext,
  isLegalDocumentId,
  outstandingDocuments,
} from "../src/lib/legal/documents.ts";

const ID_RE = /^[a-z][a-z0-9_]{1,63}$/; // mirrors the legal_acceptances CHECK constraints

test("identifiers satisfy the database constraints", () => {
  for (const id of LEGAL_DOCUMENT_IDS) assert.match(id, ID_RE);
  for (const c of LEGAL_ACCEPTANCE_CONTEXTS) assert.match(c, ID_RE);
  assert.equal(isLegalDocumentId("terms"), true);
  assert.equal(isLegalDocumentId("TERMS"), false);
});

test("Phase 2A publishes nothing, so nothing is required anywhere", () => {
  for (const d of Object.values(LEGAL_DOCUMENTS)) assert.equal(d.currentVersion, null, `${d.id} must stay unpublished until Phase 2B`);
  for (const c of LEGAL_ACCEPTANCE_CONTEXTS) assert.deepEqual(documentsForContext(c), []);
});

test("a version change makes an older acceptance outstanding", () => {
  const registry = structuredClone(LEGAL_DOCUMENTS);
  registry.terms.currentVersion = "2026-12-01";
  assert.deepEqual(outstandingDocuments("signup", {}, registry).map((d) => d.id), ["terms"]);
  assert.deepEqual(outstandingDocuments("signup", { terms: "2026-12-01" }, registry), []);
  assert.deepEqual(outstandingDocuments("signup", { terms: "2026-11-01" }, registry).map((d) => d.id), ["terms"]);
  assert.deepEqual(outstandingDocuments("marketplace_checkout", {}, registry), []);
});

test("acceptance records never include IP or user agent", () => {
  const src = readFileSync("src/lib/legal/acceptance.ts", "utf8");
  assert.ok(!/ip_address|ip_hash|x-forwarded-for|user-agent|user_agent/i.test(src));
});
