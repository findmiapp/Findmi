import { parse } from "parse5";
import { normalizeBusinessName, normalizeInstagramHandle, normalizeWebsiteHost } from "./business-matching";

/** Brand Onboarding V1.1B — deterministic, single-page brand metadata
 * extraction. Pure: HTML string in, a small set of UNTRUSTED suggestions
 * out. It reads only <title>, <meta>, <link rel>, JSON-LD
 * <script type="application/ld+json"> text, Instagram <a href>s and the
 * attributes of a bounded number of <img>s (logo/hero evidence), via
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
  /** The strongest LOGO candidate. Untrusted — fetched/validated only by
   * lib/brand-images. */
  logoCandidateUrl: string | null;
  /** The strongest COVER candidate (share image / hero) — never a logo. */
  coverCandidateUrl: string | null;
  /** Ranked, deduped, capped candidate pools (first = the field above).
   * Untrusted URLs — each is fetched and verified before any use. */
  logoCandidates: string[];
  coverCandidates: string[];
  /** VCL A3 — the page's declared web app manifest (https), consulted for
   * its icons only when no logo candidate verifies. Untrusted. */
  manifestUrl?: string | null;
  /** VCL A3c — external SVG logo URLs from STRONG logo evidence only
   * (JSON-LD logo, logo metadata, itemprop=logo, the header/home-link brand
   * mark). Never fetched here; inspected + rasterized by lib/brand-images. */
  svgLogoCandidates?: string[];
  /** VCL A3c — how many leading logoCandidates come from strong logo
   * evidence (the rest are touch/site icons). */
  logoStrongCount?: number;
  /** Diagnostics only: what the fetched page actually contained (counts
   * and yes/no — never URLs or text). */
  signals?: BrandPageSignals;
  excerpt: BrandPageExcerpt;
}

export interface BrandPageSignals {
  title: boolean;
  ogTitle: boolean;
  ogImage: number;
  twitterImage: number;
  metaLogo: boolean;
  jsonLdBlocks: number;
  brandEntity: boolean;
  entityLogo: boolean;
  instagramSameAs: number;
  instagramLinks: number;
  iconLinks: number;
  touchIcons: number;
  manifest: boolean;
  images: number;
  headerImages: number;
  headings: number;
  paragraphs: number;
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
  images: ImageEvidence[];
}

/** One <img> worth considering as a logo or cover — attributes only (it
 * is never fetched here). */
interface ImageEvidence {
  /** src / data-src (raw, unresolved). */
  src: string | null;
  /** Parsed srcset / data-srcset (raw URLs, width descriptor or 0). */
  srcset: { url: string; w: number }[];
  /** Lowercased alt + class + id + file name — hint text only. */
  hints: string;
  alt: string;
  itempropLogo: boolean;
  inHeader: boolean;
  inHero: boolean;
  /** href of the nearest enclosing <a>, if any (raw). */
  linkHref: string | null;
  /** Declared width/height attributes (0 = undeclared). */
  width: number;
  height: number;
}

const MAX_HEADINGS = 4;
/** <img> elements examined / kept as evidence — strict, small caps. */
const MAX_IMAGES_SCANNED = 300;
const MAX_IMAGE_EVIDENCE = 40;
const HEADER_CONTEXT = /header|navbar|masthead|topbar/;
const HERO_CONTEXT = /hero|banner|slideshow|slider|carousel|jumbotron|masthead/;
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

const ATTR_MAX = 300;
const lowerAttr = (node: HtmlNode, name: string) => (attr(node, name) ?? "").slice(0, ATTR_MAX).toLowerCase();

/** Parses a srcset value (bounded) into URLs with a width hint: "800w" →
 * 800, "2x" → 2000, none → 0. */
function parseSrcset(value: string | null): { url: string; w: number }[] {
  if (!value) return [];
  return value
    .slice(0, 4000)
    .split(/,\s+/)
    .slice(0, 20)
    .map((part) => {
      const [url, descriptor = ""] = part.trim().split(/\s+/);
      const w = descriptor.endsWith("w") ? parseInt(descriptor, 10) : descriptor.endsWith("x") ? Math.round(parseFloat(descriptor) * 1000) : 0;
      return { url, w: Number.isFinite(w) ? w : 0 };
    })
    .filter((c) => Boolean(c.url));
}

/** <img> → evidence when it is a plausible logo or hero image; tracking
 * pixels and images without a usable source are skipped. Context comes
 * from a bounded walk up the ancestors. */
