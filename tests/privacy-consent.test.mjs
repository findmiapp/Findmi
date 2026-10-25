// Privacy Choices (Phase 2A): consent rules, sign-in reconciliation, URL
// minimization at analytics ingestion, deferred QR measurement, plus
// static guards over every enforcement point. No database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  analyticsAllowed,
  isGpcHeader,
  parsePrivacyCookie,
  reconcileAnalyticsChoice,
  serializePrivacyCookie,
  shouldShowFirstVisitCard,
} from "../src/lib/privacy/consent.ts";
import { sanitizePagePath, sanitizeReferrer } from "../src/lib/analytics/sanitize.ts";
import { takeQrArrivalParam, withQrArrivalParam } from "../src/lib/privacy/qr-arrival.ts";
import { ANALYTICS_IDENTIFIER_MAX_AGE_DAYS } from "../src/lib/analytics/session-constants.ts";

const read = (p) => readFileSync(p, "utf8");

test("cookie round-trips and rejects anything unexpected", () => {
  assert.equal(parsePrivacyCookie(serializePrivacyCookie("granted")), "granted");
  assert.equal(parsePrivacyCookie(serializePrivacyCookie("denied")), "denied");
  for (const bad of [null, undefined, "", "granted", "v1.", "v1.yes", "v2.granted"]) assert.equal(parsePrivacyCookie(bad), null);
});

test("analytics needs an explicit device grant and no account refusal", () => {
  assert.equal(analyticsAllowed({ deviceChoice: null }), false);
  assert.equal(analyticsAllowed({ deviceChoice: "denied" }), false);
  assert.equal(analyticsAllowed({ deviceChoice: "granted" }), true);
  assert.equal(analyticsAllowed({ deviceChoice: "granted", accountChoice: "denied" }), false);
  assert.equal(analyticsAllowed({ deviceChoice: "granted", accountChoice: "granted" }), true);
  assert.equal(analyticsAllowed({ deviceChoice: "denied", accountChoice: "granted" }), false);
});

test("GPC header detection", () => {
  assert.equal(isGpcHeader("1"), true);
  assert.equal(isGpcHeader(" 1 "), true);
  for (const v of [null, undefined, "", "0", "true"]) assert.equal(isGpcHeader(v), false);
});

test("first-visit card: only with no choice and no GPC", () => {
  assert.equal(shouldShowFirstVisitCard({ deviceChoice: null, gpc: false }), true);
  assert.equal(shouldShowFirstVisitCard({ deviceChoice: null, gpc: true }), false);
  assert.equal(shouldShowFirstVisitCard({ deviceChoice: "denied", gpc: false }), false);
  assert.equal(shouldShowFirstVisitCard({ deviceChoice: "granted", gpc: false }), false);
});

test("reconciliation is deterministic and never turns a refusal into consent", () => {
  const r = (device, account, gpc = false) => reconcileAnalyticsChoice({ device, account, gpc });
  assert.deepEqual(r(null, null), { setDevice: null, setAccount: null, effective: null });
  assert.deepEqual(r("granted", "granted"), { setDevice: null, setAccount: null, effective: "granted" });
  assert.deepEqual(r("denied", null), { setDevice: null, setAccount: "denied", effective: "denied" });
  assert.deepEqual(r("granted", null), { setDevice: null, setAccount: "granted", effective: "granted" });
  assert.deepEqual(r(null, "denied"), { setDevice: "denied", setAccount: null, effective: "denied" });
  assert.deepEqual(r(null, "granted"), { setDevice: "granted", setAccount: null, effective: "granted" });
  // GPC on this device: an account grant is not copied over.
  assert.deepEqual(r(null, "granted", true), { setDevice: null, setAccount: null, effective: null });
  // Disagreement: the refusal wins on both sides.
  assert.deepEqual(r("denied", "granted"), { setDevice: "denied", setAccount: "denied", effective: "denied" });
  assert.deepEqual(r("granted", "denied"), { setDevice: "denied", setAccount: "denied", effective: "denied" });
});

test("page_path keeps only the pathname", () => {
  assert.equal(sanitizePagePath("/search?q=my+address#x"), "/search");
  assert.equal(sanitizePagePath("/business/acme"), "/business/acme");
  assert.equal(sanitizePagePath("https://findmi.app/search?q=x"), null);
  assert.equal(sanitizePagePath(""), null);
  assert.equal(sanitizePagePath(undefined), null);
});

