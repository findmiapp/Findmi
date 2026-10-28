// Event Import V1C — source classification (pure; no network).
//
// A pasted link is either ONE Event (possibly with many occurrences — the
// V1B model: one title, many dates/places) or a SOURCE listing MANY
// distinct Events (an organizer calendar, a venue's events page). Each
// distinct Event stays its own candidate; nothing is flattened into one
// Event and nothing silently falls back to "the first Event".
//
// Signals, strongest first (each a shared, platform-neutral reader; a
// platform only adds how its pages name things):
//   1. schema.org JSON-LD with several Event entities;
//   2. embedded page state (Next.js __NEXT_DATA__ and other
//      application/json blocks — how Luma and many modern sites ship their
//      event lists) with several event-like records;
//   3. repeated event cards in the HTML, each linking to its own Event page
//      with its own title and date.
// A page whose own URL IS one of the Events (an Event page that also lists
// "more events") is a single Event. Distinct Events need distinct titles
// (or distinct links); one title with many dates stays ONE Event.
import { parse } from "parse5";
import { cleanText, usStateCode } from "../brand-website-extract";
import {
  EVENT_DESCRIPTION_MAX,
  EVENT_TITLE_MAX,
  absoluteHttps,
  cleanEventTitle,
  collectEventNodes,
  imageOf,
  isBoilerplateRegion,
  nameOf,
  normalizeDateValue,
  occurrencesFrom,
  platformForHost,
  plainDescription,
  sameEventUrl,
  str,
  venueFrom,
  type JsonObject,
} from "./extract";
import { dedupeOccurrences, parseScheduleLines, yearHintFrom } from "./schedule";
import { EMPTY_VENUE, realStreetAddress, venueKey, type EventCandidate, type ImportedOccurrence, type ImportedVenue } from "./types";
import { UNKNOWN_ATTENDANCE, applyLocationVisibility, decideLocationVisibility, pageRecordAttendance } from "./attendance";

/** Events read from one source at a time. */
export const SOURCE_MAX_EVENTS = 40;
const JSON_SCRIPT_MAX_CHARS = 2_500_000;
const JSON_WALK_BUDGET = 20_000;
const MAX_DOM_NODES = 80_000;

export interface SourceEvent {
  /** Stable identity within the source (its own Event URL, else title + first date). */
  identity: string;
  candidate: EventCandidate;
}

export type SourceClassification =
  | { kind: "single" }
  | {
      kind: "multi";
      via: "structured" | "page_data" | "cards";
      sourceName: string | null;
      events: SourceEvent[];
      /** An editorial page (article / blog post) that mentions several
       * Events: which one is meant is uncertain — Review starts with
       * nothing selected and says so, never importing them all. */
      ambiguous?: boolean;
    }
  /** The page is clearly a calendar/organizer page but its Events can't be read. */
  | { kind: "multi_unreadable"; sourceName: string | null };

interface HtmlNode {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
  value?: string;
}
const attr = (n: HtmlNode, name: string) => n.attrs?.find((a) => a.name === name)?.value ?? null;
const titleKey = (t: string | null) => (t ?? "").toLowerCase().normalize("NFKC").replace(/[^a-z0-9]+/g, " ").trim();

interface Page {
  jsonLd: string[];
  jsonState: string[];
  meta: Map<string, string>;
  title: string | null;
  root: HtmlNode;
}

function readPage(html: string): Page {
  const root = parse(html) as unknown as HtmlNode;
  const out: Page = { jsonLd: [], jsonState: [], meta: new Map(), title: null, root };
  let budget = MAX_DOM_NODES;
  const walk = (n: HtmlNode) => {
    if (budget-- <= 0) return;
    if (n.tagName === "script") {
      const type = (attr(n, "type") ?? "").split(";")[0].trim().toLowerCase();
      const text = (n.childNodes ?? []).map((c) => c.value ?? "").join("");
      if (type === "application/ld+json") out.jsonLd.push(text);
      else if ((type === "application/json" || attr(n, "id") === "__NEXT_DATA__") && text.length <= JSON_SCRIPT_MAX_CHARS) out.jsonState.push(text);
      return;
    }
    if (n.tagName === "meta") {
      const key = (attr(n, "property") ?? attr(n, "name"))?.trim().toLowerCase();
      const content = attr(n, "content");
      if (key && content !== null && !out.meta.has(key)) out.meta.set(key, content);
    }
    if (n.tagName === "title" && out.title === null) out.title = (n.childNodes ?? []).map((c) => c.value ?? "").join("");
    for (const c of n.childNodes ?? []) walk(c);
  };
  walk(root);
  return out;
}

