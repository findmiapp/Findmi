"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireEventMember, requireLocationMember } from "@/lib/permissions";
import { errorRedirectUrl, errorRedirectUrlWithFields, str } from "@/lib/admin/form-helpers";
import { isSlugTaken } from "@/lib/admin/queries";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { validateImageFile } from "@/lib/imageUploadValidation";
import { validateCustomDestination } from "@/lib/navigation";
import { createLinkedMarketRequest, findExistingGeographyMatch } from "@/lib/market-requests";
import { isAreaInMarket } from "@/lib/admin/market-areas";
import { claimEntityHandle } from "@/lib/handles";
import { notifyAdmin } from "@/lib/notifications/adminNotify";
import { findLikelyDuplicateLocations, type CreateInlineLocationResult } from "@/lib/locationCreation";

const UPLOAD_BUCKET = "findmi-media";

/**
 * Multi-Entity Self-Service V1, Stage 3 — Location self-service + Location
 * Manager. Every write action below follows the exact same authorize-
 * then-elevate shape as account/business/actions.ts and account/event/
 * actions.ts (requireLocationMember() is itself the complete
 * authorization — a real location_members row OR an explicit founder
 * admin session, never impersonation — see lib/permissions.ts). Every
 * action here is ENTITY-SCOPED (edits the managed location's own content;
 * no column anywhere in this file records a personal/financial actor
 * identity), so none of them need to reject admin elevation. Native
 * LOCATION CREATION is the one exception: creating a brand-new location is
 * inherently tied to a real user's own identity (they become its
 * location_members owner), so createMemberLocation below requires a
 * genuine Supabase Auth session, same as createMemberBusiness/
 * createMemberEvent do for businesses/events.
 */

