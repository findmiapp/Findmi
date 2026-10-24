// Guest-First Experience Completion pass, Part A — Guest Moment creation.
// Source-level guards over the real composer wiring (no rendering
// harness, no database), same convention as every other
// server-action/page test in this suite. Behavioral coverage of the pure
// draft module lives in tests/guest-moment-draft.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const MIDDLEWARE = read("src/middleware.ts");
const COMPOSER = read("src/components/journal/MomentComposer.tsx");
const PHOTO_HOOK = read("src/components/journal/useJournalPhotoUpload.ts");
const PHOTOS_STAGE = read("src/components/journal/MomentPhotosStage.tsx");
const NEW_PAGE = read("src/app/(public)/my-world/journal/new/page.tsx");
const SEARCH_ROUTE = read("src/app/api/account/search/route.ts");
const QUICK_CREATE = read("src/components/QuickCreateMenu.tsx");

// ── Middleware: the one carve-out, nothing wider ─────────────────────────

test("middleware lets a signed-out visitor reach the cold Add Moment composer only — every other /my-world/journal/* route (archive, editing an entry) is unaffected", () => {
  assert.match(MIDDLEWARE, /if \(!user && pathname === "\/my-world\/journal\/new"\) return response;/);
  const journalBranch = MIDDLEWARE.slice(MIDDLEWARE.indexOf('pathname.startsWith("/my-world/journal")'), MIDDLEWARE.indexOf("// --- Consumer /account"));
  assert.match(journalBranch, /if \(!user\) \{\s*const loginUrl = new URL\("\/login", request\.url\);/, "every OTHER journal path still redirects");
});

// ── Composer: guest/authed branching ─────────────────────────────────────

test("MomentComposer takes an authed prop (default true — mode:edit's route stays fully gated) and computes guestMode from it, never a separate hook call per mode", () => {
  assert.match(COMPOSER, /authed\?: boolean;/);
  assert.match(COMPOSER, /resume\?: boolean;/);
  assert.match(COMPOSER, /const guestMode = !authed;/);
  // One hook call, guestMode passed as a plain argument — never a
  // conditional hook call (authed ? useX() : useY()), which would break
  // the Rules of Hooks regardless of how stable the condition is.
  assert.match(COMPOSER, /useJournalPhotoUpload\(initial\.photos, ensureEntryId, guestMode\)/);
  assert.doesNotMatch(COMPOSER, /authed\s*\?\s*useJournalPhotoUpload/);
});

test("finish() never reaches the real journal_entries pipeline for a guest — validation runs first, then it diverts entirely", () => {
  const finishFn = COMPOSER.slice(COMPOSER.indexOf("async function finish("), COMPOSER.indexOf("\n  const uploading ="));
  const guestBranch = finishFn.indexOf("if (guestMode) {");
  const ensureCall = finishFn.indexOf("const id = await ensureEntryId();");
  assert.ok(guestBranch > 0 && ensureCall > 0 && guestBranch < ensureCall, "the guest diversion comes before any real persistence call");
  assert.match(finishFn, /finishAsGuest\(action === "publish" \? "publish" : "draft"\);\s*\n\s*return;/);
});

test("finishAsGuest only ever writes the local draft and shows the contextual auth prompt — never calls startJournalDraft/ensureEntryId", () => {
  const fn = COMPOSER.slice(COMPOSER.indexOf("function finishAsGuest("), COMPOSER.indexOf("async function finish("));
  assert.match(fn, /persistGuestDraft\(action\);/);
  assert.match(fn, /setGuestAuthPrompt\(action\);/);
  assert.doesNotMatch(fn, /ensureEntryId|startJournalDraft/);
});

test("the contextual auth prompt names what's about to happen and links back to the SAME bare resume route — never a generic /login wall", () => {
  const sheet = COMPOSER.slice(COMPOSER.indexOf("{guestAuthPrompt && ("), COMPOSER.indexOf("{foundDraftPrompt && ("));
  assert.match(sheet, /Your Moment Is Ready/);
  assert.match(sheet, /Create a free Findmi account to save it to your Findmi world\./);
  assert.match(sheet, /\/signup\?next=\$\{encodeURIComponent\("\/my-world\/journal\/new\?resume=1"\)\}/);
  assert.match(sheet, /\/login\?next=\$\{encodeURIComponent\("\/my-world\/journal\/new\?resume=1"\)\}/);
  assert.match(sheet, /Not Now/);
});

test("conversion is idempotency-guarded (once per mount) and anchors the server-assigned entryId into the draft BEFORE anything else is persisted to it", () => {
  const fn = COMPOSER.slice(COMPOSER.indexOf("async function convertGuestDraft("), COMPOSER.indexOf("// Runs once per mount."));
  assert.match(fn, /if \(conversionStartedRef\.current\) return;\s*\n\s*conversionStartedRef\.current = true;/);
  assert.match(fn, /if \(draft\.serverEntryId\) \{/);
  assert.match(fn, /let anchored: GuestMomentDraft = \{ \.\.\.draft, serverEntryId: id \};\s*\n\s*if \(draft\.serverEntryId !== id\) writeGuestMomentDraft\(anchored\);/);
  // Full success only — never clears the draft on a partial/failed attempt.
  assert.match(fn, /clearGuestMomentDraft\(\);/);
  assert.match(fn, /void deleteAllGuestMomentMedia\(draft\.media\.map\(\(m\) => m\.localId\)\);/);
});

test("conversion reuses the EXACT authenticated upload pipeline (photos.handleFiles) rather than a parallel upload implementation", () => {
  const fn = COMPOSER.slice(COMPOSER.indexOf("async function convertGuestDraft("), COMPOSER.indexOf("// Runs once per mount."));
  assert.match(fn, /await photos\.handleFiles\(\s*staged\.map\(\(x\) => x\.file\),/);
  assert.match(fn, /await persistAll\(id\);/, "Context/Your Moment persist through the same function every authenticated save already uses");
});

test("the mount check ALWAYS considers the stored draft (cold AND contextual entry) and lets decideGuestStartup choose — only resume=1 auto-converts; a guest's own draft is restored", () => {
  const effect = COMPOSER.slice(COMPOSER.indexOf("const mountCheckedRef = useRef(false);"), COMPOSER.indexOf("// Keeps the local draft current"));
  assert.match(effect, /readGuestMomentDraftStatus\(\)/);
  assert.match(effect, /decideGuestStartup\(\{ authed, resume, initial, draft \}\)/);
  assert.match(effect, /decision\.kind === "restore"\) void restoreGuestDraft\(decision\.draft\)/);
  assert.match(effect, /decision\.kind === "convert"\) void convertGuestDraft\(decision\.draft\)/);
  assert.match(effect, /setFoundDraftPrompt\(decision\.draft\)/);
  // The bug: the old check returned early for any contextual (?event=) entry, never reading the draft.
  assert.doesNotMatch(effect, /!isColdStart\(initial\)|return;\s*\n\s*\}\s*\n\s*const draft = readGuestMomentDraft/);
});

