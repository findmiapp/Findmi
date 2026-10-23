// Commercial Discovery — the pure rules (no I/O) behind Growth → Targets →
// Discover: who or what a Business might pursue, found by
//   Geography → Entity / Role → Category → Search.
// Same family as the consumer Discovery engine (lib/discovery/engine.ts):
// validated query vocabulary, deterministic filtering, every result carrying
// the reasons it matched, and ordering anyone can explain. Commercial mode has
// its own small rank, though — it is ORGANIC only: no "Featured" input (the
// consumer engine's is_featured point never reaches it) and no paid, partner
// or promoted signal. Future Featured / Partner / Sponsored placements are
// inserted beside these organic results, never mixed into this order.
// Pure (client + server).

import type { TargetKind } from "../commercial-intents";

/** What is being looked for. Organizers and Venue Operators are Business ROLES
 * (derived from real relationships), never separate entities. */
export const COMMERCIAL_ENTITIES = ["places", "businesses", "organizers", "operators", "events"] as const;
export type CommercialEntity = (typeof COMMERCIAL_ENTITIES)[number];

export const COMMERCIAL_ENTITY_LABELS: Record<CommercialEntity, string> = {
  places: "Places",
  businesses: "Businesses",
  organizers: "Organizers",
  operators: "Venue Operators",
  events: "Events",
};

/** The Target kind a result of this entity becomes. */
export const TARGET_KIND_FOR_ENTITY: Record<CommercialEntity, TargetKind> = {
  places: "location",
  businesses: "business",
  organizers: "business",
  operators: "business",
  events: "event",
};

/** Which category family each entity filters on. */
export const CATEGORY_FAMILY: Record<CommercialEntity, "location" | "business" | "event"> = {
  places: "location",
  businesses: "business",
  organizers: "business",
  operators: "business",
  events: "event",
};

export const COMMERCIAL_PAGE_SIZE = 20;
/** The most candidates one search ranks in memory; beyond this the UI asks to narrow. */
export const COMMERCIAL_CANDIDATE_LIMIT = 1000;
export const COMMERCIAL_SEARCH_MIN_CHARS = 2;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CommercialQuery {
  /** Market slug ("" = none chosen). */
  market: string;
  /** Area slug inside the Market ("" = the whole Market). */
  area: string;
  entity: CommercialEntity;
  /** "c:<category id>" (a category) or "f:<category id>" (an Event format); "" = any. */
  category: string;
  q: string;
  page: number;
}

export const DEFAULT_COMMERCIAL_QUERY: CommercialQuery = { market: "", area: "", entity: "places", category: "", q: "", page: 1 };

