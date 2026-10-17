import { z } from "zod";

// Discovery Intelligence V1 — the ONE structured query vocabulary every
// discovery surface speaks: Discovery Topics store a (partial) query,
// contextual search parses text into one, refinements are queries, and URLs
// round-trip them. Validated data interpreted by application code — never
// SQL, never executed as-is. Pure (safe for client and server).

export const DISCOVERY_ENTITIES = ["event", "appearance", "business", "place", "moment"] as const;
export type DiscoveryEntity = (typeof DISCOVERY_ENTITIES)[number];

export const DISCOVERY_WHEN = ["now", "today", "tonight", "tomorrow", "week", "weekend", "upcoming"] as const;
export type DiscoveryWhen = (typeof DISCOVERY_WHEN)[number];

export const WHEN_LABELS: Record<DiscoveryWhen, string> = {
  now: "Happening Now",
  today: "Today",
  tonight: "Tonight",
  tomorrow: "Tomorrow",
  week: "This Week",
  weekend: "This Weekend",
  upcoming: "Coming Up",
};

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

/** A full query adds context (geography, date, Topics, paging). */
export const discoveryQuerySchema = topicQuerySchema
  .extend({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    area: slug.optional(),
    census: z.string().regex(/^(state|county|place|zcta):\d+$/).optional(),
    topics: slugList.optional(),
    limit: z.number().int().min(1).max(48).optional(),
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

/** Context first, then each Topic narrows it. Taxonomy lists UNION (a Topic
 * says "pop-ups" by Format OR Category); a Topic's own time window wins. */
export function mergeQueries(...parts: (Partial<DiscoveryQuery> | undefined)[]): DiscoveryQuery {
  const out: DiscoveryQuery = {};
  for (const p of parts) {
    if (!p) continue;
    for (const [k, v] of Object.entries(p) as [keyof DiscoveryQuery, unknown][]) {
      if (v === undefined) continue;
      if (k === "categories" || k === "formats" || k === "access" || k === "topics" || k === "entities") {
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
  return Boolean(q.when || q.date || q.endingSoonHours || q.justAnnouncedDays || q.categories?.length || q.formats?.length || q.access?.length || q.free || q.family);
}

export function entitiesFor(q: DiscoveryQuery): DiscoveryEntity[] {
  if (q.entities?.length) return q.entities;
  return isEventShaped(q) ? ["event", "appearance"] : ["event", "appearance", "place", "business"];
}

// ---------------------------------------------------------------- URLs

const LIST_KEYS = { categories: "cat", formats: "fmt", access: "access", topics: "topic", entities: "type" } as const;
const SCALAR_KEYS = { when: "when", date: "date", area: "area", market: "market", census: "geo", text: "q" } as const;

/** Stable, human-readable search URL params for a query. */
export function queryToParams(q: DiscoveryQuery): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, name] of Object.entries(SCALAR_KEYS) as [keyof typeof SCALAR_KEYS, string][]) if (q[k]) p.set(name, String(q[k]));
  for (const [k, name] of Object.entries(LIST_KEYS) as [keyof typeof LIST_KEYS, string][]) for (const v of q[k] ?? []) p.append(name, v);
  if (q.endingSoonHours) p.set("ending", String(q.endingSoonHours));
  if (q.justAnnouncedDays) p.set("new", String(q.justAnnouncedDays));
  if (q.free) p.set("free", "1");
  if (q.family) p.set("family", "1");
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
  const ending = Number(get("ending")[0]);
  if (ending) raw.endingSoonHours = ending;
  const fresh = Number(get("new")[0]);
  if (fresh) raw.justAnnouncedDays = fresh;
  if (get("free")[0] === "1") raw.free = true;
  if (get("family")[0] === "1") raw.family = true;
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
