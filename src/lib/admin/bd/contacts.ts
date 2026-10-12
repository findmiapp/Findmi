import "server-only";
import { getBdAdminClient } from "./client";
import { sanitizeBdSearchTerm } from "@/lib/bd/domain";

/** Bounded lists — the 3A Admin convention. */
export const CONTACT_LIST_LIMIT = 200;
export const ORGANIZATION_CONTACTS_LIMIT = 100;

// The Organization is embedded inside the bd schema (contacts →
// organizations FK), so a list needs no second query.
const CONTACT_COLUMNS =
  "id, name, organization_id, title, email, phone, notes, archived_at, created_at, updated_at, organization:organizations(id, name, archived_at)";

export interface ContactOrganization {
  id: string;
  name: string;
  archived_at: string | null;
}

export interface BdContact {
  id: string;
  name: string;
  organization_id: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  organization: ContactOrganization | null;
}

type Row = Omit<BdContact, "organization"> & { organization: ContactOrganization | ContactOrganization[] | null };
const toContact = (row: Row): BdContact => ({
  ...row,
  organization: Array.isArray(row.organization) ? (row.organization[0] ?? null) : row.organization,
});

export interface ContactListFilters {
  q?: string | null;
  organizationId?: string | null;
  /** false (default): active only; true: archived only. */
  archived?: boolean;
}

export async function listContacts(filters: ContactListFilters = {}): Promise<BdContact[]> {
  const bd = await getBdAdminClient();
  let query = bd.from("contacts").select(CONTACT_COLUMNS).order("name").limit(CONTACT_LIST_LIMIT);
  query = filters.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
  const term = sanitizeBdSearchTerm(filters.q);
  if (term) query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,title.ilike.%${term}%`);
  const { data, error } = await query;
  if (error) throw new Error("Could not load Contacts.");
  return ((data ?? []) as Row[]).map(toContact);
}

export async function getContact(id: string): Promise<BdContact | null> {
  const bd = await getBdAdminClient();
  const { data, error } = await bd.from("contacts").select(CONTACT_COLUMNS).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return toContact(data as Row);
}

/** An Organization's Contacts — active first, then archived, by name.
 * null when the read failed (shown as such, never as "no Contacts"). */
export async function listContactsForOrganization(organizationId: string): Promise<BdContact[] | null> {
  const bd = await getBdAdminClient();
  const { data, error } = await bd
    .from("contacts")
    .select(CONTACT_COLUMNS)
    .eq("organization_id", organizationId)
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("name")
    .limit(ORGANIZATION_CONTACTS_LIMIT);
  if (error) return null;
  return ((data ?? []) as Row[]).map(toContact);
}
