"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { applyMarketRequestResolution, type ResolutionConflict } from "@/lib/admin/market-requests";
import { isSlugTaken } from "@/lib/admin/queries";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { normalizeMarketRequestKey } from "@/lib/market-requests";
import type { SupabaseClient } from "@supabase/supabase-js";

const QUEUE_PATH = "/admin/market-requests";
const MAX_TEXT_LENGTH = 120;

function conflictNote(conflicts: ResolutionConflict[]): string | null {
  if (conflicts.length === 0) return null;
  const names = conflicts.map((c) => `${c.kind === "business" ? "Business" : "Event"} "${c.name}"`);
  return `Area not applied — already has a different Market: ${names.join("; ")}.`;
}

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

  const { conflicts } = await applyMarketRequestResolution(supabase, requests, marketId!);

  await supabase
    .from("market_requests")
    .update({
      status: "mapped",
      mapped_market_id: marketId,
      mapped_area_id: null,
      resolution_type: "existing_market",
      admin_note: conflictNote(conflicts),
      reviewed_at: new Date().toISOString(),
    })
    .in(
      "id",
      requests.map((r) => r.id)
    );

  revalidatePath(QUEUE_PATH);
  revalidatePath("/admin");
  revalidatePath("/admin/businesses");
  revalidatePath("/admin/events");
  redirect(`${QUEUE_PATH}?saved=1`);
}

/** V2, resolution path B — map every PENDING request in this group onto
 * an existing, active Area/Submarket, establishing BOTH the Area and its
 * parent Market for any linked business/event (never just the Area alone
 * — see applyMarketRequestResolution's own conflict handling). */
export async function mapMarketRequestGroupToArea(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const requestIds = formData.getAll("request_id").map(String);
  const areaId = str(formData, "area_id");
  if (!areaId) redirect(errorRedirectUrl(QUEUE_PATH, "Choose an Area to map to."));
  if (requestIds.length === 0) redirect(QUEUE_PATH);

  const { data: area } = await supabase
    .from("market_areas")
    .select("id, market_id, active")
    .eq("id", areaId!)
    .maybeSingle();
  if (!area || !area.active) redirect(errorRedirectUrl(QUEUE_PATH, "That Area isn't available."));

  const { data: requests } = await supabase
    .from("market_requests")
    .select("id, source_business_id, source_event_id")
    .in("id", requestIds)
    .eq("status", "pending");
  if (!requests || requests.length === 0) redirect(`${QUEUE_PATH}?saved=1`);

  const { conflicts } = await applyMarketRequestResolution(supabase, requests, area!.market_id, area!.id);

  await supabase
    .from("market_requests")
    .update({
      status: "mapped",
      mapped_market_id: area!.market_id,
      mapped_area_id: area!.id,
      resolution_type: "existing_area",
      admin_note: conflictNote(conflicts),
      reviewed_at: new Date().toISOString(),
    })
    .in(
      "id",
      requests.map((r) => r.id)
    );

  revalidatePath(QUEUE_PATH);
  revalidatePath("/admin");
  revalidatePath("/admin/businesses");
  revalidatePath("/admin/events");
  redirect(`${QUEUE_PATH}?saved=1`);
}

/** V2, resolution path C — create a new Area/Submarket under an EXISTING
 * Market (never a new top-level Market — see approveMarketRequestGroupAsNewMarket
 * below for that, distinct, path), then resolve every PENDING request in
 * this group onto it. Defaults active + NOT consumer-visible unless the
 * admin explicitly opts in, same posture as a brand-new Market. */
