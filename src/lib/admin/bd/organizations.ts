import "server-only";
import { requireAdminSupabase } from "../requireAdminSupabase";
import { getBdAdminClient } from "./client";
import { ORGANIZATION_KIND_LABELS, sanitizeBdSearchTerm, type OrganizationKind } from "@/lib/bd/domain";

/** Bounded list — Admin convention; volumes are small at this stage. */
export const ORGANIZATION_LIST_LIMIT = 200;

const ORGANIZATION_COLUMNS = "id, name, kind, website, business_id, notes, archived_at, created_at, updated_at";

export interface BdOrganization {
  id: string;
  name: string;
  kind: OrganizationKind | null;
  website: string | null;
  business_id: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/** The public Findmi Business an Organization references — read-only. */
export interface LinkedBusiness {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  city: string | null;
  state: string | null;
}

export interface OrganizationListFilters {
  q?: string | null;
  kind?: OrganizationKind | null;
  /** false (default): active only; true: archived only. */
  archived?: boolean;
}

export async function listOrganizations(filters: OrganizationListFilters = {}): Promise<BdOrganization[]> {
  const bd = await getBdAdminClient();
  let query = bd.from("organizations").select(ORGANIZATION_COLUMNS).order("name").limit(ORGANIZATION_LIST_LIMIT);
  query = filters.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (filters.kind) query = query.eq("kind", filters.kind);
  const term = sanitizeBdSearchTerm(filters.q);
  if (term) query = query.or(`name.ilike.%${term}%,website.ilike.%${term}%`);
  const { data, error } = await query;
  if (error) throw new Error("Could not load Organizations.");
  return (data ?? []) as BdOrganization[];
}

export async function getOrganization(id: string): Promise<BdOrganization | null> {
  const bd = await getBdAdminClient();
  const { data, error } = await bd.from("organizations").select(ORGANIZATION_COLUMNS).eq("id", id).maybeSingle();
  if (error) return null;
  return (data as BdOrganization | null) ?? null;
}

/** The private Organization (other than `exceptId`) already linked to a
 * Business — used to name it in the duplicate-link error. */
export async function findOrganizationLinkedToBusiness(businessId: string, exceptId?: string | null): Promise<Pick<BdOrganization, "id" | "name"> | null> {
  const bd = await getBdAdminClient();
  let query = bd.from("organizations").select("id, name").eq("business_id", businessId);
  if (exceptId) query = query.neq("id", exceptId);
  const { data } = await query.limit(1).maybeSingle();
  return (data as Pick<BdOrganization, "id" | "name"> | null) ?? null;
}

/** Public Businesses for a set of Organizations, in ONE bounded read (no
 * N+1). PostgREST can't embed public.businesses through the bd schema, so
 * this is a separate, read-only query on the public schema. */
export async function getLinkedBusinesses(businessIds: (string | null)[]): Promise<Map<string, LinkedBusiness>> {
  const ids = [...new Set(businessIds.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, LinkedBusiness>();
  if (ids.length === 0) return map;
  const supabase = await requireAdminSupabase();
  const { data } = await supabase.from("businesses").select("id, name, slug, logo_url, city, state").in("id", ids);
  for (const b of (data ?? []) as LinkedBusiness[]) map.set(b.id, b);
  return map;
}

export interface OrganizationPickerResult {
  value: string;
  label: string;
  sublabel?: string;
  archived: boolean;
}

/** Private Organization picker search (Admin search route, entity
 * `bd_organizations`). Name only, sanitized term, at most 20 rows; returns
 * just what the picker renders — never notes, website or links. */
export async function searchOrganizationsForPicker(q: string): Promise<OrganizationPickerResult[]> {
  const term = sanitizeBdSearchTerm(q);
  if (!term) return [];
  const bd = await getBdAdminClient();
  const { data } = await bd.from("organizations").select("id, name, kind, archived_at").ilike("name", `%${term}%`).order("name").limit(20);
  type Row = Pick<BdOrganization, "id" | "name" | "kind" | "archived_at">;
  return ((data ?? []) as Row[]).map((o) => ({
    value: o.id,
    label: o.name,
    // Archived state rides on `archived` (the picker's badge), not the sublabel.
    sublabel: o.kind ? ORGANIZATION_KIND_LABELS[o.kind] : undefined,
    archived: Boolean(o.archived_at),
  }));
}