function baseCandidate(pageUrl: URL, over: Partial<EventCandidate>): EventCandidate {
  return {
    title: null,
    description: null,
    imageUrl: null,
    // Each Event's OWN link; never the calendar page (empty when the
    // source doesn't give one — the Business adds it in Review).
    sourceUrl: "",
    platform: platformForHost(pageUrl.hostname),
    occurrences: [],
    online: false,
    organizer: null,
    sources: {},
    ...over,
  };
}

// ── 1. JSON-LD ─────────────────────────────────────────────────────────
function fromJsonLd(page: Page, pageUrl: URL, siteName: string | null): SourceEvent[] {
  const nodes = collectEventNodes(page.jsonLd);
  const groups = new Map<string, JsonObject[]>();
  for (const n of nodes) {
    const url = absoluteHttps(str(n.url), pageUrl);
    const name = cleanText(str(n.name), EVENT_TITLE_MAX);
    // Own URL identifies an Event; without one, same-name nodes are dates of one Event.
    const id = url ? `url:${url.replace(/[?#].*$/, "")}` : `title:${titleKey(name)}`;
    groups.set(id, [...(groups.get(id) ?? []), n]);
  }
  const out: SourceEvent[] = [];
  for (const [identity, group] of groups) {
    const node = group[0];
    const { venue, online } = venueFrom(node.location);
    const occurrences = dedupeOccurrences(group.flatMap((g) => occurrencesFrom(g, venueKey(venueFrom(g.location).venue) ? venueFrom(g.location).venue : venue)));
    const title = cleanEventTitle(cleanText(str(node.name), EVENT_TITLE_MAX), siteName);
    if (!title) continue;
    out.push({
      identity,
      candidate: baseCandidate(pageUrl, {
        title,
        description: plainDescription(node.description),
        imageUrl: imageOf(node.image, pageUrl),
        sourceUrl: absoluteHttps(str(node.url), pageUrl) ?? "",
        occurrences: occurrences.map(({ start, end, hasTime, venue: v, evidence }) => ({ start, end, hasTime, venue: v, evidence })),
        online,
        organizer: nameOf(node.organizer),
        sources: { title: "structured", dates: occurrences.length ? "structured" : undefined, venue: occurrences.some((o) => venueKey(o.venue)) ? "structured" : undefined, organizer: nameOf(node.organizer) ? "structured" : undefined },
      }),
    });
  }
  return out;
}

// ── 2. embedded page state ─────────────────────────────────────────────
const START_KEYS = ["start_at", "startAt", "startDate", "start_date", "starts_at", "startsAt", "start_time", "startTime", "start"];
const END_KEYS = ["end_at", "endAt", "endDate", "end_date", "ends_at", "endsAt", "end_time", "endTime", "end"];
const URL_KEYS = ["url", "event_url", "eventUrl", "permalink", "link", "href", "canonical_url"];
const IMAGE_KEYS = ["cover_url", "coverUrl", "cover_image_url", "image_url", "imageUrl", "image", "thumbnail_url", "social_image_url"];
const LUMA_HOST = /(^|\.)(lu\.ma|luma\.com)$/i;

const first = (o: JsonObject, keys: string[]) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
};

/** ISO strings only (Luma and most APIs) — anything else is ignored, never guessed. */
function isoOf(value: unknown): ReturnType<typeof normalizeDateValue> {
  if (typeof value !== "string") return null;
  const v = value.trim().replace(/(\.\d{3})\d+/, "$1");
  return normalizeDateValue(v);
}

