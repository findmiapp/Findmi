"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";

export async function savePerson(id: string | null, formData: FormData) {
  const supabase = getAdminSupabase();
  const editPath = id ? `/admin/people/${id}` : "/admin/people/new";
  if (!supabase) redirect(errorRedirectUrl(editPath, "Server isn't configured for writes."));

  const name = str(formData, "name");
  const slug = str(formData, "slug");
  if (!name || !slug) {
    redirect(errorRedirectUrl(editPath, "Name and slug are required."));
  }

  const payload = {
    name,
    slug,
    image_url: str(formData, "image_url"),
    short_bio: str(formData, "short_bio"),
    location: str(formData, "location"),
    instagram_url: str(formData, "instagram_url"),
    website_url: str(formData, "website_url"),
    is_public: bool(formData, "is_public"),
    is_featured: bool(formData, "is_featured"),
    updated_at: new Date().toISOString(),
  };

  let personId = id;
  if (personId) {
    const { error } = await supabase.from("people").update(payload).eq("id", personId);
    if (error) redirect(errorRedirectUrl(editPath, error.message));
  } else {
    const { data, error } = await supabase.from("people").insert(payload).select("id").single();
    if (error || !data) redirect(errorRedirectUrl(editPath, error?.message ?? "Could not create person."));
    personId = data!.id;
  }

  // Business roster: same "current relationship set posted from the
  // browser" pattern as event_businesses in /admin/events — bounded to
  // however many businesses this one person is actually linked to.
  const businessIds = formData.getAll("business_id").map(String);
  const removedIds = formData.getAll("removed_business_id").map(String);

  const toUpsert = businessIds.map((businessId) => ({
    person_id: personId as string,
    business_id: businessId,
    role: str(formData, `role_${businessId}`),
    display_order: num(formData, `display_order_${businessId}`),
    featured: bool(formData, `featured_${businessId}`),
    show_on_business: bool(formData, `show_on_business_${businessId}`),
  }));

  if (toUpsert.length > 0) {
    await supabase.from("business_people").upsert(toUpsert, { onConflict: "business_id,person_id" });
  }
  if (removedIds.length > 0) {
    await supabase.from("business_people").delete().eq("person_id", personId).in("business_id", removedIds);
  }

  revalidatePath("/admin/people");
  revalidatePath("/people");
  revalidatePath(`/people/${slug}`);
  revalidatePath("/");
  redirect(`/admin/people/${personId}?saved=1`);
}

export async function deletePerson(id: string) {
  const supabase = getAdminSupabase();
  if (!supabase) redirect(errorRedirectUrl("/admin/people", "Server isn't configured for writes."));
  await supabase.from("people").delete().eq("id", id);
  revalidatePath("/admin/people");
  revalidatePath("/people");
  redirect("/admin/people");
}
