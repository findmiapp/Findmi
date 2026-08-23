"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { bool, errorRedirectUrl, localDateTimeToIso, str } from "@/lib/admin/form-helpers";

export async function saveEvent(id: string | null, formData: FormData) {
  const supabase = getAdminSupabase();
  const editPath = id ? `/admin/events/${id}` : "/admin/events/new";
  if (!supabase) redirect(errorRedirectUrl(editPath, "Server isn't configured for writes."));

  const name = str(formData, "name");
  const slug = str(formData, "slug");
  const startLocal = str(formData, "start_at");
  if (!name || !slug || !startLocal) {
    redirect(errorRedirectUrl(editPath, "Name, slug, and start date/time are required."));
  }

  const payload = {
    name,
    slug,
    description: str(formData, "description"),
    cover_image_url: str(formData, "cover_image_url"),
    start_at: localDateTimeToIso(startLocal),
    end_at: localDateTimeToIso(str(formData, "end_at")),
    venue_name: str(formData, "venue_name"),
    address: str(formData, "address"),
    city: str(formData, "city"),
    state: str(formData, "state"),
    organizer_name: str(formData, "organizer_name"),
    external_url: str(formData, "external_url"),
    is_featured: bool(formData, "is_featured"),
    is_demo: !bool(formData, "published"),
  };

  let eventId = id;
  if (eventId) {
    const { error } = await supabase.from("events").update(payload).eq("id", eventId);
    if (error) redirect(errorRedirectUrl(editPath, error.message));
  } else {
    const { data, error } = await supabase.from("events").insert(payload).select("id").single();
    if (error || !data) redirect(errorRedirectUrl(editPath, error?.message ?? "Could not create event."));
    eventId = data.id;
  }

  const businessIds = formData.getAll("business_ids").map(String);
  await supabase.from("event_businesses").delete().eq("event_id", eventId);
  if (businessIds.length > 0) {
    await supabase
      .from("event_businesses")
      .insert(businessIds.map((business_id) => ({ event_id: eventId, business_id })));
  }

  revalidatePath("/admin/events");
  revalidatePath(`/event/${slug}`);
  revalidatePath("/");
  redirect(`/admin/events/${eventId}?saved=1`);
}
