import type { Metadata } from "next";
import { getDashboardNeedsAttention } from "@/lib/admin/dashboard-queries";
import { getPendingMarketRequestGroups } from "@/lib/admin/market-requests";
import AdminSectionHub from "@/components/admin/shell/AdminSectionHub";

export const metadata: Metadata = { title: "Requests" };
export const dynamic = "force-dynamic";

/** Admin V2 — Requests hub. Badges are existing pending counts only. */
export default async function AdminRequestsPage() {
  const [attention, marketRequestGroups] = await Promise.all([getDashboardNeedsAttention(), getPendingMarketRequestGroups()]);
  const badges: Record<string, { text: string; tone: "attention" }> = {};
  if (attention?.pendingClaims) badges["/admin/claims"] = { text: `${attention.pendingClaims} pending`, tone: "attention" };
  if (marketRequestGroups.length > 0) {
    badges["/admin/market-requests"] = { text: `${marketRequestGroups.length} pending`, tone: "attention" };
  }
  return <AdminSectionHub section="requests" badges={badges} />;
}
