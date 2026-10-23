import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SelectedLocationDetail } from "@/components/account/EventLocationField";
import {
  TARGET_ACTIVITY_PAGE_SIZE,
  TARGET_PAGE_SIZE,
  TARGET_SEARCH_MIN_CHARS,
  TARGET_STATUSES,
  KIND_FOR_FILTER,
  activityCursor,
  cleanTargetQuery,
  targetChanges,
  validateActivityNote,
  validateInternalNotes,
  validateTargetUpdate,
  type ActivityCursor,
  type TargetActivityType,
  type TargetActor,
  type TargetFilter,
  type TargetSource,
  type TargetStatus,
  type TargetUpdateInput,
} from "./business-targets-domain";
import { INTENTS_BY_KIND, isTargetKind, validateTargetIntents, type CommercialIntent, type TargetKind } from "./commercial-intents";
import { safeAuthorName } from "./moment-author";
import { FOLLOW_UPS_READ_LIMIT, type FollowUpTarget } from "./business-follow-ups";

/** Targets — server reads/writes over business_targets (the ONE live Target
 * system; business_location_placements is legacy and read-only). Service-role
 * client only; EVERY function here performs NO authorization of its own: the
 * caller (target-actions.ts / the Business Manager page) has already authorized
 * the session against THIS (owner) Business, and every query is scoped by
 * business_id so one Business can never read or touch another's rows — and a
 * counterparty never reads Targets about itself (nothing here is keyed by the
 * counterparty except under the owner's business_id).
 *
 * internal_notes is Findmi-only. The Business reads below select an explicit
 * column list that never includes it (BUSINESS_TARGET_COLUMNS), and the
 * Business write builds its patch from validateTargetUpdate, which has no
 * internal_notes key. Only the two admin* functions touch it. */

const LOC_COLS = "id, name, slug, address, city, state, logo_url, cover_image_url, is_demo, archived_at, trashed_at";
const BIZ_COLS = "id, name, slug, city, state, logo_url, cover_image_url, is_demo, publication_status, archived_at, trashed_at";
const EVENT_COLS = "id, name, slug, city, state, venue_name, cover_image_url, start_date, start_at, is_demo, publication_status, archived_at, trashed_at";

/** Each kind's counterparty column and the alias its row is embedded under. */
export const TARGET_COLUMN: Record<TargetKind, "target_location_id" | "target_business_id" | "target_event_id"> = {
  location: "target_location_id",
  business: "target_business_id",
  event: "target_event_id",
};
const ALIAS: Record<TargetKind, "location" | "target_business" | "event"> = { location: "location", business: "target_business", event: "event" };
const EMBED: Record<TargetKind, (inner: boolean) => string> = {
  location: (inner) => `location:locations${inner ? "!inner" : ""}(${LOC_COLS})`,
  business: (inner) => `target_business:businesses!business_targets_target_business_id_fkey${inner ? "!inner" : ""}(${BIZ_COLS})`,
  event: (inner) => `event:events${inner ? "!inner" : ""}(${EVENT_COLS})`,
};
/** The counterparty text a Target search matches (inside that kind's embed). */
const SEARCH: Record<TargetKind, (q: string) => string> = {
  location: (q) => `name.ilike.%${q}%,city.ilike.%${q}%,address.ilike.%${q}%`,
  business: (q) => `name.ilike.%${q}%,city.ilike.%${q}%`,
  event: (q) => `name.ilike.%${q}%,city.ilike.%${q}%,venue_name.ilike.%${q}%`,
};

const BASE_COLS = "id, target_business_id, target_location_id, target_event_id, intents, status, status_changed_at, context, next_action, next_action_at, source, created_at, updated_at";

/** What a Business member reads: never internal_notes. `innerKind` makes that
 * kind's embed an inner join (needed to filter on its fields). */
export function targetColumns(innerKind: TargetKind | null = null): string {
  return [BASE_COLS, EMBED.location(innerKind === "location"), EMBED.business(innerKind === "business"), EMBED.event(innerKind === "event")].join(", ");
}
export const BUSINESS_TARGET_COLUMNS = targetColumns();

export interface TargetCounterparty {
  kind: TargetKind;
  id: string;
  name: string;
  slug: string;
  /** "Jersey City, NJ" / "Oct 30 · Jersey City" — never the address for a Business. */
  subtitle: string | null;
  imageUrl: string | null;
  /** Its public page, only when it is public. */
  href: string | null;
  /** Known to Findmi but not public (unlisted place, unpublished Business/Event). */
  notPublic: boolean;
  archived: boolean;
}

