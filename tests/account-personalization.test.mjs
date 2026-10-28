// Account personalization pass — Following correctness, Save organization,
// personal collections, the personalized Account Home, and the consumer
// terminology / switcher / icon cleanup. Real functions where pure (or with
// a fake session client); source checks only for React wiring this
// environment can't render (no jsdom). No network, no Production data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

globalThis.__SESSION = null;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/headers") return { url: "data:text/javascript,export const cookies=async()=>({get(){return undefined}});export const headers=async()=>new Map();", shortCircuit: true };
    if (specifier === "next/server") return { url: "data:text/javascript,export const NextResponse={json:(b,i)=>Response.json(b,i)};", shortCircuit: true };
    if (specifier === "@/lib/supabase/server") return { url: "data:text/javascript,export async function getServerSupabase(){return globalThis.__SESSION;}", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const F = await import("../src/lib/moment-filters.ts");
const S = await import("../src/lib/save-organization.ts");
const REL = await import("../src/lib/discovery/relationships.ts");
const H = await import("../src/lib/account-home.ts");
const FK = await import("../src/app/api/account/follow-keys/route.ts");
const RR = await import("../src/app/api/relationships/route.ts");
const read = (p) => readFileSync(p, "utf8");

const USER = "11111111-1111-4111-8111-111111111111";
const BIZ = "b0000000-0000-4000-8000-000000000001";
const OTHER_BIZ = "b0000000-0000-4000-8000-000000000002";
const EVT = "e0000000-0000-4000-8000-000000000001";
const LOC = "c0000000-0000-4000-8000-000000000001";
const PROD = "d0000000-0000-4000-8000-000000000001";

/** A tiny fake of the RLS-scoped session client: rows per table, filters applied in memory; writes recorded. */
function session(tables = {}, { user = { id: USER } } = {}) {
  const writes = [];
  return {
    writes,
    auth: { getUser: async () => ({ data: { user } }) },
    from(table) {
      let rows = [...(tables[table] ?? [])];
      const chain = {
        select: () => chain,
        eq: (col, v) => ((rows = rows.filter((r) => r[col] === undefined || r[col] === v)), chain),
        in: (col, vs) => ((rows = rows.filter((r) => vs.includes(r[col]))), chain),
        then: (res) => res({ data: rows, error: null }),
        insert: async (row) => (writes.push({ table, op: "insert", row }), { error: null }),
        delete: () => {
          const filters = {};
          const d = { eq: (c, v) => ((filters[c] = v), d), then: (res) => (writes.push({ table, op: "delete", filters }), res({ error: null })) };
          return d;
        },
      };
      return chain;
    },
  };
}

// ── FOLLOWING ───────────────────────────────────────────────────────────

const card = (follow) => ({ tags: [], follow: { businessSlugs: [], eventIds: [], locationIds: [], ...follow } });
const NONE = { businessSlugs: [], eventIds: [], locationIds: [] };

test("signed-in DB follows (ids) drive Following — a followed Business's linked Moment matches", () => {
  const account = { businessSlugs: [], businessIds: [BIZ], eventIds: [], locationIds: [] };
  assert.equal(F.momentMatchesFilter(card({ businessIds: [BIZ] }), "following", account), true);
  assert.equal(F.momentMatchesFilter(card({ businessIds: [OTHER_BIZ] }), "following", account), false);
});

test("a Moment PUBLISHED by a followed Business (author_business_id) matches", () => {
  // getMomentFeed puts connected Businesses + author_business_id in businessIds.
  const src = read("src/lib/moment-discovery.ts");
  assert.match(src, /businessIds: \[\.\.\.new Set\(\[\.\.\.rConns\.map\(\(c\) => c\.business_id\), r\.author_business_id \?\? null\]/);
  assert.equal(F.momentMatchesFilter(card({ businessIds: [BIZ] }), "following", { ...NONE, businessIds: [BIZ] }), true);
});

test("guest behavior stays valid — device slug / event / location lists still match", () => {
  const device = { businessSlugs: ["acme"], eventIds: [EVT], locationIds: [LOC] };
  assert.equal(F.momentMatchesFilter(card({ businessSlugs: ["acme"] }), "following", device), true);
  assert.equal(F.momentMatchesFilter(card({ eventIds: [EVT] }), "following", device), true);
  assert.equal(F.momentMatchesFilter(card({ locationIds: [LOC] }), "following", device), true);
  const merged = F.mergeFollowKeys(device, { ...NONE, businessIds: [BIZ] });
  assert.deepEqual(merged, { businessSlugs: ["acme"], eventIds: [EVT], locationIds: [LOC], businessIds: [BIZ] });
});

test("follows nothing → follow prompt; follows things with no qualifying Moments → nothing-new-yet", () => {
  assert.equal(F.followingEmptyMessage(NONE), "Follow a Business, Event or Location to see its Moments here.");
  assert.equal(F.followingEmptyMessage({ ...NONE, businessIds: [BIZ] }), "Nothing new from the Pages you follow yet — check back soon.");
  const ui = read("src/components/moments/MomentsDiscovery.tsx");
  // For You (which replaced the Following chip) says "no signal" only after
  // account follows load — never a guess.
  assert.match(ui, /mode !== "for-you" \|\| !followsReady \|\| forYou\.personalized/, "the For You note is decided only after account follows load");
  assert.match(ui, /fetch\("\/api\/account\/follow-keys"\)/);
  assert.match(ui, /getAccountSession\(\)/, "guests never call the account endpoint");
});

test("/api/account/follow-keys returns ONLY this user's DB follows; 401 when signed out", async () => {
  globalThis.__SESSION = session({
    account_followed_businesses: [{ user_id: USER, business_id: BIZ }, { user_id: "someone-else", business_id: OTHER_BIZ }],
    account_followed_events: [{ user_id: USER, event_id: EVT }],
    account_followed_locations: [],
  });
  const res = await FK.GET();
  assert.deepEqual(await res.json(), { businessSlugs: [], businessIds: [BIZ], eventIds: [EVT], locationIds: [] });
  globalThis.__SESSION = session({}, { user: null });
  assert.equal((await FK.GET()).status, 401);
});

// ── SAVE ORGANIZATION ──────────────────────────────────────────────────

test("classifications shipped are exactly the truthful ones (no Going, no Must Have, no Appearance)", () => {
  const labels = Object.fromEntries(Object.entries(S.SAVE_CLASSIFICATIONS).map(([t, list]) => [t, list.map((c) => `${c.label}=${c.relation}`)]));
  assert.deepEqual(labels, {
    product: ["Want=want", "Have=have"],
    event: ["Interested=want", "Must Do=must_do"],
    location: ["Want To Go=want", "Must Do=must_do", "Been Here=been"],
  });
  assert.equal(S.isOrganizable("business"), false, "Business: plain Save; Follow stays separate");
  assert.equal(S.isOrganizable("appearance"), false);
  const all = JSON.stringify(S.SAVE_CLASSIFICATIONS);
  assert.doesNotMatch(all, /Going|Must Have|going|must_have/);
});

test("every shipped classification is accepted by the existing relationship validation (and nothing new is invented)", () => {
  for (const [type, list] of Object.entries(S.SAVE_CLASSIFICATIONS)) {
    for (const c of list) assert.equal(REL.validateRelationship({ entityType: type, entityId: PROD, relation: c.relation }).ok, true, `${type}:${c.relation}`);
  }
  assert.equal(REL.validateRelationship({ entityType: "event", entityId: EVT, relation: "going" }).ok, false);
  assert.equal(REL.validateRelationship({ entityType: "product", entityId: PROD, relation: "must_do" }).ok, false, "Must Have is never stored as must_do");
  assert.deepEqual([...REL.RELATIONSHIPS], ["want", "must_do", "like", "dislike", "been", "have"], "same relation set as the DB CHECK");
});

test("Save persists BEFORE organization; dismissing the sheet never touches the Save", () => {
  const hook = read("src/lib/useAccountSaved.ts");
  // write(next): optimistic Save + the real /api/account/save call, then the sheet opens beside it.
  assert.match(hook, /function write\(next: boolean\) \{\s*\n\s*setSaved\(next\); \/\/ optimistic\s*\n\s*if \(next && organizable\) setSheetOpen\(true\);\s*\n\s*fetch\("\/api\/account\/save"/);
  assert.match(hook, /close: \(\) => setSheetOpen\(false\),/, "Done / backdrop / Escape only close the sheet");
  // Guests: unchanged localStorage toggle, no sheet.
  assert.match(hook, /if \(!authed\) \{\s*\n\s*const nowSaved = LOCAL\[type\]\.toggle\(slug\);/);
  assert.match(hook, /authed && organizable/);
});

test("reopening a saved item opens the sheet (prefilled) instead of a one-tap unsave; Remove From Saved is explicit", () => {
  const hook = read("src/lib/useAccountSaved.ts");
  assert.match(hook, /if \(organizable && saved\) \{\s*\n\s*setSheetOpen\(true\);\s*\n\s*return;/);
  const sheet = read("src/components/SaveOrganizeSheet.tsx");
  assert.match(sheet, /fetch\(`\/api\/relationships\?type=\$\{type\}&id=\$\{id\}`/, "existing classifications prefill");
  assert.match(sheet, /aria-pressed=\{active\}/, "multi-select toggles");
  assert.match(sheet, /Remove From Saved/);
  for (const f of ["EventSaveButton", "ProductSaveButton", "LocationSaveButton", "SaveIconButton"]) {
    assert.match(read(`src/components/${f}.tsx`), /<SaveOrganizeSheet organize=\{organize\} \/>/, f);
  }
});

test("Unsave does NOT erase classifications (Have / Been are history)", () => {
  const hook = read("src/lib/useAccountSaved.ts");
  const unsave = hook.slice(hook.indexOf("unsave: () => {"), hook.indexOf("unsave: () => {") + 200);
  assert.doesNotMatch(unsave, /relationships/);
  assert.doesNotMatch(read("src/app/api/account/save/route.ts"), /user_entity_relationships/);
});

test("removing ONE classification deletes only that row; organizing requires an account", async () => {
  const s = session({});
  globalThis.__SESSION = s;
  const post = (body) => RR.POST({ json: async () => body });
  let res = await post({ entityType: "location", entityId: LOC, relation: "been", on: false });
  assert.equal(res.status, 200);
  assert.deepEqual(s.writes, [{ table: "user_entity_relationships", op: "delete", filters: { user_id: USER, entity_type: "location", entity_id: LOC, relation: "been" } }]);
  // Compatible classifications coexist: adding Want To Go never clears Been / Must Do.
  s.writes.length = 0;
  res = await post({ entityType: "location", entityId: LOC, relation: "want", on: true });
  assert.equal(res.status, 200);
  assert.deepEqual(s.writes, [{ table: "user_entity_relationships", op: "insert", row: { user_id: USER, entity_type: "location", entity_id: LOC, relation: "want" } }]);
  globalThis.__SESSION = session({}, { user: null });
  assert.equal((await post({ entityType: "location", entityId: LOC, relation: "want" })).status, 401);
});

test("standalone intent buttons are gone from entity pages; the card heart is labelled Save", () => {
  for (const f of ["src/app/(public)/event/[slug]/EventPublicView.tsx", "src/app/(public)/location/[slug]/LocationPublicView.tsx", "src/app/(public)/product/[slug]/page.tsx"]) {
    assert.doesNotMatch(read(f), /<RelationshipButton/, f);
  }
  const heart = read("src/components/SaveIconButton.tsx");
  assert.match(heart, /aria-label=\{saved \? "Saved" : "Save"\}/);
  assert.doesNotMatch(heart, /"Remove from Want"/);
});

// ── COLLECTIONS ────────────────────────────────────────────────────────

const RELS = [
  { entity_type: "product", entity_id: PROD, relation: "want" }, // the real Production row shape
  { entity_type: "location", entity_id: LOC, relation: "been" },
  { entity_type: "location", entity_id: LOC, relation: "must_do" },
  { entity_type: "event", entity_id: EVT, relation: "must_do" },
  { entity_type: "event", entity_id: EVT, relation: "like" }, // discovery-only; never a collection
];

test("real intent rows land in the right collections — even with NO Save row", () => {
  assert.deepEqual(S.collectionMembers("want", RELS), { product: [PROD], event: [], location: [] });
  assert.deepEqual(S.collectionMembers("must-do", RELS), { product: [], event: [EVT], location: [LOC] });
  assert.deepEqual(S.collectionMembers("have-been", RELS), { product: [], event: [], location: [LOC] });
  // All Saved: every Save plus every classified item, deduped; like/dislike never count.
  const all = S.collectionMembers("all", RELS, { event: [EVT, "e-saved"], product: [] });
  assert.deepEqual(all, { product: [PROD], event: [EVT, "e-saved"], location: [LOC] });
});

test("counts match the collection contents; no fake Must Haves collection", () => {
  const counts = S.collectionCounts(RELS, { event: ["e-saved"], business: [BIZ, BIZ] });
  assert.deepEqual(counts, { all: 5, "must-do": 2, want: 1, "have-been": 1 });
  for (const key of ["must-do", "want", "have-been"]) {
    const m = S.collectionMembers(key, RELS, { event: ["e-saved"] });
    assert.equal(counts[key], m.product.length + m.event.length + m.location.length, key);
  }
  assert.deepEqual(S.SAVED_COLLECTIONS.map((c) => c.label), ["All Saved", "Things I Want", "Must Do", "Have & Been"]);
  assert.equal(S.parseCollection("must-have"), "all");
  const page = read("src/app/(public)/account/saved/page.tsx");
  assert.match(page, /collectionMembers\(collection, relations, saved\)/);
  assert.match(page, /from\("user_entity_relationships"\)\.select\("entity_type, entity_id, relation"\)\.eq\("user_id", user\.id\)/);
});

// ── ACCOUNT HOME ───────────────────────────────────────────────────────

const HOME = read("src/app/(public)/account/page.tsx");
const item = (kind, id, extra = {}) => ({ item: { kind, id, title: id, href: `/${id}`, image: null, subtitle: null, start_at: null, end_at: null, start_date: null, end_date: null, created_at: null, categories: [], formats: [], is_free: null, family_friendly: null, rsvp: false, tickets: false, city: null, state: null, postal_code: null, area: null, is_featured: false, has_description: false, haystack: id, related: [id], ...extra }, score: 1, explain: [] });

test("Upcoming Events is follow-scoped (From Pages You Follow)", () => {
  assert.match(HOME, /title="Upcoming Events" subtitle="From Pages You Follow"/);
  assert.match(HOME, /getPersonalUpcoming\(\s*\{\s*savedEvents: \[\],/);
  assert.match(HOME, /followedBusinesses: personalGraph\.followedBusinesses/);
});

test("You Might Like: real ranked records only, never already-followed/saved, upcoming Events only, omitted when thin", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const ranked = [
    item("place", "followed-place"),
    item("place", "p1"),
    item("place", "p2"),
    item("business", "b1"),
    item("event", "past", { start_at: "2026-10-01T12:00:00Z", end_at: "2026-10-01T14:00:00Z", start_date: "2026-10-01", end_date: "2026-10-01" }),
    item("event", "soon", { start_at: "2026-10-25T12:00:00Z", start_date: "2026-10-25", end_date: "2026-10-25" }),
  ];
  assert.deepEqual(H.pickYouMightLike(ranked, "place", new Set(["followed-place"]), now).map((i) => i.id), ["p1", "p2"]);
  assert.deepEqual(H.pickYouMightLike(ranked, "business", new Set(), now), [], "one lonely Brand is not a rail");
  assert.deepEqual(H.pickYouMightLike(ranked, "event", new Set(), now), [], "the past Event never counts; one upcoming isn't enough");
  assert.match(HOME, /hasSignals \? runDiscovery\(\{ entities: \["event", "place", "business"\] \}, \{ personal: true \}\)/, "only for someone with real signals, via the existing personal ranking");
});

test("Products You Might Like: other Brands in the same Categories; never followed Brands' or saved Products", async () => {
  const client = session({
    business_categories: [
      { business_id: BIZ, category_id: "cat-coffee" },
      { business_id: OTHER_BIZ, category_id: "cat-coffee" },
    ],
    products: [
      { id: "p-own", business_id: BIZ, name: "Own", slug: "own", image_url: null, business: { name: "Mine" } },
      { id: "p-a", business_id: OTHER_BIZ, name: "A", slug: "a", image_url: null, business: { name: "Peer" } },
      { id: "p-b", business_id: OTHER_BIZ, name: "B", slug: "b", image_url: null, business: { name: "Peer" } },
      { id: "p-saved", business_id: OTHER_BIZ, name: "Saved", slug: "s", image_url: null, business: { name: "Peer" } },
    ],
  });
  // The fake client ignores order/limit; chain them as no-ops.
  const orig = client.from.bind(client);
  client.from = (t) => {
    const c = orig(t);
    c.order = () => c;
    c.limit = () => c;
    return c;
  };
  const out = await H.getProductsYouMightLike(client, [BIZ], new Set(["p-saved"]));
  assert.deepEqual(out.map((p) => p.id), ["p-a", "p-b"]);
  assert.deepEqual(await H.getProductsYouMightLike(client, [], new Set()), []);
});

test("From Brands You Follow mixes real Products and Moments (connected or authored)", () => {
  const moments = [
    { id: "m1", title: "Pop-up", href: "/journal/m1", entryDate: "2026-10-10", media: [{ kind: "image", url: "https://x/m1.jpg" }], contextLabel: "SoHo", follow: { businessSlugs: [], eventIds: [], locationIds: [], businessIds: [BIZ] } },
    { id: "m2", title: "Other", href: "/journal/m2", entryDate: "2026-10-11", media: [], contextLabel: null, follow: { businessSlugs: [], eventIds: [], locationIds: [], businessIds: [OTHER_BIZ] } },
  ];
  const picked = H.momentsFromBrands(moments, new Set([BIZ]));
  assert.deepEqual(picked.map((m) => m.id), ["m1"]);
  const tiles = H.fromBrandsTiles([{ id: PROD, slug: "mug", name: "Mug", image_url: null, business_id: BIZ, businessName: "Acme" }], picked);
  assert.deepEqual(tiles.map((t) => `${t.kind}:${t.name}:${t.meta}`), ["moment:Pop-up:SoHo", "product:Mug:Acme"]);
});

test("Home order + copy: no People rails, no Saved preview, Your Moments/Pages I Manage, empty rails omitted", () => {
  // Account Home UX Correction pass — locked discovery hierarchy: Events
  // You Might Like leads, From Brands You Follow is prominent (before
  // Upcoming Events), then Places/Products/Brands You Might Like, then
  // the intent rail, Your Moments, Pages I Manage, Needs Attention, Inbox.
  // No Saved preview anywhere on this page any more.
  const order = [
    'id="events-you-might-like"',
    'id="from-brands"',
    'id="upcoming-events"',
    'id="places-you-might-like"',
    'id="products-you-might-like"',
    'id="brands-you-might-like"',
    'id="because-you"',
    'id="your-moments"',
    'id="pages-i-manage"',
    'id="needs-attention"',
    'id="inbox"',
  ];
  const at = order.map((id) => HOME.indexOf(id));
  assert.ok(at.every((i) => i > 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at, "rendered in the planned order");
  assert.doesNotMatch(HOME, /People You Might Like|Moments From People You Follow|title="My World"|title="Coming Up"|title="Managing"|title="Recent Moments"/);
  assert.doesNotMatch(HOME, /id="saved"/, "no Saved preview rail on Account Home");
  for (const cond of [
    "comingUpCards.length > 0",
    "brandTiles.length > 0",
    "eventsYouMightLike.length > 0",
    "placesYouMightLike.length > 0",
    "productTiles.length > 0",
    "brandsYouMightLike.length > 0",
    "intentItems.length > 0 && intentTitle",
    "momentTiles.length > 0",
    "managedEntities.length > 0",
  ]) {
    assert.ok(HOME.includes(`{${cond} && (`), cond);
  }
  // Upcoming Events' old "See All" → /account/following is gone.
  assert.doesNotMatch(HOME, /id="upcoming-events"[\s\S]{0,400}href="\/account\/following"/);
  assert.match(read("src/app/(public)/account/business/[id]/v2/Greeting.tsx"), /"Good Evening"/);
});

test("Upcoming Events 'See All' never links to the generic /account/following directory", () => {
  const section = HOME.slice(HOME.indexOf('id="upcoming-events"'), HOME.indexOf('id="places-you-might-like"'));
  assert.doesNotMatch(section, /\/account\/following/);
  assert.doesNotMatch(section, /linkLabel="See All"/, "removed for now rather than linked incorrectly — see page.tsx's own comment");
});

test("From Brands You Follow renders the real, truthful entity types only, via the shared filter component", () => {
  assert.match(HOME, /<FromBrandsSection tiles=\{brandTiles\} \/>/);
  const fb = read("src/app/(public)/account/FromBrandsSection.tsx");
  for (const kind of ["moment", "event", "product", "location"]) assert.match(fb, new RegExp(kind));
  assert.doesNotMatch(fb, /entity_type === "business"|kind === "business"/, "Brands themselves aren't a tab here — this rail is BY a followed Brand, not of Brands");
});

test("Your Moments uses the user's real entries; Pages I Manage uses real memberships", () => {
  assert.match(HOME, /getJournalArchiveEntries\(user\.id, \{ limit: MOMENTS_LIMIT \}\)/);
  assert.match(HOME, /imageUrl: m\.coverUrl,\s*\n\s*href: `\/journal\/\$\{m\.id\}`/);
  assert.match(HOME, /\.from\("business_members"\)\s*\.select\("business_id, businesses\(name, slug, publication_status, logo_url, cover_image_url\)"\)\s*\.eq\("user_id", user\.id\)/);
  assert.match(HOME, /<HomeSection id="pages-i-manage" title="Pages I Manage">/);
});

test("Account Home reads run in parallel batches (no per-rail waterfall)", () => {
  const batch = HOME.slice(HOME.indexOf("  const [\n    proBusinessIds,"), HOME.indexOf("const conversations = allConversations"));
  for (const call of ["runDiscovery(", "getMomentFeed(", "getFollowedBrandProducts(", "getProductsYouMightLike(", 'from("user_entity_relationships")', "getPersonalUpcoming(", "getJournalArchiveEntries("]) {
    assert.ok(batch.includes(call), call);
  }
  assert.match(batch, /await Promise\.all\(\[/);
});

// ── TERMINOLOGY / NAV / SWITCHER / ICONS ───────────────────────────────

test("consumer-facing My World / Your world / Journal strings targeted here are gone; My Moments works", () => {
  const shell = read("src/app/(public)/account/PersonalAppShell.tsx");
  assert.match(shell, /label: "My Moments", href: "\/my-world\/journal"/);
  assert.doesNotMatch(shell, /label: "My World"/);
  assert.doesNotMatch(read("src/lib/primary-nav.ts"), /label: "My World"/);
  assert.match(read("src/lib/primary-nav.ts"), /\{ href: "\/my-world\/journal", label: "My Moments", icon: "moments"/);
  const world = read("src/app/(public)/my-world/page.tsx");
  assert.doesNotMatch(world, />Your world<|>\s*Journal\s*</);
  const ev = read("src/app/(public)/event/[slug]/EventPublicView.tsx");
  assert.doesNotMatch(ev, /appear in your Journal|^\s*View Your Journal\s*$/m, "rendered copy (code comments may keep history)");
  assert.match(ev, /View My Moments/);
  assert.match(read("src/app/(public)/journal/page.tsx"), /heading: `\$\{name\}'s Moments`/);
  assert.doesNotMatch(HOME, /Start Your World/);
});

test("switcher: a quiet Switch label; rounded-square identity (no circular logos)", () => {
  const sw = read("src/components/account/AccountContextSwitcher.tsx");
  assert.match(sw, /\{trigger && <span>Switch<\/span>\}/);
  assert.doesNotMatch(sw, /h-8 w-8 shrink-0 rounded-full/);
  assert.doesNotMatch(read("src/app/(public)/account/PersonalAppShell.tsx"), /h-10 w-10 shrink-0 items-center justify-center rounded-full bg-findmi-50/);
});

test("icons: one shared storefront; a dedicated Moments icon; target keeps its Analytics meaning", () => {
  for (const f of ["src/components/EventBusinessRoster.tsx", "src/components/AppearanceCarousel.tsx", "src/components/discover/BusinessDiscoveryCard.tsx", "src/components/BusinessLogoCard.tsx", "src/app/embed/business/[slug]/BusinessEmbedWidget.tsx", "src/app/(public)/business/[slug]/BusinessPublicView.tsx"]) {
    assert.match(read(f), /function StorefrontGlyph\(\{ className \}: \{ className\?: string \}\) \{\n  return <NavIcon name="storefront" className=\{className\} \/>;\n\}/, f);
  }
  assert.match(read("src/components/PostCard.tsx"), /case "storefront":\n\s*return <NavIcon name="storefront" className=\{className\} \/>;/);
  const icon = read("src/components/NavIcon.tsx");
  assert.match(icon, /case "moments":/);
  assert.match(icon, /case "target":/, "target still exists for Performance / Analytics");
  assert.match(read("src/lib/navigation.ts"), /label: "Moments", href: "\/moments", external: false, icon: "moments"/);
  assert.match(read("src/app/(public)/account/business/[id]/v2/BusinessAppShell.tsx"), /InsightsGlyph/, "Performance uses the rounded insights-tile glyph");
});
