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

test("follow(): one tap, optimistic, explicit following:true, then the server's answer", async () => {
  const h = harness();
  assert.deepEqual(await h.t.follow(), { kind: "done", ok: true, following: true });
  assert.deepEqual(h.writes, [true]);
  assert.deepEqual(h.states, [true, true], "optimistic, then confirmed");
  assert.deepEqual(h.pendings, [true, false]);
});

test("follow(): optimistic state reverts on failure (null or a thrown write)", async () => {
  const h = harness({ write: async () => null });
  assert.deepEqual(await h.t.follow(), { kind: "done", ok: false, following: false });
  assert.deepEqual(h.states, [true, false], "flipped, then reverted");
  const thrown = harness({ write: async () => { throw new Error("network"); } });
  assert.equal((await thrown.t.follow()).ok, false);
  assert.equal(thrown.state, false);
});

test("unfollow(): NOT optimistic — state changes only after the server confirms; exactly one following:false", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const h = harness({ initial: true, write: async (d) => (await gate, d) });
  const p = h.t.unfollow();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.state, true, "still Following while the request is in flight");
  assert.deepEqual(h.states, []);
  release();
  assert.deepEqual(await p, { kind: "done", ok: true, following: false });
  assert.deepEqual(h.writes, [false]);
  assert.equal(h.state, false);
});

test("unfollow() failure keeps Following (no flicker)", async () => {
  const h = harness({ initial: true, write: async () => null });
  assert.deepEqual(await h.t.unfollow(), { kind: "done", ok: false, following: true });
  assert.equal(h.state, true);
  assert.deepEqual(h.states, [], "never set to Follow at any point");
});

test("duplicate/in-flight taps cannot race — extra taps are ignored, one write", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const h = harness({ write: async (d) => (await gate, d) });
  const first = h.t.follow();
  assert.deepEqual([await h.t.follow(), await h.t.unfollow()], [{ kind: "busy" }, { kind: "busy" }]);
  release();
  assert.deepEqual(await first, { kind: "done", ok: true, following: true });
  assert.deepEqual(h.writes, [true]);
  assert.equal(h.t.writes(), 1);
});

test("guests are handed back to the component (account prompt) — no write, no state change", async () => {
  const h = harness({ signedIn: false });
  assert.deepEqual(await h.t.follow(), { kind: "guest" });
  assert.deepEqual([h.writes, h.states], [[], []]);
});

