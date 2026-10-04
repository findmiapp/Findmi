import type { Metadata } from "next";
import { getDashboardNeedsAttention } from "@/lib/admin/dashboard-queries";
import AdminSectionHub from "@/components/admin/shell/AdminSectionHub";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

/** Admin V2 — Activity hub. Badges are the existing review queues. */
export default async function AdminActivityPage() {
  const attention = await getDashboardNeedsAttention();
  const badges: Record<string, { text: string; tone: "attention" }> = {};
  const eventsPending = (attention?.pendingEventReviews ?? 0) + (attention?.pendingEventApplications ?? 0);
  if (eventsPending > 0) badges["/admin/events"] = { text: `${eventsPending} to review`, tone: "attention" };
  if (attention?.unreviewedAppearances) {
    badges["/admin/appearances"] = { text: `${attention.unreviewedAppearances} unreviewed`, tone: "attention" };
  }
  return <AdminSectionHub section="activity" badges={badges} />;
}