/** What a Business member may see about one of its own Targets. There is
 * deliberately no internal-notes field on this type. */
export interface BusinessTargetItem {
  id: string;
  kind: TargetKind;
  counterparty: TargetCounterparty;
  /** The relationship workspace's address for a Place Target (null otherwise). */
  locationId: string | null;
  intents: CommercialIntent[];
  status: TargetStatus;
  statusChangedAt: string;
  context: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  source: TargetSource;
  createdAt: string;
  updatedAt: string;
}

export type TargetCounts = { all: number } & Record<TargetStatus, number>;
export type TargetKindCounts = { all: number; places: number; businesses: number; events: number };

export interface BusinessTargetsPage {
  /** false until the Targets migration is applied (the view then says so). */
  available: boolean;
  items: BusinessTargetItem[];
  total: number;
  page: number;
  pageSize: number;
  /** Status totals within the current kind lens. */
  counts: TargetCounts;
  /** Totals per kind (Growth's All / Places / Businesses / Events chips). */
  kindCounts: TargetKindCounts;
}

export type TargetResult = { ok: true } | { ok: false; error: string };

export const ALREADY_OUR_LOCATION_TARGET_ERROR = "That’s one of your own Locations, so it can’t be a Target.";
export const OWN_BUSINESS_TARGET_ERROR = "That’s your own Business, so it can’t be a Target.";
const UNAVAILABLE_ERROR = "Targets aren’t available yet. Please try again soon.";

const emptyCounts = (): TargetCounts => ({ all: 0, target: 0, in_conversation: 0, agreed: 0, active: 0, passed: 0 });
const emptyKindCounts = (): TargetKindCounts => ({ all: 0, places: 0, businesses: 0, events: 0 });

export function isMissingTargetsTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /business_targets/.test(error.message ?? "");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const place = (city: string | null, state: string | null) => [city, state].filter(Boolean).join(", ") || null;
const shortDate = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

type RawLoc = { id: string; name: string; slug: string; address: string | null; city: string | null; state: string | null; logo_url: string | null; cover_image_url: string | null; is_demo: boolean | null; archived_at: string | null; trashed_at: string | null };
type RawBiz = { id: string; name: string; slug: string; city: string | null; state: string | null; logo_url: string | null; cover_image_url: string | null; is_demo: boolean | null; publication_status: string | null; archived_at: string | null; trashed_at: string | null };
type RawEvent = { id: string; name: string; slug: string; city: string | null; state: string | null; venue_name: string | null; cover_image_url: string | null; start_date: string | null; start_at: string | null; is_demo: boolean | null; publication_status: string | null; archived_at: string | null; trashed_at: string | null };
type RawRow = {
  id: string;
  target_business_id: string | null;
  target_location_id: string | null;
  target_event_id: string | null;
  intents: CommercialIntent[] | null;
  status: TargetStatus;
  status_changed_at: string;
  context: string | null;
  next_action: string | null;
  next_action_at: string | null;
  source: TargetSource;
  created_at: string;
  updated_at: string;
  location?: RawLoc | RawLoc[] | null;
  target_business?: RawBiz | RawBiz[] | null;
  event?: RawEvent | RawEvent[] | null;
};

export function kindOf(r: { target_business_id: string | null; target_location_id: string | null; target_event_id: string | null }): TargetKind | null {
  if (r.target_location_id) return "location";
  if (r.target_business_id) return "business";
  if (r.target_event_id) return "event";
  return null;
}

function counterpartyOf(r: RawRow): TargetCounterparty | null {
  const kind = kindOf(r);
  if (kind === "location") {
    const l = one(r.location);
    if (!l) return null;
    const archived = Boolean(l.archived_at || l.trashed_at);
    return { kind, id: l.id, name: l.name, slug: l.slug, subtitle: place(l.city, l.state), imageUrl: l.cover_image_url ?? l.logo_url ?? null, href: !l.is_demo && !archived ? `/location/${l.slug}` : null, notPublic: Boolean(l.is_demo), archived };
  }
  if (kind === "business") {
    const b = one(r.target_business);
    if (!b) return null;
    const archived = Boolean(b.archived_at || b.trashed_at);
    const notPublic = Boolean(b.is_demo) || b.publication_status !== "live";
    return { kind, id: b.id, name: b.name, slug: b.slug, subtitle: place(b.city, b.state), imageUrl: b.logo_url ?? b.cover_image_url ?? null, href: !notPublic && !archived ? `/business/${b.slug}` : null, notPublic, archived };
  }
  if (kind === "event") {
    const e = one(r.event);
    if (!e) return null;
    const archived = Boolean(e.archived_at || e.trashed_at);
    const notPublic = Boolean(e.is_demo) || e.publication_status !== "live";
    const when = e.start_date ?? e.start_at;
    return { kind, id: e.id, name: e.name, slug: e.slug, subtitle: [when ? shortDate(when) : null, e.venue_name || e.city].filter(Boolean).join(" · ") || null, imageUrl: e.cover_image_url ?? null, href: !notPublic && !archived ? `/event/${e.slug}` : null, notPublic, archived };
  }
  return null;
}