function appendQuery(base: string, params: Record<string, string>): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${new URLSearchParams(params).toString()}`;
}

/** The one shared authorization chokepoint for every Location Manager
 * mutation below — mirrors account/event/actions.ts's requireEventManager
 * exactly. Location has no plan tier / entitlement gate of its own (see
 * this stage's Locked LOCATION ACCESS/ENTITLEMENT rule — free for every
 * signed-in user, no Business Pro or Event Management requirement), so
 * there's no Pro-gated variant of this helper the way Business has one. */
async function requireLocationManager(locationId: string, redirectPath: string): Promise<SupabaseClient> {
  try {
    await requireLocationMember(locationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to this location.";
    redirect(errorRedirectUrl(redirectPath, message));
  }
  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl(redirectPath, "Server isn't configured."));
  return admin;
}

// ── Member image upload — same shape as account/business/actions.ts's
// uploadMemberBusinessImage / account/event/actions.ts's
// uploadMemberEventImage, gated by requireLocationMember instead. ────────
export async function uploadMemberLocationImage(
  locationId: string,
  formData: FormData
): Promise<{ url?: string; error?: string }> {
  try {
    await requireLocationMember(locationId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "You don't have access to this location." };
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

// ── NATIVE LOCATION CREATION ─────────────────────────────────────────────
const CREATE_LOCATION_PATH = "/account/location/new";

// findLikelyDuplicateLocations moved to lib/locationCreation.ts (Admin
// Event Location Relationship UX pass) so admin/locations/actions.ts's own
// authorized createInlineAdminLocation can share the exact same duplicate
// check without importing across the admin/public route boundary or
// duplicating this logic — see that module's own doc comment.

const CREATE_LOCATION_FRIENDLY_ERROR: Record<string, string> = {
  user_required: "You need to be signed in to create a venue.",
  name_required: "Venue name is required.",
  slug_required: "Venue name is required to generate a URL.",
  market_choice_ambiguous: "Choose an existing Market OR request one — not both.",
  invalid_market: "That market isn't available. Choose another.",
};

/** Creates a brand-new Location natively — free, no entitlement gate,
 * starting is_demo=true (hidden from every public discovery/detail query
 * — see getLocationBySlug()/getLocations() in lib/data.ts) via
 * create_owned_location(), never accepted as input here or by that RPC.
 * The authenticated creator becomes its owner atomically with the
 * location itself (same RPC, one transaction). Location ownership is
 * deliberately independent of Business ownership — see this stage's
 * Locked Product Model — so this action never touches business_members or
 * requires any existing business. */
export async function createMemberLocation(formData: FormData) {
  const sessionSupabase = await getServerSupabase();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(CREATE_LOCATION_PATH)}`);

  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl(CREATE_LOCATION_PATH, "Server isn't configured."));

  // Event Creation + Pending Review UX pass — same fix as
  // createMemberEvent: every submitted field is read once, up front, and
  // carried through `preservedFields` into every error redirect via
  // `fail()`, so a rejected submission (including a detected duplicate)
  // never wipes what the visitor already typed.
  const name = str(formData, "name");
  const address = str(formData, "address");
  const city = str(formData, "city");
  const state = str(formData, "state");
  const marketId = str(formData, "market_id");
  // Location Market -> Area Parity pass — optional, explicit Area within
  // the chosen Market. Never inferred from address/city/state — only from
  // this Market-scoped MarketAreaFields picker.
  const areaId = str(formData, "market_area_id");
  const requestedMarketTextRaw = str(formData, "requested_market_text");
  const preservedFields = {
    name,
    address,
    city,
    state,
    market_id: marketId,
    market_area_id: areaId,
    requested_market_text: requestedMarketTextRaw,
  };
  const fail = (message: string): never => {
    redirect(errorRedirectUrlWithFields(CREATE_LOCATION_PATH, message, preservedFields));
  };

  if (!name) fail("Venue name is required.");

  if (marketId && requestedMarketTextRaw) {
    fail("Choose an existing Market OR request one — not both.");
  }

  const duplicate = (await findLikelyDuplicateLocations(admin, { name: name!, address, city, state }))[0] ?? null;
  if (duplicate) {
    redirect(
      errorRedirectUrlWithFields(
        CREATE_LOCATION_PATH,
        "We found a venue that looks like a match. Claim it instead of creating a duplicate.",
        { ...preservedFields, duplicate_slug: duplicate.slug, duplicate_name: duplicate.name }
      )
    );
  }

  const baseSlug = resolveSlugInput(null, name);
  if (!baseSlug) fail("Venue name is required to generate a URL.");
  const slug = await ensureUniqueSlug(baseSlug, (candidate) => isSlugTaken("locations", candidate));

  // Same "check for an existing Market/Area match before falling back to
  // a Market Request" shape createMemberBusiness/createMemberEvent use.
  let effectiveMarketId = marketId;
  let effectiveAreaId = areaId;
  let effectiveRequestedMarketText = requestedMarketTextRaw;
  if (requestedMarketTextRaw) {
    const match = await findExistingGeographyMatch(admin, requestedMarketTextRaw);
    if (match) {
      effectiveMarketId = match.marketId;
      effectiveAreaId = match.type === "area" ? (match.areaId ?? null) : null;
      effectiveRequestedMarketText = null;
    }
  }
  // Server-side backstop — never trusts the client-side MarketAreaFields
  // reset alone; a stale/tampered Area not actually belonging to the
  // effective Market is silently dropped, same posture as saveEvent /
  // updateMemberLocationMarket above.
  if (effectiveAreaId && (!effectiveMarketId || !(await isAreaInMarket(effectiveAreaId, effectiveMarketId)))) {
    effectiveAreaId = null;
  }

  const { data: created, error } = await admin.rpc("create_owned_location", {
    p_user_id: user.id,
    p_name: name,
    p_slug: slug,
    p_address: address,
    p_city: city,
    p_state: state,
    p_market_id: effectiveMarketId,
    p_requested_market_text: effectiveRequestedMarketText,
  });

  if (error || !created) {
    const message = CREATE_LOCATION_FRIENDLY_ERROR[error?.message ?? ""] ?? "Couldn't create your venue. Please try again.";
    fail(message);
  }

  const locationId = (created as { id: string }).id;
  // Best-effort only — the atomic RPC above already succeeded and never
  // accepts an Area itself (only p_market_id), so this just attaches the
  // already-validated Area as a normal follow-up update, same "best-effort,
  // never rolls back the create" posture createMemberBusiness's own
  // matchedAreaId follow-up uses.
  if (effectiveAreaId) {
    await admin.from("locations").update({ market_area_id: effectiveAreaId }).eq("id", locationId);
  }
  revalidatePath("/account");
  redirect(`/account/location/${locationId}?created=1`);
}

