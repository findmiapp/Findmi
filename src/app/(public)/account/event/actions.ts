"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireEventMember } from "@/lib/permissions";
import { canCurrentUserManageEvents } from "@/lib/entitlements";
import { errorRedirectUrl, errorRedirectUrlWithFields, localDateTimeToIso, str } from "@/lib/admin/form-helpers";
import { isSlugTaken } from "@/lib/admin/queries";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { validateImageFile } from "@/lib/imageUploadValidation";
import { validateCustomDestination } from "@/lib/navigation";
import { createLinkedMarketRequest, findExistingGeographyMatch } from "@/lib/market-requests";
import { isAreaInMarket } from "@/lib/admin/market-areas";
import { cancelEventAppearance, ensureEventAppearance } from "@/app/admin/(protected)/events/actions";
import type { EventParticipationStatus } from "@/lib/types";

const UPLOAD_BUCKET = "findmi-media";

/**
 * Multi-Entity Self-Service V1, Stage 2 — Event self-service + Event
 * Manager. Every write action below follows the exact same authorize-
 * then-elevate shape as account/business/actions.ts, extended with the
 * Stage 1B Admin Manage-As pattern from the start (no premature
 * "if (!user) redirect('/login')" ahead of requireEventMember() — that
 * one call is itself the complete authorization: a real event_members
 * row OR an explicit founder admin session, never a fake membership row,
 * never impersonation — see lib/permissions.ts). Every action here is
 * ENTITY-SCOPED (edits the managed event's own content/roster; no column
 * anywhere in this file records a personal/financial actor identity), so
 * none of them need to reject admin elevation — unlike the two
 * identity-sensitive actions Stage 1B left real-user-only on the Business
 * Manager side (Stripe checkout, Pro Invite redemption). Native EVENT
 * CREATION is the one exception: creating a brand-new event is
 * inherently tied to a real user's own identity (they become its
 * event_members owner), so createMemberEvent below requires a genuine
 * Supabase Auth session, same as createMemberBusiness does for
 * businesses.
 */

