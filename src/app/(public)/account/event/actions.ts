"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { isEmailVerified, requireEventMember } from "@/lib/permissions";
import { createOpportunity, resolveEventApplicationDecision, resolveOpportunityByContext } from "@/lib/opportunities";
import { canCurrentUserManageEvents } from "@/lib/entitlements";
import { errorRedirectUrl, errorRedirectUrlWithFields, isoToLocalDateTime, localDateTimeToIso, str } from "@/lib/admin/form-helpers";
import { isSlugTaken } from "@/lib/admin/queries";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { validateImageFile } from "@/lib/imageUploadValidation";
import { validateCustomDestination } from "@/lib/navigation";
import { createLinkedMarketRequest, findExistingGeographyMatch } from "@/lib/market-requests";
import { isAreaInMarket } from "@/lib/admin/market-areas";
import { claimEntityHandle } from "@/lib/handles";
import {
  backfillAllDatesParticipation,
  cancelEventAppearance,
  cancelOfficialOccurrenceAppearances,
  declineEventLevelParticipation,
  ensureEventAppearance,
  propagateAllDatesParticipation,
  realizeEventLevelApproval,
  reconcileOccurrenceParticipationDown,
  syncOfficialEventAppearances,
  syncOfficialOccurrenceAppearances,
} from "@/lib/appearance-event-sync";
import { findCoveringOccurrenceId, isPrimaryDateId, primaryDateId } from "@/lib/data";
import { MAX_BULK_GENERATED_DATES, resolveEndDateForTimes } from "@/lib/schedule-dates";
import type { EventParticipationScope, EventParticipationStatus } from "@/lib/types";
import { notifyAdmin } from "@/lib/notifications/adminNotify";

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

/** Production Bugfix — Schedule Authoring V4 "Save 10 Dates" crash. The
 * Schedule Authoring V4 bulk actions below (bulkGenerateEventDates,
 * bulkRemoveEventDates, bulkUpdateEventDatesLocation,
 * bulkUpdateEventDatesHours) are called DIRECTLY from a client transition
 * (never via a <form action>) and their own contract — see their own
 * header comment — is to ALWAYS return a plain result object for the
 * client to render feedback from, NEVER to redirect. requireEventManager
 * above is correct for every OTHER action in this file (all <form>-
 * submitted, all expecting a possible redirect on auth failure) but is the
 * wrong tool here: a redirect() thrown from deep inside one of these bulk
 * actions, reached via a bare `await` inside an async transition with no
 * redirect handling on the calling side, surfaces as an uncaught
 * client-side exception (a full "Application error" crash) instead of the
 * graceful, inline `{ error }` these actions' own callers already know
 * how to render. This variant never redirects — an auth failure becomes
 * a normal returned error, exactly like every other failure mode these
 * actions already handle. */
async function requireEventManagerResult(eventId: string): Promise<{ admin: SupabaseClient } | { error: string }> {
  try {
    await requireEventMember(eventId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "You don't have access to this event." };
  }
  const admin = getAdminSupabase();
  if (!admin) return { error: "Server isn't configured." };
  return { admin };
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
  const manualVenue = {
    venue_name: str(formData, "venue_name"),
    address: str(formData, "address"),
    city: str(formData, "city"),
    state: str(formData, "state"),
    postal_code: str(formData, "postal_code"),
  };
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
  // Event Manager Location UX pass — Create Event now also supports the
  // no-Location manual venue fallback at creation time (previously only
  // the location_id-hint path existed here). A submitted locationHintId
  // still always wins and is re-fetched fresh from locations, same
  // server-side-authoritative pattern as updateMemberEventLocation; manual
  // venue fields only get written when there's no locationHintId at all.
  if (locationHintId) {
    const { data: location } = await admin
      .from("locations")
      .select("name, address, city, state, postal_code, latitude, longitude")
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
          postal_code: location.postal_code,
          latitude: location.latitude,
          longitude: location.longitude,
        })
        .eq("id", eventId);

      // Event <-> Venue/Location Relational Workflow pass — events has no
      // location_id column of its own (only event_occurrences does — see
      // that table's own comment and updateMemberEventLocation's note
      // below), so the copy above alone discards the real relationship
      // the owner just picked, keeping only its text snapshot. This gives
      // the brand-new event a genuine canonical Location relationship
      // from the moment of creation, via its own default occurrence — the
      // exact same event_occurrences insert shape addMemberEventDate
      // already uses for "Add a Date", just seeded with this event's own
      // start/end instead of a separately-typed date. Best-effort only,
      // same posture as the venue-copy above: a failure here never blocks
      // event creation, which already succeeded. Never runs for the
      // manual-venue path (no real Location was actually selected there,
      // so there is no relationship to create — text-only, exactly as
      // before).
      const { data: seeded } = await admin
        .from("event_occurrences")
        .insert({
          event_id: eventId,
          start_at: startIso,
          end_at: endIso,
          location_id: locationHintId,
          venue_name: location.name,
          address: location.address,
          city: location.city,
          state: location.state,
          postal_code: location.postal_code,
        })
        .select("id")
        .single();
      // Multi-Date Business Participation Pass 2B — no participants exist
      // yet at creation time, so this is always a no-op today, but wiring
      // it here keeps every occurrence-creation path consistent.
      if (seeded) await propagateAllDatesParticipation(admin, eventId, [seeded.id]);
    }
  } else if (manualVenue.venue_name || manualVenue.address || manualVenue.city || manualVenue.state || manualVenue.postal_code) {
    await admin.from("events").update(manualVenue).eq("id", eventId);
  }

  // Admin Action Email Notifications V1 — create_owned_event() always
  // creates a brand-new event (is_demo=true hardcoded, publication_status
  // defaults to pending_review — see that RPC's own comment), never a
  // draft an owner can silently keep unsubmitted, so this always fires
  // exactly once per creation. Uses only fields already read above (name,
  // startIso) — no extra query.
  await notifyAdmin({
    subject: `Event awaiting review — ${name}`,
    heading: "New Event awaiting review",
    body: [`Event: ${name}`, `Starts: ${new Date((created as { start_at: string }).start_at).toLocaleString()}`],
    actionLabel: "Review Event",
    actionUrl: `/admin/events/${eventId}`,
  });

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

