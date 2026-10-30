// Discovery Map filters — lenses, contextual refinements and availability
// (pure, client + server).
//
// The Map is a multi-entity surface. Its primary control is a LENS:
//   All        everything (no entity restriction): broad search, and only
//              refinements whose meaning holds for every included type;
//   Happening  time-based discovery — internally Events + Pop-Ups
//              (Appearances); time, Event category / format, cost, perks,
//              audience and entry refine it;
//   Places     discoverable Locations; Open Now refines it.
// Brands is the intended fourth lens (its own Map pass, building on
// lib/geo-results-server brandPresence) — not offered until it exists.
//
// The lens is never changed silently: a Happening-only refinement chosen
// under All moves the VISIBLE lens to Happening (normalizeMapLens), and
// Places never carries time. Options are offered only when the current
// candidate set can satisfy them (mapFacets); an option already applied
// always stays visible so it can be removed.

import { queryChips, type QueryChip } from "./chips";
import { isFamily, isFreeAdmission, matchesMapItem, openNowAt, type MapItem, type MatchContext } from "./map-core";
import type { EntryMode, EventAudience, EventBenefit } from "./attributes";
import { isEventShaped, WHEN_LABELS, type DiscoveryEntity, type DiscoveryQuery, type DiscoveryWhen } from "./query";

export type MapLens = "all" | "happening" | "place";
export const MAP_LENSES: { lens: MapLens; label: string }[] = [
  { lens: "all", label: "All" },
  { lens: "happening", label: "Happening" },
  { lens: "place", label: "Places" },
];

export const HAPPENING_ENTITIES: DiscoveryEntity[] = ["event", "appearance"];

/** The named time shortcuts the Map offers (rail + filter sheet). Custom
 * date / range / month / year controls aren't enumerated. */
export const MAP_TIME_SHORTCUTS: DiscoveryWhen[] = ["now", "upnext", "today", "tomorrow", "weekend", "week", "next_week", "month", "next_month"];

/** Map wording for time windows. `upnext` on the Map is STARTING SOON:
 * not started yet, begins within the next 4 hours (time.ts
 * UP_NEXT_HOURS). It is deliberately not called "Up Next" here — /events'
 * "Up Next" is its chronological upcoming view, a different thing. */
export const MAP_WHEN_LABELS: Record<DiscoveryWhen, string> = { ...WHEN_LABELS, upnext: "Starting Soon" };

const WINDOW_KEYS = ["when", "date", "from", "to", "month", "year"] as const;
const TIME_KEYS = [...WINDOW_KEYS, "tod", "tfrom", "tto"] as const;
/** Refinements that only mean something for dated activity. */
const HAPPENING_KEYS = [...TIME_KEYS, "categories", "formats", "catMode", "benefits", "benefitMode", "audience", "entry", "free", "paid", "family", "access", "endingSoonHours", "justAnnouncedDays"] as const;
/** Refinements that only mean something for Places. */
const PLACE_KEYS = ["open"] as const;

const DATED = new Set<DiscoveryEntity>(["event", "appearance", "business"]);

/** The lens a query is in. Entity-less queries are All; a Happening-only
 * refinement without entities reads as Happening (that is what the engine
 * already returns for it — entitiesFor). */
export function mapLens(q: DiscoveryQuery): MapLens {
  const e = q.entities;
  if (!e?.length) return isEventShaped(q) ? "happening" : q.open ? "place" : "all";
  if (e.every((x) => x === "place")) return "place";
  if (e.every((x) => DATED.has(x))) return "happening";
  return "all";
}

/** A legacy single-kind Happening link (`type=event` / `type=appearance`):
 * still honored, shown as a removable narrowing of Happening. */
