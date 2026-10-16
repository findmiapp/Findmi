// Admin Locations — bulk publication + lifecycle controls. Bulk Publish /
// Unpublish use the SAME canonical change as the single editor's Published
// control (locations.is_demo + the manager notification on a real
// transition); Archive / Trash keep their existing archived_at / trashed_at
// actions. Fakes only — no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/cache") return { url: "data:text/javascript,export const revalidatePath=(p)=>{(globalThis.__REVALIDATED ??= []).push(p)};", shortCircuit: true };
    if (specifier === "next/navigation") return { url: "data:text/javascript,export const redirect=(u)=>{throw Object.assign(new Error('REDIRECT'),{url:u})};", shortCircuit: true };
    if (specifier === "@/lib/admin/requireAdminSupabase")
      return { url: "data:text/javascript,export async function requireAdminSupabase(){const c=globalThis.__ADMIN;if(!c)throw new Error('Unauthorized');return c;}", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const PUB = await import("../src/lib/admin/location-publication.ts");
const LC = await import("../src/lib/admin/location-lifecycle.ts");
const LINKS = await import("../src/lib/location-links.ts");
const ACT = await import("../src/app/admin/(protected)/locations/lifecycle-actions.ts");
const read = (p) => readFileSync(p, "utf8");

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n, o = {}) => ({ id: id(n), name: `Place ${n}`, slug: `place-${n}`, is_demo: true, archived_at: null, trashed_at: null, ...o });

/** A small in-memory `locations` table + the relationship tables a
 * publication change must never touch. */
function fakeDb(rows, { failIds = [], selectError = false, updateError = false } = {}) {
  const tables = {
    locations: rows.map((r) => ({ ...r })),
    event_occurrences: [{ id: "occ-1", location_id: id(1) }],
    business_locations: [{ id: "bl-1", business_id: "b-1", location_id: id(1) }],
    appearances: [{ id: "ap-1", location_id: id(2) }],
    business_location_availability: [{ id: "fua-1", location_id: id(1) }],
  };
  const writes = [];
  const client = {
    tables,
    writes,
    from(table) {
      const filters = [];
      let patch = null;
      const apply = () => tables[table].filter((r) => filters.every((f) => f(r)));
      const chain = {
        select: () => chain,
        in: (col, vals) => (filters.push((r) => vals.includes(r[col])), chain),
        is: (col, v) => (filters.push((r) => (r[col] ?? null) === v), chain),
        eq: (col, v) => (filters.push((r) => r[col] === v), chain),
        update: (p) => ((patch = p), writes.push({ table, patch: p }), chain),
        then: (resolve) => {
          if (patch) {
            if (updateError) return resolve({ data: null, error: { message: "boom" } });
            const hit = apply().filter((r) => !failIds.includes(r.id));
            for (const r of hit) Object.assign(r, patch);
            return resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
          }
          if (selectError) return resolve({ data: null, error: { message: "boom" } });
          return resolve({ data: apply().map((r) => ({ ...r })), error: null });
        },
      };
      return chain;
    },
  };
  return client;
}
const byId = (db, n) => db.tables.locations.find((r) => r.id === id(n));
const noNotify = async () => {};

test("1 & 8. Draft → bulk Publish → Published (is_demo=false); it leaves Needs Review (is_demo=true view)", async () => {
  const db = fakeDb([row(1), row(2)]);
  const notified = [];
  const r = await PUB.setLocationPublication(db, [id(1), id(2)], true, async (_c, lid, name, outcome) => void notified.push([lid, name, outcome]));
  assert.deepEqual(r.changed, [id(1), id(2)]);
  assert.equal(byId(db, 1).is_demo, false);
  assert.equal(LC.locationLifecycleState(byId(db, 1)), "published");
  assert.deepEqual(notified, [[id(1), "Place 1", "approved"], [id(2), "Place 2", "approved"]], "same manager notification as the single editor");
  assert.deepEqual(db.writes.map((w) => w.patch), [{ is_demo: false }], "ONE canonical field, one update, nothing else");
  assert.equal(PUB.describeLocationPublication(r), "2 Locations Published");
});

test("2. Published → bulk Unpublish → Draft (is_demo=true), record kept", async () => {
  const db = fakeDb([row(1, { is_demo: false })]);
  const notified = [];
  const r = await PUB.setLocationPublication(db, [id(1)], false, async (_c, _id, _n, outcome) => void notified.push(outcome));
  assert.deepEqual(r.changed, [id(1)]);
  assert.equal(byId(db, 1).is_demo, true);
  assert.equal(LC.locationLifecycleState(byId(db, 1)), "draft");
  assert.equal(byId(db, 1).archived_at, null, "not archived");
  assert.equal(byId(db, 1).trashed_at, null, "not trashed");
  assert.deepEqual(notified, ["rejected"]);
});

