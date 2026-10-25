import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseAnalyticsRetentionDays, analyticsRetentionCutoff, RETIRED_SESSION_ID } from "../src/lib/analytics/retention.ts";

test("retention is off unless a valid whole number of days (30 to 3650) is set", () => {
  for (const v of [undefined, null, "", " ", "abc", "29", "0", "-5", "90.5", "4000"]) assert.equal(parseAnalyticsRetentionDays(v), null, String(v));
  assert.equal(parseAnalyticsRetentionDays("30"), 30);
  assert.equal(parseAnalyticsRetentionDays(" 400 "), 400);
});

test("cutoff is exactly N days before now", () => {
  assert.equal(analyticsRetentionCutoff(30, new Date("2026-10-31T00:00:00Z")), "2026-10-01T00:00:00.000Z");
});

test("the admin action de-identifies (never deletes) and is audited", () => {
  const src = readFileSync("src/app/admin/(protected)/privacy-requests/actions.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function applyAnalyticsRetention"));
  assert.match(fn, /\.update\(\{ user_id: null, referrer: null, session_id: RETIRED_SESSION_ID \}/);
  assert.doesNotMatch(fn, /\.delete\(/);
  assert.match(fn, /recordAdminAudit\([\s\S]*analytics_retention_applied/);
  assert.match(RETIRED_SESSION_ID, /^0{8}-0{4}-0{4}-0{4}-0{12}$/);
});
