"use server";

import { queueLocationGeocode } from "@/lib/geo/geocode-auto";
import { recordProvenance } from "@/lib/provenance";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireBusinessMember, requireEventMember, requireLocationMember } from "@/lib/permissions";
import { isManagingRole, linkBusinessLocation } from "@/lib/business-locations";
import { isPageManagerRole, parseLocationIntent } from "@/lib/capabilities";
import { errorRedirectUrl, errorRedirectUrlWithFields, str } from "@/lib/admin/form-helpers";
import { isSlugTaken } from "@/lib/admin/queries";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { validateImageFile } from "@/lib/imageUploadValidation";
import { validateCustomDestination } from "@/lib/navigation";
import { findExistingGeographyMatch } from "@/lib/market-requests";
import { isAreaInMarket } from "@/lib/admin/market-areas";
import { claimEntityHandle } from "@/lib/handles";
import { findLikelyDuplicateLocations, type CreateInlineLocationResult } from "@/lib/locationCreation";
import { anonymousLocationClientIp, recordAnonymousLocationSubmission } from "@/lib/anonymous-location-rate-limit";
import { resolveEntityGeography } from "@/lib/geo/entity-geo";
import { insertInlinePlace } from "@/lib/places/inline-place";
import { storePublicImage } from "@/lib/image-variants-server";
import { normalizeLocationHours } from "@/lib/locationHours";
import type { LocationHours } from "@/lib/types";

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
 * LOCATION CREATION is the one real exception, and in the OPPOSITE
 * direction from what it might look like: creating a brand-new Location
 * NEVER grants location_members ownership (see createMemberLocation's own
 * doc comment) — submitting one is purely factual directory data. Guest-
 * First Experience Completion pass — the plain, context-free "I'm Just
 * Adding It To Findmi" path needs no identity at all for exactly that
 * reason; asserting a real Business → Location relationship or a
 * management claim still does, and createMemberLocation requires a
 * genuine Supabase Auth session for those, same as createMemberBusiness/
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

  // Original + 160/800/1600 WebP variants via the shared Findmi
  // pipeline (lib/image-variants-server.ts). Server-generated UUID path,
  // byte-detected content type, 1-year cache; a variant failure never
  // fails the upload — the original alone is stored, as before.
  const stored = await storePublicImage(admin, UPLOAD_BUCKET, validated, file);
  if ("error" in stored) return { error: stored.error };

  const { data } = admin.storage.from(UPLOAD_BUCKET).getPublicUrl(stored.path);
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
  market_choice_ambiguous: "Choose an existing Market OR request one, not both.",
  invalid_market: "That market isn't available. Choose another.",
};

/** Submits a Location to Findmi — free, open to anyone signed in (Personal,
 * a Business, or a Location adding a child Location). Starts is_demo=true
 * (pending Admin review; hidden from public reads).
 *
 * Submitting a Location NEVER grants management (lib/capabilities.ts):
 *   - intent "adding" — "I'm Just Adding It To Findmi": no management;
 *   - intent "manage" — "I Manage This Location": files a PENDING
 *     location_claim_requests row; management (location_members) is granted
 *     only when Admin approves it (approve_location_claim).
 * Existence, hierarchy (parent_location_id — containment only), a
 * Business's relationship (business_locations) and management are
 * independent facts. */
