"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { validateCustomDestination } from "@/lib/navigation";
import { BULLETIN_DESTINATION_TYPES, type BulletinDestinationType } from "@/lib/homepage-bulletins";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function createBulletin(formData: FormData) {
  await requireAdmin();
  const headline = str(formData, "headline");
  if (!headline) redirect(`/admin/bulletins?error=${encodeURIComponent("Headline is required.")}`);

  const supabase = getAdminSupabase();
  if (!supabase) redirect(`/admin/bulletins?error=${encodeURIComponent("Storage isn't configured on the server.")}`);

  const { data, error } = await supabase.from("homepage_bulletins").insert({ headline }).select("id").single();
  if (error || !data) {
    redirect(`/admin/bulletins?error=${encodeURIComponent(error?.message ?? "Could not create Bulletin.")}`);
  }

  revalidatePath("/admin/bulletins");
  redirect(`/admin/bulletins/${data.id}?saved=created`);
}

/** Reads and validates the shared field set for both create-time
 * defaults and edits — destination fields are only ever taken from
 * whichever destination_type is actually selected, so switching types
 * never leaves a stale destination_id/destination_url from a previous
 * choice sitting in the row. */
async function readBulletinFields(formData: FormData, bulletinId: string) {
  const destinationTypeRaw = str(formData, "destination_type");
  const destinationType = (BULLETIN_DESTINATION_TYPES as readonly string[]).includes(destinationTypeRaw ?? "")
    ? (destinationTypeRaw as BulletinDestinationType)
    : null;

  let destinationId: string | null = null;
  let destinationUrl: string | null = null;

  if (destinationType === "business" || destinationType === "event" || destinationType === "location") {
    destinationId = str(formData, "destination_id");
  } else if (destinationType === "custom_url") {
    const raw = str(formData, "destination_url");
    if (raw) {
      const validated = validateCustomDestination(raw);
      if (!validated.ok) redirect(`/admin/bulletins/${bulletinId}?error=${encodeURIComponent(validated.error)}`);
      destinationUrl = validated.ok ? validated.value : null;
    }
  }

  return {
    eyebrow: str(formData, "eyebrow"),
    supporting_text: str(formData, "supporting_text"),
    meta_text: str(formData, "meta_text"),
    thumbnail_url: str(formData, "thumbnail_url"),
    cta_text: str(formData, "cta_text"),
    destination_type: destinationType,
    destination_id: destinationId,
    destination_url: destinationUrl,
  };
}

export async function saveBulletin(id: string, formData: FormData) {
  await requireAdmin();
  const headline = str(formData, "headline");
  if (!headline) redirect(`/admin/bulletins/${id}?error=${encodeURIComponent("Headline is required.")}`);

  const fields = await readBulletinFields(formData, id);

  const supabase = getAdminSupabase();
  if (!supabase) redirect(`/admin/bulletins/${id}?error=${encodeURIComponent("Storage isn't configured on the server.")}`);

  const { error } = await supabase.from("homepage_bulletins").update({ headline, ...fields }).eq("id", id);
  if (error) redirect(`/admin/bulletins/${id}?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/");
  revalidatePath("/admin/bulletins");
  revalidatePath(`/admin/bulletins/${id}`);
  redirect(`/admin/bulletins/${id}?saved=1`);
}

/** Homepage Bulletin Carousel pass — publishing is now an independent
 * per-row toggle (the DB partial unique index that used to enforce "at
 * most one published" was dropped in
 * 20260930010000_homepage_bulletins_multi_publish.sql). Publishing this
 * Bulletin no longer unpublishes any other row. */
export async function publishBulletin(id: string) {
  await requireAdmin();
  const supabase = getAdminSupabase();
  if (!supabase) redirect(`/admin/bulletins/${id}?error=${encodeURIComponent("Storage isn't configured on the server.")}`);

  const { error } = await supabase.from("homepage_bulletins").update({ is_published: true }).eq("id", id);
  if (error) redirect(`/admin/bulletins/${id}?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/");
  revalidatePath("/admin/bulletins");
  revalidatePath(`/admin/bulletins/${id}`);
  redirect(`/admin/bulletins/${id}?saved=published`);
}

export async function unpublishBulletin(id: string) {
  await requireAdmin();
  const supabase = getAdminSupabase();
  if (!supabase) redirect(`/admin/bulletins/${id}?error=${encodeURIComponent("Storage isn't configured on the server.")}`);

  const { error } = await supabase.from("homepage_bulletins").update({ is_published: false }).eq("id", id);
  if (error) redirect(`/admin/bulletins/${id}?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/");
  revalidatePath("/admin/bulletins");
  revalidatePath(`/admin/bulletins/${id}`);
  redirect(`/admin/bulletins/${id}?saved=unpublished`);
}

/** Carousel display order — Move Up/Down on the admin list. Only
 * display_order among PUBLISHED rows ever affects the public carousel
 * (see the partial index in 20260930010000_homepage_bulletins_multi_
 * publish.sql), so reordering is scoped to the target's own group
 * (published-with-published, hidden-with-hidden) — moving a hidden draft
 * up/down can never shuffle the live carousel's order. Re-normalizes that
 * group's display_order to its position (0, 1, 2, …) after swapping the
 * target with its neighbor — simplest correct mechanism for this row
 * count, no drag-and-drop needed. */
export async function moveBulletin(id: string, direction: "up" | "down") {
  await requireAdmin();
  const supabase = getAdminSupabase();
  if (!supabase) redirect(`/admin/bulletins?error=${encodeURIComponent("Storage isn't configured on the server.")}`);

  const { data: target, error: targetError } = await supabase
    .from("homepage_bulletins")
    .select("is_published")
    .eq("id", id)
    .maybeSingle();
  if (targetError || !target) redirect(`/admin/bulletins?error=${encodeURIComponent(targetError?.message ?? "Bulletin not found.")}`);

  const { data, error: listError } = await supabase
    .from("homepage_bulletins")
    .select("id")
    .eq("is_published", target.is_published)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false })
    .order("id", { ascending: true });
  if (listError || !data) redirect(`/admin/bulletins?error=${encodeURIComponent(listError?.message ?? "Could not reorder Bulletins.")}`);

  const ids = data.map((row) => row.id as string);
  const index = ids.indexOf(id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapWith < 0 || swapWith >= ids.length) redirect("/admin/bulletins");

  [ids[index], ids[swapWith]] = [ids[swapWith], ids[index]];

  const results = await Promise.all(
    ids.map((rowId, i) => supabase.from("homepage_bulletins").update({ display_order: i }).eq("id", rowId))
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) redirect(`/admin/bulletins?error=${encodeURIComponent(failed.error.message)}`);

  revalidatePath("/");
  revalidatePath("/admin/bulletins");
  redirect("/admin/bulletins");
}