test("early tap: a signed-in visitor tapping before the session check settles still gets the signed-in path", async () => {
  let resolveSession;
  const session = new Promise((r) => (resolveSession = r));
  const h = harness({ signedIn: () => session });
  const tap = h.t.follow();
  assert.deepEqual(await h.t.follow(), { kind: "busy" }, "no second path while resolving");
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

// ── Pending Follow across sign-up / log-in ────────────────────────────────

function memStorage() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const T0 = Date.parse("2026-10-12T12:00:00Z");
const H24 = 24 * 60 * 60 * 1000;

test("marker: device-bound, intent + kind + slug bound; claimed (removed) on match", () => {
  const s = memStorage();
  C.writePendingFollow(s, "business", "acme-beauty", T0);
  assert.deepEqual(JSON.parse(s.getItem(C.PENDING_FOLLOW_KEY)), { v: 1, intent: "follow", kind: "business", slug: "acme-beauty", at: T0 });
  assert.equal(C.takePendingFollow(s, "business", "acme-beauty", T0 + 1000), true);
  assert.equal(s.getItem(C.PENDING_FOLLOW_KEY), null, "removed once claimed");
  assert.equal(C.takePendingFollow(s, "business", "acme-beauty", T0 + 2000), false, "can't be claimed twice");
});

test("marker: 24-hour boundary — exactly 24 h is valid, one ms later is expired and cleared", () => {
  assert.equal(C.PENDING_FOLLOW_TTL_MS, H24);
  const ok = memStorage();
  C.writePendingFollow(ok, "event", "spring-market", T0);
  assert.equal(C.takePendingFollow(ok, "event", "spring-market", T0 + H24), true);
  const late = memStorage();
  C.writePendingFollow(late, "event", "spring-market", T0);
  assert.equal(C.takePendingFollow(late, "event", "spring-market", T0 + H24 + 1), false);
  assert.equal(late.getItem(C.PENDING_FOLLOW_KEY), null, "expired marker cleared");
  const future = memStorage();
  C.writePendingFollow(future, "event", "spring-market", T0 + 60 * 60 * 1000);
  assert.equal(C.takePendingFollow(future, "event", "spring-market", T0), false, "a marker from the future is invalid");
});

test("marker: mismatched entity cannot create a Follow (and is left for its own control)", () => {
  const s = memStorage();
  C.writePendingFollow(s, "business", "acme-beauty", T0);
  assert.equal(C.takePendingFollow(s, "business", "other-brand", T0 + 1), false);
  assert.equal(C.takePendingFollow(s, "location", "acme-beauty", T0 + 1), false, "kind must match too");
  assert.notEqual(s.getItem(C.PENDING_FOLLOW_KEY), null);
  assert.equal(C.takePendingFollow(s, "business", "acme-beauty", T0 + 2), true);
});

test("marker: malformed or wrong-intent markers are ignored and cleared; missing storage never throws", () => {
  for (const raw of ["not json", "{}", JSON.stringify({ v: 1, intent: "save", kind: "business", slug: "a", at: T0 }), JSON.stringify({ v: 1, intent: "follow", kind: "product", slug: "a", at: T0 }), JSON.stringify({ v: 1, intent: "follow", kind: "business", slug: "", at: T0 })]) {
    const s = memStorage();
    s.setItem(C.PENDING_FOLLOW_KEY, raw);
    assert.equal(C.takePendingFollow(s, "business", "a", T0), false, raw);
    assert.equal(s.getItem(C.PENDING_FOLLOW_KEY), null, raw);
  }
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.doesNotThrow(() => C.writePendingFollow(broken, "business", "a", T0));
  assert.equal(C.takePendingFollow(broken, "business", "a", T0), false);
});

test("crafted ?follow=1 without a marker cannot create a Follow", () => {
  assert.equal(C.hasFollowResume("?follow=1"), true);
  assert.equal(C.takePendingFollow(memStorage(), "business", "acme-beauty", T0), false);
});

test("return URL: path + legitimate query + follow=1, accepted by the existing safe-redirect", async () => {
  const { getSafeRedirect } = await import("../src/lib/auth/safe-redirect.ts");
  const next = C.followResumeNext("/event/spring-market", "?occurrence=abc&ref=home");
  assert.equal(next, "/event/spring-market?occurrence=abc&ref=home&follow=1");
  assert.equal(getSafeRedirect(next), next);
  assert.equal(C.followResumeNext("/business/acme", ""), "/business/acme?follow=1");
  assert.deepEqual(C.accountEntryHrefs(next), {
    signup: `/signup?next=${encodeURIComponent(next)}`,
    login: `/login?next=${encodeURIComponent(next)}`,
  });
});

test("URL cleanup removes only the resume parameter, preserving unrelated params and hash", () => {
  assert.equal(C.withoutFollowResume("/event/x", "?occurrence=abc&follow=1&ref=home", "#hours"), "/event/x?occurrence=abc&ref=home#hours");
  assert.equal(C.withoutFollowResume("/business/x", "?follow=1", ""), "/business/x");
  assert.equal(C.withoutFollowResume("/business/x", "?ref=home", ""), null, "nothing to clean");
});

/** Simulates the hook's resume step exactly as written (claim → clean URL
 * → at most one follow), against the real controller. */
async function resume({ signedIn, marker, search, kind = "business", slug = "acme-beauty", serverFollowing = false, write }) {
  const s = memStorage();
  if (marker) C.writePendingFollow(s, marker.kind, marker.slug, marker.at);
  let url = `/business/${slug}${search}`;
  const h = harness({ signedIn, initial: serverFollowing, write });
  if (!signedIn || !C.hasFollowResume(search)) return { writes: h.writes, url, storage: s };
  const claimed = C.takePendingFollow(s, kind, slug, T0 + 1000);
  url = C.withoutFollowResume(`/business/${slug}`, search, "") ?? url;
  if (claimed && !h.state) await h.t.follow();
  return { writes: h.writes, url, storage: s, state: h.state };
}

test("successful resume creates exactly one Follow, clears the marker and cleans the URL", async () => {
  const r = await resume({ signedIn: true, marker: { kind: "business", slug: "acme-beauty", at: T0 }, search: "?ref=home&follow=1" });
  assert.deepEqual(r.writes, [true]);
  assert.equal(r.state, true);
  assert.equal(r.url, "/business/acme-beauty?ref=home");
  assert.equal(r.storage.getItem(C.PENDING_FOLLOW_KEY), null);
});

test("resume never writes without the marker, for a mismatched entity, when signed out, or when already following", async () => {
  assert.deepEqual((await resume({ signedIn: true, marker: null, search: "?follow=1" })).writes, [], "crafted link");
  assert.deepEqual((await resume({ signedIn: true, marker: { kind: "business", slug: "other", at: T0 }, search: "?follow=1" })).writes, [], "mismatch");
  assert.deepEqual((await resume({ signedIn: false, marker: { kind: "business", slug: "acme-beauty", at: T0 }, search: "?follow=1" })).writes, [], "useless without a session");
  assert.deepEqual((await resume({ signedIn: true, marker: { kind: "business", slug: "acme-beauty", at: T0 - H24 - 5000 }, search: "?follow=1" })).writes, [], "expired");
  assert.deepEqual((await resume({ signedIn: true, marker: { kind: "business", slug: "acme-beauty", at: T0 }, search: "?follow=1", serverFollowing: true })).writes, [], "already following");
});

test("failed automatic completion does not loop: one attempt, marker gone, URL clean, Follow still available", async () => {
  let attempts = 0;
  const r = await resume({ signedIn: true, marker: { kind: "business", slug: "acme-beauty", at: T0 }, search: "?follow=1", write: async () => (attempts++, null) });
  assert.equal(attempts, 1);
  assert.equal(r.state, false, "reverted to Follow");
  assert.equal(r.storage.getItem(C.PENDING_FOLLOW_KEY), null, "nothing left to retry");
  assert.equal(r.url, "/business/acme-beauty", "no follow=1 left to retrigger");
});

test("hook wires the resume exactly that way (claim before the single attempt, URL cleaned, no retry)", () => {
  const src = code("src/lib/useAccountFollow.ts");
  assert.match(src, /const resume = typeof window !== "undefined" && hasFollowResume\(window\.location\.search\);/, "captured at mount");
  assert.match(src, /if \(cancelled \|\| !isAuthed\) return;/, "signed-in only");
  assert.match(src, /claimed = takePendingFollow\(window\.localStorage, kind, slug, Date\.now\(\)\);/);
  assert.match(src, /window\.history\.replaceState\(window\.history\.state, "", clean\)/);
  assert.match(src, /if \(claimed && !followingRef\.current\) await controller\(\)\.follow\(\);/);
  assert.equal((src.match(/\.follow\(\)/g) ?? []).length, 2, "resume + the tap — no retry loop");
  assert.match(src, /controller\(\)\.writes\(\) === writesAtStart/, "late initial read never overwrites a tap");
});

// ── Copy ──────────────────────────────────────────────────────────────────

test("unfollow confirmation copy — approved, entity-aware, no notification promises", () => {
  assert.deepEqual(C.unfollowConfirmCopy("business", "Acme"), {
    title: "Unfollow Acme?",
    message: "Acme will be removed from your Following list, and its upcoming appearances won't show in your Findmi schedule.",
  });
  assert.equal(C.unfollowConfirmCopy("location", "The Hall").message, "The Hall will be removed from your Following list, and what's happening there won't show in your Findmi schedule.");
  assert.equal(C.unfollowConfirmCopy("event", "Spring Market").message, "Spring Market will be removed from your Following list, and its dates won't show in your Findmi schedule.");
  for (const k of ["business", "location", "event"]) assert.doesNotMatch(C.unfollowConfirmCopy(k, "X").message, /notif|alert|email|update/i);
  assert.equal(C.UNFOLLOW_FAILED_MESSAGE, "Couldn't unfollow. Please try again.");
});

test("account prompt copy — follow and legacy-device variants", () => {
  assert.deepEqual(C.followPromptCopy("follow", "Acme"), {
    title: "Follow Acme on Findmi",
    body: "Create a free Findmi account to follow the brands, places and events you care about and keep your discoveries together.",
  });
  const legacy = C.followPromptCopy("legacy", "Acme");
  assert.match(legacy.body, /manage/);
  assert.match(legacy.body, /account/);
  assert.doesNotMatch(`${legacy.title} ${legacy.body}`, /notif|save/i, "never blurs Follow with Save");
});

// ── Components ────────────────────────────────────────────────────────────

const COMPONENTS = [
  ["business", "src/components/FollowButton.tsx", "/api/follow"],
  ["event", "src/components/EventFollowButton.tsx", "/api/follow-event"],
  ["location", "src/components/LocationFollowButton.tsx", "/api/follow-location"],
];
const CONTROL = "src/components/useFollowControl.tsx";

for (const [kind, file, guestRoute] of COMPONENTS) {
  test(`${kind}: one shared control; guest Follow opens the account prompt, never an email form`, () => {
    const src = code(file);
    assert.match(src, new RegExp(`useFollowControl\\(\\{\\s*kind: "${kind}",`));
    assert.match(src, /<button\s+\{\.\.\.buttonProps\}/);
    assert.match(src, /\{overlays\}/);
    assert.doesNotMatch(src, /type="email"|Email address|handleSubmit|createPortal|<form/, "email form removed");
    assert.doesNotMatch(src, new RegExp(`fetch\\("${guestRoute}"`), "guest email API no longer called");
    assert.doesNotMatch(src, /role="status"/, "no dead read-only chip");
    assert.doesNotMatch(src, />\s*Unfollow\s*</, "no separate Unfollow control");
  });
}

test("shared control: guest → prompt; legacy guest Following → prompt; signed-in Following → confirmation (no write)", () => {
  const src = code(CONTROL);
  const click = src.slice(src.indexOf("async function onClick()"), src.indexOf("const closePrompt"));
  assert.match(click, /if \(following\) \{\s*if \(await isSignedIn\(\)\) \{\s*setConfirmError\(null\);\s*setConfirming\(true\);\s*\} else \{\s*setPrompt\("legacy"\);/);
  assert.doesNotMatch(click.slice(0, click.indexOf("const result")), /unfollow\(|fetch\(/, "opening the confirmation writes nothing");
  assert.match(click, /const result = await follow\(\);\s*if \(result\.kind === "guest"\) setPrompt\("follow"\);/);
});

test("shared control: Keep Following writes nothing; Unfollow sends one following:false; failure keeps dialog + Following", () => {
  const src = code(CONTROL);
  const cancel = src.slice(src.indexOf("const cancelConfirm"), src.indexOf("async function confirmUnfollow"));
  assert.doesNotMatch(cancel, /unfollow|fetch|follow\(/, "Keep Following = zero writes");
  assert.match(cancel, /buttonRef\.current\?\.focus\(\);/, "focus returns to the control");
  const confirm = src.slice(src.indexOf("async function confirmUnfollow"), src.indexOf("const copy ="));
  assert.equal((confirm.match(/unfollow\(\)/g) ?? []).length, 1);
  assert.match(confirm, /if \(result\.kind === "done" && result\.ok && !result\.following\) \{\s*setConfirming\(false\);\s*track\("unfollow"\);\s*refocus\(\);\s*return;\s*\}\s*setConfirmError\(UNFOLLOW_FAILED_MESSAGE\);/);
  assert.match(src, /cancelLabel="Keep Following"\s+confirmLabel="Unfollow"/);
  assert.match(src, /const closePrompt = useCallback\(\(\) => \{\s*setPrompt\(null\);\s*buttonRef\.current\?\.focus\(\);/, "prompt close returns focus");
});

test("compact Following ✓ stays an accessible button with the same footprint", () => {
  const src = code(CONTROL);
  assert.match(src, /"aria-label": following \? \(legacyGuest \? `Following \$\{name\}: log in to manage` : `Unfollow \$\{name\}`\) : undefined/);
  const biz = code("src/components/FollowButton.tsx");
  assert.match(biz, /\? `flex \$\{h\} w-9 shrink-0 items-center justify-center rounded-lg bg-findmi text-white transition hover:bg-findmi-600`/);
  assert.match(biz, /\{!compact && "Following"\}/);
  const loc = code("src/components/LocationFollowButton.tsx");
  assert.match(loc, /: `flex \$\{h\} w-9 shrink-0 items-center justify-center rounded-lg transition \$\{followingTone\}`/);
});

test("prompt: existing /signup and /login with safe next; marker written only for a Follow, only on choosing an account action", () => {
  const src = code("src/components/FollowSignInPrompt.tsx");
  assert.match(src, /const next = variant === "follow" \? followResumeNext\(pathname, search\) : `\$\{pathname\}\$\{search\}`;/);
  assert.match(src, /function rememberIntent\(\) \{\s*if \(variant !== "follow"\) return;/, "legacy prompt migrates/writes nothing");
  assert.match(src, /href=\{hrefs\.signup\}\s+onClick=\{rememberIntent\}/);
  assert.match(src, /href=\{hrefs\.login\} onClick=\{rememberIntent\}/);
  assert.match(src, />\s*Create Free Account\s*</);
  assert.match(src, /Already have an account\?\{" "\}/);
  assert.match(src, />\s*Not Now\s*</);
  assert.doesNotMatch(src, /fetch\(|type="email"/);
});

test("ConfirmDialog: the one confirmation primitive — safe-action focus, Escape/backdrop cancel, focus trap, inline error", () => {
  const src = code("src/components/ConfirmDialog.tsx");
  assert.match(src, /role="alertdialog"/);
  assert.match(src, /cancelRef\.current\?\.focus\(\);/);
  assert.match(src, /if \(e\.key === "Escape"\) onCancel\(\);/);
  assert.match(src, /onClick=\{onCancel\} aria-hidden="true"/);
  assert.match(src, /\{error && \(\s*<p role="alert"/);
});

test("SignOutConfirm has no regression — same copy and labels through the shared dialog", () => {
  const src = code("src/components/SignOutConfirm.tsx");
  assert.match(src, /import ConfirmDialog from "\.\/ConfirmDialog";/);
  assert.match(src, /title="Sign out\?"\s+message="Are you sure you want to sign out of Findmi\?"\s+cancelLabel="Cancel"\s+confirmLabel="Sign Out"\s+pendingLabel="Signing Out…"/);
  assert.match(src, /onCancel=\{close\}\s+onConfirm=\{confirmSignOut\}/);
  assert.match(src, /function close\(\) \{\s*setOpen\(false\);\s*triggerRef\.current\?\.focus\(\);/);
  assert.match(src, /await action\(\);/);
  // Dialog look unchanged.
  const dialog = code("src/components/ConfirmDialog.tsx");
  for (const cls of [
    "relative w-full max-w-xs rounded-3xl border border-black/5 bg-white p-5 shadow-xl",
    "rounded-full border border-black/10 px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-black/[0.03] disabled:opacity-60",
    "rounded-full border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-60",
    "fixed inset-0 z-[70] flex items-center justify-center p-4",
  ]) assert.ok(dialog.includes(cls), cls);
});

test("account Following ×: confirmation first; Unfollow sends following:false; failure keeps dialog and card", () => {
  const src = code("src/app/(public)/account/following/FollowingUnfollowButton.tsx");
  const trigger = src.slice(src.indexOf("onClick={() => {"), src.indexOf("className=\"absolute"));
  assert.match(trigger, /setConfirming\(true\);/);
  assert.doesNotMatch(trigger, /fetch/, "the × itself writes nothing");
  assert.match(src, /body: JSON\.stringify\(\{ slug, following: false \}\)/);
  assert.doesNotMatch(src, /JSON\.stringify\(\{ slug \}\)/);
  assert.match(src, /if \(!ok\) \{\s*setError\(UNFOLLOW_FAILED_MESSAGE\);\s*return;\s*\}/);
  assert.match(src, /cancelLabel="Keep Following"\s+confirmLabel="Unfollow"/);
  const cancel = src.slice(src.indexOf("const cancel = useCallback"), src.indexOf("async function confirmUnfollow"));
  assert.doesNotMatch(cancel, /fetch/);
  assert.match(cancel, /triggerRef\.current\?\.focus\(\);/);
  const page = read("src/app/(public)/account/following/page.tsx");
  for (const k of ["business", "event", "location"]) assert.match(page, new RegExp(`<FollowingUnfollowButton kind="${k}" slug=\\{\\w\\.slug\\} name=\\{\\w\\.name\\} />`), k);
});

test("legacy guest infrastructure stays dormant, not deleted", () => {
  for (const f of ["src/app/api/follow/route.ts", "src/app/api/follow-event/route.ts", "src/app/api/follow-location/route.ts", "src/lib/followed.ts", "src/lib/followedEvents.ts", "src/lib/followedLocations.ts", "src/lib/accountSync.ts"]) {
    assert.ok(read(f).length > 0, f);
  }
  assert.match(read("src/lib/accountSync.ts"), /followedBusinessSlugs/, "sign-in sync still carries legacy device follows");
});

test("Saved behavior untouched — Saved code never uses the Follow modules", () => {
  for (const f of ["src/lib/saved.ts", "src/app/api/account/save/route.ts", "src/app/api/saved/route.ts", "src/components/SaveButton.tsx", "src/components/EventSaveButton.tsx", "src/components/LocationSaveButton.tsx"]) {
    assert.doesNotMatch(read(f), /useAccountFollow|useFollowControl|account-follow-(client|server)|account_followed_|FollowSignInPrompt/, f);
  }
  // Personal Library pass: the ONE library page shows a Following filter —
  // it only READS the follow tables, never writes them or uses Follow UI.
  const library = read("src/app/(public)/account/saved/page.tsx");
  assert.doesNotMatch(library, /useAccountFollow|useFollowControl|account-follow-(client|server)|FollowSignInPrompt/);
  assert.doesNotMatch(library, /account_followed_\w+"\)\.(insert|update|delete|upsert)/);
  assert.match(library, /from\("account_followed_businesses"\)\.select\("business_id"\)/);
});
