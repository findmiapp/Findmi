import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccountEmail } from "./notifications/recipients";

// Pro Access Request Workflow V1 — shared read helpers for the
// business_pro_access_requests table (see the migration for schema/RLS/
// the approve_pro_access_request() RPC). Every export here takes an
// already-service-role `admin` client and does no authorization of its
// own, same convention as lib/business-dashboard.ts/lib/business-orders.ts
// — callers (the owner-facing page, the admin review page) are
// responsible for calling requireBusinessMember()/requireAdminSupabase()
// first.

export type ProAccessRequestStatus = "pending" | "approved" | "declined";

export interface ProAccessRequest {
  id: string;
  businessId: string;
  requestedByUserId: string;
  status: ProAccessRequestStatus;
  message: string | null;
  createdAt: string;
  reviewedAt: string | null;
  /** Admin-only annotation — callers rendering this to the requester/
   * business must never surface this field (see this pass's own report). */
  adminNote: string | null;
}

interface RawProAccessRequestRow {
  id: string;
  business_id: string;
  requested_by_user_id: string;
  status: ProAccessRequestStatus;
  message: string | null;
  created_at: string;
  reviewed_at: string | null;
  admin_note: string | null;
}

const COLUMNS = "id, business_id, requested_by_user_id, status, message, created_at, reviewed_at, admin_note";

function toProAccessRequest(row: RawProAccessRequestRow): ProAccessRequest {
  return {
    id: row.id,
    businessId: row.business_id,
    requestedByUserId: row.requested_by_user_id,
    status: row.status,
    message: row.message,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    adminNote: row.admin_note,
  };
}

/** The business's own most recent Pro access request, regardless of
 * status — the owner-facing page needs exactly this one row to decide
 * which state to render (no existing request / pending / approved /
 * declined). Null when this business has never submitted one. */
export async function getLatestProAccessRequest(admin: SupabaseClient, businessId: string): Promise<ProAccessRequest | null> {
  const { data } = await admin
    .from("business_pro_access_requests")
    .select(COLUMNS)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toProAccessRequest(data as RawProAccessRequestRow) : null;
}

export interface ProAccessRequestFilters {
  status?: ProAccessRequestStatus;
}

export interface AdminProAccessRequestRow extends ProAccessRequest {
  business: { id: string; name: string; slug: string | null } | null;
  /** The requester's real Supabase Auth account email (never the
   * business's own public contact email) — same resolution as
   * notifyClaimant() in admin/claims/actions.ts. */
  requesterEmail: string | null;
}

/** Admin list — every Pro access request, newest first, optionally
 * filtered by status. Mirrors getAdminClaims' own shape
 * (lib/admin/claim-queries.ts): a plain join on businesses for a display
 * name/slug, plus one resolve step per distinct requester for their real
 * account email. */
export async function getAdminProAccessRequests(
  admin: SupabaseClient,
  filters: ProAccessRequestFilters = {}
): Promise<AdminProAccessRequestRow[]> {
  let query = admin
    .from("business_pro_access_requests")
    .select(`${COLUMNS}, business:businesses(id, name, slug)`)
    .order("created_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);

  const { data } = await query;
  const rows = (data ?? []) as unknown as (RawProAccessRequestRow & {
    business: { id: string; name: string; slug: string | null } | { id: string; name: string; slug: string | null }[] | null;
  })[];

  const requesterIds = Array.from(new Set(rows.map((r) => r.requested_by_user_id)));
  const emailById = new Map<string, string | null>();
  await Promise.all(
    requesterIds.map(async (id) => {
      emailById.set(id, await getAccountEmail(admin, id));
    })
  );

  return rows.map((row) => {
    const businessRaw = row.business;
    const business = Array.isArray(businessRaw) ? (businessRaw[0] ?? null) : businessRaw;
    return {
      ...toProAccessRequest(row),
      business,
      requesterEmail: emailById.get(row.requested_by_user_id) ?? null,
    };
  });
}

/** Count of currently-pending requests — used only for the admin
 * Requests-hub badge (optional, additive; see /admin/requests/page.tsx). */
export async function getPendingProAccessRequestCount(admin: SupabaseClient): Promise<number> {
  const { count } = await admin
    .from("business_pro_access_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}