// ── INLINE EVENT LOCATION CREATION ──────────────────────────────────────
// CreateInlineLocationResult now lives in lib/locationCreation.ts (imported
// above) — shared verbatim with admin/locations/actions.ts's own
// createInlineAdminLocation, so EventLocationField can treat either
// caller's result identically.

/** "Add New Location" from inside the Event workflow (EventLocationField) —
 * a non-redirecting counterpart to createMemberLocation above, for a caller
 * that's a client component embedded in someone else's <form> (the Event's
 * own) rather than a page of its own, and needs the result back as data
 * (same "return {url?, error?} instead of redirecting" shape
 * uploadMemberLocationImage already established for exactly this reason).
 * Deliberately reuses createMemberLocation's own building blocks — the
 * same findLikelyDuplicateLocations check, the same create_owned_location
 * RPC (so the organizer becomes this Location's owner/manager, identical to
 * the standalone /account/location/new flow — see this action's own
 * OWNERSHIP note below), the same slug generation, the same friendly error
 * map — never a second, competing creation path. Intentionally does NOT
 * expose Market/Area here: the inline panel is a deliberately minimal
 * "establish the venue" form (see this pass's own spec), and
 * create_owned_location already treats Market as optional — the organizer
 * (or whoever ends up managing this Location) can set it later from
 * Location Manager, exactly like an event with no Market yet.
 *
 * OWNERSHIP — create_owned_location grants the creator 'owner' in
 * location_members atomically with the Location itself; there is no
 * "created-by-but-not-owner" variant in the current schema, and this
 * action deliberately does not invent one — it reuses the RPC exactly as
 * the standalone Location creation flow already does, so an organizer who
 * adds a venue inline gets the same free ownership/management rights
 * they'd get from /account/location/new. This is unchanged, existing
 * product behavior, not a new permission grant introduced by this pass.
 *
 * PUBLICATION — create_owned_location hardcodes is_demo=true (never
 * accepted as input), so a newly created Location starts exactly as
 * unpublished/hidden from public discovery as any other native Location —
 * this action does not, and could not, bypass that. The Event's own
 * relational reference (event_occurrences.location_id) is unaffected by
 * is_demo — see updateMemberEventLocation/createMemberEvent, which write
 * that relationship regardless of the target Location's publication
 * state — but public Event/Location rendering's own existing is_demo
 * checks continue to gate what's shown publicly, exactly as before. */
export async function createInlineLocation(formData: FormData): Promise<CreateInlineLocationResult> {
  const sessionSupabase = await getServerSupabase();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();
  if (!user) return { status: "error", error: "You need to be signed in to add a venue." };

  const admin = getAdminSupabase();
  if (!admin) return { status: "error", error: "Server isn't configured." };

  const name = str(formData, "name");
  const address = str(formData, "address");
  const city = str(formData, "city");
  const state = str(formData, "state");
  const postalCode = str(formData, "postal_code");
  const force = str(formData, "force") === "1";

  if (!name) return { status: "error", error: "Venue name is required." };

  if (!force) {
    const duplicates = await findLikelyDuplicateLocations(admin, { name, address, city, state });
    if (duplicates.length > 0) return { status: "duplicates", duplicates };
  }

  const baseSlug = resolveSlugInput(null, name);
  if (!baseSlug) return { status: "error", error: "Venue name is required to generate a URL." };
  const slug = await ensureUniqueSlug(baseSlug, (candidate) => isSlugTaken("locations", candidate));

  const { data: created, error } = await admin.rpc("create_owned_location", {
    p_user_id: user.id,
    p_name: name,
    p_slug: slug,
    p_address: address,
    p_city: city,
    p_state: state,
  });
  if (error || !created) {
    const message = CREATE_LOCATION_FRIENDLY_ERROR[error?.message ?? ""] ?? "Couldn't create your venue. Please try again.";
    return { status: "error", error: message };
  }

  const locationRow = created as { id: string; slug: string; name: string; address: string | null; city: string | null; state: string | null };
  // Best-effort follow-up, same non-rolling-back posture as
  // createMemberLocation's own market_area_id follow-up above —
  // create_owned_location has no p_postal_code parameter (the standalone
  // /account/location/new form doesn't collect one either), so this is a
  // plain, ordinary update to an already-nullable column, not a new RPC
  // parameter or schema change.
  if (postalCode) {
    await admin.from("locations").update({ postal_code: postalCode }).eq("id", locationRow.id);
  }

  revalidatePath("/account");
  return {
    status: "created",
    location: {
      id: locationRow.id,
      name: locationRow.name,
      slug: locationRow.slug,
      category: null,
      address: locationRow.address,
      city: locationRow.city,
      state: locationRow.state,
      postal_code: postalCode || null,
    },
  };
}