function appendQuery(base: string, params: Record<string, string>): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${new URLSearchParams(params).toString()}`;
}

/** The one shared authorization chokepoint for every Event Manager
 * mutation below — mirrors account/business/actions.ts's
 * requireAuthorizedBusinessMember exactly, minus the Pro/plan-tier gate
 * (Events have no plan tier of their own; the ENTITLEMENT gate for
 * Events lives entirely at creation/claim time, per this pass's own
 * Entitlement Rule — once someone is a real event_members owner/manager,
 * managing that event is not additionally plan-gated, same as the
 * Business Manager's own FindMi Here appearance actions are never
 * plan-gated once a real business_members row exists). */
async function requireEventManager(eventId: string, redirectPath: string): Promise<SupabaseClient> {
  try {
    await requireEventMember(eventId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to this event.";
    redirect(errorRedirectUrl(redirectPath, message));
  }
  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl(redirectPath, "Server isn't configured."));
  return admin;
}

// ── Member image upload — same shape as account/business/actions.ts's
// uploadMemberBusinessImage, gated by requireEventMember instead of
// requireBusinessMember. ───────────────────────────────────────────────
export async function uploadMemberEventImage(
  eventId: string,
  formData: FormData
): Promise<{ url?: string; error?: string }> {
  try {
    await requireEventMember(eventId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "You don't have access to this event." };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file selected." };

  const validated = await validateImageFile(file);
  if ("error" in validated) return validated;

  const admin = getAdminSupabase();
  if (!admin) return { error: "Storage isn't configured on the server." };

  const path = `${crypto.randomUUID()}.${validated.extension}`;
  const uploadBody = validated.converted?.buffer ?? file;
  const uploadContentType = validated.converted?.contentType ?? file.type;

  const { error } = await admin.storage.from(UPLOAD_BUCKET).upload(path, uploadBody, {
    contentType: uploadContentType,
    upsert: false,
  });
  if (error) return { error: error.message };

  const { data } = admin.storage.from(UPLOAD_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}

// ── NATIVE EVENT CREATION ────────────────────────────────────────────────
const CREATE_EVENT_PATH = "/account/event/new";

const CREATE_EVENT_FRIENDLY_ERROR: Record<string, string> = {
  user_required: "You need to be signed in to create an event.",
  name_required: "Event name is required.",
  slug_required: "Event name is required to generate a URL.",
  start_required: "Start date/time is required.",
  invalid_end: "End date/time must be after the start date/time.",
  market_choice_ambiguous: "Choose an existing Market OR request one — not both.",
  invalid_market: "That market isn't available. Choose another.",
};

/** Creates a brand-new event natively — free, no separate Event fee,
 * starting is_demo=true (hidden from every public discovery/detail query
 * — see getEventBySlug() in lib/data.ts) via create_owned_event(), never
 * accepted as input here or by that RPC. The authenticated creator
 * becomes its owner atomically with the event itself (same RPC, one
 * transaction).
 *
 * Entitlement is checked twice, deliberately: the /account/event/new page
 * itself already hides this form entirely from a non-qualifying user (see
 * that page), but this action re-derives it independently server-side —
 * never trusts that the page's own check alone gates the mutation, same
 * "every mutation must derive authorization server-side" discipline this
 * whole pass follows. */
export async function createMemberEvent(formData: FormData) {
  const sessionSupabase = await getServerSupabase();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(CREATE_EVENT_PATH)}`);

  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl(CREATE_EVENT_PATH, "Server isn't configured."));

  // Event Creation + Pending Review UX pass — every submitted field is
  // read ONCE, up front, and carried through `preservedFields` into every
  // error redirect below via `fail()`. Previously each validation failure
  // redirected with only `?error=...`, so this page (which has no
  // persisted row to fall back on before creation succeeds — unlike an
  // edit form) re-rendered with every input blank, wiping whatever the
  // visitor had already typed. Nothing here changes what's validated or
  // how — only that a rejected submission now round-trips the visitor's
  // own values back into the form.
  const name = str(formData, "name");
  const startLocal = str(formData, "start_at");
  const endLocal = str(formData, "end_at");
  const marketId = str(formData, "market_id");
  const requestedMarketTextRaw = str(formData, "requested_market_text");
  const locationHintId = str(formData, "location_id");
  const preservedFields = {
    name,
    start_at: startLocal,
    end_at: endLocal,
    market_id: marketId,
    requested_market_text: requestedMarketTextRaw,
    location_id: locationHintId,
  };
  const fail = (message: string): never => {
    redirect(errorRedirectUrlWithFields(CREATE_EVENT_PATH, message, preservedFields));
  };

  const entitled = await canCurrentUserManageEvents(admin, user.id);
  if (!entitled) {
    fail(
      "Event management is included with qualifying Findmi membership — get Findmi Pro (or redeem a Pro Invite) on a business you manage first."
    );
  }

  if (!name) fail("Event name is required.");

  if (!startLocal) fail("Start date/time is required.");
  if (!endLocal) fail("End date/time is required.");
  const startIso = localDateTimeToIso(startLocal);
  const endIso = localDateTimeToIso(endLocal);
  if (!startIso || !endIso || new Date(endIso) <= new Date(startIso)) {
    fail("End date/time must be after the start date/time.");
  }

  const baseSlug = resolveSlugInput(null, name);
  if (!baseSlug) fail("Event name is required to generate a URL.");
  const slug = await ensureUniqueSlug(baseSlug, (candidate) => isSlugTaken("events", candidate));

  // Market is OPTIONAL for events (unlike businesses) — matches the
  // existing admin saveEvent() action, which has never required one.
  if (marketId && requestedMarketTextRaw) {
    fail("Choose an existing Market OR request one — not both.");
  }

  // Same "check for an existing Market/Area match before falling back to
  // a Market Request" shape createMemberBusiness/saveEvent already use.
  // Event + Appearance Geography Completion pass — the creation form has
  // no Area picker of its own, but a free-text request can still resolve
  // to a specific Area (not just its parent Market) via the matcher —
  // that Area must be captured, not silently dropped on the floor.
  let effectiveMarketId = marketId;
  let effectiveAreaId: string | null = null;
  let effectiveRequestedMarketText = requestedMarketTextRaw;
  if (requestedMarketTextRaw) {
    const match = await findExistingGeographyMatch(admin, requestedMarketTextRaw);
    if (match) {
      effectiveMarketId = match.marketId;
      effectiveAreaId = match.areaId ?? null;
      effectiveRequestedMarketText = null;
    }
  }

  const { data: created, error } = await admin.rpc("create_owned_event", {
    p_user_id: user.id,
    p_name: name,
    p_slug: slug,
    p_start_at: startIso,
    p_end_at: endIso,
    p_market_id: effectiveMarketId,
    p_requested_market_text: effectiveRequestedMarketText,
  });

  if (error || !created) {
    const message = CREATE_EVENT_FRIENDLY_ERROR[error?.message ?? ""] ?? "Couldn't create your event. Please try again.";
    fail(message);
  }

  const eventId = (created as { id: string }).id;

  // create_owned_event() has no p_market_area_id parameter (Area wasn't
  // part of that RPC's original signature) — rather than widen the RPC,
  // a matched Area is written with one plain follow-up update. Best-effort
  // only, same as the Location copy below: the event is already created
  // either way, this just avoids losing an Area the matcher already found.
  if (effectiveAreaId) {
    await admin.from("events").update({ market_area_id: effectiveAreaId }).eq("id", eventId);
  }

  // Create Event From Venue — Stage 3, Step 9. Copies the chosen
  // Location's own venue fields onto the brand-new event, same copy
  // shape updateMemberEventLocation already uses when an owner picks a
  // Location on the Event Manager's own Location tab. Best-effort only
  // (the event was already created successfully above regardless): a
  // missing/invalid location_id just means the event is created without
  // a venue prefilled, same as leaving that field blank on the form.
  // This ONLY ever writes to events' own venue_name/address/city/state/
  // latitude/longitude columns — it never creates a location_members row
  // for the event creator, and never touches location_members for the
  // Location itself, so Event ownership stays with this event's own
  // creator only and Location ownership is completely unaffected either
  // way (see this stage's Locked Product Model). Reuses locationHintId
  // captured up top (same form field, already read once into
  // preservedFields).
  if (locationHintId) {
    const { data: location } = await admin
      .from("locations")
      .select("name, address, city, state, latitude, longitude")
      .eq("id", locationHintId)
      .maybeSingle();
    if (location) {
      await admin
        .from("events")
        .update({
          venue_name: location.name,
          address: location.address,
          city: location.city,
          state: location.state,
          latitude: location.latitude,
          longitude: location.longitude,
        })
        .eq("id", eventId);
    }
  }

  revalidatePath("/account");
  redirect(`/account/event/${eventId}`);
}

