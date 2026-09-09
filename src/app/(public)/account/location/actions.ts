"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireLocationMember } from "@/lib/permissions";
import { errorRedirectUrl, errorRedirectUrlWithFields, str } from "@/lib/admin/form-helpers";
import { isSlugTaken } from "@/lib/admin/queries";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { validateImageFile } from "@/lib/imageUploadValidation";
import { validateCustomDestination } from "@/lib/navigation";
import { createLinkedMarketRequest, findExistingGeographyMatch } from "@/lib/market-requests";
import { claimEntityHandle } from "@/lib/handles";
import { notifyAdmin } from "@/lib/notifications/adminNotify";

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

function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Practical, non-fuzzy duplicate check — same shape/reasoning as
 * findLikelyDuplicateBusiness (account/business/actions.ts): a normalized
 * name match that ALSO agrees on city/state whenever both sides have one,
 * or an exact address match. Demo rows are never candidates — a seeded/
 * pending Location is still visible here (is_demo doesn't distinguish
 * "real but unpublished" from "seed data" the way businesses'
 * publication_status does), so this deliberately checks every Location
 * regardless of is_demo — the goal is catching a genuine duplicate venue,
 * not filtering by moderation state. A match never auto-creates a second
 * Location; the visitor is directed to the existing Claim Location flow
 * instead. */
async function findLikelyDuplicateLocation(
  admin: SupabaseClient,
  input: { name: string; address: string | null; city: string | null; state: string | null }
): Promise<{ slug: string; name: string } | null> {
  const { data } = await admin.from("locations").select("slug, name, address, city, state");
  const rows = (data ?? []) as { slug: string; name: string; address: string | null; city: string | null; state: string | null }[];

  const inputAddress = input.address ? normalizeForMatch(input.address) : null;
  if (inputAddress) {
    for (const row of rows) {
      if (row.address && normalizeForMatch(row.address) === inputAddress) return row;
    }
  }

  const normalizedName = normalizeForMatch(input.name);
  for (const row of rows) {
    if (normalizeForMatch(row.name) !== normalizedName) continue;
    const cityMatches = !input.city || !row.city || normalizeForMatch(input.city) === normalizeForMatch(row.city);
    const stateMatches = !input.state || !row.state || normalizeForMatch(input.state) === normalizeForMatch(row.state);
    if (cityMatches && stateMatches) return row;
  }

  return null;
}

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
  const requestedMarketTextRaw = str(formData, "requested_market_text");
  const preservedFields = {
    name,
    address,
    city,
    state,
    market_id: marketId,
    requested_market_text: requestedMarketTextRaw,
  };
  const fail = (message: string): never => {
    redirect(errorRedirectUrlWithFields(CREATE_LOCATION_PATH, message, preservedFields));
  };

  if (!name) fail("Venue name is required.");

  if (marketId && requestedMarketTextRaw) {
    fail("Choose an existing Market OR request one — not both.");
  }

  const duplicate = await findLikelyDuplicateLocation(admin, { name: name!, address, city, state });
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
  let effectiveRequestedMarketText = requestedMarketTextRaw;
  if (requestedMarketTextRaw) {
    const match = await findExistingGeographyMatch(admin, requestedMarketTextRaw);
    if (match) {
      effectiveMarketId = match.marketId;
      effectiveRequestedMarketText = null;
    }
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
  revalidatePath("/account");
  redirect(`/account/location/${locationId}?created=1`);
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
  const redirectPath = `/account/location/${locationId}?tab=details`;
  const admin = await requireLocationManager(locationId, redirectPath);

  const payload = {
    description: str(formData, "description"),
    cover_image_url: str(formData, "cover_image_url"),
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
  const redirectPath = `/account/location/${locationId}?tab=contact`;
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
  const redirectPath = `/account/location/${locationId}?tab=market`;
  const admin = await requireLocationManager(locationId, redirectPath);

  const marketId = str(formData, "market_id");
  const requestedMarketTextRaw = str(formData, "requested_market_text");
  if (marketId && requestedMarketTextRaw) {
    redirect(appendQuery(redirectPath, { error: "Choose an existing Market OR request one — not both." }));
  }

  let effectiveMarketId = marketId;
  if (requestedMarketTextRaw) {
    const match = await findExistingGeographyMatch(admin, requestedMarketTextRaw);
    if (match) {
      effectiveMarketId = match.marketId;
    } else {
      const { data: location } = await admin.from("locations").select("city, state").eq("id", locationId).maybeSingle();
      const linked = await createLinkedMarketRequest(admin, {
        text: requestedMarketTextRaw,
        city: location?.city ?? null,
        state: location?.state ?? null,
        source: "location_creation",
        sourceLocationId: locationId,
      });
      if (linked.created) {
        await notifyAdmin({
          subject: `New Market/Area request — ${requestedMarketTextRaw}`,
          heading: "New Market/Area request",
          body: [`Requested: ${requestedMarketTextRaw}`, `Linked to: Venue (id ${locationId})`],
          actionLabel: "Review Market Requests",
          actionUrl: "/admin/market-requests",
        });
      }
    }
  }

  const { error } = await admin.from("locations").update({ market_id: effectiveMarketId }).eq("id", locationId);
  if (error) redirect(appendQuery(redirectPath, { error: error.message }));

  revalidatePath(redirectPath);
  redirect(appendQuery(redirectPath, { saved: "1" }));
}

// ── PHOTOS ─────────────────────────────────────────────────────────────
/** Venue gallery — same "current config, wholesale replace on every save"
 * shape admin's own saveEvent()/business gallery actions use for their
 * own image child tables. */
export async function updateMemberLocationPhotos(locationId: string, formData: FormData) {
  const redirectPath = `/account/location/${locationId}?tab=photos`;
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
