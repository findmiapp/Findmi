// Opportunities Cleanup Pass A — truthful terminology, Event-participation
// separation, Credits removal, the new-send/response notification handoff,
// and "New" wording corrections. Pure static guards over sources (plus a
// couple of already-existing domain functions used unchanged). No
// database, no production writes. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { businessOpportunityGroup } from "../src/lib/opportunity-listings-domain.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const B = "src/app/(public)/account/business/[id]";
const VIEW = read(`${B}/v2/OpportunitiesView.tsx`);
const HOME = read(`${B}/v2/BusinessHome.tsx`);
const GOALS_NEW = read(`${B}/opportunities/goals/new/page.tsx`);
const WIZARD = read(`${B}/opportunities/goals/GoalWizard.tsx`);
const BIZ_ACTIONS = read(`${B}/opportunities/actions.ts`);
const DETAIL = read(`${B}/opportunities/[recipientId]/page.tsx`);
const EXPLORE_DETAIL = read(`${B}/opportunities/explore/[listingId]/page.tsx`);
const CARD = read("src/components/opportunities/BusinessOpportunityCard.tsx");
const PRESENTATION = read("src/components/opportunities/OpportunityPresentation.tsx");
const INBOX = read("src/app/(public)/account/messages/page.tsx");
const LISTINGS_LIB = read("src/lib/opportunity-listings.ts");
const ADMIN_ACTIONS = read("src/app/admin/(protected)/opportunities/actions.ts");

// ---------------------------------------------------------------- 1. no false automation claims, repo-wide
const FALSE_CLAIM_PATTERNS = [
  /surface relevant Opportunities/i,
  /surfaces relevant Opportunities/i,
  /use your goals to surface/i,
  /uses your goals to surface/i,
  /use these goals to surface/i,
  /will use them to surface/i,
  /we'll surface relevant/i,
  /helps Findmi surface/i,
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

test("no business-facing copy, anywhere in src/, claims Findmi automatically matches/surfaces Opportunities from Goals", () => {
  const files = walk(path.join(ROOT, "src"));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const pattern of FALSE_CLAIM_PATTERNS) {
      assert.equal(pattern.test(text), false, `${path.relative(ROOT, file)} matches ${pattern}`);
    }
  }
});

test("Goals copy is reframed as human-assisted, not automated — and never claims AI/algorithmic matching", () => {
  for (const src of [VIEW, HOME, GOALS_NEW, WIZARD]) {
    assert.equal(/\bAI\b|algorithm|automatically matched/i.test(strip(src)), false);
  }
  // The honest replacement language the task specified is actually present
  // somewhere in the Goals-adjacent copy, not just "not false."
  assert.match(VIEW, /Findmi team/);
  assert.match(GOALS_NEW, /Findmi team/);
});

// ---------------------------------------------------------------- 2/3. For You / Explore unchanged semantics
test("For You stays backed by the same offered+open recipient semantics (unchanged)", () => {
  assert.equal(businessOpportunityGroup("open", "offered"), "for_you");
  assert.equal(businessOpportunityGroup("closed", "offered"), "past");
  assert.match(VIEW, /i\.view\.group === "for_you"/);
  assert.match(VIEW, /title="Recommended For You"/);
});

test("Explore copy communicates open/self-discoverable Opportunities, never a Goals claim", () => {
  assert.match(VIEW, /title="Explore" copy="Open Opportunities any Business can discover\."/);
});

// ---------------------------------------------------------------- 5. Credits removed from business UX
test("Opportunity Credits presentation is removed from business-facing surfaces, left dormant elsewhere", () => {
  assert.equal(/Credits Eligible|CreditIcon/.test(CARD), false);
  for (const src of [DETAIL, EXPLORE_DETAIL]) assert.match(src, /showCredits=\{false\}/);
  // The shared component still supports Credits (Admin keeps seeing it) —
  // this pass only adds an opt-out, never deletes the field or the column.
  assert.match(PRESENTATION, /showCredits = true/);
  assert.match(PRESENTATION, /credits_eligible/);
});

test("the credits_eligible column and the admin form control are untouched (dormant infrastructure, not deleted)", () => {
  const migration = read("supabase/migrations/20261006044707_opportunity_listings_v1.sql");
  assert.match(migration, /credits_eligible\s+boolean not null default false/);
  const form = read("src/app/admin/(protected)/opportunities/OpportunityForm.tsx");
  assert.match(form, /Credits Eligible/);
});

// ---------------------------------------------------------------- 6. Inbox terminology
test("the Inbox's Event-invitations filter is no longer labeled Opportunities (route/query value unchanged)", () => {
  assert.match(INBOX, /type InboxFilter = "all" \| "customers" \| "opportunities";/, "query value unchanged");
  assert.match(INBOX, /href=\{f === "all" \? "\/account\/messages" : `\/account\/messages\?filter=\$\{f\}`\}/, "route unchanged");
  assert.equal(/: "Opportunities"/.test(INBOX), false, "no literal 'Opportunities' pill label remains");
  assert.match(INBOX, /"Event Invitations"/);
  assert.equal(/No opportunities right now\./.test(INBOX), false);
  assert.match(INBOX, /No event invitations right now\./);
});

