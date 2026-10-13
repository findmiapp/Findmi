// Event Import V1 — deterministic-first extraction (pure; no network).
//
// Hierarchy:
//   1. schema.org Event JSON-LD (any *Event type / Festival, @graph,
//      subEvent) — title, description, image, dates, Place/PostalAddress,
//      organizer, url;
//   2. page metadata — og:title/description/image/site_name and the
//      Facebook-style event:start_time / event:end_time;
//   3. a bounded plain-text excerpt, returned for the optional AI step,
//      which only fills what is still missing (see ./ai.ts).
// Nothing is invented: a value the page doesn't evidence stays null and is
// filled in by the Business during Review.
import { parse } from "parse5";
import { cleanText, usStateCode } from "../brand-website-extract";
import { localDateTimeToIso } from "../admin/form-helpers";
import type { EventCandidate, ImportedDate, ImportedVenue } from "./types";

export const EVENT_TITLE_MAX = 200;
export const EVENT_DESCRIPTION_MAX = 2000;
export const EVENT_MAX_DATES = 12;
const JSONLD_MAX_BLOCKS = 12;
const JSONLD_MAX_BLOCK_CHARS = 300_000;
const MAX_DOM_NODES = 60_000;
export const EXCERPT_MAX_CHARS = 6000;

type JsonObject = Record<string, unknown>;
interface HtmlNode {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
  value?: string;
}

const PLATFORMS: [RegExp, string][] = [
  [/(^|\.)eventbrite\.[a-z.]+$/, "Eventbrite"],
  [/(^|\.)(lu\.ma|luma\.com)$/, "Luma"],
  [/(^|\.)dice\.fm$/, "DICE"],
  [/(^|\.)partiful\.com$/, "Partiful"],
  [/(^|\.)facebook\.com$/, "Facebook"],
  [/(^|\.)meetup\.com$/, "Meetup"],
  [/(^|\.)ticketmaster\.[a-z.]+$/, "Ticketmaster"],
  [/(^|\.)bandsintown\.com$/, "Bandsintown"],
  [/(^|\.)posh\.vip$/, "Posh"],
  [/(^|\.)ra\.co$/, "Resident Advisor"],
  [/(^|\.)universe\.com$/, "Universe"],
];

export function platformForHost(host: string): string | null {
  const h = host.toLowerCase();
  return PLATFORMS.find(([re]) => re.test(h))?.[1] ?? null;
}

function attr(node: HtmlNode, name: string): string | null {
  return node.attrs?.find((a) => a.name === name)?.value ?? null;
}

function textOf(node: HtmlNode): string {
  return (node.childNodes ?? []).map((c) => (c.nodeName === "#text" ? (c.value ?? "") : "")).join("");
}

interface Collected {
  title: string | null;
  meta: Map<string, string>;
  jsonLd: string[];
  text: string[];
}

const SKIP_TEXT = new Set(["script", "style", "noscript", "template", "svg", "head", "nav", "footer"]);

function collect(html: string): Collected {
  const out: Collected = { title: null, meta: new Map(), jsonLd: [], text: [] };
  const doc = parse(html) as unknown as HtmlNode;
  let textChars = 0;
  const walk = (node: HtmlNode, skip: boolean, budget: { n: number }) => {
    if (budget.n-- <= 0) return;
    const tag = node.tagName;
    if (tag === "title" && out.title === null) out.title = textOf(node);
    else if (tag === "meta") {
      const key = (attr(node, "property") ?? attr(node, "name") ?? attr(node, "itemprop"))?.trim().toLowerCase();
      const content = attr(node, "content");
      if (key && content !== null && !out.meta.has(key)) out.meta.set(key, content);
    } else if (tag === "script") {
      const type = (attr(node, "type") ?? "").split(";")[0].trim().toLowerCase();
      if (type === "application/ld+json" && out.jsonLd.length < JSONLD_MAX_BLOCKS) out.jsonLd.push(textOf(node));
      return;
    }
    if (node.nodeName === "#text" && !skip && textChars < EXCERPT_MAX_CHARS * 2) {
      const t = (node.value ?? "").replace(/\s+/g, " ").trim();
      if (t) {
        out.text.push(t);
        textChars += t.length + 1;
      }
    }
    const childSkip = skip || (tag ? SKIP_TEXT.has(tag) : false);
    for (const child of node.childNodes ?? []) walk(child, childSkip, budget);
  };
  walk(doc, false, { n: MAX_DOM_NODES });
  return out;
}

