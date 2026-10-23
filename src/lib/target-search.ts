import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ADD_TARGET_PER_KIND_ALL, ADD_TARGET_PER_KIND_ONE, TARGET_SEARCH_MIN_CHARS, cleanTargetQuery, type AddTargetScope, type TargetStatus } from "./business-targets-domain";
import { TARGET_COLUMN } from "./business-targets";
import { isUpcoming, nyDate } from "./discovery/commercial-server";
import type { TargetKind } from "./commercial-intents";

/** Add Target search — "I already know who I want". One text search across
 * Places, Businesses and Events (or one of them), each result carrying the
 * identity Findmi already has: image/logo, Category, geography and, for an
 * Event, its next upcoming date (never a past one shown as current).
 *
 * Bounded: one capped read per kind searched (at most three), then batch
 * enrichment of only those rows — Categories, Areas, upcoming occurrences,
 * this Business's own Locations and its existing Targets. No per-result reads,
 * nothing loaded client-side. Read-only. Scope matches the existing pickers:
 * every linkable place (published or unlisted, never archived), public
 * Businesses other than this one, public Events. The caller has authorized
 * the session for `businessId`. */

export interface TargetCandidate {
  kind: TargetKind;
  id: string;
  name: string;
  imageUrl: string | null;
  category: string | null;
  /** "Jersey City, NJ" (Place / Business) or venue / city (Event). */
  place: string | null;
  /** A Place's Area when it adds something beyond the city ("Bergen-Lafayette"). */
  area: string | null;
  /** Events: the next upcoming date (YYYY-MM-DD); null when none is upcoming. */
  nextDate: string | null;
  /** Events: no upcoming date on Findmi. */
  noUpcoming: boolean;
  /** Known to Findmi but not public (an unlisted place). */
  notPublic: boolean;
  /** One of this Business's own Locations — can't be a Target. */
  ownLocation: boolean;
  /** This Business already targets it (any status). */
  target: { id: string; status: TargetStatus } | null;
}

type Row = Record<string, unknown>;
const KIND_ORDER: Record<TargetKind, number> = { location: 0, business: 1, event: 2 };
const SEARCH: Record<TargetKind, (q: string) => string> = {
  location: (q) => `name.ilike.%${q}%,city.ilike.%${q}%,address.ilike.%${q}%`,
  business: (q) => `name.ilike.%${q}%,city.ilike.%${q}%`,
  event: (q) => `name.ilike.%${q}%,city.ilike.%${q}%,venue_name.ilike.%${q}%`,
};
const placeLine = (city: unknown, state: unknown) => [city, state].filter((v) => typeof v === "string" && v).join(", ") || null;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
type Q = any;
const live = (q: Q): Q => q.eq("is_demo", false).eq("publication_status", "live").is("archived_at", null).is("trashed_at", null);