// ── EVENT DETAILS ─────────────────────────────────────────────────────────
/** Owner-facing content fields — deliberately a small subset of admin's
 * own saveEvent() payload: name/description/organizer contact/external
 * link/hero image, plus the event_categories roster. Never exposes
 * is_featured/featured_sort_order/is_demo/directions_enabled/rsvp/
 * tickets/vendor_applications/contact/bulletin toggles or Market —
 * those stay admin-only (discovery curation) or live on their own tab
 * (Market/Area). */
export async function updateMemberEventDetails(eventId: string, formData: FormData) {
  const redirectPath = `/account/event/${eventId}?tab=details`;
  const admin = await requireEventManager(eventId, redirectPath);

  const name = str(formData, "name");
  if (!name) redirect(appendQuery(redirectPath, { error: "Event name is required." }));

  const externalUrlRaw = str(formData, "external_url");
  let external_url: string | null = null;
  if (externalUrlRaw) {
    const result = validateCustomDestination(externalUrlRaw);
    if (!result.ok) redirect(appendQuery(redirectPath, { error: `Link: ${result.error}` }));
    external_url = result.value;
  }

  const payload = {
    name,
    description: str(formData, "description"),
    organizer_name: str(formData, "organizer_name"),
    organizer_email: str(formData, "organizer_email"),
    external_url,
    cover_image_url: str(formData, "cover_image_url"),
  };

  const { data: event, error } = await admin.from("events").update(payload).eq("id", eventId).select("slug, is_demo").maybeSingle();
  if (error) redirect(appendQuery(redirectPath, { error: error.message }));

  const categoryIds = formData.getAll("category_ids").map(String);
  const { error: catDeleteError } = await admin.from("event_categories").delete().eq("event_id", eventId);
  if (catDeleteError) redirect(appendQuery(redirectPath, { error: `Categories: ${catDeleteError.message}` }));
  if (categoryIds.length > 0) {
    const { error: catInsertError } = await admin
      .from("event_categories")
      .insert(categoryIds.map((category_id) => ({ event_id: eventId, category_id })));
    if (catInsertError) redirect(appendQuery(redirectPath, { error: `Categories: ${catInsertError.message}` }));
  }

  revalidatePath(redirectPath);
  if (event && !event.is_demo) revalidatePath(`/event/${event.slug}`);
  redirect(appendQuery(redirectPath, { saved: "1" }));
}

// ── DATES ──────────────────────────────────────────────────────────────
// Owner-facing "Dates" — the event's own primary start/end plus any
// additional event_occurrences rows. Deliberately hides the word
// "occurrence" and every occurrence's raw id from the UI (see the Event
// Manager page) — these actions take occurrenceId only as an internal
// route param, never surfaced as something the organizer needs to
// understand or type.

