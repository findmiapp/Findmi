"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { str } from "@/lib/admin/form-helpers";

/** Admin Content Lifecycle + Bulk Management V2 — Locations. Same
 * archived_at/trashed_at model as Products/Businesses/Events. Locations
 * have no Pause concept at all (no publication_status/is_active column
 * exists on locations) — no bulkPauseLocations/bulkResumeLocations here,
 * by design; see FindmiLocation's own comment in lib/types.ts. Admin-only
 * throughout. */

const LOCATIONS_LIST = "/admin/locations";

function resultRedirectUrl(base: string, message: string): string {
  return `${base}?result=${encodeURIComponent(message)}`;
}

function parseIds(formData: FormData): string[] {
  return formData.getAll("ids").filter((v): v is string => typeof v === "string" && v.length > 0);
}

function revalidateAfterLifecycleChange() {
  revalidatePath(LOCATIONS_LIST);
  revalidatePath("/locations");
  revalidatePath("/");
}

export async function bulkArchiveLocations(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(LOCATIONS_LIST, "No locations selected."));
  const { data: eligible } = await supabase.from("locations").select("id").in("id", ids).is("trashed_at", null);
  const eligibleIds = (eligible ?? []).map((r) => r.id);
  const skipped = ids.length - eligibleIds.length;
  let changed = 0;
  if (eligibleIds.length > 0) {
    const { data, error } = await supabase
      .from("locations")
      .update({ archived_at: new Date().toISOString() })
      .in("id", eligibleIds)
      .select("id");
    changed = error ? 0 : (data?.length ?? 0);
  }
  revalidateAfterLifecycleChange();
  redirect(
    resultRedirectUrl(
      LOCATIONS_LIST,
      `${changed} location${changed === 1 ? "" : "s"} archived.` + (skipped > 0 ? ` ${skipped} skipped (already in Trash).` : "")
    )
  );
}

export async function bulkRestoreLocationsFromArchive(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(LOCATIONS_LIST, "No locations selected."));
  const { data, error } = await supabase
    .from("locations")
    .update({ archived_at: null })
    .in("id", ids)
    .not("archived_at", "is", null)
    .select("id");
  const changed = error ? 0 : (data?.length ?? 0);
  const skipped = ids.length - changed;
  revalidateAfterLifecycleChange();
  redirect(
    resultRedirectUrl(
      LOCATIONS_LIST,
      `${changed} location${changed === 1 ? "" : "s"} restored from Archive.` + (skipped > 0 ? ` ${skipped} skipped (not archived).` : "")
    )
  );
}

export async function bulkTrashLocations(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(LOCATIONS_LIST, "No locations selected."));
  const { data, error } = await supabase
    .from("locations")
    .update({ trashed_at: new Date().toISOString() })
    .in("id", ids)
    .is("trashed_at", null)
    .select("id");
  const changed = error ? 0 : (data?.length ?? 0);
  const skipped = ids.length - changed;
  revalidateAfterLifecycleChange();
  redirect(
    resultRedirectUrl(
      LOCATIONS_LIST,
      `${changed} location${changed === 1 ? "" : "s"} moved to Trash.` + (skipped > 0 ? ` ${skipped} skipped (already in Trash).` : "")
    )
  );
}

export async function bulkRestoreLocationsFromTrash(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(LOCATIONS_LIST, "No locations selected."));
  const { data, error } = await supabase
    .from("locations")
    .update({ trashed_at: null })
    .in("id", ids)
    .not("trashed_at", "is", null)
    .select("id");
  const changed = error ? 0 : (data?.length ?? 0);
  const skipped = ids.length - changed;
  revalidateAfterLifecycleChange();
  redirect(
    resultRedirectUrl(LOCATIONS_LIST, `${changed} location${changed === 1 ? "" : "s"} restored.` + (skipped > 0 ? ` ${skipped} skipped (not in Trash).` : ""))
  );
}

