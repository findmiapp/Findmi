// Admin Event Import — two production-smoke repairs:
//   1. A source Event image can't render straight from a third-party CDN
//      (the page CSP allows only Findmi / data: images, and stays that way):
//      Review now shows a verified, re-encoded data-URI preview made by the
//      SAME fetch + verification the save path (recoverEventImage) uses.
//   2. An Event resolved as already on Findmi is never counted or saved as a
//      new Event — it is updated only by Review Existing Event.
// Fakes only — no network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import sharp from "sharp";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/cache") return { url: "data:text/javascript,export const revalidatePath=()=>{};", shortCircuit: true };
    if (specifier === "@/lib/admin/requireAdminSupabase")
      return { url: "data:text/javascript,export async function requireAdminSupabase(){const c=globalThis.__ADMIN;if(!c)throw new Error('Unauthorized');return c;}", shortCircuit: true };
    if (specifier === "next/headers") return { url: "data:text/javascript,export const cookies=async()=>({get(){return undefined}});export const headers=async()=>new Map();", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const M = await import("../src/lib/event-import/media.ts");
const A = await import("../src/app/admin/(protected)/events/import/actions.ts");
const read = (p) => readFileSync(p, "utf8");
const CLIENT = read("src/app/admin/(protected)/events/import/AdminEventImporter.tsx");
const MULTI = read("src/app/(public)/account/business/[id]/import-event/MultiEventImport.tsx");
const NEXT_CONFIG = read("next.config.mjs");

const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 176, b: 188 } } }).png().toBuffer();
const fetchOk = (body, contentType = "image/png") => async (url) => ({ ok: true, url: new URL(url), body, contentType, bytes: body.length, redirects: 0 });
const CDN = "https://cdn.shopify.com/s/files/1/goodamerican/nyc-popup.png";

// ── 1. IMAGE PREVIEW ──────────────────────────────────────────────────────

