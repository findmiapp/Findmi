// Location Import V1 — ONE Location onboarding/resolution pipeline used by
// Admin → Locations → Import Locations and by Admin Event Import's
// missing-Location step. Match before create; supplied values win over a
// website; new Locations are unlisted (Needs Review) with no ownership,
// membership or Business link; a deterministic public fallback when no
// verified media exists. Fakes only — no network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";

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

const PARSE = await import("../src/lib/location-import/parse.ts");
const RES = await import("../src/lib/location-import/resolve.ts");
const WEB = await import("../src/lib/location-import/website.ts");
const SRV = await import("../src/lib/location-import/server.ts");
const FB = await import("../src/lib/location-fallback.ts");
const R = await import("../src/lib/event-import/review.ts");
const ACT = await import("../src/app/admin/(protected)/locations/import/actions.ts");
const read = (p) => readFileSync(p, "utf8");

const CATEGORIES = [
  { id: "cat-venue", name: "Event Venue", slug: "event-venue" },
  { id: "cat-cafe", name: "Café / Coffee Shop", slug: "cafe-coffee-shop" },
  { id: "cat-retail", name: "Retail Store", slug: "retail-store" },
  { id: "cat-gallery", name: "Gallery", slug: "gallery" },
];
const loc = (o) => ({ id: "x", slug: "x", name: "X", address: null, city: "New York", state: "NY", postal_code: null, category: null, is_public: true, ...o });
const ev = (o) => {
  const base = { name: null, address: null, city: "New York", state: "NY", postalCode: null, ...o };
  return { key: PARSE.locationEvidenceKey(base), labels: ["Location 1"], website: null, phone: null, category: null, description: null, warnings: [], ...base };
};

// ── PARSER ───────────────────────────────────────────────────────────────

const PASTE = `LOCATION 1

Location Name: LAVAN Chelsea
Website: https://example.com
Street Address: 541 W 25th St
City: New York
State: NY
ZIP: 10001

=== END LOCATION 1 ===

LOCATION 2

Location Name: Shopify New York
Website: www.shopify.com
Street Address: 131 Greene St
City: New York
State: NY
ZIP: 10012
Phone: (212) 555-0100
Category: Retail Store
Vibe: cozy

=== END LOCATION 2 ===`;

