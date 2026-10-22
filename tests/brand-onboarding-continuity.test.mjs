// VCL A1 — Brand onboarding continuity + auth resume. The visitor gives the
// website once and presses Build My Brand Profile once: a guest signs in /
// signs up and the SAME Build resumes automatically (once) into Review Your
// Brand. Behavioral checks on the real helpers (safe redirect, resume
// hrefs, round trip through the login/signup/callback `next` handling) plus
// source guards on the page wiring (no rendering harness). No network/DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "next/headers") return { url: "data:text/javascript,export const headers=async()=>new Map()", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const B = await import("../src/lib/brand-lookup.ts");
const { getSafeRedirect } = await import("../src/lib/auth/safe-redirect.ts");

const read = (p) => readFileSync(p, "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const PAGE = code(read("src/app/(public)/join/brand/page.tsx"));
const AUTO = code(read("src/app/(public)/join/brand/AutoBuild.tsx"));
const ACTION = read("src/app/(public)/join/brand/actions.ts");
const LOGIN = read("src/app/(public)/login/page.tsx");
const SIGNUP_FORM = read("src/app/(public)/signup/SignupForm.tsx");
const SIGNUP_ACTIONS = read("src/app/(public)/signup/actions.ts");
const CALLBACK = read("src/app/auth/callback/route.ts");
const CREATE = read("src/app/(public)/account/business/actions.ts");
const nextOf = (href) => new URL(href, "https://findmi.app").searchParams.get("next");

// ── Safe redirect: hostile inputs ────────────────────────────────────────
test("getSafeRedirect: keeps same-origin relative paths (with query) and rejects every off-site form", () => {
  assert.equal(getSafeRedirect("/account"), "/account");
  assert.equal(getSafeRedirect("/join/brand?q=spotify.com&as=website&seed_name=Spotify&build=1"), "/join/brand?q=spotify.com&as=website&seed_name=Spotify&build=1");
  for (const hostile of [
    "https://evil.example/x",
    "http://evil.example",
    "//evil.example/path",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "data:text/html,hi",
    "evil.example/path",
    " //evil.example",
    "",
    null,
    undefined,
  ]) {
    assert.equal(getSafeRedirect(hostile), "/account", String(hostile));
  }
});

// ── Build intent survives sign-in / sign-up ──────────────────────────────
test("guest Build: one explicit build intent marker on the SAME website no-match result, seed kept", () => {
  const resume = B.brandBuildResumeHref("spotify.com", { name: "Spotify" });
  assert.equal(resume, "/join/brand?q=spotify.com&as=website&seed_name=Spotify&build=1");
  const signIn = B.brandBuildSignInHref("spotify.com", { name: "Spotify" });
  assert.ok(signIn.startsWith("/login?next="));
  assert.equal(nextOf(signIn), resume);
  const p = new URL(resume, "https://findmi.app").searchParams;
  assert.deepEqual([p.get("q"), p.get("as"), p.get("seed_name"), p.get(B.BRAND_BUILD_RESUME_PARAM)], ["spotify.com", "website", "Spotify", "1"]);
  // Instagram seed (when the visitor started from a handle) rides along too.
  assert.equal(nextOf(B.brandBuildSignInHref("spotify.com", { instagram: "spotify" })), "/join/brand?q=spotify.com&as=website&seed_instagram=spotify&build=1");
});

test("the resume target survives every auth hop unchanged (login → sign up → email-confirmation callback)", () => {
  const resume = B.brandBuildResumeHref("spotify.com", { name: "Spotify" });
  // Each hop re-validates `next` through getSafeRedirect — which must pass it through intact.
  assert.equal(getSafeRedirect(nextOf(B.brandBuildSignInHref("spotify.com", { name: "Spotify" }))), resume);
  assert.match(LOGIN, /const safeNext = getSafeRedirect\(next\);/);
  assert.match(LOGIN, /<input type="hidden" name="next" value=\{safeNext\} \/>/, "Sign In posts it");
  assert.match(LOGIN, /href=\{`\/signup\?next=\$\{encodeURIComponent\(safeNext\)\}`\}/, "Sign Up link carries it");
  assert.match(SIGNUP_FORM, /<input type="hidden" name="next" value=\{next\} \/>/);
  assert.match(SIGNUP_ACTIONS, /const next = getSafeRedirect\(String\(formData\.get\("next"\) \?\? ""\)\);/);
  assert.match(SIGNUP_ACTIONS, /emailRedirectTo: confirmationRedirectUrl\(next\)/, "email confirmation link returns to it");
  assert.match(CALLBACK, /const next = getSafeRedirect\(url\.searchParams\.get\("next"\)\);/);
  // Encoding the resume target for a confirmation URL and reading it back is lossless.
  const confirmation = new URL(`/auth/callback?next=${encodeURIComponent(resume)}&type=signup`, "https://findmi.app");
  assert.equal(getSafeRedirect(confirmation.searchParams.get("next")), resume);
});

test("the server's own auth_required path uses the same resume target", () => {
  const analysis = read("src/lib/brand-website-analysis.ts");
  assert.match(analysis, /if \(!input\.userId\) \{[\s\S]*?return \{ href: brandBuildSignInHref\(value, seed\), outcome: "auth_required" \};/);
});

// ── One Build action ─────────────────────────────────────────────────────
test("exactly one semantic Build action; the website step is Continue; no Search-as-Instagram switch", () => {
  const prompt = PAGE.slice(PAGE.indexOf("function WebsitePrompt"), PAGE.indexOf("function AssistanceBlock"));
  assert.match(prompt, />\s*Continue\s*<\/button>/);
  assert.doesNotMatch(prompt, /Build/, "establishing the website never claims to build");
  // Build appears only in the website no-match state: one control per auth state.
  const website = PAGE.slice(PAGE.indexOf('if (inputKind === "website") {'), PAGE.indexOf("const instagramSeed"));
  assert.match(website, /authenticated \? \(\s*<form action=\{buildBrandProfile\}[\s\S]*?<BuildProfileButton \/>[\s\S]*?<\/form>\s*\) : \(\s*<PrimaryLink href=\{brandBuildSignInHref\(value, seed\)\} label="Build My Brand Profile" \/>\s*\)/);
  const outside = PAGE.replace(website, "");
  assert.doesNotMatch(outside, /Build My Brand Profile|buildBrandProfile\}|<BuildProfileButton/, "no other control claims to build");
  assert.doesNotMatch(PAGE, /Instagram Instead/);
  assert.match(PAGE, /\{alternative === "name" && \(/, "only the Search-as-a-Name alternative remains");
});

test("expectation is set before Build: Findmi builds from the website; guests learn they'll sign in first", () => {
  const website = PAGE.slice(PAGE.indexOf('if (inputKind === "website") {'), PAGE.indexOf("const instagramSeed"));
  assert.match(website, /body="We didn't find this brand on Findmi\. Findmi will build a starting profile from your website, and you'll review everything before it's added\."/);
  const guestNote = website.indexOf("You&rsquo;ll sign in or create an account to review and add your brand.");
  assert.ok(guestNote > 0 && guestNote < website.indexOf("<PrimaryLink href={brandBuildSignInHref"), "shown before the guest presses Build");
  assert.match(website, /\{!authenticated && <p/);
});

// ── Automatic, one-shot resume ───────────────────────────────────────────
test("auto-resume renders only signed in + build intent + website no-match, inside the existing Build form", () => {
  assert.match(PAGE, /resumeBuild=\{build === "1"\}/);
  const website = PAGE.slice(PAGE.indexOf('if (inputKind === "website") {'), PAGE.indexOf("const instagramSeed"));
  const form = website.slice(website.indexOf("<form action={buildBrandProfile}"), website.indexOf("</form>"));
  assert.match(form, /\{resumeBuild && <AutoBuild guardKey=\{\[value, seed\.name \?\? "", seed\.instagram \?\? ""\]\.join\("\|"\)\} param=\{BRAND_BUILD_RESUME_PARAM\} \/>\}/);
  assert.ok(website.indexOf("<AutoBuild") > website.indexOf("authenticated ? ("), "only in the signed-in branch");
  assert.ok(website.indexOf("<AutoBuild") < website.indexOf(") : ("), "never for guests");
  // Matches / assistance / name prompts never resume a Build.
  assert.equal((PAGE.match(/<AutoBuild /g) ?? []).length, 1);
});

test("auto-resume is one-shot: marker removed first, ref guard, per-tab guard, submits the same form once", () => {
  assert.match(AUTO, /^"use client";/);
  const effect = AUTO.slice(AUTO.indexOf("useEffect("));
  const order = ["if (fired.current) return;", "fired.current = true;", "url.searchParams.delete(param);", "window.history.replaceState(", "sessionStorage.getItem(key)", "sessionStorage.setItem(key", "requestSubmit()"];
  let at = -1;
  for (const step of order) {
    const i = effect.indexOf(step);
    assert.ok(i > at, `${step} (in order)`);
    at = i;
  }
  assert.match(AUTO, /if \(last && Date\.now\(\) - last < GUARD_MS\) return;/, "a restored/back page within the window never re-submits");
  assert.equal((AUTO.match(/requestSubmit\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(AUTO, /fetch\(|router\.|location\.href\s*=|buildBrandProfile|action=/, "no GET side effects; only the existing POST form");
});

// ── The server action is still the only trusted step ─────────────────────
test("Build still requires sign-in, re-validates the source, keeps rate limits and the user-bound draft — and never creates a Business", () => {
  assert.match(ACTION, /^"use server";/);
  assert.match(ACTION, /auth\.getUser\(\)/);
  assert.match(ACTION, /analyzeBrandWebsite\(\{ website, userId: user\?\.id \?\? null, ip, seed \}, deps\)/);
  assert.match(ACTION, /signBrandDraft\(result\.draft, user\.id, Date\.now\(\), getBrandDraftSecret\(\)\)/);
  const analysis = read("src/lib/brand-website-analysis.ts");
  assert.match(analysis, /const prepared = prepareBrandWebsite\(value\);/, "source re-validated server-side");
  assert.match(analysis, /if \(deps\.isRateLimited\(input\.userId, input\.ip\)\) return finish\(manual\("limited"\), "rate_limited"\);/);
  for (const f of [ACTION, analysis]) assert.doesNotMatch(code(f), /create_owned_business|createMemberBusiness|\.insert\(/);
  // Creation (with its server-side duplicate protection) only happens on the Review submit.
  assert.match(CREATE, /const matches = await findBusinessMatches\(admin, \{/);
});
