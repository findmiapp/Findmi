"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { bool, errorRedirectUrl, str } from "@/lib/admin/form-helpers";
import type { FormEntityType, FormPurpose } from "@/lib/types";

export async function saveForm(id: string | null, formData: FormData) {
  const supabase = getAdminSupabase();
  const editPath = id ? `/admin/forms/${id}` : "/admin/forms/new";
  if (!supabase) redirect(errorRedirectUrl(editPath, "Server isn't configured for writes."));

  const name = str(formData, "name");
  const slug = str(formData, "slug");
  const purpose = str(formData, "purpose") as FormPurpose | null;
  const formUrl = str(formData, "form_url");
  if (!name || !slug || !purpose || !formUrl) {
    redirect(errorRedirectUrl(editPath, "Name, slug, purpose, and the Tally URL are all required."));
  }

  const isDefault = bool(formData, "is_default");

  const payload = {
    name,
    slug,
    purpose,
    form_url: formUrl,
    display_mode: str(formData, "display_mode") ?? "external",
    is_active: bool(formData, "is_active"),
    is_default: isDefault,
    updated_at: new Date().toISOString(),
  };

  let formId = id;
  if (formId) {
    // Only one default per purpose (DB-enforced via a partial unique
    // index) — clear any other form's default for this purpose first so
    // the upsert below can't collide with it.
    if (isDefault) {
      await supabase.from("forms").update({ is_default: false }).eq("purpose", purpose).neq("id", formId);
    }
    const { error } = await supabase.from("forms").update(payload).eq("id", formId);
    if (error) redirect(errorRedirectUrl(editPath, error.message));
  } else {
    if (isDefault) {
      await supabase.from("forms").update({ is_default: false }).eq("purpose", purpose);
    }
    const { data, error } = await supabase.from("forms").insert(payload).select("id").single();
    if (error || !data) redirect(errorRedirectUrl(editPath, error?.message ?? "Could not create form."));
    formId = data!.id;
  }

  revalidatePath("/admin/forms");
  revalidatePath(`/admin/forms/${formId}`);
  revalidatePath("/"); // resolved forms are read fresh per-request, but keep the ISR cache honest
  redirect(`/admin/forms/${formId}?saved=1`);
}

export async function deleteForm(id: string) {
  const supabase = getAdminSupabase();
  if (!supabase) redirect(errorRedirectUrl("/admin/forms", "Server isn't configured for writes."));
  await supabase.from("forms").delete().eq("id", id); // form_assignments cascade
  revalidatePath("/admin/forms");
  redirect("/admin/forms");
}

export async function addAssignment(formId: string, formData: FormData) {
  const supabase = getAdminSupabase();
  const editPath = `/admin/forms/${formId}`;
  if (!supabase) redirect(errorRedirectUrl(editPath, "Server isn't configured for writes."));

  const entityType = str(formData, "entity_type") as FormEntityType | null;
  const entityId = str(formData, "entity_id");
  const purpose = str(formData, "purpose") as FormPurpose | null;
  if (!entityType || !entityId || !purpose) {
    redirect(errorRedirectUrl(editPath, "Choose an entity type, a specific record, and a purpose."));
  }

  // One assignment per entity+purpose — upsert so reassigning a form to an
  // entity that already has an assignment for this purpose just repoints
  // it, rather than erroring on the unique constraint.
  const { error } = await supabase
    .from("form_assignments")
    .upsert(
      { form_id: formId, entity_type: entityType, entity_id: entityId, purpose },
      { onConflict: "entity_type,entity_id,purpose" }
    );
  if (error) redirect(errorRedirectUrl(editPath, error.message));

  revalidatePath(editPath);
  redirect(`${editPath}?saved=1`);
}

export async function removeAssignment(formId: string, assignmentId: string) {
  const supabase = getAdminSupabase();
  const editPath = `/admin/forms/${formId}`;
  if (!supabase) redirect(errorRedirectUrl(editPath, "Server isn't configured for writes."));
  await supabase.from("form_assignments").delete().eq("id", assignmentId);
  revalidatePath(editPath);
  redirect(editPath);
}
