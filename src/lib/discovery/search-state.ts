// Map search state — what a typed search contributed to the query, kept
// apart from what the viewer chose explicitly (pure, testable).
//
// A typed search can resolve words into structured filters ("free" →
// Free, "babylist" → the Babylist Brand, "today" → Today). Those belong to
// that search: the next search, or Clear, removes them again — they never
// silently ride along into a different search. Geography is the exception:
// a typed place moves the map, and the map's place is the viewer's active
// geography until they move it (Search This Area) or type another place.

import type { DiscoveryQuery } from "./query";

const GEO: (keyof DiscoveryQuery)[] = ["bbox", "area", "market", "census", "place", "near", "radius"];
const SKIP = new Set<keyof DiscoveryQuery>([...GEO, "text", "offset", "limit"]);

/** What `next` (the interpreted search) added on top of `base` (the
 * structured query the search was typed over). */
export function derivedFrom(next: DiscoveryQuery, base: DiscoveryQuery): Partial<DiscoveryQuery> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next) as [keyof DiscoveryQuery, unknown][]) {
    if (SKIP.has(k) || v === undefined) continue;
    const was = base[k];
    if (Array.isArray(v)) {
      const added = v.filter((x) => !(Array.isArray(was) && (was as unknown[]).includes(x)));
      if (added.length) out[k] = added;
    } else if (v !== was) out[k] = v;
  }
  return out as Partial<DiscoveryQuery>;
}

/** `q` without what a previous search contributed (values the viewer has
 * since changed are theirs now and stay). */
export function stripDerived(q: DiscoveryQuery, derived: Partial<DiscoveryQuery>): DiscoveryQuery {
  const out: Record<string, unknown> = { ...q };
  for (const [k, v] of Object.entries(derived) as [keyof DiscoveryQuery, unknown][]) {
    const cur = out[k];
    if (Array.isArray(v) && Array.isArray(cur)) {
      const left = cur.filter((x) => !v.includes(x));
      if (left.length) out[k] = left;
      else delete out[k];
    } else if (cur === v) delete out[k];
  }
  return out as DiscoveryQuery;
}

/** The query a Clear leaves — and the structured query a new search is
 * typed over: no text, nothing the last search contributed; geography,
 * time and the viewer's own filters untouched. */
export function clearedQuery(q: DiscoveryQuery, derived: Partial<DiscoveryQuery>): DiscoveryQuery {
  const { text: _t, ...rest } = stripDerived(q, derived);
  return rest;
}

export const hasGeo = (q: DiscoveryQuery) => GEO.some((k) => q[k] !== undefined && k !== "radius");

type TopicRef = { slug: string; query: Record<string, unknown> };
type Recognized = { kind: string; value?: unknown; text: string };

/** On the Map, a word that only names subject matter — a subject Topic
 * ("coffee" → Food + Drink), an Event Category or a Format — is text
 * relevance, not a hard Event-taxonomy filter: it then finds Places,
 * Brands and Events through their real categories and relationships
 * (taxonomyTerms / Location + Brand categories) instead of excluding
 * every Place and every uncategorized Event. Time words, flags, Brands
 * and places stay structured. Filters already in `base` are untouched. */
export function subjectWordsAsText<T extends TopicRef>(query: DiscoveryQuery, recognized: readonly Recognized[], base: DiscoveryQuery, topics: readonly T[], isSubjectTopic: (t: T) => boolean): DiscoveryQuery {
  const out: DiscoveryQuery = { ...query };
  const words: string[] = [];
  const drop = (k: "topics" | "categories" | "formats", v: string) => {
    if (base[k]?.includes(v)) return;
    const left = (out[k] ?? []).filter((x) => x !== v);
    if (left.length) out[k] = left;
    else delete out[k];
  };
  for (const r of recognized) {
    const v = String(r.value);
    if (r.kind === "topic") {
      const t = topics.find((x) => x.slug === v);
      if (!t || !isSubjectTopic(t) || base.topics?.includes(v)) continue;
      drop("topics", v);
    } else if (r.kind === "category" || r.kind === "format") {
      if (base[r.kind === "category" ? "categories" : "formats"]?.includes(v)) continue;
      drop(r.kind === "category" ? "categories" : "formats", v);
    } else continue;
    if (!words.includes(r.text)) words.push(r.text);
  }
  if (!words.length) return out;
  out.text = [out.text, ...words].filter(Boolean).join(" ").slice(0, 100);
  return out;
}