function toItem(r: RawRow): BusinessTargetItem | null {
  const counterparty = counterpartyOf(r);
  if (!counterparty) return null;
  return {
    id: r.id,
    kind: counterparty.kind,
    counterparty,
    locationId: counterparty.kind === "location" ? counterparty.id : null,
    intents: INTENTS_BY_KIND[counterparty.kind].filter((i) => (r.intents ?? []).includes(i)),
    status: r.status,
    statusChangedAt: r.status_changed_at,
    context: r.context,
    nextAction: r.next_action,
    nextActionAt: r.next_action_at,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Status totals (optionally within one kind) and, when asked, totals per kind. */
export async function getTargetCounts(
  admin: SupabaseClient,
  businessId: string,
  kind: TargetKind | null,
  withKinds = false
): Promise<{ available: boolean; counts: TargetCounts; kindCounts: TargetKindCounts }> {
  const head = (k: TargetKind | null, status?: TargetStatus) => {
    let q = admin.from("business_targets").select("id", { count: "exact", head: true }).eq("business_id", businessId);
    if (k) q = q.not(TARGET_COLUMN[k], "is", null);
    if (status) q = q.eq("status", status);
    return q;
  };
  const kinds: (TargetKind | null)[] = withKinds ? [null, "location", "business", "event"] : [];
  const [statusResults, kindResults] = await Promise.all([Promise.all([head(kind), ...TARGET_STATUSES.map((s) => head(kind, s))]), Promise.all(kinds.map((k) => head(k)))]);
  if ([...statusResults, ...kindResults].some((r) => r.error)) return { available: false, counts: emptyCounts(), kindCounts: emptyKindCounts() };
  const counts = emptyCounts();
  counts.all = statusResults[0].count ?? 0;
  TARGET_STATUSES.forEach((s, i) => (counts[s] = statusResults[i + 1].count ?? 0));
  const kindCounts = emptyKindCounts();
  if (withKinds) {
    kindCounts.all = kindResults[0].count ?? 0;
    kindCounts.places = kindResults[1].count ?? 0;
    kindCounts.businesses = kindResults[2].count ?? 0;
    kindCounts.events = kindResults[3].count ?? 0;
  }
  return { available: true, counts, kindCounts };
}

/** Ids of this Business's Targets whose counterparty matches the search, across
 * every kind (the All lens) — one bounded inner-join read per kind. */
async function matchingTargetIds(admin: SupabaseClient, businessId: string, q: string): Promise<string[] | null> {
  const reads = await Promise.all(
    (["location", "business", "event"] as const).map((k) =>
      admin
        .from("business_targets")
        .select(`id, ${EMBED[k](true).replace(/\(.*\)$/, "(id)")}`)
        .eq("business_id", businessId)
        .or(SEARCH[k](q), { referencedTable: ALIAS[k] })
        .limit(1000)
    )
  );
  if (reads.some((r) => r.error)) return null;
  return [...new Set(reads.flatMap((r) => ((r.data ?? []) as unknown as { id: string }[]).map((x) => x.id)))];
}

/** One page of this Business's Targets, filtered and searched in the database.
 * Soonest Next Action first (undated last), then most recently changed.
 * `placesOnly` is the Find Us Here lens: Place Targets only, whatever the URL says. */
export async function getBusinessTargetsPage(
  admin: SupabaseClient,
  businessId: string,
  filter: TargetFilter,
  page: number,
  opts: { placesOnly?: boolean } = {}
): Promise<BusinessTargetsPage> {
  const size = TARGET_PAGE_SIZE;
  const pageNo = Math.max(1, Math.floor(page) || 1);
  const from = (pageNo - 1) * size;
  const kind: TargetKind | null = opts.placesOnly ? "location" : filter.kind ? KIND_FOR_FILTER[filter.kind] : null;
  const unavailable: BusinessTargetsPage = { available: false, items: [], total: 0, page: 1, pageSize: size, counts: emptyCounts(), kindCounts: emptyKindCounts() };

  let ids: string[] | null = null;
  if (filter.q && !kind) {
    ids = await matchingTargetIds(admin, businessId, filter.q);
    if (ids === null) return unavailable;
  }
  let query = admin.from("business_targets").select(targetColumns(filter.q && kind ? kind : null), { count: "exact" }).eq("business_id", businessId);
  if (kind) query = query.not(TARGET_COLUMN[kind], "is", null);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.q && kind) query = query.or(SEARCH[kind](filter.q), { referencedTable: ALIAS[kind] });
  if (ids) query = query.in("id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const [{ data, error, count }, totals] = await Promise.all([
    query.order("next_action_at", { ascending: true, nullsFirst: false }).order("updated_at", { ascending: false }).order("id").range(from, from + size - 1),
    getTargetCounts(admin, businessId, kind, !opts.placesOnly),
  ]);
  if (error || !totals.available) {
    if (error && !isMissingTargetsTable(error)) console.error("getBusinessTargetsPage failed:", error.message);
    return unavailable;
  }
  const items = ((data ?? []) as unknown as RawRow[]).map(toItem).filter((i): i is BusinessTargetItem => Boolean(i));
  return { available: true, items, total: count ?? items.length, page: pageNo, pageSize: size, counts: totals.counts, kindCounts: totals.kindCounts };
}

