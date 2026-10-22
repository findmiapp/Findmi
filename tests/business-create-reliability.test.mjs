// Business creation reliability (PiCKiE incident, Android Chrome): one submit
// creates one Business and lands on it; a repeated submit of the same form
// lands on the Business it already created; the Review image fields preview
// the file actually in the input. No network, no production DB. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    return next(specifier, context);
  },
});

const M = await import("../src/lib/business-matching.ts");
const read = (p) => readFileSync(p, "utf8");
const ACTIONS = read("src/app/(public)/account/business/actions.ts");
const CREATE = ACTIONS.slice(ACTIONS.indexOf("export async function createMemberBusiness"), ACTIONS.indexOf("export async function startBusinessProCheckout"));

// ── Repeated submit → the Business it already created ──────────────────────

test("ownedBusinessMatch: the strongest match the creator already belongs to, else null", () => {
  const matches = [
    { id: "someone-else", slug: "a", name: "A", reasons: ["website"], isPublic: true },
    { id: "mine", slug: "pickie", name: "Pickie", reasons: ["instagram"], isPublic: false },
    { id: "mine-too", slug: "pickie-2", name: "Pickie", reasons: ["name_location"], isPublic: false },
  ];
  assert.equal(M.ownedBusinessMatch(matches, ["mine", "mine-too"])?.id, "mine", "keeps the ranked order");
  assert.equal(M.ownedBusinessMatch(matches, new Set(["mine-too"]))?.id, "mine-too");
  assert.equal(M.ownedBusinessMatch(matches, []), null, "nobody else's Business is ever treated as yours");
  assert.equal(M.ownedBusinessMatch([], ["mine"]), null);
});

test("createMemberBusiness: an owned match lands on that Business — before the duplicate error and before any create", () => {
  const owned = CREATE.indexOf("ownedBusinessMatch(matches");
  const landing = CREATE.indexOf("if (owned) redirect(`/account?created=${owned.id}`);");
  const duplicateError = CREATE.indexOf("const [duplicate] = matches;");
  const rpc = CREATE.indexOf('admin.rpc("create_owned_business"');
  assert.ok(owned > 0 && landing > owned, "owned check, then the same landing a fresh create uses");
  assert.ok(duplicateError > landing && rpc > duplicateError, "only a match the user does NOT own reaches the duplicate error; nothing is created for either");
  // Membership is read for exactly this user and exactly these candidates.
  assert.match(CREATE, /from\("business_members"\)\s*\.select\("business_id"\)\s*\.eq\("user_id", user\.id\)\s*\.in\(\s*"business_id",\s*matches\.map\(\(m\) => m\.id\)\s*\)/);
});

// ── One tap, one create ─────────────────────────────────────────────────────

test("signed-in Create submit: disabled while the create is in flight, and a second tap never starts a second create", () => {
  const src = read("src/components/account/GuestCreateSubmit.tsx");
  assert.match(src, /import \{ createPortal, useFormStatus \} from "react-dom";/);
  assert.match(src, /if \(authed\) return <AuthedSubmit label=\{label\} className=\{className\} \/>;/);
  const submit = src.slice(src.indexOf("function AuthedSubmit"), src.indexOf("function GuestCreateSheet"));
  assert.match(submit, /const \{ pending \} = useFormStatus\(\);/);
  assert.match(submit, /disabled=\{pending\}/);
  assert.match(submit, /if \(submitted\.current\) \{\s*e\.preventDefault\(\);/, "a tap before the re-render is swallowed");
  assert.match(submit, /if \(e\.currentTarget\.form\?\.checkValidity\(\)\) submitted\.current = true;/, "an invalid form never locks the button");
  assert.match(submit, /if \(!pending\) submitted\.current = false;/, "re-enabled when the action settles (error round-trip)");
});

// ── Review image previews follow the real file ──────────────────────────────

test("Brand Review image field previews a file the browser restored without a change event; a failed read never sticks on Preview…", () => {
  const src = read("src/app/(public)/account/business/new/BrandImageInput.tsx");
  assert.match(src, /function showFiles\(input: HTMLInputElement\)/);
  assert.match(src, /function handleFile\(e: React\.ChangeEvent<HTMLInputElement>\) \{\s*showFiles\(e\.target\);/, "picker and restore share one path");
  const effect = src.slice(src.indexOf("useEffect(() => {"), src.indexOf("}, []);"));
  assert.match(effect, /if \(input\?\.files\?\.length\) showFiles\(input\);/);
  assert.match(effect, /sync\(\);/, "checked on mount");
  assert.match(effect, /window\.addEventListener\("pageshow", sync\);/, "and when the page is shown again");
  assert.match(src, /reader\.onerror = \(\) => settle\(null\);/);
  assert.match(src, /chosen\.failed \? `\$\{noun\} Added` : "Preview…"/);
});