// ── FindMi Global Handle Registry — Event username ───────────────────────
// Same posture as Business/Location: never mandatory (an Event keeps its
// existing /event/[slug] route either way), never auto-assigned from the
// Event's own title, same requireEventManager authorization every other
// Event Manager mutation already uses.
export async function updateMemberEventHandle(eventId: string, formData: FormData) {
  const redirectPath = `/account/event/${eventId}`;
  const admin = await requireEventManager(eventId, redirectPath);

  const usernameRaw = str(formData, "username");
  if (!usernameRaw) redirect(appendQuery(redirectPath, { error: "Enter a username first." }));

  const sessionSupabase = await getServerSupabase();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();

  const result = await claimEntityHandle(admin, "event", eventId, usernameRaw, user?.id ?? null);
  if (!result.ok) redirect(appendQuery(redirectPath, { error: result.error ?? "Couldn't save that username." }));

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { handle_saved: "1" }));
}

// ── REVIEW STATUS ─────────────────────────────────────────────────────────
/** Event Rejection State pass — the smallest safe resubmission action: a
 * rejected event's owner can send it back to pending_review after making
 * changes. Deliberately does NOT touch is_demo (public visibility is
 * unaffected either way) and deliberately does NOT fire automatically on
 * every edit — only this explicit action moves rejected → pending_review.
 * Guarded by the same compound WHERE clause idiom the admin actions use
 * (.eq("publication_status", "rejected")) so a duplicate click or a stale
 * page is a harmless no-op rather than an error. */
export async function submitEventForReview(eventId: string) {
  const redirectPath = `/account/event/${eventId}`;
  const admin = await requireEventManager(eventId, redirectPath);

  // Admin Action Email Notifications V1 — .select().maybeSingle() on the
  // update turns the existing compound WHERE clause into the same
  // "did this call actually perform the transition" signal the audit's
  // reference pattern (the Tally claim-payment webhook) already uses: a
  // stale page or a duplicate click matches zero rows here (still
  // 'pending_review' or already resolved some other way) and `updated`
  // comes back null, so no second email is ever sent for the same
  // resubmission.
  const { data: updated, error } = await admin
    .from("events")
    .update({ publication_status: "pending_review" })
    .eq("id", eventId)
    .eq("publication_status", "rejected")
    .select("id, name")
    .maybeSingle();
  if (error) redirect(appendQuery(redirectPath, { error: error.message }));

  if (updated) {
    await notifyAdmin({
      subject: `Event resubmitted for review — ${updated.name}`,
      heading: "Event resubmitted for review",
      body: [`Event: ${updated.name}`],
      actionLabel: "Review Event",
      actionUrl: `/admin/events/${eventId}`,
    });
  }

  revalidatePath(redirectPath);
  revalidatePath("/admin/events");
  revalidatePath("/admin");
  redirect(appendQuery(redirectPath, { saved: "1" }));
}

// ── DATES ──────────────────────────────────────────────────────────────
// Owner-facing "Dates" — the event's own primary start/end plus any
// additional event_occurrences rows. Deliberately hides the word
// "occurrence" and every occurrence's raw id from the UI (see the Event
// Manager page) — these actions take occurrenceId only as an internal
// route param, never surfaced as something the organizer needs to
// understand or type.

type OccurrenceVenueFields = {
  venue_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
};

/** Event Manager Location UX pass — same server-side-authoritative
 * pattern updateMemberEventLocation already used for the whole-event
 * legacy venue fields, now shared by every per-occurrence date action
 * (single add/edit, and the Schedule Authoring V4 bulk actions below): a
 * submitted locationId always wins and is re-fetched fresh from locations
 * (never trusting whatever address text the client posted for a selected
 * Location), and manual venue text is only ever persisted when there's no
 * locationId at all — the no-Location fallback path.
 *
 * Schedule Authoring V4 — takes a plain manual-venue object rather than a
 * FormData directly, so the bulk generation/bulk-Location actions (which
 * have no FormData at all — they receive plain, already-parsed arguments)
 * can call this exact same resolver instead of a second reimplementation.
 * The two existing single-date callers (addMemberEventDate,
 * updateMemberEventDate) now just extract their own manual fields from
 * `formData` one call site earlier and pass the plain object in — no
 * change to what's actually read or persisted. */
async function resolveOccurrenceVenue(
  admin: SupabaseClient,
  locationId: string | null,
  manualVenue: OccurrenceVenueFields
): Promise<OccurrenceVenueFields> {
  if (locationId) {
    const { data: location } = await admin
      .from("locations")
      .select("name, address, city, state, postal_code")
      .eq("id", locationId)
      .maybeSingle();
    if (location) {
      return {
        venue_name: location.name,
        address: location.address,
        city: location.city,
        state: location.state,
        postal_code: location.postal_code,
      };
    }
    return { venue_name: null, address: null, city: null, state: null, postal_code: null };
  }
  return manualVenue;
}

