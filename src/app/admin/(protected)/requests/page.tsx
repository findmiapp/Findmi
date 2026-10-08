import type { Metadata } from "next";
import { getDashboardNeedsAttention } from "@/lib/admin/dashboard-queries";
import { getPendingMarketRequestGroups } from "@/lib/admin/market-requests";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getPendingProAccessRequestCount } from "@/lib/pro-access-requests";
import AdminSectionHub from "@/components/admin/shell/AdminSectionHub";

export const metadata: Metadata = { title: "Requests" };
export const dynamic = "force-dynamic";

/** Admin V2 — Requests hub. Badges are existing pending counts only. */
export default async function AdminRequestsPage() {
  const admin = getAdminSupabase();
  const [attention, marketRequestGroups, pendingProRequests] = await Promise.all([
    getDashboardNeedsAttention(),
    getPendingMarketRequestGroups(),
    admin ? getPendingProAccessRequestCount(admin) : Promise.resolve(0),
  ]);
  const badges: Record<string, { text: string; tone: "attention" }> = {};
  if (attention?.pendingClaims) badges["/admin/claims"] = { text: `${attention.pendingClaims} pending`, tone: "attention" };
  if (pendingProRequests > 0) badges["/admin/pro-requests"] = { text: `${pendingProRequests} pending`, tone: "attention" };
  if (marketRequestGroups.length > 0) {
    badges["/admin/market-requests"] = { text: `${marketRequestGroups.length} pending`, tone: "attention" };
  }
  return <AdminSectionHub section="requests" badges={badges} />;
}
