// Foxden owner-workflow correction pass (production, 2026-10-26).
//
// Event import from a flyer: stacked / split / day-first dates, the
// next-occurrence year rule for owner flyer + pasted-text imports (link
// imports unchanged), AI date grounding over those layouts, "PRESENTED BY:"
// with the name on the next line, the organizer-vs-importing-Business
// decision (never switched automatically), existing-Event reuse, and the
// uploaded flyer as an OPTIONAL Event image (stored only when chosen).
//
// Galleries: Business / Event / Location uploads are crash-safe per file —
// a rejected upload is caught, never aborts the others, successes are kept,
// photos are reduced first, oversized HEIC is a recoverable failure.
// No network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import sharp from "sharp";

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

const S = await import("../src/lib/event-import/schedule.ts");
const TS = await import("../src/lib/event-import/text-source.ts");
const AI = await import("../src/lib/event-import/ai.ts");
const R = await import("../src/lib/event-import/review.ts");
const P = await import("../src/lib/event-import/persist.ts");
const M = await import("../src/lib/event-import/media.ts");
const G = await import("../src/lib/gallery-upload.ts");
const read = (f) => readFileSync(f, "utf8");

const OCT26 = Date.parse("2026-10-26T15:00:00Z");
const DEC15 = Date.parse("2026-12-15T15:00:00Z");
const flyer = (dateLines) =>
  ["KILLMEYER'S 3RD ANNUAL", "German Christmas MARKET", dateLines, "KILLMEYER'S", "4254 ARTHUR KILL ROAD", "STATEN ISLAND, NY", "PRESENTED BY:", "Faire and Flourish", "VENDORS WANTED", "APPLY TO BE A VENDOR", "FAIREANDFLOURISH.COM"].join("\n");
const occ = (text, now = OCT26) => TS.extractTextEventCandidate(text, { now, origin: "image" }).candidate.occurrences.map((o) => [o.start, o.end, o.hasTime]);
const NOV29_2026 = [["2026-11-29T18:00:00.000Z", "2026-11-29T23:00:00.000Z", true]];

// ------------------------------------------------------------ dates

test("flyer dates: same line, stacked, split ordinal suffix and day-first all read as Nov 29, 1–6 PM", () => {
  assert.deepEqual(occ(flyer("NOVEMBER 29TH\n1PM - 6PM")), NOV29_2026, "month + ordinal, same line");
  assert.deepEqual(occ(flyer("NOVEMBER\n29TH\n1PM - 6PM")), NOV29_2026, "month and ordinal on adjacent lines");
  assert.deepEqual(occ(flyer("NOVEMBER\n29\nTH\n1PM - 6PM")), NOV29_2026, "month / number / suffix split");
  assert.deepEqual(occ(flyer("29TH NOVEMBER\n1PM - 6PM")), NOV29_2026, "day-first");
  assert.deepEqual(occ(flyer("29TH\nNOVEMBER\n1PM - 6PM")), NOV29_2026, "day-first, stacked");
  assert.deepEqual(occ(flyer("SUNDAY, NOVEMBER 29TH\n1PM - 6PM")), NOV29_2026, "existing weekday form");
  assert.deepEqual(occ(flyer("11/29 1PM - 6PM")), NOV29_2026, "existing numeric form");
});

test("year: explicit year wins; missing year = next occurrence not yet passed (owner flyer / paste only)", () => {
  assert.deepEqual(occ(flyer("NOVEMBER 29TH 2025\n1PM - 6PM")), [["2025-11-29T18:00:00.000Z", "2025-11-29T23:00:00.000Z", true]], "explicit past year kept, never reinterpreted");
  assert.deepEqual(occ(flyer("NOVEMBER 29TH\n1PM - 6PM"), OCT26), NOV29_2026, "still upcoming this year → this year");
  assert.deepEqual(occ(flyer("NOVEMBER 29TH\n1PM - 6PM"), DEC15), [["2027-11-29T18:00:00.000Z", "2027-11-29T23:00:00.000Z", true]], "already passed → next year");
  assert.deepEqual(occ(flyer("MAY 3RD\n1PM - 6PM"), OCT26)[0][0].slice(0, 4), "2027", "more than six months ahead is still the next occurrence");
  const todayCtx = { now: Date.parse("2026-11-29T15:00:00Z"), yearHint: null, upcomingYear: true };
  assert.equal(S.resolveYear(11, 29, todayCtx), 2026, "today has not passed");
  // Link imports keep the closest-to-today rule and month-first-only tokens.
  const linkCtx = { now: DEC15, yearHint: null };
  assert.equal(S.resolveYear(11, 29, linkCtx), 2026);
  assert.deepEqual(S.parseScheduleLines(["29th November, 1pm - 6pm"], linkCtx).occurrences, [], "day-first is not added to link imports");
  assert.equal(S.parseScheduleLines(["29th November, 1pm - 6pm"], { ...linkCtx, upcomingYear: true }).occurrences.length, 1);
});

