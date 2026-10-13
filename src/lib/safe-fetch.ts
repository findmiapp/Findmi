import "server-only";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { normalizeWebsiteHost } from "./business-matching";

/** Brand Onboarding V1.1B — the ONE server-side fetcher for a website a
 * signed-in visitor asks Findmi to read (lib/brand-website-analysis.ts).
 * Retrieves exactly one HTML page; it never crawls, never runs scripts,
 * never follows meta-refresh, never fetches images/scripts/styles.
 *
 * Trust boundary — what this enforces:
 *   - https: only, default port 443 only, no userinfo, no IP literals, no
 *     single-label / special-use hostnames (localhost, .local, .internal,
 *     .home.arpa, .onion, .test …), no shared-platform hosts (instagram,
 *     linktr.ee … — the same list lib/business-matching.ts uses);
 *   - DNS is resolved by OUR lookup (node:https `lookup` option), every
 *     returned address is checked, and the request is refused when ANY
 *     address is private/loopback/link-local/CGNAT/metadata/multicast/
 *     reserved/documentation (IPv4), or outside IPv6 global unicast,
 *     Teredo/6to4/NAT64/documentation (IPv6). IPv4-mapped IPv6 is judged
 *     by its IPv4 address. The socket then connects only to an address
 *     that passed the check, so a DNS answer can't change between
 *     "checked" and "connected" for this connection;
 *   - redirects are followed manually (max 3), each destination is fully
 *     re-validated and re-resolved, https→http downgrades and loops are
 *     refused;
 *   - TLS verification always on; no cookies, Authorization, Referer or
 *     visitor IP are sent; an honest Findmi User-Agent is;
 *   - HTML/XHTML only; response headers ≤ 16 KB; body streamed and capped
 *     at 1 MB both before and AFTER decompression; 8 s overall deadline
 *     plus a 3 s socket inactivity timeout.
 *
 * Remaining limitations (not claimed away): the platform's resolver is
 * trusted to answer honestly; a public site can still serve misleading or
 * hostile content (everything extracted is an untrusted suggestion that a
 * person reviews); IPv6 rules are a deny-by-default allowlist of global
 * unicast, so a future special-purpose range inside 2000::/3 would need
 * adding here. Global `fetch` is deliberately NOT used: it resolves DNS
 * internally with no hook to validate the address it connects to. */

export const SAFE_FETCH_MAX_REDIRECTS = 3;
/** The V1.1B whole-document limit. HTML is no longer rejected for being
 * larger than this (see the bounded head-first read below); it remains
 * only as the reference for the `declaredOverLegacyLimit` log flag. */
export const SAFE_FETCH_MAX_BYTES = 1024 * 1024;
/** HTML analysis — ABSOLUTE ceiling on bytes consumed, enforced on both
 * the raw (compressed) and the decompressed stream. Never exceeded. */
export const SAFE_FETCH_HTML_MAX_BYTES = 1536 * 1024;
/** HTML analysis — once the document head has ended (`</head>` or
 * `<body>`), read at most this much more (early body: headings,
 * paragraphs, social links for the excerpt), then stop on purpose. */
export const SAFE_FETCH_HTML_BODY_BYTES = 256 * 1024;
export const SAFE_FETCH_TIMEOUT_MS = 8000;
export const SAFE_FETCH_SOCKET_TIMEOUT_MS = 3000;
export const SAFE_FETCH_MAX_HEADER_BYTES = 16 * 1024;
export const SAFE_FETCH_USER_AGENT = "FindmiBot/1.0 (+https://findmi.app; one-page brand profile preview requested by a Findmi user)";

const REQUEST_HEADERS: Readonly<Record<string, string>> = {
  "User-Agent": SAFE_FETCH_USER_AGENT,
  Accept: "text/html,application/xhtml+xml;q=0.9",
  "Accept-Language": "en-US,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
};

export type SafeFetchFailure =
  | "invalid_url"
  | "blocked_destination"
  | "dns_failed"
  | "timeout"
  | "too_many_redirects"
  | "redirect_loop"
  | "redirect_rejected"
  | "blocked_by_site"
  | "http_error"
  | "unsupported_content"
  | "too_large"
  | "network_error";

/** Which size guard produced a `too_large` (safe observability only). */
export type SafeFetchSizeLimit = "declared" | "streamed" | "headers";

