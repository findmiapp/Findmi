"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminIdea, saveBusinessIntelligenceNote, setAdminIdeaStatus, updateAdminIdea } from "@/lib/brand-audit";
import { isIdeaStatus, type IdeaFormInput } from "@/lib/brand-audit-domain";
import { errorRedirectUrl, str } from "@/lib/admin/form-helpers";

// Admin → Opportunities → Ideas, and the Business Opportunity Intelligence
// note. Every function in lib/brand-audit.ts it calls runs requireAdmin()
// first (and the admin layout/middleware gate the route).

const LIST = "/admin/opportunities/ideas";

function readIdeaForm(fd: FormData): IdeaFormInput {
  return {
    title: str(fd, "title"),
    summary: str(fd, "summary"),
    details: str(fd, "details"),
    idea_type: str(fd, "idea_type"),
    status: str(fd, "status"),
    display_order: str(fd, "display_order"),
    audience: str(fd, "audience"),
    target_business_ids: fd.getAll("target_business_ids").filter((v): v is string => typeof v === "string"),
  };
}

export async function createIdea(formData: FormData) {
  const result = await createAdminIdea(readIdeaForm(formData));
  if (!result.ok) redirect(errorRedirectUrl(`${LIST}/new`, result.error));
  revalidatePath(LIST);
  redirect(`${LIST}/${result.id}?saved=1`);
}

export async function updateIdea(ideaId: string, formData: FormData) {
  const result = await updateAdminIdea(ideaId, readIdeaForm(formData));
  if (!result.ok) redirect(errorRedirectUrl(`${LIST}/${ideaId}`, result.error));
  revalidatePath(LIST);
  revalidatePath(`${LIST}/${ideaId}`);
  redirect(`${LIST}/${ideaId}?saved=1`);
}

export async function changeIdeaStatus(ideaId: string, status: string) {
  if (!isIdeaStatus(status)) redirect(errorRedirectUrl(`${LIST}/${ideaId}`, "That status isn’t available."));
  const result = await setAdminIdeaStatus(ideaId, status);
  if (!result.ok) redirect(errorRedirectUrl(`${LIST}/${ideaId}`, result.error));
  revalidatePath(LIST);
  revalidatePath(`${LIST}/${ideaId}`);
  redirect(`${LIST}/${ideaId}?saved=1`);
}

export async function saveIntelligenceNote(businessId: string, formData: FormData) {
  const back = `/admin/businesses/${businessId}?tab=intelligence`;
  const result = await saveBusinessIntelligenceNote(businessId, str(formData, "note") ?? "");
  if (!result.ok) redirect(`${back}&error=${encodeURIComponent(result.error)}`);
  revalidatePath(`/admin/businesses/${businessId}`);
  redirect(`${back}&note_saved=1`);
}