test("3 & 4. mixed Draft/Published selections are idempotent both ways", async () => {
  const mixed = () => fakeDb([row(1), row(2), row(3), row(4, { is_demo: false }), row(5, { is_demo: false })]);
  const ids = [1, 2, 3, 4, 5].map(id);
  const db = mixed();
  const pub = await PUB.setLocationPublication(db, ids, true, noNotify);
  assert.deepEqual(pub.changed, [id(1), id(2), id(3)]);
  assert.deepEqual(pub.already, [id(4), id(5)]);
  assert.equal(PUB.describeLocationPublication(pub), "3 Locations Published · 2 Already Published");
  const db2 = mixed();
  const unpub = await PUB.setLocationPublication(db2, ids, false, noNotify);
  assert.deepEqual(unpub.changed, [id(4), id(5)]);
  assert.deepEqual(unpub.already, [id(1), id(2), id(3)]);
  assert.equal(PUB.describeLocationPublication(unpub), "2 Locations Unpublished (Draft) · 3 Already Draft");
  // Nothing to do → no write at all.
  const db3 = fakeDb([row(9, { is_demo: false })]);
  await PUB.setLocationPublication(db3, [id(9)], true, noNotify);
  assert.equal(db3.writes.length, 0);
});

test("Archived / Trashed rows are never published or unpublished (publication is for active Locations)", async () => {
  const db = fakeDb([row(1, { archived_at: "2026-10-01" }), row(2, { trashed_at: "2026-10-01" }), row(3)]);
  const r = await PUB.setLocationPublication(db, [id(1), id(2), id(3), id(99)], true, noNotify);
  assert.deepEqual(r.inactive, [id(1), id(2)]);
  assert.deepEqual(r.missing, [id(99)]);
  assert.deepEqual(r.changed, [id(3)]);
  assert.equal(byId(db, 1).is_demo, true);
  assert.equal(byId(db, 2).is_demo, true);
});

test("16 & 17. partial failure is reported, never claimed as success; failed ids are identified for a retry", async () => {
  const db = fakeDb([row(1), row(2), row(3)], { failIds: [id(2)] });
  const r = await PUB.setLocationPublication(db, [id(1), id(2), id(3)], true, noNotify);
  assert.deepEqual(r.changed, [id(1), id(3)]);
  assert.deepEqual(r.failed, [id(2)]);
  assert.equal(PUB.describeLocationPublication(r), "2 Locations Published · 1 Failed — still selected, try again");
  const allFail = await PUB.setLocationPublication(fakeDb([row(1)], { updateError: true }), [id(1)], true, noNotify);
  assert.deepEqual([allFail.changed, allFail.failed], [[], [id(1)]]);
  const readFail = await PUB.setLocationPublication(fakeDb([row(1)], { selectError: true }), [id(1)], true, noNotify);
  assert.deepEqual(readFail.failed, [id(1)]);
  // A notification failure never turns a committed change into a failure.
  const db2 = fakeDb([row(1)]);
  const r2 = await PUB.setLocationPublication(db2, [id(1)], true, async () => {
    throw new Error("resend down");
  });
  assert.deepEqual(r2.changed, [id(1)]);
  // The bar keeps ONLY failed rows selected, and never shows success before the server confirms.
  const bar = read("src/app/admin/(protected)/locations/LocationBulkActionBar.tsx");
  assert.match(bar, /const r = await bulkSetLocationsPublished\(ids, publish\)\.catch\(\(\) => null\);/);
  assert.match(bar, /keepSelected\?\.\(r\.result\.failed\);/);
  assert.match(bar, /\/\/ No optimistic success/);
});

test("14 & 15. relationships survive Unpublish (and Publish): only locations.is_demo is written", async () => {
  const db = fakeDb([row(1, { is_demo: false }), row(2, { is_demo: false })]);
  const before = JSON.stringify({ o: db.tables.event_occurrences, b: db.tables.business_locations, a: db.tables.appearances, f: db.tables.business_location_availability });
  await PUB.setLocationPublication(db, [id(1), id(2)], false, noNotify);
  await PUB.setLocationPublication(db, [id(1)], true, noNotify);
  assert.equal(JSON.stringify({ o: db.tables.event_occurrences, b: db.tables.business_locations, a: db.tables.appearances, f: db.tables.business_location_availability }), before);
  assert.ok(db.writes.every((w) => w.table === "locations" && Object.keys(w.patch).join() === "is_demo"));
  assert.doesNotMatch(read("src/lib/admin/location-publication.ts"), /\.delete\(|location_members"\)\.insert|business_locations"\)|event_occurrences"\)|appearances"\)/);
});

