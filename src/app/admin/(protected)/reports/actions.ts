"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { recordAdminAudit } from "@/lib/admin/audit";
import { isReportResolution, isReportStatus } from "@/lib/reports-domain";

/** Updates one report's review state. Changing the reported content itself
 * happens in that content's own admin editor; resolving a report never
 * deletes or edits anything on its own. */
export async function updateReport(id: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const path = `/admin/reports/${id}`;
  const status = String(formData.get("status") ?? "");
  const resolutionRaw = String(formData.get("resolution") ?? "");
  const note = String(formData.get("admin_note") ?? "").trim().slice(0, 4000) || null;
  if (!isReportStatus(status)) redirect(`${path}?error=${encodeURIComponent("Choose a status.")}`);
  const closed = status === "resolved" || status === "dismissed";
  const resolution = closed && isReportResolution(resolutionRaw) ? resolutionRaw : null;
  if (status === "resolved" && !resolution) redirect(`${path}?error=${encodeURIComponent("Choose how it was resolved.")}`);

  const { error } = await supabase
    .from("content_reports")
    .update({ status, resolution, admin_note: note, resolved_at: closed ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) redirect(`${path}?error=${encodeURIComponent("Couldn't save. Please try again.")}`);
  await recordAdminAudit(supabase, { action: "report_status_changed", actor: { kind: "admin" }, targetType: "content_report", targetId: id, detail: { status, resolution } });
  revalidatePath("/admin/reports");
  redirect(`${path}?saved=1`);
}