test("structured paste: fields, normalized website, ignored unknown labels, no guessing", () => {
  const r = PARSE.parseLocationPaste(PASTE);
  assert.equal(r.ok, true);
  assert.equal(r.locations.length, 2);
  const [a, b] = r.locations;
  assert.deepEqual([a.name, a.address, a.city, a.state, a.postalCode, a.website], ["LAVAN Chelsea", "541 W 25th St", "New York", "NY", "10001", "https://example.com/"]);
  assert.deepEqual([b.website, b.phone, b.category], ["https://www.shopify.com/", "(212) 555-0100", "Retail Store"]);
  assert.ok(b.warnings.some((w) => /"Vibe" isn't a Location field/.test(w)));
});

test("structured paste: one block without markers; one-line address split only with a real state", () => {
  const r = PARSE.parseLocationPaste("Location Name: Pier 57\nAddress: 25 11th Ave, New York, NY 10011");
  assert.equal(r.ok, true);
  assert.deepEqual([r.locations[0].address, r.locations[0].city, r.locations[0].state, r.locations[0].postalCode], ["25 11th Ave", "New York", "NY", "10011"]);
  const bad = PARSE.parseLocationPaste("Location Name: X\nWebsite: not a site\nZIP: 123\nPhone: call us");
  assert.equal(bad.locations[0].website, null);
  assert.equal(bad.locations[0].postalCode, null);
  assert.equal(bad.locations[0].phone, null);
  assert.equal(bad.locations[0].warnings.length, 3);
});

test("batch segmentation: up to 25; the same place 5 times is ONE row; 26 blocks refused", () => {
  const block = (n, name, street) => `LOCATION ${n}\nLocation Name: ${name}\nStreet Address: ${street}\nCity: New York\nState: NY\nZIP: 10012\n=== END LOCATION ${n} ===`;
  const five = [1, 2, 3, 4, 5].map((n) => block(n, "Shopify New York", "131 Greene St")).join("\n\n");
  const r = PARSE.parseLocationPaste(five);
  assert.equal(r.blocks, 5);
  assert.equal(r.locations.length, 1, "resolved once");
  assert.deepEqual(r.locations[0].labels, ["Location 1", "Location 2", "Location 3", "Location 4", "Location 5"]);
  const sameNameOtherStreet = PARSE.parseLocationPaste([block(1, "Starbucks", "100 Example St"), block(2, "Starbucks", "200 Example St")].join("\n"));
  assert.equal(sameNameOtherStreet.locations.length, 2, "same name, different address → separate");
  const many = Array.from({ length: 25 }, (_, i) => block(i + 1, `Place ${i + 1}`, `${i + 1} Main St`)).join("\n");
  assert.equal(PARSE.parseLocationPaste(many).locations.length, 25);
  const tooMany = PARSE.parseLocationPaste(`${many}\n${block(26, "Place 26", "26 Main St")}`);
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error, /up to 25 Locations/);
});

// ── MATCH BEFORE CREATE ─────────────────────────────────────────────────

test("matching: exact address → existing (no create); minor name variation + same address → existing", () => {
  const existing = loc({ id: "lavan", name: "LAVAN Chelsea", address: "541 West 25th Street", postal_code: "10001", is_public: false });
  const exact = RES.classifyLocationMatches(ev({ name: "LAVAN Chelsea", address: "541 W 25th St", postalCode: "10001" }), [existing]);
  assert.deepEqual(exact, { kind: "existing", location: existing });
  const variant = RES.classifyLocationMatches(ev({ name: "Lavan", address: "541 W 25th St, Suite 2", postalCode: "10001" }), [existing]);
  assert.equal(variant.kind, "existing");
  const shopify = loc({ id: "s", name: "Shopify New York", address: "131 Greene St", postal_code: "10012" });
  assert.equal(RES.classifyLocationMatches(ev({ name: "Shopify NY", address: "131 Greene Street", postalCode: "10012" }), [shopify]).kind, "existing");
});

test("matching: same name, different address → a separate NEW Location", () => {
  const a = loc({ id: "a", name: "Starbucks", address: "100 Example St" });
  assert.deepEqual(RES.classifyLocationMatches(ev({ name: "Starbucks", address: "200 Example St" }), [a]), { kind: "new" });
});

test("matching: ambiguous → candidates for the operator, never a silent match or create", () => {
  // Same building, different name (food hall / shared address).
  const hall = loc({ id: "h", name: "Chelsea Market", address: "75 9th Ave" });
  const r1 = RES.classifyLocationMatches(ev({ name: "Pop-Up Shop", address: "75 9th Ave" }), [hall]);
  assert.equal(r1.kind, "ambiguous");
  // Name only (no address on one side).
  const r2 = RES.classifyLocationMatches(ev({ name: "Pier 57", address: "25 11th Ave" }), [loc({ id: "p", name: "Pier 57", address: null })]);
  assert.equal(r2.kind, "ambiguous");
  // Two strong matches.
  const r3 = RES.classifyLocationMatches(ev({ name: "Shop", address: "1 Main St" }), [loc({ id: "1", name: "Shop", address: "1 Main St" }), loc({ id: "2", name: "The Shop", address: "1 Main Street" })]);
  assert.equal(r3.kind, "ambiguous");
  assert.equal(r3.candidates.length, 2);
});

test("vague evidence: area / intersection / no street → not creatable, unless Findmi already has it", () => {
  for (const address of ["SoHo", "Times Square", "near Bryant Park", "Bleecker & Mulberry", "Mercer Street between Spring and Broome"]) {
    const r = RES.classifyLocationMatches(ev({ name: "Pop-Up", address }), []);
    assert.equal(r.kind, "insufficient", address);
  }
  assert.equal(RES.classifyLocationMatches(ev({ name: "Pop-Up", address: null }), []).kind, "insufficient");
  assert.equal(RES.classifyLocationMatches(ev({ name: "Pop-Up", address: "1 Main St", city: null }), []).kind, "insufficient");
  // An existing canonical Location for that place is still offered.
  const known = loc({ id: "ts", name: "Times Square Plaza", address: null });
  assert.equal(RES.classifyLocationMatches(ev({ name: "Times Square Plaza", address: "Times Square" }), [known]).kind, "ambiguous");
});

test("batch: each distinct place is looked up ONCE", async () => {
  const one = ev({ name: "Shopify New York", address: "131 Greene St", postalCode: "10012" });
  let calls = 0;
  const out = await RES.resolveLocationBatch([one, { ...one }, { ...one }, { ...one }, { ...one }], async () => (calls++, []));
  assert.equal(calls, 1);
  assert.deepEqual(out.get(one.key), { kind: "new" });
});

// ── WEBSITE ENRICHMENT ──────────────────────────────────────────────────

const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const placeNode = (street, extra = {}) => ({
  "@type": "LocalBusiness",
  name: "LAVAN",
  address: { "@type": "PostalAddress", streetAddress: street, addressLocality: "New York", addressRegion: "NY", postalCode: "10001" },
  telephone: "+1 212-555-0199",
  geo: { "@type": "GeoCoordinates", latitude: 40.7505, longitude: -74.0047 },
  openingHoursSpecification: [
    { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday"], opens: "10:00", closes: "19:00" },
    { "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/Sunday", opens: "00:00", closes: "23:59" },
    { "@type": "OpeningHoursSpecification", dayOfWeek: "Saturday", opens: "10:00", closes: "18:00", validFrom: "2026-12-20", validThrough: "2026-12-31" },
  ],
  description: "A Chelsea event space.",
  ...extra,
});
const page = (...nodes) => `<!doctype html><html><head><title>LAVAN</title>${nodes.map(ld).join("")}</head><body></body></html>`;

test("website facts: JSON-LD place → address, phone, hours (normal only), map position", () => {
  const f = WEB.extractLocationFacts(page(placeNode("541 W 25th St")), { address: "541 West 25th Street" });
  assert.deepEqual([f.address, f.city, f.state, f.postalCode, f.phone], ["541 W 25th St", "New York", "NY", "10001", "+1 212-555-0199"]);
  assert.deepEqual(f.hours, { mon: { closed: false, open: "10:00", close: "19:00" }, tue: { closed: false, open: "10:00", close: "19:00" }, sun: { closed: false, allDay: true } }, "seasonal hours ignored; unmentioned days unset");
  assert.deepEqual([f.latitude, f.longitude], [40.7505, -74.0047]);
  assert.deepEqual(WEB.hoursFromSchema({ openingHours: ["Mo-Fr 09:00-17:00", "Sa 11:00-15:00"] }).sat, { closed: false, open: "11:00", close: "15:00" });
});

test("website facts: a chain site with many branches → only the supplied branch, else nothing address-bound", () => {
  const html = page({ "@graph": [placeNode("100 Example St", { name: "Cafe A" }), placeNode("200 Example St", { name: "Cafe B", telephone: "212-555-0200" })] });
  assert.equal(WEB.extractLocationFacts(html, { address: "200 Example Street" }).phone, "212-555-0200");
  const none = WEB.extractLocationFacts(html, { address: "999 Other St" });
  assert.equal(none.address, null);
  assert.equal(none.phone, null);
  assert.equal(none.multipleAddresses, true);
});

test("proposal: supplied values win; website fills gaps; conflicts are flagged, never applied", () => {
  const e = ev({ name: "LAVAN Chelsea", address: "541 W 25th St", postalCode: "10001", category: "Event Venue" });
  const facts = WEB.extractLocationFacts(page(placeNode("541 W 25th St")), { address: e.address });
  const p = WEB.buildLocationProposal(e, facts, CATEGORIES);
  assert.equal(p.name, "LAVAN Chelsea");
  assert.equal(p.phone, "+1 212-555-0199");
  assert.equal(p.sources.phone, "website");
  assert.equal(p.categoryId, "cat-venue");
  assert.equal(p.sources.category, "provided");
  assert.equal(p.description, "A Chelsea event space.");
  assert.ok(p.hours?.mon);
  assert.deepEqual([p.latitude, p.longitude], [40.7505, -74.0047]);
  assert.deepEqual(p.conflicts, [], "LAVAN ~ LAVAN Chelsea, same street");

  // The website states a DIFFERENT address: keep the supplied one, flag it,
  // and take nothing address-bound from the site.
  const moved = WEB.extractLocationFacts(page(placeNode("100 Other Ave")), { address: null });
  const q = WEB.buildLocationProposal(ev({ name: "LAVAN Chelsea", address: "541 W 25th St", phone: "212-555-1111" }), moved, CATEGORIES);
  assert.equal(q.address, "541 W 25th St");
  assert.equal(q.phone, "212-555-1111");
  assert.ok(q.conflicts.some((c) => c.field === "address" && c.website === "100 Other Ave"));
  assert.equal(q.hours, null);
  assert.equal(q.latitude, null);
  assert.ok(q.notes.some((n) => /different address/.test(n)));
});

test("category: the written category (exact / one-word) or the schema type; never invented", () => {
  assert.equal(WEB.resolveLocationCategory("event-venue", [], CATEGORIES), "cat-venue");
  assert.equal(WEB.resolveLocationCategory("Cafe", [], CATEGORIES), "cat-cafe");
  assert.equal(WEB.resolveLocationCategory("Speakeasy", [], CATEGORIES), null);
  assert.equal(WEB.resolveLocationCategory(null, ["ArtGallery"], CATEGORIES), "cat-gallery");
  assert.equal(WEB.resolveLocationCategory(null, ["Store", "Restaurant"], CATEGORIES), null, "conflicting types → none");
});

// ── SERVER: WEBSITE READ + MEDIA ────────────────────────────────────────

const OK_IMG = { role: "logo", body: Buffer.from("x"), validated: { contentType: "image/png", extension: "png" }, width: 400, height: 400 };
function deps(over = {}) {
  const calls = { verified: [], stored: [] };
  return {
    calls,
    fetchPage: async (url) => ({ ok: true, url, html: over.html ?? page(placeNode("541 W 25th St")), bytes: 1, redirects: 0, truncated: false, declaredBytes: null }),
    verifyImage: async (url, role) => (calls.verified.push([url, role]), over.verify ? over.verify(url, role) : { ok: true, image: { ...OK_IMG, role } }),
    preview: async () => "data:image/webp;base64,AAAA",
    store: async (image) => (calls.stored.push(image.role), over.store ? over.store(image) : `https://proj.supabase.co/storage/v1/object/public/x/${image.role}.webp`),
    findCandidates: async () => over.candidates ?? [],
    locationCategoryIds: async () => new Set(["cat-venue"]),
    ...over.deps,
  };
}

test("website read: shared safe fetch; strong logo + verified cover; favicon is never a profile image", async () => {
  const html = `<!doctype html><html><head><meta property="og:image" content="https://lavan.example/hero.jpg"><link rel="icon" href="https://lavan.example/favicon.png">${ld(placeNode("541 W 25th St", { logo: "https://lavan.example/logo.png" }))}</head><body></body></html>`;
  const d = deps({ html });
  const r = await SRV.readLocationWebsite("lavan.example", { address: "541 W 25th St" }, d);
  assert.equal(r.ok, true);
  assert.equal(r.logo.sourceUrl, "https://lavan.example/logo.png");
  assert.equal(r.cover.sourceUrl, "https://lavan.example/hero.jpg");
  assert.match(r.logo.preview, /^data:image\/webp;base64,/, "data-URI preview only");
  assert.ok(!d.calls.verified.some(([u]) => /favicon/.test(u)));

  const iconOnly = await SRV.readLocationWebsite("https://icons.example", { address: null }, deps({ html: `<html><head><link rel="icon" href="https://icons.example/favicon.png"></head></html>` }));
  assert.equal(iconOnly.logo, null, "no strong logo evidence → fallback");
});

test("website failure is isolated: the Location can still be created from its structured identity", async () => {
  const r = await SRV.readLocationWebsite("https://down.example", { address: null }, deps({ deps: { fetchPage: async () => ({ ok: false, code: "timeout", redirects: 0 }) } }));
  assert.equal(r.ok, false);
  assert.match(r.detail, /still review and create/);
  const media = await SRV.readLocationWebsite("https://lavan.example", { address: null }, deps({ html: `<html><head><meta property="og:image" content="https://lavan.example/broken.jpg"></head></html>`, verify: () => ({ ok: false }) }));
  assert.equal(media.ok, true);
  assert.equal(media.cover, null, "media failure → fallback presentation, not a broken image");
});

// ── CREATION SEMANTICS ──────────────────────────────────────────────────

function fakeAdmin({ candidates = [] } = {}) {
  const ops = [];
  return {
    ops,
    from(table) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        or: () => chain,
        limit: () => chain,
        order: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (res) => res({ data: table === "locations" ? candidates : table === "categories" ? [{ id: "cat-venue", name: "Event Venue", slug: "event-venue" }] : [], error: null }),
        insert: (row) => {
          ops.push({ table, kind: "insert", row });
          return { select: () => ({ single: async () => ({ data: { id: "loc-new", slug: "lavan-chelsea", ...row }, error: null }) }) };
        },
        update: (patch) => {
          const entry = { table, kind: "update", patch, id: null };
          ops.push(entry);
          const c = { eq: (col, v) => ((entry.id = v), c), then: (cb) => cb({ error: null }) };
          return c;
        },
      };
      return chain;
    },
  };
}