test("12 & 13. public href / page semantics follow the same is_demo rule after Publish and Unpublish", async () => {
  const db = fakeDb([row(1)]);
  assert.equal(LINKS.publicLocationHref(byId(db, 1)), null, "Draft → never linked (no dead link)");
  await PUB.setLocationPublication(db, [id(1)], true, noNotify);
  assert.equal(LINKS.publicLocationHref(byId(db, 1)), "/location/place-1", "Published → linkable");
  await PUB.setLocationPublication(db, [id(1)], false, noNotify);
  assert.equal(LINKS.publicLocationHref(byId(db, 1)), null);
  // The public page itself resolves only is_demo = false (unchanged).
  assert.match(read("src/lib/data.ts"), /export async function getLocationBySlug[\s\S]{0,300}\.eq\("is_demo", false\)/);
});

test("single editor and bulk share ONE implementation of the Published change", () => {
  const editor = read("src/app/admin/(protected)/locations/actions.ts");
  assert.match(editor, /import \{ notifyLocationManagers \} from "@\/lib\/admin\/location-publication";/);
  assert.match(editor, /is_demo: !bool\(formData, "published"\),/);
  assert.doesNotMatch(editor, /async function notifyLocationManagers/, "moved, not duplicated");
  const pub = read("src/lib/admin/location-publication.ts");
  assert.match(pub, /^import "server-only";/);
  assert.match(pub, /\.update\(\{ is_demo: !publish \}\)/);
});

test("18. Admin authorization is required; ids are validated server-side", async () => {
  globalThis.__ADMIN = undefined;
  const denied = await ACT.bulkSetLocationsPublished([id(1)], true);
  assert.deepEqual(denied, { ok: false, error: "Your Admin session has ended. Sign in again." });
  globalThis.__ADMIN = fakeDb([row(1)]);
  assert.equal((await ACT.bulkSetLocationsPublished(["not-a-uuid", 42], true)).ok, false, "malformed ids are rejected");
  globalThis.__REVALIDATED = [];
  const ok = await ACT.bulkSetLocationsPublished([id(1), id(1)], true);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.result.changed, [id(1)], "duplicates collapsed");
  assert.ok(globalThis.__REVALIDATED.includes("/location/place-1") && globalThis.__REVALIDATED.includes("/admin/locations") && globalThis.__REVALIDATED.includes("/admin"));
  globalThis.__ADMIN = undefined;
  assert.equal(PUB.cleanLocationIds(Array.from({ length: 600 }, (_, i) => id(i))).length, PUB.LOCATION_BULK_MAX);
});

