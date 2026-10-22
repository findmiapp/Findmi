"use server";

import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { requireBusinessMember } from "@/lib/permissions";
import { isManagingRole } from "@/lib/business-locations";
import {
  cancelImport,
  commitBatch,
  getImportReview,
  matchBatch,
  setImportDecisions,
  stageImport,
  type CommitProgress,
  type DecisionInput,
  type ImportBatchSummary,
  type ImportCounts,
  type ImportResult,
  type ReviewRow,
} from "@/lib/locator-import/server";
import type { MatchStatus } from "@/lib/locator-import/match";

/** Import Locations — owner actions. Each call re-verifies, from the caller's
 * own session, that they may manage THIS Business (owner / manager / elevated
 * Admin); the batch id is only ever honoured for the Business it belongs to. */
async function authorize(businessId: string) {
  try {
    const membership = await requireBusinessMember(businessId);
    if (!(membership.viaAdmin || isManagingRole(membership.role))) return null;
  } catch {
    return null;
  }
  const admin = getAdminSupabase();
  if (!admin) return null;
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { admin, userId: user?.id ?? null };
}

const DENIED = { ok: false as const, error: "Only a Business owner or manager can import locations." };

export async function stageImportAction(businessId: string, input: { text: string; label: string | null; mapping: unknown }): Promise<ImportResult<{ batchId: string; counts: ImportCounts }>> {
  const ctx = await authorize(businessId);
  if (!ctx) return DENIED;
  return stageImport(ctx.admin, businessId, ctx.userId, { sourceId: "csv", text: typeof input.text === "string" ? input.text : "", label: input.label, mapping: input.mapping });
}

export async function matchImportAction(businessId: string, batchId: string): Promise<ImportResult<{ remaining: number; counts: ImportCounts }>> {
  const ctx = await authorize(businessId);
  if (!ctx) return DENIED;
  return matchBatch(ctx.admin, businessId, batchId);
}

export async function importReviewAction(
  businessId: string,
  batchId: string,
  bucket: MatchStatus,
  page: number
): Promise<ImportResult<{ batch: ImportBatchSummary; rows: ReviewRow[]; hasMore: boolean }>> {
  const ctx = await authorize(businessId);
  if (!ctx) return DENIED;
  return getImportReview(ctx.admin, businessId, batchId, bucket, page);
}

export async function importDecisionsAction(businessId: string, batchId: string, decisions: DecisionInput[]): Promise<ImportResult> {
  const ctx = await authorize(businessId);
  if (!ctx) return DENIED;
  return setImportDecisions(ctx.admin, businessId, batchId, Array.isArray(decisions) ? decisions : []);
}

export async function commitImportAction(businessId: string, batchId: string, options: { relationships: string[]; productIds: string[] }): Promise<ImportResult<CommitProgress>> {
  const ctx = await authorize(businessId);
  if (!ctx) return DENIED;
  const result = await commitBatch(ctx.admin, businessId, batchId, {
    defaultRelationships: Array.isArray(options?.relationships) ? options.relationships : [],
    productIds: Array.isArray(options?.productIds) ? options.productIds : [],
  });
  if (result.ok) revalidatePath(`/account/business/${businessId}`);
  return result;
}

export async function cancelImportAction(businessId: string, batchId: string): Promise<ImportResult> {
  const ctx = await authorize(businessId);
  if (!ctx) return DENIED;
  return cancelImport(ctx.admin, businessId, batchId);
}
