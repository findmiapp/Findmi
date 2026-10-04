import type { Metadata } from "next";
import { getDashboardCounts } from "@/lib/admin/queries";
import AdminSectionHub from "@/components/admin/shell/AdminSectionHub";

export const metadata: Metadata = { title: "Directory" };
export const dynamic = "force-dynamic";

/** Admin V2 — Directory hub (existing destinations only, see adminNavItems). */
export default async function AdminDirectoryPage() {
  const counts = await getDashboardCounts();
  const n = (v: number | undefined) => (v === undefined ? undefined : { text: v.toLocaleString() });
  const badges = Object.fromEntries(
    Object.entries({
      "/admin/businesses": n(counts?.businesses),
      "/admin/locations": n(counts?.locations),
      "/admin/products": n(counts?.products),
      "/admin/categories": n(counts?.categories),
    }).filter(([, v]) => v)
  ) as Record<string, { text: string }>;
  return <AdminSectionHub section="directory" badges={badges} />;
}