function imageEvidence(node: HtmlNode): ImageEvidence | null {
  const src = [attr(node, "src"), attr(node, "data-src")].find((v) => v && !/^data:/i.test(v.trim())) ?? null;
  const srcset = parseSrcset(attr(node, "srcset") ?? attr(node, "data-srcset"));
  if (!src && srcset.length === 0) return null;
  const width = parseInt(attr(node, "width") ?? "", 10) || 0;
  const height = parseInt(attr(node, "height") ?? "", 10) || 0;
  if ((width > 0 && width <= 2) || (height > 0 && height <= 2)) return null; // tracking pixel
  const alt = (attr(node, "alt") ?? "").slice(0, ATTR_MAX);
  const file = (src ?? srcset[0]?.url ?? "").split(/[?#]/)[0].split("/").pop() ?? "";
  let inHeader = false;
  let inHero = false;
  let linkHref: string | null = null;
  let n = node.parentNode;
  for (let depth = 0; n && depth < 15; depth++, n = n.parentNode) {
    if (!n.tagName) continue;
    const context = `${lowerAttr(n, "class")} ${lowerAttr(n, "id")}`;
    if (n.tagName === "header" || n.tagName === "nav" || HEADER_CONTEXT.test(context)) inHeader = true;
    if (HERO_CONTEXT.test(context)) inHero = true;
    if (n.tagName === "a" && linkHref === null) linkHref = attr(n, "href");
  }
  return {
    src,
    srcset,
    hints: `${alt} ${lowerAttr(node, "class")} ${lowerAttr(node, "id")} ${file.slice(0, 120)}`.toLowerCase(),
    alt,
    itempropLogo: lowerAttr(node, "itemprop") === "logo",
    inHeader,
    inHero,
    linkHref,
    width,
    height,
  };
}

function collect(html: string): Collected {
  const out: Collected = { title: null, meta: new Map(), links: [], jsonLd: [], instagramHrefs: [], headings: [], paragraphs: [], images: [] };
  let imagesScanned = 0;
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
      } else if (tag === "img" && imagesScanned < MAX_IMAGES_SCANNED) {
        imagesScanned += 1;
        const evidence = imageEvidence(node);
        if (evidence && out.images.length < MAX_IMAGE_EVIDENCE) out.images.push(evidence);
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

/** Strict caps on each ranked candidate pool (only the first few are ever
 * fetched — see BRAND_IMAGE_VERIFY_MAX in lib/brand-candidate-builder). */
export const LOGO_CANDIDATE_MAX = 4;
export const COVER_CANDIDATE_MAX = 4;

/** Image hint words: a logo/wordmark (never a cover), and things that are
 * neither a brand logo nor a cover (payment marks, badges, press/partner
 * strips, sprites, pixels). */
const LOGO_HINT = /logo|wordmark|brandmark|brand-mark|logotype/;
const NOT_BRAND_IMAGE = new RegExp(
  "(?<![a-z])(badges?|payments?|visa|mastercard|amex|paypal|klarna|afterpay|affirm|apple-?pay|google-?pay|shop-?pay|trustpilot|awards?|flags?|press|featured|as-seen|seen-in|partners?|sponsors?|sprites?|pixel|spacer|tracking|avatars?|stars?|ratings?|reviews?)(?![a-z])|icon-"
);

/** Evidence strength for each source (higher wins; ties keep page order). */
export const LOGO_SOURCE_RANK = { jsonld_logo: 100, meta_logo: 90, img_itemprop_logo: 85, header_logo_img: 75, apple_touch_icon: 40, site_icon: 30 } as const;
export const COVER_SOURCE_RANK = { og_image: 90, twitter_image: 80, jsonld_image: 70, hero_img: 60 } as const;

interface Ranked {
  url: string;
  rank: number;
}

/** Ranked → deduped (same host + path, i.e. CDN size/version params
 * ignored), highest evidence first, capped. */
function rankedUnique(list: Ranked[], max: number, exclude: string[] = []): string[] {
  const out: string[] = [];
  const sorted = list.map((c, i) => ({ ...c, i })).sort((x, y) => y.rank - x.rank || x.i - y.i);
  for (const c of sorted) {
    if (out.length >= max) break;
    if (exclude.some((e) => sameImageSource(e, c.url)) || out.some((o) => sameImageSource(o, c.url))) continue;
    out.push(c.url);
  }
  return out;
}

/** A raster https URL (SVG/ICO never: the upload pipeline rejects them). */
function rasterUrl(value: unknown, base: URL): string | null {
  if (typeof value === "string" && NOT_RASTER.test(value)) return null;
  const url = absoluteHttps(value, base);
  return url && !NOT_RASTER.test(url) ? url : null;
}

/** JSON-LD image-ish values: "url", { url | contentUrl }, or a list. */
function jsonLdImageUrls(value: unknown, base: URL): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list
    .slice(0, 5)
    .map((c) => (c && typeof c === "object" ? ((c as JsonObject).url ?? (c as JsonObject).contentUrl) : c))
    .map((v) => rasterUrl(v, base))
    .filter((u): u is string => Boolean(u));
}

/** The <img> source to use for a role: from srcset the largest width not
 * above `maxW` (else the smallest listed), otherwise src/data-src. */
function imageUrl(img: ImageEvidence, maxW: number, base: URL): string | null {
  if (img.srcset.length) {
    const fits = img.srcset.filter((c) => c.w > 0 && c.w <= maxW).sort((a, b) => b.w - a.w)[0];
    const pick = fits ?? [...img.srcset].sort((a, b) => (a.w || Infinity) - (b.w || Infinity))[0];
    const url = rasterUrl(pick?.url, base);
    if (url) return url;
  }
  return rasterUrl(img.src, base);
}

/** True when an <a href> points at this site's home page. */
function isHomeLink(href: string | null, base: URL): boolean {
  if (href === null) return false;
  try {
    const url = new URL(href, base);
    return normalizeWebsiteHost(url.href) === normalizeWebsiteHost(base.href) && (url.pathname === "/" || url.pathname === base.pathname);
  } catch {
    return false;
  }
}

/** The page's own brand-mark image: a logo hint (or alt naming the brand)
 * AND brand-mark placement (header/nav, or a link to the home page).
 * Logo-like images elsewhere (press strips, partner logos) never count. */
function isPageLogo(img: ImageEvidence, brandKeys: string[], base: URL): boolean {
  if (NOT_BRAND_IMAGE.test(img.hints)) return false;
  if (img.width > 0 && img.height > 0 && Math.max(img.width, img.height) < 60) return false;
  const altKey = compact(img.alt);
  const namesBrand = altKey.length >= 3 && brandKeys.some((k) => k.length >= 3 && (altKey === k || altKey.startsWith(k)));
  return (LOGO_HINT.test(img.hints) || namesBrand) && (img.inHeader || isHomeLink(img.linkHref, base));
}

/** Ranked LOGO candidates from first-party evidence (each still fetched
 * and verified by lib/brand-images before it is used):
 *   1. the brand entity's JSON-LD `logo`;
 *   2. explicit logo metadata: <meta property|name|itemprop = og:logo/logo>;
 *   3. <img itemprop="logo">;
 *   4. the page's header / home-link brand-mark <img> (see isPageLogo);
 *   5. apple-touch-icon (declared size ≥ 120 or undeclared);
 *   6. <link rel="icon"> with a DECLARED size ≥ 120 (plain favicons are
 *      tiny and never qualify).
 * SVG and ICO are never candidates. Exported for tests. */
export function logoCandidatesFrom(
  entity: { node: Record<string, unknown> } | null,
  meta: (key: string) => string | null,
  links: Collected["links"],
  images: ImageEvidence[],
  base: URL,
  brandKeys: string[]
): string[] {
  const out: Ranked[] = [];
  for (const url of jsonLdImageUrls(entity?.node.logo, base)) out.push({ url, rank: LOGO_SOURCE_RANK.jsonld_logo });
  for (const key of ["og:logo", "logo"]) {
    const url = rasterUrl(meta(key), base);
    if (url) out.push({ url, rank: LOGO_SOURCE_RANK.meta_logo });
  }
  for (const img of images) {
    if (img.itempropLogo && !NOT_BRAND_IMAGE.test(img.hints)) {
      const url = imageUrl(img, 1000, base);
      if (url) out.push({ url, rank: LOGO_SOURCE_RANK.img_itemprop_logo });
    } else if (isPageLogo(img, brandKeys, base)) {
      const url = imageUrl(img, 1000, base);
      if (url) out.push({ url, rank: LOGO_SOURCE_RANK.header_logo_img });
    }
  }
  const size = (s: string) => Math.max(0, ...s.split(/\s+/).map((p) => parseInt(p, 10) || 0));
  const raster = (l: Collected["links"][number]) => l.type !== "image/svg+xml" && l.type !== "image/x-icon";
  const touch = links
    .filter((l) => l.rel.includes("apple-touch-icon") || l.rel.includes("apple-touch-icon-precomposed"))
    .filter((l) => !l.sizes || size(l.sizes) >= 120)
    .filter(raster)
    .sort((a, b) => size(b.sizes) - size(a.sizes));
  const icons = links
    .filter((l) => l.rel.includes("icon") && size(l.sizes) >= 120)
    .filter(raster)
    .sort((a, b) => size(b.sizes) - size(a.sizes));
  for (const l of touch) {
    const url = rasterUrl(l.href, base);
    if (url) out.push({ url, rank: LOGO_SOURCE_RANK.apple_touch_icon });
  }
  for (const l of icons) {
    const url = rasterUrl(l.href, base);
    if (url) out.push({ url, rank: LOGO_SOURCE_RANK.site_icon });
  }
  return rankedUnique(out, LOGO_CANDIDATE_MAX);
}

/** VCL A3 — identity candidates from a web app manifest's `icons` (exported
 * for tests): an app icon is a first-party, square, compact identity mark —
 * the same kind of evidence as apple-touch-icon. Bounded and defensive:
 * ≤ 64 KB of JSON (the fetch caps it), ≤ 20 icons read, raster only (SVG /
 * ICO never), a DECLARED size ≥ 192, and only "any"-purpose icons
 * (maskable/monochrome variants are padded or single-colour). Largest
 * first, resolved against the manifest's own URL, https only. Never
 * throws; malformed JSON → []. */
export const MANIFEST_ICON_MIN_SIZE = 192;
export function manifestIconCandidates(text: string, manifestUrl: URL): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.length > 65_536 ? "" : text);
  } catch {
    return [];
  }
  const icons = parsed && typeof parsed === "object" ? (parsed as JsonObject).icons : null;
  if (!Array.isArray(icons)) return [];
  const out: Ranked[] = [];
  for (const icon of icons.slice(0, 20)) {
    if (!icon || typeof icon !== "object") continue;
    const { src, sizes, type, purpose } = icon as JsonObject;
    if (typeof purpose === "string" && !purpose.toLowerCase().split(/\s+/).includes("any")) continue;
    if (typeof type === "string" && !/^image\/(png|jpeg|webp|gif)$/i.test(type.trim())) continue;
    const size = typeof sizes === "string" ? Math.max(0, ...sizes.split(/\s+/).map((p) => parseInt(p, 10) || 0)) : 0;
    if (size < MANIFEST_ICON_MIN_SIZE) continue;
    const url = rasterUrl(src, manifestUrl);
    if (url) out.push({ url, rank: size });
  }
  return rankedUnique(out, LOGO_CANDIDATE_MAX);
}

