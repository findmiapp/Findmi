// Guest-First Experience Completion pass, Part B — anonymous factual
// Location submission ("I'm Just Adding It To Findmi" with no account).
// Tests the rate limiter's pure core directly (in-memory, no headers()/
// Next.js runtime needed) and source-guards createMemberLocation's own
// anonymous branch plus the new success UI — same no-rendering-harness
// convention as every other action/page test in this suite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/headers") return { url: "data:text/javascript,export const headers=async()=>new Map();", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const RL = await import("../src/lib/anonymous-location-rate-limit.ts");
const read = (p) => readFileSync(p, "utf8");
const ACTIONS = read("src/app/(public)/account/location/actions.ts");
const PAGE = read("src/app/(public)/account/location/new/page.tsx");

// ── Rate limiter (pure core) ─────────────────────────────────────────────

test("anonymous Location rate limiter: allows up to the max, then blocks, within one window", () => {
  const T0 = Date.UTC(2026, 0, 1);
  const ip = "203.0.113.5";
  for (let i = 0; i < RL.ANONYMOUS_LOCATION_MAX_PER_WINDOW; i++) {
    assert.equal(RL.recordAnonymousLocationSubmission(ip, T0 + i), false, `attempt ${i + 1} should be allowed`);
  }
  assert.equal(RL.recordAnonymousLocationSubmission(ip, T0 + 999), true, "one more than the max is blocked");
});

test("anonymous Location rate limiter: a blocked attempt is never recorded, so the window recovers on schedule", () => {
  const T0 = Date.UTC(2026, 0, 2);
  const ip = "203.0.113.6";
  for (let i = 0; i < RL.ANONYMOUS_LOCATION_MAX_PER_WINDOW; i++) RL.recordAnonymousLocationSubmission(ip, T0 + i);
  assert.equal(RL.recordAnonymousLocationSubmission(ip, T0 + 100), true);
  assert.equal(RL.recordAnonymousLocationSubmission(ip, T0 + RL.ANONYMOUS_LOCATION_WINDOW_MS + 1), false, "the window has rolled forward");
});

test("anonymous Location rate limiter: separate IPs never share a bucket", () => {
  const T0 = Date.UTC(2026, 0, 3);
  for (let i = 0; i < RL.ANONYMOUS_LOCATION_MAX_PER_WINDOW; i++) RL.recordAnonymousLocationSubmission("198.51.100.1", T0 + i);
  assert.equal(RL.recordAnonymousLocationSubmission("198.51.100.1", T0 + 500), true);
  assert.equal(RL.recordAnonymousLocationSubmission("198.51.100.2", T0 + 500), false, "a different IP has its own budget");
});

// ── createMemberLocation: the anonymous branch ───────────────────────────

test("only the generic, context-free, 'adding' intent is anonymous-eligible — Business/parent context and 'manage' intent still require identity", () => {
  assert.match(ACTIONS, /const isAnonymousFactualSubmission = intent === "adding" && !businessId && !parentLocationId;/);
  assert.match(ACTIONS, /if \(!user && !isAnonymousFactualSubmission\) \{/);
});

test("the anonymous path is rate-limited before any duplicate check or insert runs", () => {
  const anonBranch = ACTIONS.indexOf("if (!user) {\n    const ip = await anonymousLocationClientIp();");
  const duplicateCheck = ACTIONS.indexOf("const duplicate = (await findLikelyDuplicateLocations(");
  assert.ok(anonBranch > 0, "rate-limit check exists");
  assert.ok(anonBranch < duplicateCheck, "rate limiting runs before the duplicate check/insert");
  assert.match(ACTIONS, /if \(recordAnonymousLocationSubmission\(ip\)\) \{\s*fail\(/);
});

test("no anonymous database-write permission was introduced — the insert still goes through the SAME admin (service-role) client and is_demo=true pending-review path every submission already used, never a client-side/anonymous Supabase write", () => {
  assert.match(ACTIONS, /const admin = getAdminSupabase\(\);/);
  assert.match(ACTIONS, /await admin\s*\.from\("locations"\)\s*\.insert\(\{/);
  assert.match(ACTIONS, /is_demo: true,/);
  // No new table, no RLS policy reference, no raw SQL anywhere in this file.
  assert.doesNotMatch(ACTIONS, /create table|create policy|alter table/i);
});

test("submission NEVER grants ownership/management/claim/Business relationship for the anonymous path — identical guarantee to the authenticated generic path, just reachable without a session", () => {
  const createFn = ACTIONS.slice(ACTIONS.indexOf("export async function createMemberLocation"), ACTIONS.indexOf("// ── INLINE EVENT LOCATION CREATION"));
  assert.doesNotMatch(createFn, /location_members/, "createMemberLocation itself never touches location_members");
  // The claim-request insert (the only place user identity is written) is
  // reachable only behind intent === "manage", which is never anonymous-
  // eligible — see the test above.
  const manageBlock = ACTIONS.slice(ACTIONS.indexOf('if (intent === "manage") {'), ACTIONS.indexOf("}\n  // Best-effort only"));
  assert.match(manageBlock, /user!\.id/);
  assert.match(manageBlock, /user!\.email/);
});

test("anonymous success never redirects to Login or Account Home — it lands back on this same, already guest-accessible page", () => {
  assert.match(ACTIONS, /if \(!user\) redirect\(`\$\{CREATE_LOCATION_PATH\}\?submitted=1`\);/);
});

// ── Page: button branching + success UI ──────────────────────────────────

test("the generic ('I'm Just Adding It To Findmi') submit button works for everyone — no GuestCreateSubmit auth gate on that specific branch", () => {
  const formBlock = PAGE.slice(PAGE.indexOf('<form id="create-location-form"'));
  assert.match(formBlock, /\{business \|\| parent \? \(/);
  assert.match(formBlock, /<GuestCreateSubmit/);
  assert.match(formBlock, /<button type="submit" className=\{`mt-2 \$\{primaryButtonClass\}`\}>\s*Add Location\s*<\/button>/);
});

test("anonymous success state: never implies ownership, never forces account creation, optional secondary CTA only", () => {
  assert.match(PAGE, /submitted === "1"/);
  assert.match(PAGE, /Location Submitted/);
  assert.match(PAGE, /No account is required for this\./);
  assert.doesNotMatch(PAGE.slice(PAGE.indexOf('submitted === "1"'), PAGE.indexOf('submitted === "1"') + 1200), /redirect\(.\/login|redirect\(.\/account(?!\/location)/);
});

test("no migration was added for this pass — the latest migration is unchanged from the reviewed Guest-First Creation baseline", () => {
  const files = readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  assert.equal(files.at(-1), "20261026000000_business_availability_details.sql");
});
