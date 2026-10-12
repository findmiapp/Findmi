// Business Development (private, Admin-only) — the ONE canonical
// representation of the bd schema's constrained values, plus the pure
// validation the Admin forms run before a write. Client-safe: no data
// access and no secrets live here (private BD data is only ever read
// through src/lib/admin/bd/client.ts). Every value list below mirrors a
// CHECK constraint in supabase/migrations/20261013000000_bd_foundation.sql
// exactly — tests/bd-admin.test.mjs parses the migration to keep them in
// lockstep.

export const ORGANIZATION_KINDS = ["brand", "agency", "venue", "vendor", "sponsor", "media", "partner", "other"] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

export const ORGANIZATION_KIND_LABELS: Record<OrganizationKind, string> = {
  brand: "Brand",
  agency: "Agency",
  venue: "Venue",
  vendor: "Vendor",
  sponsor: "Sponsor",
  media: "Media",
  partner: "Partner",
  other: "Other",
};

// Established by the foundation migration; no workflow uses these yet
// (Projects, Parties and Activities ship in later checkpoints).
export const PROJECT_STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "delivering", "completed", "lost", "on_hold"] as const;
export const PARTY_ROLES = ["client", "payer", "brand", "sponsor", "venue", "vendor", "partner", "operator"] as const;
export const ACTIVITY_KINDS = ["note", "meeting", "call", "email", "proposal", "other"] as const;

export function isOrganizationKind(value: unknown): value is OrganizationKind {
  return typeof value === "string" && (ORGANIZATION_KINDS as readonly string[]).includes(value);
}

/** Column limits from the migration's CHECK constraints. */
export const ORGANIZATION_LIMITS = { name: 200, website: 500, notes: 5000 } as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export interface OrganizationInput {
  name: string;
  kind: OrganizationKind | null;
  website: string | null;
  /** The optional public Findmi Business this private Organization
   * references. A reference only — never copied, synced or written. */
  business_id: string | null;
  notes: string | null;
}

export type OrganizationValidation = { ok: true; value: OrganizationInput } | { ok: false; error: string };

const clean = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Validates raw form values against the organizations table's constraints:
 * name required (1–200 after trimming), kind optional but one of the
 * allowed values, website ≤500, notes ≤5000, business_id optional uuid. */
export function validateOrganizationInput(raw: {
  name?: unknown;
  kind?: unknown;
  website?: unknown;
  business_id?: unknown;
  notes?: unknown;
}): OrganizationValidation {
  const name = clean(raw.name);
  if (!name) return { ok: false, error: "Name is required." };
  if (name.length > ORGANIZATION_LIMITS.name) return { ok: false, error: `Name must be ${ORGANIZATION_LIMITS.name} characters or fewer.` };

  const kindRaw = clean(raw.kind);
  if (kindRaw !== null && !isOrganizationKind(kindRaw)) return { ok: false, error: "Choose a valid kind." };

  const website = clean(raw.website);
  if (website && website.length > ORGANIZATION_LIMITS.website) {
    return { ok: false, error: `Website must be ${ORGANIZATION_LIMITS.website} characters or fewer.` };
  }

  const notes = clean(raw.notes);
  if (notes && notes.length > ORGANIZATION_LIMITS.notes) return { ok: false, error: `Notes must be ${ORGANIZATION_LIMITS.notes} characters or fewer.` };

  const businessId = clean(raw.business_id);
  if (businessId && !UUID_RE.test(businessId)) return { ok: false, error: "Choose a valid Findmi Business." };

  return { ok: true, value: { name, kind: kindRaw, website, business_id: businessId, notes } };
}

/** A search term safe to place inside a PostgREST filter: characters with
 * meaning in filter syntax (`,` `(` `)` `"` `\`) and LIKE wildcards are
 * dropped, whitespace collapsed, length bounded. Empty → null (no filter). */
export function sanitizeBdSearchTerm(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const term = input.replace(/[,()"\\%*_]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  return term || null;
}

/** Postgres error → an Admin-readable message for Organization writes.
 * Never echoes the raw database error for the cases we can name. */
export function organizationWriteErrorMessage(error: { code?: string; message?: string } | null | undefined, linkedOrganizationName?: string | null): string {
  if (!error) return "Could not save this Organization.";
  if (error.code === "23505" && (error.message ?? "").includes("organizations_business_id_key")) {
    return linkedOrganizationName
      ? `That Findmi Business is already linked to the private Organization “${linkedOrganizationName}”. Unlink it there first.`
      : "That Findmi Business is already linked to another private Organization. Unlink it there first.";
  }
  if (error.code === "23503") return "That Findmi Business no longer exists. Choose another or leave it unlinked.";
  if (error.code === "23514") return "One of the values isn't allowed. Check the name, kind, website and notes.";
  return "Could not save this Organization. Please try again.";
}

// ── Contacts (Checkpoint 3B) ─────────────────────────────────────────────

/** Column limits from bd.contacts' CHECK constraints. No email format
 * check exists in the schema, so none is invented here. */
export const CONTACT_LIMITS = { name: 200, title: 200, email: 320, phone: 50, notes: 5000 } as const;

export interface ContactInput {
  name: string;
  /** Optional private Organization (bd.organizations). */
  organization_id: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export type ContactValidation = { ok: true; value: ContactInput } | { ok: false; error: string };

/** Validates raw form values against bd.contacts: name required (1–200
 * after trimming); organization optional uuid; title ≤200, email ≤320,
 * phone ≤50, notes ≤5000 — all optional. */
export function validateContactInput(raw: {
  name?: unknown;
  organization_id?: unknown;
  title?: unknown;
  email?: unknown;
  phone?: unknown;
  notes?: unknown;
}): ContactValidation {
  const name = clean(raw.name);
  if (!name) return { ok: false, error: "Name is required." };
  if (name.length > CONTACT_LIMITS.name) return { ok: false, error: `Name must be ${CONTACT_LIMITS.name} characters or fewer.` };

  const organizationId = clean(raw.organization_id);
  if (organizationId && !UUID_RE.test(organizationId)) return { ok: false, error: "Choose a valid Organization." };

  const fields = { title: clean(raw.title), email: clean(raw.email), phone: clean(raw.phone), notes: clean(raw.notes) };
  const labels = { title: "Title", email: "Email", phone: "Phone", notes: "Notes" } as const;
  for (const key of ["title", "email", "phone", "notes"] as const) {
    const value = fields[key];
    if (value && value.length > CONTACT_LIMITS[key]) return { ok: false, error: `${labels[key]} must be ${CONTACT_LIMITS[key]} characters or fewer.` };
  }

  return { ok: true, value: { name, organization_id: organizationId, ...fields } };
}

/** Postgres error → an Admin-readable message for Contact writes. */
export function contactWriteErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  if (error?.code === "23503") return "That Organization no longer exists. Choose another or leave it empty.";
  if (error?.code === "23514") return "One of the values isn't allowed. Check the name, title, email, phone and notes.";
  return "Could not save this Contact. Please try again.";
}