// ---------------------------------------------------------------- 7. Event section removed from commercial view
test("the commercial Opportunities view no longer embeds Event Invitations & Applications", () => {
  assert.equal(/Event Invitations/.test(strip(VIEW)), false);
  assert.equal(/respondToEventInvitation/.test(strip(VIEW)), false);
  assert.equal(/EventParticipationSection/.test(VIEW), false);
  // The underlying Event-participation system itself is untouched.
  const opportunitiesLib = read("src/lib/opportunities.ts");
  assert.match(opportunitiesLib, /getPendingInvitationsForBusiness/);
  assert.match(INBOX, /getPendingInvitationsForBusiness|getApplicationsForBusiness/);
});

// ---------------------------------------------------------------- 8. Home Event Invitation tile routing
test("Home's Event Invitation tile routes to the Inbox's Event destination, not the commercial Opportunities tab", () => {
  const sectionAt = HOME.indexOf("pendingInvitationCount > 0 &&");
  const tileAt = HOME.indexOf("{pendingInvitationCount} Event Invitation");
  assert.ok(sectionAt > -1 && tileAt > sectionAt, "tile copy present");
  const tile = HOME.slice(sectionAt, tileAt);
  assert.match(tile, /href="\/account\/messages\?filter=opportunities"/);
  assert.equal(/href=\{`\$\{basePath\}\?tab=opportunities`\}/.test(tile), false);
});

// ---------------------------------------------------------------- 9/13. Notifications + dedup + response scoping
test("sendOpportunity notifies only genuinely-new recipients, via the canonical recipient-resolution helper", () => {
  const at = ADMIN_ACTIONS.indexOf("export async function sendOpportunity(");
  const body = ADMIN_ACTIONS.slice(at, ADMIN_ACTIONS.indexOf("\nexport async function", at + 1));
  assert.match(body, /getEntityManagerEmails/);
  // The notify loop is INSIDE the insertedRows map, never over `rows` (the
  // full requested set) or `skippedBusinessIds` (already-sent, repeat-send
  // skips) — that's what makes a repeat send a no-op for notifications.
  const notifyLoopStart = body.indexOf("await Promise.all(\n      insertedRows.map(async (r)");
  assert.ok(notifyLoopStart > -1, "notify loop over insertedRows found");
  const notifyLoop = body.slice(notifyLoopStart, body.indexOf("\n  }\n", notifyLoopStart));
  assert.equal(/skippedBusinessIds/.test(notifyLoop), false, "notify loop never iterates skipped (already-sent) businesses");
  assert.equal(/\brows\.map/.test(notifyLoop), false, "notify loop never iterates the full requested set, only genuinely-inserted rows");
  assert.match(notifyLoop, /sendProductNotification\(\{/);
  assert.match(notifyLoop, /actionUrl: `\/account\/business\/\$\{r\.business_id\}\/opportunities\/\$\{r\.id\}`/);
});

test("the admin send-notification import is the canonical recipient resolver, not an ad-hoc member scan", () => {
  assert.match(ADMIN_ACTIONS, /import \{ getEntityManagerEmails \} from "@\/lib\/notifications\/recipients";/);
  assert.match(ADMIN_ACTIONS, /import \{ sendProductNotification \} from "@\/lib\/notifications\/productNotify";/);
});

test("response notifications (interested/not_interested) notify Admin only, scoped to that one recipient/listing", () => {
  const respondAt = LISTINGS_LIB.indexOf("export async function respondToOpportunityListing(");
  const respond = LISTINGS_LIB.slice(respondAt, LISTINGS_LIB.indexOf("\n}\n", respondAt));
  assert.match(respond, /actionUrl: `\/admin\/opportunities\/\$\{row\.listing_id\}#recipient-\$\{args\.recipientId\}`/);
  const exploreAt = LISTINGS_LIB.indexOf("export async function expressExploreInterest(");
  const explore = LISTINGS_LIB.slice(exploreAt, LISTINGS_LIB.indexOf("\n}\n", exploreAt));
  assert.match(explore, /actionUrl: `\/admin\/opportunities\/\$\{args\.listingId\}#recipient-\$\{data\.id\}`/);
});

// ---------------------------------------------------------------- 10. "New" -> truthful wording
test("Home's Opportunities badge no longer says 'New' for an offered-and-unanswered item, and the count logic is unchanged", () => {
  assert.equal(/\d? ?New<\/Chip>|\} New<\/Chip>/.test(HOME), false);
  assert.match(HOME, /Needs Response<\/Chip>/);
  // Same underlying filter (offered + open), just renamed from newOnes.
  assert.match(HOME, /awaitingResponse = items\.filter\(\(i\) => i\.view\.group === "for_you"\)/);
});

// ---------------------------------------------------------------- 11. authorization unchanged
test("authorization is unchanged: owner/manager-only response, never Admin Manage-As, same canonical checks", () => {
  assert.match(BIZ_ACTIONS, /respondToOpportunityListing/);
  assert.match(LISTINGS_LIB, /checkBusinessResponse\(\{/);
  assert.match(LISTINGS_LIB, /membership\.viaAdmin/);
});
