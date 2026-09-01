"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";
import type { HomepageRowContentType, HomepageRowMode, HomepageRowTimeWindow } from "@/lib/homepage-rows";

const EDIT_PATH = "/admin/site/homepage/rows";
const CONTENT_TYPES: HomepageRowContentType[] = ["businesses", "events", "products", "business_showcase"];
const MODES: HomepageRowMode[] = ["dynamic", "curated"];
const TIME_WINDOWS: HomepageRowTimeWindow[] = ["now", "weekend", "anytime"];

function readRowFields(formData: FormData) {
  const contentTypeRaw = str(formData, "content_type");
  const modeRaw = str(formData, "mode");
  const timeWindowRaw = str(formData, "time_window");
  return {
    title: str(formData, "title") ?? "Untitled Row",
    subtitle: str(formData, "subtitle"),
    content_type: (CONTENT_TYPES.includes(contentTypeRaw as HomepageRowContentType)
      ? contentTypeRaw
      : "businesses") as HomepageRowContentType,
    mode: (MODES.includes(modeRaw as HomepageRowMode) ? modeRaw : "dynamic") as HomepageRowMode,
    category_slug: str(formData, "category_slug"),
    featured_only: bool(formData, "featured_only"),
    time_window: TIME_WINDOWS.includes(timeWindowRaw as HomepageRowTimeWindow)
      ? (timeWindowRaw as HomepageRowTimeWindow)
      : null,
    item_limit: num(formData, "item_limit") ?? 8,
    curated_ids: formData.getAll("curated_id").map(String),
    is_visible: bool(formData, "is_visible"),
  };
}

export async function createHomepageRow(formData: FormData) {
  const supabase = await requireAdminSupabase();

  const { data: existing } = await supabase.from("homepage_rows").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const nextOrder = (existing?.[0]?.sort_order ?? 0) + 10;

  const title = str(formData, "title") ?? "New Row";
  const { error } = await supabase.from("homepage_rows").insert({
    title,
    content_type: "businesses",
    mode: "dynamic",
    is_visible: true,
    sort_order: nextOrder,
  });
  if (error) redirect(errorRedirectUrl(EDIT_PATH, error.message));

  revalidatePath(EDIT_PATH);
  revalidatePath("/");
  redirect(`${EDIT_PATH}?saved=created`);
}

export async function saveHomepageRow(id: string, formData: FormData) {
  const supabase = await requireAdminSupabase();

  const fields = readRowFields(formData);
  const { error } = await supabase
    .from("homepage_rows")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) redirect(errorRedirectUrl(EDIT_PATH, error.message));

  revalidatePath(EDIT_PATH);
  revalidatePath("/");
  redirect(`${EDIT_PATH}?saved=${id}`);
}

export async function deleteHomepageRow(id: string) {
  const supabase = await requireAdminSupabase();
  await supabase.from("homepage_rows").delete().eq("id", id);
  revalidatePath(EDIT_PATH);
  revalidatePath("/");
  redirect(EDIT_PATH);
}

// Not exported itself, but both callers below (moveHomepageRowUp,
// moveHomepageRowDown) ARE exported Server Actions with no other check of
// their own — the auth check has to live here, the one place both funnel
// through.
async function moveRow(id: string, direction: "up" | "down") {
  const supabase = await requireAdminSupabase();

  const { data } = await supabase.from("homepage_rows").select("id, sort_order").order("sort_order", { ascending: true });
  const rows = data ?? [];
  const index = rows.findIndex((r) => r.id === id);
  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || neighborIndex < 0 || neighborIndex >= rows.length) {
    redirect(EDIT_PATH); // already at the top/bottom — nothing to do
  }

  const current = rows[index];
  const neighbor = rows[neighborIndex];
  await supabase.from("homepage_rows").update({ sort_order: neighbor.sort_order }).eq("id", current.id);
  await supabase.from("homepage_rows").update({ sort_order: current.sort_order }).eq("id", neighbor.id);

  revalidatePath(EDIT_PATH);
  revalidatePath("/");
  redirect(EDIT_PATH);
}

export async function moveHomepageRowUp(id: string) {
  await moveRow(id, "up");
}

export async function moveHomepageRowDown(id: string) {
  await moveRow(id, "down");
}