test("date parsing stays narrow: times, multi-date flyers and non-dates", () => {
  assert.deepEqual(S.parseTimes("1PM - 6PM") && [S.parseTimes("1PM - 6PM").startTime, S.parseTimes("1PM - 6PM").endTime], ["13:00", "18:00"]);
  const multi = occ("Holiday Pop-Up Series\nNOV 29 1PM - 6PM\nDEC 6 1PM - 6PM\n4254 Arthur Kill Road\nStaten Island, NY");
  assert.equal(multi.length, 2, "multi-date Events still read every date");
  assert.deepEqual(S.joinSplitDateLines(["Top 2", "Mayors", "MARCH", "ON"]), ["Top 2", "Mayors", "MARCH", "ON"], "only month / day / suffix / year fragments join");
  assert.deepEqual(S.joinSplitDateLines(["NOVEMBER", "", "29TH", "2026"]), ["NOVEMBER 29TH 2026"]);
  assert.deepEqual(occ("Pop-Up\n5 marvelous makers\n4254 Arthur Kill Road\nStaten Island, NY"), [], "'5 marvelous' is not a date");
});

test("AI grounding accepts the flyer layouts, still refuses dates the text doesn't state, and never keeps the model's guessed year", () => {
  const ctx = { now: OCT26, yearHint: null, upcomingYear: true };
  const out = (evidence, date, page = flyer(evidence)) =>
    AI.sanitizeEventAiOutput(
      { title: null, schedule: [{ date, start_time: null, end_time: null, venue_name: null, street_address: null, evidence }], venue_name: null, street_address: null, city: null, state: null, postal_code: null, organizer: null, organizer_evidence: null, organizer_entity_type: null, other_businesses: [] },
      page,
      ctx
    ).occurrences.map((o) => o.start);
  assert.deepEqual(out("NOVEMBER\n29\nTH", "2026-11-29"), ["2026-11-29"]);
  assert.deepEqual(out("29TH\nNOVEMBER", "2026-11-29"), ["2026-11-29"]);
  assert.deepEqual(out("NOVEMBER 29TH", "2026-11-30"), [], "a date the text doesn't state is dropped");
  assert.deepEqual(out("1PM - 6PM", "2026-11-29"), [], "a time line alone never proves a date");
  // Model guessed an old year for a yearless flyer → Findmi's rule decides.
  const guessed = AI.sanitizeEventAiOutput(
    { title: null, schedule: [{ date: "2024-11-29", start_time: null, end_time: null, venue_name: null, street_address: null, evidence: "NOVEMBER 29" }], venue_name: null, street_address: null, city: null, state: null, postal_code: null, organizer: null, organizer_evidence: null, organizer_entity_type: null, other_businesses: [] },
    "X\nNOVEMBER 29\nY",
    { now: OCT26, yearHint: null, upcomingYear: true }
  );
  assert.ok(guessed.occurrences.every((o) => o.start.startsWith("2026-11-29")));
});

// ------------------------------------------------------------ organizer

test("organizer: 'PRESENTED BY:' with the name on the next line; same-line forms unchanged; no name invented", () => {
  const org = (text) => TS.extractTextEventCandidate(text, { now: OCT26, origin: "image" }).candidate.organizer;
  assert.equal(org(flyer("NOVEMBER 29TH\n1PM - 6PM")), "Faire and Flourish");
  assert.equal(org("Market Day\nNOV 29\nHosted by Main Street Makers\n1 Main St\nStaten Island, NY"), "Main Street Makers");
  assert.equal(org("Market Day\nNOV 29\nORGANIZED BY:\n4254 ARTHUR KILL ROAD\nStaten Island, NY"), null, "an address is never an organizer");
  assert.equal(org("Market Day\nNOV 29\nPRESENTED BY:"), null);
});