export type SafeFetchResult =
  | {
      ok: true;
      url: URL;
      html: string;
      /** Decompressed bytes actually consumed. */
      bytes: number;
      redirects: number;
      /** True when reading stopped on purpose after the head + bounded body. */
      truncated: boolean;
      /** The server's Content-Length, if any (observability only). */
      declaredBytes: number | null;
    }
  | { ok: false; code: SafeFetchFailure; redirects: number; limit?: SafeFetchSizeLimit; declaredBytes?: number | null };

// ── Destination rules ─────────────────────────────────────────────────────

const SPECIAL_USE_SUFFIXES = [
  "localhost",
  "localdomain",
  "local",
  "internal",
  "intranet",
  "lan",
  "home",
  "corp",
  "private",
  "home.arpa",
  "arpa",
  "onion",
  "test",
  "invalid",
  "example",
];
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/** Hostname rules for a fetch target (exported for tests). Expects the
 * WHATWG-normalized `URL.hostname` (lowercase, punycode, IPv4 numeric
 * forms already canonicalized to dotted-quad). */
export function isAllowedFetchHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253 || host.startsWith("[") || isIP(host) !== 0) return false;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return false;
  if (!TLD.test(labels[labels.length - 1])) return false;
  return !SPECIAL_USE_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

/** Validates an absolute fetch target. Returns a copy without fragment. */
export function validateFetchUrl(input: string | URL): { ok: true; url: URL } | { ok: false; code: SafeFetchFailure } {
  let url: URL;
  try {
    url = new URL(typeof input === "string" ? input : input.href);
  } catch {
    return { ok: false, code: "invalid_url" };
  }
  if (url.protocol !== "https:") return { ok: false, code: "invalid_url" };
  if (url.username || url.password) return { ok: false, code: "invalid_url" };
  if (url.port !== "") return { ok: false, code: "invalid_url" };
  if (!isAllowedFetchHostname(url.hostname)) return { ok: false, code: "blocked_destination" };
  // Shared platforms (instagram.com, linktr.ee, etsy.com …) are never a
  // brand's own website — same list the Business matcher uses.
  if (normalizeWebsiteHost(url.href) === null) return { ok: false, code: "blocked_destination" };
  url.hash = "";
  return { ok: true, url };
}

// ── Address rules ─────────────────────────────────────────────────────────

const BLOCKED_V4 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.31.196.0", 24], // AS112
  ["192.52.193.0", 24], // AMT
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["192.175.48.0", 24], // AS112
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  BLOCKED_V4.addSubnet(net, prefix, "ipv4");
}

/** IPv6 is allow-by-range: only global unicast (2000::/3) can pass, minus
 * the special-purpose blocks inside it. Everything else — ::, ::1, the
 * IPv4-compatible ::/96, 64:ff9b::/96 NAT64, 100::/64 discard, fc00::/7
 * ULA, fe80::/10 link-local, fec0::/10, ff00::/8 multicast — is outside
 * 2000::/3 and therefore refused. */
const GLOBAL_V6 = new BlockList();
GLOBAL_V6.addSubnet("2000::", 3, "ipv6");
const BLOCKED_V6 = new BlockList();
for (const [net, prefix] of [
  ["2001::", 23], // IETF protocol assignments, incl. Teredo 2001::/32
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["3fff::", 20], // documentation
] as const) {
  BLOCKED_V6.addSubnet(net, prefix, "ipv6");
}

/** Expands an IPv6 address (no zone id) to 8 16-bit groups, or null. */
function ipv6Groups(address: string): number[] | null {
  let addr = address;
  const tail: number[] = [];
  const dotted = addr.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const octets = dotted[2].split(".").map(Number);
    if (octets.some((o) => o > 255)) return null;
    tail.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
    addr = dotted[1].endsWith("::") ? dotted[1] : dotted[1].slice(0, -1);
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(":").map((h) => parseInt(h, 16)) : []);
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const fill = 8 - tail.length - head.length - rest.length;
  if (halves.length === 1 ? fill !== 0 : fill < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill(0), ...rest, ...tail];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** True when a resolved address must never be connected to (exported for
 * tests). Unparseable input is prohibited. */
export function isProhibitedAddress(address: string): boolean {
  if (address.includes("%")) return true; // zone-scoped (link-local) address
  const family = isIP(address);
  if (family === 4) return BLOCKED_V4.check(address, "ipv4");
  if (family !== 6) return true;
  const groups = ipv6Groups(address);
  if (!groups) return true;
  // IPv4-mapped (::ffff:a.b.c.d) → judged as the IPv4 address it reaches.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const v4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    return BLOCKED_V4.check(v4, "ipv4");
  }
  if (!GLOBAL_V6.check(address, "ipv6")) return true;
  return BLOCKED_V6.check(address, "ipv6");
}