// ── VENUE DETAILS ──────────────────────────────────────────────────────
/** Owner-facing "Venue Details" — description + hero/cover image. Name is
 * intentionally NOT editable here (mirrors Location's admin-managed slug
 * discipline — a Location's identity/URL stays admin-controlled for V1,
 * unlike Business/Event which allow owner renames); an owner who needs
 * their venue's name corrected can reach the founder the same way any
 * other admin-only change is requested. */
// ── FindMi Global Handle Registry — Venue username ───────────────────────
// Same posture as updateBusinessHandle in account/business/actions.ts:
// never mandatory, never auto-generated, same requireLocationManager
// authorization every other Location Manager mutation already uses.
export async function updateMemberLocationHandle(locationId: string, formData: FormData) {
  const redirectPath = `/account/location/${locationId}`;
  const admin = await requireLocationManager(locationId, redirectPath);

  const usernameRaw = str(formData, "username");
  if (!usernameRaw) redirect(appendQuery(redirectPath, { error: "Enter a username first." }));

  const sessionSupabase = await getServerSupabase();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();

  const result = await claimEntityHandle(admin, "location", locationId, usernameRaw, user?.id ?? null);
  if (!result.ok) redirect(appendQuery(redirectPath, { error: result.error ?? "Couldn't save that username." }));

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { handle_saved: "1" }));
}

export async function updateMemberLocationDetails(locationId: string, formData: FormData) {
  const redirectPath = `/account/location/${locationId}?tab=profile`;
  const admin = await requireLocationManager(locationId, redirectPath);

  const payload = {
    description: str(formData, "description"),
    cover_image_url: str(formData, "cover_image_url"),
    logo_url: str(formData, "logo_url"),
  };

  const { data: location, error } = await admin
    .from("locations")
    .update(payload)
    .eq("id", locationId)
    .select("slug, is_demo")
    .maybeSingle();
  if (error) redirect(appendQuery(redirectPath, { error: error.message }));

  revalidatePath(redirectPath);
  if (location && !location.is_demo) revalidatePath(`/location/${location.slug}`);
  redirect(appendQuery(redirectPath, { saved: "1" }));
}

// ── CONTACT / LINKS ────────────────────────────────────────────────────
export async function updateMemberLocationContact(locationId: string, formData: FormData) {
  const redirectPath = `/account/location/${locationId}?tab=profile`;
  const admin = await requireLocationManager(locationId, redirectPath);

  const websiteUrlRaw = str(formData, "website_url");
  let website_url: string | null = null;
  if (websiteUrlRaw) {
    const result = validateCustomDestination(websiteUrlRaw);
    if (!result.ok) redirect(appendQuery(redirectPath, { error: `Website: ${result.error}` }));
    website_url = result.value;
  }

  const payload = {
    website_url,
    email: str(formData, "email"),
    phone: str(formData, "phone"),
  };

  const { data: location, error } = await admin
    .from("locations")
    .update(payload)
    .eq("id", locationId)
    .select("slug, is_demo")
    .maybeSingle();
  if (error) redirect(appendQuery(redirectPath, { error: error.message }));

  revalidatePath(redirectPath);
  if (location && !location.is_demo) revalidatePath(`/location/${location.slug}`);
  redirect(appendQuery(redirectPath, { saved: "1" }));
}

