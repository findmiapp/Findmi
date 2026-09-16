"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { isSlugTaken } from "@/lib/admin/queries";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { isAreaInMarket } from "@/lib/admin/market-areas";
import { getEntityManagerEmails } from "@/lib/notifications/recipients";
import { sendProductNotification } from "@/lib/notifications/productNotify";
import { findLikelyDuplicateLocations, type CreateInlineLocationResult } from "@/lib/locationCreation";

/** Location review-decision notification — every CURRENT location_members
 * recipient, same shape as notifyBusinessOwners/notifyEventOrganizers
 * (admin/businesses|events/actions.ts). Location's own review state is
 * just the one is_demo boolean (no separate rejected/paused states exist
 * for Location, unlike Business/Event's richer publication_status) — so
 * "approved" is the true->false transition and "rejected" is the
 * false->true transition; copy is worded to stay honest either way
 * (a first review decision, or a later un-publish) since the schema
 * can't distinguish those two cases from each other. Best-effort: a
 * Resend failure never affects the save that already committed. */
async function notifyLocationManagers(
  supabase: SupabaseClient,
  locationId: string,
  locationName: string,
  outcome: "approved" | "rejected"
): Promise<void> {
  const to = await getEntityManagerEmails(supabase, "location", locationId);
  const copy =
    outcome === "approved"
      ? {
          type: "location_approved",
          subject: `Your venue is now live — ${locationName}`,
          heading: "Your venue is now live",
          body: [`${locationName} has been approved and is now visible on Findmi.`],
        }
      : {
          type: "location_rejected",
          subject: `Update on your venue — ${locationName}`,
          heading: "Your venue isn't visible on Findmi",
          body: [
            `${locationName} isn't visible on Findmi right now.`,
            "You can review your venue details — it can be made visible again once it's ready.",
          ],
        };

  await sendProductNotification({
    to,
    type: copy.type,
    subject: copy.subject,
    heading: copy.heading,
    body: copy.body,
    actionLabel: `Manage ${locationName}`,
    actionUrl: `/account/location/${locationId}`,
  });
}

export async function saveLocation(id: string | null, formData: FormData) {
  const editPath = id ? `/admin/locations/${id}` : "/admin/locations/new";
  const supabase = await requireAdminSupabase();

  const name = str(formData, "name");
  if (!name) {
    redirect(errorRedirectUrl(editPath, "Name is required."));
  }

  // Slug safety can't depend on client JS having run: normalize whatever
  // was submitted, fall back to generating one from the name if it's
  // blank, then resolve any collision with a deterministic -2/-3 suffix.
  const baseSlug = resolveSlugInput(str(formData, "slug"), name);
  if (!baseSlug) {
    redirect(errorRedirectUrl(editPath, "Name is required to generate a slug."));
  }
  const slug = await ensureUniqueSlug(baseSlug, (candidate) =>
    isSlugTaken("locations", candidate, id ?? undefined)
  );

  // Location Market -> Area Parity pass — same server-side backstop
  // saveEvent uses: a submitted market_area_id is only ever written when it
  // actually belongs to the submitted market_id, never trusting the
  // client-side MarketAreaFields reset alone. An incompatible/stale pair
  // silently drops the Area (never blocks the whole save), same posture as
  // saveEvent's own effectiveAreaId handling.
  const marketId = str(formData, "market_id");
  let areaId = str(formData, "market_area_id");
  if (areaId && (!marketId || !(await isAreaInMarket(areaId, marketId)))) {
    areaId = null;
  }

  // Location V2 — the hours editor submits the whole week as one JSON
  // blob (empty string = no hours entered = hide the section), same
  // "hidden input carries client state" shape CategorySubcategoryField's
  // own category_id already uses.
  const hoursRaw = str(formData, "hours");
  const hours = hoursRaw ? JSON.parse(hoursRaw) : null;

  const payload = {
    name,
    slug,
    address: str(formData, "address"),
    city: str(formData, "city"),
    state: str(formData, "state"),
    postal_code: str(formData, "postal_code"),
    latitude: num(formData, "latitude"),
    longitude: num(formData, "longitude"),
    is_demo: !bool(formData, "published"),
    market_id: marketId,
    market_area_id: areaId,
    category_id: str(formData, "category_id"),
    description: str(formData, "description"),
    cover_image_url: str(formData, "cover_image_url"),
    logo_url: str(formData, "logo_url"),
    website_url: str(formData, "website_url"),
    email: str(formData, "email"),
    phone: str(formData, "phone"),
    hours,
  };

  let locationId = id;
  if (locationId) {
    // Read the prior is_demo BEFORE overwriting it, so a review-decision
    // email only fires on a genuine transition — never on an ordinary
    // content edit that leaves published/unpublished state unchanged.
    const { data: before } = await supabase.from("locations").select("is_demo").eq("id", locationId).maybeSingle();
    const wasPublished = before ? !before.is_demo : null;

    const { error } = await supabase.from("locations").update(payload).eq("id", locationId);
    if (error) redirect(errorRedirectUrl(editPath, error.message));

    const nowPublished = !payload.is_demo;
    if (wasPublished !== null && wasPublished !== nowPublished) {
      await notifyLocationManagers(supabase, locationId, name as string, nowPublished ? "approved" : "rejected");
    }
  } else {
    const { data, error } = await supabase.from("locations").insert(payload).select("id").single();
    if (error || !data) redirect(errorRedirectUrl(editPath, error?.message ?? "Could not create location."));
    locationId = data.id;
  }

  revalidatePath("/admin/locations");
  revalidatePath(`/location/${slug}`);
  revalidatePath("/locations");
  revalidatePath("/");
  redirect(`/admin/locations/${locationId}?saved=1`);
}