// ── Controlled DNS lookup ─────────────────────────────────────────────────

export type ResolveAll = (hostname: string) => Promise<LookupAddress[]>;

export const systemResolveAll: ResolveAll = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => (err ? reject(err) : resolve(addresses)));
  });

const BLOCKED_ERROR_CODE = "EFINDMI_BLOCKED_DESTINATION";

function codedError(code: string, message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** The `lookup` handed to node:https. Resolves ALL addresses, refuses the
 * connection if ANY is prohibited, and otherwise returns only validated
 * addresses — the socket can't connect anywhere else. Handles both the
 * single-address and `all: true` (autoSelectFamily) call shapes. */
export function createGuardedLookup(resolveAll: ResolveAll) {
  return (hostname: string, options: { family?: number | string; all?: boolean } | number | undefined, callback: LookupCallback) => {
    const opts = typeof options === "object" && options ? options : { family: options };
    resolveAll(hostname).then(
      (addresses) => {
        if (addresses.length === 0) return callback(codedError("ENOTFOUND", "no addresses"), "", 0);
        if (addresses.some((a) => isProhibitedAddress(a.address))) {
          return callback(codedError(BLOCKED_ERROR_CODE, "destination not allowed"), "", 0);
        }
        const wanted = opts.family === 4 || opts.family === "IPv4" ? 4 : opts.family === 6 || opts.family === "IPv6" ? 6 : 0;
        const usable = wanted ? addresses.filter((a) => a.family === wanted) : addresses;
        if (usable.length === 0) return callback(codedError("ENOTFOUND", "no usable addresses"), "", 0);
        if (opts.all) return callback(null, usable);
        callback(null, usable[0].address, usable[0].family);
      },
      (err: NodeJS.ErrnoException) => callback(err, "", 0)
    );
  };
}

// ── Transport ─────────────────────────────────────────────────────────────

export interface TransportResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Buffer>;
  destroy: () => void;
}
/** `accept` overrides only the Accept header (the image profile asks for
 * images); every other request header is fixed. */
export type Transport = (url: URL, signal: AbortSignal, accept?: string) => Promise<TransportResponse>;

/** Real transport: one GET over node:https through the guarded lookup.
 * No agent reuse, no proxy, TLS verification on, bounded headers. */
export function createHttpsTransport(resolveAll: ResolveAll = systemResolveAll): Transport {
  const lookup = createGuardedLookup(resolveAll);
  return (url, signal, accept) =>
    new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          protocol: "https:",
          hostname: url.hostname,
          port: 443,
          path: `${url.pathname}${url.search}`,
          method: "GET",
          headers: accept ? { ...REQUEST_HEADERS, Accept: accept } : REQUEST_HEADERS,
          lookup: lookup as never,
          agent: false,
          rejectUnauthorized: true,
          maxHeaderSize: SAFE_FETCH_MAX_HEADER_BYTES,
          timeout: SAFE_FETCH_SOCKET_TIMEOUT_MS,
          signal,
        },
        (res) =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: res,
            destroy: () => res.destroy(),
          })
      );
      req.on("timeout", () => req.destroy(codedError("ETIMEDOUT", "socket timeout")));
      req.on("error", reject);
      req.end();
    });
}

// ── Fetch ─────────────────────────────────────────────────────────────────

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SITE_REFUSAL_STATUSES = new Set([401, 403, 407, 429, 451, 503]);
const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);

