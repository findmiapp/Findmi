"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireBusinessMember } from "@/lib/permissions";
import type { FulfillmentStatus } from "@/lib/commerce/types";

const VALID_STATUSES: FulfillmentStatus[] = ["new", "confirmed", "ready", "fulfilled", "cancelled"];
const MAX_NOTE_LENGTH = 500;

function appendQuery(base: string, params: Record<string, string>): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${new URLSearchParams(params).toString()}`;
}

/** Business Manager Orders tab — the ONLY write path a business member has
 * onto order_items, and it only ever touches fulfillment_status and
 * internal_note (explicit allowlist below). requireBusinessMember(businessId)
 * re-derives real membership from the caller's own session first; the
 * admin-client update itself is then additionally filtered by
 * `.eq("business_id", businessId)` AND `.eq("id", orderItemId)` so even a
 * forged orderItemId belonging to another business updates zero rows
 * rather than someone else's item. Never touches orders.payment_status,
 * total_charged, fees, or customer identity — those columns simply aren't
 * in this update's payload. */
export async function updateOrderItemFulfillment(businessId: string, orderItemId: string, formData: FormData) {
  const orderId = String(formData.get("order_id") ?? "");
  const tabPath = appendQuery(`/account/business/${businessId}`, { tab: "orders", open: orderId });
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(tabPath)}`);

  try {
    await requireBusinessMember(businessId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to this business.";
    redirect(appendQuery(`/account/business/${businessId}`, { tab: "orders", error: message }));
  }

  const admin = getAdminSupabase();
  if (!admin) redirect(appendQuery(tabPath, { error: "Server isn't configured." }));

  const status = String(formData.get("fulfillment_status") ?? "");
  if (!VALID_STATUSES.includes(status as FulfillmentStatus)) {
    redirect(appendQuery(tabPath, { error: "Invalid status." }));
  }

  const rawNote = String(formData.get("internal_note") ?? "").trim();
  if (rawNote.length > MAX_NOTE_LENGTH) {
    redirect(appendQuery(tabPath, { error: `Note must be ${MAX_NOTE_LENGTH} characters or fewer.` }));
  }

  const { error } = await admin
    .from("order_items")
    .update({ fulfillment_status: status, internal_note: rawNote || null })
    .eq("id", orderItemId)
    .eq("business_id", businessId);
  if (error) redirect(appendQuery(tabPath, { error: error.message }));

  revalidatePath(`/account/business/${businessId}`);
  redirect(tabPath);
}
