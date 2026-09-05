"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { applyMarketRequestResolution } from "@/lib/admin/market-requests";
import { isSlugTaken } from "@/lib/admin/queries";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";

const QUEUE_PATH = "/admin/market-requests";

/** Map every PENDING request in this group onto an existing, active
 * Market. Never overwrites an existing active Primary Market or
 * non-null event.market_id — see applyMarketRequestResolution's own
 * note. Requests are looked up fresh (not trusted from the form beyond
 * their ids) and re-filtered to status='pending' so a request already
 * resolved by a concurrent action can't be double-processed. */
export async function mapMarketRequestGroup(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const requestIds = formData.getAll("request_id").map(String);
  const marketId = str(formData, "market_id");
  if (!marketId) redirect(errorRedirectUrl(QUEUE_PATH, "Choose a Market to map to."));
  if (requestIds.length === 0) redirect(QUEUE_PATH);

  const { data: market } = await supabase.from("markets").select("id, active").eq("id", marketId!).maybeSingle();
  if (!market || !market.active) redirect(errorRedirectUrl(QUEUE_PATH, "That market isn't available."));

  const { data: requests } = await supabase
    .from("market_requests")
    .select("id, source_business_id, source_event_id")
    .in("id", requestIds)
    .eq("status", "pending");
  if (!requests || requests.length === 0) redirect(`${QUEUE_PATH}?saved=1`);

  await applyMarketRequestResolution(supabase, requests, marketId!);

  await supabase
    .from("market_requests")
    .update({ status: "mapped", mapped_market_id: marketId, reviewed_at: new Date().toISOString() })
    .in(
      "id",
      requests.map((r) => r.id)
    );

  revalidatePath(QUEUE_PATH);
  revalidatePath("/admin/businesses");
  revalidatePath("/admin/events");
  redirect(`${QUEUE_PATH}?saved=1`);
}

/** Create a brand-new canonical Market from admin-confirmed fields, then
 * resolve every PENDING request in this group onto it. Defaults to
 * active + NOT consumer-visible (per this pass's own "let supply exist
 * before a public Area launch" instruction) unless the admin explicitly
 * checks "Show in consumer Area picker" on this form. */
export async function approveMarketRequestGroupAsNewMarket(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const requestIds = formData.getAll("request_id").map(String);
  const name = str(formData, "name");
  if (!name) redirect(errorRedirectUrl(QUEUE_PATH, "Name is required."));
  if (requestIds.length === 0) redirect(QUEUE_PATH);

  const baseSlug = resolveSlugInput(str(formData, "slug"), name);
  if (!baseSlug) redirect(errorRedirectUrl(QUEUE_PATH, "Name is required to generate a slug."));
  const slug = await ensureUniqueSlug(baseSlug, (candidate) => isSlugTaken("markets", candidate));

  const { data: newMarket, error } = await supabase
    .from("markets")
    .insert({
      name,
      slug,
      display_name: str(formData, "display_name"),
      description: str(formData, "description"),
      sort_order: num(formData, "sort_order") ?? 0,
      active: true,
      consumer_visible: bool(formData, "consumer_visible"),
    })
    .select("id")
    .single();
  if (error || !newMarket) redirect(errorRedirectUrl(QUEUE_PATH, error?.message ?? "Could not create market."));

  const { data: requests } = await supabase
    .from("market_requests")
    .select("id, source_business_id, source_event_id")
    .in("id", requestIds)
    .eq("status", "pending");

  if (requests && requests.length > 0) {
    await applyMarketRequestResolution(supabase, requests, newMarket!.id);
    await supabase
      .from("market_requests")
      .update({ status: "approved", mapped_market_id: newMarket!.id, reviewed_at: new Date().toISOString() })
      .in(
        "id",
        requests.map((r) => r.id)
      );
  }

  revalidatePath(QUEUE_PATH);
  revalidatePath("/admin/markets");
  revalidatePath("/admin/businesses");
  revalidatePath("/admin/events");
  redirect(`${QUEUE_PATH}?saved=1`);
}

/** Reject every PENDING request in this group. Never deletes the linked
 * business/event, never touches its physical geography (city/state/
 * address) — only this request row's own status/admin_note change. */
export async function rejectMarketRequestGroup(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const requestIds = formData.getAll("request_id").map(String);
  if (requestIds.length === 0) redirect(QUEUE_PATH);
  const adminNote = str(formData, "admin_note");

  await supabase
    .from("market_requests")
    .update({ status: "rejected", admin_note: adminNote, reviewed_at: new Date().toISOString() })
    .in("id", requestIds)
    .eq("status", "pending");

  revalidatePath(QUEUE_PATH);
  redirect(`${QUEUE_PATH}?saved=1`);
}