// ── INLINE EVENT LOCATION CREATION (ADMIN) ──────────────────────────────
/** Admin Event Location Relationship UX pass — the admin-authorized
 * counterpart to account/location/actions.ts's own createInlineLocation,
 * for Admin's Add/Edit Event Location field (EventLocationField, via its
 * new optional `createLocationAction` prop). Deliberately NOT a reuse of
 * createInlineLocation itself: that action requires a real Supabase Auth
 * session (`sessionSupabase.auth.getUser()`) and calls create_owned_location,
 * which atomically grants the caller personal `owner` in location_members —
 * neither fits Admin, which authenticates via a single shared
 * ADMIN_PASSWORD session cookie (requireAdminSupabase(), no Supabase Auth
 * user, no member identity to grant ownership to). Reusing it unchanged
 * would either hard-fail every admin call (no session) or, worse, silently
 * attach venue ownership to whatever Supabase Auth user happens to be
 * signed in on the same browser — a real authorization bug, not a
 * convenience.
 *
 * Instead this mirrors saveLocation() above exactly — the same
 * requireAdminSupabase() session, the same direct `locations` insert (no
 * RPC, no location_members row — admin-created Locations are unowned,
 * exactly like one created via the standalone /admin/locations/new form),
 * the same slug generation, and the same is_demo=false ("Published")
 * default a brand-new admin Location already gets (LocationForm's own
 * `defaultChecked={location ? !location.is_demo : true}`). The one shared
 * piece of logic — the non-fuzzy duplicate check — comes from
 * lib/locationCreation.ts, not duplicated here, and this returns the exact
 * same CreateInlineLocationResult shape createInlineLocation does so
 * EventLocationField can treat both callers identically. */
export async function createInlineAdminLocation(formData: FormData): Promise<CreateInlineLocationResult> {
  const supabase = await requireAdminSupabase();

  const name = str(formData, "name");
  const address = str(formData, "address");
  const city = str(formData, "city");
  const state = str(formData, "state");
  const postalCode = str(formData, "postal_code");
  const force = str(formData, "force") === "1";

  if (!name) return { status: "error", error: "Location name is required." };

  if (!force) {
    const duplicates = await findLikelyDuplicateLocations(supabase, { name, address, city, state });
    if (duplicates.length > 0) return { status: "duplicates", duplicates };
  }

  const baseSlug = resolveSlugInput(null, name);
  if (!baseSlug) return { status: "error", error: "Location name is required to generate a URL." };
  const slug = await ensureUniqueSlug(baseSlug, (candidate) => isSlugTaken("locations", candidate));

  const { data: created, error } = await supabase
    .from("locations")
    .insert({
      name,
      slug,
      address,
      city,
      state,
      postal_code: postalCode,
      // Admin has full authority over its own content — same "Published"
      // default a brand-new Location gets from the standalone admin form
      // (LocationForm), never the member-facing is_demo=true review gate.
      is_demo: false,
    })
    .select("id, name, slug, address, city, state, postal_code")
    .single();
  if (error || !created) {
    return { status: "error", error: "Couldn't create that location. Please try again." };
  }

  revalidatePath("/admin/locations");
  revalidatePath("/locations");
  return {
    status: "created",
    location: {
      id: created.id,
      name: created.name,
      slug: created.slug,
      category: null,
      address: created.address,
      city: created.city,
      state: created.state,
      postal_code: created.postal_code,
    },
  };
}

export async function deleteLocation(id: string) {
  const supabase = await requireAdminSupabase();
  await supabase.from("locations").delete().eq("id", id);
  revalidatePath("/admin/locations");
  revalidatePath("/locations");
  redirect("/admin/locations");
}