// ── MARKET / AREA ──────────────────────────────────────────────────────
/** Owner-facing Market selection — reuses the exact same "check for an
 * existing Market/Area match, fall back to a linked, admin-reviewable
 * Market Request" logic every other creation/update action in this pass
 * uses. */
export async function updateMemberLocationMarket(locationId: string, formData: FormData) {
  const redirectPath = `/account/location/${locationId}?tab=profile`;
  const admin = await requireLocationManager(locationId, redirectPath);

  const marketId = str(formData, "market_id");
  const requestedMarketTextRaw = str(formData, "requested_market_text");
  if (marketId && requestedMarketTextRaw) {
    redirect(appendQuery(redirectPath, { error: "Choose an existing Market OR request one — not both." }));
  }

  let effectiveMarketId = marketId;
  // Location Market -> Area Parity pass — explicit Area picked via
  // MarketAreaFields is just as authoritative as a matched one below, same
  // "manual pick vs. free-text match, mutually exclusive" shape saveEvent
  // already uses. Re-validated against whichever Market ends up effective
  // either way — never trusts the client-side reset alone.
  let effectiveAreaId = str(formData, "market_area_id");
  if (requestedMarketTextRaw) {
    const match = await findExistingGeographyMatch(admin, requestedMarketTextRaw);
    if (match) {
      effectiveMarketId = match.marketId;
      effectiveAreaId = match.type === "area" ? (match.areaId ?? null) : null;
    } else {
      const { data: location } = await admin.from("locations").select("name, city, state").eq("id", locationId).maybeSingle();
      const linked = await createLinkedMarketRequest(admin, {
        text: requestedMarketTextRaw,
        city: location?.city ?? null,
        state: location?.state ?? null,
        source: "location_creation",
        sourceLocationId: locationId,
      });
      if (linked.created) {
        // Admin Notification Email Copy Polish pass — venue name already
        // fetched above (just added to the select), so the email reads
        // with the real venue name instead of a raw id.
        const venueName = location?.name ?? "Unknown venue";
        await notifyAdmin({
          subject: `Market/Area request — ${venueName}`,
          heading: "New Market/Area request",
          body: [`Requested: ${requestedMarketTextRaw}`, `Venue: ${venueName}`],
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
    .from("locations")
    .update({ market_id: effectiveMarketId, market_area_id: effectiveAreaId })
    .eq("id", locationId);
  if (error) redirect(appendQuery(redirectPath, { error: error.message }));

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { saved: "1" }));
}

// ── PHOTOS ─────────────────────────────────────────────────────────────
/** Venue gallery — same "current config, wholesale replace on every save"
 * shape admin's own saveEvent()/business gallery actions use for their
 * own image child tables. */
export async function updateMemberLocationPhotos(locationId: string, formData: FormData) {
  const redirectPath = `/account/location/${locationId}?tab=profile`;
  const admin = await requireLocationManager(locationId, redirectPath);

  const galleryUrls = formData.getAll("gallery_image_url").map(String).filter(Boolean);
  await admin.from("location_images").delete().eq("location_id", locationId);
  if (galleryUrls.length > 0) {
    await admin
      .from("location_images")
      .insert(galleryUrls.map((url, i) => ({ location_id: locationId, url, display_order: i })));
  }

  const { data: location } = await admin.from("locations").select("slug, is_demo").eq("id", locationId).maybeSingle();
  revalidatePath(redirectPath);
  if (location && !location.is_demo) revalidatePath(`/location/${location.slug}`);
  redirect(appendQuery(redirectPath, { saved: "1" }));
}

// ── WHAT'S HAPPENING HERE ────────────────────────────────────────────────
/** "Add Existing Event Here" — connects one or more of an ALREADY-OWNED
 * Event's own occurrences to this Location, by setting
 * event_occurrences.location_id (the same real, canonical relationship
 * Event Manager's own Dates tab already writes to — never a second
 * location_events-style table). Requires the acting account to manage
 * BOTH this Location AND the target Event — requireEventMember() throws
 * (never silently rewriting someone else's Event) if they only manage the
 * Location. Scoped by both occurrence id and event_id on the write itself,
 * so a crafted occurrence id belonging to a different event can never be
 * picked up. Vendor participation (event_occurrence_businesses) is never
 * touched by this — only the occurrence's own location_id. */
export async function assignExistingEventOccurrencesToLocation(locationId: string, eventId: string, formData: FormData) {
  const redirectPath = `/account/location/${locationId}?tab=happening`;
  const admin = await requireLocationManager(locationId, redirectPath);

  try {
    await requireEventMember(eventId);
  } catch {
    redirect(errorRedirectUrl(redirectPath, "You don't manage that event, so it can't be added here."));
  }

  const occurrenceIds = formData.getAll("occurrence_ids").map(String).filter(Boolean);
  if (occurrenceIds.length === 0) {
    redirect(errorRedirectUrl(redirectPath, "Choose at least one date to assign to this venue."));
  }

  const { error } = await admin
    .from("event_occurrences")
    .update({ location_id: locationId })
    .eq("event_id", eventId)
    .in("id", occurrenceIds);
  if (error) redirect(errorRedirectUrl(redirectPath, "Couldn't assign that date. Please try again."));

  revalidatePath(redirectPath);
  revalidatePath(`/account/event/${eventId}`);
  const { data: location } = await admin.from("locations").select("slug, is_demo").eq("id", locationId).maybeSingle();
  if (location && !location.is_demo) revalidatePath(`/location/${location.slug}`);
  redirect(appendQuery(redirectPath, { event_added: "1" }));
}

// ── PROFILE — CATEGORY ───────────────────────────────────────────────────
/** Location Manager V3 — the audit's confirmed gap: locations.category_id
 * already exists and is publicly rendered (the category pill on the
 * public page), but had no owner action at all, only Admin's own
 * LocationForm. Same shape/kind='location' taxonomy CategorySubcategoryField
 * already uses elsewhere; no new taxonomy, no schema change. */
export async function updateMemberLocationCategory(locationId: string, formData: FormData) {
  const redirectPath = `/account/location/${locationId}?tab=profile`;
  const admin = await requireLocationManager(locationId, redirectPath);

  const categoryId = str(formData, "category_id");

  const { data: location, error } = await admin
    .from("locations")
    .update({ category_id: categoryId })
    .eq("id", locationId)
    .select("slug, is_demo")
    .maybeSingle();
  if (error) redirect(appendQuery(redirectPath, { error: error.message }));

  revalidatePath(redirectPath);
  if (location && !location.is_demo) revalidatePath(`/location/${location.slug}`);
  redirect(appendQuery(redirectPath, { saved: "1" }));
}

// ── PROFILE — HOURS ────────────────────────────────────────────────────
/** Location Manager V3 — the audit's other confirmed gap: locations.hours
 * already drives the public Open Now badge and Hours accordion, but had no
 * owner action at all, only Admin's own LocationHoursField. Same
 * whole-week-JSON-blob parsing admin's own saveLocation already uses for
 * this exact column — no new validation invented, no schema change. */
export async function updateMemberLocationHours(locationId: string, formData: FormData) {
  const redirectPath = `/account/location/${locationId}?tab=profile`;
  const admin = await requireLocationManager(locationId, redirectPath);

  const hoursRaw = str(formData, "hours");
  const hours = hoursRaw ? JSON.parse(hoursRaw) : null;

  const { data: location, error } = await admin
    .from("locations")
    .update({ hours })
    .eq("id", locationId)
    .select("slug, is_demo")
    .maybeSingle();
  if (error) redirect(appendQuery(redirectPath, { error: error.message }));

  revalidatePath(redirectPath);
  if (location && !location.is_demo) revalidatePath(`/location/${location.slug}`);
  redirect(appendQuery(redirectPath, { saved: "1" }));
}