export async function updateMemberEventPrimaryDate(eventId: string, formData: FormData) {
  const redirectPath = `/account/event/${eventId}?tab=dates`;
  const admin = await requireEventManager(eventId, redirectPath);

  const startLocal = str(formData, "start_at");
  const endLocal = str(formData, "end_at");
  if (!startLocal || !endLocal) redirect(appendQuery(redirectPath, { error: "Start and end date/time are required." }));
  const startIso = localDateTimeToIso(startLocal);
  const endIso = localDateTimeToIso(endLocal);
  if (!startIso || !endIso || new Date(endIso) <= new Date(startIso)) {
    redirect(appendQuery(redirectPath, { error: "End date/time must be after the start date/time." }));
  }

  const { error } = await admin.from("events").update({ start_at: startIso, end_at: endIso }).eq("id", eventId);
  if (error) redirect(appendQuery(redirectPath, { error: error.message }));

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { saved: "1" }));
}

/** Adds one additional date (event_occurrences row). Recurring/multi-date
 * architecture (event_occurrences, per-occurrence participation) is
 * completely preserved — this just adds one more row to it via the
 * plainest possible owner-facing form (date + start/end time + optional
 * existing Location), no "repeat weekly" cloning or per-occurrence Market/
 * ticket-URL overrides (admin-only nuances, out of this pass's scope). */
export async function addMemberEventDate(eventId: string, formData: FormData) {
  const redirectPath = `/account/event/${eventId}?tab=dates`;
  const admin = await requireEventManager(eventId, redirectPath);

  // Event Creation + Pending Review UX pass — "Add a Date" creates a
  // brand-new event_occurrences row (no stored row to fall back on until
  // it exists), so it had the same "validation error wipes the form"
  // shape as native entity creation — fixed the same way: every submitted
  // field preserved through the error redirect via errorRedirectUrlWithFields,
  // read back into defaultValues by the page.
  const dateLocal = str(formData, "date");
  const startTime = str(formData, "start_time");
  const endTime = str(formData, "end_time");
  const locationId = str(formData, "location_id");
  const preservedFields = { add_date: dateLocal, add_start_time: startTime, add_end_time: endTime, add_location_id: locationId };
  const fail = (message: string): never => {
    redirect(errorRedirectUrlWithFields(redirectPath, message, preservedFields));
  };

  if (!dateLocal || !startTime || !endTime) {
    fail("Date, start time, and end time are required.");
  }
  const start_at = localDateTimeToIso(`${dateLocal}T${startTime}`);
  const end_at = localDateTimeToIso(`${dateLocal}T${endTime}`);
  if (!start_at || !end_at || new Date(end_at) <= new Date(start_at)) {
    fail("End time must be after the start time.");
  }

  const { error } = await admin.from("event_occurrences").insert({
    event_id: eventId,
    start_at,
    end_at,
    location_id: locationId,
  });
  if (error) fail("Couldn't add that date. Please try again.");

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { date_added: "1" }));
}

/** Edit — scoped by both id and event_id, so an organizer can only ever
 * touch a date belonging to their OWN event. */
export async function updateMemberEventDate(eventId: string, occurrenceId: string, formData: FormData) {
  const redirectPath = `/account/event/${eventId}?tab=dates`;
  const admin = await requireEventManager(eventId, redirectPath);

  const { data: existing } = await admin
    .from("event_occurrences")
    .select("id")
    .eq("id", occurrenceId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (!existing) redirect(appendQuery(redirectPath, { error: "That date no longer exists." }));

  const dateLocal = str(formData, "date");
  const startTime = str(formData, "start_time");
  const endTime = str(formData, "end_time");
  if (!dateLocal || !startTime || !endTime) {
    redirect(appendQuery(redirectPath, { error: "Date, start time, and end time are required." }));
  }
  const start_at = localDateTimeToIso(`${dateLocal}T${startTime}`);
  const end_at = localDateTimeToIso(`${dateLocal}T${endTime}`);
  if (!start_at || !end_at || new Date(end_at) <= new Date(start_at)) {
    redirect(appendQuery(redirectPath, { error: "End time must be after the start time." }));
  }

  const { error } = await admin
    .from("event_occurrences")
    .update({ start_at, end_at, location_id: str(formData, "location_id") })
    .eq("id", occurrenceId)
    .eq("event_id", eventId);
  if (error) redirect(appendQuery(redirectPath, { error: "Couldn't update that date. Please try again." }));

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { date_updated: "1" }));
}