test("organizer conflict: surfaced only when the source names someone else; the relationship is never switched for the owner", () => {
  const candidate = TS.extractTextEventCandidate(flyer("NOVEMBER 29TH\n1PM - 6PM"), { now: OCT26, origin: "image" }).candidate;
  const none = { organizerBusiness: null };
  assert.deepEqual(R.organizerConflict(candidate, none, "fox", "Fox Den LeatherCraft"), { organizer: "Faire and Flourish", place: "KILLMEYER'S", onFindmi: false });
  assert.equal(R.organizerConflict({ ...candidate, organizer: "Fox Den LeatherCraft" }, none, "fox", "Fox Den LeatherCraft"), null, "organizer is the importing Business");
  assert.equal(R.organizerConflict(candidate, { organizerBusiness: { id: "fox", name: "Faire and Flourish" } }, "fox", "Fox Den LeatherCraft"), null, "matched organizer IS this Business");
  assert.equal(R.organizerConflict({ ...candidate, organizer: null }, none, "fox", "Fox Den LeatherCraft"), null);
  assert.equal(R.organizerConflict(candidate, { organizerBusiness: { id: "ff", name: "Faire & Flourish Co" } }, "fox", "Fox Den").onFindmi, true);
  // reviewDefaults keeps the intent it was given.
  const matches = { event: null, locations: [], organizerBusiness: null, existingAppearance: null };
  assert.equal(R.reviewDefaults(candidate, matches, "hosting", "Fox Den LeatherCraft").intent, "hosting");
  assert.equal(R.reviewDefaults(candidate, matches, "participating", "Fox Den LeatherCraft").organizer, "Faire and Flourish");
  const ui = read("src/app/(public)/account/business/[id]/import-event/EventImporter.tsx");
  assert.match(ui, /This looks like an event presented by/);
  assert.match(ui, /How is \{businessName\} involved\?/);
  assert.match(ui, /intent === "hosting" && !hostingConfirmed && organizerConflict\(/, "save is held until the owner answers");
  assert.ok(!/setIntent\("participating"\)/.test(ui.replace(/function switchIntent[\s\S]*?\n  \}\n/, "")), "only an owner click switches the relationship");
});

test("existing Event reuse: a strong match while participating joins it — applyBusinessToEvent only, no new Event", async () => {
  const candidate = TS.extractTextEventCandidate(flyer("NOVEMBER 29TH\n1PM - 6PM"), { now: OCT26, origin: "image" }).candidate;
  const EV = "da506528-59ef-43d4-9a80-6d70525633eb";
  const matches = { event: { id: EV, name: "KILLMEYER'S 3RD ANNUAL German Christmas MARKET", slug: "k", startAt: "2026-11-29T18:00:00Z", venueName: "KILLMEYER'S", city: "STATEN ISLAND", confidence: "strong", hostBusinessId: null, hostedByThisBusiness: false }, locations: [], organizerBusiness: null, existingAppearance: null };
  const review = R.reviewDefaults(candidate, matches, "participating", "Fox Den LeatherCraft");
  assert.equal(review.useEventId, EV, "the existing Event is preselected");
  const n = P.normalizeReview(review);
  assert.equal(n.ok, true);
  const writes = [];
  const admin = { from: (t) => ({ insert: () => (writes.push(t), { select: async () => ({ data: [] }) }) }), rpc: async () => (writes.push("rpc"), { data: null }) };
  const applied = [];
  const out = await P.persistEventImport(n.value, {
    admin, userId: "u", businessId: "fox", businessName: "Fox Den LeatherCraft",
    applyToEvent: async (id) => (applied.push(id), "applied"),
    canHost: async () => true, storeImage: async () => null, geography: async () => null, uniqueEventSlug: async () => "x", notifyNewEvent: async () => {}, propagateDates: async () => {},
  });
  assert.deepEqual(applied, [EV]);
  assert.deepEqual(writes, [], "no Event, Date or Appearance created directly");
  assert.ok(out.ok);
});

// ------------------------------------------------------------ flyer as Event image

function fakeStorageAdmin() {
  const uploads = [];
  return {
    uploads,
    storage: {
      from: () => ({
        upload: async (path) => (uploads.push(path), { error: null }),
        remove: async () => ({ error: null }),
        download: async () => ({ data: null, error: { message: "n/a" } }),
        getPublicUrl: (path) => ({ data: { publicUrl: `https://store.supabase.co/findmi-media/${path}` } }),
      }),
    },
  };
}