export function happeningNarrowing(q: DiscoveryQuery): { label: string; noun: string } | null {
  if (mapLens(q) !== "happening" || !q.entities?.length) return null;
  const kinds = new Set(q.entities.map((x) => (x === "business" ? "appearance" : x)));
  if (kinds.size !== 1) return null;
  return kinds.has("event") ? { label: "Events Only", noun: "Event" } : { label: "Pop-Ups Only", noun: "Pop-Up" };
}

const omit = (q: DiscoveryQuery, keys: readonly string[]): DiscoveryQuery => {
  const next = { ...q } as Record<string, unknown>;
  for (const k of keys) delete next[k];
  return next as DiscoveryQuery;
};

/** The query in `lens`: entity scope set, and refinements that don't apply
 * to that lens removed (they'd otherwise narrow it invisibly). */
export function withLens(q: DiscoveryQuery, lens: MapLens): DiscoveryQuery {
  const base = omit(q, ["entities", "offset"]);
  if (lens === "all") return omit(base, [...HAPPENING_KEYS, ...PLACE_KEYS]);
  if (lens === "place") return { ...omit(base, HAPPENING_KEYS), entities: ["place"] };
  return { ...omit(base, PLACE_KEYS), entities: [...HAPPENING_ENTITIES] };
}

/** Makes the lens explicit, so the visible lens is always what the engine
 * runs. `sameResults` is true when only an implicit Happening scope became
 * explicit (identical results — no refetch needed). */
export function normalizeMapLens(q: DiscoveryQuery): { query: DiscoveryQuery; sameResults: boolean } {
  const lens = mapLens(q);
  if (lens === "all") {
    // A mixed entity list (never produced by the Map UI) would narrow All
    // invisibly; All means every type.
    return q.entities?.length ? { query: omit(q, ["entities"]), sameResults: false } : { query: q, sameResults: true };
  }
  if (lens === "happening") {
    // Open Now would pull Places into Happening (mapKinds); it isn't a
    // Happening refinement.
    if (q.open) return { query: q.entities?.length ? omit(q, PLACE_KEYS) : withLens(q, "happening"), sameResults: false };
    // Implicit → explicit Happening scope: the engine already ran exactly
    // Events + Pop-Ups for it (entitiesFor).
    return q.entities?.length ? { query: q, sameResults: true } : { query: { ...q, entities: [...HAPPENING_ENTITIES] }, sameResults: true };
  }
  // Places: time and other dated refinements never apply to a Place.
  const explicit = Boolean(q.entities?.length);
  const inert = !HAPPENING_KEYS.some((k) => q[k] !== undefined);
  return { query: withLens(q, "place"), sameResults: explicit && inert };
}

/** The noun the result count uses ("12 Places"). */
export function lensNoun(q: DiscoveryQuery): string {
  const lens = mapLens(q);
  if (lens === "place") return "Place";
  return happeningNarrowing(q)?.noun ?? "Result";
}

// ------------------------------------------------------------ active refinements

const GEO_CHIPS = new Set(["near", "place", "area", "market", "geo"]);

/** Every refinement applied to the query — the ONE definition the Filters
 * badge, the applied-chip rail and the sheet's Clear share. Geography and
 * the typed search are context, not refinements; the lens is the primary
 * control, but a legacy single-kind narrowing of it is a refinement. */
export function mapRefinements(q: DiscoveryQuery): QueryChip[] {
  const out = queryChips(q).filter((c) => !GEO_CHIPS.has(c.key) && c.key !== "text");
  const narrow = happeningNarrowing(q);
  if (narrow) out.unshift({ key: "lens", label: narrow.label, without: { ...q, entities: [...HAPPENING_ENTITIES] } });
  return out;
}

/** Refinements the filter sheet has no control for (Topics, Family, access,
 * Ending Soon, Just Announced, a legacy single-kind lens). Shown there as
 * removable "Also Applied" chips so nothing narrows the Map invisibly. */
export function isUneditableRefinement(key: string): boolean {
  return key === "lens" || key === "family" || key === "ending" || key === "new" || key.startsWith("topic:") || key.startsWith("access:");
}