const INPUT = { name: "LAVAN Chelsea", address: "541 W 25th St", city: "New York", state: "NY", postalCode: "10001", website: "lavan.example", phone: "212-555-0199", description: "Event space.", categoryId: "cat-venue", hours: { mon: { closed: false, open: "10:00", close: "19:00" } }, latitude: 40.75, longitude: -74.0, logoSourceUrl: "https://lavan.example/logo.png", coverSourceUrl: "https://lavan.example/hero.jpg" };

test("create: same unlisted Quick Create semantics — is_demo, no owner / membership / Business link / publication", async () => {
  const admin = fakeAdmin();
  const d = deps();
  const r = await SRV.createImportedLocation(admin, INPUT, d);
  assert.equal(r.status, "created");
  const ins = admin.ops.find((o) => o.table === "locations" && o.kind === "insert").row;
  assert.equal(ins.is_demo, true, "Not Listed → Needs Review");
  assert.deepEqual([ins.website_url, ins.phone, ins.description, ins.category_id, ins.latitude, ins.longitude], ["https://lavan.example/", "212-555-0199", "Event space.", "cat-venue", 40.75, -74.0]);
  assert.deepEqual(ins.hours, { mon: { closed: false, open: "10:00", close: "19:00" } });
  assert.ok(!admin.ops.some((o) => /members|business_locations|claims|events/.test(o.table)), "nothing but the Location itself");
  // Verified media re-hosted after the row exists, on THIS row only.
  const upd = admin.ops.find((o) => o.kind === "update");
  assert.equal(upd.id, "loc-new");
  assert.deepEqual(Object.keys(upd.patch).sort(), ["cover_image_url", "logo_url"]);
  assert.deepEqual(r.media, { logo: "stored", cover: "stored" });
});

