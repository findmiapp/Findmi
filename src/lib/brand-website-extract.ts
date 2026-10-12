import { parse } from "parse5";
import { normalizeBusinessName, normalizeInstagramHandle, normalizeWebsiteHost } from "./business-matching";

/** Brand Onboarding V1.1B — deterministic, single-page brand metadata
 * extraction. Pure: HTML string in, a small set of UNTRUSTED suggestions
 * out. It reads only <title>, <meta>, <link rel>, JSON-LD
 * <script type="application/ld+json"> text and Instagram <a href>s, via
 * the parse5 WHATWG parser (no regex HTML parsing, no DOM, nothing is
 * executed, nothing is fetched — logo URLs are recorded, never requested).
 * Visible/hidden body text is never read, so instructions hidden in a
 * page can only ever surface as a capped, inert suggestion the owner
 * reviews in the normal create form.
 *
 * Every value is normalized (NFKC, control/zero-width/bidi characters
 * removed, whitespace collapsed), rejected if it still contains `<`/`>`,
 * and capped. JSON-LD is untrusted candidate data: bounded block count,
 * block size, depth and node budget; malformed blocks are skipped. */

export const EXTRACT_NAME_MAX = 120;
export const EXTRACT_DESCRIPTION_MAX = 160;
export const EXTRACT_CITY_MAX = 80;
export const JSONLD_MAX_BLOCKS = 10;
export const JSONLD_MAX_BLOCK_CHARS = 100_000;
export const JSONLD_MAX_DEPTH = 6;
export const JSONLD_MAX_NODES = 200;
const MAX_DOM_NODES = 100_000;
const MAX_ANCHORS = 500;
const HTML_NS = "http://www.w3.org/1999/xhtml";

/** Exact, explicitly maintained schema.org type → existing Findmi business
 * category SLUG map. Resolved against live categories at runtime; a slug
 * that doesn't exist (or a type not listed here) preselects nothing. Never
 * fuzzy, never creates a category. */
export const SCHEMA_TYPE_CATEGORY_SLUG: Readonly<Record<string, string>> = {
  Restaurant: "food-drink",
  CafeOrCoffeeShop: "coffee",
  Bakery: "bakery-sweets",
  BarOrPub: "food-drink",
  Brewery: "food-drink",
  Winery: "food-drink",
  // V1.1C — slugs verified against supabase/migrations/
  // 20260902230000_business_category_taxonomy_update.sql (and the base
  // seed). Only types whose Findmi category is unambiguous.
  HealthAndBeautyBusiness: "beauty-self-care",
  BeautySalon: "beauty-self-care",
  DaySpa: "beauty-self-care",
  HairSalon: "beauty-self-care",
  NailSalon: "beauty-self-care",
  ClothingStore: "fashion-apparel",
  ShoeStore: "fashion-apparel",
  JewelryStore: "jewelry-accessories",
  Florist: "flowers",
  PetStore: "pets",
  HomeGoodsStore: "home-decor",
  FurnitureStore: "home-decor",
  ToyStore: "kids-family",
};

const ORG_TYPES = new Set([
  "Organization",
  "Corporation",
  "Brand",
  "LocalBusiness",
  "OnlineStore",
  "OnlineBusiness",
  "Store",
  "ClothingStore",
  "ShoeStore",
  "JewelryStore",
  "BookStore",
  "GroceryStore",
  "HomeGoodsStore",
  "FurnitureStore",
  "SportingGoodsStore",
  "ToyStore",
  "PetStore",
  "Florist",
  "LiquorStore",
  "FoodEstablishment",
  "Restaurant",
  "FastFoodRestaurant",
  "CafeOrCoffeeShop",
  "Bakery",
  "BarOrPub",
  "Brewery",
  "Winery",
  "Distillery",
  "IceCreamShop",
  "HealthAndBeautyBusiness",
  "BeautySalon",
  "DaySpa",
  "HairSalon",
  "NailSalon",
]);

