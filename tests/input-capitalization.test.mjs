// VCL C1 — input capitalization SEMANTICS. Human-facing text inputs tell
// mobile keyboards what they hold (autoCapitalize = words | sentences |
// none); the value itself is never case-transformed anywhere. Source-level
// guards over the real JSX (no rendering harness) plus the shared helper's
// rules and value-preservation checks. No network, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { registerHooks } from "node:module";

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

const C = await import("../src/lib/input-capitalization.ts");
const read = (p) => readFileSync(p, "utf8");

/** Every <input>/<textarea> opening tag in a file → its attributes. */
function fields(path) {
  const s = read(path);
  const out = [];
  const re = /<(input|textarea)\b/g;
  let m;
  while ((m = re.exec(s))) {
    let j = m.index + m[0].length;
    let depth = 0;
    let quote = null;
    for (; j < s.length; j++) {
      const ch = s[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ((ch === "'" || ch === "`") && depth > 0)) quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    const tag = s.slice(m.index, j + 1);
    const attr = (n) => (tag.match(new RegExp(`\\s${n}=(?:"([^"]*)"|\\{([^}]*)\\})`)) ?? []).slice(1).find((v) => v !== undefined) ?? null;
    out.push({ kind: m[1], tag, name: attr("name"), type: attr("type"), cap: attr("autoCapitalize"), inputMode: attr("inputMode"), autoComplete: attr("autoComplete") });
  }
  return out;
}
const field = (path, pred, label) => {
  const hit = fields(path).find(pred);
  assert.ok(hit, `${label} in ${path}`);
  return hit;
};
const NON_TEXT = /^(hidden|checkbox|radio|file|submit|button|range|color|date|time|datetime-local|number|image|reset|month|week)$/;
const isText = (f) => !(f.type && NON_TEXT.test(f.type));
const byName = (path, name, kind) => field(path, (f) => isText(f) && f.name === name && (!kind || f.kind === kind), name);

const NEW_BIZ = "src/app/(public)/account/business/new/page.tsx";
const BIZ = "src/app/(public)/account/business/[id]/(manager)/page.tsx";
const PRODUCT = "src/app/(public)/account/business/[id]/ProductFieldsForm.tsx";

// ── The helper ────────────────────────────────────────────────────────────
test("helper: names/titles → words, prose → sentences, machine/case-sensitive → none, unknown → no hint", () => {
  for (const n of ["name", "title", "display_name", "venue_name", "contact_name", "city", "address", "heading", "cta_label", "internal_name"]) assert.equal(C.capitalizationFor(n), "words", n);
  for (const n of ["description", "short_description", "about", "notes", "body", "bulletin_body", "highlight_body", "requirements"]) assert.equal(C.capitalizationFor(n, "textarea"), "sentences", n);
  for (const n of ["email", "website", "website_url", "instagram_url", "slug", "code", "invite_code", "category_slug", "postal_code", "timezone", "event_id"]) assert.equal(C.capitalizationFor(n), "none", n);
  for (const t of ["email", "url", "password", "search", "tel"]) assert.equal(C.capitalizationFor("name", t), "none", `type ${t} wins`);
  assert.equal(C.capitalizationFor("mystery_field"), undefined, "no guessed universal default");
});

test("admin primitives: explicit override, else name/type semantics; textarea defaults to prose", () => {
  const f = read("src/components/admin/Fields.tsx");
  assert.match(f, /autoCapitalize=\{autoCapitalize \?\? capitalizationFor\(name, type\)\}/);
  assert.match(f, /autoCapitalize=\{autoCapitalize \?\? capitalizationFor\(name, "textarea"\) \?\? "sentences"\}/);
});

// ── Required surfaces ─────────────────────────────────────────────────────
test("1/7/8. Business + Brand onboarding: name words; descriptions/About sentences; website/Instagram/codes none", () => {
  // Business Name is search-first: the field lives in BusinessNameSearchFirst.
  assert.equal(byName("src/app/(public)/account/business/new/BusinessNameSearchFirst.tsx", "name").cap, "words");
  assert.equal(byName(NEW_BIZ, "short_description").cap, "sentences");
  assert.equal(byName(NEW_BIZ, "description").cap, "sentences", "About");
  assert.equal(byName(NEW_BIZ, "website_url").cap, "none");
  assert.equal(byName(NEW_BIZ, "instagram_url").cap, "none");
  assert.equal(byName(NEW_BIZ, "ref").cap, "none");
  for (const f of fields("src/app/(public)/join/brand/page.tsx").filter(isText)) assert.equal(f.cap, "none", "Brand lookup is search/URL");
  assert.equal(byName(BIZ, "name").cap, "words");
  assert.equal(byName(BIZ, "description").cap, "sentences");
});

test("2/6. Event title words; Event description sentences; Event URLs none", () => {
  assert.equal(byName("src/app/(public)/account/event/new/page.tsx", "name").cap, "words");
  const ev = fields("src/app/(public)/account/event/[id]/page.tsx");
  assert.equal(ev.find((f) => f.name === "name")?.cap, "words");
  assert.equal(ev.find((f) => f.name === "description")?.cap, "sentences");
  for (const f of ev.filter((x) => /_url$/.test(x.name ?? ""))) assert.equal(f.cap, "none", f.name);
});

test("Where I'll Be / Appearance: title words, details sentences, URLs none", () => {
  const ap = fields("src/app/(public)/account/business/[id]/AppearanceFieldsForm.tsx");
  assert.ok(ap.length > 0);
  for (const f of ap.filter(isText)) assert.ok(f.cap, `${f.name} declares a hint`);
  for (const f of ap.filter((x) => /(_url|^url)$/.test(x.name ?? "") || x.type === "url")) assert.equal(f.cap, "none", f.name);
});

test("3. Product name words; description sentences; purchase URL none", () => {
  assert.equal(byName(PRODUCT, "name").cap, "words");
  assert.equal(byName(PRODUCT, "description").cap, "sentences");
  assert.equal(byName(PRODUCT, "external_purchase_url").cap, "none");
});

test("4/16. Location + address: name/street/city/state words; ZIP none", () => {
  assert.equal(byName("src/app/(public)/account/location/new/page.tsx", "name").cap, "words");
  assert.equal(byName("src/app/(public)/account/location/new/page.tsx", "address").cap, "words");
  for (const p of ["src/components/BusinessGeographyFields.tsx", "src/components/LocationGeographyFields.tsx"]) {
    assert.equal(byName(p, "city").cap, "words");
    assert.equal(byName(p, "state").cap, "words");
  }
  const manual = fields("src/components/account/EventLocationField.tsx").filter((f) => f.type === "text");
  assert.deepEqual(manual.map((f) => f.cap), ["words", "words", "words", "words", "none"], "venue, address, city, state, ZIP");
  const place = fields("src/components/places/PlaceFindOrCreate.tsx").filter((f) => f.type === "text");
  assert.deepEqual(place.map((f) => f.cap), ["words", "words", "words", "words", "none"]);
  assert.match(read("src/components/journal/MomentContextStage.tsx"), /autoCapitalize=\{key === "zip" \? "none" : "words"\}/);
});

test("5/9/11. Account/auth: person name words; email + password none", () => {
  const signup = fields("src/app/(public)/signup/SignupForm.tsx");
  assert.equal(signup.find((f) => f.name === "display_name").cap, "words");
  assert.ok(signup.filter((f) => f.type === "email").every((f) => f.cap === "none"));
  assert.ok(fields("src/app/(public)/login/page.tsx").every((f) => f.type === "hidden" || f.cap === "none"));
  assert.equal(field("src/components/PasswordField.tsx", (f) => f.name === "name", "password input").cap, "none");
  assert.equal(byName("src/app/(public)/account/profile/page.tsx", "display_name").cap, "words");
  assert.equal(byName("src/app/(public)/account/profile/page.tsx", "bio").cap, "sentences");
  assert.match(read("src/components/UsernameField.tsx"), /autoCapitalize="off"/, "username unchanged (off ≡ none)");
});

test("10/12. handles/slugs/codes none (admin slug fields, invite/promo codes)", () => {
  assert.deepEqual(fields("src/components/admin/NameSlugFields.tsx").map((f) => f.cap), ["words", "none"]);
  assert.deepEqual(fields("src/components/admin/LinkedNameSlug.tsx").map((f) => f.cap), ["words", "none"]);
  for (const f of fields("src/components/ProInviteCodeEntry.tsx").filter(isText)) assert.equal(f.cap, "none");
});

test("13. search boxes declare none", () => {
  for (const p of [
    "src/components/HeaderSearch.tsx",
    "src/components/SearchBar.tsx",
    "src/components/DrawerSearch.tsx",
    "src/components/admin/RelationPicker.tsx",
    "src/components/account/AccountRelationPicker.tsx",
    "src/components/discover/AreaPicker.tsx",
    "src/components/discover/ArchiveSearchField.tsx",
    "src/app/(public)/account/business/[id]/EventSearchPicker.tsx",
  ]) {
    for (const f of fields(p).filter((x) => isText(x) && x.kind === "input")) assert.equal(f.cap, "none", p);
  }
});

test("14/15. QR: campaign/display name words; destination URL none", () => {
  const qr = fields("src/app/(public)/account/business/[id]/qr/new/QrIntelligentCreator.tsx");
  assert.ok(qr.some((f) => f.cap === "words" && /name/i.test(f.tag)));
  assert.equal(qr.find((f) => /destinationUrl/.test(f.tag)).cap, "none");
  const detail = fields("src/app/(public)/account/qr/[id]/QrCampaignDetailView.tsx");
  assert.equal(detail.find((f) => /editName/.test(f.tag)).cap, "words");
  assert.equal(detail.find((f) => /editDestinationUrl/.test(f.tag)).cap, "none");
  assert.equal(field("src/app/(public)/account/business/[id]/QrCampaignCreator.tsx", (f) => /value=\{name\}/.test(f.tag), "campaign name").cap, "words");
});

// ── Coverage + preservation ──────────────────────────────────────────────
function walk(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });
}
const ALL = walk("src").flatMap((p) => fields(p).map((f) => ({ ...f, path: p })));

