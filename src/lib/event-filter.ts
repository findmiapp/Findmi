// Shared Event filter contract — ONE meaning for "which Events match",
// whatever surface renders the result (/events list, homepage Event rows,
// /discover, /find, Brand and Location Event surfaces, a future Map).
// Surfaces may show different controls; they all express their choice as
// an EventFilter and run it through getEventsDiscovery (lib/data.ts) via
// eventDiscoveryParams(). Pure — safe for client and server.
//
// Only dimensions backed by reliable, existing data are supported:
//   when / date      — the existing occurrence-overlap time windows
//                      (lib/format.ts getDiscoveryWindowBounds); "live" is
//                      getTemporalLabel().live
//   market / area    — effective occurrence Market, Event Area
//   location         — free-text city/state
//   category         — Event Taxonomy V1 slug (a top-level category
//                      includes its subcategories)
//   formats          — Event Formats V1 slugs (kind='event_format'): ANY
//                      of the selected Formats, AND the other dimensions
//   access           — RSVP/Register and Tickets, from the Event's own
//                      action fields (rsvp_enabled + rsvp_url,
//                      tickets_enabled + tickets_url) — never inferred
//   q                — text search
//   locationId / businessId — programmatic scoping for Location and Brand
//                      surfaces (not URL state)
// Reserved for later phases, deliberately NOT fields yet (no data): cost,
// audience, geographic radius / map bounds. Walk-In is not
// derivable (an Event without RSVP/Tickets isn't evidence of walk-in).
import { getTemporalLabel, type DiscoveryWindow } from "./format";

/** The Event time filters, in display order. "next" (Up Next) and "all"
 * are the same unfiltered upcoming query (an intentional, long-standing
 * overlap); "today" is the local calendar day. */
export const EVENT_TIME_KEYS = ["next", "live", "today", "tomorrow", "week", "weekend", "all"] as const;
export type EventTimeKey = (typeof EVENT_TIME_KEYS)[number];

export const EVENT_TIME_LABELS: Record<EventTimeKey, string> = {
  next: "Up Next",
  live: "Happening Now",
  today: "Today",
  tomorrow: "Tomorrow",
  week: "This Week",
  weekend: "This Weekend",
  all: "All",
};

/** Each time key's window — the same windows every Event surface uses. */
export const EVENT_WINDOW_BY_TIME_KEY: Record<EventTimeKey, DiscoveryWindow> = {
  next: "anytime",
  live: "live",
  today: "now",
  tomorrow: "tomorrow",
  week: "week",
  weekend: "weekend",
  all: "anytime",
};

export const EVENT_ACCESS_KINDS = ["rsvp", "tickets"] as const;
export type EventAccess = (typeof EVENT_ACCESS_KINDS)[number];
export const EVENT_ACCESS_LABELS: Record<EventAccess, string> = { rsvp: "RSVP / Register", tickets: "Tickets" };

export interface EventFilter {
  /** Absent = "next" (Up Next). */
  when?: EventTimeKey;
  /** YYYY-MM-DD (a real calendar date) — overrides `when`. */
  date?: string;
  /** Market slug; `area` is only meaningful alongside it. */
  market?: string;
  area?: string;
  /** Free-text city/state. */
  location?: string;
  /** Event category slug (top-level includes its subcategories). */
  category?: string;
  /** ANY of these Event Format slugs (OR within; AND with everything else). */
  formats?: string[];
  /** ANY of these attendance actions. */
  access?: EventAccess[];
  q?: string;
  /** Scoping (programmatic only — never parsed from or written to the URL). */
  locationId?: string;
  businessId?: string;
}

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TEXT = 120;

function getAll(source: ParamSource, key: string): string[] {
  if (source instanceof URLSearchParams) return source.getAll(key);
  const v = source[key];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}
const first = (source: ParamSource, key: string): string | undefined => getAll(source, key)[0];

function cleanSlug(v: string | undefined): string | undefined {
  const s = v?.trim().toLowerCase();
  return s && s.length <= 80 && SLUG.test(s) ? s : undefined;
}
function cleanText(v: string | undefined): string | undefined {
  const s = v?.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, MAX_TEXT) : undefined;
}

/** A real calendar date in YYYY-MM-DD form (2026-02-30 is rejected). */
export function isValidEventDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export const isEventTimeKey = (v: unknown): v is EventTimeKey => typeof v === "string" && (EVENT_TIME_KEYS as readonly string[]).includes(v);

/** Normalized access list: known kinds only, de-duplicated, canonical
 * order. Accepts repeated params and comma-separated values. */
export function parseEventAccess(values: readonly string[]): EventAccess[] {
  const wanted = new Set(values.flatMap((v) => v.split(",")).map((v) => v.trim().toLowerCase()));
  return EVENT_ACCESS_KINDS.filter((k) => wanted.has(k));
}