const US_STATES: Readonly<Record<string, string>> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut",
  DE: "delaware", DC: "district of columbia", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois",
  IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland",
  MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana",
  NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york",
  NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania",
  RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah",
  VT: "vermont", VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
};
const US_COUNTRY = new Set(["us", "usa", "united states", "united states of america"]);

export const EXTRACT_ABOUT_MAX = 600;

/** Bounded, cleaned page text for the optional AI enrichment step — never
 * raw HTML. Every string is already normalized and capped. */
export interface BrandPageExcerpt {
  title: string | null;
  descriptions: string[];
  jsonLdName: string | null;
  jsonLdTypes: string[];
  headings: string[];
  paragraphs: string[];
}

export interface ExtractedBrandProfile {
  name: string | null;
  shortDescription: string | null;
  /** About text (≤ 600) — only when the page itself offers a useful
   * description longer than a short description; never padded. */
  aboutDescription: string | null;
  instagramHandle: string | null;
  city: string | null;
  state: string | null;
  /** An existing-category SLUG from SCHEMA_TYPE_CATEGORY_SLUG, or null. */
  categorySlug: string | null;
  /** Untrusted candidate URL — fetched/validated only by lib/brand-images. */
  logoCandidateUrl: string | null;
  /** og:image / twitter:image — a COVER candidate, never a logo. */
  coverCandidateUrl: string | null;
  excerpt: BrandPageExcerpt;
}

// ── Text normalization ────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const INVISIBLE = /[­؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;

/** Normalizes one untrusted string to plain, single-line display text, or
 * null. Over-long values are cut at a word boundary. */
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  let s = value
    .slice(0, max * 8)
    .normalize("NFKC")
    .replace(CONTROL, " ")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || /[<>]/.test(s)) return null;
  if (s.length > max) {
    const cut = s.slice(0, max + 1);
    const space = cut.lastIndexOf(" ");
    s = (space >= max * 0.6 ? cut.slice(0, space) : s.slice(0, max)).replace(/[\s,;:–—-]+$/, "");
  }
  return s || null;
}

const GENERIC_DESCRIPTION =
  /^(welcome to\b|official (web)?site\b|official (online )?store\b|shop (the latest|now|our)\b|free shipping\b|sign up\b|subscribe\b|home ?page\b)/i;
/** Merchant CTA / first- or second-person brand voice at the START of a
 * description ("Shop …", "Discover …", "We …", "Our …", "Your …"). Such
 * copy is not neutral directory text: it is not used as a deterministic
 * description (so the bounded AI step can write a neutral one), and AI
 * output in that voice is rejected too. Only the opening is checked —
 * "… made by our founders" mid-sentence is not penalised. */