test("root cause: the CSP allows only Findmi / data: / Supabase / Unsplash / Tally images — and stays that way", () => {
  assert.match(NEXT_CONFIG, /"img-src 'self' data: blob: https:\/\/\*\.supabase\.co https:\/\/images\.unsplash\.com https:\/\/\*\.tally\.so"/);
  // So the Review never points an <img> at the remote candidate URL any more.
  assert.doesNotMatch(CLIENT, /<img src=\{review\.imageUrl\}|<img src=\{p\.logo\}|<img src=\{p\.cover\}/);
  assert.match(CLIENT, /<VerifiedEventImagePreview url=\{review\.imageUrl\}/);
  assert.match(CLIENT, /\{c\.field === "image" && c\.kind !== "same" && <VerifiedEventImagePreview url=\{c\.proposed\}/, "Review Existing Event shows the image, not only its URL");
});

test("a valid source image previews as a small WebP data URI, through the SAME verification the save path uses", async () => {
  const body = await png(1200, 800);
  const deps = { fetchImage: fetchOk(body) };
  const preview = await M.previewEventImage(CDN, deps);
  assert.equal(preview.reason, null);
  assert.match(preview.preview, /^data:image\/webp;base64,/);
  assert.ok(Buffer.from(preview.preview.split(",")[1], "base64").length <= 120 * 1024);
  const meta = await sharp(Buffer.from(preview.preview.split(",")[1], "base64")).metadata();
  assert.ok(meta.width <= 640 && meta.height <= 640, "a re-encoded thumbnail, never the original");
  // Same verification as recoverEventImage (fetchVerifiedEventImage).
  assert.equal((await M.fetchVerifiedEventImage(CDN, deps)).ok, true);
});

test("an image the save path would reject gets no preview — with the same reason (a preview never implies it was saved)", async () => {
  const tiny = { fetchImage: fetchOk(await png(80, 80)) };
  assert.deepEqual(await M.previewEventImage(CDN, tiny), { preview: null, reason: "unsuitable" });
  assert.deepEqual(await M.fetchVerifiedEventImage(CDN, tiny), { ok: false, reason: "unsuitable" });
  const blocked = { fetchImage: async () => ({ ok: false, code: "blocked_destination", redirects: 0 }) };
  assert.deepEqual(await M.previewEventImage(CDN, blocked), { preview: null, reason: "fetch_failed" });
  const html = { fetchImage: fetchOk(Buffer.from("<html></html>"), "text/html") };
  assert.deepEqual(await M.previewEventImage(CDN, html), { preview: null, reason: "type_mismatch" });
  assert.match(read("src/app/admin/(protected)/events/import/preview-view.ts"), /Saving checks the image again; if it fails then, no image is saved\./);
  // Saving is unchanged: the Event image is still stored only through recoverEventImage.
  assert.match(read("src/app/admin/(protected)/events/import/actions.ts"), /const stored = await recoverEventImage\(admin, url\);/);
});

test("the preview action is Admin-only, https-only, and stores nothing", async () => {
  globalThis.__ADMIN = undefined;
  assert.deepEqual(await A.adminPreviewEventImage(CDN), { preview: null, reason: "fetch_failed" });
  globalThis.__ADMIN = { from: () => assert.fail("no database access") };
  assert.deepEqual(await A.adminPreviewEventImage("http://example.com/a.png"), { preview: null, reason: "fetch_failed" });
  assert.deepEqual(await A.adminPreviewEventImage("https://user:pw@example.com/a.png"), { preview: null, reason: "fetch_failed" });
  globalThis.__ADMIN = undefined;
  const fn = read("src/lib/event-import/media.ts").slice(read("src/lib/event-import/media.ts").indexOf("export async function previewEventImage"));
  assert.doesNotMatch(fn, /storePublicImage|storeEventImage|\.storage\./, "preview never stores");
});

test("inline Create & Review Business uses Brand Import's own verified logo / cover previews (from the stored candidate, not a client URL)", () => {
  const actions = read("src/app/admin/(protected)/events/import/actions.ts");
  assert.match(actions, /view\.proposal\.logo \? previewBrandCandidateResult\(view\.proposal\.logo, "logo"\)/);
  assert.match(actions, /export async function adminPreviewBusinessRead\(batchId: string, candidateId: string\)/);
  assert.match(CLIENT, /if \(!logo\) setUseLogo\(false\);/, "an unpreviewable image starts unselected, as on Admin → Businesses → Import");
});

// ── 2. EXISTING EVENTS ARE NEVER "ADDED" ──────────────────────────────────

test("the batch CTA counts only NEW Events; existing Events are pointed to Apply To Existing Event", () => {
  assert.match(MULTI, /const existingRows = operator \? chosen\.filter\(\(e\) => reviews\[e\.key\]\?\.useEventId\) : \[\];/);
  assert.match(MULTI, /const toSave = operator \? ready\.filter\(\(e\) => !reviews\[e\.key\]\.useEventId\) : ready;/);
  assert.match(MULTI, /operator\.commit\(toSave\.map\(/, "existing rows are never sent to new-Event saving");
  assert.match(MULTI, /`Add \$\{toSave\.length\} New \$\{toSave\.length === 1 \? "Event" : "Events"\}`/);
  assert.match(MULTI, /"No New Events To Add"/);
  assert.match(MULTI, /disabled=\{saving \|\| toSave\.length === 0\}/);
  assert.match(MULTI, /update \{existingRows\.length === 1 \? "it" : "each"\} with Apply To Existing Event/);
  // The Business importer's batch is unchanged (its "join" requests are real saves).
  assert.match(MULTI, /: `Add \$\{ready\.length\} \$\{ready\.length === 1 \? "Event" : "Events"\}`\}/);
});

test("server guard: a review resolved to an existing Event never reaches new-Event creation, whatever the client sends", async () => {
  const ops = [];
  globalThis.__ADMIN = { from: (table) => (ops.push(table), assert.fail(`no write expected (${table})`)), rpc: () => assert.fail("no rpc") };
  const existing = "eeeeeeee-0000-4000-8000-000000000001";
  const res = await A.adminCommitEventImportBatch([
    {
      review: { intent: "participating", title: "Good American NYC Pop-Up", description: null, imageUrl: null, sourceUrl: "https://goodamerican.com/pages/nyc-pop-up", occurrences: [{ date: "2026-10-15", startTime: "11:00", endTime: "18:00", place: { venueName: "The Canvas", address: null, city: null, state: null, postalCode: null, useLocationId: null } }], sharedPlace: false, place: { venueName: null, address: null, city: null, state: null, postalCode: null, useLocationId: null }, organizer: null, useEventId: existing, asEvent: true },
      businessId: null,
    },
  ]);
  assert.deepEqual(res, { ok: true, results: [{ title: "Good American NYC Pop-Up", outcome: { ok: true, kind: "already", title: "Good American NYC Pop-Up", viewHref: `/admin/events/${existing}` } }] });
  assert.deepEqual(ops, [], "nothing read or written");
  globalThis.__ADMIN = undefined;
});