function header(headers: TransportResponse["headers"], name: string): string | null {
  const v = headers[name];
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

function mapTransportError(err: unknown, aborted: boolean): SafeFetchFailure {
  if (aborted) return "timeout";
  const code = (err as NodeJS.ErrnoException | null)?.code ?? "";
  if (code === BLOCKED_ERROR_CODE) return "blocked_destination";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA" || code === "ESERVFAIL") return "dns_failed";
  if (code === "ETIMEDOUT" || code === "ABORT_ERR" || (err as Error | null)?.name === "AbortError") return "timeout";
  if (code === "HPE_HEADER_OVERFLOW") return "too_large";
  return "network_error";
}

class TooLarge extends Error {}
class StopReading extends Error {}

/** End of the document head: `</head>` or the start of `<body>`. ASCII
 * bytes, so it is found the same way in UTF-8 and Latin-1 pages. */
const HEAD_END = /<\/head[\s>]|<body[\s>]/i;
const HEAD_END_OVERLAP = 16;

/** Streams the body through an optional decompressor with a HARD ceiling
 * (`max`) on both the raw and the DECOMPRESSED byte counts (the
 * decompressor emits bounded chunks, so memory stays bounded and a
 * compression bomb is cut off). With `headStop` (HTML analysis), reading
 * stops on purpose once the head has ended and `headStop.bodyBytes` more
 * have arrived — and reaching the ceiling AFTER the head has ended is also
 * a successful truncated read. Only a ceiling hit before the head ends is
 * `TooLarge`. Never needs EOF. */
async function readBody(
  body: AsyncIterable<Buffer>,
  encoding: string,
  max: number,
  signal: AbortSignal,
  headStop?: { bodyBytes: number }
): Promise<{ buffer: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  let exceeded = false;
  let stopped = false;
  let headEnd = -1;
  let tail = "";
  async function* capped(source: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
    let raw = 0;
    for await (const chunk of source) {
      raw += chunk.length;
      if (raw > max) {
        if (headStop && headEnd >= 0) {
          stopped = true;
          throw new StopReading();
        }
        exceeded = true;
        throw new TooLarge();
      }
      yield chunk;
    }
  }
  const collect = async (source: AsyncIterable<Buffer>) => {
    for await (const chunk of source) {
      const room = max - total;
      const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
      if (headStop && headEnd < 0) {
        const text = tail + piece.toString("latin1");
        const m = HEAD_END.exec(text);
        if (m) headEnd = total - tail.length + m.index;
        tail = text.slice(-HEAD_END_OVERLAP);
      }
      chunks.push(piece);
      total += piece.length;
      if (chunk.length > room) {
        // The hard ceiling: a success only if the head already ended.
        if (headStop && headEnd >= 0) {
          stopped = true;
          throw new StopReading();
        }
        exceeded = true;
        throw new TooLarge();
      }
      if (headStop && headEnd >= 0 && total - headEnd >= headStop.bodyBytes) {
        stopped = true;
        throw new StopReading();
      }
    }
  };
  const raw = Readable.from(capped(body));
  try {
    if (encoding === "gzip" || encoding === "x-gzip") await pipeline(raw, createGunzip(), collect, { signal });
    else if (encoding === "deflate") await pipeline(raw, createInflate(), collect, { signal });
    else if (encoding === "br") await pipeline(raw, createBrotliDecompress(), collect, { signal });
    else await pipeline(raw, collect, { signal });
  } catch (err) {
    // pipeline may surface a secondary error (e.g. premature close) — the
    // decision is the flag, not the error object.
    if (stopped) return { buffer: Buffer.concat(chunks, total), truncated: true };
    if (exceeded) throw new TooLarge();
    throw err;
  }
  return { buffer: Buffer.concat(chunks, total), truncated: false };
}

function decodeHtml(buffer: Buffer, contentType: string): string {
  const charset = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType)?.[1];
  if (charset) {
    try {
      return new TextDecoder(charset).decode(buffer);
    } catch {
      // unknown label → UTF-8 below
    }
  }
  return new TextDecoder("utf-8").decode(buffer);
}

function abortedPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const abort = () => reject(codedError("ABORT_ERR", "deadline"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export interface SafeFetchOptions {
  transport?: Transport;
  timeoutMs?: number;
}

/** What one fetch accepts. Only these vary between profiles — every
 * destination, DNS, redirect, TLS, timeout and header rule above is shared. */
interface FetchProfile {
  accept: string | undefined;
  mediaTypes: ReadonlySet<string>;
  /** Hard ceiling on raw and decompressed bytes consumed. */
  maxBytes: number;
  /** Refuse up front when Content-Length exceeds `maxBytes` (whole-file
   * resources). HTML analysis reads a bounded prefix instead. */
  rejectDeclaredOverMax: boolean;
  headStop?: { bodyBytes: number };
}

const HTML_PROFILE: FetchProfile = {
  accept: undefined,
  mediaTypes: HTML_TYPES,
  maxBytes: SAFE_FETCH_HTML_MAX_BYTES,
  rejectDeclaredOverMax: false,
  headStop: { bodyBytes: SAFE_FETCH_HTML_BODY_BYTES },
};

/** Brand Onboarding V1.1C — logo/cover candidates. Raster formats the
 * existing upload pipeline accepts (validateImageFile); SVG and ICO are
 * never requested or accepted. Same 5 MB cap as owner uploads. */
export const SAFE_FETCH_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const SAFE_FETCH_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const IMAGE_PROFILE: FetchProfile = {
  accept: "image/png,image/jpeg,image/webp,image/gif;q=0.8",
  mediaTypes: SAFE_FETCH_IMAGE_TYPES,
  maxBytes: SAFE_FETCH_IMAGE_MAX_BYTES,
  rejectDeclaredOverMax: true,
};

type ResourceResult =
  | { ok: true; url: URL; body: Buffer; contentType: string; bytes: number; redirects: number; truncated: boolean; declaredBytes: number | null }
  | { ok: false; code: SafeFetchFailure; redirects: number; limit?: SafeFetchSizeLimit; declaredBytes?: number | null };

async function safeFetchResource(input: string | URL, profile: FetchProfile, options: SafeFetchOptions): Promise<ResourceResult> {
  const transport = options.transport ?? createHttpsTransport();
  const first = validateFetchUrl(input);
  if (!first.ok) return { ok: false, code: first.code, redirects: 0 };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? SAFE_FETCH_TIMEOUT_MS);
  let url = first.url;
  let redirects = 0;
  const visited = new Set<string>();
  let declaredBytes: number | null = null;
  const fail = (code: SafeFetchFailure, limit?: SafeFetchSizeLimit): ResourceResult =>
    limit ? { ok: false, code, redirects, limit, declaredBytes } : { ok: false, code, redirects };

  try {
    for (;;) {
      visited.add(url.href);
      let res: TransportResponse;
      try {
        res = await transport(url, controller.signal, profile.accept);
      } catch (err) {
        const code = mapTransportError(err, controller.signal.aborted);
        return fail(code, code === "too_large" ? "headers" : undefined);
      }
      try {
        if (REDIRECT_STATUSES.has(res.status)) {
          const location = header(res.headers, "location");
          if (!location) return fail("http_error");
          if (redirects >= SAFE_FETCH_MAX_REDIRECTS) return fail("too_many_redirects");
          let next: URL;
          try {
            next = new URL(location, url);
          } catch {
            return fail("redirect_rejected");
          }
          const checked = validateFetchUrl(next); // also refuses https→http
          if (!checked.ok) return fail("redirect_rejected");
          if (visited.has(checked.url.href)) return fail("redirect_loop");
          redirects += 1;
          url = checked.url;
          continue;
        }
        if (res.status !== 200) {
          return fail(SITE_REFUSAL_STATUSES.has(res.status) ? "blocked_by_site" : "http_error");
        }
        const contentType = header(res.headers, "content-type") ?? "";
        const mediaType = contentType.split(";")[0].trim().toLowerCase();
        if (!profile.mediaTypes.has(mediaType)) return fail("unsupported_content");
        const declaredLength = Number(header(res.headers, "content-length") ?? NaN);
        declaredBytes = Number.isFinite(declaredLength) && declaredLength >= 0 ? declaredLength : null;
        if (profile.rejectDeclaredOverMax && declaredBytes !== null && declaredBytes > profile.maxBytes) return fail("too_large", "declared");
        const encoding = (header(res.headers, "content-encoding") ?? "identity").trim().toLowerCase();
        if (!["identity", "", "gzip", "x-gzip", "deflate", "br"].includes(encoding)) return fail("unsupported_content");
        let read: { buffer: Buffer; truncated: boolean };
        // The deadline must hold even if a body stream never settles: the
        // response is destroyed on abort AND the read is raced against it.
        const onAbort = () => res.destroy();
        controller.signal.addEventListener("abort", onAbort, { once: true });
        try {
          const reading = readBody(res.body, encoding, profile.maxBytes, controller.signal, profile.headStop);
          reading.catch(() => undefined); // a late rejection after the race is not unhandled
          read = await Promise.race([reading, abortedPromise(controller.signal)]);
        } catch (err) {
          if (err instanceof TooLarge) return fail("too_large", "streamed");
          if (controller.signal.aborted) return fail("timeout");
          return fail((err as NodeJS.ErrnoException)?.code?.startsWith("Z_") ? "unsupported_content" : "network_error");
        } finally {
          controller.signal.removeEventListener("abort", onAbort);
        }
        return {
          ok: true,
          url,
          body: read.buffer,
          contentType,
          bytes: read.buffer.length,
          redirects,
          truncated: read.truncated,
          declaredBytes,
        };
      } finally {
        res.destroy();
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Retrieves ONE HTML page from a validated https URL. Never throws for
 * network/site problems — every failure is a coded result. */
export async function safeFetchHtml(input: string | URL, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const r = await safeFetchResource(input, HTML_PROFILE, options);
  if (!r.ok) return r;
  return {
    ok: true,
    url: r.url,
    html: decodeHtml(r.body, r.contentType),
    bytes: r.bytes,
    redirects: r.redirects,
    truncated: r.truncated,
    declaredBytes: r.declaredBytes,
  };
}

export type SafeFetchImageResult =
  | { ok: true; url: URL; body: Buffer; contentType: string; bytes: number; redirects: number }
  | { ok: false; code: SafeFetchFailure; redirects: number; limit?: SafeFetchSizeLimit; declaredBytes?: number | null };

/** Retrieves ONE raster image (PNG/JPEG/WebP/GIF, ≤ 5 MB) under exactly the
 * same destination/DNS/redirect/TLS/timeout rules as safeFetchHtml. The
 * declared type is only a first gate — callers must still validate the
 * actual bytes (lib/brand-images.ts → validateImageFile + sharp). */
export async function safeFetchImage(input: string | URL, options: SafeFetchOptions = {}): Promise<SafeFetchImageResult> {
  const r = await safeFetchResource(input, IMAGE_PROFILE, options);
  if (!r.ok) return r;
  return { ok: true, url: r.url, body: r.body, contentType: r.contentType, bytes: r.bytes, redirects: r.redirects };
}

/** VCL A3 — a site's web app manifest (`<link rel="manifest">`), read only
 * for its declared icons when no logo candidate on the page verified.
 * Small JSON document, same destination/DNS/redirect/TLS/timeout rules as
 * every other fetch here. */
export const SAFE_FETCH_MANIFEST_MAX_BYTES = 64 * 1024;
export const SAFE_FETCH_MANIFEST_TYPES: ReadonlySet<string> = new Set(["application/manifest+json", "application/json", "text/json"]);
const MANIFEST_PROFILE: FetchProfile = {
  accept: "application/manifest+json,application/json;q=0.9",
  mediaTypes: SAFE_FETCH_MANIFEST_TYPES,
  maxBytes: SAFE_FETCH_MANIFEST_MAX_BYTES,
  rejectDeclaredOverMax: true,
};

export type SafeFetchManifestResult =
  | { ok: true; url: URL; text: string }
  | { ok: false; code: SafeFetchFailure; redirects: number; limit?: SafeFetchSizeLimit; declaredBytes?: number | null };

/** Retrieves ONE web app manifest (≤ 64 KB JSON). The text is untrusted;
 * callers parse it with bounds (see manifestIconCandidates). */
export async function safeFetchManifest(input: string | URL, options: SafeFetchOptions = {}): Promise<SafeFetchManifestResult> {
  const r = await safeFetchResource(input, MANIFEST_PROFILE, options);
  if (!r.ok) return r;
  return { ok: true, url: r.url, text: r.body.toString("utf8") };
}

/** VCL A3c — an external SVG LOGO candidate, fetched only so it can be
 * inspected and rasterized server-side (lib/brand-images); the SVG itself
 * is never stored or served. Same destination/DNS/redirect/TLS/timeout
 * rules as every other fetch here; small hard cap. */
export const SAFE_FETCH_SVG_MAX_BYTES = 256 * 1024;
export const SAFE_FETCH_SVG_TYPES: ReadonlySet<string> = new Set(["image/svg+xml"]);
const SVG_PROFILE: FetchProfile = {
  accept: "image/svg+xml",
  mediaTypes: SAFE_FETCH_SVG_TYPES,
  maxBytes: SAFE_FETCH_SVG_MAX_BYTES,
  rejectDeclaredOverMax: true,
};

/** Retrieves ONE SVG document (≤ 256 KB, declared image/svg+xml). */
export async function safeFetchSvg(input: string | URL, options: SafeFetchOptions = {}): Promise<SafeFetchImageResult> {
  const r = await safeFetchResource(input, SVG_PROFILE, options);
  if (!r.ok) return r;
  return { ok: true, url: r.url, body: r.body, contentType: r.contentType, bytes: r.bytes, redirects: r.redirects };
}
