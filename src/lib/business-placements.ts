import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SelectedLocationDetail } from "@/components/account/EventLocationField";
import {
  PLACEMENT_PAGE_SIZE,
  PLACEMENT_STATUSES,
  PLACEMENT_ACTIVITY_PAGE_SIZE,
  activityCursor,
  placementChanges,
  validateActivityNote,
  validateInternalNotes,
  validatePlacementUpdate,
  type PlacementFilter,
  type PlacementSource,
  type PlacementStatus,
  type PlacementUpdateInput,
  type ActivityCursor,
  type PlacementActivityType,
  type PlacementActor,
} from "./business-placements-domain";
import { safeAuthorName } from "./moment-author";
import { NEXT_PLACEMENT_READ_LIMIT, type NextPlacementInput } from "./business-next";

/** Placement Targets — server reads/writes over business_location_placements.
 * Service-role client only; EVERY function here performs NO authorization of its
 * own: the caller (placement-actions.ts / the Business Manager page) has already
 * authorized the session against THIS Business, and every query is scoped by
 * business_id so one Business can never read or touch another's rows.
 *
 * internal_notes is Findmi-only. The Business reads below select an explicit
 * column list that never includes it (BUSINESS_PLACEMENT_COLUMNS), and the
 * Business write builds its patch from validatePlacementUpdate, which has no
 * internal_notes key. Only the two admin* functions at the end touch it. */

export const BUSINESS_PLACEMENT_COLUMNS =
  "id, location_id, status, status_changed_at, notes, next_action, next_action_at, source, created_at, updated_at, locations!inner(id, name, slug, address, city, state, logo_url, cover_image_url, is_demo, archived_at, trashed_at)";

/** What a Business member may see about one of its own Placements. There is
 * deliberately no internal-notes field on this type. */
export interface BusinessPlacementItem {
  id: string;
  locationId: string;
  locationName: string;
  locationSlug: string;
  address: string | null;
  city: string | null;
  state: string | null;
  imageUrl: string | null;
  /** Known to Findmi but not a public Location yet (unlisted). */
  locationUnlisted: boolean;
  locationArchived: boolean;
  status: PlacementStatus;
  statusChangedAt: string;
  notes: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  source: PlacementSource;
  createdAt: string;
  updatedAt: string;
}

export type PlacementCounts = { all: number } & Record<PlacementStatus, number>;

export interface BusinessPlacementsPage {
  /** false until the placements migration is applied (the view then says so). */
  available: boolean;
  items: BusinessPlacementItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: PlacementCounts;
}

export type PlacementResult = { ok: true } | { ok: false; error: string };

export const ALREADY_OUR_LOCATION_TARGET_ERROR = "That’s one of your own Locations, so it can’t be a Target.";
const UNAVAILABLE_ERROR = "Targets aren’t available yet. Please try again soon.";

const emptyCounts = (): PlacementCounts => ({ all: 0, target: 0, in_conversation: 0, placement_pending: 0, active: 0, passed: 0 });

export function isMissingPlacementsTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /business_location_placements/.test(error.message ?? "");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawLoc = { id: string; name: string; slug: string; address: string | null; city: string | null; state: string | null; logo_url: string | null; cover_image_url: string | null; is_demo: boolean | null; archived_at: string | null; trashed_at: string | null };
type RawRow = {
  id: string;
  location_id: string;
  status: PlacementStatus;
  status_changed_at: string;
  notes: string | null;
  next_action: string | null;
  next_action_at: string | null;
  source: PlacementSource;
  created_at: string;
  updated_at: string;
  locations: RawLoc | RawLoc[] | null;
};