/** Search text safe for a PostgREST or() list. */
export const cleanCommercialText = (v: unknown): string => (typeof v === "string" ? v.replace(/[%,()*\\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) : "");

/** From untrusted URL params (dm / da / de / dc / dq / dp). */
export function parseCommercialQuery(raw: { market?: unknown; area?: unknown; entity?: unknown; category?: unknown; q?: unknown; page?: unknown }): CommercialQuery {
  const slug = (v: unknown) => (typeof v === "string" && v.length <= 60 && SLUG.test(v) ? v : "");
  const entity = (COMMERCIAL_ENTITIES as readonly string[]).includes(raw.entity as string) ? (raw.entity as CommercialEntity) : "places";
  const category = typeof raw.category === "string" && /^[cf]:/.test(raw.category) && UUID.test(raw.category.slice(2)) ? raw.category : "";
  const page = Math.min(500, Math.max(1, Math.floor(Number(raw.page)) || 1));
  const market = slug(raw.market);
  return { market, area: market ? slug(raw.area) : "", entity, category, q: cleanCommercialText(raw.q), page };
}

export function parseCategoryKey(key: string): { kind: "category" | "format"; id: string } | null {
  if (!/^[cf]:/.test(key) || !UUID.test(key.slice(2))) return null;
  return { kind: key[0] === "f" ? "format" : "category", id: key.slice(2) };
}

/** A search runs once there is a place to look (a Market) or enough text. */
export function hasCommercialScope(q: CommercialQuery): boolean {
  return Boolean(q.market) || q.q.length >= COMMERCIAL_SEARCH_MIN_CHARS;
}

// ── Why it matched ──────────────────────────────────────────────────────────
// Geography means different things per entity. A Place is physically there;
// an Event happens there; a Business only ever matches for the specific,
// truthful relationship it has with the geography — never "is in" a place
// because it serves or targets that Market.

export const MATCH_REASONS = [
  "location_here",
  "happening_here",
  "listed_here",
  "hosting_here",
  "appearing_here",
  "based_here",
  "serves_here",
  "growing_here",
] as const;
export type MatchReason = (typeof MATCH_REASONS)[number];

export const MATCH_REASON_LABELS: Record<MatchReason, string> = {
  location_here: "Location Here",
  happening_here: "Happening Here",
  listed_here: "Listed Here",
  hosting_here: "Hosting Here",
  appearing_here: "Appearing Here",
  based_here: "Based Here",
  serves_here: "Serves This Market",
  growing_here: "Growing Here",
};

/** Physical / dated presence outranks a stated intention. The order IS the rank. */
const REASON_RANK: Record<MatchReason, number> = Object.fromEntries(MATCH_REASONS.map((r, i) => [r, i])) as Record<MatchReason, number>;

/** business_markets provenance that is organic evidence. Paid, promotional and
 * complimentary (plan-granted) Market slots are commercial arrangements with
 * Findmi — never proof a Business is relevant somewhere. */
export const ORGANIC_MARKET_PROVENANCE: readonly (string | null)[] = [null, "admin", "self_selected"];
export const isOrganicMarketProvenance = (p: string | null | undefined): boolean => ORGANIC_MARKET_PROVENANCE.includes(p ?? null);

export interface CommercialCandidate {
  id: string;
  name: string;
  reasons: MatchReason[];
  /** Events: the next relevant date (YYYY-MM-DD) — soonest first. */
  date?: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Deterministic organic order: exact name match, then the strongest reason
 * (Location Here before Serves This Market), then the soonest date (Events),
 * then name, then id. Nothing paid, featured or personal enters it. */
export function rankCommercial<T extends CommercialCandidate>(items: readonly T[], text = ""): T[] {
  const t = norm(text);
  const best = (c: T) => (c.reasons.length ? Math.min(...c.reasons.map((r) => REASON_RANK[r])) : MATCH_REASONS.length);
  return [...items].sort(
    (a, b) =>
      Number(Boolean(t) && norm(b.name) === t) - Number(Boolean(t) && norm(a.name) === t) ||
      best(a) - best(b) ||
      (a.date ?? "9999").localeCompare(b.date ?? "9999") ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
  );
}

/** Reasons in rank order, as labels. */
export function reasonLabels(reasons: readonly MatchReason[]): string[] {
  return [...new Set(reasons)].sort((a, b) => REASON_RANK[a] - REASON_RANK[b]).map((r) => MATCH_REASON_LABELS[r]);
}

export function pageOf<T>(items: readonly T[], page: number, size = COMMERCIAL_PAGE_SIZE): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { items: items.slice((p - 1) * size, p * size), page: p, pages };
}

/** Honest empty states — and never a silently widened geography. */
export function commercialEmptyMessage(q: CommercialQuery, ctx: { scopeLabel: string | null; categoryName: string | null; parentLabel: string | null }): { title: string; hint: string | null } {
  const what = ctx.categoryName ? `${ctx.categoryName} ${q.entity === "places" ? "Places" : q.entity === "events" ? "Events" : COMMERCIAL_ENTITY_LABELS[q.entity]}` : COMMERCIAL_ENTITY_LABELS[q.entity];
  const where = ctx.scopeLabel ? ` in ${ctx.scopeLabel}` : "";
  const title =
    q.entity === "organizers"
      ? `No Organizers with linked Findmi Business pages were found${where}.`
      : q.entity === "operators"
        ? `No Venue Operators with linked Findmi Business pages were found${where}.`
        : `No ${what} found${where}${q.q ? ` for “${q.q}”` : ""}.`;
  const hints: string[] = [];
  if (ctx.parentLabel) hints.push(`Try all of ${ctx.parentLabel}`);
  if (q.category) hints.push("remove the Category");
  if (q.q) hints.push("clear the search");
  return { title, hint: hints.length ? `${hints.join(", or ")}.`.replace(/^./, (c) => c.toUpperCase()) : null };
}
