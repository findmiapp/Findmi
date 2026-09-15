"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, errorRedirectUrl, str } from "@/lib/admin/form-helpers";
import { generateQrCode, isSafeQrDestinationPath } from "@/lib/analytics/qrCode";
import { isUuid } from "@/lib/analytics/taxonomy";

const LIST_PATH = "/admin/qr-campaigns";

// Plain uuid text fields — the smallest creation mechanism consistent
// with this pass's scope lock ("NOT a polished QR management UI"). A
// future pass can upgrade these to RelationPicker once campaign volume
// justifies it (CLAUDE.md's own "once an entity count can plausibly grow
// past a screenful" threshold), same evolution homepage_rows curation
// went through.
function optionalId(formData: FormData, key: string): string | null {
  const value = str(formData, key);
  return value && isUuid(value) ? value : null;
}

export async function createQrCampaign(formData: FormData) {
  const supabase = await requireAdminSupabase();

  const name = str(formData, "name");
  const destinationPath = str(formData, "destination_path");
  if (!name || !destinationPath || !isSafeQrDestinationPath(destinationPath)) {
    redirect(errorRedirectUrl(LIST_PATH, "Enter a name and a valid internal destination path (e.g. /business/your-slug)."));
  }

  const fields = {
    name,
    business_id: optionalId(formData, "business_id"),
    event_id: optionalId(formData, "event_id"),
    event_occurrence_id: optionalId(formData, "event_occurrence_id"),
    appearance_id: optionalId(formData, "appearance_id"),
    location_id: optionalId(formData, "location_id"),
    product_id: optionalId(formData, "product_id"),
    destination_path: destinationPath,
    placement: str(formData, "placement"),
    campaign_label: str(formData, "campaign_label"),
    is_active: true,
  };

  // Collision odds against a 72-bit random code are negligible — this
  // loop is a formality (bounded so a persistent unique-constraint error
  // for some OTHER reason can't spin forever), not a real contention path.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateQrCode();
    const { error } = await supabase.from("qr_campaigns").insert({ ...fields, code });
    if (!error) {
      revalidatePath(LIST_PATH);
      redirect(`${LIST_PATH}?saved=created`);
    }
    if (error.code !== "23505") {
      // Not a unique-violation — a real problem, not a code collision.
      redirect(errorRedirectUrl(LIST_PATH, error.message));
    }
  }
  redirect(errorRedirectUrl(LIST_PATH, "Could not generate a unique code — please try again."));
}

export async function setQrCampaignActive(id: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const isActive = bool(formData, "is_active");
  await supabase.from("qr_campaigns").update({ is_active: isActive, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath(LIST_PATH);
  redirect(LIST_PATH);
}
