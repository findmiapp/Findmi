// VCL A2b — Optional Business geography. A Business does not require City,
// State or a Market ("No geography is better than false geography"). Brand
// onboarding's Review Your Brand shows City/State as an optional Location;
// blank geography creates the Business with no business_markets row and no
// market_requests row, while anything entered keeps the existing Market /
// Market Request behavior. Source guards on the form, server action and the
// one forward-only migration (no rendering harness, no database here — the
// migration itself was exercised against a disposable Postgres).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const sql = (src) => src.replace(/--.*$/gm, "");

const FILE = "20261014000000_optional_business_geography.sql";
const MIGRATION = sql(read(`supabase/migrations/${FILE}`));
const PREVIOUS = sql(read("supabase/migrations/20260905230000_area_picker_and_market_requests.sql"));
const FIELDS = code(read("src/components/BusinessGeographyFields.tsx"));
const NEW_PAGE = code(read("src/app/(public)/account/business/new/page.tsx"));
const CREATE = read("src/app/(public)/account/business/actions.ts");
const MANAGER = read("src/app/(public)/account/business/[id]/page.tsx");
const fnBody = (src) => {
  const start = src.search(/create or replace function public\.create_owned_business\(/i);
  return src.slice(start, src.indexOf("$function$;", start) + 11);
};

// ── Review Your Brand ────────────────────────────────────────────────────
test("Brand review: City and State are optional, under a 'Location / Optional' label", () => {
  assert.match(NEW_PAGE, /optional=\{brandOnboarding\}/);
  assert.match(FIELDS, /Location <span className="font-normal normal-case">Optional<\/span>/);
  assert.equal((FIELDS.match(/required=\{!optional\}/g) ?? []).length, 2, "city and state");
  assert.doesNotMatch(FIELDS, /^\s*required\s*$/m, "no unconditional required");
  assert.match(FIELDS, /\{!hasInput && !optional && \(/, "no explanatory paragraph in the optional state");
});

test("no National/Online selector, ZIP, address, country or HQ inference added", () => {
  for (const src of [FIELDS, NEW_PAGE, CREATE, MIGRATION]) {
    assert.doesNotMatch(src, /National|Online Market|"Online"|headquarters/i);
  }
  assert.doesNotMatch(FIELDS, /name="(postal_code|zip|address|country)"/);
});

test("ordinary (non-Brand) creation keeps City/State required", () => {
  assert.match(FIELDS, /optional = false,/);
  assert.match(CREATE, /if \(!brandOnboarding && \(!city \|\| !state\)\) fail\("City and state are required\."\);/);
});

// ── Server action ────────────────────────────────────────────────────────
test("server: blank geography is allowed for Brand creation; entered geography still needs a Market or request", () => {
  assert.match(CREATE, /const city = str\(formData, "city"\);\s*const state = str\(formData, "state"\);/, "blanks normalize to null");
  assert.match(CREATE, /const hasGeography = Boolean\(city \|\| state\);/);
  assert.match(CREATE, /if \(!marketId && !requestedMarketText && \(!brandOnboarding \|\| hasGeography\)\) \{\s*fail\("Choose a Primary Market, or request one below\."\);/);
  assert.match(CREATE, /if \(marketId && requestedMarketText\) \{\s*fail\("Choose an existing Market OR request one, not both\."\);/);
  // Nothing manufactures geography: the RPC gets exactly what was resolved.
  const rpc = CREATE.slice(CREATE.indexOf('admin.rpc("create_owned_business"'), CREATE.indexOf("});", CREATE.indexOf('admin.rpc("create_owned_business"')));
  assert.match(rpc, /p_city: city,\s*p_state: state,/);
  assert.match(rpc, /p_market_id: effectiveMarketId,\s*p_requested_market_text: effectiveRequestedMarketText,/);
  assert.match(CREATE, /let effectiveRequestedMarketText = requestedMarketText;/);
});

test("creation authorization, duplicate protection and the A2 redirect remain", () => {
  assert.match(CREATE, /if \(!user\) redirect\(`\/login\?next=\$\{encodeURIComponent\(CREATE_BUSINESS_PATH\)\}`\);/);
  assert.match(CREATE, /if \(!authorized\) \{\s*fail\("Please confirm you're authorized to create and manage this business\."\);/);
  assert.match(CREATE, /const \[duplicate\] = await findBusinessMatches\(admin, \{/);
  assert.match(CREATE, /if \(brandOnboarding\) redirect\(`\/account\?created=\$\{businessId\}`\);/);
});

// ── The one migration ────────────────────────────────────────────────────
test("one forward-only migration, after the BD foundation, replacing only create_owned_business", () => {
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files.at(-1), FILE);
  assert.equal(files.at(-2), "20261013000000_bd_foundation.sql");
  const statements = MIGRATION.split(/\$function\$;/)[1].trim();
  assert.equal(statements, "", "nothing but the function replacement");
  assert.equal((MIGRATION.match(/create or replace function/gi) ?? []).length, 1);
  assert.doesNotMatch(MIGRATION, /\b(alter|drop|create table|insert into public\.markets|update public\.|delete from|grant|revoke|truncate)\b/i);
});

test("function: market_required removed; request row only for non-blank requested text; everything else identical", () => {
  const next = fnBody(MIGRATION);
  const prev = fnBody(PREVIOUS);
  assert.doesNotMatch(next, /market_required/);
  assert.match(prev, /market_required/);
  assert.match(next, /if p_market_id is not null then\s*insert into public\.business_markets[\s\S]*?'primary', 'self_selected', true\);\s*elsif p_requested_market_text is not null and btrim\(p_requested_market_text\) <> '' then\s*insert into public\.market_requests/);
  for (const kept of [
    "raise exception 'user_required'",
    "raise exception 'name_required'",
    "raise exception 'slug_required'",
    "raise exception 'invalid_category'",
    "raise exception 'market_choice_ambiguous'",
    "raise exception 'invalid_market'",
    "'free', 'pending_review', false",
    "perform public.set_business_category(v_business.id, p_category_id);",
    "insert into public.business_members (user_id, business_id, role) values (p_user_id, v_business.id, 'owner');",
    "'business_creation', v_business.id",
  ]) {
    assert.ok(next.includes(kept), kept);
  }
  assert.match(next, /SECURITY DEFINER\s*SET search_path TO ''/);
  assert.match(next, /p_market_id uuid, p_requested_market_text text DEFAULT NULL::text\)/, "same signature — grants carry over");
  assert.doesNotMatch(next, /insert into public\.markets/i, "never a fake Market");
});

// ── Downstream ───────────────────────────────────────────────────────────
test("Complete Profile no longer requires City/State; other signals unchanged", () => {
  assert.match(MANAGER, /const profileIncomplete = !business\.logo_url \|\| !business\.short_description \|\| !currentCategoryId;/);
});

test("null geography renders as nothing / 'Not set' — never 'undefined' or dangling punctuation", () => {
  assert.match(MANAGER, /\{\[business\.city, business\.state\]\.filter\(Boolean\)\.join\(", "\) \|\| "Not set"\}/);
  assert.match(read("src/app/admin/(protected)/businesses/[id]/page.tsx"), /\[business\.city, business\.state\]\.filter\(Boolean\)\.join\(", "\) \|\| "Not set"/);
  assert.match(read("src/lib/format.ts"), /export function cityState\(city\?: string \| null, state\?: string \| null\): string \{\s*return \[city, state\]\.filter\(Boolean\)\.join\(", "\);/);
  const pub = read("src/app/(public)/business/[slug]/BusinessPublicView.tsx");
  assert.match(pub, /const location = cityStateZip\(business\.city, business\.state, business\.postal_code\);/);
  assert.match(pub, /\.\.\.\(business\.city \|\| business\.state \|\| business\.postal_code/, "no empty structured address");
});

test("unscoped discovery does not require a Market (Market filters only narrow)", () => {
  const data = read("src/lib/data.ts");
  // Market ids are only resolved when a market slug is chosen; otherwise
  // the list stays null (unfiltered) and Market-less Businesses are included.
  assert.match(data, /let marketBusinessIds: string\[\] \| null = null;\s*if \(params\.areaSlug && params\.marketSlug\) \{[\s\S]*?\} else if \(params\.marketSlug\) \{\s*marketBusinessIds = await getBusinessIdsInMarket\(params\.marketSlug\);/);
});