function typeList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  return raw.filter((t): t is string => typeof t === "string").map((t) => t.split(/[/:#]/).pop() ?? "").filter(Boolean);
}

/** Any schema.org Event subtype (MusicEvent, FoodEvent, SaleEvent, …), a
 * Festival, or an EventSeries. */
export function isEventType(types: string[]): boolean {
  return types.some((t) => t === "Event" || t === "Festival" || t === "EventSeries" || /Event$/.test(t));
}

/** Every Event-like node in the JSON-LD blocks (top level, arrays, @graph). */
export function collectEventNodes(blocks: string[]): JsonObject[] {
  const found: JsonObject[] = [];
  let budget = 400;
  const visit = (value: unknown, depth: number) => {
    if (budget <= 0 || depth > 6 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 60)) visit(item, depth + 1);
      return;
    }
    budget -= 1;
    const node = value as JsonObject;
    if (isEventType(typeList(node["@type"]))) {
      found.push(node);
      return; // its own subEvents are read by datesFrom
    }
    for (const [key, child] of Object.entries(node).slice(0, 100)) {
      if (key !== "@context" && child && typeof child === "object") visit(child, depth + 1);
    }
  };
  for (const raw of blocks) {
    if (raw.length > JSONLD_MAX_BLOCK_CHARS) continue;
    const block = raw.replace(/^\s*<!--|-->\s*$/g, "").replace(/^\s*\/\/<!\[CDATA\[|\/\/\]\]>\s*$/g, "");
    try {
      visit(JSON.parse(block), 0);
    } catch {
      // ignore malformed blocks
    }
  }
  return found;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATETIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2}(\.\d+)?)?$/;

/** Normalizes one source date value:
 *  - ISO with an offset/Z → an exact instant;
 *  - a bare local date-time (no zone) → read as America/New_York, the zone
 *    every Findmi date is shown in (flagged so Review asks to check it);
 *  - a bare date → kept as a date, time unknown.
 * Anything else → null (never guessed). */
export function normalizeDateValue(value: unknown): { iso: string; hasTime: boolean; assumedZone: boolean } | null {
  const s = typeof value === "string" ? value.trim() : null;
  if (!s || s.length > 40) return null;
  if (DATE_ONLY.test(s)) return Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? null : { iso: s, hasTime: false, assumedZone: false };
  const local = LOCAL_DATETIME.exec(s);
  if (local) {
    const iso = localDateTimeToIso(`${local[1]}T${local[2]}`);
    return iso ? { iso, hasTime: true, assumedZone: true } : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : { iso: new Date(t).toISOString(), hasTime: true, assumedZone: false };
  }
  return null;
}

function toImportedDate(startRaw: unknown, endRaw: unknown): (ImportedDate & { assumedZone: boolean }) | null {
  const start = normalizeDateValue(startRaw);
  if (!start) return null;
  const end = normalizeDateValue(endRaw);
  const endIso = end && end.hasTime === start.hasTime ? end.iso : null;
  // An end before the start is not trusted.
  const validEnd = endIso && start.hasTime && Date.parse(endIso) <= Date.parse(start.iso) ? null : endIso;
  return { start: start.iso, end: validEnd, hasTime: start.hasTime, assumedZone: start.assumedZone || Boolean(end?.assumedZone) };
}

function datesFrom(node: JsonObject): (ImportedDate & { assumedZone: boolean })[] {
  const out: (ImportedDate & { assumedZone: boolean })[] = [];
  const own = toImportedDate(node.startDate, node.endDate);
  const subs = (Array.isArray(node.subEvent) ? node.subEvent : node.subEvent ? [node.subEvent] : []) as JsonObject[];
  for (const sub of subs.slice(0, 60)) {
    if (sub && typeof sub === "object") {
      const d = toImportedDate(sub.startDate, sub.endDate);
      if (d) out.push(d);
    }
  }
  // A series whose sub-events carry the dates: its own (overall) range is
  // not itself a date people attend.
  if (own && out.length === 0) out.push(own);
  return out;
}

