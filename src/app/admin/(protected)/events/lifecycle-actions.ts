"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { str } from "@/lib/admin/form-helpers";

/** Admin Content Lifecycle + Bulk Management V2 — Events. archived_at/
 * trashed_at are additive, same model as Products/Businesses. Unlike
 * Businesses, Events have NO Pause concept: events.publication_status has
 * a DB-level CHECK constraint restricting it to exactly
 * 'pending_review' | 'live' | 'rejected' (see EventPublicationStatus in
 * lib/types.ts, and the 20260906000000 migration's own note that events
 * originally had no publication_status column at all) — there is no
 * 'paused' value to set. Do not invent one; this intentionally has no
 * bulkPauseEvents/bulkResumeEvents, mirroring Locations. Admin-only
 * throughout. */

const EVENTS_LIST = "/admin/events";

function resultRedirectUrl(base: string, message: string): string {
  return `${base}?result=${encodeURIComponent(message)}`;
}

function parseIds(formData: FormData): string[] {
  return formData.getAll("ids").filter((v): v is string => typeof v === "string" && v.length > 0);
}

function revalidateAfterLifecycleChange() {
  revalidatePath(EVENTS_LIST);
  revalidatePath("/events");
  revalidatePath("/");
}

export async function bulkArchiveEvents(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(EVENTS_LIST, "No events selected."));
  const { data: eligible } = await supabase.from("events").select("id").in("id", ids).is("trashed_at", null);
  const eligibleIds = (eligible ?? []).map((r) => r.id);
  const skipped = ids.length - eligibleIds.length;
  let changed = 0;
  if (eligibleIds.length > 0) {
    const { data, error } = await supabase
      .from("events")
      .update({ archived_at: new Date().toISOString() })
      .in("id", eligibleIds)
      .select("id");
    changed = error ? 0 : (data?.length ?? 0);
  }
  revalidateAfterLifecycleChange();
  redirect(resultRedirectUrl(EVENTS_LIST, `${changed} event${changed === 1 ? "" : "s"} archived.` + (skipped > 0 ? ` ${skipped} skipped (already in Trash).` : "")));
}

export async function bulkRestoreEventsFromArchive(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(EVENTS_LIST, "No events selected."));
  const { data, error } = await supabase.from("events").update({ archived_at: null }).in("id", ids).not("archived_at", "is", null).select("id");
  const changed = error ? 0 : (data?.length ?? 0);
  const skipped = ids.length - changed;
  revalidateAfterLifecycleChange();
  redirect(resultRedirectUrl(EVENTS_LIST, `${changed} event${changed === 1 ? "" : "s"} restored from Archive.` + (skipped > 0 ? ` ${skipped} skipped (not archived).` : "")));
}

export async function bulkTrashEvents(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(EVENTS_LIST, "No events selected."));
  const { data, error } = await supabase
    .from("events")
    .update({ trashed_at: new Date().toISOString() })
    .in("id", ids)
    .is("trashed_at", null)
    .select("id");
  const changed = error ? 0 : (data?.length ?? 0);
  const skipped = ids.length - changed;
  revalidateAfterLifecycleChange();
  redirect(resultRedirectUrl(EVENTS_LIST, `${changed} event${changed === 1 ? "" : "s"} moved to Trash.` + (skipped > 0 ? ` ${skipped} skipped (already in Trash).` : "")));
}

export async function bulkRestoreEventsFromTrash(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(EVENTS_LIST, "No events selected."));
  const { data, error } = await supabase.from("events").update({ trashed_at: null }).in("id", ids).not("trashed_at", "is", null).select("id");
  const changed = error ? 0 : (data?.length ?? 0);
  const skipped = ids.length - changed;
  revalidateAfterLifecycleChange();
  redirect(resultRedirectUrl(EVENTS_LIST, `${changed} event${changed === 1 ? "" : "s"} restored.` + (skipped > 0 ? ` ${skipped} skipped (not in Trash).` : "")));
}

// ── Permanent delete — Trash only, proactively dependency-checked.
// event_occurrences/event_occurrence_businesses/event_businesses/
// event_members/event_claim_requests all CASCADE at the DB level (real
// scheduling/participation/ownership/claim history) — proactively
// checked and blocked rather than letting a raw delete silently destroy
// them. order_items/orders are the hard financial blocker. appearances
// merely lose their event link (SET NULL, the appearance row itself
// survives) — not treated as a blocker. event_categories/event_images/
// event_products/event_followers/account_saved_events are cosmetic/join
// data — not blockers. ─────────────────────────────────────────────

interface EventDependencyCounts {
  occurrences: number;
  participation: number;
  members: number;
  claims: number;
  orders: number;
}