/** VCL A3c — an https URL whose path is an .svg file (the SVG logo path
 * is only ever chosen for these; the content is still verified). */
export function isSvgCandidateUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /\.svg$/i.test(u.pathname);
  } catch {
    return false;
  }
}
export const SVG_LOGO_CANDIDATE_MAX = 2;

function svgUrl(value: unknown, base: URL): string | null {
  const url = absoluteHttps(value, base);
  return url && isSvgCandidateUrl(url) ? url : null;
}

/** VCL A3c — SVG logo candidates from the same STRONG sources (and the
 * same rules) as the raster logo ranking — never icons, favicons,
 * mask-icons, decorative/social/menu SVGs or inline <svg>. Exported for
 * tests. */
export function svgLogoCandidatesFrom(
  entity: { node: Record<string, unknown> } | null,
  meta: (key: string) => string | null,
  images: ImageEvidence[],
  base: URL,
  brandKeys: string[]
): string[] {
  const out: Ranked[] = [];
  const ldLogos = Array.isArray(entity?.node.logo) ? entity!.node.logo : [entity?.node.logo];
  for (const v of (ldLogos as unknown[]).slice(0, 5)) {
    const raw = v && typeof v === "object" ? ((v as JsonObject).url ?? (v as JsonObject).contentUrl) : v;
    const url = svgUrl(raw, base);
    if (url) out.push({ url, rank: LOGO_SOURCE_RANK.jsonld_logo });
  }
  for (const key of ["og:logo", "logo"]) {
    const url = svgUrl(meta(key), base);
    if (url) out.push({ url, rank: LOGO_SOURCE_RANK.meta_logo });
  }
  for (const img of images) {
    const src = svgUrl(img.src, base);
    if (!src) continue;
    if (img.itempropLogo && !NOT_BRAND_IMAGE.test(img.hints)) out.push({ url: src, rank: LOGO_SOURCE_RANK.img_itemprop_logo });
    else if (isPageLogo(img, brandKeys, base)) out.push({ url: src, rank: LOGO_SOURCE_RANK.header_logo_img });
  }
  return rankedUnique(out, SVG_LOGO_CANDIDATE_MAX);
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

const OG_IMAGE_KEYS = ["og:image:secure_url", "og:image", "og:image:url"];
const TWITTER_IMAGE_KEYS = ["twitter:image", "twitter:image:src"];

/** Ranked COVER candidates (never a logo): share images (og: then
 * twitter:), the brand entity's JSON-LD `image`, then at most two hero /
 * banner <img>s. Anything evidenced as a logo — any logo candidate URL,
 * or a logo/wordmark hint in the file name — is excluded; so are badges,
 * sprites and images declared too small to be a cover. Exported for
 * tests. */
export function coverCandidatesFrom(
  entity: { node: Record<string, unknown> } | null,
  meta: (key: string) => string | null,
  images: ImageEvidence[],
  base: URL,
  logoCandidates: string[]
): string[] {
  const out: Ranked[] = [];
  const fileHint = (url: string) => (url.split(/[?#]/)[0].split("/").pop() ?? "").toLowerCase();
  const push = (url: string | null, rank: number) => {
    if (url && !LOGO_HINT.test(fileHint(url)) && !NOT_BRAND_IMAGE.test(fileHint(url))) out.push({ url, rank });
  };
  for (const key of OG_IMAGE_KEYS) push(rasterUrl(meta(key), base), COVER_SOURCE_RANK.og_image);
  for (const key of TWITTER_IMAGE_KEYS) push(rasterUrl(meta(key), base), COVER_SOURCE_RANK.twitter_image);
  for (const url of jsonLdImageUrls(entity?.node.image, base)) push(url, COVER_SOURCE_RANK.jsonld_image);
  let heroes = 0;
  for (const img of images) {
    if (heroes >= 2) break;
    if (!img.inHero || img.inHeader || img.itempropLogo || LOGO_HINT.test(img.hints) || NOT_BRAND_IMAGE.test(img.hints)) continue;
    if (img.width > 0 && img.width < 600) continue;
    const url = imageUrl(img, 2000, base);
    if (url) {
      push(url, COVER_SOURCE_RANK.hero_img);
      heroes += 1;
    }
  }
  return rankedUnique(out, COVER_CANDIDATE_MAX, logoCandidates);
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

  const brandKeys = [name ? compact(name) : "", host ? domainLabel(host) : ""].filter(Boolean);
  const logoCandidates = logoCandidatesFrom(entity, meta, c.links, c.images, pageUrl, brandKeys);
  // Strong candidates are the ones that don't depend on icon <link>s.
  const strongLogos = logoCandidatesFrom(entity, meta, [], c.images, pageUrl, brandKeys);
  const logoStrongCount = logoCandidates.filter((u) => strongLogos.includes(u)).length;
  const svgLogoCandidates = svgLogoCandidatesFrom(entity, meta, c.images, pageUrl, brandKeys);
  // Never the same image as any logo candidate (a share image that IS the logo).
  const coverCandidates = coverCandidatesFrom(entity, meta, c.images, pageUrl, logoCandidates);

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
    logoCandidateUrl: logoCandidates[0] ?? null,
    coverCandidateUrl: coverCandidates[0] ?? null,
    logoCandidates,
    coverCandidates,
    manifestUrl: absoluteHttps(c.links.find((l) => l.rel.includes("manifest"))?.href, pageUrl),
    svgLogoCandidates,
    logoStrongCount,
    signals: {
      title: Boolean(c.title),
      ogTitle: Boolean(meta("og:title")),
      ogImage: OG_IMAGE_KEYS.filter((k) => meta(k)).length,
      twitterImage: TWITTER_IMAGE_KEYS.filter((k) => meta(k)).length,
      metaLogo: Boolean(meta("og:logo") || meta("logo")),
      jsonLdBlocks: c.jsonLd.length,
      brandEntity: Boolean(entity),
      entityLogo: Boolean(entity?.node.logo),
      instagramSameAs: fromSameAs.size,
      instagramLinks: fromPage.size,
      iconLinks: c.links.filter((l) => l.rel.includes("icon")).length,
      touchIcons: c.links.filter((l) => l.rel.includes("apple-touch-icon") || l.rel.includes("apple-touch-icon-precomposed")).length,
      manifest: c.links.some((l) => l.rel.includes("manifest")),
      images: c.images.length,
      headerImages: c.images.filter((i) => i.inHeader).length,
      headings: c.headings.length,
      paragraphs: c.paragraphs.length,
    },
    excerpt,
  };
}
