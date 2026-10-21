// Final Brand Build V1 UX cleanup — Review Your Brand always shows Logo and
// Cover Image (found → preview + Use/Replace; missing → empty state + Add),
// Instagram is always an editable field, About is the single reviewed
// description, and an owner-chosen image goes through the existing member
// upload pipeline (validated before create, stored after). Cases A–F are
// the found/missing combinations; the rendered check of each lives in the
// Playwright QA, these pin the contract that produces them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const IMG = await import("../src/lib/brand-images.ts");
const X = await import("../src/lib/brand-website-extract.ts");

const PAGE = readFileSync("src/app/(public)/account/business/new/page.tsx", "utf8");
const INPUT = readFileSync("src/app/(public)/account/business/new/BrandImageInput.tsx", "utf8");
const ACTIONS = readFileSync("src/app/(public)/account/business/actions.ts", "utf8");
const CREATE = ACTIONS.slice(ACTIONS.indexOf("export async function createMemberBusiness"));
const form = PAGE.slice(PAGE.indexOf('<form id="create-business-form" action={createMemberBusiness}'), PAGE.indexOf("</form>"));

test("Review field order: Business Name, Primary Category, Website, Instagram, Logo, Cover Image, About", () => {
  const at = (needle) => {
    const i = form.indexOf(needle);
    assert.ok(i > 0, needle);
    return i;
  };
  const order = [
    at('name="name"'),
    at('name="category_id"'),
    at('name="website_url"'),
    at('name="instagram_url"'),
    at('<BrandImageInput role="logo"'),
    at('<BrandImageInput role="cover"'),
    at('name="description"'),
  ];
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("Logo and Cover Image are rendered for every Brand Review — never gated on a found image (cases A–F)", () => {
  assert.doesNotMatch(form, /\{\(?logoPreview \|\| coverPreview\)? && \(/, "no 'only when found' gate");
  assert.doesNotMatch(form, /\{(logoPreview|coverPreview) && \(/);
  const block = form.slice(form.indexOf("{brandOnboarding && (\n            <div className=\"flex flex-col gap-3\">"));
  assert.match(block, /^\{brandOnboarding && \(\s*<div className="flex flex-col gap-3">\s*<BrandImageInput role="logo" label="Logo" foundPreview=\{logoPreview\}[^>]*\/>\s*<BrandImageInput role="cover" label="Cover Image" foundPreview=\{coverPreview\}/);
});

test("found image (A, logo of C, cover of B): preview + Use This … + Replace", () => {
  assert.match(INPUT, /\{foundPreview && !chosen && \(\s*<label[^>]*>\s*<input type="checkbox" name=\{useName\} value="1" defaultChecked=\{useDefault\}/);
  assert.match(INPUT, /\{role === "logo" \? "Use This Logo" : "Use This Cover"\}/);
  assert.match(INPUT, /\{chosen \|\| foundPreview \? `Replace \$\{noun\}` : `Add \$\{noun\}`\}/);
  assert.match(INPUT, /const preview = chosen \? chosen\.preview : foundPreview;/);
});

test("missing image (B logo, C cover, D both, F both): clear empty state with Add Logo / Add Cover Image", () => {
  assert.match(INPUT, /const noun = role === "logo" \? "Logo" : "Cover Image";/, "→ Add Logo / Add Cover Image");
  assert.match(INPUT, /role === "logo" \? "No logo found" : "No cover image found"/);
  assert.match(INPUT, /`No \$\{noun\.toLowerCase\(\)\}`/, "placeholder inside the empty frame");
  assert.match(INPUT, /border-dashed/);
  assert.match(INPUT, /data-state=\{chosen \? "uploaded" : foundPreview \? "found" : "empty"\}/);
});

test("Add/Replace reuses the hardened MemberImageField picker shape; no URL is ever submitted", () => {
  assert.match(INPUT, /<button type="button" onClick=\{openPicker\}/);
  assert.match(INPUT, /type="file"\s+name=\{fileName\}\s+accept="image\/\*"\s+multiple=\{false\}/);
  assert.match(INPUT, /className="sr-only"/);
  assert.doesNotMatch(INPUT, /className="hidden"|URL\.createObjectURL/, "never display:none; data: preview (CSP has no blob:)");
  assert.match(INPUT, /reader\.readAsDataURL\(file\)/);
  assert.doesNotMatch(form, /name="(logo|cover|logo_url|cover_image_url)"/);
  assert.match(form, /fileName="logo_file"/);
  assert.match(form, /fileName="cover_file"/);
});

test("Instagram is always an editable field: found → prefilled URL; missing (E) → empty", () => {
  assert.match(form, /<input autoCapitalize="none"\s+type="url"\s+name="instagram_url"\s+defaultValue=\{values\.instagramUrl\}/);
  assert.doesNotMatch(form.slice(0, form.indexOf('name="instagram_url"')).slice(-400), /values\.instagramUrl &&|draft\?\.ig &&/);
  assert.match(PAGE, /instagramUrl: fromDraft \? \(fromDraft\.ig \? `https:\/\/www\.instagram\.com\/\$\{fromDraft\.ig\}` : ""\)/);
});

test("Short Description is not on Brand Review; About is the single description (F: a found short line seeds About)", () => {
  assert.match(form, /\{!brandOnboarding && \(\s*<label className="block">\s*<span[^>]*>\s*Short description/);
  assert.match(PAGE, /about: fromDraft \? \(fromDraft\.about \?\? fromDraft\.sd \?\? ""\)/);
  assert.match(CREATE, /const shortDescription = brandOnboarding \? null : \(str\(formData, "short_description"\)/);
  // compatibility: the column, normal creation and Business Manager keep it
  const manager = readFileSync("src/app/(public)/account/business/[id]/(manager)/page.tsx", "utf8");
  assert.match(manager, /name="short_description"/);
  assert.match(manager, /!\(business\.short_description \|\| business\.description\)/, "a Brand with About isn't flagged incomplete");
});

test("owner image: validated BEFORE create, stored AFTER through the shared member pipeline, wins over the found image", () => {
  assert.match(CREATE, /const logoFile = brandOnboarding \? submittedFile\(formData, "logo_file"\) : null;/);
  assert.match(CREATE, /const coverFile = brandOnboarding \? submittedFile\(formData, "cover_file"\) : null;/);
  const validate = CREATE.indexOf("checked = await validateImageFile(file);");
  const rpc = CREATE.indexOf('admin.rpc("create_owned_business"');
  const store = CREATE.indexOf("await storeValidatedBusinessImage(admin, validated, file)");
  const draftImport = CREATE.indexOf("const draft = await readBrandDraft(user.id);");
  assert.ok(validate > 0 && validate < rpc && rpc < store && store < draftImport);
  assert.match(CREATE, /if \("error" in checked\) fail\(/, "a bad file creates nothing");
  assert.match(CREATE, /\["logo", useLogo && !logoFile, draft\?\.logoStaged, draft\?\.logo\]/);
  assert.match(CREATE, /\["cover", useCover && !coverFile, draft\?\.coverStaged, draft\?\.cover\]/);
  // one pipeline: the member upload action uses the same helper
  const upload = ACTIONS.slice(ACTIONS.indexOf("export async function uploadMemberBusinessImage"), ACTIONS.indexOf("async function storeValidatedBusinessImage"));
  assert.match(upload, /return await storeValidatedBusinessImage\(admin, validated, file\);/);
  assert.match(ACTIONS, /async function storeValidatedBusinessImage[\s\S]*?storePublicImage\(admin, UPLOAD_BUCKET, validated, file\)/);
  assert.match(ACTIONS, /return value instanceof File && value\.size > 0 \? value : null;/, "an untouched file input is ignored");
});

test("covers: a wide wordmark/banner strip is never a cover (logos unchanged)", () => {
  assert.equal(IMG.isSuitableBrandImage("cover", 1200, 630), true, "share image 1.91:1");
  assert.equal(IMG.isSuitableBrandImage("cover", 1920, 600), true, "3.2:1 hero");
  assert.equal(IMG.isSuitableBrandImage("cover", 1200, 300), false, "4:1 wordmark");
  assert.equal(IMG.isSuitableBrandImage("cover", 2400, 400), false, "6:1 strip");
  assert.equal(IMG.isSuitableBrandImage("logo", 1200, 300), true, "a 4:1 wordmark is still a valid logo");
});

test("covers: screenshot / page-capture / mockup file names are never cover candidates", () => {
  const base = new URL("https://www.brand-site.com/");
  const meta = (url) => (key) => (key === "og:image" ? url : null);
  for (const name of ["homepage-screenshot.jpg", "Screen-Shot-2024.png", "screen_capture.jpg", "browser-mockup.png", "site-preview.jpg", "website_preview.png"]) {
    assert.deepEqual(X.coverCandidatesFrom(null, meta(`https://www.brand-site.com/img/${name}`), [], base, []), [], name);
  }
  assert.deepEqual(X.coverCandidatesFrom(null, meta("https://www.brand-site.com/img/summer-collection.jpg"), [], base, []), ["https://www.brand-site.com/img/summer-collection.jpg"]);
});