// ── Permanent delete — Trash only, proactively dependency-checked.
// location_claim_requests/location_members CASCADE at the DB level (real
// ownership/claim history) — proactively checked and blocked rather than
// letting a raw delete silently destroy them. appearances/event_occurrences
// merely lose their venue reference (SET NULL, the appearance/occurrence
// row itself survives) — not treated as blockers, same reasoning as
// Events' appearances exclusion. location_images/location_followers/
// account_followed_locations/account_saved_locations are cosmetic/
// engagement data, not blockers (no business-critical history lost).
// ─────────────────────────────────────────────────────────────────────

interface LocationDependencyCounts {
  claims: number;
  members: number;
}

async function getLocationDependencyCounts(supabase: SupabaseClient, locationId: string): Promise<LocationDependencyCounts> {
  const [claims, members] = await Promise.all([
    supabase.from("location_claim_requests").select("id", { count: "exact", head: true }).eq("location_id", locationId),
    supabase.from("location_members").select("id", { count: "exact", head: true }).eq("location_id", locationId),
  ]);
  return {
    claims: claims.count ?? 0,
    members: members.count ?? 0,
  };
}

function describeBlockers(c: LocationDependencyCounts): string[] {
  const parts: string[] = [];
  if (c.claims > 0) parts.push(`${c.claims} claim record${c.claims === 1 ? "" : "s"}`);
  if (c.members > 0) parts.push(`${c.members} team member${c.members === 1 ? "" : "s"}`);
  return parts;
}

export async function bulkPermanentDeleteLocations(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  const confirmText = str(formData, "confirmText") ?? "";
  const expected = `DELETE ${ids.length}`;
  if (ids.length === 0) redirect(resultRedirectUrl(LOCATIONS_LIST, "No locations selected."));
  if (confirmText !== expected) {
    redirect(resultRedirectUrl(`${LOCATIONS_LIST}?lifecycle=trashed`, `Deletion cancelled — confirmation text didn't match "${expected}".`));
  }

  const { data: trashedRows } = await supabase.from("locations").select("id, name").in("id", ids).not("trashed_at", "is", null);
  const eligible = trashedRows ?? [];
  const notInTrash = ids.length - eligible.length;

  let deleted = 0;
  const blocked: { name: string; reasons: string[] }[] = [];
  for (const row of eligible) {
    const counts = await getLocationDependencyCounts(supabase, row.id);
    const reasons = describeBlockers(counts);
    if (reasons.length > 0) {
      blocked.push({ name: row.name, reasons });
      continue;
    }
    const { error } = await supabase.from("locations").delete().eq("id", row.id);
    if (error) blocked.push({ name: row.name, reasons: ["a database constraint"] });
    else deleted += 1;
  }

  revalidateAfterLifecycleChange();
  const parts = [`${deleted} location${deleted === 1 ? "" : "s"} permanently deleted.`];
  if (blocked.length > 0) {
    parts.push(
      `${blocked.length} could not be deleted because they still have dependent records: ` +
        blocked.map((b) => `${b.name} (${b.reasons.join(", ")})`).join("; ") +
        "."
    );
  }
  if (notInTrash > 0) parts.push(`${notInTrash} skipped (not in Trash).`);
  redirect(resultRedirectUrl(`${LOCATIONS_LIST}?lifecycle=trashed`, parts.join(" ")));
}

// ── Bulk quick edit — category only. Locations have a single flat
// category_id column (unlike Businesses/Events' join tables), and no
// Featured-style flag to edit in bulk. ─────────────────────────────────

export async function bulkQuickEditLocations(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(LOCATIONS_LIST, "No locations selected."));

  const applyCategory = formData.get("apply_category") === "on";
  if (!applyCategory) redirect(resultRedirectUrl(LOCATIONS_LIST, "No changes selected."));

  const categoryId = str(formData, "category_id");
  const { data, error } = await supabase
    .from("locations")
    .update({ category_id: categoryId || null })
    .in("id", ids)
    .select("id");
  const changed = error ? 0 : (data?.length ?? 0);

  revalidateAfterLifecycleChange();
  redirect(resultRedirectUrl(LOCATIONS_LIST, `Category updated for ${changed} location${changed === 1 ? "" : "s"}.`));
}
