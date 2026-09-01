"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { isSlugTaken } from "@/lib/admin/queries";
import { bool, errorRedirectUrl, localDateTimeToIso, num, str } from "@/lib/admin/form-helpers";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import type { EventParticipationStatus } from "@/lib/types";

const VALID_STATUSES: EventParticipationStatus[] = [
  "invited",
  "applied",
  "pending",
  "approved",
  "declined",
];

export async function saveEvent(id: string | null, formData: FormData) {
  const editPath = id ? `/admin/events/${id}` : "/admin/events/new";
  const supabase = await requireAdminSupabase();

  const name = str(formData, "name");
  const startLocal = str(formData, "start_at");
  const endLocal = str(formData, "end_at");
  if (!name || !startLocal) {
    redirect(errorRedirectUrl(editPath, "Name and start date/time are required."));
  }
  // End Date & Time is required, not optional — see the active-event
  // visibility bug fix. Without a real end time the app has no honest way
  // to know an event is still happening, so a missing/invalid end can't
  // be silently defaulted or guessed here; it has to block the save with
  // a clear message instead.
  if (!endLocal) {
    redirect(errorRedirectUrl(editPath, "End date/time is required — FindMi uses it to know when the event is over."));
  }
  const startIso = localDateTimeToIso(startLocal);
  const endIso = localDateTimeToIso(endLocal);
  if (!startIso || !endIso || new Date(endIso) <= new Date(startIso)) {
    redirect(errorRedirectUrl(editPath, "End date/time must be after the start date/time."));
  }

  // Slug safety can't depend on client JS having run: normalize whatever
  // was submitted, fall back to generating one from the name if it's
  // blank, then resolve any collision with a deterministic -2/-3 suffix.
  const baseSlug = resolveSlugInput(str(formData, "slug"), name);
  if (!baseSlug) {
    redirect(errorRedirectUrl(editPath, "Name is required to generate a slug."));
  }
  const slug = await ensureUniqueSlug(baseSlug, (candidate) =>
    isSlugTaken("events", candidate, id ?? undefined)
  );

  const payload = {
    name,
    slug,
    description: str(formData, "description"),
    cover_image_url: str(formData, "cover_image_url"),
    start_at: startIso,
    end_at: endIso,
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
    featured_products_heading: str(formData, "featured_products_heading"),
    // Final refinement pass, item 8.
    bulletin_enabled: bool(formData, "bulletin_enabled"),
    bulletin_heading: str(formData, "bulletin_heading"),
    bulletin_body: str(formData, "bulletin_body"),
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

  // Featured products roster (item 15) — same "current roster + explicitly
  // removed ids" shape as the participant roster above, so this never has
  // to diff against the full products table either.
  const featuredProductIds = formData.getAll("featured_product_id").map(String);
  const removedProductIds = formData.getAll("removed_product_id").map(String);

  const productsToUpsert = featuredProductIds.map((productId) => ({
    event_id: eventId as string,
    product_id: productId,
    display_order: num(formData, `product_display_order_${productId}`),
  }));

  if (productsToUpsert.length > 0) {
    await supabase.from("event_products").upsert(productsToUpsert, { onConflict: "event_id,product_id" });
  }
  if (removedProductIds.length > 0) {
    await supabase.from("event_products").delete().eq("event_id", eventId).in("product_id", removedProductIds);
  }

  // Event gallery + venue gallery (items 9/10) — event_images is
  // current-config, not economic/historical data (nothing else references
  // a specific row), so each kind is simply replaced wholesale on every
  // save: delete the kind's existing rows, reinsert the submitted list in
  // its current (already-reordered) DOM order. Same reasoning already used
  // for product_fulfillment_options in saveProduct.
  const galleryUrls = formData.getAll("gallery_image_url").map(String).filter(Boolean);
  const venueUrls = formData.getAll("venue_image_url").map(String).filter(Boolean);
  await supabase.from("event_images").delete().eq("event_id", eventId).eq("kind", "event");
  await supabase.from("event_images").delete().eq("event_id", eventId).eq("kind", "venue");
  const imageRows = [
    ...galleryUrls.map((url, i) => ({ event_id: eventId as string, kind: "event" as const, url, display_order: i })),
    ...venueUrls.map((url, i) => ({ event_id: eventId as string, kind: "venue" as const, url, display_order: i })),
  ];
  if (imageRows.length > 0) {
    await supabase.from("event_images").insert(imageRows);
  }

  // Root cause of the "category unchecks itself" report: neither write
  // below checked its own error, so a failed delete/insert (RLS, a bad
  // id, a transient error — anything) silently left event_categories
  // however it happened to be, then redirected to a "saved" page anyway.
  // Now a real failure surfaces as the same visible error banner every
  // other field's save failure already uses, instead of vanishing.
  const categoryIds = formData.getAll("category_ids").map(String);
  const { error: catDeleteError } = await supabase.from("event_categories").delete().eq("event_id", eventId);
  if (catDeleteError) redirect(errorRedirectUrl(editPath, `Categories: ${catDeleteError.message}`));
  if (categoryIds.length > 0) {
    const { error: catInsertError } = await supabase
      .from("event_categories")
      .insert(categoryIds.map((category_id) => ({ event_id: eventId, category_id })));
    if (catInsertError) redirect(errorRedirectUrl(editPath, `Categories: ${catInsertError.message}`));
  }

  revalidatePath("/admin/events");
  // The exact page this redirects back to — missing before, which meant
  // Next's client router cache could keep serving the pre-save RSC
  // payload for this same URL (identical `?saved=1` on every save) after
  // a redirect, showing stale checkbox/field state even though the write
  // itself had already succeeded.
  revalidatePath(editPath);
  revalidatePath(`/event/${slug}`);
  revalidatePath("/");
  revalidatePath("/events");
  revalidatePath("/discover");
  redirect(`/admin/events/${eventId}?saved=1`);
}