export async function createMemberLocation(formData: FormData) {
  const sessionSupabase = await getServerSupabase();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();

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
  // Location Creation + Icon Consistency pass — the real schema/Admin
  // field (locations.postal_code, same column the Admin Location form's
  // own "ZIP Code" field already writes), added to the normal factual
  // user-facing form. No duplicate field, no migration.
  const postalCode = str(formData, "postal_code");
  const marketId = str(formData, "market_id");
  // Location Market -> Area Parity pass — optional, explicit Area within
  // the chosen Market. Never inferred from address/city/state — only from
  // this Market-scoped MarketAreaFields picker.
  const areaId = str(formData, "market_area_id");
  const requestedMarketTextRaw = str(formData, "requested_market_text");
  // Canonical Entity Geography completion pass — see
  // account/business/actions.ts's identical field for the full rule.
  const explicitGeoKey = str(formData, "explicit_geo_key");
  // /account V2 Pass 2 — optional Business context (Presence -> Locations
  // -> Add location). Same form, same validation, same is_demo=true
  // pending-review creation; the only additions are an up-front
  // owner/manager check on that Business and, after the Location exists,
  // connecting it to the Business (first connection becomes primary).
  const businessId = str(formData, "business_id");
  // A child Location (inside a Location the submitter manages).
  const parentLocationId = str(formData, "parent_location_id");
  const intent = parseLocationIntent(formData.get("intent"));
  const preservedFields = {
    business_id: businessId,
    parent_location_id: parentLocationId,
    // The context chooser's "generic" choice has no business_id/
    // parent_location_id of its own to signal "context already resolved"
    // on an error round-trip — without this, a rejected generic
    // submission would bounce back to the chooser instead of back to the
    // (now-populated) factual form. Omitted (falsy) whenever a real
    // Business/Location context is present — those already signal it.
    context: businessId || parentLocationId ? null : "generic",
    intent: intent ?? "",
    name,
    address,
    city,
    state,
    postal_code: postalCode,
    market_id: marketId,
    market_area_id: areaId,
    requested_market_text: requestedMarketTextRaw,
  };
  const fail = (message: string): never => {
    redirect(errorRedirectUrlWithFields(CREATE_LOCATION_PATH, message, preservedFields));
  };

  // Guest-First Experience Completion pass — the one case that needs NO
  // identity at all: "I'm Just Adding It To Findmi" with no Business/
  // parent context. This is purely factual directory data (name/address/
  // city/state/zip) inserted exactly the same way an authenticated
  // generic submission already is — via the admin (service-role) client,
  // is_demo=true, pending Admin review — with zero ownership, membership,
  // claim or Business relationship granted. Adding as a Business or
  // inside a managed Location still asserts a real relationship the
  // submitter must actually hold, so those two keep requiring identity
  // below exactly as the prior Guest-First pass left them.
  const isAnonymousFactualSubmission = intent === "adding" && !businessId && !parentLocationId;

  // Guest-First Creation pass — every OTHER case still establishes
  // identity here, at the real submit, with every typed field preserved
  // through the login round-trip (GuestCreateSubmit auto-resubmits once
  // signed in, `resume=1`).
  if (!user && !isAnonymousFactualSubmission) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(preservedFields)) {
      if (value) params.set(key, value);
    }
    params.set("resume", "1");
    const next = `${CREATE_LOCATION_PATH}?${params.toString()}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!user) {
    const ip = await anonymousLocationClientIp();
    if (recordAnonymousLocationSubmission(ip)) {
      fail("Too many submissions from this device right now. Please try again later.");
    }
  }

  if (businessId) {
    let canManageBusiness = false;
    try {
      canManageBusiness = isManagingRole((await requireBusinessMember(businessId)).role);
    } catch {
      canManageBusiness = false;
    }
    if (!canManageBusiness) fail("You need to be an owner or manager of that business to add a location to it.");
  }

  if (parentLocationId) {
    let canManageParent = false;
    try {
      canManageParent = isPageManagerRole((await requireLocationMember(parentLocationId)).role);
    } catch {
      canManageParent = false;
    }
    if (!canManageParent) fail("You need to manage that Location to add a Location inside it.");
  }

  if (!intent) fail("Choose whether you manage this Location or are just adding it to Findmi.");
  if (!name) fail("Venue name is required.");

  if (marketId && requestedMarketTextRaw) {
    fail("Choose an existing Market OR request one, not both.");
  }

  const duplicate = (await findLikelyDuplicateLocations(admin, { name: name!, address, city, state, postal_code: postalCode }))[0] ?? null;
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
  // Canonical Entity Geography pass — genuinely unmatched geography no
  // longer creates a market_requests row; canonical geography (resolved
  // further below) carries the real signal instead.
  if (requestedMarketTextRaw) {
    const match = await findExistingGeographyMatch(admin, requestedMarketTextRaw);
    if (match) {
      effectiveMarketId = match.marketId;
      effectiveAreaId = match.type === "area" ? (match.areaId ?? null) : null;
    }
  }
  // Server-side backstop — never trusts the client-side MarketAreaFields
  // reset alone; a stale/tampered Area not actually belonging to the
  // effective Market is silently dropped, same posture as saveEvent /
  // updateMemberLocationMarket above.
  if (effectiveAreaId && (!effectiveMarketId || !(await isAreaInMarket(effectiveAreaId, effectiveMarketId)))) {
    effectiveAreaId = null;
  }

  if (effectiveMarketId) {
    const { data: market } = await admin.from("markets").select("id").eq("id", effectiveMarketId).eq("active", true).maybeSingle();
    if (!market) fail(CREATE_LOCATION_FRIENDLY_ERROR.invalid_market);
  }
  // The same columns create_owned_location() wrote — WITHOUT its automatic
  // owner membership (submission never grants management).
  const clean = (v: string | null) => (v && v.trim() ? v.trim() : null);
  const { data: created, error } = await admin
    .from("locations")
    .insert({
      name: name!.trim(),
      slug,
      address: clean(address),
      city: clean(city),
      state: clean(state),
      postal_code: clean(postalCode),
      market_id: effectiveMarketId || null,
      is_demo: true,
      ...(parentLocationId ? { parent_location_id: parentLocationId } : {}),
    })
    .select("id")
    .single();

  if (error || !created) fail("Couldn't add this Location. Please try again.");

  const locationId = (created as { id: string }).id;
  // Automatic Map placement after the response (never blocks creation).
  queueLocationGeocode([locationId]);
  // Submitted by a member of the public (management is a separate request).
  await recordProvenance(admin, { entityType: "location", entityId: locationId, sourceKind: "community", sourceMethod: "member_submitted" });
  // "I Manage This Location" — a request for Admin review, never a grant.
  // The Location itself is already created and stays created either way;
  // a failure here must be reported truthfully (never silently dropped,
  // never re-attempted as a duplicate request) — surfaced below in every
  // redirect branch.
  let claimRequestError: string | null = null;
  if (intent === "manage") {
    // `user!` is safe here: intent "manage" is never the anonymous-
    // eligible case above, so a null user would already have redirected
    // to login before this line is ever reached.
    const { data: profile } = await admin.from("profiles").select("display_name").eq("id", user!.id).maybeSingle();
    const { error: claimError } = await admin.from("location_claim_requests").insert({
      user_id: user!.id,
      location_id: locationId,
      full_name: (profile as { display_name: string | null } | null)?.display_name ?? null,
      email: user!.email ?? null,
      message: businessId ? "Requested while adding this Location for a Business." : parentLocationId ? "Requested while adding this Location inside a managed Location." : "Requested while adding this Location.",
    });
    if (claimError) {
      claimRequestError = "Location was submitted, but your management request could not be recorded. Contact Findmi so we can add it.";
    }
  }
  // Best-effort only — the atomic RPC above already succeeded and never
  // accepts an Area itself (only p_market_id), so this just attaches the
  // already-validated Area as a normal follow-up update, same "best-effort,
  // never rolls back the create" posture createMemberBusiness's own
  // matchedAreaId follow-up uses.
  if (effectiveAreaId) {
    await admin.from("locations").update({ market_area_id: effectiveAreaId }).eq("id", locationId);
  }

  // Canonical Entity Geography pass — best-effort, same posture as the
  // Area follow-up above. Auto-assigns a Market only when nothing above
  // already set one.
  if (city && state) {
    try {
      const geo = await resolveEntityGeography({ explicitKey: explicitGeoKey || undefined, city, state });
      if (geo.status === "resolved" || geo.status === "partial") {
        await admin
          .from("locations")
          .update({ geo_place_key: geo.keys.place, geo_zcta_key: geo.keys.zcta, geo_state_key: geo.keys.state, geo_resolution: explicitGeoKey ? "selected" : "derived" })
          .eq("id", locationId);
        if (!effectiveMarketId && geo.marketSuggestion?.type === "findmi") {
          const { data: marketRow } = await admin.from("markets").select("id").eq("slug", geo.marketSuggestion.market).eq("active", true).maybeSingle();
          if (marketRow) {
            let suggestedAreaId: string | null = null;
            if (geo.marketSuggestion.area) {
              const { data: areaRow } = await admin.from("market_areas").select("id").eq("slug", geo.marketSuggestion.area).eq("market_id", marketRow.id).eq("active", true).maybeSingle();
              suggestedAreaId = areaRow?.id ?? null;
            }
            await admin.from("locations").update({ market_id: marketRow.id, market_area_id: suggestedAreaId }).eq("id", locationId);
          }
        }
      }
    } catch {
      // Never blocks/undoes the already-created location.
    }
  }

  revalidatePath("/account");
  if (businessId) {
    // The Business's relationship to this Location (business_locations) —
    // independent of whether anyone manages the Location. The submitter is
    // Owner/Manager of the Business (checked up front).
    const linked = await linkBusinessLocation(admin, businessId, locationId);
    revalidatePath(`/account/business/${businessId}`);
    const linkError = !linked.ok ? `Your location was created, but couldn't be connected yet: ${linked.error}` : null;
    const combinedError = [linkError, claimRequestError].filter(Boolean).join(" ");
    const query = combinedError ? `error=${encodeURIComponent(combinedError)}` : "location_updated=created";
    redirect(`/account/business/${businessId}?tab=findmi-here&view=locations&${query}`);
  }
  if (parentLocationId) {
    const query = claimRequestError ? `error=${encodeURIComponent(claimRequestError)}` : `child_location=${intent}`;
    redirect(`/account/location/${parentLocationId}?${query}`);
  }
  // Anonymous factual submission — success shown right here (the same
  // page the submission came from, already guest-accessible), never a
  // Login wall, never Account Home, never anything implying ownership or
  // management.
  if (!user) redirect(`${CREATE_LOCATION_PATH}?submitted=1`);
  redirect(claimRequestError ? `/account?error=${encodeURIComponent(claimRequestError)}` : `/account?location_submitted=${intent}`);
}

