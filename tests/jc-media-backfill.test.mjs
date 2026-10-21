// One-off Jersey City media backfill: manual-dispatch only, empty fields
// only, the existing pipeline only, and the approved exclusions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const WF = read(".github/workflows/jc-media-backfill.yml");
const SCRIPT = read("scripts/jc-media-backfill/backfill.ts");
// Executable lines only (comments describe the pipeline in plain words).
const WF_CODE = WF.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
const SCRIPT_CODE = SCRIPT.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");

test("workflow: runs only on a manual dispatch confirmed with RUN; never builds or deploys", () => {
  assert.match(WF, /workflow_dispatch:/);
  assert.match(WF, /if: github\.event_name == 'workflow_dispatch' && github\.event\.inputs\.confirm == 'RUN'/);
  assert.match(WF, /push:\n    branches: \[media-enrichment-preview\]\n    paths: \["\.github\/workflows\/jc-media-backfill\.yml"\]/, "push only registers the workflow (the job is skipped)");
  assert.doesNotMatch(WF_CODE, /npm run build|vercel|deploy/i);
  assert.match(WF, /secrets\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(SCRIPT, /console\.\w+\([^)]*(key|SERVICE_ROLE)/i, "secrets are never logged");
});

test("script: reuses the existing pipeline and logo selection; empty fields only; approved exclusions", () => {
  assert.match(SCRIPT, /import \{ resolveSourceImage, writeProvenance, type MediaTarget \} from "@\/lib\/admin\/media-enrichment";/);
  assert.match(SCRIPT, /selectVerifiedLogo/);
  assert.match(SCRIPT, /extractBrandProfile/);
  assert.doesNotMatch(SCRIPT_CODE, /\.storage\.|og:image/);
  assert.match(SCRIPT, /\.update\(\{ \[column\]: stored \}\)\.eq\("id", row\.id\)\.is\(column, null\)/, "never overwrites a filled field");
  for (const slug of ["jodeci-loews-jersey-2026", "mana-contemporary-three-works-by-athena-latocha", "jcymap-2026-celebration-art-exhibition-documentary-premiere", "cat-stick-easel-moon-closing-reception"]) {
    assert.ok(SCRIPT.includes(`"${slug}"`), slug);
  }
  assert.match(SCRIPT, /"rocky-horror-picture-show-live-shadow-cast-lsc-2026": \/rocky\[-_ \]\?horror\/i/);
  assert.match(SCRIPT, /if \(l\.cover_image_url\) log\(\{[^}]*status: "skipped"/, "filled fields are skipped before any download");
});

test("the four reviewed-and-cleared covers are never re-fetched; their logos and everything else still are", () => {
  for (const slug of ["battello-jersey-city", "newark-avenue-pedestrian-plaza", "lincoln-park-jersey-city"]) assert.ok(SCRIPT.match(/EXCLUDED_PLACE_COVER_SLUGS = new Set\(\[([^\]]*)\]/)[1].includes(`"${slug}"`), slug);
  assert.match(SCRIPT, /EXCLUDED_BUSINESS_COVER_SLUGS = new Set\(\["nimbus-dance"\]\)/);
  // Checked before any fetch, and only for the cover field.
  assert.match(SCRIPT, /else if \(EXCLUDED_PLACE_COVER_SLUGS\.has\(l\.slug\)\) log\(\{ table: "locations", name: l\.name, column: "cover_image_url", status: "unresolved"/);
  assert.match(SCRIPT, /else if \(EXCLUDED_BUSINESS_COVER_SLUGS\.has\(b\.slug\)\) log\(\{ table: "businesses", name: b\.name, column: "cover_image_url", status: "unresolved"/);
  assert.doesNotMatch(SCRIPT, /EXCLUDED_BUSINESS_COVER_SLUGS\.has\(b\.slug\)\) log\(\{[^}]*column: "logo_url"/);
});