async function getEventDependencyCounts(supabase: SupabaseClient, eventId: string): Promise<EventDependencyCounts> {
  const [occurrences, eventBusinesses, members, claims, orderItems, orders] = await Promise.all([
    supabase.from("event_occurrences").select("id", { count: "exact", head: true }).eq("event_id", eventId),
    supabase.from("event_businesses").select("business_id", { count: "exact", head: true }).eq("event_id", eventId),
    supabase.from("event_members").select("id", { count: "exact", head: true }).eq("event_id", eventId),
    supabase.from("event_claim_requests").select("id", { count: "exact", head: true }).eq("event_id", eventId),
    supabase.from("order_items").select("id", { count: "exact", head: true }).eq("event_id", eventId),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("source_event_id", eventId),
  ]);
  return {
    occurrences: occurrences.count ?? 0,
    participation: eventBusinesses.count ?? 0,
    members: members.count ?? 0,
    claims: claims.count ?? 0,
    orders: (orderItems.count ?? 0) + (orders.count ?? 0),
  };
}

function describeBlockers(c: EventDependencyCounts): string[] {
  const parts: string[] = [];
  if (c.occurrences > 0) parts.push(`${c.occurrences} date${c.occurrences === 1 ? "" : "s"}/occurrence${c.occurrences === 1 ? "" : "s"}`);
  if (c.participation > 0) parts.push(`${c.participation} business participation record${c.participation === 1 ? "" : "s"}`);
  if (c.members > 0) parts.push(`${c.members} team member${c.members === 1 ? "" : "s"}`);
  if (c.claims > 0) parts.push(`${c.claims} claim record${c.claims === 1 ? "" : "s"}`);
  if (c.orders > 0) parts.push(`${c.orders} order record${c.orders === 1 ? "" : "s"}`);
  return parts;
}

export async function bulkPermanentDeleteEvents(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  const confirmText = str(formData, "confirmText") ?? "";
  const expected = `DELETE ${ids.length}`;
  if (ids.length === 0) redirect(resultRedirectUrl(EVENTS_LIST, "No events selected."));
  if (confirmText !== expected) {
    redirect(resultRedirectUrl(`${EVENTS_LIST}?lifecycle=trashed`, `Deletion cancelled — confirmation text didn't match "${expected}".`));
  }

  const { data: trashedRows } = await supabase.from("events").select("id, name").in("id", ids).not("trashed_at", "is", null);
  const eligible = trashedRows ?? [];
  const notInTrash = ids.length - eligible.length;

  let deleted = 0;
  const blocked: { name: string; reasons: string[] }[] = [];
  for (const row of eligible) {
    const counts = await getEventDependencyCounts(supabase, row.id);
    const reasons = describeBlockers(counts);
    if (reasons.length > 0) {
      blocked.push({ name: row.name, reasons });
      continue;
    }
    const { error } = await supabase.from("events").delete().eq("id", row.id);
    if (error) blocked.push({ name: row.name, reasons: ["a database constraint"] });
    else deleted += 1;
  }

  revalidateAfterLifecycleChange();
  const parts = [`${deleted} event${deleted === 1 ? "" : "s"} permanently deleted.`];
  if (blocked.length > 0) {
    parts.push(
      `${blocked.length} could not be deleted because they still have dependent records: ` +
        blocked.map((b) => `${b.name} (${b.reasons.join(", ")})`).join("; ") +
        "."
    );
  }
  if (notInTrash > 0) parts.push(`${notInTrash} skipped (not in Trash).`);
  redirect(resultRedirectUrl(`${EVENTS_LIST}?lifecycle=trashed`, parts.join(" ")));
}

// ── Bulk quick edit — category only for now (Events have no per-event
// Featured-style admin-authorized flag comparable to Products/Businesses'
// is_featured beyond the existing is_featured column, which IS safe and
// included). Market/area exists but is a structured relationship
// (business_market_areas-style), not a flat safe bulk field this pass
// adds. ──────────────────────────────────────────────────────────────

export async function bulkQuickEditEvents(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(EVENTS_LIST, "No events selected."));

  const categoryId = str(formData, "category_id");
  const applyCategory = formData.get("apply_category") === "on";
  const applyFeatured = formData.get("apply_featured") === "on";
  const featuredValue = str(formData, "is_featured");

  const results: string[] = [];

  if (applyFeatured && (featuredValue === "true" || featuredValue === "false")) {
    const { data, error } = await supabase.from("events").update({ is_featured: featuredValue === "true" }).in("id", ids).select("id");
    const changed = error ? 0 : (data?.length ?? 0);
    results.push(`Featured ${featuredValue === "true" ? "enabled" : "disabled"} for ${changed} event${changed === 1 ? "" : "s"}.`);
  }

  if (applyCategory) {
    await supabase.from("event_categories").delete().in("event_id", ids);
    if (categoryId) {
      await supabase.from("event_categories").insert(ids.map((event_id) => ({ event_id, category_id: categoryId })));
    }
    results.push(`Category updated for ${ids.length} event${ids.length === 1 ? "" : "s"}.`);
  }

  revalidateAfterLifecycleChange();
  redirect(resultRedirectUrl(EVENTS_LIST, results.length > 0 ? results.join(" ") : "No changes selected."));
}
