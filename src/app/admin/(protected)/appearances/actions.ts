"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { bool, errorRedirectUrl, localDateTimeToIso, num, str } from "@/lib/admin/form-helpers";
import { validateCustomDestination } from "@/lib/navigation";

export async function saveAppearance(id: string | null, formData: FormData) {
  const supabase = getAdminSupabase();
  const editPath = id ? `/admin/appearances/${id}` : "/admin/appearances/new";
  if (!supabase) redirect(errorRedirectUrl(editPath, "Server isn't configured for writes."));

  const businessId = str(formData, "business_id");
  const title = str(formData, "title");
  const startLocal = str(formData, "start_at");
  if (!businessId || !title || !startLocal) {
    redirect(errorRedirectUrl(editPath, "Business, title, and start date/time are required."));
  }

  const eventId = str(formData, "event_id"); // "" means "no event" — the select's blank option

  // Same internal-path-or-https:// validation every other founder-entered
  // destination on the site uses (see businesses/actions.ts's bulletin_url)
  // — never a second, parallel URL-safety check.
  const externalUrlRaw = str(formData, "external_url");
  let externalUrl: string | null = null;
  if (externalUrlRaw) {
    const result = validateCustomDestination(externalUrlRaw);
    if (!result.ok) redirect(errorRedirectUrl(editPath, `External Link: ${result.error}`));
    externalUrl = result.value;
  }

  const payload = {
    business_id: businessId,
    event_id: eventId,
    title,
    description: str(formData, "description"),
    start_at: localDateTimeToIso(startLocal),
    end_at: localDateTimeToIso(str(formData, "end_at")),
    venue_name: str(formData, "venue_name"),
    address: str(formData, "address"),
    city: str(formData, "city"),
    state: str(formData, "state"),
    status: str(formData, "status") ?? "confirmed",
    is_featured: bool(formData, "is_featured"),
    bulletin_text: str(formData, "bulletin_text"),
    show_on_home: bool(formData, "show_on_home"),
    home_sort_order: num(formData, "home_sort_order"),
    external_url: externalUrl,
    flyer_image_url: str(formData, "flyer_image_url"),
  };

  let appearanceId = id;
  if (appearanceId) {
    const { error } = await supabase.from("appearances").update(payload).eq("id", appearanceId);
    if (error) redirect(errorRedirectUrl(editPath, error.message));
  } else {
    const { data, error } = await supabase
      .from("appearances")
      .insert(payload)
      .select("id")
      .single();
    if (error || !data) {
      redirect(errorRedirectUrl(editPath, error?.message ?? "Could not create appearance."));
    }
    appearanceId = data.id;
  }

  revalidatePath("/admin/appearances");
  revalidatePath("/");
  revalidatePath("/find");
  revalidatePath("/discover");
  redirect(`/admin/appearances/${appearanceId}?saved=1`);
}

export async function deleteAppearance(id: string) {
  const supabase = getAdminSupabase();
  if (!supabase) redirect(errorRedirectUrl("/admin/appearances", "Server isn't configured for writes."));
  await supabase.from("appearances").delete().eq("id", id);
  revalidatePath("/admin/appearances");
  revalidatePath("/");
  revalidatePath("/find");
  redirect("/admin/appearances");
}
