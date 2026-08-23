"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { bool, errorRedirectUrl, localDateTimeToIso, str } from "@/lib/admin/form-helpers";
import type { EventParticipationStatus } from "@/lib/types";

const VALID_STATUSES: EventParticipationStatus[] = [
  "invited",
  "applied",
  "pending",
  "approved",
  "declined",
];

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
    directions_enabled: bool(formData, "directions_enabled"),
    rsvp_enabled: bool(formData, "rsvp_enabled"),
    rsvp_url: str(formData, "rsvp_url"),
    tickets_enabled: bool(formData, "tickets_enabled"),
    tickets_url: str(formData, "tickets_url"),
    vendor_applications_enabled: bool(formData, "vendor_applications_enabled"),
    vendor_application_url: str(formData, "vendor_application_url"),
    vendor_application_deadline: localDateTimeToIso(str(formData, "vendor_application_deadline")),
    contact_enabled: bool(formData, "contact_enabled"),
    organizer_email: str(formData, "organizer_email"),
    contact_url: str(formData, "contact_url"),
    follow_enabled: bool(formData, "follow_enabled"),
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

  // Participation roster: one status/featured pair per business in the
  // system (see ParticipationRoster). "not_participating" means delete any
  // existing row; anything else is an upsert on the (event_id, business_id)
  // primary key, so this correctly handles add/update/remove in two calls
  // regardless of what changed.
  const allBusinessIds = formData.getAll("all_business_ids").map(String);
  const toUpsert: { event_id: string; business_id: string; status: string; featured: boolean }[] = [];
  const toRemove: string[] = [];

  for (const businessId of allBusinessIds) {
    const status = str(formData, `status_${businessId}`) ?? "not_participating";
    const featured = bool(formData, `featured_${businessId}`);
    if (status === "not_participating" || !VALID_STATUSES.includes(status as EventParticipationStatus)) {
      toRemove.push(businessId);
    } else {
      toUpsert.push({ event_id: eventId as string, business_id: businessId, status, featured });
    }
  }

  if (toUpsert.length > 0) {
    await supabase.from("event_businesses").upsert(toUpsert, { onConflict: "event_id,business_id" });
  }
  if (toRemove.length > 0) {
    await supabase
      .from("event_businesses")
      .delete()
      .eq("event_id", eventId)
      .in("business_id", toRemove);
  }

  revalidatePath("/admin/events");
  revalidatePath(`/event/${slug}`);
  revalidatePath("/");
  redirect(`/admin/events/${eventId}?saved=1`);
}