function manualVenueFromFormData(formData: FormData): OccurrenceVenueFields {
  return {
    venue_name: str(formData, "venue_name"),
    address: str(formData, "address"),
    city: str(formData, "city"),
    state: str(formData, "state"),
    postal_code: str(formData, "postal_code"),
  };
}

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

  // Schedule Integrity pass — this Event's own date/time just changed;
  // refresh WHERE/WHEN on every already-confirmed official-participation
  // Appearance linked to it (non-recurring only — event_occurrence_id is
  // null). Best-effort, never blocks this save.
  await syncOfficialEventAppearances(admin, eventId);

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
  if (startTime === endTime) {
    fail("Start and end time can't be the same.");
  }
  // Cross-Midnight Fix — a closing time at or before the opening time means
  // the session ends on the FOLLOWING calendar date (e.g. 11:30 AM start,
  // 12:00 AM end), never a same-day validation failure. See
  // lib/schedule-dates.ts's own doc comment for the exact rule.
  // Non-null assertions here are safe, not a type-safety shortcut: the
  // guards above already redirect (fail() is typed `never`) whenever any
  // of these three is null — TS just can't statically prove that through
  // a locally-scoped never-returning closure (verified: this codebase's
  // fail() idiom never narrows this way, even before this pass).
  const endDateLocal = resolveEndDateForTimes(dateLocal!, startTime!, endTime!);
  const start_at = localDateTimeToIso(`${dateLocal}T${startTime}`);
  const end_at = localDateTimeToIso(`${endDateLocal}T${endTime}`);
  if (!start_at || !end_at || new Date(end_at) <= new Date(start_at)) {
    fail("End time must be after the start time.");
  }

  const { data: inserted, error } = await admin
    .from("event_occurrences")
    .insert({
      event_id: eventId,
      start_at,
      end_at,
      location_id: locationId,
      ...(await resolveOccurrenceVenue(admin, locationId, manualVenueFromFormData(formData))),
    })
    .select("id")
    .single();
  if (error) fail("Couldn't add that date. Please try again.");

  // Multi-Date Business Participation Pass 2B — durable all_dates intent
  // (see propagateAllDatesParticipation's own doc comment) auto-includes
  // this brand-new date, zero organizer follow-up required.
  if (inserted) await propagateAllDatesParticipation(admin, eventId, [inserted.id]);

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
  if (startTime === endTime) {
    redirect(appendQuery(redirectPath, { error: "Start and end time can't be the same." }));
  }
  // Cross-Midnight Fix — see addMemberEventDate's own note above.
  const endDateLocal = resolveEndDateForTimes(dateLocal, startTime, endTime);
  const start_at = localDateTimeToIso(`${dateLocal}T${startTime}`);
  const end_at = localDateTimeToIso(`${endDateLocal}T${endTime}`);
  if (!start_at || !end_at || new Date(end_at) <= new Date(start_at)) {
    redirect(appendQuery(redirectPath, { error: "End time must be after the start time." }));
  }

  const locationId = str(formData, "location_id");
  const { error } = await admin
    .from("event_occurrences")
    .update({
      start_at,
      end_at,
      location_id: locationId,
      ...(await resolveOccurrenceVenue(admin, locationId, manualVenueFromFormData(formData))),
    })
    .eq("id", occurrenceId)
    .eq("event_id", eventId);
  if (error) redirect(appendQuery(redirectPath, { error: "Couldn't update that date. Please try again." }));

  // Schedule Integrity pass — this one Occurrence's own date/time/Location
  // just changed; refresh WHERE/WHEN (including location_id) on every
  // already-confirmed official-participation Appearance linked to THIS
  // occurrence only — never a sibling occurrence of the same Event.
  await syncOfficialOccurrenceAppearances(admin, occurrenceId);

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { date_updated: "1" }));
}

/** Remove — a hard delete, same as admin's own removedOccurrenceIds
 * handling in saveEvent(). Scoped by both id and event_id. */
export async function removeMemberEventDate(eventId: string, occurrenceId: string) {
  const redirectPath = `/account/event/${eventId}?tab=dates`;
  const admin = await requireEventManager(eventId, redirectPath);

  // Schedule Integrity pass — cancel this occurrence's official-participation
  // Appearances BEFORE deleting the occurrence row: appearances.event_occurrence_id
  // is ON DELETE SET NULL, so once the occurrence is gone this can no
  // longer find them by occurrence id, and they'd otherwise survive as a
  // stale 'confirmed' row telling customers the (now-removed) date is
  // still happening.
  await cancelOfficialOccurrenceAppearances(admin, occurrenceId);

  await admin.from("event_occurrences").delete().eq("id", occurrenceId).eq("event_id", eventId);

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { date_removed: "1" }));
}

// ── SCHEDULE AUTHORING V4 — BULK DATES ──────────────────────────────────
// Called directly (not via a <form action>) from BulkDatesComposer.tsx /
// EventScheduleList.tsx via startTransition, so each returns a plain
// result object for the client to render feedback from, instead of
// redirecting. Same requireEventManager authorization, same
// appearance-sync primitives, same never-trust-the-client posture as
// every other action in this file — client-supplied ids are always
// re-verified as belonging to this exact event before anything is
// written.

export interface BulkGenerateDateInput {
  /** "YYYY-MM-DD" local calendar date — see lib/schedule-dates.ts. */
  date: string;
  /** "HH:MM" (24-hour), the exact <input type="time"> format. */
  start_time: string;
  end_time: string;
}