/** Business Home → Follow-Ups: this Business's own open Targets (not Passed),
 * of every kind, that carry a next step, soonest dated first. One bounded read —
 * no Activity, no internal notes, no other Business's rows (a Target is private
 * to the Business tracking it). lib/business-follow-ups.ts orders them. */
export async function getFollowUpTargets(admin: SupabaseClient, businessId: string, limit = FOLLOW_UPS_READ_LIMIT): Promise<FollowUpTarget[]> {
  const { data, error } = await admin
    .from("business_targets")
    .select("id, target_business_id, target_location_id, target_event_id, status, next_action, next_action_at, location:locations(name), target_business:businesses!business_targets_target_business_id_fkey(name), event:events(name)")
    .eq("business_id", businessId)
    .neq("status", "passed")
    .or("next_action.not.is.null,next_action_at.not.is.null")
    .order("next_action_at", { ascending: true, nullsFirst: false })
    .order("id")
    .limit(limit);
  if (error || !data) return [];
  type Row = { id: string; target_business_id: string | null; target_location_id: string | null; target_event_id: string | null; status: TargetStatus; next_action: string | null; next_action_at: string | null; location?: { name: string } | { name: string }[] | null; target_business?: { name: string } | { name: string }[] | null; event?: { name: string } | { name: string }[] | null };
  return (data as unknown as Row[]).flatMap((r) => {
    const kind = kindOf(r);
    if (!kind) return [];
    const name = one(kind === "location" ? r.location : kind === "business" ? r.target_business : r.event)?.name ?? "A Target";
    return [{ targetId: r.id, kind, locationId: r.target_location_id, title: name, status: r.status, nextAction: r.next_action, nextActionAt: r.next_action_at }];
  });
}

/** Growth's one-line Targets status: how many Targets exist (every kind) and how
 * many are still being pursued (not Passed). Two head counts — never a row read. */
export async function getTargetPursuit(admin: SupabaseClient, businessId: string): Promise<{ total: number; pursuing: number }> {
  const base = () => admin.from("business_targets").select("id", { count: "exact", head: true }).eq("business_id", businessId);
  const [all, passed] = await Promise.all([base(), base().eq("status", "passed")]);
  if (all.error || passed.error) return { total: 0, pursuing: 0 };
  const total = all.count ?? 0;
  return { total, pursuing: Math.max(0, total - (passed.count ?? 0)) };
}

/** One of this Business's own Targets (null when missing or another Business's). */
export async function getBusinessTarget(admin: SupabaseClient, businessId: string, targetId: string): Promise<BusinessTargetItem | null> {
  if (!UUID.test(targetId)) return null;
  const { data, error } = await admin.from("business_targets").select(BUSINESS_TARGET_COLUMNS).eq("id", targetId).eq("business_id", businessId).maybeSingle();
  if (error || !data) return null;
  return toItem(data as unknown as RawRow);
}

/** This Business's Target at ONE place, or null (the pair is unique). */
export async function getBusinessTargetByLocation(admin: SupabaseClient, businessId: string, locationId: string): Promise<BusinessTargetItem | null> {
  if (!UUID.test(locationId)) return null;
  const { data, error } = await admin.from("business_targets").select(BUSINESS_TARGET_COLUMNS).eq("business_id", businessId).eq("target_location_id", locationId).maybeSingle();
  if (error || !data) return null;
  return toItem(data as unknown as RawRow);
}