test("every human-editable text input declares a hint (except two hidden honeypots and a doc comment)", () => {
  const missing = ALL.filter((f) => isText(f) && !f.cap).map((f) => `${f.path}:${f.name ?? "-"}`);
  // The two honeypots are invisible anti-spam fields no person fills in;
  // PasswordField's "<input>" is the word inside its doc comment.
  assert.deepEqual(missing.sort(), ["src/app/(public)/join/sales/page.tsx:company_site", "src/components/InquireButton.tsx:-", "src/components/PasswordField.tsx:-"].sort());
  for (const f of ALL.filter((x) => x.cap)) assert.ok(["words", "sentences", "none", "off"].includes(f.cap) || /\?/.test(f.cap), `${f.path} ${f.cap}`);
});

test("17/18/19. inputMode, autoComplete and type are untouched where they existed", () => {
  const withMode = ALL.filter((f) => f.inputMode);
  assert.ok(withMode.length > 0);
  for (const f of ALL.filter((x) => x.cap && x.autoComplete === "postal-code")) assert.equal(f.cap, "none");
  assert.equal(byName("src/app/(public)/login/page.tsx", "email").type, "email");
  assert.equal(byName("src/app/(public)/login/page.tsx", "email").autoComplete, "email");
  assert.equal(byName(NEW_BIZ, "website_url").type, "url");
  assert.equal(field("src/components/places/PlaceFindOrCreate.tsx", (f) => f.inputMode === "numeric", "zip").autoComplete, "postal-code");
});

