"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { getBdAdminClient } from "@/lib/admin/bd/client";
import { getContact } from "@/lib/admin/bd/contacts";
import { getOrganization } from "@/lib/admin/bd/organizations";
import { contactWriteErrorMessage, validateContactInput } from "@/lib/bd/domain";

export type ContactSaveResult = { error: string } | undefined;

const LIST_PATH = "/admin/bd/contacts";
const ORG_PATH = "/admin/bd/organizations";

function readContactForm(formData: FormData) {
  return validateContactInput({
    name: formData.get("name"),
    organization_id: formData.get("organization_id"),
    title: formData.get("title"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    notes: formData.get("notes"),
  });
}

/** The chosen Organization must exist and — unless the Contact already
 * belongs to it (an existing link is preserved honestly) — be active. */
async function organizationAssignmentError(organizationId: string | null, currentOrganizationId: string | null): Promise<string | null> {
  if (!organizationId) return null;
  const organization = await getOrganization(organizationId);
  if (!organization) return "That Organization no longer exists. Choose another or leave it empty.";
  if (organization.archived_at && organizationId !== currentOrganizationId) {
    return `“${organization.name}” is archived. Restore it first, or choose another Organization.`;
  }
  return null;
}

function revalidateContact(id: string, organizationIds: (string | null)[]) {
  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
  for (const orgId of new Set(organizationIds)) if (orgId) revalidatePath(`${ORG_PATH}/${orgId}`);
}

/** Private BD Contact create. Writes bd.contacts only — the Organization
 * is referenced by id and never modified. */
export async function createContact(formData: FormData): Promise<ContactSaveResult> {
  await requireAdmin();
  const parsed = readContactForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  const orgError = await organizationAssignmentError(parsed.value.organization_id, null);
  if (orgError) return { error: orgError };

  const bd = await getBdAdminClient();
  const { data, error } = await bd.from("contacts").insert(parsed.value).select("id").single();
  if (error || !data) return { error: contactWriteErrorMessage(error) };

  revalidateContact(data.id, [parsed.value.organization_id]);
  redirect(`${LIST_PATH}/${data.id}?saved=1`);
}

/** Edit — including changing or removing the Organization (blank clears
 * organization_id). The Organization rows themselves are never written. */
export async function updateContact(id: string, formData: FormData): Promise<ContactSaveResult> {
  await requireAdmin();
  const parsed = readContactForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  const current = await getContact(id);
  if (!current) return { error: "This Contact no longer exists." };
  const orgError = await organizationAssignmentError(parsed.value.organization_id, current.organization_id);
  if (orgError) return { error: orgError };

  const bd = await getBdAdminClient();
  const { data, error } = await bd.from("contacts").update(parsed.value).eq("id", id).select("id").maybeSingle();
  if (error) return { error: contactWriteErrorMessage(error) };
  if (!data) return { error: "This Contact no longer exists." };

  revalidateContact(id, [current.organization_id, parsed.value.organization_id]);
  redirect(`${LIST_PATH}/${id}?saved=1`);
}

/** Archive — never a hard delete. */
export async function archiveContact(id: string) {
  await requireAdmin();
  const bd = await getBdAdminClient();
  const { data, error } = await bd
    .from("contacts")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .is("archived_at", null)
    .select("organization_id")
    .maybeSingle();
  revalidateContact(id, [data?.organization_id ?? null]);
  redirect(error ? `${LIST_PATH}/${id}?error=${encodeURIComponent("Could not archive this Contact.")}` : `${LIST_PATH}/${id}?archived=1`);
}

export async function restoreContact(id: string) {
  await requireAdmin();
  const bd = await getBdAdminClient();
  const { data, error } = await bd.from("contacts").update({ archived_at: null }).eq("id", id).select("organization_id").maybeSingle();
  revalidateContact(id, [data?.organization_id ?? null]);
  redirect(error ? `${LIST_PATH}/${id}?error=${encodeURIComponent("Could not restore this Contact.")}` : `${LIST_PATH}/${id}?restored=1`);
}