/** Normalized Format slugs: well-formed slugs only, lower-cased,
 * de-duplicated, sorted (a stable URL). Accepts repeated params and
 * comma-separated values. Whether a slug is a real Format is decided by
 * the query — an unknown one simply matches nothing. */
export function parseEventFormats(values: readonly string[]): string[] {
  const out = new Set<string>();
  for (const v of values.flatMap((x) => x.split(","))) {
    const slug = cleanSlug(v);
    if (slug) out.add(slug);
  }
  return [...out].sort().slice(0, 32);
}

/** Event discovery URL state → EventFilter. Defensive: unknown values,
 * malformed dates/slugs and empty strings are dropped, never thrown on. */
export function parseEventFilter(source: ParamSource): EventFilter {
  const filter: EventFilter = {};
  const when = first(source, "when")?.trim().toLowerCase();
  if (isEventTimeKey(when) && when !== "next") filter.when = when;
  const date = first(source, "date")?.trim();
  if (isValidEventDate(date)) filter.date = date;
  const market = cleanSlug(first(source, "market"));
  if (market) filter.market = market;
  const area = cleanSlug(first(source, "area"));
  if (area && market) filter.area = area;
  const location = cleanText(first(source, "location"));
  if (location) filter.location = location;
  const category = cleanSlug(first(source, "category"));
  if (category) filter.category = category;
  const formats = parseEventFormats(getAll(source, "format"));
  if (formats.length > 0) filter.formats = formats;
  const access = parseEventAccess(getAll(source, "access"));
  if (access.length > 0) filter.access = access;
  const q = cleanText(first(source, "q"));
  if (q) filter.q = q;
  return filter;
}

/** EventFilter → URL state, in a stable order; defaults omitted. Scoping
 * (locationId / businessId) is never serialized. */
export function eventFilterToSearchParams(filter: EventFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (filter.q) p.set("q", filter.q);
  if (filter.when && filter.when !== "next") p.set("when", filter.when);
  if (filter.date && isValidEventDate(filter.date)) p.set("date", filter.date);
  if (filter.category) p.set("category", filter.category);
  if (filter.location) p.set("location", filter.location);
  if (filter.market) p.set("market", filter.market);
  if (filter.market && filter.area) p.set("area", filter.area);
  for (const f of parseEventFormats(filter.formats ?? [])) p.append("format", f);
  for (const a of parseEventAccess(filter.access ?? [])) p.append("access", a);
  return p;
}

/** The getEventsDiscovery parameters for a filter (plus paging). */
export function eventDiscoveryParams(
  filter: EventFilter,
  page: { limit?: number; offset?: number; featuredFirst?: boolean } = {}
): {
  when: DiscoveryWindow;
  date?: string;
  q?: string;
  categorySlug?: string;
  location?: string;
  marketSlug?: string;
  areaSlug?: string;
  formatSlugs?: string[];
  access?: EventAccess[];
  locationId?: string;
  businessId?: string;
  limit?: number;
  offset?: number;
  featuredFirst?: boolean;
} {
  return {
    when: EVENT_WINDOW_BY_TIME_KEY[filter.when ?? "next"],
    ...(filter.date ? { date: filter.date } : {}),
    ...(filter.q ? { q: filter.q } : {}),
    ...(filter.category ? { categorySlug: filter.category } : {}),
    ...(filter.location ? { location: filter.location } : {}),
    ...(filter.market ? { marketSlug: filter.market } : {}),
    ...(filter.market && filter.area ? { areaSlug: filter.area } : {}),
    ...(filter.formats?.length ? { formatSlugs: parseEventFormats(filter.formats) } : {}),
    ...(filter.access?.length ? { access: filter.access } : {}),
    ...(filter.locationId ? { locationId: filter.locationId } : {}),
    ...(filter.businessId ? { businessId: filter.businessId } : {}),
    ...page,
  };
}

/** The Event offers this attendance action — the same truthiness every
 * card/page uses to show the button (enabled AND a link). */
export function eventOffersAccess(
  event: { rsvp_enabled?: boolean | null; rsvp_url?: string | null; tickets_enabled?: boolean | null; tickets_url?: string | null },
  kind: EventAccess
): boolean {
  return kind === "rsvp" ? Boolean(event.rsvp_enabled && event.rsvp_url?.trim()) : Boolean(event.tickets_enabled && event.tickets_url?.trim());
}

/** ANY of the requested actions (an empty request matches everything). */
export function eventMatchesAccess(event: Parameters<typeof eventOffersAccess>[0], access: readonly EventAccess[] | undefined): boolean {
  return !access || access.length === 0 || access.some((k) => eventOffersAccess(event, k));
}

/** Happening Now — exactly getTemporalLabel()'s "live" rule. */
export function isEventHappeningNow(startIso: string | null | undefined, endIso: string | null | undefined): boolean {
  // A date with no published start (or end) is never "now".
  if (!startIso || !endIso) return false;
  return getTemporalLabel(startIso, endIso).live;
}
