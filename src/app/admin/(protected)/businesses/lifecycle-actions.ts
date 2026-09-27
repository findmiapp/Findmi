"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { str } from "@/lib/admin/form-helpers";

/** Admin Content Lifecycle + Bulk Management V2 — Businesses.
 *
 * Same model as Products (V1): archived_at/trashed_at are additive and
 * orthogonal to publication_status (the existing, real Pause —
 * publication_status='paused' — never touched or reinterpreted here).
 * Admin-only throughout (requireAdminSupabase). */

const BUSINESSES_LIST = "/admin/businesses";

function resultRedirectUrl(base: string, message: string): string {
  return `${base}?result=${encodeURIComponent(message)}`;
}

function parseIds(formData: FormData): string[] {
  return formData.getAll("ids").filter((v): v is string => typeof v === "string" && v.length > 0);
}

function revalidateAfterLifecycleChange(slugsOrIds: string[] = []) {
  revalidatePath(BUSINESSES_LIST);
  revalidatePath("/businesses");
  revalidatePath("/");
  for (const s of slugsOrIds) revalidatePath(`/business/${s}`);
}

// ── Pause / Resume — the EXISTING publication_status='paused' value. ────

export async function bulkPauseBusinesses(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(BUSINESSES_LIST, "No businesses selected."));
  const { data, error } = await supabase
    .from("businesses")
    .update({ publication_status: "paused" })
    .in("id", ids)
    .select("id");
  const changed = error ? 0 : (data?.length ?? 0);
  revalidateAfterLifecycleChange();
  redirect(resultRedirectUrl(BUSINESSES_LIST, error ? "Couldn't pause the selected businesses." : `${changed} business${changed === 1 ? "" : "es"} paused.`));
}

export async function bulkResumeBusinesses(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(BUSINESSES_LIST, "No businesses selected."));
  const { data, error } = await supabase
    .from("businesses")
    .update({ publication_status: "live" })
    .in("id", ids)
    .eq("publication_status", "paused")
    .select("id");
  const changed = error ? 0 : (data?.length ?? 0);
  const skipped = ids.length - changed;
  revalidateAfterLifecycleChange();
  redirect(
    resultRedirectUrl(
      BUSINESSES_LIST,
      `${changed} business${changed === 1 ? "" : "es"} resumed.` + (skipped > 0 ? ` ${skipped} skipped (not paused).` : "")
    )
  );
}

// ── Archive / Restore from Archive ──────────────────────────────────────

export async function bulkArchiveBusinesses(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(BUSINESSES_LIST, "No businesses selected."));

  const { data: eligible } = await supabase.from("businesses").select("id").in("id", ids).is("trashed_at", null);
  const eligibleIds = (eligible ?? []).map((r) => r.id);
  const skipped = ids.length - eligibleIds.length;

  let changed = 0;
  if (eligibleIds.length > 0) {
    const { data, error } = await supabase
      .from("businesses")
      .update({ archived_at: new Date().toISOString() })
      .in("id", eligibleIds)
      .select("id");
    changed = error ? 0 : (data?.length ?? 0);
  }
  revalidateAfterLifecycleChange();
  redirect(
    resultRedirectUrl(
      BUSINESSES_LIST,
      `${changed} business${changed === 1 ? "" : "es"} archived.` + (skipped > 0 ? ` ${skipped} skipped (already in Trash).` : "")
    )
  );
}

export async function bulkRestoreBusinessesFromArchive(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(BUSINESSES_LIST, "No businesses selected."));
  const { data, error } = await supabase
    .from("businesses")
    .update({ archived_at: null })
    .in("id", ids)
    .not("archived_at", "is", null)
    .select("id");
  const changed = error ? 0 : (data?.length ?? 0);
  const skipped = ids.length - changed;
  revalidateAfterLifecycleChange();
  redirect(
    resultRedirectUrl(
      BUSINESSES_LIST,
      `${changed} business${changed === 1 ? "" : "es"} restored from Archive.` + (skipped > 0 ? ` ${skipped} skipped (not archived).` : "")
    )
  );
}

// ── Trash / Restore from Trash ──────────────────────────────────────────

