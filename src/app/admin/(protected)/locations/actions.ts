"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";

export async function saveLocation(id: string | null, formData: FormData) {
  const editPath = id ? `/admin/locations/${id}` : "/admin/locations/new";
  const supabase = await requireAdminSupabase();

  const name = str(formData, "name");
  const slug = str(formData, "slug");
  if (!name || !slug) {
    redirect(errorRedirectUrl(editPath, "Name and slug are required."));
  }

  const payload = {
    name,
    slug,
    address: str(formData, "address"),
    city: str(formData, "city"),
    state: str(formData, "state"),
    latitude: num(formData, "latitude"),
    longitude: num(formData, "longitude"),
    is_demo: !bool(formData, "published"),
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
