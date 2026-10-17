// Identity, Authorship & Entity Access V1 — what the Admin Ownership tab
// needs beyond the member list: pending/approved claims (for the shared
// management state and each manager's source) and the narrow access
// history. Service role; callers are Admin-gated pages only.
import { getAdminSupabase } from "./supabase-admin";
import { listAccessEvents, type AccessEventRow } from "../access-history";

export interface BusinessAccessOverview {
  pendingClaimCount: number;
  approvedClaimUserIds: Set<string>;
  /** Users granted access by an Admin assignment recorded in history. */
  adminAddedUserIds: Set<string>;
  history: AccessEventRow[];
}

export async function getBusinessAccessOverview(businessId: string): Promise<BusinessAccessOverview> {
  const empty: BusinessAccessOverview = { pendingClaimCount: 0, approvedClaimUserIds: new Set(), adminAddedUserIds: new Set(), history: [] };
  const admin = getAdminSupabase();
  if (!admin) return empty;
  const [{ data: claims }, history] = await Promise.all([
    admin.from("business_claim_requests").select("user_id, status").eq("business_id", businessId).in("status", ["pending", "approved"]),
    listAccessEvents(admin, "business", businessId),
  ]);
  const rows = (claims ?? []) as { user_id: string; status: string }[];
  return {
    pendingClaimCount: rows.filter((r) => r.status === "pending").length,
    approvedClaimUserIds: new Set(rows.filter((r) => r.status === "approved").map((r) => r.user_id)),
    adminAddedUserIds: new Set(history.filter((h) => h.action === "manager_added" && h.subject_user_id).map((h) => h.subject_user_id!)),
    history,
  };
}

export const ACCESS_EVENT_LABELS: Record<AccessEventRow["action"], string> = {
  claim_approved: "Claim Approved",
  manager_added: "Manager Added",
  manager_removed: "Manager Removed",
  role_changed: "Role Changed",
  owner_removed: "Owner Removed",
  ownership_transferred: "Ownership Transferred",
  all_managers_removed: "All Managers Removed",
  author_changed: "Moment Author Changed",
};
