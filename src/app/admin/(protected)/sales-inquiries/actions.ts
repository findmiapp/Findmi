"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { errorRedirectUrl, str } from "@/lib/admin/form-helpers";

const QUEUE_PATH = "/admin/sales-inquiries";
const VALID_STATUSES = new Set(["new", "contacted", "qualified", "closed"]);

/** The one write this small admin surface needs — marking a lead's
 * status as the founder works it. Nothing else about a sales_inquiries
 * row is ever admin-editable (it's a submitted lead, not a founder-
 * authored record). */
export async function updateSalesInquiryStatus(formData: FormData) {
  const supabase = await requireAdminSupabase();

  const id = str(formData, "id");
  const status = str(formData, "status");
  if (!id || !status || !VALID_STATUSES.has(status)) {
    redirect(errorRedirectUrl(QUEUE_PATH, "Invalid status update."));
  }

  const { error } = await supabase.from("sales_inquiries").update({ status }).eq("id", id!);
  if (error) redirect(errorRedirectUrl(QUEUE_PATH, error.message));

  revalidatePath(QUEUE_PATH);
  redirect(QUEUE_PATH);
}
