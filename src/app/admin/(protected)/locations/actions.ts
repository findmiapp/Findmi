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

export async function deleteLocation(id: string) {
  const supabase = await requireAdminSupabase();
  await supabase.from("locations").delete().eq("id", id);
  revalidatePath("/admin/locations");
  revalidatePath("/locations");
  redirect("/admin/locations");
}
