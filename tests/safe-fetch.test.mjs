// Brand Onboarding V1.1B — hardened single-page website fetcher
// (src/lib/safe-fetch.ts). Destination rules, address rules, the guarded
// DNS lookup (incl. the REAL node:https transport refusing blocked
// addresses before connecting), redirects, content/size/encoding/timeout
// limits. No network: transports are stubs and resolvers are injected.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { gzipSync, brotliCompressSync } from "node:zlib";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".")) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const F = await import("../src/lib/safe-fetch.ts");
const E = await import("../src/lib/brand-website-extract.ts");

// ── Destination rules ─────────────────────────────────────────────────────
test("URL: https only — http and every other scheme are rejected", () => {
  for (const u of ["http://brand.com/", "ftp://brand.com/", "javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "ws://brand.com/", "brand.com", ""]) {
    assert.equal(F.validateFetchUrl(u).ok, false, u);
  }
  const ok = F.validateFetchUrl("https://brand.com/about#team");
  assert.equal(ok.ok, true);
  assert.equal(ok.url.href, "https://brand.com/about", "fragment dropped");
});

test("URL: userinfo and explicit non-default ports are rejected; :443 normalizes away", () => {
  assert.equal(F.validateFetchUrl("https://user:pw@brand.com/").ok, false);
  assert.equal(F.validateFetchUrl("https://user@brand.com/").ok, false);
  for (const p of ["8443", "80", "22", "6379", "1"]) assert.equal(F.validateFetchUrl(`https://brand.com:${p}/`).ok, false, p);
  assert.equal(F.validateFetchUrl("https://brand.com:443/").ok, true);
});

test("URL: localhost, special-use suffixes and single-label hosts are rejected", () => {
  for (const h of ["localhost", "app.localhost", "printer.local", "db.internal", "nas.home.arpa", "x.onion", "a.test", "b.invalid", "c.example", "intranet", "router.lan", "files.corp", "box.localdomain"]) {
    const r = F.validateFetchUrl(`https://${h}/`);
    assert.equal(r.ok, false, h);
  }
});

test("URL: IP literals in every form are rejected (dotted, decimal, hex, octal, IPv6)", () => {
  for (const u of [
    "https://127.0.0.1/",
    "https://8.8.8.8/",
    "https://2130706433/",
    "https://0x7f.0.0.1/",
    "https://0177.0.0.1/",
    "https://[::1]/",
    "https://[2606:4700::1111]/",
    "https://[::ffff:127.0.0.1]/",
  ]) {
    assert.equal(F.validateFetchUrl(u).ok, false, u);
  }
});

test("URL: shared platforms are never a brand's own website", () => {
  for (const u of ["https://instagram.com/brand", "https://www.instagram.com/brand", "https://linktr.ee/brand", "https://www.etsy.com/shop/brand", "https://facebook.com/brand"]) {
    assert.equal(F.validateFetchUrl(u).ok, false, u);
  }
});

test("URL: ordinary brand sites, subdomains, ccTLDs and punycode are allowed", () => {
  for (const u of ["https://brand.com/", "https://www.brand.com/us/", "https://shop.brand.co.uk/x", "https://xn--caf-dma.com/", "https://café.com/"]) {
    assert.equal(F.validateFetchUrl(u).ok, true, u);
  }
});

// ── Address rules ─────────────────────────────────────────────────────────
test("IPv4: private, loopback, link-local/metadata, CGNAT, multicast, reserved, documentation are prohibited", () => {
  for (const ip of [
    "0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.255", "100.64.0.1", "100.127.255.254", "127.0.0.1", "127.8.9.10",
    "169.254.169.254", "169.254.0.1", "172.16.0.1", "172.31.255.255", "192.0.0.8", "192.0.2.5", "192.31.196.1",
    "192.52.193.1", "192.88.99.1", "192.168.1.1", "192.175.48.1", "198.18.0.1", "198.19.255.255", "198.51.100.7",
    "203.0.113.9", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
  ]) {
    assert.equal(F.isProhibitedAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.215.14", "172.32.0.1", "100.128.0.1", "192.169.0.1", "11.0.0.1"]) {
    assert.equal(F.isProhibitedAddress(ip), false, ip);
  }
});

test("IPv6: loopback, unspecified, ULA, link-local, site-local, multicast, NAT64, Teredo, 6to4, documentation, discard are prohibited", () => {
  for (const ip of [
    "::", "::1", "fc00::1", "fd12:3456:789a::1", "fe80::1", "fe80::1%eth0", "fec0::1", "ff02::1",
    "64:ff9b::7f00:1", "64:ff9b::8.8.8.8", "64:ff9b:1::1", "100::1", "2001::1", "2001:0:4136:e378::1",
    "2001:db8::1", "2002:7f00:1::1", "2002:808:808::1", "3fff::1", "::127.0.0.1", "::8.8.8.8", "not-an-ip", "",
  ]) {
    assert.equal(F.isProhibitedAddress(ip), true, ip);
  }
  for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001:80b::200e"]) {
    assert.equal(F.isProhibitedAddress(ip), false, ip);
  }
});

test("IPv4-mapped IPv6 is judged by its IPv4 address (dotted and hex forms)", () => {
  for (const ip of ["::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:7f00:1", "0:0:0:0:0:ffff:c0a8:101"]) {
    assert.equal(F.isProhibitedAddress(ip), true, ip);
  }
  assert.equal(F.isProhibitedAddress("::ffff:8.8.8.8"), false);
  assert.equal(F.isProhibitedAddress("::ffff:808:808"), false);
});

// ── Guarded DNS lookup ────────────────────────────────────────────────────
const lookupWith = (addresses, options = {}) =>
  new Promise((resolve) => {
    const lookup = F.createGuardedLookup(async () => (addresses instanceof Error ? Promise.reject(addresses) : addresses));
    lookup("brand.com", options, (err, address, family) => resolve({ err, address, family }));
  });

test("lookup: ANY prohibited address in a mixed answer refuses the whole request", async () => {
  const r = await lookupWith([{ address: "93.184.215.14", family: 4 }, { address: "10.0.0.5", family: 4 }]);
  assert.equal(r.err?.code, "EFINDMI_BLOCKED_DESTINATION");
  const r6 = await lookupWith([{ address: "2606:4700::1111", family: 6 }, { address: "::1", family: 6 }], { all: true });
  assert.equal(r6.err?.code, "EFINDMI_BLOCKED_DESTINATION");
});

test("lookup: returns only validated addresses, in single and all:true shapes, honoring family", async () => {
  const addrs = [{ address: "93.184.215.14", family: 4 }, { address: "2606:4700::1111", family: 6 }];
  const single = await lookupWith(addrs, {});
  assert.deepEqual([single.err, single.address, single.family], [null, "93.184.215.14", 4]);
  const all = await lookupWith(addrs, { all: true });
  assert.deepEqual(all.address, addrs);
  const v6 = await lookupWith(addrs, { family: 6 });
  assert.equal(v6.address, "2606:4700::1111");
  const none = await lookupWith([], {});
  assert.equal(none.err?.code, "ENOTFOUND");
  const dnsErr = Object.assign(new Error("nope"), { code: "ENOTFOUND" });
  assert.equal((await lookupWith(dnsErr, {})).err?.code, "ENOTFOUND");
});

test("REAL node:https transport: blocked DNS answers are refused before any connection", async () => {
  for (const addresses of [
    [{ address: "127.0.0.1", family: 4 }],
    [{ address: "169.254.169.254", family: 4 }],
    [{ address: "93.184.215.14", family: 4 }, { address: "192.168.0.10", family: 4 }],
    [{ address: "::ffff:10.1.1.1", family: 6 }],
  ]) {
    const transport = F.createHttpsTransport(async () => addresses);
    const r = await F.safeFetchHtml("https://brand-example.com/", { transport });
    assert.deepEqual(r, { ok: false, code: "blocked_destination", redirects: 0 }, JSON.stringify(addresses));
  }
});

// ── Fetch behavior (stub transport) ───────────────────────────────────────
function respond(status, headers = {}, body = "") {
  const chunks = Buffer.isBuffer(body) ? [body] : Array.isArray(body) ? body : [Buffer.from(body)];
  let destroyed = false;
  return {
    status,
    headers,
    body: (async function* () {
      for (const c of chunks) yield c;
    })(),
    destroy: () => {
      destroyed = true;
    },
    get destroyed() {
      return destroyed;
    },
  };
}
const HTML = { "content-type": "text/html; charset=utf-8" };
function stub(routes) {
  const calls = [];
  const transport = async (url) => {
    calls.push(url.href);
    const route = routes[url.href];
    if (!route) throw Object.assign(new Error("unexpected " + url.href), { code: "ECONNREFUSED" });
    return typeof route === "function" ? route() : route;
  };
  return { transport, calls };
}

test("fetch: plain HTML page succeeds; response is always destroyed", async () => {
  const res = respond(200, HTML, "<title>Brand</title>");
  const { transport } = stub({ "https://brand.com/": res });
  const r = await F.safeFetchHtml("https://brand.com/", { transport });
  assert.equal(r.ok, true);
  assert.equal(r.html, "<title>Brand</title>");
  assert.equal(r.bytes, 20);
  assert.equal(r.redirects, 0);
  assert.equal(res.destroyed, true);
});

test("redirects: followed manually, relative Location resolved, each destination re-validated", async () => {
  const { transport, calls } = stub({
    "https://brand.com/": respond(301, { location: "https://www.brand.com/" }),
    "https://www.brand.com/": respond(302, { location: "/us" }),
    "https://www.brand.com/us": respond(200, HTML, "<p>ok</p>"),
  });
  const r = await F.safeFetchHtml("https://brand.com/", { transport });
  assert.equal(r.ok, true);
  assert.equal(r.redirects, 2);
  assert.equal(r.url.href, "https://www.brand.com/us");
  assert.deepEqual(calls, ["https://brand.com/", "https://www.brand.com/", "https://www.brand.com/us"]);
});

test("redirects: https→http downgrade, IPs, localhost, ports, credentials and shared platforms are rejected", async () => {
  for (const location of [
    "http://brand.com/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://localhost/",
    "https://metadata.internal/",
    "https://brand.com:8443/",
    "https://u:p@brand.com/",
    "https://linktr.ee/brand",
    "javascript:alert(1)",
  ]) {
    const { transport, calls } = stub({ "https://brand.com/": respond(302, { location }) });
    const r = await F.safeFetchHtml("https://brand.com/", { transport });
    assert.deepEqual(r, { ok: false, code: "redirect_rejected", redirects: 0 }, location);
    assert.equal(calls.length, 1, "the rejected destination is never requested");
  }
});

test("redirects: loops are detected and more than 3 redirects are refused", async () => {
  const loop = stub({
    "https://a.com/": respond(302, { location: "https://b.com/" }),
    "https://b.com/": respond(302, { location: "https://a.com/" }),
  });
  assert.equal((await F.safeFetchHtml("https://a.com/", { transport: loop.transport })).code, "redirect_loop");
  const chain = stub({
    "https://a.com/": respond(302, { location: "https://a.com/1" }),
    "https://a.com/1": respond(302, { location: "https://a.com/2" }),
    "https://a.com/2": respond(302, { location: "https://a.com/3" }),
    "https://a.com/3": respond(302, { location: "https://a.com/4" }),
    "https://a.com/4": respond(200, HTML, "x"),
  });
  const r = await F.safeFetchHtml("https://a.com/", { transport: chain.transport });
  assert.deepEqual(r, { ok: false, code: "too_many_redirects", redirects: 3 });
  assert.equal(chain.calls.length, 4, "max 3 redirects = at most 4 requests");
  assert.equal(F.SAFE_FETCH_MAX_REDIRECTS, 3);
});

test("status: site refusals (401/403/429/503…) vs other errors; never retried", async () => {
  for (const [status, code] of [[403, "blocked_by_site"], [429, "blocked_by_site"], [503, "blocked_by_site"], [401, "blocked_by_site"], [404, "http_error"], [500, "http_error"], [204, "http_error"]]) {
    const { transport, calls } = stub({ "https://brand.com/": respond(status, HTML, "challenge") });
    const r = await F.safeFetchHtml("https://brand.com/", { transport });
    assert.equal(r.code, code, String(status));
    assert.equal(calls.length, 1);
  }
});

test("MIME: only text/html and application/xhtml+xml are accepted", async () => {
  for (const type of ["application/json", "image/svg+xml", "text/plain", "application/javascript", "image/png", ""]) {
    const { transport } = stub({ "https://brand.com/": respond(200, type ? { "content-type": type } : {}, "x") });
    assert.equal((await F.safeFetchHtml("https://brand.com/", { transport })).code, "unsupported_content", type || "(missing)");
  }
  const { transport } = stub({ "https://brand.com/": respond(200, { "content-type": "application/xhtml+xml" }, "<html/>") });
  assert.equal((await F.safeFetchHtml("https://brand.com/", { transport })).ok, true);
});

// ── Bounded head-first HTML read ──────────────────────────────────────────
// A large modern storefront: metadata in the head, Instagram link early in
// the body, then megabytes of markup/inline scripts.
const KB = 1024;
const HEAD = `<!doctype html><html><head><title>Milk Makeup</title>
  <meta property="og:site_name" content="Milk Makeup">
  <meta name="description" content="Clean, vegan makeup and skincare made for every face, created in a Brooklyn studio since 2016.">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Milk Makeup","url":"https://milkmakeup.com","sameAs":["https://www.instagram.com/milkmakeup/"]}</script>
</head><body><header><a href="/">Milk Makeup</a></header><main><h1>Milk Makeup</h1><p>Clean, vegan makeup and skincare.</p>`;
const FILLER = Buffer.alloc(64 * KB, 0x61);
const fillerChunks = (bytes) => Array(Math.ceil(bytes / FILLER.length)).fill(FILLER);
/** A response whose body NEVER ends (no EOF) — counts how much was pulled. */
function endless(headers, first) {
  let pulled = 0;
  let destroyed = false;
  return {
    status: 200,
    headers,
    body: (async function* () {
      if (first) {
        pulled += first.length;
        yield first;
      }
      for (;;) {
        pulled += FILLER.length;
        yield FILLER;
      }
    })(),
    destroy: () => {
      destroyed = true;
    },
    get destroyed() {
      return destroyed;
    },
    get pulled() {
      return pulled;
    },
  };
}

test("size: limits are bounded constants — 1.5 MB hard ceiling, 256 KB after the head", () => {
  assert.equal(F.SAFE_FETCH_HTML_MAX_BYTES, 1536 * KB);
  assert.equal(F.SAFE_FETCH_HTML_BODY_BYTES, 256 * KB);
  assert.ok(F.SAFE_FETCH_HTML_MAX_BYTES < 2 * F.SAFE_FETCH_MAX_BYTES, "not a blind 5/10 MB raise");
});

test("size: a declared Content-Length over 1 MB no longer auto-rejects HTML; metadata early → success", async () => {
  const body = [Buffer.from(HEAD), ...fillerChunks(3 * 1024 * KB)];
  const declared = stub({ "https://milkmakeup.com/": respond(200, { ...HTML, "content-length": String(3 * 1024 * KB) }, body) });
  const r = await F.safeFetchHtml("https://milkmakeup.com/", { transport: declared.transport });
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.equal(r.declaredBytes, 3 * 1024 * KB);
  assert.equal(r.redirects, 0);
  assert.ok(r.html.includes("Milk Makeup"));
  assert.ok(r.bytes <= HEAD.length + F.SAFE_FETCH_HTML_BODY_BYTES + FILLER.length, `read ${r.bytes}`);
});

test("size: a chunked (no Content-Length) page over 1 MB with early metadata → success, truncated", async () => {
  const chunked = stub({ "https://milkmakeup.com/": respond(200, HTML, [Buffer.from(HEAD), ...fillerChunks(2 * 1024 * KB)]) });
  const r = await F.safeFetchHtml("https://milkmakeup.com/", { transport: chunked.transport });
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.equal(r.declaredBytes, null);
  assert.ok(r.bytes < F.SAFE_FETCH_MAX_BYTES);
});

test("size: reading stops after the head + bounded body excerpt WITHOUT waiting for EOF", async () => {
  const res = endless(HTML, Buffer.from(HEAD));
  const r = await F.safeFetchHtml("https://milkmakeup.com/", { transport: async () => res });
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  const headEnd = HEAD.indexOf("</head>");
  assert.ok(r.bytes >= headEnd + F.SAFE_FETCH_HTML_BODY_BYTES, "full body excerpt kept");
  assert.ok(r.bytes <= headEnd + F.SAFE_FETCH_HTML_BODY_BYTES + FILLER.length, `bounded: ${r.bytes}`);
  assert.ok(res.pulled <= headEnd + F.SAFE_FETCH_HTML_BODY_BYTES + 4 * FILLER.length, `pulled ${res.pulled}`);
  assert.equal(res.destroyed, true);
  // A small page still reads to EOF and is reported complete.
  const small = stub({ "https://brand.com/": respond(200, HTML, HEAD + "</main></body></html>") });
  const c = await F.safeFetchHtml("https://brand.com/", { transport: small.transport });
  assert.equal(c.truncated, false);
  assert.equal(c.bytes, Buffer.byteLength(HEAD + "</main></body></html>"));
});

test("size: a huge page whose head never ends is refused at the hard ceiling (streamed limit)", async () => {
  const res = endless(HTML, Buffer.from("<html><head><title>x</title>"));
  const r = await F.safeFetchHtml("https://brand.com/", { transport: async () => res });
  assert.deepEqual(r, { ok: false, code: "too_large", redirects: 0, limit: "streamed", declaredBytes: null });
  assert.ok(res.pulled <= F.SAFE_FETCH_HTML_MAX_BYTES + 4 * FILLER.length, `pulled ${res.pulled}`);
  // Under the ceiling with no head end, a finite page still reads to EOF.
  const finite = stub({ "https://brand.com/": respond(200, HTML, fillerChunks(17 * 64 * KB)) });
  const f = await F.safeFetchHtml("https://brand.com/", { transport: finite.transport });
  assert.equal(f.ok, true);
  assert.equal(f.truncated, false);
  // The head ends only AFTER the ceiling → still refused, never over-read.
  const late = stub({ "https://brand.com/": respond(200, HTML, [...fillerChunks(F.SAFE_FETCH_HTML_MAX_BYTES), Buffer.from("</head><body>")]) });
  assert.equal((await F.safeFetchHtml("https://brand.com/", { transport: late.transport })).code, "too_large");
  // Response headers over the limit are reported as the header limit.
  const overflow = async () => {
    throw Object.assign(new Error("overflow"), { code: "HPE_HEADER_OVERFLOW" });
  };
  assert.deepEqual(await F.safeFetchHtml("https://brand.com/", { transport: overflow }), { ok: false, code: "too_large", redirects: 0, limit: "headers", declaredBytes: null });
});

test("size: compressed oversized pages — head-first success, and the bomb is bounded on DECOMPRESSED bytes", async () => {
  const page = Buffer.concat([Buffer.from(HEAD), ...fillerChunks(8 * 1024 * KB)]);
  for (const [encoding, compress] of [["gzip", gzipSync], ["br", brotliCompressSync]]) {
    const wire = compress(page);
    assert.ok(wire.length < F.SAFE_FETCH_HTML_MAX_BYTES, "small on the wire");
    const t = stub({ "https://brand.com/": respond(200, { ...HTML, "content-encoding": encoding }, wire) });
    const r = await F.safeFetchHtml("https://brand.com/", { transport: t.transport });
    assert.equal(r.ok, true, encoding);
    assert.equal(r.truncated, true);
    assert.ok(r.bytes <= HEAD.length + F.SAFE_FETCH_HTML_BODY_BYTES + 64 * KB, `${encoding} decompressed ${r.bytes}`);
  }
  // No head end inside the ceiling: refused at the DECOMPRESSED ceiling.
  const bomb = stub({ "https://brand.com/": respond(200, { ...HTML, "content-encoding": "gzip" }, gzipSync(Buffer.alloc(50 * 1024 * KB))) });
  const b = await F.safeFetchHtml("https://brand.com/", { transport: bomb.transport });
  assert.equal(b.code, "too_large");
  assert.equal(b.limit, "streamed");
});

test("size: image profile unchanged — declared or streamed over 5 MB is refused, no head-first read", async () => {
  const PNG = { "content-type": "image/png" };
  const declared = stub({ "https://cdn.brand.com/logo.png": respond(200, { ...PNG, "content-length": String(F.SAFE_FETCH_IMAGE_MAX_BYTES + 1) }, "x") });
  assert.deepEqual(await F.safeFetchImage("https://cdn.brand.com/logo.png", { transport: declared.transport }), {
    ok: false,
    code: "too_large",
    redirects: 0,
    limit: "declared",
    declaredBytes: F.SAFE_FETCH_IMAGE_MAX_BYTES + 1,
  });
  // Even bytes that look like an HTML head never trigger an early stop.
  const looks = [Buffer.from("</head><body>"), ...fillerChunks(F.SAFE_FETCH_IMAGE_MAX_BYTES + KB)];
  const streamed = stub({ "https://cdn.brand.com/logo.png": respond(200, PNG, looks) });
  const s = await F.safeFetchImage("https://cdn.brand.com/logo.png", { transport: streamed.transport });
  assert.equal(s.code, "too_large");
  assert.equal(s.limit, "streamed");
  const ok = stub({ "https://cdn.brand.com/logo.png": respond(200, PNG, "png-bytes") });
  assert.deepEqual(Object.keys(await F.safeFetchImage("https://cdn.brand.com/logo.png", { transport: ok.transport })).sort(), ["body", "bytes", "contentType", "ok", "redirects", "url"]);
});

test("size: the extractor reads a truncated document (name, description, JSON-LD, Instagram)", async () => {
  const res = endless(HTML, Buffer.from(HEAD + '<footer><a href="https://www.instagram.com/milkmakeup/">IG</a></footer><div>'));
  const r = await F.safeFetchHtml("https://milkmakeup.com/", { transport: async () => res });
  assert.equal(r.truncated, true);
  const profile = E.extractBrandProfile(r.html, r.url);
  assert.equal(profile.name, "Milk Makeup");
  assert.match(profile.shortDescription ?? "", /vegan makeup/);
  assert.equal(profile.instagramHandle, "milkmakeup");
});

test("decompression: gzip and br are decoded; a compression bomb is cut off at the DECOMPRESSED ceiling", async () => {
  const page = "<html><title>Brand</title></html>";
  const gz = stub({ "https://brand.com/": respond(200, { ...HTML, "content-encoding": "gzip" }, gzipSync(page)) });
  assert.equal((await F.safeFetchHtml("https://brand.com/", { transport: gz.transport })).html, page);
  const br = stub({ "https://brand.com/": respond(200, { ...HTML, "content-encoding": "br" }, brotliCompressSync(page)) });
  assert.equal((await F.safeFetchHtml("https://brand.com/", { transport: br.transport })).html, page);
  const bombBytes = gzipSync(Buffer.alloc(20 * 1024 * 1024));
  assert.ok(bombBytes.length < 64 * 1024, "small on the wire");
  const bomb = stub({ "https://brand.com/": respond(200, { ...HTML, "content-encoding": "gzip" }, bombBytes) });
  assert.equal((await F.safeFetchHtml("https://brand.com/", { transport: bomb.transport })).code, "too_large");
  const odd = stub({ "https://brand.com/": respond(200, { ...HTML, "content-encoding": "compress" }, "x") });
  assert.equal((await F.safeFetchHtml("https://brand.com/", { transport: odd.transport })).code, "unsupported_content");
  const corrupt = stub({ "https://brand.com/": respond(200, { ...HTML, "content-encoding": "gzip" }, "not gzip") });
  assert.equal((await F.safeFetchHtml("https://brand.com/", { transport: corrupt.transport })).ok, false);
});

test("timeout: a hanging connection or a stalled body ends at the deadline", async () => {
  const hang = async (_url, signal) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  assert.equal((await F.safeFetchHtml("https://brand.com/", { transport: hang, timeoutMs: 30 })).code, "timeout");
  const stalled = async () => ({
    status: 200,
    headers: HTML,
    body: (async function* () {
      yield Buffer.from("<html>");
      await new Promise(() => {});
    })(),
    destroy() {},
  });
  assert.equal((await F.safeFetchHtml("https://brand.com/", { transport: stalled, timeoutMs: 30 })).code, "timeout");
  assert.equal(F.SAFE_FETCH_TIMEOUT_MS, 8000);
});

test("transport errors map to coded results", async () => {
  for (const [code, expected] of [["ENOTFOUND", "dns_failed"], ["EAI_AGAIN", "dns_failed"], ["ECONNREFUSED", "network_error"], ["CERT_HAS_EXPIRED", "network_error"], ["ETIMEDOUT", "timeout"], ["HPE_HEADER_OVERFLOW", "too_large"], ["EFINDMI_BLOCKED_DESTINATION", "blocked_destination"]]) {
    const transport = async () => {
      throw Object.assign(new Error(code), { code });
    };
    assert.equal((await F.safeFetchHtml("https://brand.com/", { transport })).code, expected, code);
  }
});

test("charset: declared legacy charsets decode; unknown labels fall back to UTF-8", async () => {
  const latin = Buffer.from([0x3c, 0x70, 0x3e, 0x43, 0x61, 0x66, 0xe9, 0x3c, 0x2f, 0x70, 0x3e]); // <p>Café</p> in windows-1252
  const a = stub({ "https://brand.com/": respond(200, { "content-type": "text/html; charset=windows-1252" }, latin) });
  assert.equal((await F.safeFetchHtml("https://brand.com/", { transport: a.transport })).html, "<p>Café</p>");
  const b = stub({ "https://brand.com/": respond(200, { "content-type": "text/html; charset=bogus-9" }, "<p>ok</p>") });
  assert.equal((await F.safeFetchHtml("https://brand.com/", { transport: b.transport })).html, "<p>ok</p>");
});

test("no JavaScript execution: fetched scripts and handlers are never run", async () => {
  const page = `<html><head><title>Brand</title><script>globalThis.__findmiPwned = 1</script></head>
    <body onload="globalThis.__findmiPwned = 2"><img src=x onerror="globalThis.__findmiPwned = 3"><meta http-equiv="refresh" content="0;url=https://evil.example/"></body></html>`;
  const { transport, calls } = stub({ "https://brand.com/": respond(200, HTML, page) });
  const r = await F.safeFetchHtml("https://brand.com/", { transport });
  E.extractBrandProfile(r.html, r.url);
  assert.equal(globalThis.__findmiPwned, undefined);
  assert.deepEqual(calls, ["https://brand.com/"], "meta refresh is not followed");
});

test("static: node:https with guarded lookup, no global fetch, TLS verified, no cookies/auth/referer, honest UA", () => {
  const src = readFileSync("src/lib/safe-fetch.ts", "utf8");
  assert.match(src, /^import "server-only";/);
  assert.doesNotMatch(src, /(?<![\w.])fetch\(/, "global fetch is never used");
  assert.match(src, /lookup: lookup as never/);
  assert.match(src, /rejectUnauthorized: true/);
  assert.doesNotMatch(src, /rejectUnauthorized: false|NODE_TLS_REJECT_UNAUTHORIZED/);
  assert.match(src, /agent: false/);
  assert.match(src, /maxHeaderSize: SAFE_FETCH_MAX_HEADER_BYTES/);
  const headersBlock = src.slice(src.indexOf("const REQUEST_HEADERS"), src.indexOf("};", src.indexOf("const REQUEST_HEADERS")));
  assert.deepEqual([...headersBlock.matchAll(/^\s+"?([\w-]+)"?:/gm)].map((m) => m[1]), ["User-Agent", "Accept", "Accept-Language", "Accept-Encoding"]);
  assert.match(F.SAFE_FETCH_USER_AGENT, /^FindmiBot\/1\.0 /);
  assert.doesNotMatch(src, /\/robots\.txt/, "robots.txt is not fetched (one user-requested page, not crawling)");
  assert.equal(F.SAFE_FETCH_MAX_BYTES, 1024 * 1024);
});
