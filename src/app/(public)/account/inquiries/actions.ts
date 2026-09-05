"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

function appendQuery(base: string, params: Record<string, string>): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${new URLSearchParams(params).toString()}`;
}

/** Native inquiry creation — the one write path a signed-in customer uses
 * to start a business/product conversation on FindMi (see
 * account/inquiries/new/page.tsx, the only caller). business_id is
 * resolved and re-validated server-side from the form's own hidden
 * fields against the real businesses/products tables (never trusted as
 * "this business has native inquiries enabled" without checking), and
 * user_id always comes from the authenticated session, never the client
 * — inquiries_insert_customer RLS also enforces that server-side as a
 * second layer. customer_name/email/phone are only ever set here if the
 * visitor explicitly typed them into the optional fields below — this
 * action never reads anything from their auth session's own email. */
export async function createNativeInquiry(formData: FormData) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const businessId = String(formData.get("business_id") ?? "").trim();
  const productId = String(formData.get("product_id") ?? "").trim() || null;
  const returnTo = appendQuery("/account/inquiries/new", {
    business: businessId,
    ...(productId ? { product: productId } : {}),
  });
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  if (!businessId) redirect(appendQuery("/account/inquiries", { error: "Missing business." }));

  const { data: business } = await supabase
    .from("businesses")
    .select("id, native_inquiries_enabled")
    .eq("id", businessId)
    .maybeSingle();
  if (!business || !(business as { native_inquiries_enabled: boolean }).native_inquiries_enabled) {
    redirect(appendQuery("/account/inquiries", { error: "This business isn't accepting FindMi inquiries." }));
  }

  if (productId) {
    const { data: product } = await supabase
      .from("products")
      .select("id, business_id")
      .eq("id", productId)
      .maybeSingle();
    if (!product || (product as { business_id: string }).business_id !== businessId) {
      redirect(appendQuery(returnTo, { error: "That product could not be found for this business." }));
    }
  }

  const message = String(formData.get("message") ?? "").trim();
  if (!message) redirect(appendQuery(returnTo, { error: "Enter a message." }));

  // User-provided contact fields — entirely optional, and clearly labeled
  // as such on the form itself. Never pre-filled from the auth session.
  const customerName = String(formData.get("customer_name") ?? "").trim() || null;
  const customerEmail = String(formData.get("customer_email") ?? "").trim() || null;
  const customerPhone = String(formData.get("customer_phone") ?? "").trim() || null;

  const { data: inquiry, error } = await supabase
    .from("inquiries")
    .insert({
      business_id: businessId,
      product_id: productId,
      user_id: user.id,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      message,
      status: "new",
      source: productId ? "findmi_product_native" : "findmi_business_native",
    })
    .select("id")
    .single();
  if (error || !inquiry) redirect(appendQuery(returnTo, { error: error?.message ?? "Couldn't send that inquiry." }));

  // The inquiry's own `message` field already carries the opening text
  // (kept for compatibility with the anonymous/legacy row shape), but the
  // thread itself needs a first row too so the detail page has something
  // to render as message #1 without special-casing "the original
  // inquiry" differently from every reply after it.
  await supabase.from("inquiry_messages").insert({
    inquiry_id: (inquiry as { id: string }).id,
    sender_type: "customer",
    sender_user_id: user.id,
    body: message,
  });

  revalidatePath("/account/inquiries");
  redirect(`/account/inquiries/${(inquiry as { id: string }).id}`);
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
