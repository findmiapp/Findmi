// Legal acceptance foundation (Phase 2A): registry rules and static guards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require_child = () => createRequire(import.meta.url)("node:child_process");
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

test("only the Terms and the Privacy Policy are published, at the pages' Last updated date", () => {
  const published = readFileSync("src/lib/legal/published.ts", "utf8");
  const iso = (label) => {
    const m = published.match(new RegExp(`${label} = "([A-Za-z]+ \\d+, \\d{4})"`));
    return new Date(`${m[1]} UTC`).toISOString().slice(0, 10);
  };
  assert.equal(LEGAL_DOCUMENTS.terms.currentVersion, iso("TERMS_LAST_UPDATED"));
  assert.equal(LEGAL_DOCUMENTS.privacy_acknowledgement.currentVersion, iso("PRIVACY_LAST_UPDATED"));
  for (const d of Object.values(LEGAL_DOCUMENTS)) {
    if (d.id !== "terms" && d.id !== "privacy_acknowledgement") assert.equal(d.currentVersion, null, `${d.id} stays unpublished`);
  }
  assert.deepEqual(documentsForContext("signup").map((d) => d.id), ["terms", "privacy_acknowledgement"]);
  for (const c of LEGAL_ACCEPTANCE_CONTEXTS) {
    if (c !== "signup" && c !== "reacceptance") assert.deepEqual(documentsForContext(c), [], c);
  }
});

test("existing accounts are never blocked: nothing gates a flow on outstanding documents", () => {
  const { execSync } = require_child();
  const hits = execSync("grep -rln 'getOutstandingDocuments\\|outstandingDocuments(' src || true", { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  assert.deepEqual(hits.sort(), ["src/lib/legal/acceptance.ts", "src/lib/legal/documents.ts"]);
});

test("signup: the notice, the links, the shown version, and acceptance recorded only for that version", () => {
  const form = readFileSync("src/app/(public)/signup/SignupForm.tsx", "utf8");
  const action = readFileSync("src/app/(public)/signup/actions.ts", "utf8");
  assert.match(form, /By creating an account, you agree to Findmi&rsquo;s\{" "\}\s*<Link href="\/terms"[^>]*>\s*Terms of Service\s*<\/Link>\{" "\}\s*and acknowledge the\{" "\}\s*<Link href="\/privacy"[^>]*>\s*Privacy Policy\s*<\/Link>/);
  assert.doesNotMatch(form, /agree to (Findmi&rsquo;s )?(the )?Privacy Policy/);
  assert.doesNotMatch(form, /type="checkbox"/, "Create Account itself is the assent");
  // Notice sits right above the Create Account button, inside the form.
  assert.ok(form.indexOf("By creating an account") < form.indexOf("<SubmitButton") && form.indexOf("<SubmitButton") < form.indexOf("</form>"));
  assert.match(form, /<input type="hidden" name="terms_version" value=\{LEGAL_DOCUMENTS\.terms\.currentVersion \?\? ""\} \/>/);
  assert.match(action, /shownTermsVersion !== "" && shownTermsVersion === LEGAL_DOCUMENTS\.terms\.currentVersion\) \{\s*await recordContextAcceptance\(admin, data\.user\.id, "signup"\);/);
  // Recorded after the account exists, never before a failed signup.
  assert.ok(action.indexOf("recordContextAcceptance(admin") > action.indexOf("supabase.auth.signUp("));
});

test("a version change makes an older acceptance outstanding", () => {
  const registry = structuredClone(LEGAL_DOCUMENTS);
  registry.terms.currentVersion = "2026-12-01";
  registry.privacy_acknowledgement.currentVersion = null; // isolate the Terms version rule
  assert.deepEqual(outstandingDocuments("signup", {}, registry).map((d) => d.id), ["terms"]);
  assert.deepEqual(outstandingDocuments("signup", { terms: "2026-12-01" }, registry), []);
  assert.deepEqual(outstandingDocuments("signup", { terms: "2026-11-01" }, registry).map((d) => d.id), ["terms"]);
  assert.deepEqual(outstandingDocuments("marketplace_checkout", {}, registry), []);
});

test("acceptance records never include IP or user agent", () => {
  const src = readFileSync("src/lib/legal/acceptance.ts", "utf8");
  assert.ok(!/ip_address|ip_hash|x-forwarded-for|user-agent|user_agent/i.test(src));
});