function str(value: unknown): unknown {
  return Array.isArray(value) ? value.find((v) => typeof v === "string") : value;
}

function nameOf(value: unknown): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v === "string") return cleanText(v, 160);
  if (v && typeof v === "object") return cleanText(str((v as JsonObject).name), 160);
  return null;
}

/** https only, resolved against the page; never data:/javascript:. */
export function absoluteHttps(value: unknown, base: URL): string | null {
  const raw = typeof value === "string" ? value.trim() : null;
  if (!raw || raw.length > 2048) return null;
  try {
    const u = new URL(raw, base);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function imageOf(value: unknown, base: URL): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v === "string") return absoluteHttps(v, base);
  if (v && typeof v === "object") return absoluteHttps(str((v as JsonObject).url) ?? str((v as JsonObject).contentUrl), base);
  return null;
}

const EMPTY_VENUE: ImportedVenue = { name: null, address: null, city: null, state: null, postalCode: null };

function venueFrom(value: unknown): { venue: ImportedVenue; online: boolean } {
  const list = (Array.isArray(value) ? value : value ? [value] : []) as unknown[];
  let online = false;
  for (const item of list) {
    if (typeof item === "string") {
      const name = cleanText(item, 160);
      if (name) return { venue: { ...EMPTY_VENUE, name }, online };
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const node = item as JsonObject;
    const types = typeList(node["@type"]);
    if (types.includes("VirtualLocation")) {
      online = true;
      continue;
    }
    const addr = node.address;
    let address: string | null = null;
    let city: string | null = null;
    let state: string | null = null;
    let postalCode: string | null = null;
    if (typeof addr === "string") address = cleanText(addr, 200);
    else if (addr && typeof addr === "object") {
      const a = addr as JsonObject;
      address = cleanText(str(a.streetAddress), 200);
      city = cleanText(str(a.addressLocality), 80);
      const region = str(a.addressRegion);
      state = usStateCode(region) ?? cleanText(region, 40);
      const postal = cleanText(str(a.postalCode), 12);
      postalCode = postal && /^[A-Za-z0-9 -]{3,12}$/.test(postal) ? postal : null;
    }
    const name = cleanText(str(node.name), 160);
    if (name || address || city) return { venue: { name, address, city, state, postalCode }, online };
  }
  return { venue: { ...EMPTY_VENUE }, online };
}

/** Strips tags/entities from rich-text descriptions some platforms put in JSON-LD. */
function plainDescription(value: unknown): string | null {
  const raw = typeof str(value) === "string" ? (str(value) as string) : null;
  if (!raw) return null;
  const stripped = raw
    .slice(0, EVENT_DESCRIPTION_MAX * 4)
    .replace(/<\s*br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;|&gt;/g, " ");
  return cleanText(stripped, EVENT_DESCRIPTION_MAX);
}

/** Removes a trailing " | Site" / " - Site" when it is the site's own name. */
export function cleanEventTitle(title: string | null, siteName: string | null): string | null {
  let t = cleanText(title, EVENT_TITLE_MAX);
  if (!t) return null;
  const site = siteName?.trim().toLowerCase();
  const parts = t.split(/\s+[|–—]\s+|\s+-\s+/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1].trim().toLowerCase();
    if ((site && (last === site || last.includes(site))) || /^(eventbrite|luma|dice|partiful|meetup|facebook|ticketmaster)$/i.test(last)) {
      t = t.slice(0, t.length - parts[parts.length - 1].length).replace(/[\s|–—-]+$/, "");
    }
  }
  return t || null;
}

export interface ExtractionResult {
  candidate: EventCandidate;
  /** Bounded page text for the optional AI step. */
  excerpt: string;
  /** A local date-time without a zone was read as New York time. */
  assumedZone: boolean;
}

