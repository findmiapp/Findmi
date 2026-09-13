import { getAdminSupabase } from "./supabase-admin";
import type { SalesInquiry } from "../types";

// Multi-Region / National Sales Inquiry pass — admin reads only.
// sales_inquiries has RLS enabled with zero policies (service_role via
// getAdminSupabase() is the only reader) — same pattern
// referral-queries.ts/pro_invites already established. The one write
// this pass needs (marking a lead's status) goes through
// admin/sales-inquiries/actions.ts's requireAdminSupabase(), never here.

/** Newest first — a small, chronological lead queue, not a paginated
 * table; this pass doesn't need filtering/search (see the report on why
 * a bigger admin surface wasn't built). */
export async function getAdminSalesInquiries(): Promise<SalesInquiry[]> {
  const admin = getAdminSupabase();
  if (!admin) return [];
  const { data } = await admin.from("sales_inquiries").select("*").order("created_at", { ascending: false });
  return (data ?? []) as SalesInquiry[];
}
