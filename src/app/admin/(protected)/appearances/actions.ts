"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, errorRedirectUrl, localDateTimeToIso, num, str } from "@/lib/admin/form-helpers";
import { validateCustomDestination } from "@/lib/navigation";

export async function saveAppearance(id: string | null, formData: FormData) {
  const editPath = id ? `/admin/appearances/${id}` : "/admin/appearances/new";
  const supabase = await requireAdminSupabase();

  const businessId = str(formData, "business_id");
  const title = str(formData, "title");
  const startLocal = str(formData, "start_at");
  const endLocal = str(formData, "end_at");
  if (!businessId || !title || !startLocal) {
    redirect(errorRedirectUrl(editPath, "Business, title, and start date/time are required."));
  }
  // End Date & Time is required, not optional — same active-duration
  // policy as events (see the active-event visibility bug fix). Without a
  // real end time the app has no honest way to know an appearance is
  // still happening, so a missing/invalid end can't be silently defaulted
  // or guessed here; it has to block the save with a clear message.
  if (!endLocal) {
    redirect(errorRedirectUrl(editPath, "End date/time is required — Findmi uses it to know when the appearance is over."));
  }
  const startIso = localDateTimeToIso(startLocal);
  const endIso = localDateTimeToIso(endLocal);
  if (!startIso || !endIso || new Date(endIso) <= new Date(startIso)) {
    redirect(errorRedirectUrl(editPath, "End date/time must be after the start date/time."));
  }

  const eventId = str(formData, "event_id"); // "" means "no event" — the select's blank option

  // Same internal-path-or-https:// validation every other founder-entered
  // destination on the site uses (see businesses/actions.ts's bulletin_url)
  // — never a second, parallel URL-safety check.
  const externalUrlRaw = str(formData, "external_url");
  let externalUrl: string | null = null;
  if (externalUrlRaw) {
    const result = validateCustomDestination(externalUrlRaw);
    if (!result.ok) redirect(errorRedirectUrl(editPath, `External Link: ${result.error}`));
    externalUrl = result.value;
  }

  const payload = {
    business_id: businessId,
    event_id: eventId,
    title,
    description: str(formData, "description"),
    start_at: startIso,
    end_at: endIso,
    venue_name: str(formData, "venue_name"),
    address: str(formData, "address"),
    city: str(formData, "city"),
    state: str(formData, "state"),
    status: str(formData, "status") ?? "confirmed",
    is_featured: bool(formData, "is_featured"),
    bulletin_text: str(formData, "bulletin_text"),
    show_on_home: bool(formData, "show_on_home"),
    home_sort_order: num(formData, "home_sort_order"),
    external_url: externalUrl,
    flyer_image_url: str(formData, "flyer_image_url"),
  };

  let appearanceId = id;
  if (appearanceId) {
    const { error } = await supabase.from("appearances").update(payload).eq("id", appearanceId);
    if (error) redirect(errorRedirectUrl(editPath, error.message));
  } else {
    const { data, error } = await supabase
      .from("appearances")
      .insert(payload)
      .select("id")
      .single();
    if (error || !data) {
      redirect(errorRedirectUrl(editPath, error?.message ?? "Could not create appearance."));
    }
    appearanceId = data.id;
  }

  revalidatePath("/admin/appearances");
  revalidatePath("/");
  revalidatePath("/find");
  revalidatePath("/discover");
  redirect(`/admin/appearances/${appearanceId}?saved=1`);
}

export async function deleteAppearance(id: string) {
  const supabase = await requireAdminSupabase();
  await supabase.from("appearances").delete().eq("id", id);
  revalidatePath("/admin/appearances");
  revalidatePath("/");
  revalidatePath("/find");
  redirect("/admin/appearances");
}

// ── Admin Where I'll Be Review Inbox V1 ─────────────────────────────────
// admin_reviewed_at is Admin ACKNOWLEDGEMENT only — never moderation. These
// three actions touch that one column and nothing else: no status change,
// no visibility change, no Event/participation/Market-Area write. No
// redirect (unlike saveAppearance/deleteAppearance above) — these are
// invoked from plain forms on the list itself, so revalidatePath alone is
// enough for Next.js to refresh the current URL (filters/search intact)
// without navigating away.

export async function markAppearanceReviewed(id: string) {
  const supabase = await requireAdminSupabase();
  await supabase.from("appearances").update({ admin_reviewed_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/appearances");
}

export async function markAppearanceUnreviewed(id: string) {
  const supabase = await requireAdminSupabase();
  await supabase.from("appearances").update({ admin_reviewed_at: null }).eq("id", id);
  revalidatePath("/admin/appearances");
}

/** Bulk review — "ids" is always the exact set of currently-selected,
 * currently-VISIBLE (rendered on this page load) appearance ids the
 * client sent, never a server-side "select everything matching the
 * filter" — see AppearanceReviewList's own doc comment for why. */
export async function markAppearancesReviewed(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length === 0) return;
  await supabase.from("appearances").update({ admin_reviewed_at: new Date().toISOString() }).in("id", ids);
  revalidatePath("/admin/appearances");
}
