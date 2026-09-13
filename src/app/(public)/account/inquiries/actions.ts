"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

function appendQuery(base: string, params: Record<string, string>): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${new URLSearchParams(params).toString()}`;
}

/** Product Inquiry Consolidation pass — RETIRED. This was the one write
 * path that ever created an `inquiries` row (see account/inquiries/new/
 * page.tsx, its only caller); that entry point's own UI link has been
 * removed from the Product page in favor of the canonical Conversation
 * flow (connect/actions.ts's submitProductInquiry). No new legacy
 * inquiry is created by this function anymore — it never reaches the
 * insert below — but the function itself, the `inquiries`/
 * `inquiry_messages` tables, and every existing row are left completely
 * untouched (nothing to preserve was ever written here in production —
 * confirmed live: both tables have zero rows). This redirect is the
 * actual guard against someone reaching a stale bookmark/URL for
 * /account/inquiries/new and creating a fresh legacy row after the
 * canonical path went live. */
export async function createNativeInquiry(formData: FormData) {
  const businessId = String(formData.get("business_id") ?? "").trim();
  const productId = String(formData.get("product_id") ?? "").trim() || null;
  redirect(
    appendQuery(businessId ? `/account/inquiries/new` : "/account/inquiries", {
      ...(businessId ? { business: businessId } : {}),
      ...(productId ? { product: productId } : {}),
      error: "This way of messaging a business has moved — use the Inquire button on the business or product page instead.",
    })
  );
}

export async function sendCustomerMessage(inquiryId: string, formData: FormData) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const detailPath = `/account/inquiries/${inquiryId}`;
  if (!user) redirect(`/login?next=${encodeURIComponent(detailPath)}`);

  const body = String(formData.get("body") ?? "").trim();
  if (!body) redirect(appendQuery(detailPath, { error: "Enter a message." }));

  // inquiry_messages_insert_customer RLS re-verifies this inquiry's
  // user_id actually matches auth.uid() — this .eq is defense in depth,
  // not the real authorization boundary.
  const { error } = await supabase.from("inquiry_messages").insert({
    inquiry_id: inquiryId,
    sender_type: "customer",
    sender_user_id: user.id,
    body,
  });
  if (error) redirect(appendQuery(detailPath, { error: error.message }));

  await supabase.rpc("mark_inquiry_read", { p_inquiry_id: inquiryId, p_as: "customer" });

  revalidatePath(detailPath);
  redirect(detailPath);
}
