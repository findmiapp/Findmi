import { z } from "zod";
import { EVENT_AUDIENCES, EVENT_BENEFITS, ENTRY_MODES } from "./attributes";

// Discovery Intelligence V1 — the ONE structured query vocabulary every
// discovery surface speaks: Discovery Topics store a (partial) query,
// contextual search parses text into one, refinements are queries, and URLs
// round-trip them. Validated data interpreted by application code — never
// SQL, never executed as-is. Pure (safe for client and server).

export const DISCOVERY_ENTITIES = ["event", "appearance", "business", "place", "moment"] as const;
export type DiscoveryEntity = (typeof DISCOVERY_ENTITIES)[number];

export const DISCOVERY_WHEN = ["now", "upnext", "today", "tonight", "tomorrow", "week", "weekend", "next_week", "month", "next_month", "upcoming"] as const;
export type DiscoveryWhen = (typeof DISCOVERY_WHEN)[number];

export const WHEN_LABELS: Record<DiscoveryWhen, string> = {
  now: "Happening Now",
  upnext: "Up Next",
  today: "Today",
  tonight: "Tonight",
  tomorrow: "Tomorrow",
  week: "This Week",
  weekend: "This Weekend",
  next_week: "Next Week",
  month: "This Month",
  next_month: "Next Month",
  upcoming: "Coming Up",
};

export const TIMES_OF_DAY = ["morning", "afternoon", "evening", "late_night"] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];
export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  late_night: "Late Night",
};

/** How a multi-value dimension combines: "any" (Nike OR Adidas) or "all"
 * (Free Food AND Free Drinks). Consumer copy: "Any of these" / "All of
 * these". */
export const MATCH_MODES = ["any", "all"] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60);
const slugList = z.array(slug).max(12);

/** Filters a Discovery Topic may define. Strict: unknown keys are errors,
 * so a Topic can never carry instructions the engine doesn't understand. */
export const topicQuerySchema = z
  .object({
    entities: z.array(z.enum(DISCOVERY_ENTITIES)).min(1).max(5).optional(),
    when: z.enum(DISCOVERY_WHEN).optional(),
    endingSoonHours: z.number().int().min(1).max(168).optional(),
    justAnnouncedDays: z.number().int().min(1).max(60).optional(),
    categories: slugList.optional(),
    formats: slugList.optional(),
    access: z.array(z.enum(["rsvp", "tickets"])).max(2).optional(),
    free: z.literal(true).optional(),
    family: z.literal(true).optional(),
    text: z.string().trim().min(1).max(100).optional(),
    market: slug.optional(),
  })
  .strict();
export type TopicQuery = z.infer<typeof topicQuerySchema>;

const dateKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

/** A full query adds context (geography, date, Topics, paging) and — for
 * Discovery Engine V1 (Map, Feed; later Calendar and saved searches) —
 * precise time, viewport, Brand, structured benefits/audience/entry and
 * per-dimension Any/All semantics. Every key is optional and independently
 * validated, so a query serializes to a stable URL and back. */
