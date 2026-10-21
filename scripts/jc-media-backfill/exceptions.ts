// One-off Jersey City media EXCEPTION pass (JC_BACKFILL_MODE=exceptions in
// the manually dispatched jc-media-backfill workflow). For the media fields
// the first backfill couldn't fill, it reads each official page's ACTUAL
// assets (share metadata, JSON-LD images, and content <img>/<picture>/
// srcset images — first-party only) and picks the best entity-specific
// photograph or event artwork. Nothing here fetches, validates or stores on
// its own — it reuses, unchanged:
//
//   pages   → safeFetchEventPage (guarded HTML fetch: https, SSRF-guarded
//             DNS, re-validated redirects, timeouts, size limits)
//   covers  → fetchVerifiedEventImage (guarded image fetch + real-bytes
//             validation + size/shape rules) → storeEventImage
//             (storePublicImage: findmi-media + WebP variants)
//   logos   → fetchVerifiedBrandImage(url, "logo") → storeBrandImage
//   meta    → representativePageImages (Admin Media Enrichment resolver)
//   provenance → writeProvenance (Admin Media Enrichment sidecar)
//
// Phase 1 resolves every target and prints the dry-run table. Phase 2
// writes ONLY high-confidence READY rows, each as `UPDATE … WHERE id = $1
// AND <column> IS NULL` (never overwriting). Ambiguous candidates stay
// unresolved. One record's failure never stops the run.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parse } from "parse5";
import sharp from "sharp";
import { writeProvenance } from "@/lib/admin/media-enrichment";
import { fetchVerifiedEventImage, storeEventImage, type VerifiedEventImage } from "@/lib/event-import/media";
import { fetchVerifiedBrandImage, storeBrandImage, isLowInformationGraphic, type VerifiedBrandImage } from "@/lib/brand-images";
import { representativePageImages, type PageImageSource } from "@/lib/event-import/extract";
import { extractBrandProfile } from "@/lib/brand-website-extract";
import { safeFetchEventPage, validateFetchUrl } from "@/lib/safe-fetch";

const JERSEY_CITY_AREA_ID = "b28874dc-13fc-4b21-b9bf-6160d312983d";

// ── Approved per-record rules ────────────────────────────────────────────

/** Never media-enriched (approved exclusions). */
const SKIP_EVENTS = new Set([
  "mana-contemporary-three-works-by-athena-latocha", // until the 2026 listing itself is verified
  "jcymap-2026-celebration-art-exhibition-documentary-premiere", // no generic Mana media
  "cat-stick-easel-moon-closing-reception", // no generic SMUSH / Cultural Affairs media
]);
/** The chosen asset (its URL, alt text or the page it came from) must
 * name the event itself. */
const REQUIRE_KEYWORD: Record<string, RegExp> = {
  "rocky-horror-picture-show-live-shadow-cast-lsc-2026": /rocky[-_ ]?horror/i,
  "jodeci-loews-jersey-2026": /jodeci/i,
};
/** A listing page to search for the event's own first-party page. */
const FIND_EVENT_PAGE: Record<string, { listing: string; keyword: RegExp }> = {
  "jodeci-loews-jersey-2026": { listing: "https://loewsjersey.com/events", keyword: /jodeci/i },
  "rocky-horror-picture-show-live-shadow-cast-lsc-2026": { listing: "https://lsc.org/explore/lsc-after-dark", keyword: /rocky[-_ ]?horror/i },
};
/** Official source to read when the record has none / an http-only one.
 * Read-only: no record's source fields are changed by this pass. `verify`
 * must match the fetched page before anything from it is used. */
const SOURCE_OVERRIDES: Record<string, { url: string; verify?: RegExp }> = {
  "bread-and-salt-jersey-city": { url: "https://breadandsaltjc.com/", verify: /palisade/i },
  "pet-shop-jersey-city": { url: "https://www.petshopjc.com/" },
};

// ── Candidate extraction (parsing only; no page script ever runs) ────────

interface HtmlNode {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
  content?: HtmlNode;
}
const attr = (n: HtmlNode, name: string) => n.attrs?.find((a) => a.name === name)?.value ?? null;

