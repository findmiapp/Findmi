import "server-only";
// Listing provenance (entity_provenance) and managed state. Service-role
// only: the table has no client access, and public pages only ever get the
// derived, non-sensitive summary from getPageTrust() (never a source URL,
// method, or who imported it).
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProvenanceEntityType = "business" | "event" | "location" | "business_image" | "event_image" | "location_image";
export type ProvenanceSourceKind = "organization" | "findmi" | "import" | "community";
export type MediaRightsBasis = "provided_by_organization" | "public_source" | "licensed" | "findmi_original" | "unknown";

export interface ProvenanceInput {
  entityType: ProvenanceEntityType;
  entityId: string;
  sourceKind: ProvenanceSourceKind;
  /** Short machine label, e.g. "owner_created", "event_url_import". */
  sourceMethod?: string | null;
  sourceUrl?: string | null;
  rightsBasis?: MediaRightsBasis | null;
}

/** Records where an entity came from. The FIRST record wins (a later edit
 * never rewrites origin). Best-effort: never throws, never blocks. */
export async function recordProvenance(admin: SupabaseClient | null, input: ProvenanceInput): Promise<void> {
  if (!admin) return;
  try {
    await admin.from("entity_provenance").upsert(
      {
        entity_type: input.entityType,
        entity_id: input.entityId,
        source_kind: input.sourceKind,
        source_method: input.sourceMethod ?? null,
        source_url: input.sourceUrl ? input.sourceUrl.slice(0, 2048) : null,
        rights_basis: input.rightsBasis ?? null,
      },
      { onConflict: "entity_type,entity_id", ignoreDuplicates: true }
    );
  } catch {
    // provenance is supporting metadata; never fail the real action
  }
}

/** Marks an entity as reviewed by Findmi (e.g. an admin publishing it). */
export async function markProvenanceReviewed(admin: SupabaseClient | null, entityType: ProvenanceEntityType, entityId: string): Promise<void> {
  if (!admin) return;
  try {
    await admin.from("entity_provenance").update({ last_reviewed_at: new Date().toISOString() }).eq("entity_type", entityType).eq("entity_id", entityId);
  } catch {
    // ignore
  }
}

export type PageTrustState = "managed" | "compiled_by_findmi" | "community_added" | "unclaimed";

export interface PageTrust {
  state: PageTrustState;
}

const MEMBER_TABLE: Record<"business" | "event" | "location", { table: string; column: string }> = {
  business: { table: "business_members", column: "business_id" },
  event: { table: "event_members", column: "event_id" },
  location: { table: "location_members", column: "location_id" },
};

/** The public "About This Page" state for a Business / Event / Location:
 *   managed             the organization manages this page on Findmi (it
 *                       has at least one manager; for an Event, also via a
 *                       managed host Business);
 *   compiled_by_findmi  unmanaged, created by Findmi or an importer;
 *   community_added     unmanaged, submitted by a member of the public;
 *   unclaimed           unmanaged, origin not recorded (pages created
 *                       before provenance existed).
 * Returns null when the server isn't configured. */
export async function getPageTrust(
  admin: SupabaseClient | null,
  entityType: "business" | "event" | "location",
  entityId: string,
  opts: { hostBusinessId?: string | null } = {}
): Promise<PageTrust | null> {
  if (!admin) return null;
  try {
    const spec = MEMBER_TABLE[entityType];
    const [members, provenance, hostMembers] = await Promise.all([
      admin.from(spec.table).select("id", { count: "exact", head: true }).eq(spec.column, entityId),
      admin.from("entity_provenance").select("source_kind").eq("entity_type", entityType).eq("entity_id", entityId).maybeSingle(),
      entityType === "event" && opts.hostBusinessId
        ? admin.from("business_members").select("id", { count: "exact", head: true }).eq("business_id", opts.hostBusinessId)
        : Promise.resolve({ count: 0 }),
    ]);
    if ((members.count ?? 0) > 0 || ((hostMembers as { count: number | null }).count ?? 0) > 0) return { state: "managed" };
    const kind = (provenance.data as { source_kind: ProvenanceSourceKind } | null)?.source_kind ?? null;
    if (kind === "findmi" || kind === "import") return { state: "compiled_by_findmi" };
    if (kind === "community") return { state: "community_added" };
    return { state: "unclaimed" };
  } catch {
    return null;
  }
}