// ── INLINE EVENT LOCATION CREATION ──────────────────────────────────────
// CreateInlineLocationResult now lives in lib/locationCreation.ts (imported
// above) — shared verbatim with admin/locations/actions.ts's own
// createInlineAdminLocation, so EventLocationField can treat either
// caller's result identically.

/** Find-or-Create V1 — inline PLACE creation for relationship pickers
 * (where an Event, an Event date or a Presence item is happening).
 *
 * Product rule (see components/find-or-create/FindOrCreatePicker.tsx):
 * find existing first; if it doesn't exist and the user may create it,
 * collect the minimum details inline, create it, select it, continue.
 *
 * MEANING — "this physical place exists", nothing more. Unlike
 * createMemberLocation / create_owned_location (which grant the creator
 * location_members 'owner'), this NEVER grants location membership and
 * NEVER creates a business_locations row: Lavazza adding "One Hotel"
 * because it samples there must not make Lavazza (or its employee) the
 * manager/operator of One Hotel. "One of our locations" (Business
 * Locations) remains the separate flow that establishes management.
 *
 * LIFECYCLE — inserted unlisted (is_demo=true): known and immediately
 * linkable through the place picker (scope=place search), not public
 * Discovery. Written with the service-role client after the checks below;
 * only name/slug are required columns (verified against production).
 *
 * AUTHORIZATION — a signed-in account that manages something on Findmi
 * (a business, event or location membership): exactly the people whose
 * workflows reach these pickers. Duplicate-safety: the conservative
 * findLikelyDuplicateLocations check runs first unless the user has
 * explicitly chosen "Add as a new place" (force=1). */