export interface Candidate {
  url: string;
  source: "meta" | "jsonld" | "content";
  metaKey?: PageImageSource;
  alt: string;
  context: string; // ancestor tag/class/id words
  inChrome: boolean; // nav / footer / aside
  inHeader: boolean;
  inMain: boolean;
  declaredMax: number; // largest declared dimension (attrs / srcset / squarespace data)
  order: number;
}

/** Site-builder CDNs whose media belong to the site they're embedded in. */
const FIRST_PARTY_CDNS = ["squarespace-cdn.com", "squarespace.com", "wixstatic.com", "wp.com", "shopify.com", "sanity.io", "getbento.com"];
export function registrable(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, "").split(".");
  return parts.slice(-2).join(".");
}
export function isFirstParty(candidate: string, pageUrl: URL, siteUrl: string | null): boolean {
  try {
    const h = new URL(candidate).hostname.toLowerCase();
    const own = new Set([registrable(pageUrl.hostname), ...(siteUrl ? [registrable(new URL(siteUrl).hostname)] : [])]);
    return own.has(registrable(h)) || FIRST_PARTY_CDNS.some((d) => h === d || h.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/** Larger originals for known site builders (same asset, no resize). */
export function originalAsset(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("wixstatic.com")) {
      const m = u.pathname.match(/^(\/media\/[^/]+~mv2\.[a-z0-9]+)/i);
      if (m) return `${u.origin}${m[1]}`;
    }
    if (u.hostname.endsWith("squarespace-cdn.com") || u.hostname.startsWith("static1.squarespace")) {
      u.search = "?format=2500w";
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

function largestFromSrcset(srcset: string, base: URL): { url: string; w: number } | null {
  let best: { url: string; w: number } | null = null;
  for (const part of srcset.split(",")) {
    const [raw, desc] = part.trim().split(/\s+/);
    if (!raw) continue;
    const w = desc?.endsWith("w") ? Number(desc.slice(0, -1)) : desc?.endsWith("x") ? Number(desc.slice(0, -1)) * 1000 : 0;
    try {
      const url = new URL(raw, base).toString();
      if (!best || w > best.w) best = { url, w };
    } catch {
      // ignore
    }
  }
  return best;
}

export function contentCandidates(html: string, pageUrl: URL): Candidate[] {
  const out: Candidate[] = [];
  let order = 0;
  const doc = parse(html) as unknown as HtmlNode;
  const walk = (node: HtmlNode, ctx: { words: string; chrome: boolean; header: boolean; main: boolean }, budget: { n: number }) => {
    if (budget.n-- <= 0) return;
    const tag = node.tagName;
    if (tag === "script" || tag === "style" || tag === "noscript" || tag === "svg") return;
    const cls = `${attr(node, "class") ?? ""} ${attr(node, "id") ?? ""}`.toLowerCase();
    const next = {
      words: `${ctx.words} ${tag ?? ""} ${cls}`.slice(-600),
      chrome: ctx.chrome || tag === "nav" || tag === "footer" || tag === "aside" || /\b(site-footer|footer|navbar|nav-menu|menu)\b/.test(cls),
      header: ctx.header || tag === "header",
      main: ctx.main || tag === "main" || tag === "article" || /\b(content|entry|main|post|event)\b/.test(cls),
    };
    if (tag === "img" || tag === "source") {
      const srcs: { url: string; w: number }[] = [];
      for (const name of ["srcset", "data-srcset", "data-lazy-srcset"]) {
        const v = attr(node, name);
        const best = v ? largestFromSrcset(v, pageUrl) : null;
        if (best) srcs.push(best);
      }
      for (const name of ["data-src", "data-lazy-src", "data-image", "data-original", "src"]) {
        const v = attr(node, name);
        if (v && !v.startsWith("data:")) {
          try {
            srcs.push({ url: new URL(v, pageUrl).toString(), w: 0 });
          } catch {
            // ignore
          }
        }
      }
      const dims = (attr(node, "data-image-dimensions") ?? "").split("x").map(Number);
      const declared = Math.max(Number(attr(node, "width")) || 0, Number(attr(node, "height")) || 0, ...dims.filter(Number.isFinite), ...srcs.map((s) => (s.w < 1000 ? s.w : 0)));
      const pick = srcs.sort((a, b) => b.w - a.w)[0];
      if (pick && pick.url.startsWith("https://")) {
        out.push({
          url: originalAsset(pick.url),
          source: "content",
          alt: (attr(node, "alt") ?? attr(node, "title") ?? "").slice(0, 200),
          context: next.words,
          inChrome: next.chrome,
          inHeader: next.header,
          inMain: next.main,
          declaredMax: declared,
          order: order++,
        });
      }
    }
    for (const child of node.childNodes ?? []) walk(child, next, budget);
    if (node.content) walk(node.content, next, budget);
  };
  walk(doc, { words: "", chrome: false, header: false, main: false }, { n: 80_000 });
  return out;
}

// ── Quality guard + scoring ──────────────────────────────────────────────

const BRANDING = /(logo|icon|favicon|seal|brandmark|emblem|badge|sprite|avatar|placeholder|spinner|loading|pixel|1x1|watermark|wordmark)/i;
const HERO = /(hero|banner|featured|event-image|post-thumbnail|wp-post-image|gallery|slide|cover|masthead|header-image|tribe-events-event-image|image-block|sqs-image)/i;
const GENERIC_WORDS = new Set(["jersey", "city", "park", "coffee", "brewing", "company", "gallery", "house", "hall", "center", "centre", "library", "public", "free", "main", "downtown", "place", "plaza", "avenue", "pedestrian", "historic", "cemetery", "2026", "live", "show", "picture", "closing", "weekend", "reception", "market", "farmers", "family", "experience", "contemporary", "presents", "the", "and"]);
export const distinctiveTokens = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !GENERIC_WORDS.has(t));

const fileName = (url: string) => {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    return url;
  }
};

/** Why a candidate can't be a COVER (null = may be). */
export function coverRejection(c: Candidate, logoUrls: Set<string>): string | null {
  if (/\.svg(\?|$)/i.test(c.url)) return "svg (branding)";
  if (BRANDING.test(fileName(c.url)) || BRANDING.test(c.alt)) return "named as logo/icon/seal";
  if (c.source === "content" && /\blogo\b/.test(c.context)) return "inside a logo element";
  if (c.inChrome) return "site navigation/footer image";
  if (logoUrls.has(c.url)) return "same asset as the site's logo";
  return null;
}

export function score(c: Candidate, tokens: string[]): number {
  let s = c.source === "content" ? 1 : 3;
  if (c.source === "content" && (c.inMain || HERO.test(c.context))) s += 2;
  const text = `${fileName(c.url)} ${c.alt}`.toLowerCase();
  if (tokens.some((t) => text.includes(t))) s += 2;
  if (c.declaredMax >= 1000) s += 1;
  return s;
}

/** Post-fetch checks for a cover: real photo/artwork, not padded branding. */
async function coverImageRejection(image: VerifiedEventImage, kind: "event" | "place" | "business"): Promise<string | null> {
  const long = Math.max(image.width, image.height);
  const short = Math.min(image.width, image.height);
  if (long < 800 || short < 400) return `too small for a cover (${image.width}×${image.height})`;
  try {
    const stats = await sharp(image.body, { animated: false }).stats();
    if (stats.channels.length === 4 && stats.channels[3].mean < 250) return "transparent/padded (branding)";
    if (kind !== "event" && (await isLowInformationGraphic(image.body))) return "flat graphic, not a photo";
  } catch {
    return "unreadable";
  }
  return null;
}

// ── Per-record resolution ────────────────────────────────────────────────

type Target = { table: "locations" | "events" | "businesses"; kind: "place" | "event" | "business"; id: string; slug: string; name: string; column: "cover_image_url" | "logo_url"; source: string | null; site: string | null };
type Ready = { verified: { kind: "cover"; image: VerifiedEventImage } | { kind: "logo"; image: VerifiedBrandImage }; asset: string; page: string; from: PageImageSource; why: string };
type Row = { target: Target; status: "READY" | "UNRESOLVED"; asset: string; page: string; why: string; ready?: Ready };

async function readPage(url: string): Promise<{ error: string } | { url: URL; html: string }> {
  const checked = validateFetchUrl(url, { allowSharedPlatforms: true });
  if (!checked.ok) return { error: `source not allowed (${checked.code})` };
  const page = await safeFetchEventPage(checked.url.href);
  if (!page.ok) return { error: `page couldn't be read (${page.code}${page.status ? ` ${page.status}` : ""})` };
  return { url: page.url, html: page.html };
}

async function resolveCover(t: Target): Promise<Row> {
  const base = (status: Row["status"], asset: string, page: string, why: string, ready?: Ready): Row => ({ target: t, status, asset, page, why, ready });
  const override = SOURCE_OVERRIDES[t.slug];
  let source = override?.url ?? t.source;
  if (!source) return base("UNRESOLVED", "—", "—", "no official source");
  // An event's own page found on its official listing page (first-party only).
  const finder = FIND_EVENT_PAGE[t.slug];
  if (finder) {
    const listing = await readPage(finder.listing);
    if ("error" in listing) return base("UNRESOLVED", "—", finder.listing, listing.error);
    const links = contentLinks(listing.html, listing.url).filter((l) => finder.keyword.test(`${l.href} ${l.text}`) && registrable(new URL(l.href).hostname) === registrable(listing.url.hostname));
    source = links[0]?.href ?? finder.listing;
  }
  const page = await readPage(source);
  if ("error" in page) return base("UNRESOLVED", "—", source, page.error);
  if (override?.verify && !override.verify.test(page.html)) return base("UNRESOLVED", "—", page.url.href, "page doesn't identify this place");
  const keyword = REQUIRE_KEYWORD[t.slug];

  const profile = extractBrandProfile(page.html, page.url);
  const logoUrls = new Set([...(profile.logoCandidates ?? []), ...(profile.svgLogoCandidates ?? []), ...(profile.logoCandidateUrl ? [profile.logoCandidateUrl] : [])].map(originalAsset));
  const meta: Candidate[] = representativePageImages(page.html, page.url).map((m, i) => ({ url: originalAsset(m.url), source: m.source === "jsonld" ? "jsonld" : m.source === "page" ? "content" : "meta", metaKey: m.source, alt: "", context: "", inChrome: false, inHeader: false, inMain: true, declaredMax: 0, order: -100 + i }));
  const all = [...meta, ...contentCandidates(page.html, page.url)].filter((c) => isFirstParty(c.url, page.url, t.site));
  const seen = new Set<string>();
  const tokens = distinctiveTokens(t.name);
  const ranked = all
    .filter((c) => !seen.has(c.url) && seen.add(c.url))
    .map((c) => ({ c, rejected: coverRejection(c, logoUrls), s: score(c, tokens) }))
    .filter((x) => !x.rejected)
    .filter((x) => !keyword || keyword.test(`${x.c.url} ${x.c.alt} ${page.url.href}`))
    .sort((a, b) => b.s - a.s || a.c.order - b.c.order);
  if (ranked.length === 0) return base("UNRESOLVED", "—", page.url.href, keyword ? "no asset specific to this event" : `no usable photo/artwork (${all.length} first-party images, all branding/navigation)`);

  let lastWhy = "";
  for (const { c, s } of ranked.slice(0, 6)) {
    const v = await fetchVerifiedEventImage(c.url);
    if (!v.ok) {
      lastWhy = `candidate failed validation (${v.reason})`;
      continue;
    }
    const bad = await coverImageRejection(v.image, t.kind);
    if (bad) {
      lastWhy = bad;
      continue;
    }
    const why = `${c.metaKey ?? c.source}${c.alt ? ` alt="${c.alt.slice(0, 60)}"` : ""}, ${v.image.width}×${v.image.height}, score ${s}`;
    const from: PageImageSource = c.metaKey ?? (c.source === "jsonld" ? "jsonld" : "page");
    if (s < 3) return base("UNRESOLVED", c.url, page.url.href, `ambiguous: low-confidence ${why}`);
    return base("READY", c.url, page.url.href, why, { verified: { kind: "cover", image: v.image }, asset: c.url, page: page.url.href, from, why });
  }
  return base("UNRESOLVED", ranked[0].c.url, page.url.href, lastWhy || "no candidate passed validation");
}

async function resolveLogo(t: Target): Promise<Row> {
  const base = (status: Row["status"], asset: string, page: string, why: string, ready?: Ready): Row => ({ target: t, status, asset, page, why, ready });
  if (!t.source) return base("UNRESOLVED", "—", "—", "no official source");
  const page = await readPage(t.source);
  if ("error" in page) return base("UNRESOLVED", "—", t.source, page.error);
  const tokens = distinctiveTokens(t.name);
  const candidates = contentCandidates(page.html, page.url)
    .filter((c) => isFirstParty(c.url, page.url, t.site))
    .filter((c) => /logo/i.test(`${fileName(c.url)} ${c.alt} ${c.context}`))
    .map((c) => {
      const text = `${fileName(c.url)} ${c.alt}`.toLowerCase();
      const named = /logo/.test(text);
      const branded = tokens.some((t) => text.includes(t));
      return { c, high: named && (branded || c.inHeader || /\b(header|nav|navbar|site-title|brand)\b/.test(c.context)) };
    })
    .sort((a, b) => Number(b.high) - Number(a.high) || a.c.order - b.c.order);
  if (candidates.length === 0) return base("UNRESOLVED", "—", page.url.href, "no logo asset on the official website");
  for (const { c, high } of candidates.slice(0, 4)) {
    const v = await fetchVerifiedBrandImage(c.url, "logo");
    if (!v.ok) continue;
    const why = `content logo${c.alt ? ` alt="${c.alt.slice(0, 60)}"` : ""}${c.inHeader ? " in header" : ""}`;
    if (!high) return base("UNRESOLVED", c.url, page.url.href, `ambiguous: ${why}`);
    return base("READY", c.url, page.url.href, why, { verified: { kind: "logo", image: v.image }, asset: c.url, page: page.url.href, from: "page", why });
  }
  return base("UNRESOLVED", candidates[0].c.url, page.url.href, "logo candidates failed validation");
}

function contentLinks(html: string, base: URL): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  const doc = parse(html) as unknown as HtmlNode;
  const text = (n: HtmlNode): string => (n.nodeName === "#text" ? ((n as unknown as { value: string }).value ?? "") : (n.childNodes ?? []).map(text).join(" "));
  const walk = (n: HtmlNode, budget: { n: number }) => {
    if (budget.n-- <= 0) return;
    if (n.tagName === "a") {
      const href = attr(n, "href");
      try {
        if (href) out.push({ href: new URL(href, base).toString(), text: text(n).replace(/\s+/g, " ").trim().slice(0, 200) });
      } catch {
        // ignore
      }
    }
    for (const c of n.childNodes ?? []) walk(c, budget);
  };
  walk(doc, { n: 80_000 });
  return out.filter((l) => l.href.startsWith("https://"));
}

// ── Main ─────────────────────────────────────────────────────────────────

async function targets(db: SupabaseClient): Promise<Target[]> {
  const { data: areas } = await db.from("market_areas").select("id").or(`id.eq.${JERSEY_CITY_AREA_ID},parent_area_id.eq.${JERSEY_CITY_AREA_ID}`);
  const areaIds = (areas ?? []).map((a) => a.id as string);
  if (!areaIds.length) throw new Error("Couldn't read the Jersey City Area.");
  const [{ data: locations }, { data: events }] = await Promise.all([
    db.from("locations").select("id, slug, name, website_url, cover_image_url").in("market_area_id", areaIds).is("trashed_at", null),
    db.from("events").select("id, slug, name, external_url, cover_image_url").in("market_area_id", areaIds).is("trashed_at", null),
  ]);
  const locIds = (locations ?? []).map((l) => l.id as string);
  const evIds = (events ?? []).map((e) => e.id as string);
  const [{ data: own }, { data: atPlaces }, { data: onRosters }] = await Promise.all([
    db.from("businesses").select("id").in("market_area_id", areaIds),
    db.from("business_locations").select("business_id").in("location_id", locIds),
    db.from("event_businesses").select("business_id").in("event_id", evIds).eq("status", "approved"),
  ]);
  const bizIds = [...new Set([...(own ?? []).map((b) => b.id), ...(atPlaces ?? []).map((b) => b.business_id), ...(onRosters ?? []).map((b) => b.business_id)])] as string[];
  const { data: businesses } = await db.from("businesses").select("id, slug, name, website_url, cover_image_url, logo_url").in("id", bizIds).is("trashed_at", null);
  const list: Target[] = [];
  for (const l of locations ?? []) if (!l.cover_image_url) list.push({ table: "locations", kind: "place", id: l.id, slug: l.slug, name: l.name, column: "cover_image_url", source: l.website_url, site: l.website_url });
  for (const e of events ?? []) if (!e.cover_image_url && !SKIP_EVENTS.has(e.slug)) list.push({ table: "events", kind: "event", id: e.id, slug: e.slug, name: e.name, column: "cover_image_url", source: e.external_url, site: null });
  for (const b of businesses ?? []) {
    if (!b.cover_image_url) list.push({ table: "businesses", kind: "business", id: b.id, slug: b.slug, name: b.name, column: "cover_image_url", source: b.website_url, site: b.website_url });
    if (!b.logo_url) list.push({ table: "businesses", kind: "business", id: b.id, slug: b.slug, name: b.name, column: "logo_url", source: b.website_url, site: b.website_url });
  }
  return list;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const list = await targets(db);
  console.log(`Exception pass: ${list.length} empty media fields in scope (excluded events: ${[...SKIP_EVENTS].join(", ")})\n`);

  // Phase 1 — dry run.
  const rows: Row[] = [];
  for (const t of list) {
    try {
      rows.push(t.column === "logo_url" ? await resolveLogo(t) : await resolveCover(t));
    } catch (err) {
      rows.push({ target: t, status: "UNRESOLVED", asset: "—", page: t.source ?? "—", why: `unexpected error (${err instanceof Error ? err.name : "error"})` });
    }
  }
  console.log("=== DRY RUN ===");
  console.log("ENTITY | FIELD | RESOLVED ASSET | SOURCE | WHY SELECTED | READY/UNRESOLVED");
  for (const r of rows) console.log(`${r.target.name} | ${r.target.table}.${r.target.column} | ${r.asset} | ${r.page} | ${r.why} | ${r.status}`);

  // Phase 2 — writes for high-confidence READY rows only, empty fields only.
  console.log("\n=== WRITES ===");
  let written = 0;
  for (const r of rows) {
    if (r.status !== "READY" || !r.ready) continue;
    const { target: t, ready } = r;
    try {
      const { data: current } = await db.from(t.table).select(t.column).eq("id", t.id).maybeSingle();
      if ((current as Record<string, unknown> | null)?.[t.column]) {
        console.log(`SKIPPED  ${t.name} ${t.column}: filled since the dry run`);
        continue;
      }
      const stored = ready.verified.kind === "logo" ? await storeBrandImage(db, ready.verified.image) : await storeEventImage(db, ready.verified.image);
      if (!stored) {
        console.log(`FAILED   ${t.name} ${t.column}: couldn't store`);
        continue;
      }
      const { data: done, error } = await db.from(t.table).update({ [t.column]: stored }).eq("id", t.id).is(t.column, null).select("id");
      if (error || !done?.length) {
        console.log(`SKIPPED  ${t.name} ${t.column}: ${error ? `update failed (${error.code ?? "error"})` : "filled during the run"}`);
        continue;
      }
      await writeProvenance(db, stored, { sourcePageUrl: ready.page, resolvedImageUrl: ready.asset, resolvedFrom: ready.from, entityType: t.kind === "place" ? "location" : t.kind, entityId: t.id, column: t.column });
      written++;
      console.log(`WRITTEN  ${t.name} ${t.column} → ${stored}`);
    } catch (err) {
      console.log(`FAILED   ${t.name} ${t.column}: unexpected error (${err instanceof Error ? err.name : "error"})`);
    }
  }
  console.log(`\nWritten ${written} of ${rows.filter((r) => r.status === "READY").length} READY; ${rows.filter((r) => r.status === "UNRESOLVED").length} unresolved.`);
}

if (process.env.JC_BACKFILL_MODE === "exceptions") {
  main().catch((err) => {
    console.error(`Exception pass aborted: ${err instanceof Error ? err.message : "error"}`);
    process.exit(1);
  });
}
