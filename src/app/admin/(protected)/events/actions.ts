"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { isSlugTaken } from "@/lib/admin/queries";
import { bool, DEFAULT_ADMIN_TIMEZONE, errorRedirectUrl, localDateTimeToIso, num, str } from "@/lib/admin/form-helpers";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import type { EventParticipationStatus } from "@/lib/types";

// ── Approval -> FindMi Here sync (Admin Approval → FindMi Here Sync pass) ──
//
// Founder/admin approval path ONLY — these two helpers are called only
// from saveEvent's participation-roster write and from
// updateOccurrenceVendorStatus below, both requireAdminSupabase()-gated.
// Member-facing participation actions
// (src/app/(public)/account/business/actions.ts's requestEventParticipation/
// withdrawEventParticipation) only ever touch event_businesses/
// event_occurrence_businesses — they have no path to this file and can
// never write appearances themselves.
//
// Idempotent by construction: each helper checks for an existing,
// non-canceled appearance first and returns early if one already exists,
// so re-approving (or re-saving an already-approved roster) never creates
// a duplicate. The occurrence path additionally relies on the real
// DB-level partial unique index (appearances_one_per_business_occurrence,
// business_id + event_occurrence_id) as a race-safe backstop — a
// unique_violation there is treated as "already exists," not an error.
// No unique index constrains the non-recurring (event_id + business_id,
// event_occurrence_id null) case, so that path's existence check is the
// only safeguard — acceptable for this founder-only, low-concurrency
// action, and "no schema/migration changes" is an explicit requirement
// of this pass.
//
// Deliberately create-only: neither helper ever updates or deletes an
// existing appearance — declining, un-approving, or removing a roster row
// does not touch `appearances` at all. Cancellation/removal sync is
// explicitly out of scope for this pass.

/** Non-recurring event -> one appearances row (event_occurrence_id left
 * null). Inherits title/start/end/venue straight from the event row —
 * no title/date fuzzy matching. */
async function ensureEventAppearance(supabase: SupabaseClient, eventId: string, businessId: string) {
  const { data: existing } = await supabase
    .from("appearances")
    .select("id")
    .eq("business_id", businessId)
    .eq("event_id", eventId)
    .is("event_occurrence_id", null)
    .neq("status", "canceled")
    .maybeSingle();
  if (existing) return;

  const { data: event } = await supabase
    .from("events")
    .select("name, start_at, end_at, venue_name, address, city, state, latitude, longitude")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return;

  await supabase.from("appearances").insert({
    business_id: businessId,
    event_id: eventId,
    title: event.name,
    start_at: event.start_at,
    end_at: event.end_at,
    venue_name: event.venue_name,
    address: event.address,
    city: event.city,
    state: event.state,
    latitude: event.latitude,
    longitude: event.longitude,
    status: "confirmed",
    // Appearance Provenance pass — only this admin-approval sync path
    // (and its occurrence-level sibling below) ever writes this value.
    // The existence check above already returns early if a matching
    // appearance exists at all — owner-created or otherwise — so this
    // insert only ever runs when nothing existed yet, never overwriting
    // an owner-added appearance's provenance.
    source: "official_participation",
  });
}

/** Recurring occurrence -> one appearances row identified by business_id +
 * event_occurrence_id. Venue/address prefers the occurrence's own linked
 * location (same location_id convention getUpcomingOccurrences already
 * uses); falls back to the parent event's own venue fields when the
 * occurrence has no location_id set. */