/** Remove — a hard delete, same as admin's own removedOccurrenceIds
 * handling in saveEvent(). Scoped by both id and event_id. */
export async function removeMemberEventDate(eventId: string, occurrenceId: string) {
  const redirectPath = `/account/event/${eventId}?tab=dates`;
  const admin = await requireEventManager(eventId, redirectPath);

  await admin.from("event_occurrences").delete().eq("id", occurrenceId).eq("event_id", eventId);

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { date_removed: "1" }));
}

// ── LOCATION ───────────────────────────────────────────────────────────
// events has no location_id column of its own (only event_occurrences
// does) — the parent event's "Location" is always the plain venue_name/
// address/city/state text fields admin's own EventForm already edits
// this way. Selecting an existing FindMi Location here is an autofill
// convenience only: it copies that Location's fields down into these
// same text columns, it does NOT create a structural FK relationship
// (there is none to create) — see this pass's own Step 7 instruction not
// to build Stage 3's Location-ownership system early. The typed-text
// fallback stays equally available and is never blocked.
export async function updateMemberEventLocation(eventId: string, formData: FormData) {
  const redirectPath = `/account/event/${eventId}?tab=location`;
  const admin = await requireEventManager(eventId, redirectPath);

  const locationId = str(formData, "location_id");
  let payload: {
    venue_name: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } = {
    venue_name: str(formData, "venue_name"),
    address: str(formData, "address"),
    city: str(formData, "city"),
    state: str(formData, "state"),
  };

  if (locationId) {
    const { data: location } = await admin
      .from("locations")
      .select("name, address, city, state, latitude, longitude")
      .eq("id", locationId)
      .maybeSingle();
    if (location) {
      payload = {
        venue_name: location.name,
        address: location.address,
        city: location.city,
        state: location.state,
        latitude: location.latitude,
        longitude: location.longitude,
      };
    }
  }

  const { error } = await admin.from("events").update(payload).eq("id", eventId);
  if (error) redirect(appendQuery(redirectPath, { error: error.message }));

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { saved: "1" }));
}

// ── MARKET / AREA ──────────────────────────────────────────────────────
/** Owner-facing Market selection — reuses the exact same "check for an
 * existing Market/Area match, fall back to a linked, admin-reviewable
 * Market Request" logic createMemberEvent/createMemberBusiness/saveEvent
 * already use. Never infers a business's own Market entitlement from
 * this — events and businesses each carry their own independent
 * market_id, this action only ever touches the event's. */
export async function updateMemberEventMarket(eventId: string, formData: FormData) {
  const redirectPath = `/account/event/${eventId}?tab=market`;
  const admin = await requireEventManager(eventId, redirectPath);

  const marketId = str(formData, "market_id");
  const requestedMarketTextRaw = str(formData, "requested_market_text");
  if (marketId && requestedMarketTextRaw) {
    redirect(appendQuery(redirectPath, { error: "Choose an existing Market OR request one — not both." }));
  }

  let effectiveMarketId = marketId;
  // Event + Appearance Geography Completion pass — an Area picked in the
  // form only survives if it still belongs to whichever Market ends up
  // effective (a manually-chosen Market wins as-is; an auto-matched Market
  // from a free-text request may not be the one the submitted Area
  // belongs to, so re-validate either way rather than trusting the form).
  let effectiveAreaId = str(formData, "market_area_id");
  if (requestedMarketTextRaw) {
    const match = await findExistingGeographyMatch(admin, requestedMarketTextRaw);
    if (match) {
      effectiveMarketId = match.marketId;
      effectiveAreaId = match.areaId ?? null;
    } else {
      const { data: event } = await admin.from("events").select("city, state").eq("id", eventId).maybeSingle();
      await createLinkedMarketRequest(admin, {
        text: requestedMarketTextRaw,
        city: event?.city ?? null,
        state: event?.state ?? null,
        source: "event_creation",
        sourceEventId: eventId,
      });
    }
  }
  if (effectiveAreaId && (!effectiveMarketId || !(await isAreaInMarket(effectiveAreaId, effectiveMarketId)))) {
    effectiveAreaId = null;
  }

  const { error } = await admin
    .from("events")
    .update({ market_id: effectiveMarketId, market_area_id: effectiveAreaId })
    .eq("id", eventId);
  if (error) redirect(appendQuery(redirectPath, { error: error.message }));

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { saved: "1" }));
}

