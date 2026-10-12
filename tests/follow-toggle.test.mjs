// Follow / Following / Unfollow — signed-in Follow as one stateful control
// for Businesses, Events and Locations. The route core and the client
// toggle controller are tested directly (in-memory stores, stub fetch);
// the components and the account Following page are checked statically.
// No network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/server") return { url: "data:text/javascript,export const NextResponse={json:(b,i)=>({body:b,status:i?.status??200})}", shortCircuit: true };
    if (specifier === "@/lib/supabase/server") return { url: "data:text/javascript,export const getServerSupabase=async()=>{throw new Error('not in tests')}", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const S = await import("../src/lib/account-follow-server.ts");
const C = await import("../src/lib/account-follow-client.ts");
const read = (p) => readFileSync(p, "utf8");
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

/** In-memory follow rows for one (user, entity), with failure switches. */
function memoryStore({ following = false, failInsert = false, failRemove = false, failRead = false, raceDuplicate = false } = {}) {
  const s = { rows: following ? 1 : 0, inserts: 0, removes: 0 };
  return {
    s,
    async isFollowing() {
      if (failRead) throw new Error("read");
      return s.rows > 0;
    },
    async insert() {
      s.inserts += 1;
      if (failInsert) return "error";
      if (s.rows > 0 || raceDuplicate) {
        s.rows = 1;
        return "duplicate";
      }
      s.rows = 1;
      return "ok";
    },
    async remove() {
      s.removes += 1;
      if (failRemove) return "error";
      s.rows = 0;
      return "ok";
    },
  };
}

// ── Route core ────────────────────────────────────────────────────────────

test("explicit following:true is idempotent — never a second row, existing follow is success", async () => {
  const store = memoryStore();
  assert.deepEqual(await S.applyAccountFollow(store, true), { ok: true, following: true });
  assert.deepEqual(await S.applyAccountFollow(store, true), { ok: true, following: true });
  assert.equal(store.s.rows, 1);
  // A concurrent insert (unique violation) is the Following state, not a failure.
  assert.deepEqual(await S.applyAccountFollow(memoryStore({ raceDuplicate: true }), true), { ok: true, following: true });
});

test("explicit following:false is idempotent — removing an absent follow is success", async () => {
  const store = memoryStore({ following: true });
  assert.deepEqual(await S.applyAccountFollow(store, false), { ok: true, following: false });
  assert.deepEqual(await S.applyAccountFollow(store, false), { ok: true, following: false });
  assert.equal(store.s.rows, 0);
  assert.deepEqual(await S.applyAccountFollow(memoryStore(), false), { ok: true, following: false }, "stale remove never re-follows");
});

test("legacy omitted field still toggles (backward compatibility)", async () => {
  const store = memoryStore();
  assert.deepEqual(await S.applyAccountFollow(store, undefined), { ok: true, following: true });
  assert.deepEqual(await S.applyAccountFollow(store, undefined), { ok: true, following: false });
  assert.equal(store.s.rows, 0);
});

test("write failures return errors — never a state that didn't happen", async () => {
  assert.deepEqual(await S.applyAccountFollow(memoryStore({ failInsert: true }), true), { ok: false });
  assert.deepEqual(await S.applyAccountFollow(memoryStore({ following: true, failRemove: true }), false), { ok: false });
  assert.deepEqual(await S.applyAccountFollow(memoryStore({ failRead: true }), undefined), { ok: false });
});

test("the desired-state field must be a real boolean; absent means legacy toggle", () => {
  assert.deepEqual(S.parseFollowingField({ slug: "x" }), { ok: true, desired: undefined });
  assert.deepEqual(S.parseFollowingField({ slug: "x", following: true }), { ok: true, desired: true });
  assert.deepEqual(S.parseFollowingField({ slug: "x", following: false }), { ok: true, desired: false });
  for (const bad of ["false", 0, 1, null, "true", {}]) assert.deepEqual(S.parseFollowingField({ following: bad }), { ok: false }, String(bad));
});

test("routes: identity from the session only; writes scoped to (user, entity); errors surface as 500", () => {
  const src = code("src/lib/account-follow-server.ts");
  assert.match(src, /supabase\.auth\.getUser\(\)/);
  assert.match(src, /if \(!user\) return NextResponse\.json\(\{ error: "Not signed in\." \}, \{ status: 401 \}\)/);
  assert.doesNotMatch(src, /body\??\.user_?[iI]d|user_id: body/);
  assert.match(src, /\.insert\(\{ user_id: user\.id, \[target\.column\]: entityId \}\)/);
  assert.match(src, /\.delete\(\)\.eq\("user_id", user\.id\)\.eq\(target\.column, entityId\)/);
  assert.match(src, /code === "23505" \? "duplicate" : "error"/);
  assert.match(src, /status: 500/);
  assert.match(src, /import \{ getServerSupabase \} from "@\/lib\/supabase\/server"/, "session client (own-row RLS), never the service role");
  assert.doesNotMatch(src, /getAdminSupabase|SERVICE_ROLE/);
  for (const [route, table, column] of [
    ["follow", "account_followed_businesses", "business_id"],
    ["follow-event", "account_followed_events", "event_id"],
    ["follow-location", "account_followed_locations", "location_id"],
  ]) {
    const r = code(`src/app/api/account/${route}/route.ts`);
    assert.match(r, new RegExp(`export async function POST\\(request: NextRequest\\) \\{\\s*return accountFollowPost\\(request, \\{ entityTable: "\\w+", followTable: "${table}", column: "${column}" \\}\\);`), route);
    assert.match(r, /export async function GET\(/, `${route} GET unchanged`);
  }
});

// ── Client controller ────────────────────────────────────────────────────

function harness({ signedIn = true, write, initial = false } = {}) {
  let state = initial;
  const states = [];
  const pendings = [];
  const writes = [];
  const t = C.createFollowToggle({
    isSignedIn: typeof signedIn === "function" ? signedIn : async () => signedIn,
    write: async (desired) => (writes.push(desired), write ? write(desired) : desired),
    get: () => state,
    set: (v) => (state = v, states.push(v)),
    setPending: (p) => pendings.push(p),
  });
  return { t, states, pendings, writes, get state() { return state; } };
}

test("optimistic flip, then the server's answer; explicit desired state is sent", async () => {
  const h = harness();
  assert.deepEqual(await h.t.toggle(), { kind: "done", ok: true, following: true });
  assert.deepEqual(h.writes, [true]);
  assert.deepEqual(h.states, [true, true], "optimistic, then confirmed");
  assert.deepEqual(await h.t.toggle(), { kind: "done", ok: true, following: false });
  assert.deepEqual(h.writes, [true, false]);
  assert.deepEqual(h.pendings, [true, false, true, false]);
});

test("optimistic state reverts on failure (null or a thrown write)", async () => {
  const h = harness({ write: async () => null, initial: true });
  assert.deepEqual(await h.t.toggle(), { kind: "done", ok: false, following: true });
  assert.deepEqual(h.states, [false, true], "flipped, then reverted");
  const thrown = harness({ write: async () => { throw new Error("network"); } });
  assert.equal((await thrown.t.toggle()).ok, false);
  assert.equal(thrown.state, false);
});

test("duplicate/in-flight taps cannot race — extra taps are ignored, one write", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const h = harness({ write: async (d) => (await gate, d) });
  const first = h.t.toggle();
  const second = await h.t.toggle();
  const third = await h.t.toggle();
  assert.deepEqual([second, third], [{ kind: "busy" }, { kind: "busy" }]);
  release();
  assert.deepEqual(await first, { kind: "done", ok: true, following: true });
  assert.deepEqual(h.writes, [true]);
  assert.equal(h.t.writes(), 1);
});

test("guests are handed back to the component (email flow) — no write, no state change", async () => {
  const h = harness({ signedIn: false });
  assert.deepEqual(await h.t.toggle(), { kind: "guest" });
  assert.deepEqual([h.writes, h.states], [[], []]);
});

test("early tap: a signed-in visitor tapping before the session check settles still gets the signed-in path", async () => {
  let resolveSession;
  const session = new Promise((r) => (resolveSession = r));
  const h = harness({ signedIn: () => session });
  const tap = h.t.toggle();
  assert.deepEqual(await h.t.toggle(), { kind: "busy" }, "no second path while resolving");
  resolveSession(true);
  assert.deepEqual(await tap, { kind: "done", ok: true, following: true });
  assert.deepEqual(h.writes, [true]);
});

test("writeAccountFollow posts { slug, following } and maps failures to null", async () => {
  const calls = [];
  const ok = async (url, init) => (calls.push([url, JSON.parse(init.body)]), { ok: true, json: async () => ({ following: false }) });
  assert.equal(await C.writeAccountFollow("location", "venue-1", false, ok), false);
  assert.deepEqual(calls, [["/api/account/follow-location", { slug: "venue-1", following: false }]]);
  assert.equal(await C.writeAccountFollow("business", "b", true, async () => ({ ok: false, json: async () => ({}) })), null);
  assert.equal(await C.writeAccountFollow("event", "e", true, async () => ({ ok: true, json: async () => ({}) })), null, "malformed answer");
  assert.equal(await C.writeAccountFollow("event", "e", true, async () => { throw new Error("offline"); }), null);
  assert.deepEqual(C.ACCOUNT_FOLLOW_ENDPOINT, { business: "/api/account/follow", event: "/api/account/follow-event", location: "/api/account/follow-location" });
});

// ── Components ────────────────────────────────────────────────────────────

const COMPONENTS = [
  ["business", "src/components/FollowButton.tsx", "businessName", "/api/follow"],
  ["event", "src/components/EventFollowButton.tsx", "eventName", "/api/follow-event"],
  ["location", "src/components/LocationFollowButton.tsx", "locationName", "/api/follow-location"],
];

for (const [kind, file, nameProp, guestRoute] of COMPONENTS) {
  test(`${kind}: authenticated Following is the same interactive control (tap to unfollow)`, () => {
    const src = code(file);
    assert.match(src, new RegExp(`useAccountFollow\\("${kind}", `));
    assert.doesNotMatch(src, /getAccountSession|handleAuthedFollow|setFollowing\(/, "no private signed-in logic left");
    // The one button: both states, one onClick, aria-pressed reflects state.
    assert.match(src, /<button\s+ref=\{buttonRef\}\s+type="button"\s+onClick=\{handleTap\}\s+aria-pressed=\{authed \? following : undefined\}/);
    assert.match(src, new RegExp("aria-label=\\{following \\? `Unfollow \\$\\{" + nameProp + "\\}` : undefined\\}"));
    assert.match(src, /if \(result\.kind === "guest"\) \{\s*openModal\(\);/);
    // No separate Unfollow control.
    assert.doesNotMatch(src, />\s*Unfollow\s*</);
  });

  test(`${kind}: guest Following stays non-interactive; guest email flow unchanged`, () => {
    const src = code(file);
    assert.match(src, /if \(following && !authed( && action)?\) \{\s*return \(\s*<span\s+role="status"/);
    assert.match(src, new RegExp(`fetch\\("${guestRoute}", \\{`));
    assert.match(src, /markGuestFollowing\(\);/);
  });
}

test("compact Following check is interactive and accessible (Business + Location), footprint preserved", () => {
  const biz = code("src/components/FollowButton.tsx");
  assert.match(biz, /\? `flex \$\{h\} w-9 shrink-0 items-center justify-center rounded-lg bg-findmi text-white transition hover:bg-findmi-600`/, "same w-9 square");
  assert.match(biz, /\{!compact && "Following"\}/, "check-only when compact");
  const loc = code("src/components/LocationFollowButton.tsx");
  assert.match(loc, /: `flex \$\{h\} w-9 shrink-0 items-center justify-center rounded-lg transition \$\{/, "same w-9 square");
  assert.match(loc, /action \? \(\s*<>\s*<CheckGlyph className="hidden h-3\.5 w-3\.5 shrink-0 min-\[375px\]:block" \/>\s*Following\s*<\/>\s*\) : \(\s*<CheckGlyph className="h-4 w-4" \/>/);
  // Cards still render the compact variants.
  assert.match(read("src/components/BusinessLogoCard.tsx"), /<FollowButton businessId=\{business\.id\} businessSlug=\{business\.slug\} businessName=\{business\.name\} size="compact" \/>/);
  assert.match(read("src/components/discover/FeaturedLocationCard.tsx"), /<LocationFollowButton locationId=\{location\.id\} locationSlug=\{location\.slug\} locationName=\{location\.name\} size="compact" \/>/);
});

test("shared hook: resolves auth + server state, never lets a late initial read overwrite a tap", () => {
  const src = code("src/lib/useAccountFollow.ts");
  assert.match(src, /^"use client";/);
  assert.match(src, /getAccountSession\(\)\.then\(\(isAuthed\) =>/);
  assert.match(src, /controller\(\)\.writes\(\) === writesAtStart/);
  assert.match(src, /if \(controllerRef\.current === null\) \{\s*controllerRef\.current = createFollowToggle\(/, "one controller per control");
});

test("account Following × sends following:false (never toggle) and hides only on success", () => {
  const src = code("src/app/(public)/account/following/FollowingUnfollowButton.tsx");
  assert.match(src, /body: JSON\.stringify\(\{ slug, following: false \}\)/);
  assert.doesNotMatch(src, /JSON\.stringify\(\{ slug \}\)/);
  assert.match(src, /if \(!res\.ok\) return;/);
  assert.match(src, /aria-label=\{`Unfollow \$\{name\}`\}/);
  const page = read("src/app/(public)/account/following/page.tsx");
  for (const k of ["business", "event", "location"]) assert.match(page, new RegExp(`<FollowingUnfollowButton kind="${k}" slug=\\{\\w\\.slug\\} name=\\{\\w\\.name\\} />`), k);
});

test("Saved behavior untouched — Saved code never uses the Follow modules", () => {
  for (const f of ["src/lib/saved.ts", "src/app/api/account/save/route.ts", "src/app/api/saved/route.ts", "src/components/EventSaveButton.tsx", "src/app/(public)/account/saved/page.tsx"]) {
    assert.doesNotMatch(read(f), /useAccountFollow|account-follow-(client|server)|account_followed_/, f);
  }
});