function placeFromRecord(o: JsonObject): ImportedVenue {
  // Luma: geo_address_info { address (place name), full_address, city, region }.
  const geo = o.geo_address_info;
  if (geo && typeof geo === "object") {
    const g = geo as JsonObject;
    const full = cleanText(str(g.full_address), 200);
    const name = cleanText(str(g.address), 160);
    const city = cleanText(str(g.city), 80) ?? cleanText(str(g.city_state), 80)?.split(",")[0]?.trim() ?? null;
    // "Corgi Cafe, 123 Orchard St, New York, NY" → street "123 Orchard St".
    let address = full && full !== name ? full : null;
    if (address && name && address.toLowerCase().startsWith(`${name.toLowerCase()},`)) address = address.slice(name.length + 1).trim();
    if (address && /^\d/.test(address)) address = address.split(",")[0].trim();
    return {
      name,
      address: realStreetAddress(name, address),
      city,
      state: usStateCode(str(g.region)) ?? cleanText(str(g.region), 40),
      postalCode: null,
    };
  }
  const v = o.venue ?? o.location ?? o.place;
  if (typeof v === "string") return { ...EMPTY_VENUE, name: cleanText(v, 160) };
  if (v && typeof v === "object") {
    const viaLd = venueFrom(v).venue;
    if (venueKey(viaLd) || viaLd.city) return viaLd;
    const r = v as JsonObject;
    const rName = cleanText(str(r.name ?? r.title), 160);
    return {
      name: rName,
      address: realStreetAddress(rName, cleanText(str(r.address ?? r.street ?? r.address1), 200)),
      city: cleanText(str(r.city ?? r.locality), 80),
      state: usStateCode(str(r.state ?? r.region)) ?? cleanText(str(r.state ?? r.region), 40),
      postalCode: null,
    };
  }
  return { ...EMPTY_VENUE };
}

function recordUrl(o: JsonObject, pageUrl: URL): string | null {
  const raw = first(o, URL_KEYS);
  if (typeof raw === "string" && raw.trim()) {
    const t = raw.trim();
    // A bare slug ("nyc-gtm-mixer") is a path on the platform's own site.
    if (/^[a-z0-9][a-z0-9-_]{1,120}$/i.test(t) && LUMA_HOST.test(pageUrl.hostname)) return absoluteHttps(`/${t}`, pageUrl);
    return absoluteHttps(t, pageUrl);
  }
  if (LUMA_HOST.test(pageUrl.hostname) && typeof o.slug === "string") return absoluteHttps(`/${o.slug}`, pageUrl);
  return null;
}

function imageFromRecord(o: JsonObject, pageUrl: URL): string | null {
  const raw = first(o, IMAGE_KEYS);
  if (typeof raw === "string") return absoluteHttps(raw, pageUrl);
  if (raw && typeof raw === "object") return imageOf(raw, pageUrl);
  return null;
}

function fromPageData(page: Page, pageUrl: URL, siteName: string | null): SourceEvent[] {
  const found = new Map<string, SourceEvent>();
  let budget = JSON_WALK_BUDGET;
  const visit = (value: unknown, depth: number) => {
    if (budget-- <= 0 || depth > 14 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 400)) visit(item, depth + 1);
      return;
    }
    const o = value as JsonObject;
    const title = cleanText(str(o.name ?? o.title), EVENT_TITLE_MAX);
    const start = isoOf(first(o, START_KEYS));
    if (title && start) {
      const url = recordUrl(o, pageUrl);
      const end = isoOf(first(o, END_KEYS));
      const venue = placeFromRecord(o);
      const online = typeof o.location_type === "string" && /online|virtual|zoom/i.test(o.location_type);
      const occ: ImportedOccurrence = {
        start: start.iso,
        end: end && end.hasTime === start.hasTime && Date.parse(end.iso) > Date.parse(start.iso) ? end.iso : null,
        hasTime: start.hasTime,
        venue,
        evidence: null,
      };
      const identity = url ? `url:${url.replace(/[?#].*$/, "")}` : `title:${titleKey(title)}#${start.iso}`;
      const existing = found.get(identity);
      if (existing) {
        // The same Event repeated elsewhere in the page state.
        if (!existing.candidate.imageUrl) existing.candidate.imageUrl = imageFromRecord(o, pageUrl);
      } else if (found.size < SOURCE_MAX_EVENTS * 2) {
        const description = typeof o.description === "string" ? plainDescription(o.description) : null;
        // The record's own attendance/privacy facts. A calendar listing is
        // never a verified individual Event page, so no platform fallback
        // link is used here — only what the record states.
        const recordFacts = pageRecordAttendance(o);
        const visibility = decideLocationVisibility({ occurrences: [occ], online }, recordFacts.hiddenLocation);
        const placed = applyLocationVisibility({ occurrences: [occ], online }, visibility).occurrences[0];
        found.set(identity, {
          identity,
          candidate: baseCandidate(pageUrl, {
            attendance: { ...UNKNOWN_ATTENDANCE, pricing: recordFacts.pricing, price: recordFacts.price, registration: recordFacts.registration },
            locationVisibility: visibility,
            title: cleanEventTitle(title, siteName),
            description, // already cleanEventDescription'd by plainDescription
            imageUrl: imageFromRecord(o, pageUrl),
            sourceUrl: url ?? "",
            occurrences: [placed],
            online,
            sources: { title: "page", dates: "page", venue: venueKey(placed.venue) || placed.venue.city ? "page" : undefined },
          }),
        });
      }
      // An event record's children (hosts, tickets) are not more Events.
      return;
    }
    for (const [k, child] of Object.entries(o).slice(0, 200)) {
      if (child && typeof child === "object" && k !== "hosts" && k !== "ticket_types") visit(child, depth + 1);
    }
  };
  for (const raw of page.jsonState) {
    try {
      visit(JSON.parse(raw), 0);
    } catch {
      // ignore malformed / truncated blocks
    }
  }
  return [...found.values()];
}