/** Whether a counterparty may be targeted at all (exists, not archived/trashed;
 * a Business or Event must be public — only Places may be unlisted, as before). */
export async function checkCounterparty(admin: SupabaseClient, businessId: string, kind: TargetKind, id: string): Promise<string | null> {
  if (kind === "location") {
    const { data: operated } = await admin.from("business_locations").select("id").eq("business_id", businessId).eq("location_id", id).maybeSingle();
    if (operated) return ALREADY_OUR_LOCATION_TARGET_ERROR;
    const { data } = await admin.from("locations").select("id, archived_at, trashed_at").eq("id", id).maybeSingle();
    const loc = data as { id: string; archived_at: string | null; trashed_at: string | null } | null;
    return !loc || loc.archived_at || loc.trashed_at ? "That place isn’t available on Findmi." : null;
  }
  if (kind === "business") {
    if (id === businessId) return OWN_BUSINESS_TARGET_ERROR;
    const { data } = await admin.from("businesses").select("id, is_demo, publication_status, archived_at, trashed_at").eq("id", id).maybeSingle();
    const b = data as { id: string; is_demo: boolean | null; publication_status: string | null; archived_at: string | null; trashed_at: string | null } | null;
    return !b || b.is_demo || b.publication_status !== "live" || b.archived_at || b.trashed_at ? "That Business isn’t available on Findmi." : null;
  }
  const { data } = await admin.from("events").select("id, is_demo, publication_status, archived_at, trashed_at").eq("id", id).maybeSingle();
  const e = data as { id: string; is_demo: boolean | null; publication_status: string | null; archived_at: string | null; trashed_at: string | null } | null;
  return !e || e.is_demo || e.publication_status !== "live" || e.archived_at || e.trashed_at ? "That Event isn’t available on Findmi." : null;
}

export type AddTargetResult =
  | { ok: true; id: string; existing: boolean; status: TargetStatus; kind: TargetKind; locationId: string | null }
  | { ok: false; error: string };

/** Add a counterparty as a Target, for the chosen intents. Never duplicates:
 * when this Business already targets it (any status, Passed included) the
 * existing Target is returned — with any newly chosen intents added — so the
 * caller can open (and if needed reopen) it. Writes ONLY business_targets: no
 * Conversation, notification, Opportunity, Find Us Here, Appearance or Event
 * participation — targeting is private intent. */
export async function addBusinessTarget(
  admin: SupabaseClient,
  businessId: string,
  input: { kind: unknown; counterpartyId: unknown; intents: unknown; source: TargetSource; userId: string | null }
): Promise<AddTargetResult> {
  if (!isTargetKind(input.kind)) return { ok: false, error: "Choose what to target." };
  const kind = input.kind;
  const id = typeof input.counterpartyId === "string" ? input.counterpartyId : "";
  if (!UUID.test(id)) return { ok: false, error: kind === "location" ? "Choose a place first." : kind === "business" ? "Choose a Business first." : "Choose an Event first." };
  const intents = validateTargetIntents(kind, input.intents);
  if (!intents.ok) return intents;
  const col = TARGET_COLUMN[kind];
  const locationId = kind === "location" ? id : null;

  const existingRow = async () => {
    const { data, error } = await admin.from("business_targets").select("id, status, intents").eq("business_id", businessId).eq(col, id).maybeSingle();
    return { row: data as { id: string; status: TargetStatus; intents: CommercialIntent[] | null } | null, error };
  };
  const reuse = async (row: { id: string; status: TargetStatus; intents: CommercialIntent[] | null }): Promise<AddTargetResult> => {
    const merged = INTENTS_BY_KIND[kind].filter((i) => (row.intents ?? []).includes(i) || intents.value.includes(i));
    if (merged.length !== (row.intents ?? []).length) await admin.from("business_targets").update({ intents: merged }).eq("id", row.id).eq("business_id", businessId);
    return { ok: true, id: row.id, existing: true, status: row.status, kind, locationId };
  };
  const found = await existingRow();
  if (found.error) return { ok: false, error: isMissingTargetsTable(found.error) ? UNAVAILABLE_ERROR : "Couldn’t add that Target. Please try again." };
  if (found.row) return reuse(found.row);

  const refused = await checkCounterparty(admin, businessId, kind, id);
  if (refused) return { ok: false, error: refused };

  const { data: inserted, error } = await admin
    .from("business_targets")
    .insert({ business_id: businessId, [col]: id, intents: intents.value, status: "target", source: input.source, created_by_user_id: input.userId })
    .select("id, status")
    .single();
  if (error || !inserted) {
    // A concurrent add of the same counterparty: the unique (owner, counterparty) key held.
    if (error?.code === "23505") {
      const again = await existingRow();
      if (again.row) return reuse(again.row);
    }
    if (error && isMissingTargetsTable(error)) return { ok: false, error: UNAVAILABLE_ERROR };
    console.error("addBusinessTarget failed:", error?.message);
    return { ok: false, error: "Couldn’t add that Target. Please try again." };
  }
  const row = inserted as { id: string; status: TargetStatus };
  return { ok: true, id: row.id, existing: false, status: row.status, kind, locationId };
}