test("autosave waits for the mount check (autosaveReady), and only writes a draft worth keeping — never the bare cold/prefill start", () => {
  assert.match(COMPOSER, /const \[autosaveReady, setAutosaveReady\] = useState\(false\);/);
  const autosaveEffect = COMPOSER.slice(COMPOSER.indexOf("// Keeps the local draft current"), COMPOSER.indexOf("function continueFoundDraft"));
  assert.match(autosaveEffect, /if \(!guestMode \|\| !autosaveReady\) return;/);
  assert.match(autosaveEffect, /shouldPersistSnapshot\(snapshot, baselineSignatureRef\.current, persistedOnceRef\.current\)/);
});

test("autosave never runs for a signed-in composer, including one mid-conversion", () => {
  const autosaveEffect = COMPOSER.slice(COMPOSER.indexOf("// Keeps the local draft current"), COMPOSER.indexOf("function continueFoundDraft"));
  assert.match(autosaveEffect, /if \(!guestMode/);
});

// ── Photo hook: guest staging never touches the server ───────────────────

test("useJournalPhotoUpload's guest branches never call ensureEntryId — every server round trip is reached only on the non-guest path", () => {
  assert.match(PHOTO_HOOK, /guestMode = false/);
  const handleFiles = PHOTO_HOOK.slice(PHOTO_HOOK.indexOf("const handleFiles = useCallback("), PHOTO_HOOK.indexOf("const retryItem = useCallback("));
  const guestBranch = handleFiles.slice(handleFiles.indexOf("if (guestMode) {"), handleFiles.indexOf("timingRef.current.clear();"));
  assert.ok(guestBranch.length > 0 && guestBranch.includes("putGuestMomentMedia"));
  assert.doesNotMatch(guestBranch, /ensureEntryId\(\)/);
});

test("no anonymous journal_entries insert or journal-media Storage upload is reachable from guest mode — startJournalDraft/authorizeJournalPhotoUploadBatch are only ever called after ensureEntryId, which the guest branches never reach", () => {
  assert.doesNotMatch(PHOTO_HOOK, /guestMode[\s\S]{0,80}startJournalDraft/);
  assert.match(PHOTO_HOOK, /putGuestMomentMedia/);
  assert.match(PHOTO_HOOK, /deleteGuestMomentMedia/);
});

test("guest Remove/Retry/reorder/Make Cover/Add Note all branch to a local-only path before any ensureEntryId/server call", () => {
  const handleRemove = PHOTO_HOOK.slice(PHOTO_HOOK.indexOf("const handleRemove = useCallback("), PHOTO_HOOK.indexOf("const reorder = useCallback("));
  assert.match(handleRemove, /if \(item\.guestStaged\) \{/);
  const retryItem = PHOTO_HOOK.slice(PHOTO_HOOK.indexOf("const retryItem = useCallback("), PHOTO_HOOK.indexOf("const handleRemove = useCallback("));
  assert.match(retryItem, /if \(guestMode\) \{/);
  const reorder = PHOTO_HOOK.slice(PHOTO_HOOK.indexOf("const reorder = useCallback("), PHOTO_HOOK.indexOf("// Reorder While Some Photos Are Local"));
  assert.match(reorder, /if \(guestMode\) return;/);
  const saveCaption = PHOTO_HOOK.slice(PHOTO_HOOK.indexOf("const saveCaption = useCallback("), PHOTO_HOOK.indexOf("const makeCover = useCallback("));
  assert.match(saveCaption, /if \(guestMode\) return \{ ok: true \};/);
  const makeCover = PHOTO_HOOK.slice(PHOTO_HOOK.indexOf("const makeCover = useCallback("), PHOTO_HOOK.indexOf("return {\n    items,"));
  assert.match(makeCover, /if \(guestMode\) return;/);
});

// ── Sections stay identity-gated, cleanly, not by silent failure ─────────

test("MomentPhotosStage shows Organize Your Photos/sections to a guest too — sign-in never decides which photo tools render", () => {
  assert.match(PHOTOS_STAGE, /guestMode\?: boolean;/);
  assert.match(PHOTOS_STAGE, /\{!grouped && savedCount > 0 && \(/);
  assert.doesNotMatch(PHOTOS_STAGE, /!guestMode && savedCount/);
});

// ── Entry point + search support ─────────────────────────────────────────

test("the cold Add Moment page passes authed/resume through to the composer", () => {
  assert.match(NEW_PAGE, /resume\?: string/);
  assert.match(NEW_PAGE, /authed=\{Boolean\(user\)\}/);
  assert.match(NEW_PAGE, /resume=\{params\.resume === "1"\}/);
});

test("the Moment composer's own entity search (where/who) now reads for a signed-out visitor too — every other entity mode on this route is unchanged and still requires a session", () => {
  assert.match(SEARCH_ROUTE, /const isMomentSearch = entity === "where" \|\| entity === "who";/);
  assert.match(SEARCH_ROUTE, /if \(!user && !isMomentSearch\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\);/);
});

test("the global Create menu no longer tells every signed-out visitor they'll sign in first — only Create Event still needs identity up front", () => {
  assert.doesNotMatch(QUICK_CREATE, /You&rsquo;ll sign in first/);
  assert.match(QUICK_CREATE, /Create Event needs a Business or Location Page to publish through/);
});
