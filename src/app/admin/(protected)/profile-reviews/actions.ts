"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { PUBLIC_FIELD_KEYS, readFieldStatusMap, type PublicFieldKey } from "@/lib/profile-visibility";

/** Admin Profile Approvals decisions. Approve → LIVE ON PROFILE; Hide →
 * NOT SHOWN ON PROFILE. Only the visibility state changes — the stored
 * link, contact detail, announcement or button is never edited or deleted. */

const PATH = "/admin/profile-reviews";
type Decision = "live" | "hidden";

function done(message: string): never {
  revalidatePath(PATH);
  revalidatePath("/admin");
  redirect(`${PATH}?result=${encodeURIComponent(message)}`);
}

export async function decideBusinessField(businessId: string, key: string, decision: Decision) {
  const admin = await requireAdminSupabase();
  if (!(PUBLIC_FIELD_KEYS as readonly string[]).includes(key)) done("That field isn't reviewable.");
  const { data, error } = await admin.from("businesses").select("slug, public_field_status").eq("id", businessId).maybeSingle();
  if (error || !data) done("Business not found.");
  const map = readFieldStatusMap((data as { public_field_status: unknown }).public_field_status);
  if (decision === "live") delete map[key as PublicFieldKey];
  else map[key as PublicFieldKey] = "hidden";
  const { error: updateError } = await admin.from("businesses").update({ public_field_status: map }).eq("id", businessId);
  if (updateError) done(`Couldn't save: ${updateError.message}`);
  const slug = (data as { slug: string | null }).slug;
  if (slug) revalidatePath(`/business/${slug}`);
  done(decision === "live" ? "Approved — now live on the profile." : "Hidden — not shown on the profile. Nothing was deleted.");
}

export async function decidePublicAction(actionId: string, decision: Decision) {
  const admin = await requireAdminSupabase();
  const { error } = await admin.from("entity_public_actions").update({ admin_status: decision }).eq("id", actionId);
  if (error) done(`Couldn't save: ${error.message}`);
  revalidatePath("/business/[slug]", "page");
  revalidatePath("/location/[slug]", "page");
  revalidatePath("/event/[slug]", "page");
  done(decision === "live" ? "Button approved — now live." : "Button hidden — not shown. Nothing was deleted.");
}