export interface BulkDatesResult {
  created?: number;
  updated?: number;
  removed?: number;
  skippedExisting?: number;
  error?: string;
}

/** Bulk date generation — the organizer-facing counterpart to admin's own
 * EventOccurrencesEditor "repeat weekly" -> saveEvent() bulk upsert. Every
 * mode (one day / date range / recurring weekdays) is resolved to this
 * same flat list of concrete calendar dates client-side (lib/schedule-
 * dates.ts) — no recurrence rule is ever stored here.
 *
 * LOCKED INVARIANT — a scheduled calendar instance must exist exactly
 * once: this re-fetches the Event's OWN current Primary Date and every
 * existing event_occurrences row fresh (never trusts the client's own
 * view of the schedule), and silently skips any incoming date whose local
 * calendar date already matches one of those — so generating a range that
 * includes the Primary Date's own day never creates a duplicate occurrence
 * for it, and regenerating/extending an overlapping range only inserts
 * the genuinely new days. This is the real, authoritative duplicate
 * check — client-generated ids are not relied on for it.
 *
 * The chosen Location/manual venue is the ONE default applied to every
 * newly generated date in this batch — Location bulk changes are always
 * this explicit; there is no inherited-vs-overridden marker in the schema
 * to guess from (see the Schedule Authoring audit's own Location
 * Inheritance finding). */
export async function bulkGenerateEventDates(
  eventId: string,
  dates: BulkGenerateDateInput[],
  locationId: string | null,
  manualVenue: OccurrenceVenueFields
): Promise<BulkDatesResult> {
  const redirectPath = `/account/event/${eventId}?tab=dates`;
  const auth = await requireEventManagerResult(eventId);
  if ("error" in auth) return { error: auth.error };
  const { admin } = auth;

  if (dates.length === 0) return { created: 0, error: "No dates to generate." };
  if (dates.length > MAX_BULK_GENERATED_DATES) {
    return { error: `Can't generate more than ${MAX_BULK_GENERATED_DATES} dates in one batch.` };
  }
  for (const d of dates) {
    if (!d.date || !d.start_time || !d.end_time) {
      return { error: "Every generated date needs a date, start time, and end time." };
    }
    if (d.start_time === d.end_time) {
      return { error: "Start and end time can't be the same." };
    }
  }

  const { data: event } = await admin.from("events").select("start_at").eq("id", eventId).maybeSingle();
  if (!event) return { error: "Event not found." };

  const { data: existingOccurrences } = await admin
    .from("event_occurrences")
    .select("start_at")
    .eq("event_id", eventId);

  // Dedupe key is the local CALENDAR DATE only (never an exact-time match)
  // — bulk generation's whole purpose is "cover this date range with one
  // occurrence per day," so any existing row (Primary Date or occurrence)
  // already on a given day means that day is already covered. This is
  // deliberately narrower than the single "Add a Date" path, which still
  // allows a genuine second session on an already-scheduled day when the
  // organizer adds one explicitly.
  const alreadyCoveredDates = new Set<string>([
    isoToLocalDateTime(event.start_at).slice(0, 10),
    ...((existingOccurrences ?? []) as { start_at: string }[]).map((o) => isoToLocalDateTime(o.start_at).slice(0, 10)),
  ]);

  const venueFields = await resolveOccurrenceVenue(admin, locationId, manualVenue);

  const rowsToInsert = dates
    .filter((d) => !alreadyCoveredDates.has(d.date))
    .map((d) => {
      const endDateLocal = resolveEndDateForTimes(d.date, d.start_time, d.end_time);
      return {
        event_id: eventId,
        start_at: localDateTimeToIso(`${d.date}T${d.start_time}`) as string,
        end_at: localDateTimeToIso(`${endDateLocal}T${d.end_time}`) as string,
        location_id: locationId,
        ...venueFields,
      };
    });

  const skippedExisting = dates.length - rowsToInsert.length;
  if (rowsToInsert.length === 0) return { created: 0, skippedExisting };

  const { data: inserted, error } = await admin.from("event_occurrences").insert(rowsToInsert).select("id");
  if (error) return { error: "Couldn't save the generated dates. Please try again." };

  // Multi-Date Business Participation Pass 2B — only the rows actually
  // inserted after dedupe propagate; a skipped-as-already-covered date
  // never re-triggers this for a date that already has its participation.
  await propagateAllDatesParticipation(admin, eventId, (inserted ?? []).map((o) => o.id));

  revalidatePath(redirectPath);
  return { created: rowsToInsert.length, skippedExisting };
}

/** Bulk remove — same cancel-Appearances-before-delete invariant as
 * removeMemberEventDate, looped over a bounded, server-verified id list
 * (never a platform-wide operation, never trusts that every submitted id
 * actually belongs to this event). */