test("flyer image: analysis never stores it; stored only when chosen, through the Event image rules + storage pipeline", async () => {
  // Analysis path: no Storage write anywhere on the image read.
  assert.ok(!/storage|storePublicImage|storeEventImage/.test(read("src/lib/event-import/image-source.ts").replace(/\/\/.*$/gm, "")));
  const actions = read("src/app/(public)/account/business/[id]/import-event/actions.ts");
  assert.match(actions, /export async function analyzeEventImportImage[\s\S]*?\n\}/);
  assert.ok(!/storeUploadedEventImage/.test(actions.match(/export async function analyzeEventImportImage[\s\S]*?\n\}/)[0]));
  assert.match(actions, /if \(flyer && !normalized\.value\.useEventId\) \{\s*const stored = await storeUploadedEventImage/, "stored only when chosen, never when joining");
  const ui = read("src/app/(public)/account/business/[id]/import-event/EventImporter.tsx");
  assert.match(ui, /const \[useFlyer, setUseFlyer\] = useState\(false\)/, "default: not used");
  assert.match(ui, /Use This Image For The Event/);
  assert.match(ui, /Don’t Use This Image/);
  assert.match(ui, /preprocessImageForUpload\(imageFile!\)/, "reduced with the existing helper (HEIC passes through)");

  const admin = fakeStorageAdmin();
  const png = await sharp({ create: { width: 600, height: 800, channels: 3, background: "#14B0BC" } }).png().toBuffer();
  const ok = await M.storeUploadedEventImage(admin, new File([png], "flyer.png", { type: "image/png" }), 5 * 1024 * 1024);
  assert.equal(ok.ok, true);
  assert.match(ok.url, /^https:\/\/store\.supabase\.co\/findmi-media\//);
  assert.ok(admin.uploads.length >= 1);
  const sliver = await sharp({ create: { width: 2000, height: 100, channels: 3, background: "#000" } }).png().toBuffer();
  const before = admin.uploads.length;
  assert.deepEqual(await M.storeUploadedEventImage(admin, new File([sliver], "s.png", { type: "image/png" }), 5 * 1024 * 1024), { ok: false, reason: "unsuitable" });
  assert.deepEqual(await M.storeUploadedEventImage(admin, new File([Buffer.from("not an image")], "x.png", { type: "image/png" }), 5 * 1024 * 1024), { ok: false, reason: "invalid_file" });
  assert.deepEqual(await M.storeUploadedEventImage(admin, new File([png], "big.png", { type: "image/png" }), 10), { ok: false, reason: "too_large" });
  assert.equal(admin.uploads.length, before, "nothing stored for a rejected file");
});

test("flyer image: the stored URL reaches the existing cover path; without a choice no cover is set", async () => {
  const base = {
    intent: "participating",
    title: "KILLMEYER'S 3RD ANNUAL German Christmas MARKET",
    description: null,
    imageUrl: null,
    sourceUrl: null,
    occurrences: [{ date: "2026-11-29", startTime: "13:00", endTime: "18:00", place: { venueName: "KILLMEYER'S", address: "4254 ARTHUR KILL ROAD", city: "Staten Island", state: "NY", postalCode: null, useLocationId: null } }],
    sharedPlace: true,
    place: { venueName: "KILLMEYER'S", address: "4254 ARTHUR KILL ROAD", city: "Staten Island", state: "NY", postalCode: null, useLocationId: null },
    organizer: "Faire and Flourish",
    useEventId: null,
    asEvent: true,
  };
  const run = async (imageUrl) => {
    const n = P.normalizeReview({ ...base, imageUrl });
    assert.equal(n.ok, true, JSON.stringify(n));
    const stored = [];
    const inserted = [];
    const chain = (t) => {
      const api = {
        select: () => api, eq: () => api, neq: () => api, is: () => api, in: () => api, limit: () => api, order: () => api,
        maybeSingle: async () => ({ data: null }),
        then: (r) => r({ data: [] }),
        insert: (rows) => (inserted.push([t, rows]), { select: () => ({ single: async () => ({ data: { id: "new-event" }, error: null }), then: (r) => r({ data: [{ id: "occ-1" }], error: null }) }), then: (r) => r({ error: null }) }),
        upsert: () => ({ then: (r) => r({ error: null }) }),
        update: () => ({ eq: () => ({ then: (r) => r({ error: null }) }) }),
      };
      return api;
    };
    await P.persistEventImport(n.value, {
      admin: { from: chain, rpc: async () => ({ data: null, error: null }) }, userId: "u", businessId: "fox", businessName: "Fox Den LeatherCraft",
      applyToEvent: async () => "applied", canHost: async () => true,
      storeImage: async (u) => (stored.push(u), u), geography: async () => null, uniqueEventSlug: async () => "killmeyers", notifyNewEvent: async () => {}, propagateDates: async () => {},
      findEventBySourceUrl: async () => null,
    }).catch(() => null);
    return { stored, events: inserted.filter(([t]) => t === "events").map(([, r]) => r) };
  };
  const chosen = await run("https://store.supabase.co/findmi-media/flyer.jpg");
  assert.deepEqual(chosen.stored, ["https://store.supabase.co/findmi-media/flyer.jpg"]);
  assert.equal(chosen.events[0]?.cover_image_url, "https://store.supabase.co/findmi-media/flyer.jpg");
  const skipped = await run(null);
  assert.deepEqual(skipped.stored, []);
  assert.equal(skipped.events[0]?.cover_image_url ?? null, null);
});

