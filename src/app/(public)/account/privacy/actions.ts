"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { notifyAdmin } from "@/lib/notifications/adminNotify";

const PATH = "/account/privacy";
const TYPES = ["delete", "access", "correct", "other"] as const;
type RequestType = (typeof TYPES)[number];

/** Creates a tracked privacy request (status "received") for Findmi to
 * handle. Deletion is never performed here: Findmi reviews what must be
 * kept (for example order and payment records) and completes the request,
 * and the person sees the status on this page. */
export async function submitPrivacyRequest(formData: FormData) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${PATH}`);
  const type = String(formData.get("request_type") ?? "") as RequestType;
  if (!(TYPES as readonly string[]).includes(type)) redirect(`${PATH}?error=${encodeURIComponent("Choose a request type.")}`);
  const details = String(formData.get("details") ?? "").trim().slice(0, 4000) || null;
  if (type === "delete" && String(formData.get("confirm") ?? "").trim().toUpperCase() !== "DELETE") {
    redirect(`${PATH}?error=${encodeURIComponent('Type DELETE to confirm the deletion request.')}#delete`);
  }
  if ((type === "correct" || type === "other") && !details) redirect(`${PATH}?error=${encodeURIComponent("Tell Findmi what you need.")}#request`);

  const admin = getAdminSupabase();
  if (!admin) redirect(`${PATH}?error=${encodeURIComponent("Server isn't configured.")}`);
  const { data: open } = await admin!
    .from("privacy_requests")
    .select("id")
    .eq("user_id", user!.id)
    .eq("request_type", type)
    .in("status", ["received", "in_review"])
    .limit(1);
  if ((open ?? []).length > 0) redirect(`${PATH}?notice=${encodeURIComponent("You already have an open request of this type. Its status is shown below.")}`);

  const { error } = await admin!
    .from("privacy_requests")
    .insert({ user_id: user!.id, contact_email: user!.email ?? null, request_type: type, status: "received", details });
  if (error) redirect(`${PATH}?error=${encodeURIComponent("Couldn't send your request. Please try again.")}`);

  await notifyAdmin({
    subject: `Privacy request: ${type}`,
    heading: `New ${type === "delete" ? "account deletion" : type} request`,
    body: ["A signed-in account submitted a privacy request. Review it in Admin.", type === "delete" ? "Deletion is completed manually after checking what must be retained." : ""].filter(Boolean),
    actionLabel: "Review Request",
    actionUrl: "/admin/privacy-requests",
  });
  revalidatePath(PATH);
  redirect(`${PATH}?requested=${type}`);
}

/** Withdraws the person's own open request. */
export async function cancelPrivacyRequest(id: string) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${PATH}`);
  const admin = getAdminSupabase();
  if (!admin) redirect(PATH);
  await admin!
    .from("privacy_requests")
    .update({ status: "cancelled", resolved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user!.id)
    .eq("status", "received");
  revalidatePath(PATH);
  redirect(`${PATH}?cancelled=1`);
}