async function ensureOccurrenceAppearance(supabase: SupabaseClient, occurrenceId: string, businessId: string) {
  const { data: existing } = await supabase
    .from("appearances")
    .select("id")
    .eq("business_id", businessId)
    .eq("event_occurrence_id", occurrenceId)
    .neq("status", "canceled")
    .maybeSingle();
  if (existing) return;

  const { data: occurrence } = await supabase
    .from("event_occurrences")
    .select("event_id, start_at, end_at, location_id, events(name, venue_name, address, city, state, latitude, longitude)")
    .eq("id", occurrenceId)
    .maybeSingle();
  if (!occurrence) return;
  const event = Array.isArray(occurrence.events) ? occurrence.events[0] : occurrence.events;
  if (!event) return;

  let venue = {
    venue_name: event.venue_name as string | null,
    address: event.address as string | null,
    city: event.city as string | null,
    state: event.state as string | null,
    latitude: event.latitude as number | null,
    longitude: event.longitude as number | null,
  };
  if (occurrence.location_id) {
    const { data: location } = await supabase
      .from("locations")
      .select("name, address, city, state, latitude, longitude")
      .eq("id", occurrence.location_id)
      .maybeSingle();
    if (location) {
      venue = {
        venue_name: location.name,
        address: location.address,
        city: location.city,
        state: location.state,
        latitude: location.latitude,
        longitude: location.longitude,
      };
    }
  }

  const { error } = await supabase.from("appearances").insert({
    business_id: businessId,
    event_id: occurrence.event_id,
    event_occurrence_id: occurrenceId,
    title: event.name,
    start_at: occurrence.start_at,
    end_at: occurrence.end_at,
    status: "confirmed",
    ...venue,
    // Appearance Provenance pass — same reasoning as ensureEventAppearance
    // above: the existence check already returned early if a matching
    // appearance (owner-added or otherwise) already existed.
    source: "official_participation",
  });
  // 23505 = unique_violation — a concurrent approval already won the race
  // against appearances_one_per_business_occurrence; that's the intended
  // idempotency backstop, not a real failure.
  if (error && error.code !== "23505") {
    // Non-fatal by design: the participation approval itself already
    // succeeded above: a sync hiccup here shouldn't roll that back or
    // interrupt the founder's save.
  }
}

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

  // Occurrences (Event Occurrences foundation) — same "current roster +
  // explicitly removed ids" shape as the participant/featured-product
  // rosters below: "occurrence_id" carries the current roster,
  // "removed_occurrence_id" carries anything explicitly removed this
  // submit. Each occurrence carries its own surrogate id (generated
  // client-side via crypto.randomUUID() for a brand-new row — see
  // EventOccurrencesEditor), so upsert is keyed on that id directly rather
  // than a natural composite key. Concrete rows only, never a stored
  // recurrence rule — the editor's "repeat weekly" control just clones
  // rows client-side before they ever reach here.
  const occurrenceIds = formData.getAll("occurrence_id").map(String);
  const removedOccurrenceIds = formData.getAll("removed_occurrence_id").map(String);

  const occurrencesToUpsert = occurrenceIds.map((occId) => {
    const occStartLocal = str(formData, `start_at_${occId}`);
    const occEndLocal = str(formData, `end_at_${occId}`);
    if (!occStartLocal || !occEndLocal) {
      redirect(errorRedirectUrl(editPath, "Every occurrence needs both a start and end date/time."));
    }
    // Admin Occurrence Timezone Correctness pass — each occurrence carries
    // its own IANA timezone (event_occurrences.timezone, EventOccurrencesEditor's
    // per-row select), submitted as `timezone_${occId}`. Falls back to
    // DEFAULT_ADMIN_TIMEZONE only if that field is somehow missing (should
    // never happen — the editor always renders the hidden input), which
    // matches the column's own DB default and is never worse than the
    // previous hardcoded behavior.
    const occTimezone = str(formData, `timezone_${occId}`) ?? DEFAULT_ADMIN_TIMEZONE;
    const occStartIso = localDateTimeToIso(occStartLocal, occTimezone);
    const occEndIso = localDateTimeToIso(occEndLocal, occTimezone);
    if (!occStartIso || !occEndIso || new Date(occEndIso) <= new Date(occStartIso)) {
      redirect(errorRedirectUrl(editPath, "Each occurrence's end date/time must be after its own start date/time."));
    }
    return {
      id: occId,
      event_id: eventId as string,
      start_at: occStartIso as string,
      end_at: occEndIso as string,
      timezone: occTimezone,
      location_id: str(formData, `location_id_${occId}`),
      featured: bool(formData, `featured_${occId}`),
      status: bool(formData, `cancelled_${occId}`) ? "cancelled" : "scheduled",
      ticket_url_override: str(formData, `ticket_url_override_${occId}`),
      vendor_apply_url_override: str(formData, `vendor_apply_url_override_${occId}`),
    };
  });

  if (occurrencesToUpsert.length > 0) {
    const { error: occError } = await supabase
      .from("event_occurrences")
      .upsert(occurrencesToUpsert, { onConflict: "id" });
    if (occError) redirect(errorRedirectUrl(editPath, `Occurrences: ${occError.message}`));
  }
  if (removedOccurrenceIds.length > 0) {
    const { error: occDeleteError } = await supabase
      .from("event_occurrences")
      .delete()
      .in("id", removedOccurrenceIds);
    if (occDeleteError) redirect(errorRedirectUrl(editPath, `Occurrences: ${occDeleteError.message}`));
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
    const { error: ebError } = await supabase.from("event_businesses").upsert(toUpsert, { onConflict: "event_id,business_id" });
    // Approval -> FindMi Here sync — only for rows that actually saved as
    // 'approved' this submit; ensureEventAppearance is idempotent, so a
    // business already approved (and already synced) from a prior save is
    // a safe no-op here.
    if (!ebError) {
      for (const row of toUpsert) {
        if (row.status === "approved") {
          await ensureEventAppearance(supabase, eventId as string, row.business_id);
        }
      }
    }
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

// ── Recurring Events V2 — per-occurrence vendor management ─────────────
//
// Manages event_occurrence_businesses ONLY. Never touches event_businesses
// (the parent event's own roster, handled entirely by the participation
// roster section of saveEvent above) and never copies rows either
// direction between the two tables. Occurrence rows in
// EventOccurrencesEditor already live inside the big
// <form action={saveEvent}> on this page, so these four actions are
// called directly (startTransition(() => addOccurrenceVendor(...))) from
// OccurrenceVendorManager rather than through their own <form> — a <form>
// nested inside another <form> is invalid HTML with unpredictable browser
// behavior. Same direct-call-from-a-client-handler shape the codebase
// already uses for non-nested toggles (see toggleItemFulfilled /
// FulfillmentStatusToggle in ../orders).
//
// On success, each action only calls revalidatePath — no redirect — so
// OccurrenceVendorManager's own open/closed panel state (plain client
// useState in EventOccurrencesEditor) survives the refresh instead of
// resetting on a full navigation. A real failure still redirects, reusing
// the exact same errorRedirectUrl + top-of-page error banner every other
// save on this form already uses.

/** Search/select an existing FindMi business (EntitySearchAdd, same
 * component ParticipationRoster already uses) and add it to one
 * occurrence's roster. Duplicate (occurrence_id, business_id) pairs are a
 * silent no-op via ignoreDuplicates — re-adding an already-present
 * business never overwrites its current status/featured state — backed by
 * the table's own `unique (occurrence_id, business_id)` constraint as the
 * ultimate guarantee either way. */
export async function addOccurrenceVendor(eventId: string, occurrenceId: string, businessId: string) {
  const supabase = await requireAdminSupabase();
  const { error } = await supabase
    .from("event_occurrence_businesses")
    .upsert(
      { occurrence_id: occurrenceId, business_id: businessId },
      { onConflict: "occurrence_id,business_id", ignoreDuplicates: true }
    );
  if (error) redirect(errorRedirectUrl(`/admin/events/${eventId}`, error.message));
  revalidatePath(`/admin/events/${eventId}`);
}

/** Change one roster row's participation status (invited/applied/pending/
 * approved/declined — same EventParticipationStatus enum event_businesses
 * uses). Both `id` and `occurrence_id` are matched in the WHERE clause so
 * a mismatched pair can never touch the wrong occurrence's row. */
export async function updateOccurrenceVendorStatus(
  eventId: string,
  occurrenceId: string,
  rowId: string,
  status: EventParticipationStatus
) {
  if (!VALID_STATUSES.includes(status)) {
    redirect(errorRedirectUrl(`/admin/events/${eventId}`, "Not a valid status."));
  }
  const supabase = await requireAdminSupabase();
  const { data, error } = await supabase
    .from("event_occurrence_businesses")
    .update({ status })
    .eq("id", rowId)
    .eq("occurrence_id", occurrenceId)
    .select("id, business_id")
    .maybeSingle();
  if (error || !data) {
    redirect(errorRedirectUrl(`/admin/events/${eventId}`, error?.message ?? "Vendor row not found."));
  }
  // Approval -> FindMi Here sync — idempotent, see ensureOccurrenceAppearance.
  if (status === "approved") {
    await ensureOccurrenceAppearance(supabase, occurrenceId, data.business_id);
  }
  revalidatePath(`/admin/events/${eventId}`);
}

/** Toggle one roster row's featured flag. Same compound-WHERE guard as
 * updateOccurrenceVendorStatus above. */
export async function updateOccurrenceVendorFeatured(
  eventId: string,
  occurrenceId: string,
  rowId: string,
  featured: boolean
) {
  const supabase = await requireAdminSupabase();
  const { data, error } = await supabase
    .from("event_occurrence_businesses")
    .update({ featured })
    .eq("id", rowId)
    .eq("occurrence_id", occurrenceId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    redirect(errorRedirectUrl(`/admin/events/${eventId}`, error?.message ?? "Vendor row not found."));
  }
  revalidatePath(`/admin/events/${eventId}`);
}

/** Remove a business from this occurrence's roster only — never touches
 * event_businesses or any other occurrence's roster. */
export async function removeOccurrenceVendor(eventId: string, occurrenceId: string, rowId: string) {
  const supabase = await requireAdminSupabase();
  const { data, error } = await supabase
    .from("event_occurrence_businesses")
    .delete()
    .eq("id", rowId)
    .eq("occurrence_id", occurrenceId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    redirect(errorRedirectUrl(`/admin/events/${eventId}`, error?.message ?? "Vendor row not found."));
  }
  revalidatePath(`/admin/events/${eventId}`);
}

/** Copy Vendors — clone another saved occurrence's own roster
 * (business_id, status, featured) into this one. An explicit, one-time
 * founder action from Manage Vendors only — never runs automatically
 * (not on "repeat weekly" generation, which only ever clones a Row's
 * date/time/location fields client-side and has no vendor data to copy in
 * the first place), and never touches event_businesses. Existing rows
 * already on the target are left untouched and never duplicated — same
 * ignoreDuplicates upsert idiom addOccurrenceVendor already uses, just
 * for a whole roster at once. Both occurrence ids are verified to belong
 * to this same event before anything is read/written, so a
 * tampered/mismatched pair can never pull in (or write to) another
 * event's roster. */
export async function copyOccurrenceVendors(eventId: string, targetOccurrenceId: string, sourceOccurrenceId: string) {
  if (targetOccurrenceId === sourceOccurrenceId) {
    redirect(errorRedirectUrl(`/admin/events/${eventId}`, "Choose a different date to copy from."));
  }
  const supabase = await requireAdminSupabase();

  const { data: occRows, error: occError } = await supabase
    .from("event_occurrences")
    .select("id")
    .eq("event_id", eventId)
    .in("id", [targetOccurrenceId, sourceOccurrenceId]);
  if (occError || (occRows ?? []).length !== 2) {
    redirect(errorRedirectUrl(`/admin/events/${eventId}`, occError?.message ?? "Both dates must belong to this event."));
  }

  const { data: sourceRows, error: sourceError } = await supabase
    .from("event_occurrence_businesses")
    .select("business_id, status, featured")
    .eq("occurrence_id", sourceOccurrenceId);
  if (sourceError) redirect(errorRedirectUrl(`/admin/events/${eventId}`, sourceError.message));

  const rows = (sourceRows ?? []) as { business_id: string; status: EventParticipationStatus; featured: boolean }[];
  if (rows.length > 0) {
    const toUpsert = rows.map((r) => ({
      occurrence_id: targetOccurrenceId,
      business_id: r.business_id,
      status: r.status,
      featured: r.featured,
    }));
    const { error: upsertError } = await supabase
      .from("event_occurrence_businesses")
      .upsert(toUpsert, { onConflict: "occurrence_id,business_id", ignoreDuplicates: true });
    if (upsertError) redirect(errorRedirectUrl(`/admin/events/${eventId}`, upsertError.message));
  }

  revalidatePath(`/admin/events/${eventId}`);
}