test("referrer: Findmi pages keep the path only, other sites the origin only", () => {
  const hosts = new Set(["findmi.app", "jerseycity.guide"]);
  assert.equal(sanitizeReferrer("https://findmi.app/search?q=dentist+near+me", null, hosts), "/search");
  assert.equal(sanitizeReferrer("https://jerseycity.guide/events?q=kids", null, hosts), "/events");
  assert.equal(sanitizeReferrer("http://localhost:3000/search?q=x", "localhost:3000", hosts), "/search");
  assert.equal(sanitizeReferrer("https://www.google.com/search?q=findmi", null, hosts), "https://www.google.com");
  assert.equal(sanitizeReferrer("https://instagram.com/", null, hosts), "https://instagram.com");
  assert.equal(sanitizeReferrer("android-app://com.google", null, hosts), null);
  assert.equal(sanitizeReferrer("not a url", null, hosts), null);
  assert.equal(sanitizeReferrer("", null, hosts), null);
});

test("deferred QR marker: internal destinations only, removable", () => {
  assert.equal(withQrArrivalParam("/business/acme", "abc123"), "/business/acme?fmqr=abc123");
  assert.equal(withQrArrivalParam("/event/x?date=2026-11-01", "abc"), "/event/x?date=2026-11-01&fmqr=abc");
  assert.equal(withQrArrivalParam("/event/x#dates", "abc"), "/event/x?fmqr=abc#dates");
  assert.equal(withQrArrivalParam("https://example.com/x", "abc"), "https://example.com/x");
  assert.equal(withQrArrivalParam("//evil.example", "abc"), "//evil.example");
  assert.equal(withQrArrivalParam("/x", "bad code!"), "/x");
  assert.deepEqual(takeQrArrivalParam("?fmqr=abc123"), { code: "abc123", search: "" });
  assert.deepEqual(takeQrArrivalParam("?date=1&fmqr=abc"), { code: "abc", search: "?date=1" });
  assert.deepEqual(takeQrArrivalParam("?fmqr=%3Cscript%3E"), { code: null, search: "" });
  assert.deepEqual(takeQrArrivalParam("?a=1"), { code: null, search: "?a=1" });
});

test("analytics identifiers live 90 days", () => {
  assert.equal(ANALYTICS_IDENTIFIER_MAX_AGE_DAYS, 90);
  const session = read("src/lib/analytics/session.ts");
  assert.ok(!/365 \* 2/.test(session), "no 2-year identifier lifetime remains");
});

test("static guards: every analytics write path checks consent first", () => {
  const track = read("src/app/api/analytics/track/route.ts");
  assert.ok(track.indexOf("isAnalyticsAllowedForRequest") < track.indexOf("resolveSessionId()"), "track route gates before minting findmi_sid");
  assert.match(track, /sanitizeReferrer\(/);
  assert.match(track, /sanitizePagePath\(/);
  const qr = read("src/app/q/[code]/route.ts");
  assert.ok(qr.indexOf("isAnalyticsAllowedForRequest") < qr.indexOf("recordQrScan(admin"), "QR route gates before recording");
  assert.ok(!/resolveSessionId|establishQrAcquisitionIfAbsent/.test(qr), "QR route never mints identifiers itself");
  const arrival = read("src/app/api/analytics/qr-arrival/route.ts");
  assert.ok(arrival.indexOf("isAnalyticsAllowedForRequest") < arrival.indexOf("recordQrScan("), "deferred arrival gates first");
  const client = read("src/lib/analytics/track.ts");
  assert.match(client, /if \(!isAnalyticsAllowedClient\(\)\) return;/);
  const writers = ["src/app/api/analytics/track/route.ts", "src/lib/analytics/qrScan.ts"];
  for (const f of writers) assert.ok(!/x-forwarded-for|x-real-ip|user-agent/i.test(read(f)), `${f} stores no IP or user agent`);
});

test("static guard: Personalized Discovery off disables personal ranking", () => {
  const s = read("src/lib/discovery/server.ts");
  assert.match(s, /if \(!privacy\.personalizedDiscovery\) return null;/);
});