test("create: invalid values are dropped, never stored (category, half a map position, bad website)", async () => {
  const admin = fakeAdmin();
  await SRV.createImportedLocation(admin, { ...INPUT, categoryId: "not-a-location-category", latitude: 40.7, longitude: null, website: "javascript:alert(1)", logoSourceUrl: "http://insecure.example/x.png", coverSourceUrl: null }, deps());
  const ins = admin.ops.find((o) => o.kind === "insert").row;
  assert.ok(!("category_id" in ins) && !("latitude" in ins) && !("longitude" in ins) && !("website_url" in ins));
  assert.ok(!admin.ops.some((o) => o.kind === "update"), "non-https media never fetched");
});

test("create: media failure never undoes the Location (fallback renders)", async () => {
  const admin = fakeAdmin();
  const r = await SRV.createImportedLocation(admin, INPUT, deps({ verify: () => ({ ok: false }) }));
  assert.equal(r.status, "created");
  assert.deepEqual(r.media, { logo: "failed", cover: "failed" });
  assert.ok(!admin.ops.some((o) => o.kind === "update"));
});

test("create: duplicate-checked (existing place offered, nothing inserted) unless Create Anyway; vague refused", async () => {
  const existing = { id: "lavan", slug: "lavan", name: "LAVAN Chelsea", address: "541 W 25th St", city: "New York", state: "NY", postal_code: "10001", is_demo: false, category: null };
  const admin = fakeAdmin({ candidates: [existing] });
  const r = await SRV.createImportedLocation(admin, INPUT, deps());
  assert.equal(r.status, "duplicates");
  assert.equal(r.duplicates[0].id, "lavan");
  assert.ok(!admin.ops.some((o) => o.kind === "insert"), "no second canonical Location");
  const forced = await SRV.createImportedLocation(admin, INPUT, deps(), { force: true });
  assert.equal(forced.status, "created");
  const vague = await SRV.createImportedLocation(fakeAdmin(), { ...INPUT, address: "Bleecker & Mulberry" }, deps());
  assert.equal(vague.status, "error");
});