function toItem(r: RawRow): BusinessPlacementItem | null {
  const loc = Array.isArray(r.locations) ? r.locations[0] : r.locations;
  if (!loc) return null;
  return {
    id: r.id,
    locationId: loc.id,
    locationName: loc.name,
    locationSlug: loc.slug,
    address: loc.address,
    city: loc.city,
    state: loc.state,
    imageUrl: loc.cover_image_url ?? loc.logo_url ?? null,
    locationUnlisted: Boolean(loc.is_demo),
    locationArchived: Boolean(loc.archived_at || loc.trashed_at),
    status: r.status,
    statusChangedAt: r.status_changed_at,
    notes: r.notes,
    nextAction: r.next_action,
    nextActionAt: r.next_action_at,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Whole-pipeline totals for the status chips (independent of the filter). */
export async function getPlacementCounts(admin: SupabaseClient, businessId: string): Promise<PlacementCounts & { available: boolean }> {
  const head = (status?: PlacementStatus) => {
    let q = admin.from("business_location_placements").select("id", { count: "exact", head: true }).eq("business_id", businessId);
    if (status) q = q.eq("status", status);
    return q;
  };
  const results = await Promise.all([head(), ...PLACEMENT_STATUSES.map((s) => head(s))]);
  if (results.some((r) => r.error)) return { available: false, ...emptyCounts() };
  const counts = emptyCounts();
  counts.all = results[0].count ?? 0;
  PLACEMENT_STATUSES.forEach((s, i) => (counts[s] = results[i + 1].count ?? 0));
  return { available: true, ...counts };
}

/** Business Home → Next: this Business's open Targets (not Passed) that carry
 * a next step, soonest dated first. One bounded read — no Activity, no
 * internal notes, no other Business's rows. lib/business-next.ts orders them. */
export async function getNextPlacementActions(admin: SupabaseClient, businessId: string, limit = NEXT_PLACEMENT_READ_LIMIT): Promise<NextPlacementInput[]> {
  const { data, error } = await admin
    .from("business_location_placements")
    .select("location_id, status, next_action, next_action_at, locations!inner(name)")
    .eq("business_id", businessId)
    .neq("status", "passed")
    .or("next_action.not.is.null,next_action_at.not.is.null")
    .order("next_action_at", { ascending: true, nullsFirst: false })
    .order("id")
    .limit(limit);
  if (error || !data) return [];
  return (data as unknown as { location_id: string; status: PlacementStatus; next_action: string | null; next_action_at: string | null; locations: { name: string } | { name: string }[] | null }[]).map((r) => ({
    locationId: r.location_id,
    locationName: (Array.isArray(r.locations) ? r.locations[0] : r.locations)?.name ?? "A Target",
    status: r.status,
    nextAction: r.next_action,
    nextActionAt: r.next_action_at,
  }));
}

/** Growth's one-line Targets status: how many Targets exist and how many are
 * still being pursued (not Passed). Two head counts — never a row read. */
export async function getPlacementPursuit(admin: SupabaseClient, businessId: string): Promise<{ total: number; pursuing: number }> {
  const base = () => admin.from("business_location_placements").select("id", { count: "exact", head: true }).eq("business_id", businessId);
  const [all, passed] = await Promise.all([base(), base().eq("status", "passed")]);
  if (all.error || passed.error) return { total: 0, pursuing: 0 };
  const total = all.count ?? 0;
  return { total, pursuing: Math.max(0, total - (passed.count ?? 0)) };
}

/** One page of this Business's Targets, filtered and searched in the database.
 * Soonest Next Action first (undated last), then most recently changed. */
export async function getBusinessPlacementsPage(admin: SupabaseClient, businessId: string, filter: PlacementFilter, page: number): Promise<BusinessPlacementsPage> {
  const size = PLACEMENT_PAGE_SIZE;
  const pageNo = Math.max(1, Math.floor(page) || 1);
  const from = (pageNo - 1) * size;
  let query = admin.from("business_location_placements").select(BUSINESS_PLACEMENT_COLUMNS, { count: "exact" }).eq("business_id", businessId);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.q) query = query.or(`name.ilike.%${filter.q}%,city.ilike.%${filter.q}%,address.ilike.%${filter.q}%`, { referencedTable: "locations" });
  const [{ data, error, count }, counts] = await Promise.all([
    query.order("next_action_at", { ascending: true, nullsFirst: false }).order("updated_at", { ascending: false }).order("id").range(from, from + size - 1),
    getPlacementCounts(admin, businessId),
  ]);
  if (error || !counts.available) {
    if (error && !isMissingPlacementsTable(error)) console.error("getBusinessPlacementsPage failed:", error.message);
    return { available: false, items: [], total: 0, page: 1, pageSize: size, counts: emptyCounts() };
  }
  const items = ((data ?? []) as unknown as RawRow[]).map(toItem).filter((i): i is BusinessPlacementItem => Boolean(i));
  const tallies = emptyCounts();
  for (const k of Object.keys(tallies) as (keyof PlacementCounts)[]) tallies[k] = counts[k];
  return { available: true, items, total: count ?? items.length, page: pageNo, pageSize: size, counts: tallies };
}

/** One of this Business's own Placements (null when missing or another Business's). */
export async function getBusinessPlacement(admin: SupabaseClient, businessId: string, placementId: string): Promise<BusinessPlacementItem | null> {
  if (!UUID.test(placementId)) return null;
  const { data, error } = await admin.from("business_location_placements").select(BUSINESS_PLACEMENT_COLUMNS).eq("id", placementId).eq("business_id", businessId).maybeSingle();
  if (error || !data) return null;
  return toItem(data as unknown as RawRow);
}

/** This Business's Placement at ONE place, or null (the pair is unique). */
export async function getBusinessPlacementByLocation(admin: SupabaseClient, businessId: string, locationId: string): Promise<BusinessPlacementItem | null> {
  if (!UUID.test(locationId)) return null;
  const { data, error } = await admin.from("business_location_placements").select(BUSINESS_PLACEMENT_COLUMNS).eq("business_id", businessId).eq("location_id", locationId).maybeSingle();
  if (error || !data) return null;
  return toItem(data as unknown as RawRow);
}

/** Add a canonical Location as a Target. Never duplicates: when this Business
 * already has a Placement for the Location (any status, Passed included) the
 * existing one is returned so the caller can open — and if needed reopen — it.
 * Refused for one of the Business's own Locations (Our Locations) and for an
 * archived/trashed or missing Location. */
export async function addBusinessPlacement(
  admin: SupabaseClient,
  businessId: string,
  input: { locationId: string; source: PlacementSource; userId: string | null }
): Promise<{ ok: true; id: string; existing: boolean; status: PlacementStatus } | { ok: false; error: string }> {
  if (!UUID.test(input.locationId)) return { ok: false, error: "Choose a place first." };

  const existingRow = async () => {
    const { data, error } = await admin.from("business_location_placements").select("id, status").eq("business_id", businessId).eq("location_id", input.locationId).maybeSingle();
    return { row: data as { id: string; status: PlacementStatus } | null, error };
  };
  const found = await existingRow();
  if (found.error) return { ok: false, error: isMissingPlacementsTable(found.error) ? UNAVAILABLE_ERROR : "Couldn’t add that Target. Please try again." };
  if (found.row) return { ok: true, id: found.row.id, existing: true, status: found.row.status };

  const { data: operated } = await admin.from("business_locations").select("id").eq("business_id", businessId).eq("location_id", input.locationId).maybeSingle();
  if (operated) return { ok: false, error: ALREADY_OUR_LOCATION_TARGET_ERROR };

  const { data: location } = await admin.from("locations").select("id, archived_at, trashed_at").eq("id", input.locationId).maybeSingle();
  const loc = location as { id: string; archived_at: string | null; trashed_at: string | null } | null;
  if (!loc || loc.archived_at || loc.trashed_at) return { ok: false, error: "That place isn’t available on Findmi." };

  const { data: inserted, error } = await admin
    .from("business_location_placements")
    .insert({ business_id: businessId, location_id: input.locationId, status: "target", source: input.source, created_by_user_id: input.userId })
    .select("id, status")
    .single();
  if (error || !inserted) {
    // A concurrent add of the same place: the unique (business, location) key held.
    if (error?.code === "23505") {
      const again = await existingRow();
      if (again.row) return { ok: true, id: again.row.id, existing: true, status: again.row.status };
    }
    if (error && isMissingPlacementsTable(error)) return { ok: false, error: UNAVAILABLE_ERROR };
    console.error("addBusinessPlacement failed:", error?.message);
    return { ok: false, error: "Couldn’t add that Target. Please try again." };
  }
  const row = inserted as { id: string; status: PlacementStatus };
  return { ok: true, id: row.id, existing: false, status: row.status };
}

/** A Business edit: status, Summary / Context (`notes`), Next Action and its
 * date — nothing else. Reopening a Passed target is this same call with status
 * 'target'. When the status changes, the actor rides along in the SAME update
 * (status_actor / status_actor_user_id) and the database trigger records the
 * status_change Activity, keeps status_changed_at in step and clears the actor
 * columns — so status and its Activity can never disagree. */
export async function updateBusinessPlacement(
  admin: SupabaseClient,
  businessId: string,
  placementId: string,
  input: PlacementUpdateInput,
  by: { actor: PlacementActor; userId: string | null }
): Promise<PlacementResult & { changed?: boolean }> {
  if (!UUID.test(placementId)) return { ok: false, error: "That Target wasn’t found." };
  const checked = validatePlacementUpdate(input);
  if (!checked.ok) return checked;
  const { data, error } = await admin
    .from("business_location_placements")
    .select("id, status, notes, next_action, next_action_at")
    .eq("id", placementId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) return { ok: false, error: isMissingPlacementsTable(error) ? UNAVAILABLE_ERROR : "Couldn’t load that Target." };
  const current = data as { id: string; status: PlacementStatus; notes: string | null; next_action: string | null; next_action_at: string | null } | null;
  if (!current) return { ok: false, error: "That Target wasn’t found." };
  const patch = placementChanges(current, checked.value);
  if (Object.keys(patch).length === 0) return { ok: true, changed: false };
  const write = "status" in patch ? { ...patch, status_actor: by.actor, status_actor_user_id: by.userId } : patch;
  let { error: updateError } = await admin.from("business_location_placements").update(write).eq("id", placementId).eq("business_id", businessId);
  // Before the Activity migration the actor columns don't exist yet: save the change without them.
  if (updateError && write !== patch && (updateError.code === "42703" || updateError.code === "PGRST204")) {
    ({ error: updateError } = await admin.from("business_location_placements").update(patch).eq("id", placementId).eq("business_id", businessId));
  }
  if (updateError) {
    console.error("updateBusinessPlacement failed:", updateError.message);
    return { ok: false, error: "Couldn’t save that. Please try again." };
  }
  return { ok: true, changed: true };
}

/** Places a Target can point at: every LINKABLE canonical Location — published
 * and known-but-not-yet-public (unlisted) alike, never archived/trashed. The
 * same scope as the shared place picker (/api/account/search scope=place), read
 * through the Business-authorized action so a founder Admin session works too. */
export async function searchTargetLocations(admin: SupabaseClient, query: string): Promise<SelectedLocationDetail[]> {
  const q = query.replace(/[%,()*\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  let read = admin
    .from("locations")
    .select("id, name, slug, address, city, state, postal_code, is_demo, category:categories(name)")
    .is("archived_at", null)
    .is("trashed_at", null);
  if (q) read = read.or(`name.ilike.%${q}%,city.ilike.%${q}%,address.ilike.%${q}%`);
  const { data } = await read.order("name").limit(20);
  type Row = { id: string; name: string; slug: string; address: string | null; city: string | null; state: string | null; postal_code: string | null; is_demo: boolean | null; category: { name: string } | { name: string }[] | null };
  return ((data ?? []) as unknown as Row[]).map((l) => {
    const category = Array.isArray(l.category) ? l.category[0] ?? null : l.category;
    return { id: l.id, name: l.name, slug: l.slug, category: category?.name ?? null, address: l.address, city: l.city, state: l.state, postal_code: l.postal_code, is_public: !l.is_demo };
  });
}

// ── Findmi-only ───────────────────────────────────────────────────────────
// The caller must have verified a founder Admin session (isAdminSession) —
// never mere Business membership.

export async function adminGetPlacementInternalNotes(admin: SupabaseClient, businessId: string, placementId: string): Promise<string | null> {
  if (!UUID.test(placementId)) return null;
  const { data } = await admin.from("business_location_placements").select("internal_notes").eq("id", placementId).eq("business_id", businessId).maybeSingle();
  return (data as { internal_notes: string | null } | null)?.internal_notes ?? null;
}

export async function adminSetPlacementInternalNotes(admin: SupabaseClient, businessId: string, placementId: string, notes: unknown): Promise<PlacementResult> {
  if (!UUID.test(placementId)) return { ok: false, error: "That Target wasn’t found." };
  const checked = validateInternalNotes(notes);
  if (!checked.ok) return checked;
  const { data, error } = await admin
    .from("business_location_placements")
    .update({ internal_notes: checked.value })
    .eq("id", placementId)
    .eq("business_id", businessId)
    .select("id");
  if (error) return { ok: false, error: "Couldn’t save that. Please try again." };
  if (((data ?? []) as unknown[]).length === 0) return { ok: false, error: "That Target wasn’t found." };
  return { ok: true };
}

// ── Activity ──────────────────────────────────────────────────────────────
// Append-only history of one Placement. Read only for an OPENED Target (never by
// the list), one bounded page at a time, scoped through the Placement to THIS
// Business. Authors resolve to profile display names in one batched read — never
// an email or a user id leaves this module.

export interface PlacementActivityItem {
  id: string;
  type: PlacementActivityType;
  /** The note text (notes only). */
  body: string | null;
  /** Status change: from → to (status_change only). */
  from: PlacementStatus | null;
  to: PlacementStatus | null;
  /** "Findmi", a member's display name, "Team Member" when the member has no
   * usable name, or null when the change came from no identifiable person. */
  author: string | null;
  createdAt: string;
}

export interface PlacementActivityPage {
  available: boolean;
  items: PlacementActivityItem[];
  /** Pass back as the cursor to load the next (older) page; null at the end. */
  nextCursor: string | null;
}

const ACTIVITY_COLUMNS = "id, activity_type, body, metadata, actor, created_by_user_id, created_at, business_location_placements!inner(business_id)";

type RawActivity = { id: string; activity_type: PlacementActivityType; body: string | null; metadata: { from?: string; to?: string } | null; actor: PlacementActor | null; created_by_user_id: string | null; created_at: string };

const isStatus = (v: unknown): v is PlacementStatus => typeof v === "string" && (PLACEMENT_STATUSES as readonly string[]).includes(v);

export async function getPlacementActivityPage(admin: SupabaseClient, businessId: string, placementId: string, before: ActivityCursor | null): Promise<PlacementActivityPage> {
  const size = PLACEMENT_ACTIVITY_PAGE_SIZE;
  if (!UUID.test(placementId)) return { available: true, items: [], nextCursor: null };
  let query = admin
    .from("business_location_placement_activities")
    .select(ACTIVITY_COLUMNS)
    .eq("placement_id", placementId)
    .eq("business_location_placements.business_id", businessId);
  // Keyset: strictly older than the cursor — (created_at, id) < (at, id). Values are quoted for or().
  if (before) query = query.or(`created_at.lt."${before.at}",and(created_at.eq."${before.at}",id.lt.${before.id})`);
  const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(size + 1);
  if (error) {
    if (!isMissingActivityTable(error)) console.error("getPlacementActivityPage failed:", error.message);
    return { available: false, items: [], nextCursor: null };
  }
  const rows = (data ?? []) as unknown as RawActivity[];
  const page = rows.slice(0, size);
  const names = await resolveActivityAuthors(admin, page.map((r) => r.created_by_user_id));
  const items = page.map((r): PlacementActivityItem => ({
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
  return error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST200" || /business_location_placement_activities/.test(error.message ?? "");
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

/** Add Note: a NEW Activity row — never replaces an earlier one. The Placement
 * must be this Business's own. */
export async function addPlacementNote(
  admin: SupabaseClient,
  businessId: string,
  placementId: string,
  body: unknown,
  by: { actor: PlacementActor; userId: string | null }
): Promise<PlacementResult> {
  if (!UUID.test(placementId)) return { ok: false, error: "That Target wasn’t found." };
  const checked = validateActivityNote(body);
  if (!checked.ok) return checked;
  const { data: own } = await admin.from("business_location_placements").select("id").eq("id", placementId).eq("business_id", businessId).maybeSingle();
  if (!own) return { ok: false, error: "That Target wasn’t found." };
  const { error } = await admin
    .from("business_location_placement_activities")
    .insert({ placement_id: placementId, activity_type: "note", body: checked.value, actor: by.actor, created_by_user_id: by.userId });
  if (error) {
    if (isMissingActivityTable(error)) return { ok: false, error: "Activity isn’t available yet. Please try again soon." };
    console.error("addPlacementNote failed:", error.message);
    return { ok: false, error: "Couldn’t add that note. Please try again." };
  }
  return { ok: true };
}