/** A Business edit: status, Context, Next Action and its date — nothing else.
 * Reopening a Passed Target is this same call with status 'target'. When the
 * status changes, the actor rides along in the SAME update (status_actor /
 * status_actor_user_id) and the database trigger records the status_change
 * Activity, keeps status_changed_at in step and clears the actor columns — so
 * status and its Activity can never disagree. */
export async function updateBusinessTarget(
  admin: SupabaseClient,
  businessId: string,
  targetId: string,
  input: TargetUpdateInput,
  by: { actor: TargetActor; userId: string | null }
): Promise<TargetResult & { changed?: boolean }> {
  if (!UUID.test(targetId)) return { ok: false, error: "That Target wasn’t found." };
  const checked = validateTargetUpdate(input);
  if (!checked.ok) return checked;
  const { data, error } = await admin.from("business_targets").select("id, status, context, next_action, next_action_at").eq("id", targetId).eq("business_id", businessId).maybeSingle();
  if (error) return { ok: false, error: isMissingTargetsTable(error) ? UNAVAILABLE_ERROR : "Couldn’t load that Target." };
  const current = data as { id: string; status: TargetStatus; context: string | null; next_action: string | null; next_action_at: string | null } | null;
  if (!current) return { ok: false, error: "That Target wasn’t found." };
  const patch = targetChanges(current, checked.value);
  if (Object.keys(patch).length === 0) return { ok: true, changed: false };
  const write = "status" in patch ? { ...patch, status_actor: by.actor, status_actor_user_id: by.userId } : patch;
  const { error: updateError } = await admin.from("business_targets").update(write).eq("id", targetId).eq("business_id", businessId);
  if (updateError) {
    console.error("updateBusinessTarget failed:", updateError.message);
    return { ok: false, error: "Couldn’t save that. Please try again." };
  }
  return { ok: true, changed: true };
}

/** Change a Target's intents (only ones its counterparty kind supports; at least one). */
export async function setBusinessTargetIntents(admin: SupabaseClient, businessId: string, targetId: string, intents: unknown): Promise<TargetResult & { changed?: boolean }> {
  if (!UUID.test(targetId)) return { ok: false, error: "That Target wasn’t found." };
  const { data } = await admin.from("business_targets").select("id, target_business_id, target_location_id, target_event_id, intents").eq("id", targetId).eq("business_id", businessId).maybeSingle();
  const row = data as { id: string; target_business_id: string | null; target_location_id: string | null; target_event_id: string | null; intents: CommercialIntent[] | null } | null;
  const kind = row ? kindOf(row) : null;
  if (!row || !kind) return { ok: false, error: "That Target wasn’t found." };
  const checked = validateTargetIntents(kind, intents);
  if (!checked.ok) return checked;
  if (checked.value.join(",") === INTENTS_BY_KIND[kind].filter((i) => (row.intents ?? []).includes(i)).join(",")) return { ok: true, changed: false };
  const { error } = await admin.from("business_targets").update({ intents: checked.value }).eq("id", targetId).eq("business_id", businessId);
  if (error) return { ok: false, error: "Couldn’t save that. Please try again." };
  return { ok: true, changed: true };
}

// ── Counterparty search (Add Target) ──────────────────────────────────────
// Each needs TARGET_SEARCH_MIN_CHARS characters first: a picker never lists
// every place, Business or Event on Findmi.

/** Places a Target can point at: every LINKABLE canonical Location — published
 * and known-but-not-yet-public (unlisted) alike, never archived/trashed. */