test("create never touches an existing Location's media (no update other than the new row)", () => {
  const src = read("src/lib/location-import/server.ts");
  assert.equal((src.match(/\.update\(/g) ?? []).length, 1);
  assert.match(src, /\.update\(patch\)\.eq\("id", result\.location\.id\)/);
  for (const f of ["server.ts", "parse.ts", "resolve.ts", "website.ts", "types.ts"]) {
    assert.doesNotMatch(read(`src/lib/location-import/${f}`), /business_locations|location_members|create_owned_location|is_demo: false/, f);
  }
});

// ── ADMIN ENTRY + ACTIONS ───────────────────────────────────────────────

test("Admin → Locations → Import Locations: protected route, entry link, every action needs the Admin session", async () => {
  const dir = "src/app/admin/(protected)/locations/import";
  assert.ok(existsSync(`${dir}/page.tsx`));
  assert.match(read(`${dir}/page.tsx`), /if \(!\(await isAdminSession\(\)\)\) redirect\("\/admin\/login"\);/);
  assert.match(read("src/app/admin/(protected)/locations/page.tsx"), /href="\/admin\/locations\/import"[\s\S]{0,200}Import Locations/);
  globalThis.__ADMIN = undefined;
  assert.equal((await ACT.adminAnalyzeLocationPaste(PASTE)).ok, false);
  assert.equal((await ACT.adminReadLocationWebsite(ev({ name: "x", website: "https://x.example/" }))).ok, false);
  assert.equal((await ACT.adminCreateImportedLocation(INPUT)).status, "error");
  assert.equal((await ACT.adminResolveLocationEvidence({ name: "x", address: null, city: null, state: null, postalCode: null })).ok, false);
});

test("analyze: Existing / New / Needs a Decision, resolved against Findmi; writes nothing", async () => {
  const existing = { id: "lavan", slug: "lavan", name: "LAVAN Chelsea", address: "541 W 25th St", city: "New York", state: "NY", postal_code: "10001", is_demo: true, category: null };
  globalThis.__ADMIN = fakeAdmin({ candidates: [existing] });
  const r = await ACT.adminAnalyzeLocationPaste(PASTE);
  assert.equal(r.ok, true);
  const [a, b] = r.rows;
  assert.equal(a.resolution.kind, "existing");
  assert.equal(a.resolution.location.is_public, false, "shows Not Listed");
  assert.equal(b.resolution.kind, "new", "the candidate is at a different street");
  assert.equal(b.proposal.categoryId, null, "Retail Store isn't one of this fake's categories — never invented");
  assert.ok(b.proposal.notes.some((n) => /isn't a Findmi Location category/.test(n)));
  assert.ok(!globalThis.__ADMIN.ops.length, "nothing written");
  globalThis.__ADMIN = undefined;
});

test("Import Complete counts only real outcomes", () => {
  assert.deepEqual(RES.tallyLocationImport(["existing", "created", "created", "unresolved", "failed", "skipped"]), { submitted: 6, existingMatched: 1, created: 2, needsResolution: 1, failed: 1, awaitingReview: 2 });
  const ui = read("src/app/admin/(protected)/locations/import/LocationImporter.tsx");
  for (const label of ["Locations Submitted", "Existing Locations Matched", "New Locations Created", "Ambiguous / Needs Resolution", "Failed", "Awaiting Review (Not Listed)"]) assert.ok(ui.includes(label), label);
  for (const href of ['href="/admin/locations?review=1"', 'href="/admin/locations"']) assert.ok(ui.includes(href));
  assert.match(ui, /Import More/);
  // One at a time so an earlier creation is found by the next duplicate check.
  assert.match(ui, /for \(const row of rows\) \{[\s\S]*?await adminCreateImportedLocation\(createInputFromDraft\(row\.draft\), row\.decision\.force\)/);
  assert.match(read("src/lib/admin/queries.ts"), /if \(needsReview\) query = query\.eq\("is_demo", true\);/, "created (is_demo) Locations land in Needs Review");
});

// ── EVENT IMPORT INTEGRATION ────────────────────────────────────────────

test("Event Import: the missing-Location step IS Location Import V1 (same actions), under the same eligibility", () => {
  const client = read("src/app/admin/(protected)/events/import/AdminEventImporter.tsx");
  assert.match(client, /renderLocationCreate: \(\{ idPrefix, place, placeKey, onSelected \}\) => \(\n\s+<EventLocationCreate /);
  const step = read("src/components/admin/location-import/EventLocationCreate.tsx");
  for (const a of ["adminReadLocationWebsite", "adminCreateImportedLocation"]) assert.match(step, new RegExp(`await ${a}\\(`), a);
  assert.match(step, /import \{ adminCreateImportedLocation, adminReadLocationWebsite \} from "@\/app\/admin\/\(protected\)\/locations\/import\/actions";/);
  // Orchestration completion: the match-first preparation runs without a click, once per place (the importer's adminPrepareLocation).
  assert.match(client, /const r = await adminPrepareLocation\(/);
  assert.match(step, /onSelected\(toCreated\(placeKey, r\.location\)\)/, "keyed by place → reused across the batch");
  // Match before create: the prepared resolution comes first; Create needs "new" or an explicit force.
  assert.match(step, /const isNew = resolution\.kind === "new" \|\| force;/);
  const parts = read("src/app/(public)/account/business/[id]/import-event/ReviewParts.tsx");
  assert.match(parts, /quickCreate\?\.eligible && quickCreate\.render \? quickCreate\.render\(/);
  assert.match(read("src/app/admin/(protected)/events/import/actions.ts"), /return createImportedLocation\(/);
});

const placeOf = (o) => ({ venueName: null, address: null, city: "New York", state: "NY", postalCode: null, useLocationId: null, ...o });
const reviewOf = (occurrences, shared = false) => ({ intent: "participating", title: "T", occurrences, sharedPlace: shared, place: placeOf({}) });
const occ = (id, date, time, p) => ({ id, date, startTime: time, endTime: "", place: p });

test("Event Import reuse: 4 dates at one new Location; 3 different Locations; 2 at the same time; across Events", () => {
  const key = R.placeKeyFor(placeOf({ venueName: "Shopify New York", address: "131 Greene St" }));
  const shop = (k = key) => placeOf({ venueName: "Shopify New York", address: "131 Greene St", matchKey: k });
  const created = { key, id: "loc-shop", name: "Shopify New York", address: "131 Greene St", city: "New York", state: "NY", postalCode: "10012" };
  const four = R.applyCreatedLocation(reviewOf([1, 2, 3, 4].map((n) => occ(`d${n}`, `2026-11-0${n}`, "10:00", shop()))), created);
  assert.deepEqual(four.occurrences.map((o) => o.place.useLocationId), ["loc-shop", "loc-shop", "loc-shop", "loc-shop"], "created once, used 4 times");

  const A = placeOf({ venueName: "Location A", address: "100 Example St", matchKey: "a" });
  const B = placeOf({ venueName: "Location B", address: "200 Example St", matchKey: "b" });
  const C = placeOf({ venueName: "Location C", address: "300 Example St", matchKey: "c" });
  let tour = reviewOf([occ("1", "2026-10-20", "11:00", A), occ("2", "2026-10-21", "12:00", B), occ("3", "2026-10-21", "12:00", C)]);
  tour = R.applyCreatedLocation(tour, { key: "b", id: "loc-b", name: "Location B", address: "200 Example St", city: "New York", state: "NY", postalCode: null });
  assert.deepEqual(tour.occurrences.map((o) => o.place.useLocationId), [null, "loc-b", null], "two at the same date/time stay separate");
  tour = R.applyCreatedLocation(tour, { key: "c", id: "loc-c", name: "Location C", address: "300 Example St", city: "New York", state: "NY", postalCode: null });
  assert.deepEqual(tour.occurrences.map((o) => o.place.useLocationId), [null, "loc-b", "loc-c"]);

  // Another Event in the batch at the same place reuses the same Location.
  const other = R.applyCreatedLocation(reviewOf([occ("x", "2026-12-01", "18:00", shop())]), created);
  assert.equal(other.occurrences[0].place.useLocationId, "loc-shop");
});

test("no inferred ownership: an Event's Business never becomes the Location's operator, website or logo", () => {
  const step = read("src/components/admin/location-import/EventLocationCreate.tsx");
  assert.doesNotMatch(step, /businessId|organizerBusiness|structured\.businessWebsite/, "no Business evidence is passed in");
  // Only the place itself (its own Location Website at most) — never the Business's website.
  assert.match(read("src/app/admin/(protected)/events/import/AdminEventImporter.tsx"), /adminPrepareLocation\(\{ name: place\.venueName, address: place\.address, city: place\.city, state: place\.state, postalCode: place\.postalCode, website: place\.website \?\? null, eventName: place\.eventName \?\? null \}\)/, "only the place itself — no website from the Business");
  assert.doesNotMatch(read("src/app/admin/(protected)/locations/import/actions.ts"), /business_locations|from\("businesses"\)/);
});

// ── PUBLIC FALLBACK ─────────────────────────────────────────────────────

test("public fallback: deterministic monogram + branded hero from the Location's own data; real media wins", () => {
  assert.equal(FB.locationInitials("LAVAN Chelsea"), "LC");
  assert.equal(FB.locationInitials("The Shed"), "S");
  assert.equal(FB.locationInitials("Café Lumière"), "CL");
  assert.equal(FB.locationInitials(""), "F");
  assert.equal(FB.locationFallbackLine({ category: "Event Venue", city: "New York", state: "NY" }), "Event Venue · New York, NY");
  assert.equal(FB.locationFallbackLine({ category: null, area: "Chelsea", city: "New York" }), "Chelsea");
  const view = read("src/app/(public)/location/[slug]/LocationPublicView.tsx");
  // Closeout: an unfinished profile no longer fakes a hero or a logo tile — no cover → the hero block
  // is simply not rendered; no logo → no logo tile (real media still wins when present).
  assert.match(view, /\{hasHero && \(/);
  assert.match(view, /<EventCoverLightbox images=\{heroImages\} alt=\{location\.name\} \/>/);
  assert.doesNotMatch(view, /LocationMonogram|LocationCoverFallback/);
  const comp = read("src/components/location/LocationFallback.tsx");
  assert.doesNotMatch(comp, /<img|SupabaseImage|purple|violet|#C6FF00|lime/i, "no fake photography, no rejected colors");
  assert.match(comp, /aria-hidden="true"/);
});