/** Name match first (exact, then starts-with), then Place → Business → Event, then name. */
export function rankCandidates<T extends { kind: TargetKind; name: string; id: string }>(items: readonly T[], query: string): T[] {
  const q = norm(query);
  const score = (n: string) => (norm(n) === q ? 0 : norm(n).startsWith(q) ? 1 : 2);
  return [...items].sort((a, b) => score(a.name) - score(b.name) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export async function searchTargetCandidates(admin: SupabaseClient, businessId: string, scope: AddTargetScope, query: string, now = new Date()): Promise<TargetCandidate[]> {
  const q = cleanTargetQuery(query);
  if (q.length < TARGET_SEARCH_MIN_CHARS) return [];
  const per = scope === "all" ? ADD_TARGET_PER_KIND_ALL : ADD_TARGET_PER_KIND_ONE;
  const wants = (k: TargetKind) => scope === "all" || scope === k;
  const none = Promise.resolve({ data: [] as Row[] });

  const [locRes, bizRes, evtRes] = await Promise.all([
    wants("location")
      ? admin.from("locations").select("id, name, city, state, cover_image_url, logo_url, is_demo, category_id, market_area_id").is("archived_at", null).is("trashed_at", null).or(SEARCH.location(q)).order("name").limit(per)
      : none,
    wants("business") ? live(admin.from("businesses").select("id, name, city, state, logo_url, cover_image_url")).neq("id", businessId).or(SEARCH.business(q)).order("name").limit(per) : none,
    wants("event")
      ? live(admin.from("events").select("id, name, city, venue_name, cover_image_url, start_date, end_date, start_at, end_at")).or(SEARCH.event(q)).order("start_date", { ascending: false, nullsFirst: false }).limit(per)
      : none,
  ]);
  const locs = (locRes.data ?? []) as Row[];
  const bizs = (bizRes.data ?? []) as Row[];
  const evts = (evtRes.data ?? []) as Row[];
  if (!locs.length && !bizs.length && !evts.length) return [];

  const locIds = locs.map((r) => r.id as string);
  const bizIds = bizs.map((r) => r.id as string);
  const evtIds = evts.map((r) => r.id as string);
  const areaIds = [...new Set(locs.map((r) => r.market_area_id).filter((v): v is string => typeof v === "string"))];
  const targetsFor = (kind: TargetKind, ids: string[]) =>
    ids.length ? admin.from("business_targets").select("id, status, target_location_id, target_business_id, target_event_id").eq("business_id", businessId).in(TARGET_COLUMN[kind], ids) : none;

  // One batch per signal, only for the rows found.
  const [bizCats, evtFormats, evtCats, occ, areas, own, tLoc, tBiz, tEvt] = await Promise.all([
    bizIds.length ? admin.from("business_categories").select("business_id, category_id").in("business_id", bizIds) : none,
    evtIds.length ? admin.from("event_formats").select("event_id, category_id").in("event_id", evtIds) : none,
    evtIds.length ? admin.from("event_categories").select("event_id, category_id").in("event_id", evtIds) : none,
    evtIds.length ? admin.from("event_occurrences").select("event_id, occurrence_date, start_at, end_at").in("event_id", evtIds).gte("occurrence_date", nyDate(new Date(now.getTime() - 86_400_000))).limit(500) : none,
    areaIds.length ? admin.from("market_areas").select("id, name, display_name").in("id", areaIds) : none,
    locIds.length ? admin.from("business_locations").select("location_id").eq("business_id", businessId).in("location_id", locIds) : none,
    targetsFor("location", locIds),
    targetsFor("business", bizIds),
    targetsFor("event", evtIds),
  ]);
  const catIds = [
    ...new Set(
      [...locs.map((r) => r.category_id), ...((bizCats.data ?? []) as Row[]).map((r) => r.category_id), ...((evtFormats.data ?? []) as Row[]).map((r) => r.category_id), ...((evtCats.data ?? []) as Row[]).map((r) => r.category_id)].filter(
        (v): v is string => typeof v === "string"
      )
    ),
  ];
  const cats = catIds.length ? (((await admin.from("categories").select("id, name, parent_id").in("id", catIds)).data ?? []) as Row[]) : [];
  const catName = (id: unknown) => (cats.find((c) => c.id === id)?.name as string | undefined) ?? null;
  const namesFor = (rows: Row[], owner: string, id: string) => rows.filter((r) => r[owner] === id).map((r) => catName(r.category_id)).filter((n): n is string => Boolean(n)).sort();

  const targetMap = new Map<string, { id: string; status: TargetStatus }>();
  for (const [kind, res] of [["location", tLoc], ["business", tBiz], ["event", tEvt]] as const) {
    for (const r of (res.data ?? []) as Row[]) targetMap.set(`${kind}:${r[TARGET_COLUMN[kind]]}`, { id: r.id as string, status: r.status as TargetStatus });
  }
  const ownSet = new Set(((own.data ?? []) as Row[]).map((r) => r.location_id as string));
  const areaName = (id: unknown) => {
    const a = ((areas.data ?? []) as Row[]).find((x) => x.id === id);
    return a ? ((a.display_name as string | null)?.trim() || (a.name as string)) : null;
  };

  // Events: the next UPCOMING date only.
  const nowIso = now.toISOString();
  const today = nyDate(now);
  const next = new Map<string, string>();
  for (const r of (occ.data ?? []) as Row[]) {
    if (!isUpcoming(r, nowIso, today)) continue;
    const d = r.occurrence_date as string;
    const id = r.event_id as string;
    if (!next.has(id) || d < next.get(id)!) next.set(id, d);
  }
  const hasOccurrences = new Set(((occ.data ?? []) as Row[]).map((r) => r.event_id as string));

  const out: TargetCandidate[] = [];
  for (const r of locs) {
    const city = placeLine(r.city, r.state);
    const area = areaName(r.market_area_id);
    out.push({
      kind: "location",
      id: r.id as string,
      name: r.name as string,
      imageUrl: ((r.cover_image_url ?? r.logo_url) as string | null) ?? null,
      category: catName(r.category_id),
      place: city,
      area: area && (!r.city || norm(area) !== norm(r.city as string)) ? area : null,
      nextDate: null,
      noUpcoming: false,
      notPublic: Boolean(r.is_demo),
      ownLocation: ownSet.has(r.id as string),
      target: targetMap.get(`location:${r.id}`) ?? null,
    });
  }
  for (const r of bizs) {
    out.push({
      kind: "business",
      id: r.id as string,
      name: r.name as string,
      imageUrl: ((r.logo_url ?? r.cover_image_url) as string | null) ?? null,
      category: namesFor((bizCats.data ?? []) as Row[], "business_id", r.id as string).slice(0, 2).join(", ") || null,
      place: placeLine(r.city, r.state),
      area: null,
      nextDate: null,
      noUpcoming: false,
      notPublic: false,
      ownLocation: false,
      target: targetMap.get(`business:${r.id}`) ?? null,
    });
  }
  for (const r of evts) {
    const id = r.id as string;
    let date = next.get(id) ?? null;
    // An Event with no occurrence rows: its own dates, only while not over.
    if (!date && !hasOccurrences.has(id)) {
      const end = (r.end_date ?? r.start_date) as string | null;
      if ((end && end >= today) || isUpcoming(r, nowIso, today)) date = r.start_date && (r.start_date as string) >= today ? (r.start_date as string) : today;
    }
    const fmt = namesFor((evtFormats.data ?? []) as Row[], "event_id", id);
    const top = namesFor(((evtCats.data ?? []) as Row[]).filter((x) => !cats.find((c) => c.id === x.category_id)?.parent_id), "event_id", id);
    out.push({
      kind: "event",
      id,
      name: r.name as string,
      imageUrl: (r.cover_image_url as string | null) ?? null,
      category: [...new Set([...fmt, ...top])].slice(0, 2).join(", ") || null,
      place: ((r.venue_name || r.city) as string | null) || null,
      area: null,
      nextDate: date,
      noUpcoming: !date,
      notPublic: false,
      ownLocation: false,
      target: targetMap.get(`event:${id}`) ?? null,
    });
  }
  // De-duplicate (kind + id) and rank.
  const seen = new Set<string>();
  return rankCandidates(out.filter((c) => (seen.has(`${c.kind}:${c.id}`) ? false : (seen.add(`${c.kind}:${c.id}`), true))), q);
}