export async function bulkTrashBusinesses(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(BUSINESSES_LIST, "No businesses selected."));
  const { data, error } = await supabase
    .from("businesses")
    .update({ trashed_at: new Date().toISOString() })
    .in("id", ids)
    .is("trashed_at", null)
    .select("id");
  const changed = error ? 0 : (data?.length ?? 0);
  const skipped = ids.length - changed;
  revalidateAfterLifecycleChange();
  redirect(
    resultRedirectUrl(
      BUSINESSES_LIST,
      `${changed} business${changed === 1 ? "" : "es"} moved to Trash.` + (skipped > 0 ? ` ${skipped} skipped (already in Trash).` : "")
    )
  );
}

export async function bulkRestoreBusinessesFromTrash(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(BUSINESSES_LIST, "No businesses selected."));
  const { data, error } = await supabase
    .from("businesses")
    .update({ trashed_at: null })
    .in("id", ids)
    .not("trashed_at", "is", null)
    .select("id");
  const changed = error ? 0 : (data?.length ?? 0);
  const skipped = ids.length - changed;
  revalidateAfterLifecycleChange();
  redirect(
    resultRedirectUrl(BUSINESSES_LIST, `${changed} business${changed === 1 ? "" : "es"} restored.` + (skipped > 0 ? ` ${skipped} skipped (not in Trash).` : ""))
  );
}

// ── Permanent delete — Trash only, proactively dependency-checked. ─────
//
// Unlike Products (where only order_items is a hard DB blocker and
// everything else safely cascades), a Business's cascade set includes
// real content/history a raw delete-and-catch-the-FK-error approach would
// silently destroy: products, appearances, event participation, members,
// claim history all CASCADE-delete at the DB level (see the FK audit in
// this pass's report) — meaning the database would happily let the
// delete succeed while quietly erasing that graph. So a Business is
// PROACTIVELY dependency-checked before any delete is attempted at all,
// rather than relying on the DB to reject it. Trivial/cosmetic joins
// (categories, market tags, images, follows/saves) are NOT blockers —
// losing a follow-list or category tag on a deliberate permanent delete
// is not "meaningful graph/history data"; losing real products,
// appearances, participation, membership, claim history, or financial
// records is, and blocks.
interface DependencyCounts {
  products: number;
  appearances: number;
  eventParticipation: number;
  members: number;
  claims: number;
  orders: number;
}

async function getBusinessDependencyCounts(supabase: SupabaseClient, businessId: string): Promise<DependencyCounts> {
  const [products, appearances, eventBusinesses, eventOccBusinesses, members, claims, orderItems, settlements, allocations] =
    await Promise.all([
      supabase.from("products").select("id", { count: "exact", head: true }).eq("business_id", businessId),
      supabase.from("appearances").select("id", { count: "exact", head: true }).eq("business_id", businessId),
      supabase.from("event_businesses").select("event_id", { count: "exact", head: true }).eq("business_id", businessId),
      supabase.from("event_occurrence_businesses").select("occurrence_id", { count: "exact", head: true }).eq("business_id", businessId),
      supabase.from("business_members").select("id", { count: "exact", head: true }).eq("business_id", businessId),
      supabase.from("business_claim_requests").select("id", { count: "exact", head: true }).eq("business_id", businessId),
      supabase.from("order_items").select("id", { count: "exact", head: true }).eq("business_id", businessId),
      supabase.from("settlement_payments").select("id", { count: "exact", head: true }).eq("business_id", businessId),
      supabase.from("vendor_order_allocations").select("id", { count: "exact", head: true }).eq("business_id", businessId),
    ]);
  return {
    products: products.count ?? 0,
    appearances: appearances.count ?? 0,
    eventParticipation: (eventBusinesses.count ?? 0) + (eventOccBusinesses.count ?? 0),
    members: members.count ?? 0,
    claims: claims.count ?? 0,
    orders: (orderItems.count ?? 0) + (settlements.count ?? 0) + (allocations.count ?? 0),
  };
}