export async function createMarketAreaAndResolveGroup(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const requestIds = formData.getAll("request_id").map(String);
  const marketId = str(formData, "market_id");
  const name = str(formData, "name");
  if (!marketId) redirect(errorRedirectUrl(QUEUE_PATH, "Choose the parent Market for this Area."));
  if (!name) redirect(errorRedirectUrl(QUEUE_PATH, "Area name is required."));
  if (requestIds.length === 0) redirect(QUEUE_PATH);

  const { data: market } = await supabase.from("markets").select("id, active").eq("id", marketId!).maybeSingle();
  if (!market || !market.active) redirect(errorRedirectUrl(QUEUE_PATH, "That parent Market isn't available."));

  const baseSlug = resolveSlugInput(str(formData, "slug"), name);
  if (!baseSlug) redirect(errorRedirectUrl(QUEUE_PATH, "Area name is required to generate a slug."));
  // Area slugs are unique only PER MARKET — scope the collision check to
  // this specific parent Market, never globally.
  const slug = await ensureUniqueSlugForMarket(supabase, marketId!, baseSlug);

  const aliasesRaw = str(formData, "aliases");
  const aliases = aliasesRaw
    ? aliasesRaw
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean)
    : null;

  const { data: newArea, error } = await supabase
    .from("market_areas")
    .insert({
      market_id: marketId,
      name,
      slug,
      display_name: str(formData, "display_name"),
      aliases,
      active: true,
      consumer_visible: bool(formData, "consumer_visible"),
      sort_order: num(formData, "sort_order") ?? 0,
    })
    .select("id")
    .single();
  if (error) {
    // 23505 = unique_violation on (market_id, slug) — the DB's own last
    // line of defense against a duplicate Area under the same Market,
    // surfaced here as a friendly message instead of a raw constraint error.
    const message =
      error.code === "23505" ? "An Area with that name already exists under this Market." : error.message;
    redirect(errorRedirectUrl(QUEUE_PATH, message));
  }
  if (!newArea) redirect(errorRedirectUrl(QUEUE_PATH, "Could not create Area."));

  const { data: requests } = await supabase
    .from("market_requests")
    .select("id, source_business_id, source_event_id")
    .in("id", requestIds)
    .eq("status", "pending");

  if (requests && requests.length > 0) {
    const { conflicts } = await applyMarketRequestResolution(supabase, requests, marketId!, newArea!.id);
    await supabase
      .from("market_requests")
      .update({
        status: "approved",
        mapped_market_id: marketId,
        mapped_area_id: newArea!.id,
        resolution_type: "new_area",
        admin_note: conflictNote(conflicts),
        reviewed_at: new Date().toISOString(),
      })
      .in(
        "id",
        requests.map((r) => r.id)
      );
  }

  revalidatePath(QUEUE_PATH);
  revalidatePath("/admin");
  revalidatePath("/admin/markets");
  revalidatePath("/admin/businesses");
  revalidatePath("/admin/events");
  redirect(`${QUEUE_PATH}?saved=1`);
}

async function ensureUniqueSlugForMarket(supabase: SupabaseClient, marketId: string, baseSlug: string): Promise<string> {
  let candidate = baseSlug;
  let suffix = 2;
  for (;;) {
    const { data } = await supabase
      .from("market_areas")
      .select("id")
      .eq("market_id", marketId)
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
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
      .update({
        status: "approved",
        mapped_market_id: newMarket!.id,
        mapped_area_id: null,
        resolution_type: "new_market",
        reviewed_at: new Date().toISOString(),
      })
      .in(
        "id",
        requests.map((r) => r.id)
      );
  }

  revalidatePath(QUEUE_PATH);
  revalidatePath("/admin");
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
  revalidatePath("/admin");
  redirect(`${QUEUE_PATH}?saved=1`);
}

/** V2 — an admin-controlled correction to ONE request's geography text.
 * requested_text (the original submission) is NEVER touched; this only
 * ever writes canonical_text + its recomputed effective_normalized_key,
 * which is what naturally regroups this request with any other request
 * that already normalizes the same way (e.g. correcting "Hamptens" to
 * "Hamptons" regroups it with an independently-submitted "Hamptons, NY")
 * — no separate "merge" action needed. Restricted to still-pending
 * requests: a resolved request's geography is already locked in via its
 * mapped_market_id/mapped_area_id. */
export async function correctMarketRequestText(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const requestId = str(formData, "request_id");
  const canonicalTextRaw = str(formData, "canonical_text");
  if (!requestId) redirect(QUEUE_PATH);
  const canonicalText = canonicalTextRaw?.trim().slice(0, MAX_TEXT_LENGTH) || null;
  if (!canonicalText) redirect(errorRedirectUrl(QUEUE_PATH, "Enter a corrected name."));

  await supabase
    .from("market_requests")
    .update({ canonical_text: canonicalText, effective_normalized_key: normalizeMarketRequestKey(canonicalText) })
    .eq("id", requestId!)
    .eq("status", "pending");

  revalidatePath(QUEUE_PATH);
  redirect(`${QUEUE_PATH}?saved=1`);
}