export async function createInlinePlace(formData: FormData): Promise<CreateInlineLocationResult> {
  const sessionSupabase = await getServerSupabase();
  const {
    data: { user },
  } = await sessionSupabase.auth.getUser();
  if (!user) return { status: "error", error: "You need to be signed in to add a place." };

  const admin = getAdminSupabase();
  if (!admin) return { status: "error", error: "Server isn't configured." };

  const [{ count: businessCount }, { count: eventCount }, { count: locationCount }] = await Promise.all([
    admin.from("business_members").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    admin.from("event_members").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    admin.from("location_members").select("id", { count: "exact", head: true }).eq("user_id", user.id),
  ]);
  if (!businessCount && !eventCount && !locationCount) {
    return { status: "error", error: "Places can be added while managing a business or event." };
  }

  return insertInlinePlace(admin, formData);
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
    redirect(appendQuery(redirectPath, { error: "Choose an existing Market OR request one, not both." }));
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
    }
    // Canonical Entity Geography pass — a genuinely unmatched request no
    // longer creates an automatic market_requests row here (removed
    // createLinkedMarketRequest + admin-notify branch, which was also
    // passing a source value the market_requests table's own CHECK
    // constraint never actually allowed — see that migration). A
    // canonical Place outside an established Market is normal now; the
    // location's own canonical geo_* keys (below) carry the real signal.
  }

  if (effectiveAreaId && (!effectiveMarketId || !(await isAreaInMarket(effectiveAreaId, effectiveMarketId)))) {
    effectiveAreaId = null;
  }

  const geoUpdate: Record<string, string | null> = {};
  const { data: location } = await admin.from("locations").select("city, state").eq("id", locationId).maybeSingle();
  if (location?.city && location?.state) {
    try {
      const geo = await resolveEntityGeography({ city: location.city, state: location.state });
      if (geo.status === "resolved" || geo.status === "partial") {
        geoUpdate.geo_place_key = geo.keys.place;
        geoUpdate.geo_zcta_key = geo.keys.zcta;
        geoUpdate.geo_state_key = geo.keys.state;
        geoUpdate.geo_resolution = "derived";
      }
    } catch {
      // Market/Area below still saves even if canonical resolution fails.
    }
  }

  const { error } = await admin
    .from("locations")
    .update({ market_id: effectiveMarketId, market_area_id: effectiveAreaId, ...geoUpdate })
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

