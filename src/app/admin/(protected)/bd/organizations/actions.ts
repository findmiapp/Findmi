"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { getBdAdminClient } from "@/lib/admin/bd/client";
import { findOrganizationLinkedToBusiness } from "@/lib/admin/bd/organizations";
import { organizationWriteErrorMessage, validateOrganizationInput } from "@/lib/bd/domain";

export type OrganizationSaveResult = { error: string } | undefined;

const LIST_PATH = "/admin/bd/organizations";

function readOrganizationForm(formData: FormData) {
  return validateOrganizationInput({
    name: formData.get("name"),
    kind: formData.get("kind"),
    website: formData.get("website"),
    business_id: formData.get("business_id"),
    notes: formData.get("notes"),
  });
}

async function writeError(error: { code?: string; message?: string }, businessId: string | null, exceptId: string | null): Promise<string> {
  const linked = error.code === "23505" && businessId ? await findOrganizationLinkedToBusiness(businessId, exceptId) : null;
  return organizationWriteErrorMessage(error, linked?.name);
}

/** Private BD Organization create. Writes bd.organizations only — a linked
 * public Business is referenced by id, never created or modified. */
export async function createOrganization(formData: FormData): Promise<OrganizationSaveResult> {
  await requireAdmin();
  const parsed = readOrganizationForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  const bd = await getBdAdminClient();
  const { data, error } = await bd.from("organizations").insert(parsed.value).select("id").single();
  if (error || !data) return { error: await writeError(error ?? {}, parsed.value.business_id, null) };

  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}/${data.id}?saved=1`);
}

export async function updateOrganization(id: string, formData: FormData): Promise<OrganizationSaveResult> {
  await requireAdmin();
  const parsed = readOrganizationForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  const bd = await getBdAdminClient();
  const { data, error } = await bd.from("organizations").update(parsed.value).eq("id", id).select("id").maybeSingle();
  if (error) return { error: await writeError(error, parsed.value.business_id, id) };
  if (!data) return { error: "This Organization no longer exists." };

  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
  redirect(`${LIST_PATH}/${id}?saved=1`);
}

/** Archive — never a hard delete (Organizations are referenced by other
 * BD rows; archiving keeps them intact and restorable). */
export async function archiveOrganization(id: string) {
  await requireAdmin();
  const bd = await getBdAdminClient();
  const { error } = await bd.from("organizations").update({ archived_at: new Date().toISOString() }).eq("id", id).is("archived_at", null);
  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
  redirect(error ? `${LIST_PATH}/${id}?error=${encodeURIComponent("Could not archive this Organization.")}` : `${LIST_PATH}/${id}?archived=1`);
}

export async function restoreOrganization(id: string) {
  await requireAdmin();
  const bd = await getBdAdminClient();
  const { error } = await bd.from("organizations").update({ archived_at: null }).eq("id", id);
  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
  redirect(error ? `${LIST_PATH}/${id}?error=${encodeURIComponent("Could not restore this Organization.")}` : `${LIST_PATH}/${id}?restored=1`);
}
