"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { bool, errorRedirectUrl, localDateTimeToIso, num, str } from "@/lib/admin/form-helpers";
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
    featured_sort_order: num(formData, "featured_sort_order"),
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

  // Participation roster: ParticipationRoster only ever renders rows for
  // businesses actually on this event's roster (added via search, see
  // EntitySearchAdd) plus whichever ones were just removed in the browser —
  // never every business in the system. "participant_business_id" carries
  // the current roster; "removed_business_id" carries anything explicitly
  // removed this submit, so the server never needs to diff against the
  // full businesses table to know what changed.
  const participantIds = formData.getAll("participant_business_id").map(String);
  const removedIds = formData.getAll("removed_business_id").map(String);

  const toUpsert = participantIds.map((businessId) => {
    const rawStatus = str(formData, `status_${businessId}`) ?? "invited";
    const status = VALID_STATUSES.includes(rawStatus as EventParticipationStatus) ? rawStatus : "invited";
    return {
      event_id: eventId as string,
      business_id: businessId,
      status,
      featured: bool(formData, `featured_${businessId}`),
      offering_text: str(formData, `offering_text_${businessId}`),
      display_order: num(formData, `display_order_${businessId}`),
    };
  });

  if (toUpsert.length > 0) {
    await supabase.from("event_businesses").upsert(toUpsert, { onConflict: "event_id,business_id" });
  }
  if (removedIds.length > 0) {
    await supabase
      .from("event_businesses")
      .delete()
      .eq("event_id", eventId)
      .in("business_id", removedIds);
  }

  const categoryIds = formData.getAll("category_ids").map(String);
  await supabase.from("event_categories").delete().eq("event_id", eventId);
  if (categoryIds.length > 0) {
    await supabase
      .from("event_categories")
      .insert(categoryIds.map((category_id) => ({ event_id: eventId, category_id })));
  }

  revalidatePath("/admin/events");
  revalidatePath(`/event/${slug}`);
  revalidatePath("/");
  revalidatePath("/events");
  revalidatePath("/discover");
  redirect(`/admin/events/${eventId}?saved=1`);
}