export async function bulkRemoveEventDates(eventId: string, occurrenceIds: string[]): Promise<BulkDatesResult> {
  const redirectPath = `/account/event/${eventId}?tab=dates`;
  const auth = await requireEventManagerResult(eventId);
  if ("error" in auth) return { error: auth.error };
  const { admin } = auth;
  if (occurrenceIds.length === 0) return { removed: 0 };

  const { data: owned } = await admin.from("event_occurrences").select("id").eq("event_id", eventId).in("id", occurrenceIds);
  const ownedIds = ((owned ?? []) as { id: string }[]).map((o) => o.id);
  if (ownedIds.length === 0) return { removed: 0 };

  // Schedule Integrity pass invariant, preserved: cancel official-
  // participation Appearances BEFORE deleting each occurrence row —
  // appearances.event_occurrence_id is ON DELETE SET NULL, so this can't
  // happen after the delete. Never touches a manual/event_self_added
  // Appearance (cancelOfficialOccurrenceAppearances is already scoped to
  // source='official_participation').
  for (const id of ownedIds) {
    await cancelOfficialOccurrenceAppearances(admin, id);
  }

  const { error } = await admin.from("event_occurrences").delete().eq("event_id", eventId).in("id", ownedIds);
  if (error) return { error: "Couldn't remove those dates. Please try again." };

  revalidatePath(redirectPath);
  return { removed: ownedIds.length };
}

/** Bulk Location change for selected, already-saved Additional Dates —
 * one Location/manual venue applied to every selected date, always an
 * explicit organizer action (never inferred inheritance — see
 * bulkGenerateEventDates' own note). One flat UPDATE (the new value is
 * identical for every selected row), then the existing per-occurrence
 * sync, bounded to the selected ids. */
export async function bulkUpdateEventDatesLocation(
  eventId: string,
  occurrenceIds: string[],
  locationId: string | null,
  manualVenue: OccurrenceVenueFields
): Promise<BulkDatesResult> {
  const redirectPath = `/account/event/${eventId}?tab=dates`;
  const auth = await requireEventManagerResult(eventId);
  if ("error" in auth) return { error: auth.error };
  const { admin } = auth;
  if (occurrenceIds.length === 0) return { updated: 0 };

  const { data: owned } = await admin.from("event_occurrences").select("id").eq("event_id", eventId).in("id", occurrenceIds);
  const ownedIds = ((owned ?? []) as { id: string }[]).map((o) => o.id);
  if (ownedIds.length === 0) return { updated: 0 };

  const venueFields = await resolveOccurrenceVenue(admin, locationId, manualVenue);
  const { error } = await admin
    .from("event_occurrences")
    .update({ location_id: locationId, ...venueFields })
    .eq("event_id", eventId)
    .in("id", ownedIds);
  if (error) return { error: "Couldn't update the Location for those dates. Please try again." };

  // Schedule Integrity pass — each affected occurrence's own confirmed
  // official-participation Appearances need their WHERE refreshed.
  // Bounded loop, one call per occurrence — never per business.
  for (const id of ownedIds) {
    await syncOfficialOccurrenceAppearances(admin, id);
  }

  revalidatePath(redirectPath);
  return { updated: ownedIds.length };
}

/** Bulk hours change for selected, already-saved Additional Dates — the
 * exact tool San Gennaro's own Friday/Saturday-until-midnight exception
 * needs. Each selected date KEEPS its own calendar date; only the TIME
 * changes, recomputed per row (never a flat single UPDATE, since each
 * row's date differs) via the same id-keyed bounded upsert shape admin's
 * own saveEvent() already uses for occurrence writes — Supabase's upsert
 * only touches the columns listed here (start_at/end_at/event_id) and
 * leaves location_id/timezone/status/etc. on each row untouched. Applies
 * the same Cross-Midnight Fix as every other date write in this file. */
export async function bulkUpdateEventDatesHours(
  eventId: string,
  occurrenceIds: string[],
  startTime: string,
  endTime: string
): Promise<BulkDatesResult> {
  const redirectPath = `/account/event/${eventId}?tab=dates`;
  const auth = await requireEventManagerResult(eventId);
  if ("error" in auth) return { error: auth.error };
  const { admin } = auth;
  if (occurrenceIds.length === 0) return { updated: 0 };
  if (!startTime || !endTime) return { error: "Start and end time are required." };
  if (startTime === endTime) return { error: "Start and end time can't be the same." };

  const { data: owned } = await admin
    .from("event_occurrences")
    .select("id, start_at")
    .eq("event_id", eventId)
    .in("id", occurrenceIds);
  const rows = (owned ?? []) as { id: string; start_at: string }[];
  if (rows.length === 0) return { updated: 0 };

  const updates = rows.map((row) => {
    const dateLocal = isoToLocalDateTime(row.start_at).slice(0, 10);
    const endDateLocal = resolveEndDateForTimes(dateLocal, startTime, endTime);
    return {
      id: row.id,
      event_id: eventId,
      start_at: localDateTimeToIso(`${dateLocal}T${startTime}`) as string,
      end_at: localDateTimeToIso(`${endDateLocal}T${endTime}`) as string,
    };
  });

  const { error } = await admin.from("event_occurrences").upsert(updates, { onConflict: "id" });
  if (error) return { error: "Couldn't update hours for those dates. Please try again." };

  for (const row of updates) {
    await syncOfficialOccurrenceAppearances(admin, row.id);
  }

  revalidatePath(redirectPath);
  return { updated: updates.length };
}

