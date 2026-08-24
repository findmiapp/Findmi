"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { bool, errorRedirectUrl, str } from "@/lib/admin/form-helpers";
import { NAV_ICON_KEYS, validateCustomDestination, type NavDestinationType } from "@/lib/navigation";
import { findPublicRoute } from "@/lib/public-routes";

const EDIT_PATH = "/admin/site/navigation";
const DESTINATION_TYPES: NavDestinationType[] = ["route", "custom"];

/** Shared field parsing + destination validation for create/save — a bad
 * custom link or an unknown route key is rejected here with a plain-
 * language reason rather than saved and silently failing to render. */
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
    if (!key || !findPublicRoute(key)) return { error: "Choose an existing FindMi page." };
    route_key = key;
  } else {
    const raw = str(formData, "custom_href") ?? "";
    const result = validateCustomDestination(raw);
    if (!result.ok) return { error: result.error };
    custom_href = result.value;
  }

  const iconRaw = str(formData, "icon_key");
  const icon_key = iconRaw && (NAV_ICON_KEYS as readonly string[]).includes(iconRaw) ? iconRaw : null;

  return {
    fields: {
      label,
      destination_type,
      route_key,
      custom_href,
      group_label: str(formData, "group_label"),
      icon_key,
      is_visible: bool(formData, "is_visible"),
      is_highlight: bool(formData, "is_highlight"),
    },
  };
}

export async function createNavItem(formData: FormData) {
  const supabase = getAdminSupabase();
  if (!supabase) redirect(errorRedirectUrl(EDIT_PATH, "Server isn't configured for writes."));

  const label = str(formData, "label") ?? "New Item";
  const { data: existing } = await supabase.from("nav_items").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const nextOrder = (existing?.[0]?.sort_order ?? 0) + 10;

  const { error } = await supabase.from("nav_items").insert({
    label,
    destination_type: "route",
    route_key: "discover",
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
  const supabase = getAdminSupabase();
  if (!supabase) redirect(errorRedirectUrl(EDIT_PATH, "Server isn't configured for writes."));

  const result = readAndValidate(formData);
  if ("error" in result) redirect(errorRedirectUrl(EDIT_PATH, result.error));

  const { error } = await supabase
    .from("nav_items")
    .update({ ...result.fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) redirect(errorRedirectUrl(EDIT_PATH, error.message));

  revalidatePath(EDIT_PATH);
  revalidatePath("/", "layout");
  redirect(`${EDIT_PATH}?saved=${id}`);
}

export async function deleteNavItem(id: string) {
  const supabase = getAdminSupabase();
  if (!supabase) redirect(errorRedirectUrl(EDIT_PATH, "Server isn't configured for writes."));
  await supabase.from("nav_items").delete().eq("id", id);
  revalidatePath(EDIT_PATH);
  revalidatePath("/", "layout");
  redirect(EDIT_PATH);
}

async function moveItem(id: string, direction: "up" | "down") {
  const supabase = getAdminSupabase();
  if (!supabase) redirect(errorRedirectUrl(EDIT_PATH, "Server isn't configured for writes."));

  const { data } = await supabase.from("nav_items").select("id, sort_order").order("sort_order", { ascending: true });
  const rows = data ?? [];
  const index = rows.findIndex((r) => r.id === id);
  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || neighborIndex < 0 || neighborIndex >= rows.length) {
    redirect(EDIT_PATH); // already at the top/bottom — nothing to do
  }

  const current = rows[index];
  const neighbor = rows[neighborIndex];
  await supabase.from("nav_items").update({ sort_order: neighbor.sort_order }).eq("id", current.id);
  await supabase.from("nav_items").update({ sort_order: current.sort_order }).eq("id", neighbor.id);

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
