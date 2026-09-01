"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bool, errorRedirectUrl, str } from "@/lib/admin/form-helpers";
import { NAV_ICON_KEYS, validateCustomDestination, type NavDestinationType } from "@/lib/navigation";
import { findPublicRoute } from "@/lib/public-routes";

const EDIT_PATH = "/admin/site/navigation";
const DESTINATION_TYPES: NavDestinationType[] = ["route", "custom"];

/** Shared field parsing + destination validation for create/save. A
 * destination is OPTIONAL here (unlike the previous pass) — leaving the
 * page/link blank is how the founder makes a parent-only header row (see
 * lib/navigation.ts's buildNavTree: a top-level item with children but no
 * href renders as an expand/collapse toggle, never a dead link). A
 * *provided* destination still has to be valid — a bad custom link or an
 * unknown route key is rejected with a plain-language reason. */
function readAndValidate(formData: FormData): { fields: Record<string, unknown> } | { error: string } {
  const label = str(formData, "label") ?? "Untitled Item";
  const destinationTypeRaw = str(formData, "destination_type");
  const destination_type: NavDestinationType = DESTINATION_TYPES.includes(destinationTypeRaw as NavDestinationType)
    ? (destinationTypeRaw as NavDestinationType)
    : "route";

  let route_key: string | null = null;
  let custom_href: string | null = null;

  if (destination_type === "route") {
    const key = str(formData, "route_key");
    if (key) {
      if (!findPublicRoute(key)) return { error: "Choose an existing FindMi page." };
      route_key = key;
    }
  } else {
    const raw = str(formData, "custom_href");
    if (raw) {
      const result = validateCustomDestination(raw);
      if (!result.ok) return { error: result.error };
      custom_href = result.value;
    }
  }

  const iconRaw = str(formData, "icon_key");
  const icon_key = iconRaw && (NAV_ICON_KEYS as readonly string[]).includes(iconRaw) ? iconRaw : null;
  const parent_id = str(formData, "parent_id");

  return {
    fields: {
      label,
      destination_type,
      route_key,
      custom_href,
      icon_key,
      parent_id,
      is_visible: bool(formData, "is_visible"),
      is_highlight: bool(formData, "is_highlight"),
    },
  };
}

/** One nesting level, enforced server-side (not just hidden in the admin
 * UI): a parent must itself be top-level, can't be the item itself, and
 * an item that already has its own children can't be given a parent
 * (that would make it a child-with-children — two levels deep). */
async function validateParent(
  supabase: SupabaseClient,
  itemId: string | null,
  parentId: string | null
): Promise<string | null> {
  if (!parentId) return null;
  if (parentId === itemId) return "An item can't be its own parent.";

  const { data: parentRow } = await supabase.from("nav_items").select("id, parent_id").eq("id", parentId).maybeSingle();
  if (!parentRow) return "Choose a valid parent item.";
  if (parentRow.parent_id) return "That item already has a parent — only top-level items can be a parent.";

  if (itemId) {
    const { data: kids } = await supabase.from("nav_items").select("id").eq("parent_id", itemId).limit(1);
    if (kids && kids.length > 0) {
      return "This item already has its own children — remove them first, or leave Parent Item as None.";
    }
  }
  return null;
}

export async function createNavItem(formData: FormData) {
  const supabase = await requireAdminSupabase();

  const label = str(formData, "label") ?? "New Item";
  const { data: existing } = await supabase.from("nav_items").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const nextOrder = (existing?.[0]?.sort_order ?? 0) + 10;

  const { error } = await supabase.from("nav_items").insert({
    label,
    destination_type: "route",
    route_key: null,
    parent_id: null,
    is_visible: true,
    is_highlight: false,
    sort_order: nextOrder,
  });
  if (error) redirect(errorRedirectUrl(EDIT_PATH, error.message));

  revalidatePath(EDIT_PATH);
  revalidatePath("/", "layout");
  redirect(`${EDIT_PATH}?saved=created`);
}

export async function saveNavItem(id: string, formData: FormData) {
  const supabase = await requireAdminSupabase();

  const result = readAndValidate(formData);
  if ("error" in result) redirect(errorRedirectUrl(EDIT_PATH, result.error));

  const parentError = await validateParent(supabase, id, result.fields.parent_id as string | null);
  if (parentError) redirect(errorRedirectUrl(EDIT_PATH, parentError));

  const { error } = await supabase
    .from("nav_items")
    .update({ ...result.fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) redirect(errorRedirectUrl(EDIT_PATH, error.message));

  revalidatePath(EDIT_PATH);
  revalidatePath("/", "layout");
  redirect(`${EDIT_PATH}?saved=${id}`);
}

/** Deleting a parent also deletes its children (on delete cascade) — both
 * are just navigation references, never business data, so this is safe;
 * still worth stating plainly rather than leaving it a silent side
 * effect. */
export async function deleteNavItem(id: string) {
  const supabase = await requireAdminSupabase();
  await supabase.from("nav_items").delete().eq("id", id);
  revalidatePath(EDIT_PATH);
  revalidatePath("/", "layout");
  redirect(EDIT_PATH);
}

/** Move Up/Down reorders among SIBLINGS only (same parent_id) — a child
 * only ever renders nested under its one parent, so reordering it against
 * unrelated top-level items wouldn't correspond to anything visible. */
// Not exported itself, but both callers below (moveNavItemUp,
// moveNavItemDown) ARE exported Server Actions with no other check of
// their own — the auth check has to live here, the one place both funnel
// through.
async function moveItem(id: string, direction: "up" | "down") {
  const supabase = await requireAdminSupabase();

  const { data: current } = await supabase.from("nav_items").select("id, parent_id").eq("id", id).maybeSingle();
  if (!current) redirect(EDIT_PATH);

  let siblingsQuery = supabase.from("nav_items").select("id, sort_order").order("sort_order", { ascending: true });
  siblingsQuery = current.parent_id ? siblingsQuery.eq("parent_id", current.parent_id) : siblingsQuery.is("parent_id", null);
  const { data } = await siblingsQuery;
  const rows = data ?? [];
  const index = rows.findIndex((r) => r.id === id);
  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || neighborIndex < 0 || neighborIndex >= rows.length) {
    redirect(EDIT_PATH); // already at the top/bottom of its group — nothing to do
  }

  const currentRow = rows[index];
  const neighbor = rows[neighborIndex];
  await supabase.from("nav_items").update({ sort_order: neighbor.sort_order }).eq("id", currentRow.id);
  await supabase.from("nav_items").update({ sort_order: currentRow.sort_order }).eq("id", neighbor.id);

  revalidatePath(EDIT_PATH);
  revalidatePath("/", "layout");
  redirect(EDIT_PATH);
}

export async function moveNavItemUp(id: string) {
  await moveItem(id, "up");
}

export async function moveNavItemDown(id: string) {
  await moveItem(id, "down");
}