/** Deterministic extraction of ONE event candidate from a page. */
export function extractEventCandidate(html: string, pageUrl: URL): ExtractionResult {
  const c = collect(html);
  const nodes = collectEventNodes(c.jsonLd);
  const siteName = cleanText(c.meta.get("og:site_name"), 80);
  const sources: EventCandidate["sources"] = {};

  // Primary node: the first Event; sibling Event nodes with the same name
  // (platforms list each date of a series) contribute their dates.
  const primary = nodes[0] ?? null;
  const primaryName = primary ? cleanText(str(primary.name), EVENT_TITLE_MAX) : null;
  let dates: (ImportedDate & { assumedZone: boolean })[] = [];
  if (primary) {
    const sameName = nodes.filter((n) => !primaryName || cleanText(str(n.name), EVENT_TITLE_MAX) === primaryName);
    for (const n of sameName) dates.push(...datesFrom(n));
  }

  let title = cleanEventTitle(primaryName, siteName);
  if (title) sources.title = "structured";
  else {
    title = cleanEventTitle(c.meta.get("og:title") ?? c.title, siteName);
    if (title) sources.title = "page";
  }

  let description = primary ? plainDescription(primary.description) : null;
  if (description) sources.description = "structured";
  else {
    description = cleanText(c.meta.get("og:description") ?? c.meta.get("description"), EVENT_DESCRIPTION_MAX);
    if (description) sources.description = "page";
  }

  let imageUrl = primary ? imageOf(primary.image, pageUrl) : null;
  if (imageUrl) sources.image = "structured";
  else {
    imageUrl = absoluteHttps(c.meta.get("og:image:secure_url") ?? c.meta.get("og:image") ?? c.meta.get("twitter:image"), pageUrl);
    if (imageUrl) sources.image = "page";
  }

  if (dates.length > 0) sources.dates = "structured";
  else {
    const metaDate = toImportedDate(c.meta.get("event:start_time"), c.meta.get("event:end_time"));
    if (metaDate) {
      dates = [metaDate];
      sources.dates = "page";
    }
  }

  const { venue, online } = primary ? venueFrom(primary.location) : { venue: { ...EMPTY_VENUE }, online: false };
  if (venue.name || venue.address || venue.city) sources.venue = "structured";
  const organizer = primary ? nameOf(primary.organizer) : null;
  if (organizer) sources.organizer = "structured";

  // Unique by start, chronological, capped.
  const seen = new Set<string>();
  const unique = dates
    .filter((d) => (seen.has(d.start) ? false : (seen.add(d.start), true)))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, EVENT_MAX_DATES);

  const canonical = primary ? absoluteHttps(str(primary.url), pageUrl) : null;
  const sourceUrl = canonical && new URL(canonical).host === pageUrl.host ? canonical : pageUrl.toString();
  const excerptParts = [c.title, c.meta.get("og:title"), c.meta.get("og:description"), c.meta.get("description"), ...c.text].filter(
    (v): v is string => Boolean(v && v.trim())
  );

  return {
    candidate: {
      title,
      description,
      imageUrl,
      sourceUrl,
      platform: platformForHost(pageUrl.hostname),
      dates: unique.map(({ start, end, hasTime }) => ({ start, end, hasTime })),
      venue,
      online,
      organizer,
      sources,
    },
    excerpt: excerptParts.join("\n").replace(/\n{2,}/g, "\n").slice(0, EXCERPT_MAX_CHARS),
    assumedZone: unique.some((d) => d.assumedZone),
  };
}

/** Is there enough to review? A title and at least one date. */
export function needsAiAssist(candidate: EventCandidate): boolean {
  return !candidate.title || candidate.dates.length === 0 || (!candidate.venue.name && !candidate.venue.address && !candidate.online);
}

/** Dates that have already ended (or, date-only, are before today in NY). */
export function isPastDate(d: ImportedDate, now: number = Date.now()): boolean {
  if (!d.hasTime) {
    const today = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    return d.start < today;
  }
  const end = d.end ? Date.parse(d.end) : Date.parse(d.start) + 3 * 60 * 60 * 1000;
  return end < now;
}
