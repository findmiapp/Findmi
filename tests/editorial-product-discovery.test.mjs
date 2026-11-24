// Editorial Product Discovery (2026-11-24, owner-approved): editorial
// visibility on an Event page is separate from Marketplace selling.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const data = fs.readFileSync("src/lib/data.ts", "utf8");
function fnBody(name) {
  const i = data.indexOf(`export async function ${name}(`);
  assert.ok(i >= 0, `${name} exists`);
  const j = data.indexOf("\nexport ", i + 10);
  return data.slice(i, j > 0 ? j : undefined);
}

test("event products use the catalog rule, not marketplace approval", () => {
  const body = fnBody("getEventProducts");
  assert.match(body, /isCatalogVisible\(item!, item!\.business\)/);
  assert.doesNotMatch(body, /marketplace_status === "approved"/);
  // commerce UI is still decided by the canonical marketplace answer
  assert.match(body, /annotateMarketplaceEligibility/);
});

test("marketplace discovery surfaces keep the approval gate", () => {
  for (const name of ["getMarketplaceProducts", "getFeaturedProducts"]) {
    assert.match(fnBody(name), /applyMarketplaceProductFilter|filterMarketplaceEligible/, `${name} still applies the marketplace rule`);
  }
});

test("catalog rule never looks at commerce fields", () => {
  const cat = fs.readFileSync("src/lib/product-catalog.ts", "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(cat, /marketplace_status|purchasable/);
});