// ── IMAGES ─────────────────────────────────────────────────────────────
/** Event gallery + venue gallery — same "current config, wholesale
 * replace on every save" shape admin's own saveEvent() uses for
 * event_images. */
export async function updateMemberEventImages(eventId: string, formData: FormData) {
  const redirectPath = `/account/event/${eventId}?tab=images`;
  const admin = await requireEventManager(eventId, redirectPath);

  const galleryUrls = formData.getAll("gallery_image_url").map(String).filter(Boolean);
  const venueUrls = formData.getAll("venue_image_url").map(String).filter(Boolean);
  await admin.from("event_images").delete().eq("event_id", eventId).eq("kind", "event");
  await admin.from("event_images").delete().eq("event_id", eventId).eq("kind", "venue");
  const imageRows = [
    ...galleryUrls.map((url, i) => ({ event_id: eventId, kind: "event" as const, url, display_order: i })),
    ...venueUrls.map((url, i) => ({ event_id: eventId, kind: "venue" as const, url, display_order: i })),
  ];
  if (imageRows.length > 0) {
    await admin.from("event_images").insert(imageRows);
  }

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { saved: "1" }));
}

// ── PARTICIPATING BUSINESSES ─────────────────────────────────────────────
// Owner-facing "Participating Businesses" — event_businesses only (the
// event-level roster; per-occurrence rosters via
// event_occurrence_businesses stay admin-only for this pass, same as
// admin's own separate OccurrenceVendorManager surface). Reuses
// ensureEventAppearance/cancelEventAppearance (exported from admin's
// events/actions.ts) rather than a second reimplementation of the same
// idempotent FindMi Here sync.

/** Invite an existing FindMi business. Always inserts as 'invited' —
 * NEVER 'approved' (the event_businesses column default) — because an
 * organizer inviting a vendor is not the same as that vendor confirming;
 * see this pass's own explicit rule. ignoreDuplicates means re-inviting
 * an already-present business never downgrades its current status. */
export async function inviteParticipatingBusiness(eventId: string, businessId: string) {
  const redirectPath = `/account/event/${eventId}?tab=participants`;
  const admin = await requireEventManager(eventId, redirectPath);

  const { error } = await admin
    .from("event_businesses")
    .upsert({ event_id: eventId, business_id: businessId, status: "invited" }, { onConflict: "event_id,business_id", ignoreDuplicates: true });
  if (error) redirect(appendQuery(redirectPath, { error: error.message }));

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { participant_added: "1" }));
}

const VALID_PARTICIPATION_STATUSES: EventParticipationStatus[] = ["invited", "applied", "pending", "approved", "declined"];

/** Approve/decline (or otherwise change) one participant's status —
 * scoped to (event_id, business_id) so an organizer can only ever touch
 * their OWN event's roster, never another event's. Syncs (or reverse-
 * syncs) the linked FindMi Here appearance exactly like admin's own
 * saveEvent()/updateOccurrenceVendorStatus already do — approving here
 * has the same real, public "official participation" effect an admin
 * approval would. */
export async function updateParticipatingBusinessStatus(eventId: string, businessId: string, status: string) {
  const redirectPath = `/account/event/${eventId}?tab=participants`;
  const admin = await requireEventManager(eventId, redirectPath);

  if (!VALID_PARTICIPATION_STATUSES.includes(status as EventParticipationStatus)) {
    redirect(appendQuery(redirectPath, { error: "Not a valid status." }));
  }

  const { error } = await admin
    .from("event_businesses")
    .update({ status })
    .eq("event_id", eventId)
    .eq("business_id", businessId);
  if (error) redirect(appendQuery(redirectPath, { error: error.message }));

  if (status === "approved") {
    await ensureEventAppearance(admin, eventId, businessId);
  } else {
    await cancelEventAppearance(admin, eventId, businessId);
  }

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { participant_updated: "1" }));
}

/** Remove a participant entirely — reverse-syncs the appearance first
 * (same as admin's own removedIds handling), then deletes the roster
 * row. Scoped to (event_id, business_id). */
export async function removeParticipatingBusiness(eventId: string, businessId: string) {
  const redirectPath = `/account/event/${eventId}?tab=participants`;
  const admin = await requireEventManager(eventId, redirectPath);

  await cancelEventAppearance(admin, eventId, businessId);
  await admin.from("event_businesses").delete().eq("event_id", eventId).eq("business_id", businessId);

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { participant_removed: "1" }));
}
