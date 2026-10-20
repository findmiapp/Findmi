import type { Metadata } from "next";
import AdminSectionHub from "@/components/admin/shell/AdminSectionHub";
import { IMPORT_TOOLS } from "@/components/admin/adminNavItems";

export const metadata: Metadata = { title: "Import" };

/** Import hub — one place for the existing import/convert tools. Each tool
 * keeps its own route; this page only indexes them. */
export default function AdminImportPage() {
  return (
    <AdminSectionHub
      section="activity"
      override={{
        title: "Import",
        description: "Bring in Events, Locations, Brands and Appearances, or turn Appearances into Events.",
        groups: [{ items: IMPORT_TOOLS }],
      }}
    />
  );
}