/** The platform's own embedded record for THIS page's Event (its own URL /
 * slug matches the page), or null. Used for attendance and location-privacy
 * facts on a single Event page (e.g. Luma's geo_address_info.mode). */
export function pageEventRecord(jsonState: string[], pageUrl: URL): JsonObject | null {
  let found: JsonObject | null = null;
  let budget = JSON_WALK_BUDGET;
  const visit = (value: unknown, depth: number) => {
    if (found || budget-- <= 0 || depth > 14 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 400)) visit(item, depth + 1);
      return;
    }
    const o = value as JsonObject;
    if (cleanText(str(o.name ?? o.title), EVENT_TITLE_MAX) && isoOf(first(o, START_KEYS))) {
      if (sameEventUrl(recordUrl(o, pageUrl), pageUrl)) found = o;
      return;
    }
    for (const [k, child] of Object.entries(o).slice(0, 200)) {
      if (child && typeof child === "object" && k !== "hosts" && k !== "ticket_types") visit(child, depth + 1);
    }
  };
  for (const raw of jsonState) {
    if (found) break;
    try {
      visit(JSON.parse(raw), 0);
    } catch {
      // ignore malformed / truncated blocks
    }
  }
  return found;
}

// ── 3. repeated event cards ────────────────────────────────────────────
const CARD_TAGS = new Set(["article", "li"]);
const BLOCK = new Set(["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "time", "span", "section", "article", "address"]);

function cardLines(n: HtmlNode): string[] {
  const lines: string[] = [];
  let buf = "";
  const flush = () => {
    const t = buf.replace(/\s+/g, " ").trim();
    if (t) lines.push(t);
    buf = "";
  };
  const walk = (x: HtmlNode, depth: number) => {
    if (depth > 30) return;
    if (x.nodeName === "#text") buf += x.value ?? "";
    if (x.tagName === "script" || x.tagName === "style" || x.tagName === "svg") return;
    if (x.tagName === "br") return flush();
    const block = x.tagName ? BLOCK.has(x.tagName) : false;
    if (block) flush();
    // datetime attributes are machine-readable dates — use them as a line.
    if (x.tagName === "time" && attr(x, "datetime")) {
      flush();
      lines.push(`@datetime ${attr(x, "datetime")}`);
    }
    for (const c of x.childNodes ?? []) walk(c, depth + 1);
    if (block) flush();
  };
  walk(n, 0);
  flush();
  return lines.slice(0, 40);
}

const MAP_HOST = /(^|\.)(google\.[a-z.]+|goo\.gl|maps\.apple\.com|bing\.com|openstreetmap\.org|waze\.com)$/i;
/** A link that can be an Event page: same site, or a known event platform
 * (never maps, social profiles or other sites — a tour stop linking to a
 * map is still an occurrence, not a separate Event). */
function eventLink(raw: string | null, pageUrl: URL): string | null {
  if (!raw || /^(mailto|tel|javascript|#)/i.test(raw.trim())) return null;
  const abs = absoluteHttps(raw.trim().replace(/^http:\/\//i, "https://"), pageUrl);
  if (!abs) return null;
  const u = new URL(abs);
  if (MAP_HOST.test(u.hostname) || /\/maps(\/|$)/.test(u.pathname)) return null;
  const site = (h: string) => h.toLowerCase().replace(/^www\./, "");
  if (site(u.hostname) !== site(pageUrl.hostname) && !platformForHost(u.hostname)) return null;
  u.hash = "";
  return u.toString();
}

function fromCards(page: Page, pageUrl: URL, now: number, siteName: string | null): SourceEvent[] {
  type Card = { href: string; title: string; image: string | null; lines: string[]; depth: number };
  const cards: Card[] = [];
  let budget = MAX_DOM_NODES;
  const walk = (n: HtmlNode, depth: number) => {
    if (budget-- <= 0) return;
    // Navigation, footers, sidebars and related / recommended modules are
    // never listings of the Events being imported.
    if (isBoilerplateRegion(n)) return;
    const cls = (attr(n, "class") ?? "").toLowerCase();
    const isCard = n.tagName ? CARD_TAGS.has(n.tagName) || ((n.tagName === "div" || n.tagName === "section") && /\bevent/.test(cls)) : false;
    if (isCard) {
      const anchors: { href: string; text: string }[] = [];
      let heading: string | null = null;
      let image: string | null = null;
      const scan = (x: HtmlNode, d: number) => {
        if (d > 25) return;
        if (x.tagName === "a") {
          const href = eventLink(attr(x, "href"), pageUrl);
          if (href) anchors.push({ href, text: cardLines(x).join(" ") });
        }
        if (!heading && x.tagName && /^h[1-4]$/.test(x.tagName)) heading = cardLines(x).join(" ");
        if (!image && x.tagName === "img") image = absoluteHttps(attr(x, "src") ?? attr(x, "data-src"), pageUrl);
        for (const c of x.childNodes ?? []) scan(c, d + 1);
      };
      scan(n, 0);
      const distinct = [...new Set(anchors.map((a) => a.href))].filter((h) => !sameEventUrl(h, pageUrl));
      if (distinct.length >= 1 && distinct.length <= 3) {
        const href = distinct[0];
        const title = cleanText(heading ?? anchors.filter((a) => a.href === href).map((a) => a.text).sort((a, b) => b.length - a.length)[0] ?? null, EVENT_TITLE_MAX);
        if (title && title.length >= 3) cards.push({ href, title, image, lines: cardLines(n), depth });
      }
    }
    for (const c of n.childNodes ?? []) walk(c, depth + 1);
  };
  walk(page.root, 0);

  // Innermost card per link (an <article> wrapping an <li> is the same Event).
  const byHref = new Map<string, Card>();
  for (const c of cards) {
    const prev = byHref.get(c.href);
    if (!prev || c.depth > prev.depth) byHref.set(c.href, c);
  }
  const yearHint = yearHintFrom([...byHref.values()].flatMap((c) => c.lines));
  const out: SourceEvent[] = [];
  for (const card of byHref.values()) {
    const body = card.lines.filter((l) => titleKey(l) !== titleKey(card.title));
    const machine = body.filter((l) => l.startsWith("@datetime ")).map((l) => normalizeDateValue(l.slice(10).trim())).filter(Boolean);
    let occurrences: ImportedOccurrence[] = parseScheduleLines(body.filter((l) => !l.startsWith("@datetime ")), { now, yearHint }).occurrences;
    if (occurrences.length === 0 && machine.length > 0) {
      const m = machine[0]!;
      occurrences = [{ start: m.iso, end: null, hasTime: m.hasTime, venue: { ...EMPTY_VENUE }, evidence: null }];
    }
    if (occurrences.length === 0) continue; // a card without a date is not an Event listing
    out.push({
      identity: `url:${card.href.replace(/[?#].*$/, "")}`,
      candidate: baseCandidate(pageUrl, {
        title: cleanEventTitle(card.title, siteName),
        imageUrl: card.image,
        sourceUrl: card.href,
        occurrences,
        sources: { title: "page", dates: "page", venue: occurrences.some((o) => venueKey(o.venue)) ? "page" : undefined },
      }),
    });
  }
  return out;
}

// ── classification ─────────────────────────────────────────────────────
/** Several distinct Events: at least two different titles. One title with
 * many dates (or many sections) is one Event with occurrences. */
function isMulti(events: SourceEvent[]): boolean {
  return new Set(events.map((e) => titleKey(e.candidate.title))).size >= 2;
}

const hasPageEvent = (events: SourceEvent[], pageUrl: URL) => events.some((e) => sameEventUrl(e.candidate.sourceUrl, pageUrl));

/** Known organizer/calendar URL shapes (only used to refuse a silent
 * single-Event fallback when the Events can't be read). */
export function looksLikeCalendarUrl(pageUrl: URL): boolean {
  const host = pageUrl.hostname.toLowerCase();
  const path = pageUrl.pathname.toLowerCase();
  if (/(^|\.)eventbrite\.[a-z.]+$/.test(host)) return /^\/(o|cc)\//.test(path);
  if (/(^|\.)meetup\.com$/.test(host)) return /^\/[^/]+\/events\/?$/.test(path);
  if (/(^|\.)dice\.fm$/.test(host)) return /^\/(venue|promoters?)\//.test(path);
  if (/(^|\.)(lu\.ma|luma\.com)$/.test(host)) return /^\/(calendar|user)\//.test(path);
  return false;
}

function sortAndCap(events: SourceEvent[]): SourceEvent[] {
  return events
    .map((e) => ({ ...e, candidate: { ...e.candidate, occurrences: dedupeOccurrences(e.candidate.occurrences) } }))
    .sort((a, b) => (a.candidate.occurrences[0]?.start ?? "9").localeCompare(b.candidate.occurrences[0]?.start ?? "9"))
    .slice(0, SOURCE_MAX_EVENTS);
}

/** An article / blog post / news page (og:type, or schema.org Article). */
export function isEditorialPage(page: { meta: Map<string, string>; jsonLd: string[] }): boolean {
  if (/^article$/i.test(page.meta.get("og:type") ?? "")) return true;
  return page.jsonLd.some((b) => /"@type"\s*:\s*(?:\[[^\]]*)?"(?:Article|NewsArticle|BlogPosting|Report|ReportageNewsArticle)"/.test(b));
}

export function classifySource(html: string, pageUrl: URL, now: number = Date.now()): SourceClassification {
  const page = readPage(html);
  const editorial = isEditorialPage(page);
  const siteName = cleanText(page.meta.get("og:site_name"), 80);
  const sourceName = cleanEventTitle(cleanText(page.meta.get("og:title") ?? page.title, 120), siteName) ?? siteName;

  const ld = fromJsonLd(page, pageUrl, siteName);
  // This page IS one of its listed Events → a single Event page (other
  // Events it lists are "related", not what was pasted).
  if (hasPageEvent(ld, pageUrl)) return { kind: "single" };
  if (isMulti(ld)) return { kind: "multi", via: "structured", sourceName, events: sortAndCap(ld), ...(editorial ? { ambiguous: true } : {}) };

  const data = fromPageData(page, pageUrl, siteName);
  if (hasPageEvent(data, pageUrl)) return { kind: "single" };
  if (isMulti(data)) return { kind: "multi", via: "page_data", sourceName, events: sortAndCap(data), ...(editorial ? { ambiguous: true } : {}) };

  // One structured Event that is NOT this page, on a calendar-shaped URL:
  // never pretend that one Event is the whole source.
  const singleElsewhere = ld.length === 1 && ld[0].candidate.sourceUrl && !sameEventUrl(ld[0].candidate.sourceUrl, pageUrl);

  // An ARTICLE's own Event is the page itself: repeated cards on an
  // editorial page are recommendations / further reading, never Events
  // being imported (the single-Event reader reads the article body).
  if (!editorial && (ld.length === 0 || singleElsewhere)) {
    const cards = fromCards(page, pageUrl, now, siteName);
    if (isMulti(cards) && new Set(cards.map((c) => c.identity)).size >= 2) return { kind: "multi", via: "cards", sourceName, events: sortAndCap(cards) };
  }
  if ((singleElsewhere && LUMA_HOST.test(pageUrl.hostname)) || looksLikeCalendarUrl(pageUrl)) return { kind: "multi_unreadable", sourceName };
  return { kind: "single" };
}
