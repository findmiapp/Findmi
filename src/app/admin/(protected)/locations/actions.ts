"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { isSlugTaken } from "@/lib/admin/queries";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { isAreaInMarket } from "@/lib/admin/market-areas";

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
    const { error } = await supabase.from("locations").update(payload).eq("id", locationId);
    if (error) redirect(errorRedirectUrl(editPath, error.message));
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
