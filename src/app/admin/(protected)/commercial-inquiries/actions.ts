"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { str } from "@/lib/admin/form-helpers";
import { sendFindmiMessage } from "@/lib/opportunities";
import { isInquiryStatus } from "@/lib/commercial-inquiries-domain";
import { ensureInquiryThread, getInquiryRow, recordInquiryReply, setInquiryOutcome } from "@/lib/commercial-inquiries";

/** Findmi's side of a Commercial Inquiry. requireAdmin() first, always; Findmi
 * writes AS "Findmi" (never an individual admin) and only into this Inquiry's
 * own thread. */

const detail = (id: string) => `/admin/commercial-inquiries/${id}`;

export async function adminInquiryReply(inquiryId: string, formData: FormData) {
  await requireAdmin();
  const back = detail(inquiryId);
  const body = str(formData, "body")?.slice(0, 4000);
  if (!body) redirect(`${back}?error=${encodeURIComponent("Write a message first.")}`);
  const admin = getAdminSupabase();
  const inquiry = admin ? await getInquiryRow(admin, inquiryId) : null;
  if (!admin || !inquiry) redirect(`${back}?error=${encodeURIComponent("Inquiry not found.")}`);
  const thread = await ensureInquiryThread(admin!, inquiry!);
  if (!thread) redirect(`${back}?error=${encodeURIComponent("Couldn't open this conversation. Please try again.")}`);
  await sendFindmiMessage(admin!, thread!.conversationId, body!);
  await recordInquiryReply(admin!, thread!.conversationId, { entityType: "findmi", entityId: null });
  revalidatePath(back);
  redirect(`${back}?sent=1`);
}

export async function adminInquiryOutcome(inquiryId: string, next: string) {
  await requireAdmin();
  const back = detail(inquiryId);
  const admin = getAdminSupabase();
  if (!admin || !isInquiryStatus(next)) redirect(`${back}?error=${encodeURIComponent("That isn't an Inquiry outcome.")}`);
  const result = await setInquiryOutcome(admin!, inquiryId, "findmi", next as Parameters<typeof setInquiryOutcome>[3]);
  if (!result.ok) redirect(`${back}?error=${encodeURIComponent(result.error)}`);
  revalidatePath(back);
  redirect(back);
}