// ── LOCATION ───────────────────────────────────────────────────────────
// events has no location_id column of its own (only event_occurrences
// does) — the parent event's "Location" is always the plain venue_name/
// address/city/state text fields admin's own EventForm already edits
// this way. Selecting an existing FindMi Location here still ALWAYS
// copies that Location's fields down into these same text columns
// (unconditional, unchanged) — that text snapshot is what every legacy
// display path already reads. Event <-> Venue/Location Relational
// Primary Event Location Relationship fix — a real Location selection here
// must give the Event's own PRIMARY DATE a genuine event_occurrences.location_id
// relationship, exactly like any Additional Date already gets via the Dates
// tab — not just once (when the Event has zero occurrences), but every time,
// regardless of how many Additional Date occurrences already exist. The
// deciding question is never "does ANY occurrence exist" — it's "does an
// occurrence representing THIS Event's Primary Date exist" (identified via
// findCoveringOccurrenceId's same "same local calendar date" rule
// bulkGenerateEventDates/getEffectiveEventSchedule already use). If one does,
// it's updated in place (never duplicated); if not, the minimal seed
// occurrence is inserted exactly as before, dated identically to
// events.start_at/end_at. Switching back to a manual venue clears that same
// occurrence's location_id (never deletes the row — it may still be the only
// occurrence covering that calendar day) and refreshes its venue snapshot to
// the new manual text. Additional Date occurrences are never read for a
// match beyond this, and never written to, by any of this.
export async function updateMemberEventLocation(eventId: string, formData: FormData) {
  const redirectPath = `/account/event/${eventId}?tab=dates`;
  const admin = await requireEventManager(eventId, redirectPath);

  const locationId = str(formData, "location_id");
  let payload: {
    venue_name: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    postal_code?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } = {
    venue_name: str(formData, "venue_name"),
    address: str(formData, "address"),
    city: str(formData, "city"),
    state: str(formData, "state"),
    postal_code: str(formData, "postal_code"),
  };

  let matchedLocation: {
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
  } | null = null;
  if (locationId) {
    const { data: location } = await admin
      .from("locations")
      .select("name, address, city, state, postal_code, latitude, longitude")
      .eq("id", locationId)
      .maybeSingle();
    if (location) {
      matchedLocation = location;
      payload = {
        venue_name: location.name,
        address: location.address,
        city: location.city,
        state: location.state,
        postal_code: location.postal_code,
        latitude: location.latitude,
        longitude: location.longitude,
      };
    }
  }

  const { data: event, error } = await admin
    .from("events")
    .update(payload)
    .eq("id", eventId)
    .select("start_at, end_at")
    .maybeSingle();
  if (error) redirect(appendQuery(redirectPath, { error: error.message }));

  // Schedule Integrity pass — this Event's own venue text just changed;
  // refresh WHERE on every already-confirmed non-recurring
  // official-participation Appearance linked to it. The new-occurrence
  // insert below (when this Event had none yet) has no participation to
  // sync — nothing is approved against a brand-new occurrence.
  await syncOfficialEventAppearances(admin, eventId);

  if (event) {
    const { data: existingOccurrences } = await admin
      .from("event_occurrences")
      .select("id, start_at")
      .eq("event_id", eventId);
    const primaryOccurrenceId = findCoveringOccurrenceId(event.start_at, existingOccurrences ?? []);

    if (matchedLocation) {
      if (primaryOccurrenceId) {
        await admin
          .from("event_occurrences")
          .update({
            location_id: locationId,
            venue_name: matchedLocation.name,
            address: matchedLocation.address,
            city: matchedLocation.city,
            state: matchedLocation.state,
            postal_code: matchedLocation.postal_code,
          })
          .eq("id", primaryOccurrenceId);
        await syncOfficialOccurrenceAppearances(admin, primaryOccurrenceId);
      } else {
        const { data: seeded } = await admin
          .from("event_occurrences")
          .insert({
            event_id: eventId,
            start_at: event.start_at,
            end_at: event.end_at,
            location_id: locationId,
            venue_name: matchedLocation.name,
            address: matchedLocation.address,
            city: matchedLocation.city,
            state: matchedLocation.state,
            postal_code: matchedLocation.postal_code,
          })
          .select("id")
          .single();
        // Multi-Date Business Participation Pass 2B — an all_dates Business
        // approved before this Event ever had a real occurrence row must
        // still pick up this newly-seeded one.
        if (seeded) await propagateAllDatesParticipation(admin, eventId, [seeded.id]);
      }
    } else if (primaryOccurrenceId) {
      // Switching the Primary Date from a canonical Location back to manual
      // venue text — clear only this one occurrence's location_id (never
      // delete it) and refresh its venue snapshot to match, so it stops
      // pointing at a Location it no longer represents. Never reaches an
      // Additional Date's own occurrence: primaryOccurrenceId only ever
      // identifies the one covering the Primary Date's own calendar day.
      await admin
        .from("event_occurrences")
        .update({
          location_id: null,
          venue_name: payload.venue_name,
          address: payload.address,
          city: payload.city,
          state: payload.state,
          postal_code: payload.postal_code,
        })
        .eq("id", primaryOccurrenceId);
      await syncOfficialOccurrenceAppearances(admin, primaryOccurrenceId);
    }
  }

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
  const redirectPath = `/account/event/${eventId}?tab=details`;
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
      const { data: event } = await admin.from("events").select("name, city, state").eq("id", eventId).maybeSingle();
      const linked = await createLinkedMarketRequest(admin, {
        text: requestedMarketTextRaw,
        city: event?.city ?? null,
        state: event?.state ?? null,
        source: "event_creation",
        sourceEventId: eventId,
      });
      if (linked.created) {
        // Admin Notification Email Copy Polish pass — event name already
        // fetched above (just added to the select), so the email reads
        // with the real event name instead of a raw id.
        const eventName = event?.name ?? "Unknown event";
        await notifyAdmin({
          subject: `Market/Area request — ${eventName}`,
          heading: "New Market/Area request",
          body: [`Requested: ${requestedMarketTextRaw}`, `Event: ${eventName}`],
          actionLabel: "Review Market Requests",
          actionUrl: "/admin/market-requests",
        });
      }
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
  const redirectPath = `/account/event/${eventId}?tab=details`;
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
 * an already-present business never downgrades its current status.
 *
 * Opportunities + Conversation Foundation V1 — this canonical
 * event_businesses write is the real, authoritative action and always
 * happens exactly as before; the Opportunity/Conversation records built
 * on top of it are additive. Skipped entirely (best-effort, logged, never
 * blocks the invite) when there's no real authenticated user — an
 * admin-elevated session with no personal Supabase Auth session of its
 * own (opportunities.initiator_user_id is NOT NULL, and there is no
 * founder identity to attribute it to) — so Admin Manage-As keeps working
 * exactly as it did before this pass. A CROSSED outcome (the business
 * already applied before this invite) means mutual intent already
 * exists: canonical participation moves straight to 'approved' and the
 * Appearance sync runs once, immediately, rather than waiting on a
 * response to an invitation that's already redundant. */
/** Multi-Date Business Participation Pass 2B — a single-date Event always
 * invites 'all_dates' (there's nothing to choose between — the whole
 * event IS the one date); a multi-date Event honors the organizer's own
 * explicit scope choice. `selectedDateIds` (only meaningful for
 * scope='selected_dates') may mix the synthetic Primary Date id (see
 * lib/data.ts's primaryDateId/isPrimaryDateId) with real occurrence ids —
 * a real occurrence gets a direct event_occurrence_businesses 'invited'
 * row (same shape admin's own addOccurrenceVendor already uses); the
 * Primary Date has no occurrence row to write, so its inclusion is
 * recorded via participation_scope alone and realized on accept (see
 * realizeEventLevelApproval). One event_invitation Opportunity is still
 * created either way — a single conversation/invite card regardless of
 * scope, never a schema change to Opportunity itself. */
export async function inviteParticipatingBusiness(
  eventId: string,
  businessId: string,
  note?: string,
  scope: EventParticipationScope = "all_dates",
  selectedDateIds: string[] = []
) {
  const redirectPath = `/account/event/${eventId}?tab=participants`;
  const admin = await requireEventManager(eventId, redirectPath);

  const sessionSupabase = await getServerSupabase();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();
  if (user && !(await isEmailVerified(admin, user.id))) {
    redirect(appendQuery(redirectPath, { error: "Verify your email before inviting a business." }));
  }

  const { count: occurrenceCount } = await admin.from("event_occurrences").select("id", { count: "exact", head: true }).eq("event_id", eventId);
  const effectiveScope: EventParticipationScope = (occurrenceCount ?? 0) > 0 ? scope : "all_dates";

  const { error } = await admin
    .from("event_businesses")
    .upsert(
      { event_id: eventId, business_id: businessId, status: "invited", participation_scope: effectiveScope },
      { onConflict: "event_id,business_id", ignoreDuplicates: true }
    );
  if (error) redirect(appendQuery(redirectPath, { error: error.message }));

  if (effectiveScope === "selected_dates") {
    const realDateIds = selectedDateIds.filter((id) => !isPrimaryDateId(id));
    if (realDateIds.length > 0) {
      const { data: owned } = await admin.from("event_occurrences").select("id").eq("event_id", eventId).in("id", realDateIds);
      const ownedIds = ((owned ?? []) as { id: string }[]).map((o) => o.id);
      if (ownedIds.length > 0) {
        await admin
          .from("event_occurrence_businesses")
          .upsert(
            ownedIds.map((occurrence_id) => ({ occurrence_id, business_id: businessId, status: "invited" as const })),
            { onConflict: "occurrence_id,business_id", ignoreDuplicates: true }
          );
      }
    }
  }

  if (user) {
    try {
      const outcome = await createOpportunity(admin, {
        type: "event_invitation",
        eventId,
        eventOccurrenceId: null,
        businessId,
        initiatorUserId: user.id,
        initiatorEntityType: "event",
        initiatorEntityId: eventId,
        note: note?.trim() || null,
      });
      if (outcome.kind === "crossed") {
        await admin.from("event_businesses").update({ status: "approved" }).eq("event_id", eventId).eq("business_id", businessId);
        await realizeEventLevelApproval(admin, eventId, businessId);
      }
    } catch (err) {
      console.error("[opportunities] failed to record invitation Opportunity", err);
    }
  }

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
 * approval would.
 *
 * Opportunities + Conversation Foundation V1 — also resolves whichever
 * Opportunity (application OR the organizer's own outstanding invitation
 * — this action's Approve/Decline buttons already cover both, see the
 * Participants tab) is pending for this exact context, recording
 * responded_at and a short system message. Best-effort: a resolution
 * failure never blocks or rolls back the canonical status change above,
 * which remains the real, authoritative effect.
 *
 * Occurrence-Aware Event Participation pass — for approve/decline
 * specifically, this now tries resolveEventApplicationDecision
 * (lib/opportunities.ts) FIRST: if a real EVENT_APPLICATION Opportunity
 * is pending for this context, its occurrence-aware resolution handles
 * everything (event_occurrence_businesses + occurrence Appearance(s) for
 * whichever date(s) were actually applied to — never a whole-event
 * Appearance that's invisible on the public per-occurrence roster). Only
 * when no application Opportunity is found ("not_found" — this action's
 * Approve/Decline buttons also cover the organizer's own outstanding
 * INVITATION, which stays whole-event only, unchanged) does this fall
 * through to the original unscoped whole-event write below. An
 * "ambiguous" legacy application (no occurrence recorded, on an Event
 * that DOES have occurrence rows) refuses approval outright rather than
 * guessing which date(s) were meant. Every status value OTHER than
 * approved/declined (invited/applied/pending) is untouched by any of
 * this — same plain event_businesses write as always. */
export async function updateParticipatingBusinessStatus(eventId: string, businessId: string, status: string) {
  const redirectPath = `/account/event/${eventId}?tab=participants`;
  const admin = await requireEventManager(eventId, redirectPath);

  if (!VALID_PARTICIPATION_STATUSES.includes(status as EventParticipationStatus)) {
    redirect(appendQuery(redirectPath, { error: "Not a valid status." }));
  }

  if (status === "approved" || status === "declined") {
    const decision = await resolveEventApplicationDecision(admin, eventId, businessId, status);

    if (decision.kind === "ambiguous") {
      redirect(
        appendQuery(redirectPath, {
          error:
            "This application doesn't say which date(s) the business applied for. Ask them to submit a new application with specific date(s) selected before you can approve it.",
        })
      );
    }

    if (decision.kind !== "not_found") {
      revalidatePath(redirectPath);
      redirect(appendQuery(redirectPath, { participant_updated: "1" }));
    }
    // "not_found" falls through to the original unscoped whole-event path
    // below — most likely this is resolving the organizer's own
    // outstanding invitation, not an application.
  }

  const { error } = await admin
    .from("event_businesses")
    .update({ status })
    .eq("event_id", eventId)
    .eq("business_id", businessId);
  if (error) redirect(appendQuery(redirectPath, { error: error.message }));

  if (status === "approved") {
    await realizeEventLevelApproval(admin, eventId, businessId);
  } else {
    await declineEventLevelParticipation(admin, eventId, businessId);
  }

  if (status === "approved" || status === "declined") {
    try {
      await resolveOpportunityByContext(
        admin,
        { eventId, eventOccurrenceId: null, businessId },
        status === "approved" ? "accepted" : "declined",
        status === "approved" ? "Approved by the organizer." : "Declined by the organizer."
      );
    } catch (err) {
      console.error("[opportunities] failed to resolve Opportunity for participation status change", err);
    }
  }

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { participant_updated: "1" }));
}

/** Multi-Date Business Participation Pass 2B — SCOPE CHANGE (LOCKED
 * behavior — see this pass's own spec).
 *   all_dates -> selected_dates: reconciles occurrence participation DOWN
 *     to exactly the kept dates (every other occurrence declined + its
 *     Appearance canceled); if the Primary Date isn't in the kept set,
 *     the Event-level Appearance is canceled too. Only ever removes
 *     participation, never adds it beyond what's already approved.
 *   selected_dates -> all_dates: backfills every currently missing date
 *     (ensures the Primary Date Appearance + every current occurrence),
 *     after which future dates auto-propagate via
 *     propagateAllDatesParticipation exactly like any other all_dates
 *     Business.
 * Only ever called on an already-'approved' participant — the scope on a
 * still-pending invitation/application is set at invite/apply time
 * instead (see inviteParticipatingBusiness/applyToEventPublic). */
export async function updateParticipatingBusinessScope(
  eventId: string,
  businessId: string,
  scope: EventParticipationScope,
  keepDateIds: string[] = []
) {
  const redirectPath = `/account/event/${eventId}?tab=participants`;
  const admin = await requireEventManager(eventId, redirectPath);

  const { data: row } = await admin
    .from("event_businesses")
    .select("status")
    .eq("event_id", eventId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!row || (row as { status: string }).status !== "approved") {
    redirect(appendQuery(redirectPath, { error: "Only an already-approved participant's scope can be changed." }));
  }

  const includesPrimary = keepDateIds.includes(primaryDateId(eventId));
  const { error } = await admin
    .from("event_businesses")
    .update({ participation_scope: scope, status: scope === "selected_dates" && !includesPrimary ? "declined" : "approved" })
    .eq("event_id", eventId)
    .eq("business_id", businessId);
  if (error) redirect(appendQuery(redirectPath, { error: error.message }));

  if (scope === "all_dates") {
    await ensureEventAppearance(admin, eventId, businessId);
    await backfillAllDatesParticipation(admin, eventId, businessId);
  } else {
    if (includesPrimary) {
      await ensureEventAppearance(admin, eventId, businessId);
    } else {
      await cancelEventAppearance(admin, eventId, businessId);
    }
    await reconcileOccurrenceParticipationDown(
      admin,
      eventId,
      businessId,
      keepDateIds.filter((id) => !isPrimaryDateId(id))
    );
  }

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { participant_updated: "1" }));
}

/** Remove a participant entirely — reverse-syncs the Appearance(s) and
 * every occurrence-level participation row first (Multi-Date Business
 * Participation Pass 2B — a removed Business is never left publicly
 * visible on any date, all_dates or selected_dates alike), then deletes
 * the event-level roster row. Scoped to (event_id, business_id). */
export async function removeParticipatingBusiness(eventId: string, businessId: string) {
  const redirectPath = `/account/event/${eventId}?tab=participants`;
  const admin = await requireEventManager(eventId, redirectPath);

  await declineEventLevelParticipation(admin, eventId, businessId);
  await admin.from("event_businesses").delete().eq("event_id", eventId).eq("business_id", businessId);

  try {
    await resolveOpportunityByContext(admin, { eventId, eventOccurrenceId: null, businessId }, "withdrawn", "Removed by the organizer.");
  } catch (err) {
    console.error("[opportunities] failed to resolve Opportunity for participant removal", err);
  }

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { participant_removed: "1" }));
}