export const discoveryQuerySchema = topicQuerySchema
  .extend({
    date: dateKey.optional(),
    area: slug.optional(),
    census: z.string().regex(/^(state|county|place|zcta):\d+$/).optional(),
    topics: slugList.optional(),
    limit: z.number().int().min(1).max(48).optional(),
    // WHEN — precise windows (date > from/to > month > year > when).
    from: dateKey.optional(),
    to: dateKey.optional(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    year: z.string().regex(/^20\d{2}$/).optional(),
    tod: z.enum(TIMES_OF_DAY).optional(),
    tfrom: clock.optional(),
    tto: clock.optional(),
    // WHERE — viewport [west, south, east, north]; a specific Location;
    // "near me" (resolved on the viewer's own device into a viewport —
    // the viewer's coordinates never enter the URL or the server).
    bbox: z.tuple([lng, lat, lng, lat]).refine(([w, s, e, n]) => w < e && s < n, "empty bounds").optional(),
    near: z.literal(true).optional(),
    radius: z.number().int().min(1).max(100).optional(),
    place: slug.optional(),
    // WHAT — Brands by canonical slug; Any/All per dimension.
    brands: slugList.optional(),
    brandMode: z.enum(MATCH_MODES).optional(),
    catMode: z.enum(MATCH_MODES).optional(),
    benefits: z.array(z.enum(EVENT_BENEFITS)).max(9).optional(),
    benefitMode: z.enum(MATCH_MODES).optional(),
    audience: z.array(z.enum(EVENT_AUDIENCES)).max(6).optional(),
    entry: z.array(z.enum(ENTRY_MODES)).max(5).optional(),
    paid: z.literal(true).optional(),
    open: z.literal("now").optional(),
    offset: z.number().int().min(0).max(960).optional(),
  })
  .strict();
export type DiscoveryQuery = z.infer<typeof discoveryQuerySchema>;

export function validateTopicQuery(value: unknown): { ok: true; value: TopicQuery } | { ok: false; error: string } {
  const r = topicQuerySchema.safeParse(value);
  if (r.success) return { ok: true, value: r.data };
  const issue = r.error.issues[0];
  return { ok: false, error: `${issue.path.join(".") || "query"}: ${issue.message}` };
}

const uniq = <T>(a: T[] | undefined, b: T[] | undefined) => {
  const out = [...new Set([...(a ?? []), ...(b ?? [])])];
  return out.length ? out : undefined;
};

const LIST_MERGE = new Set<keyof DiscoveryQuery>(["categories", "formats", "access", "topics", "entities", "brands", "benefits", "audience", "entry"]);

/** Context first, then each Topic narrows it. Taxonomy lists UNION (a Topic
 * says "pop-ups" by Format OR Category); a Topic's own time window wins. */
export function mergeQueries(...parts: (Partial<DiscoveryQuery> | undefined)[]): DiscoveryQuery {
  const out: DiscoveryQuery = {};
  for (const p of parts) {
    if (!p) continue;
    for (const [k, v] of Object.entries(p) as [keyof DiscoveryQuery, unknown][]) {
      if (v === undefined) continue;
      if (LIST_MERGE.has(k)) {
        (out as Record<string, unknown>)[k] = uniq(out[k] as string[] | undefined, v as string[]);
      } else {
        (out as Record<string, unknown>)[k] = v;
      }
    }
  }
  return out;
}

/** Does the query constrain time or Event taxonomy? (Then undated
 * entities — Brands, Places — can't answer it.) */
export function isEventShaped(q: DiscoveryQuery): boolean {
  return Boolean(
    q.when || q.date || q.from || q.to || q.month || q.year || q.tod || q.tfrom || q.endingSoonHours || q.justAnnouncedDays ||
      q.categories?.length || q.formats?.length || q.access?.length || q.free || q.paid || q.family ||
      q.benefits?.length || q.audience?.length || q.entry?.length
  );
}

export function entitiesFor(q: DiscoveryQuery): DiscoveryEntity[] {
  if (q.entities?.length) return q.entities;
  return isEventShaped(q) ? ["event", "appearance"] : ["event", "appearance", "place", "business"];
}

// ---------------------------------------------------------------- URLs

const LIST_KEYS = { categories: "cat", formats: "fmt", access: "access", topics: "topic", entities: "type", brands: "brand", benefits: "benefit", audience: "aud", entry: "entry" } as const;
const SCALAR_KEYS = {
  when: "when", date: "date", area: "area", market: "market", census: "geo", text: "q",
  from: "from", to: "to", month: "month", year: "year", tod: "tod", tfrom: "tfrom", tto: "tto", place: "place",
  brandMode: "bm", catMode: "cm", benefitMode: "benm", open: "open",
} as const;
const INT_KEYS = { endingSoonHours: "ending", justAnnouncedDays: "new", radius: "radius", offset: "offset" } as const;
const FLAG_KEYS = { free: "free", family: "family", paid: "paid", near: "near" } as const;

/** Viewport coordinates in a URL: 4 decimals (~11 m) — stable, short, and
 * precise enough for a map view. */
const coord = (n: number) => String(Math.round(n * 1e4) / 1e4);

/** Stable, human-readable search URL params for a query. */
export function queryToParams(q: DiscoveryQuery): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, name] of Object.entries(SCALAR_KEYS) as [keyof typeof SCALAR_KEYS, string][]) if (q[k]) p.set(name, String(q[k]));
  for (const [k, name] of Object.entries(LIST_KEYS) as [keyof typeof LIST_KEYS, string][]) for (const v of (q[k] as string[] | undefined) ?? []) p.append(name, v);
  for (const [k, name] of Object.entries(INT_KEYS) as [keyof typeof INT_KEYS, string][]) if (q[k]) p.set(name, String(q[k]));
  for (const [k, name] of Object.entries(FLAG_KEYS) as [keyof typeof FLAG_KEYS, string][]) if (q[k]) p.set(name, "1");
  if (q.bbox) p.set("bbox", q.bbox.map(coord).join(","));
  return p;
}

/** Parses URL params back into a validated query; anything invalid is
 * dropped (a bad link degrades to a broader search, never an error). */
export function paramsToQuery(params: URLSearchParams | Record<string, string | string[] | undefined>): DiscoveryQuery {
  const get = (k: string): string[] => {
    if (params instanceof URLSearchParams) return params.getAll(k);
    const v = params[k];
    return v === undefined ? [] : Array.isArray(v) ? v : [v];
  };
  const raw: Record<string, unknown> = {};
  for (const [k, name] of Object.entries(SCALAR_KEYS)) {
    const v = get(name)[0];
    if (v) raw[k] = k === "text" ? v.slice(0, 100) : v;
  }
  for (const [k, name] of Object.entries(LIST_KEYS)) {
    const v = get(name).filter(Boolean);
    if (v.length) raw[k] = v.slice(0, 12);
  }
  for (const [k, name] of Object.entries(INT_KEYS)) {
    const n = Number(get(name)[0]);
    if (n) raw[k] = n;
  }
  for (const [k, name] of Object.entries(FLAG_KEYS)) if (get(name)[0] === "1") raw[k] = true;
  const bbox = (get("bbox")[0] ?? "").split(",").map(Number);
  if (bbox.length === 4 && bbox.every(Number.isFinite)) raw.bbox = bbox;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const one = discoveryQuerySchema.safeParse({ [k]: v });
    if (one.success) Object.assign(out, one.data);
  }
  return out as DiscoveryQuery;
}

export function searchHref(q: DiscoveryQuery): string {
  const s = queryToParams(q).toString();
  return s ? `/search?${s}` : "/search";
}

/** The same query on the Map (or its Feed view). `view` is presentation
 * only — it never changes what qualifies. */
export function mapHref(q: DiscoveryQuery, view: "map" | "feed" = "map"): string {
  const p = queryToParams(q);
  if (view === "feed") p.set("view", "feed");
  const s = p.toString();
  return s ? `/map?${s}` : "/map";
}

/** Stable identity of a query (for caching counts / de-duplicating
 * requests): canonical, order-independent within each list. */
export function queryKey(q: DiscoveryQuery): string {
  const p = queryToParams(q);
  const entries = [...p.entries()].sort(([a, x], [b, y]) => (a === b ? x.localeCompare(y) : a.localeCompare(b)));
  return new URLSearchParams(entries).toString();
}