test("5 & 6. bulk Archive / Trash keep their existing actions and semantics; no hard delete", () => {
  const actions = read("src/app/admin/(protected)/locations/lifecycle-actions.ts");
  assert.match(actions, /export async function bulkArchiveLocations[\s\S]*?\.update\(\{ archived_at: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(actions, /export async function bulkTrashLocations[\s\S]*?\.update\(\{ trashed_at: new Date\(\)\.toISOString\(\) \}\)/);
  const bar = read("src/app/admin/(protected)/locations/LocationBulkActionBar.tsx");
  assert.match(bar, /<FormAction action=\{bulkArchiveLocations\}/);
  assert.match(bar, /action=\{bulkTrashLocations\}[\s\S]{0,200}confirmMessage=\{`Move \$\{count\} location\(s\) to Trash\? They'll be hidden everywhere until restored\.`\}/);
  // Archived / Trash views keep the shared bar (Restore, Permanent Delete with typed confirm).
  assert.match(bar, /if \(view === "archived" \|\| view === "trashed"\) \{\n\s+return \(\n\s+<LifecycleBulkActionBar/);
});

test("7. Quick Edit keeps the existing bulk Category edit (metadata only — no lifecycle inside)", () => {
  const bar = read("src/app/admin/(protected)/locations/LocationBulkActionBar.tsx");
  const quick = bar.slice(bar.indexOf("function QuickEditForm"), bar.indexOf("/** One existing lifecycle form action"));
  assert.match(quick, /<form action=\{bulkQuickEditLocations\}/);
  assert.match(quick, /name="apply_category"/);
  assert.match(quick, /name="category_id"/);
  assert.doesNotMatch(quick, /Publish|is_demo|Archive|Trash/);
  assert.match(read("src/app/admin/(protected)/locations/lifecycle-actions.ts"), /export async function bulkQuickEditLocations[\s\S]*?\.update\(\{ category_id: categoryId \|\| null \}\)/);
});

test("9, 10 & 11. filters: All Active / Needs Review (Draft) / Published / Archived / Trash over the canonical columns", () => {
  const q = read("src/lib/admin/queries.ts");
  assert.match(q, /if \(needsReview\) query = query\.eq\("is_demo", true\);\n\s+else if \(publishedOnly\) query = query\.eq\("is_demo", false\);/);
  assert.match(q, /if \(lifecycle === "archived"\) query = query\.not\("archived_at", "is", null\)\.is\("trashed_at", null\);\n\s+else if \(lifecycle === "trashed"\) query = query\.not\("trashed_at", "is", null\);\n\s+else query = query\.is\("archived_at", null\)\.is\("trashed_at", null\);/);
  const page = read("src/app/admin/(protected)/locations/page.tsx");
  assert.match(page, /const publishedOnly = !needsReview && published === "1" && lifecycleTab === "active";/);
  assert.match(page, /getAdminLocations\(q, lifecycleTab, needsReview, publishedOnly\)/);
  for (const label of ["All Active", "Archived", "Trash", "Needs Review", "Published"]) assert.ok(page.includes(label), label);
  // A refresh after Publish re-reads the server list, so Needs Review drops published rows.
  assert.match(read("src/app/admin/(protected)/locations/LocationBulkActionBar.tsx"), /router\.refresh\(\);/);
});

test("row status badges: PUBLISHED / DRAFT / ARCHIVED / TRASHED from the canonical columns", () => {
  assert.equal(LC.locationLifecycleState({ is_demo: false }), "published");
  assert.equal(LC.locationLifecycleState({ is_demo: true }), "draft");
  assert.equal(LC.locationLifecycleState({ is_demo: false, archived_at: "x" }), "archived");
  assert.equal(LC.locationLifecycleState({ is_demo: true, archived_at: "x", trashed_at: "y" }), "trashed");
  assert.deepEqual(Object.values(LC.LOCATION_LIFECYCLE_LABEL), ["Published", "Draft", "Archived", "Trashed"]);
  const list = read("src/app/admin/(protected)/locations/LocationBulkListClient.tsx");
  assert.match(list, /\{LOCATION_LIFECYCLE_LABEL\[locationLifecycleState\(l\)\]\}/);
  assert.doesNotMatch(list, /Not Listed|"Public"/);
});

test("19. Select All Visible stays scoped to the rows this list was given; refreshes prune hidden ids", () => {
  const list = read("src/components/admin/AdminBulkList.tsx");
  assert.match(list, /setSelected\(allSelected \? new Set\(\) : new Set\(items\.map\(\(i\) => i\.id\)\)\)/);
  assert.match(list, /function keepSelected\(ids: string\[\]\) \{\n\s+const visible = new Set\(items\.map\(\(i\) => i\.id\)\);\n\s+setSelected\(new Set\(ids\.filter\(\(id\) => visible\.has\(id\)\)\)\);/);
  assert.match(list, /const next = new Set\(\[\.\.\.prev\]\.filter\(\(id\) => visible\.has\(id\)\)\);/);
  assert.match(list, /Select all visible \(\{items\.length\}\)/);
  assert.match(list, /\{selected\.size\} selected/);
});

test("20. phone toolbar: 2-column grid of ≥40px touch targets, no hover-only or desktop-only interaction", () => {
  const bar = read("src/app/admin/(protected)/locations/LocationBulkActionBar.tsx");
  assert.match(bar, /const pill = "flex min-h-10 items-center justify-center rounded-full/);
  assert.match(bar, /className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center"/);
  const order = ["Publish${", "Unpublish{", "label={`Archive", "label={`Move To Trash", "<QuickEditForm"].map((s) => bar.indexOf(s));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), "Publish · Unpublish · Archive · Trash · Quick Edit");
  assert.doesNotMatch(bar, /onMouseEnter|onHover|title=/);
  assert.match(read("src/app/admin/(protected)/locations/LocationBulkListClient.tsx"), /className="h-5 w-5 shrink-0" aria-label=\{`Select \$\{l\.name\}`\}/);
});

test("one concise confirmation for many Locations", async () => {
  // Imported from the client module's plain helper.
  const src = read("src/app/admin/(protected)/locations/LocationBulkActionBar.tsx");
  assert.match(src, /`Publish \$\{noun\}\?\\n\\n\$\{count === 1 \? "This Location" : "These Locations"\} will become publicly visible on Findmi\.`/);
  assert.match(src, /if \(ids\.length === 0 \|\| !confirm\(publishConfirmMessage\(ids\.length, publish\)\)\) return;/);
});