test("20/21/22. no casing transform: no helper, no onChange/blur/submit mutation, no CSS fake", () => {
  for (const p of walk("src")) {
    const s = read(p);
    assert.doesNotMatch(s, /\b(toTitleCase|titleCase|capitalizeWords|sentenceCase)\b/, p);
    // Any onChange/onBlur that upper/lower-cases a value.
    // One pre-existing, intentional exception: the admin Commercial Terms
    // ISO currency CODE (a machine value, "usd" → "USD") — not human text.
    const allowed = p.endsWith("CommercialTermsBuilder.tsx") ? s.replace("onChange={(e) => onChange({ currency: e.target.value.toUpperCase() })}", "") : s;
    assert.doesNotMatch(allowed, /on(Change|Blur)=\{[^}]*\.(toUpperCase|toLowerCase)\(\)/, p);
  }
  for (const f of ALL) assert.doesNotMatch(f.tag, /\b(uppercase|lowercase|capitalize)\b/, `${f.path}: CSS text-transform on an input`);
  assert.doesNotMatch(read("src/lib/input-capitalization.ts").replace(/\/\*[\s\S]*?\*\//g, ""), /toUpperCase|toLowerCase/);
});

test("23-28. entered casing is preserved end to end: findmi, illy, adidas, eBay, iPhone, LaCroix", async () => {
  const X = await import("../src/lib/brand-website-extract.ts");
  const Cand = await import("../src/lib/brand-candidate.ts");
  for (const name of ["findmi", "illy", "adidas", "eBay", "iPhone", "LaCroix"]) {
    assert.equal(X.cleanText(name, 120), name, "extraction/cleaning keeps casing");
    const href = Cand.brandCandidateHref({ name }, "website");
    assert.equal(new URL(href, "https://findmi.app").searchParams.get("name"), name, "candidate serializer keeps casing");
  }
  // Creation passes the submitted name straight to the RPC (trimmed only by the DB function).
  const create = read("src/app/(public)/account/business/actions.ts");
  assert.match(create, /const name = str\(formData, "name"\);/);
  assert.match(create, /p_name: name,/);
  assert.doesNotMatch(create.slice(create.indexOf("export async function createMemberBusiness")), /name[^;\n]*\.(toUpperCase|toLowerCase)\(/);
});

test("29-36. earlier checkpoints intact; A3b search still off", async () => {
  const I = await import("../src/lib/brand-instagram-discovery.ts");
  assert.equal(I.instagramSearchEnabled({ ANTHROPIC_API_KEY: "k" }), false);
  assert.match(read(NEW_BIZ), /\{!brandOnboarding && geography\}/, "A2b: no Brand geography");
  assert.match(read("src/app/(public)/account/business/actions.ts"), /redirect\(`\/account\?created=\$\{businessId\}`\);/, "A2");
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files.at(-1), "20261119000000_discovery_pages_guides_v1a.sql" /* later passes (… Commercial Inquiry V1, Public Actions, … Event date/time precision, Identity & Authorship V1, Brand Audit V1, Brand Intelligence V1.1, Brand Intelligence V1.2, Discovery Intelligence V1, Canonical Entity Geography) */, "no migration in C1");
});