export async function searchTargetLocations(admin: SupabaseClient, query: string): Promise<SelectedLocationDetail[]> {
  const q = cleanTargetQuery(query);
  if (q.length < TARGET_SEARCH_MIN_CHARS) return [];
  const { data } = await admin
    .from("locations")
    .select("id, name, slug, address, city, state, postal_code, is_demo, category:categories(name)")
    .is("archived_at", null)
    .is("trashed_at", null)
    .or(SEARCH.location(q))
    .order("name")
    .limit(20);
  type Row = { id: string; name: string; slug: string; address: string | null; city: string | null; state: string | null; postal_code: string | null; is_demo: boolean | null; category: { name: string } | { name: string }[] | null };
  return ((data ?? []) as unknown as Row[]).map((l) => ({ id: l.id, name: l.name, slug: l.slug, category: one(l.category)?.name ?? null, address: l.address, city: l.city, state: l.state, postal_code: l.postal_code, is_public: !l.is_demo }));
}

export interface TargetSearchResult {
  id: string;
  name: string;
  subtitle: string | null;
  imageUrl: string | null;
}

/** Public Businesses (never this Business itself, never unpublished/demo/archived). */
export async function searchTargetBusinesses(admin: SupabaseClient, businessId: string, query: string): Promise<TargetSearchResult[]> {
  const q = cleanTargetQuery(query);
  if (q.length < TARGET_SEARCH_MIN_CHARS) return [];
  const { data } = await admin
    .from("businesses")
    .select("id, name, city, state, logo_url, cover_image_url")
    .eq("is_demo", false)
    .eq("publication_status", "live")
    .is("archived_at", null)
    .is("trashed_at", null)
    .neq("id", businessId)
    .or(SEARCH.business(q))
    .order("name")
    .limit(20);
  return ((data ?? []) as { id: string; name: string; city: string | null; state: string | null; logo_url: string | null; cover_image_url: string | null }[]).map((b) => ({ id: b.id, name: b.name, subtitle: place(b.city, b.state), imageUrl: b.logo_url ?? b.cover_image_url ?? null }));
}

/** Public Events (never unpublished/demo/archived). An Event is the Event — its
 * organizer is a separate Business Target, never inferred from organizer_name. */
export async function searchTargetEvents(admin: SupabaseClient, query: string): Promise<TargetSearchResult[]> {
  const q = cleanTargetQuery(query);
  if (q.length < TARGET_SEARCH_MIN_CHARS) return [];
  const { data } = await admin
    .from("events")
    .select("id, name, city, venue_name, cover_image_url, start_date, start_at")
    .eq("is_demo", false)
    .eq("publication_status", "live")
    .is("archived_at", null)
    .is("trashed_at", null)
    .or(SEARCH.event(q))
    .order("start_date", { ascending: false, nullsFirst: false })
    .limit(20);
  return ((data ?? []) as { id: string; name: string; city: string | null; venue_name: string | null; cover_image_url: string | null; start_date: string | null; start_at: string | null }[]).map((e) => {
    const when = e.start_date ?? e.start_at;
    return { id: e.id, name: e.name, subtitle: [when ? shortDate(when) : null, e.venue_name || e.city].filter(Boolean).join(" · ") || null, imageUrl: e.cover_image_url };
  });
}

// ── Findmi-only ───────────────────────────────────────────────────────────
// The caller must have verified a founder Admin session (isAdminSession) —
// never mere Business membership.

export async function adminGetTargetInternalNotes(admin: SupabaseClient, businessId: string, targetId: string): Promise<string | null> {
  if (!UUID.test(targetId)) return null;
  const { data } = await admin.from("business_targets").select("internal_notes").eq("id", targetId).eq("business_id", businessId).maybeSingle();
  return (data as { internal_notes: string | null } | null)?.internal_notes ?? null;
}

export async function adminSetTargetInternalNotes(admin: SupabaseClient, businessId: string, targetId: string, notes: unknown): Promise<TargetResult> {
  if (!UUID.test(targetId)) return { ok: false, error: "That Target wasn’t found." };
  const checked = validateInternalNotes(notes);
  if (!checked.ok) return checked;
  const { data, error } = await admin.from("business_targets").update({ internal_notes: checked.value }).eq("id", targetId).eq("business_id", businessId).select("id");
  if (error) return { ok: false, error: "Couldn’t save that. Please try again." };
  if (((data ?? []) as unknown[]).length === 0) return { ok: false, error: "That Target wasn’t found." };
  return { ok: true };
}

// ── Activity ──────────────────────────────────────────────────────────────
// Append-only history of one Target. Read only for an OPENED Target (never by
// the list), one bounded page at a time, scoped through the Target to THIS
// Business. Authors resolve to profile display names in one batched read — never
// an email or a user id leaves this module.