// ── HOURS ──────────────────────────────────────────────────────────────
/** Location Manager V3 — the audit's other confirmed gap: locations.hours
 * already drives the public Open Now badge and Hours accordion, but had no
 * owner action at all, only Admin's own LocationHoursField. Same
 * whole-week-JSON-blob parsing admin's own saveLocation already uses for
 * this exact column — no new validation invented, no schema change. */
export async function updateMemberLocationHours(locationId: string, formData: FormData) {
  const redirectPath = `/account/location/${locationId}?tab=hours`;
  const admin = await requireLocationManager(locationId, redirectPath);

  // Location Hours UX — cleaned to the known shape (weekday keys, closed /
  // allDay booleans, "HH:MM" times); malformed input can't be stored.
  const hoursRaw = str(formData, "hours");
  let hours: LocationHours | null = null;
  try {
    hours = hoursRaw ? normalizeLocationHours(JSON.parse(hoursRaw)) : null;
  } catch {
    redirect(appendQuery(redirectPath, { error: "Couldn't read those hours. Please try again." }));
  }

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

// ── Featured Event System — owner override ──────────────────────────────
//
// locations.featured_event_id is only ever a pointer (never a copy of the
// Event's own content — see lib/featured-event.ts, which re-resolves the
// real row on every public read and silently falls back to automatic
// selection if this pointer ever becomes stale/ineligible). This action's
// only job is validating that pointer before writing it: the chosen Event
// must have a real event_occurrences row at this Location — never an
// arbitrary Event id from the client.

/** Sets or clears (empty `event_id`) this Location's manual Featured
 * Event override. */
export async function setLocationFeaturedEvent(locationId: string, formData: FormData) {
  const redirectPath = `/account/location/${locationId}?tab=profile`;
  const admin = await requireLocationManager(locationId, redirectPath);

  const eventId = str(formData, "event_id");
  if (eventId) {
    const { data: occurrence } = await admin
      .from("event_occurrences")
      .select("id")
      .eq("event_id", eventId)
      .eq("location_id", locationId)
      .limit(1)
      .maybeSingle();
    if (!occurrence) redirect(appendQuery(redirectPath, { error: "You can only feature an Event that occurs at this Location." }));
  }

  const { data: location, error } = await admin
    .from("locations")
    .update({ featured_event_id: eventId })
    .eq("id", locationId)
    .select("slug, is_demo")
    .maybeSingle();
  if (error) redirect(appendQuery(redirectPath, { error: error.message }));

  revalidatePath(redirectPath);
  if (location && !location.is_demo) revalidatePath(`/location/${location.slug}`);
  redirect(appendQuery(redirectPath, { saved: "1" }));
}