const PROMOTIONAL_OPENING =
  /^(shop|buy|discover|explore|browse|get|order|find|save|enjoy|experience|try|meet|introducing|check out|join|visit|see|treat yourself|elevate|upgrade|unlock|transform|we|we're|we’re|we've|we’ve|our|us|you|your|you're|you’re)\b/i;

const BOILERPLATE =
  /(cookies?\b.*\b(policy|settings|consent|use)|use cookies|enable javascript|javascript is (disabled|required)|checking your browser|just a moment|attention required|access denied|page not found|404\b)/i;

/** Description quality gate (exported for tests): rejects values that are
 * the brand name (or the name plus a couple of words), too short to say
 * anything, generic greetings/shop prompts, site boilerplate, or that open
 * as merchant CTA / first- or second-person copy (PROMOTIONAL_OPENING).
 * Shared by deterministic extraction and AI-output sanitizing. */
export function isUsefulDescription(value: unknown, name: string | null): boolean {
  const text = cleanText(value, 2000);
  if (!text || text.length < 25 || text.split(" ").length < 4) return false;
  if (GENERIC_DESCRIPTION.test(text) || BOILERPLATE.test(text) || PROMOTIONAL_OPENING.test(text)) return false;
  const brand = name ? compact(name) : "";
  if (brand) {
    const body = compact(text);
    if (body === brand || body.replace(brand, "").length < 15) return false;
  }
  return true;
}

/** ≤160-character short description: whole sentence(s) when one ends late
 * enough, else a word-boundary cut (exported for tests). */
export function toShortDescription(text: string): string | null {
  if (text.length <= EXTRACT_DESCRIPTION_MAX) return text;
  const window = text.slice(0, EXTRACT_DESCRIPTION_MAX + 1);
  const end = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  if (end >= 60) return window.slice(0, end + 1);
  return cleanText(text, EXTRACT_DESCRIPTION_MAX);
}

function cleanName(value: unknown): string | null {
  const s = cleanText(value, EXTRACT_NAME_MAX);
  if (!s || /:\/\/|^www\./i.test(s) || normalizeBusinessName(s) === "") return null;
  return s;
}

// ── HTML collection ───────────────────────────────────────────────────────

interface HtmlNode {
  nodeName: string;
  tagName?: string;
  parentNode?: HtmlNode | null;
  namespaceURI?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
  value?: string;
}

interface Collected {
  title: string | null;
  meta: Map<string, string>;
  links: { rel: string[]; href: string; sizes: string; type: string }[];
  jsonLd: string[];
  instagramHrefs: string[];
  headings: string[];
  paragraphs: string[];
}

const MAX_HEADINGS = 4;
const MAX_PARAGRAPHS = 4;
const EXCERPT_TEXT_MAX = 400;
const NON_TEXT_TAGS = new Set(["script", "style", "noscript", "template", "svg", "math", "iframe", "button", "select", "nav", "footer", "form"]);

/** True inside navigation/footer/form/header chrome — excerpt text there
 * is menus and legal copy, not a description of the brand. */
function insideChrome(node: HtmlNode): boolean {
  let n = node.parentNode;
  for (let depth = 0; n && depth < 40; depth++, n = n.parentNode) {
    if (n.tagName && (NON_TEXT_TAGS.has(n.tagName) || n.tagName === "header" || n.tagName === "aside")) return true;
  }
  return false;
}

/** Visible-ish text of an element (descendant text nodes), bounded, skipping
 * script/style/template/navigation subtrees. */
function deepText(node: HtmlNode, max: number): string {
  let out = "";
  const stack: HtmlNode[] = [...(node.childNodes ?? [])].reverse();
  let steps = 0;
  while (stack.length && out.length < max * 2 && steps < 2000) {
    steps += 1;
    const n = stack.pop()!;
    if (n.nodeName === "#text") out += `${n.value ?? ""} `;
    else if (n.tagName && !NON_TEXT_TAGS.has(n.tagName)) stack.push(...[...(n.childNodes ?? [])].reverse());
  }
  return out;
}

function attr(node: HtmlNode, name: string): string | null {
  return node.attrs?.find((a) => a.name === name)?.value ?? null;
}

function textOf(node: HtmlNode): string {
  return (node.childNodes ?? [])
    .filter((c) => c.nodeName === "#text")
    .map((c) => c.value ?? "")
    .join("");
}

function collect(html: string): Collected {
  const out: Collected = { title: null, meta: new Map(), links: [], jsonLd: [], instagramHrefs: [], headings: [], paragraphs: [] };
  const doc = parse(html) as unknown as HtmlNode;
  const stack: HtmlNode[] = [doc];
  let visited = 0;
  while (stack.length && visited < MAX_DOM_NODES) {
    const node = stack.pop()!;
    visited += 1;
    const tag = node.tagName;
    // <template> content is a separate fragment and is never walked;
    // SVG/MathML <title>/<script> are not document metadata.
    if (tag && node.namespaceURI === HTML_NS) {
      if (tag === "title" && out.title === null) out.title = textOf(node);
      else if (tag === "meta") {
        const key = (attr(node, "property") ?? attr(node, "name") ?? attr(node, "itemprop"))?.trim().toLowerCase();
        const content = attr(node, "content");
        if (key && content !== null && !out.meta.has(key)) out.meta.set(key, content);
      } else if (tag === "link") {
        const rel = (attr(node, "rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        const href = attr(node, "href");
        if (href && rel.length) out.links.push({ rel, href, sizes: attr(node, "sizes") ?? "", type: (attr(node, "type") ?? "").toLowerCase() });
      } else if (tag === "script") {
        const type = (attr(node, "type") ?? "").split(";")[0].trim().toLowerCase();
        if (type === "application/ld+json" && out.jsonLd.length < JSONLD_MAX_BLOCKS) out.jsonLd.push(textOf(node));
      } else if (tag === "a" && out.instagramHrefs.length < MAX_ANCHORS) {
        const href = attr(node, "href");
        if (href && /instagr(\.am|am\.com)/i.test(href)) out.instagramHrefs.push(href);
      } else if ((tag === "h1" || tag === "h2") && out.headings.length < MAX_HEADINGS && !insideChrome(node)) {
        const text = cleanText(deepText(node, EXCERPT_TEXT_MAX), 160);
        if (text && text.length >= 3) out.headings.push(text);
      } else if (tag === "p" && out.paragraphs.length < MAX_PARAGRAPHS && !insideChrome(node)) {
        const text = cleanText(deepText(node, EXCERPT_TEXT_MAX), EXCERPT_TEXT_MAX);
        if (text && text.length >= 40 && !BOILERPLATE.test(text)) out.paragraphs.push(text);
      }
    }
    const children = node.childNodes ?? [];
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return out;
}

// ── JSON-LD ───────────────────────────────────────────────────────────────

type JsonObject = Record<string, unknown>;
interface Entity {
  node: JsonObject;
  types: string[];
}

function typeList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .filter((t): t is string => typeof t === "string")
    .slice(0, 10)
    .map((t) => t.split(/[/:#]/).pop() ?? "")
    .filter(Boolean);
}

function firstString(value: unknown): unknown {
  return Array.isArray(value) ? value.find((v) => typeof v === "string") : value;
}

/** Parses bounded JSON-LD blocks and collects organization-like entities
 * (anywhere: top level, arrays, @graph, nested values) plus WebSite names.
 * Exported for tests. */
export function collectJsonLd(blocks: string[]): { entities: Entity[]; websiteNames: string[] } {
  const entities: Entity[] = [];
  const websiteNames: string[] = [];
  let budget = JSONLD_MAX_NODES;
  const visit = (value: unknown, depth: number) => {
    if (budget <= 0 || depth > JSONLD_MAX_DEPTH || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 50)) visit(item, depth + 1);
      return;
    }
    budget -= 1;
    const node = value as JsonObject;
    const types = typeList(node["@type"]);
    if (types.some((t) => ORG_TYPES.has(t))) entities.push({ node, types });
    else if (types.includes("WebSite")) {
      const n = cleanName(firstString(node.name));
      if (n) websiteNames.push(n);
    }
    for (const [key, child] of Object.entries(node).slice(0, 100)) {
      if (key !== "@context" && child && typeof child === "object") visit(child, depth + 1);
    }
  };
  for (const block of blocks.slice(0, JSONLD_MAX_BLOCKS)) {
    if (block.length > JSONLD_MAX_BLOCK_CHARS) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    visit(parsed, 0);
  }
  return { entities, websiteNames };
}

function compact(value: string): string {
  return normalizeBusinessName(value).replace(/ /g, "");
}

/** The registrable-looking label of a host ("lavazza" for www.lavazza.com,
 * "brand" for brand.co.uk) — used only to break ties, never as a value. */
function domainLabel(host: string): string {
  const labels = host.split(".");
  if (labels.length >= 3 && labels[labels.length - 2].length <= 3 && labels[labels.length - 1].length === 2) {
    return labels[labels.length - 3];
  }
  return labels.length >= 2 ? labels[labels.length - 2] : labels[0];
}

function overlapsLabel(name: string, label: string): boolean {
  const c = compact(name);
  return c.length >= 3 && label.length >= 3 && (c.includes(label) || label.includes(c));
}

function uniqueByName(list: Entity[]): Entity | null {
  if (list.length === 0) return null;
  const names = new Set(list.map((e) => compact(cleanName(firstString(e.node.name)) ?? "")));
  return names.size === 1 ? list[0] : null;
}

/** Chooses the ONE entity that describes this site, or null on conflict:
 * an entity whose `url` host is this site → else one whose name matches
 * the domain → else the only distinct name present. */
function chooseEntity(entities: Entity[], host: string | null): Entity | null {
  const named = entities.filter((e) => cleanName(firstString(e.node.name)));
  if (named.length === 0) return entities.length === 1 ? entities[0] : null;
  if (host) {
    const onSite = named.filter((e) => normalizeWebsiteHost(typeof e.node.url === "string" ? e.node.url : null) === host);
    const pick = uniqueByName(onSite);
    if (pick) return pick;
    const label = domainLabel(host);
    const labelled = uniqueByName(named.filter((e) => overlapsLabel(cleanName(firstString(e.node.name))!, label)));
    if (labelled) return labelled;
  }
  return uniqueByName(named);
}

function addressOf(entity: Entity | null): { city: string | null; state: string | null } {
  const none = { city: null, state: null };
  if (!entity) return none;
  const raw = entity.node.address;
  const list = (Array.isArray(raw) ? raw : [raw]).filter((a): a is JsonObject => Boolean(a) && typeof a === "object" && !Array.isArray(a));
  const distinct = new Map<string, JsonObject>();
  for (const a of list.slice(0, 20)) distinct.set(`${compact(String(a.addressLocality ?? ""))}|${compact(String(a.addressRegion ?? ""))}`, a);
  if (distinct.size !== 1) return none;
  const address = [...distinct.values()][0];
  const country = address.addressCountry;
  const countryName = typeof country === "string" ? country : country && typeof country === "object" ? (country as JsonObject).name : undefined;
  if (countryName !== undefined && !(typeof countryName === "string" && US_COUNTRY.has(countryName.trim().toLowerCase()))) return none;
  return { city: cleanText(address.addressLocality, EXTRACT_CITY_MAX), state: usStateCode(address.addressRegion) };
}

/** Two-letter US state code from a code or full name, else null. */
export function usStateCode(value: unknown): string | null {
  const s = cleanText(value, 40);
  if (!s) return null;
  const upper = s.toUpperCase().replace(/\./g, "");
  if (Object.hasOwn(US_STATES, upper)) return upper;
  const lower = s.toLowerCase();
  return Object.keys(US_STATES).find((code) => US_STATES[code] === lower) ?? null;
}

/** Deterministic choice among Instagram handles the site itself exposes
 * (exported for tests). Never invents a handle — it only picks among
 * evidenced ones:
 *   1. the brand entity's JSON-LD sameAs names exactly one account → it;
 *   2. sameAs names several → the one ALSO linked from the page, if exactly
 *      one; else the one whose handle equals the site's domain label;
 *   3. no sameAs account → the page's links (rel=me + <a>): exactly one
 *      distinct account → it; several → the one equal to the domain label;
 *   4. otherwise none. */
export function chooseInstagramHandle(fromSameAs: Set<string>, fromPage: Set<string>, host: string | null): string | null {
  const label = host ? domainLabel(host).replace(/[^a-z0-9]/gi, "").toLowerCase() : "";
  const byLabel = (handles: Set<string>) => {
    const hits = label.length >= 3 ? [...handles].filter((h) => h.replace(/[._]/g, "") === label) : [];
    return hits.length === 1 ? hits[0] : null;
  };
  if (fromSameAs.size === 1) return [...fromSameAs][0];
  if (fromSameAs.size > 1) {
    const both = [...fromSameAs].filter((h) => fromPage.has(h));
    return both.length === 1 ? both[0] : byLabel(fromSameAs);
  }
  if (fromPage.size === 1) return [...fromPage][0];
  return byLabel(fromPage);
}

function instagramFrom(values: unknown[]): Set<string> {
  const handles = new Set<string>();
  for (const v of values.slice(0, MAX_ANCHORS)) {
    if (typeof v !== "string" || !/instagr(\.am|am\.com)/i.test(v)) continue;
    const handle = normalizeInstagramHandle(v);
    if (handle) handles.add(handle);
  }
  return handles;
}

function absoluteHttps(value: unknown, base: URL): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

const NOT_RASTER = /\.(ico|svg)(\?|#|$)/i;

/** Logo candidate from first-party evidence, strongest first (the fetched
 * image is still validated and size-checked in lib/brand-images.ts):
 *   1. the brand entity's JSON-LD `logo` (raster only);
 *   2. explicit logo metadata: <meta itemprop|property="logo"/"og:logo">;
 *   3. apple-touch-icon (declared size ≥ 120 or undeclared);
 *   4. <link rel="icon"> with a DECLARED size ≥ 120 (plain favicons are
 *      tiny and never qualify).
 * SVG and ICO are never candidates (the upload pipeline rejects them). */
function logoFrom(entity: Entity | null, meta: (key: string) => string | null, links: Collected["links"], base: URL): string | null {
  const logo = entity?.node.logo;
  const candidates = Array.isArray(logo) ? logo : [logo];
  for (const c of candidates.slice(0, 5)) {
    const value = c && typeof c === "object" ? ((c as JsonObject).url ?? (c as JsonObject).contentUrl) : c;
    if (typeof value === "string" && NOT_RASTER.test(value)) continue;
    const url = absoluteHttps(value, base);
    if (url) return url;
  }
  for (const key of ["og:logo", "logo"]) {
    const value = meta(key);
    if (value && NOT_RASTER.test(value)) continue;
    const url = absoluteHttps(value, base);
    if (url) return url;
  }
  const size = (s: string) => Math.max(0, ...s.split(/\s+/).map((p) => parseInt(p, 10) || 0));
  const raster = (l: Collected["links"][number]) => !NOT_RASTER.test(l.href) && l.type !== "image/svg+xml" && l.type !== "image/x-icon";
  const touch = links
    .filter((l) => l.rel.includes("apple-touch-icon") || l.rel.includes("apple-touch-icon-precomposed"))
    .filter((l) => !l.sizes || size(l.sizes) >= 120)
    .filter(raster)
    .sort((a, b) => size(b.sizes) - size(a.sizes));
  const icons = links
    .filter((l) => l.rel.includes("icon") && size(l.sizes) >= 120)
    .filter(raster)
    .sort((a, b) => size(b.sizes) - size(a.sizes));
  for (const l of [...touch, ...icons]) {
    const url = absoluteHttps(l.href, base);
    if (url) return url;
  }
  return null;
}

/** Same image regardless of query/fragment (CDN size/version params). */
export function sameImageSource(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.host.toLowerCase() === y.host.toLowerCase() && x.pathname === y.pathname;
  } catch {
    return a === b;
  }
}

const COVER_META_KEYS = ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"];

/** Share image → COVER candidate (never a logo). */
function coverFrom(meta: (key: string) => string | null, base: URL): string | null {
  for (const key of COVER_META_KEYS) {
    const value = meta(key);
    if (value && NOT_RASTER.test(value)) continue;
    const url = absoluteHttps(value, base);
    if (url) return url;
  }
  return null;
}

const TITLE_SEPARATOR = /\s+[|–—·:•-]\s+/;
const GENERIC_SEGMENT = /^(home|homepage|home page|official site|official website|welcome|shop|online store)$/i;

/** Cleans a <title> to its brand-name segment (exported for tests). */
export function nameFromTitle(title: string | null, host: string | null): string | null {
  const cleaned = cleanText(title, 300);
  if (!cleaned) return null;
  const segments = cleaned
    .split(TITLE_SEPARATOR)
    .map((s) => s.replace(/^welcome to\s+/i, "").trim())
    .filter((s) => s && !GENERIC_SEGMENT.test(s));
  if (segments.length === 0) return null;
  if (host) {
    const label = domainLabel(host);
    const match = segments.find((s) => compact(s) === label) ?? segments.find((s) => overlapsLabel(s, label));
    if (match) return cleanName(match);
  }
  return cleanName(segments[0]);
}

/** HTML → untrusted brand suggestions. `pageUrl` is the final fetched URL
 * (relative links resolve against it; its host disambiguates JSON-LD). */
export function extractBrandProfile(html: string, pageUrl: URL): ExtractedBrandProfile {
  const c = collect(html);
  const host = normalizeWebsiteHost(pageUrl.href);
  const { entities, websiteNames } = collectJsonLd(c.jsonLd);
  const entity = chooseEntity(entities, host);
  const meta = (key: string) => c.meta.get(key) ?? null;

  const distinctWebsiteNames = [...new Set(websiteNames.map(compact))];
  const name =
    cleanName(firstString(entity?.node.name)) ??
    cleanName(meta("og:site_name")) ??
    cleanName(meta("application-name")) ??
    (distinctWebsiteNames.length === 1 ? websiteNames[0] : null) ??
    nameFromTitle(c.title, host);

  // Description candidates in order; only USEFUL ones count (never the
  // brand name echoed back, greetings or boilerplate). About only when the
  // page itself offers more than a short description's worth — never
  // padded from a short one.
  const descriptionCandidates = [
    meta("description"),
    meta("og:description"),
    meta("twitter:description"),
    firstString(entity?.node.description),
  ]
    .map((d) => cleanText(d, 2000))
    .filter((d): d is string => Boolean(d) && isUsefulDescription(d, name));
  const shortDescription = descriptionCandidates.length ? toShortDescription(descriptionCandidates[0]) : null;
  const aboutSource = descriptionCandidates.find((d) => d.length > EXTRACT_DESCRIPTION_MAX);
  const aboutDescription = aboutSource ? cleanText(aboutSource, EXTRACT_ABOUT_MAX) : null;

  // Instagram: first-party evidence only (the brand entity's JSON-LD
  // sameAs, rel=me links, <a href>s on the page) — see
  // chooseInstagramHandle for the deterministic rule.
  const sameAs = entity?.node.sameAs;
  const fromSameAs = instagramFrom(Array.isArray(sameAs) ? sameAs : [sameAs]);
  const fromPage = instagramFrom([...c.links.filter((l) => l.rel.includes("me")).map((l) => l.href), ...c.instagramHrefs]);
  const instagramHandle = chooseInstagramHandle(fromSameAs, fromPage, host);

  const { city, state } = addressOf(entity);
  // Own-property lookup only — a hostile "@type": "constructor" must not
  // reach Object.prototype.
  const slugs = new Set((entity?.types ?? []).filter((t) => Object.hasOwn(SCHEMA_TYPE_CATEGORY_SLUG, t)).map((t) => SCHEMA_TYPE_CATEGORY_SLUG[t]));
  const categorySlug = slugs.size === 1 ? [...slugs][0] : null;

  const logoCandidateUrl = logoFrom(entity, meta, c.links, pageUrl);
  const coverCandidateUrl = coverFrom(meta, pageUrl);

  const excerpt: BrandPageExcerpt = {
    title: cleanText(c.title, 200),
    descriptions: [...new Set(
      [meta("description"), meta("og:description"), meta("twitter:description"), firstString(entity?.node.description)]
        .map((d) => cleanText(d, 400))
        .filter((d): d is string => Boolean(d))
    )].slice(0, 4),
    jsonLdName: cleanName(firstString(entity?.node.name)),
    jsonLdTypes: (entity?.types ?? []).slice(0, 5),
    headings: c.headings,
    paragraphs: c.paragraphs,
  };

  return {
    name,
    shortDescription,
    aboutDescription,
    instagramHandle,
    city,
    state,
    categorySlug,
    logoCandidateUrl,
    // Never the same image as the logo (a share image that IS the logo).
    coverCandidateUrl: sameImageSource(logoCandidateUrl, coverCandidateUrl) ? null : coverCandidateUrl,
    excerpt,
  };
}