export interface TargetActivityItem {
  id: string;
  type: TargetActivityType;
  /** The note text (notes only). */
  body: string | null;
  /** Status change: from → to (status_change only). */
  from: TargetStatus | null;
  to: TargetStatus | null;
  /** "Findmi", a member's display name, "Team Member" when the member has no
   * usable name, or null when the change came from no identifiable person. */
  author: string | null;
  createdAt: string;
}

export interface TargetActivityPage {
  available: boolean;
  items: TargetActivityItem[];
  /** Pass back as the cursor to load the next (older) page; null at the end. */
  nextCursor: string | null;
}

const ACTIVITY_COLUMNS = "id, activity_type, body, metadata, actor, created_by_user_id, created_at, business_targets!inner(business_id)";

type RawActivity = { id: string; activity_type: TargetActivityType; body: string | null; metadata: { from?: string; to?: string } | null; actor: TargetActor | null; created_by_user_id: string | null; created_at: string };

const isStatus = (v: unknown): v is TargetStatus => typeof v === "string" && (TARGET_STATUSES as readonly string[]).includes(v);

export async function getTargetActivityPage(admin: SupabaseClient, businessId: string, targetId: string, before: ActivityCursor | null): Promise<TargetActivityPage> {
  const size = TARGET_ACTIVITY_PAGE_SIZE;
  if (!UUID.test(targetId)) return { available: true, items: [], nextCursor: null };
  let query = admin.from("business_target_activities").select(ACTIVITY_COLUMNS).eq("target_id", targetId).eq("business_targets.business_id", businessId);
  // Keyset: strictly older than the cursor — (created_at, id) < (at, id). Values are quoted for or().
  if (before) query = query.or(`created_at.lt."${before.at}",and(created_at.eq."${before.at}",id.lt.${before.id})`);
  const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(size + 1);
  if (error) {
    if (!isMissingActivityTable(error)) console.error("getTargetActivityPage failed:", error.message);
    return { available: false, items: [], nextCursor: null };
  }
  const rows = (data ?? []) as unknown as RawActivity[];
  const page = rows.slice(0, size);
  const names = await resolveActivityAuthors(admin, page.map((r) => r.created_by_user_id));
  const items = page.map((r): TargetActivityItem => ({
    id: r.id,
    type: r.activity_type,
    body: r.activity_type === "note" ? r.body : null,
    from: r.activity_type === "status_change" && isStatus(r.metadata?.from) ? r.metadata!.from : null,
    to: r.activity_type === "status_change" && isStatus(r.metadata?.to) ? r.metadata!.to : null,
    author: r.actor === "findmi" ? "Findmi" : r.created_by_user_id ? names.get(r.created_by_user_id) ?? "Team Member" : r.actor === "business" ? "Team Member" : null,
    createdAt: r.created_at,
  }));
  return { available: true, items, nextCursor: rows.length > size ? activityCursor(items[items.length - 1]) : null };
}

export function isMissingActivityTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST200" || /business_target_activities/.test(error.message ?? "");
}

/** Display names only (one batched read; an email-like name is never shown). */
async function resolveActivityAuthors(admin: SupabaseClient, userIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data } = await admin.from("profiles").select("id, display_name").in("id", ids);
  for (const row of (data ?? []) as { id: string; display_name: string | null }[]) {
    const name = safeAuthorName(row.display_name);
    if (name) map.set(row.id, name);
  }
  return map;
}

/** Add Note: a NEW Activity row — never replaces an earlier one. The Target
 * must be this Business's own. */
export async function addTargetNote(
  admin: SupabaseClient,
  businessId: string,
  targetId: string,
  body: unknown,
  by: { actor: TargetActor; userId: string | null }
): Promise<TargetResult> {
  if (!UUID.test(targetId)) return { ok: false, error: "That Target wasn’t found." };
  const checked = validateActivityNote(body);
  if (!checked.ok) return checked;
  const { data: own } = await admin.from("business_targets").select("id").eq("id", targetId).eq("business_id", businessId).maybeSingle();
  if (!own) return { ok: false, error: "That Target wasn’t found." };
  const { error } = await admin.from("business_target_activities").insert({ target_id: targetId, activity_type: "note", body: checked.value, actor: by.actor, created_by_user_id: by.userId });
  if (error) {
    if (isMissingActivityTable(error)) return { ok: false, error: "Activity isn’t available yet. Please try again soon." };
    console.error("addTargetNote failed:", error.message);
    return { ok: false, error: "Couldn’t add that note. Please try again." };
  }
  return { ok: true };
}