/** What the sheet's Clear leaves: the lens, geography, the typed search and
 * the Brands that search resolved to. Every refinement goes. */
export function clearedRefinements(q: DiscoveryQuery): DiscoveryQuery {
  const keep: Record<string, unknown> = {};
  for (const k of ["bbox", "area", "market", "census", "place", "near", "radius", "text", "brands", "brandMode"] as const) if (q[k] !== undefined) keep[k] = q[k];
  const lens = mapLens(q);
  if (lens !== "all") keep.entities = withLens({}, lens).entities;
  return keep as DiscoveryQuery;
}

// ------------------------------------------------------------ availability

/** Does the query carry a date window (named or custom)? */
export const hasDateWindow = (q: DiscoveryQuery) => WINDOW_KEYS.some((k) => q[k] !== undefined);
/** The query without its date window (time of day kept). */
export const withoutDateWindow = (q: DiscoveryQuery) => omit(q, WINDOW_KEYS);

/** Values the current candidate set can satisfy, per refinement dimension.
 * Each dimension is computed against the query WITHOUT that dimension (so
 * choosing Free never hides Paid, choosing one category never hides the
 * others), but with everything else — lens, geography, time, text, Brands
 * and the other refinements — applied. */
export interface MapFacets {
  /** Named time shortcuts with at least one result (other constraints —
   * lens, geography, time of day, text, refinements — applied). Absent =
   * unknown (everything offered). */
  when?: DiscoveryWhen[];
  categories: string[];
  formats: string[];
  benefits: EventBenefit[];
  audience: EventAudience[];
  entry: EntryMode[];
  free: boolean;
  paid: boolean;
  open: boolean;
}

export function mapFacets(items: readonly MapItem[], q: DiscoveryQuery, ctx: MatchContext, untimed?: readonly MapItem[] | null): MapFacets {
  const pass = (drop: readonly string[]) => {
    const scoped = omit(q, drop);
    return items.filter((i) => matchesMapItem(i, scoped, ctx));
  };
  const collect = <T,>(list: MapItem[], of: (i: MapItem) => readonly T[]) => [...new Set(list.flatMap((i) => [...of(i)]))];
  const dated = (list: MapItem[]) => list.filter((i) => i.kind !== "place");

  const tax = dated(pass(["categories", "formats", "catMode"]));
  // Time: evaluated over candidates loaded WITHOUT a date window (`untimed`
  // — the same candidates when the query has none), each shortcut in place
  // of the current window. Places never carry time.
  let when: DiscoveryWhen[] | undefined;
  if (untimed && mapLens(q) !== "place") {
    const base = omit(q, WINDOW_KEYS);
    const timeCtx: MatchContext = q.place ? { ...ctx, placeIds: new Set(untimed.map((i) => i.location.id)) } : ctx;
    const dates = untimed.filter((i) => i.kind !== "place");
    when = MAP_TIME_SHORTCUTS.filter((w) => dates.some((i) => matchesMapItem(i, { ...base, when: w }, timeCtx)));
  }
  const cost = dated(pass(["free", "paid"]));
  return {
    ...(when ? { when } : {}),
    categories: collect(tax, (i) => i.categories),
    formats: collect(tax, (i) => i.formats),
    benefits: collect(dated(pass(["benefits", "benefitMode"])), (i) => i.benefits),
    audience: collect(dated(pass(["audience"])), (i) => (isFamily(i) ? [...i.audience, "family" as const] : i.audience)),
    entry: collect(dated(pass(["entry"])), (i) => [...i.entry, ...(i.rsvp ? (["rsvp"] as const) : []), ...(i.tickets ? (["ticket"] as const) : [])]),
    free: cost.some(isFreeAdmission),
    paid: cost.some((i) => i.is_free === false),
    open: pass(["open"]).some((i) => i.kind === "place" && openNowAt(i.location.hours, ctx.now, i.location.timezone) === true),
  };
}