// ------------------------------------------------------------ galleries

const file = (name, size, type = "image/jpeg") => new File([new Uint8Array(size)], name, { type });
const same = async (f) => f;

test("gallery upload: success, rejection, success-then-rejection-then-success; successes kept, nothing thrown", async () => {
  const urls = [];
  const results = [{ url: "u1" }, Promise.reject(new Error("413 FUNCTION_PAYLOAD_TOO_LARGE")), { url: "u3" }, { error: "Image must be under 5MB." }];
  let i = 0;
  const failures = await G.uploadGalleryFiles([file("a.jpg", 10), file("b.jpg", 10), file("c.jpg", 10), file("d.jpg", 10)], {
    upload: async () => results[i++],
    onUploaded: (u) => urls.push(u),
    prepare: same,
  });
  assert.deepEqual(urls, ["u1", "u3"], "earlier and later successes both kept, in order");
  assert.deepEqual(failures.map((f) => f.name), ["b.jpg", "d.jpg"]);
  assert.match(failures[0].reason, /upload failed/);
  assert.equal(failures[1].reason, "Image must be under 5MB.");
  assert.match(G.galleryUploadErrorMessage(failures), /2 photos didn’t upload — b\.jpg: .*; d\.jpg: Image must be under 5MB\./);
  assert.equal(G.galleryUploadErrorMessage([]), null);
  const allFail = await G.uploadGalleryFiles([file("x.jpg", 10)], { upload: () => Promise.reject(new Error("offline")), onUploaded: () => assert.fail(), prepare: same });
  assert.equal(allFail.length, 1, "a lone rejected upload is a reported failure, not a thrown one");
});

test("gallery upload: photos reduced first; HEIC sent as-is unless known too large; oversize never sent", async () => {
  const sent = [];
  const prepared = [];
  const failures = await G.uploadGalleryFiles(
    [file("big.jpg", 9_000_000), file("photo.heic", 2_000_000, "image/heic"), file("huge.heic", 6_000_000, "image/heic"), file("stubborn.png", 6_000_000, "image/png")],
    {
      upload: async (fd) => (sent.push(fd.get("file").name), { url: `u-${fd.get("file").name}` }),
      onUploaded: () => {},
      prepare: async (f) => (prepared.push(f.name), f.name === "big.jpg" ? file("big.jpg", 800_000) : f),
    }
  );
  assert.deepEqual(prepared, ["big.jpg", "stubborn.png"], "HEIC never preprocessed (server conversion path unchanged)");
  assert.deepEqual(sent, ["big.jpg", "photo.heic"]);
  assert.deepEqual(failures.map((f) => f.name), ["huge.heic", "stubborn.png"]);
  assert.match(failures[0].reason, /too large/);
});

test("gallery fields: Business / Event / Location all use the crash-safe loop; save / order / removal untouched", () => {
  for (const [f, action] of [
    ["src/app/(public)/account/business/[id]/MemberGalleryField.tsx", "uploadMemberBusinessImage"],
    ["src/app/(public)/account/event/[id]/MemberEventGalleryField.tsx", "uploadMemberEventImage"],
    ["src/app/(public)/account/location/[id]/MemberLocationGalleryField.tsx", "uploadMemberLocationImage"],
  ]) {
    const src = read(f);
    assert.match(src, /uploadGalleryFiles\(files, \{/, f);
    assert.match(src, new RegExp(`upload: \\(fd\\) => ${action}\\(`), f);
    assert.ok(!/for \(const file of files\)/.test(src), `${f}: no unguarded per-file loop left`);
    assert.match(src, /setError\(galleryUploadErrorMessage\(failures\)\)/);
    assert.match(src, /<input type="hidden" name=\{name\} value=\{url\} \/>/, "DOM order is still the saved order");
    assert.match(src, /function removeAt\(i: number\)/);
  }
  assert.ok(!/gallery-upload/.test(read("src/components/journal/useJournalPhotoUpload.ts")), "Journal / Moment upload flow untouched");
});
