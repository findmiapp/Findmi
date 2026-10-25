import "server-only";
// Server helpers for legal_acceptances (registry: ./documents.ts). Writes
// use the service-role client; the table is readable by its owner only
// and has no client write policy. Records hold who, which document and
// version, where, and when. Never an IP address, IP hash or user agent.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LEGAL_DOCUMENTS,
  documentsForContext,
  outstandingDocuments,
  type LegalAcceptanceContext,
  type LegalDocument,
  type LegalDocumentId,
} from "./documents";

export interface AcceptanceSubject {
  type: "business" | "event" | "location" | "order" | "opportunity" | "moment";
  id: string;
}

/** Records acceptance of every PUBLISHED document that applies in this
 * context. A no-op while none are published (Phase 2A), so callers can be
 * wired now without inventing requirements. Best-effort: never throws. */
export async function recordContextAcceptance(
  admin: SupabaseClient,
  userId: string,
  context: LegalAcceptanceContext,
  subject?: AcceptanceSubject
): Promise<void> {
  const docs = documentsForContext(context);
  if (docs.length === 0) return;
  try {
    await admin.from("legal_acceptances").insert(
      docs.map((d) => ({
        user_id: userId,
        document: d.id,
        version: d.currentVersion,
        context,
        subject_type: subject?.type ?? null,
        subject_id: subject?.id ?? null,
      }))
    );
  } catch {
    // An acceptance record failure never breaks the underlying action.
  }
}

/** Latest accepted version per document for one person. */
export async function getAcceptedVersions(client: SupabaseClient, userId: string): Promise<Partial<Record<LegalDocumentId, string>>> {
  try {
    const { data } = await client
      .from("legal_acceptances")
      .select("document, version, accepted_at")
      .eq("user_id", userId)
      .order("accepted_at", { ascending: false })
      .limit(200);
    const out: Partial<Record<LegalDocumentId, string>> = {};
    for (const row of (data ?? []) as { document: string; version: string }[]) {
      if (row.document in LEGAL_DOCUMENTS && !(row.document in out)) out[row.document as LegalDocumentId] = row.version;
    }
    return out;
  } catch {
    return {};
  }
}

/** Published documents this person still needs to accept in a context
 * (for a future reacceptance prompt). Empty in Phase 2A. */
export async function getOutstandingDocuments(client: SupabaseClient, userId: string, context: LegalAcceptanceContext): Promise<LegalDocument[]> {
  if (documentsForContext(context).length === 0) return [];
  return outstandingDocuments(context, await getAcceptedVersions(client, userId));
}