function describeBlockers(c: DependencyCounts): string[] {
  const parts: string[] = [];
  if (c.products > 0) parts.push(`${c.products} product${c.products === 1 ? "" : "s"}`);
  if (c.appearances > 0) parts.push(`${c.appearances} appearance${c.appearances === 1 ? "" : "s"}`);
  if (c.eventParticipation > 0) parts.push(`${c.eventParticipation} event participation record${c.eventParticipation === 1 ? "" : "s"}`);
  if (c.members > 0) parts.push(`${c.members} team member${c.members === 1 ? "" : "s"}`);
  if (c.claims > 0) parts.push(`${c.claims} claim record${c.claims === 1 ? "" : "s"}`);
  if (c.orders > 0) parts.push(`${c.orders} order/settlement record${c.orders === 1 ? "" : "s"}`);
  return parts;
}

export async function bulkPermanentDeleteBusinesses(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  const confirmText = str(formData, "confirmText") ?? "";
  const expected = `DELETE ${ids.length}`;
  if (ids.length === 0) redirect(resultRedirectUrl(BUSINESSES_LIST, "No businesses selected."));
  if (confirmText !== expected) {
    redirect(resultRedirectUrl(`${BUSINESSES_LIST}?lifecycle=trashed`, `Deletion cancelled — confirmation text didn't match "${expected}".`));
  }

  const { data: trashedRows } = await supabase.from("businesses").select("id, name").in("id", ids).not("trashed_at", "is", null);
  const eligible = trashedRows ?? [];
  const notInTrash = ids.length - eligible.length;

  let deleted = 0;
  const blocked: { name: string; reasons: string[] }[] = [];
  for (const row of eligible) {
    const counts = await getBusinessDependencyCounts(supabase, row.id);
    const reasons = describeBlockers(counts);
    if (reasons.length > 0) {
      blocked.push({ name: row.name, reasons });
      continue;
    }
    const { error } = await supabase.from("businesses").delete().eq("id", row.id);
    if (error) {
      blocked.push({ name: row.name, reasons: ["a database constraint"] });
    } else {
      deleted += 1;
    }
  }

  revalidateAfterLifecycleChange();
  const parts = [`${deleted} business${deleted === 1 ? "" : "es"} permanently deleted.`];
  if (blocked.length > 0) {
    parts.push(
      `${blocked.length} could not be deleted because they still have dependent records: ` +
        blocked.map((b) => `${b.name} (${b.reasons.join(", ")})`).join("; ") +
        "."
    );
  }
  if (notInTrash > 0) parts.push(`${notInTrash} skipped (not in Trash).`);
  redirect(resultRedirectUrl(`${BUSINESSES_LIST}?lifecycle=trashed`, parts.join(" ")));
}

// ── Bulk quick edit — category and Featured/Founding Member (admin-
// authorized) only. Never ownership/members/claims/billing/Stripe/ids/
// slugs. ────────────────────────────────────────────────────────────

export async function bulkQuickEditBusinesses(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(BUSINESSES_LIST, "No businesses selected."));

  const categoryId = str(formData, "category_id");
  const applyCategory = formData.get("apply_category") === "on";
  const applyFeatured = formData.get("apply_featured") === "on";
  const featuredValue = str(formData, "is_featured");

  const results: string[] = [];

  if (applyFeatured && (featuredValue === "true" || featuredValue === "false")) {
    const { data, error } = await supabase
      .from("businesses")
      .update({ is_featured: featuredValue === "true" })
      .in("id", ids)
      .select("id");
    const changed = error ? 0 : (data?.length ?? 0);
    results.push(`Featured ${featuredValue === "true" ? "enabled" : "disabled"} for ${changed} business${changed === 1 ? "" : "es"}.`);
  }

  if (applyCategory) {
    await supabase.from("business_categories").delete().in("business_id", ids);
    if (categoryId) {
      await supabase.from("business_categories").insert(ids.map((business_id) => ({ business_id, category_id: categoryId })));
    }
    results.push(`Category updated for ${ids.length} business${ids.length === 1 ? "" : "es"}.`);
  }

  revalidateAfterLifecycleChange();
  redirect(resultRedirectUrl(BUSINESSES_LIST, results.length > 0 ? results.join(" ") : "No changes selected."));
}
