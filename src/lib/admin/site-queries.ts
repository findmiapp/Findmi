import { getAdminSupabase } from "./supabase-admin";
import type { SiteSection } from "@/lib/types";

export async function getAdminSiteSections(pageKey: string): Promise<Map<string, SiteSection>> {
  const map = new Map<string, SiteSection>();
  const supabase = getAdminSupabase();
  if (!supabase) return map;
  const { data } = await supabase.from("site_sections").select("*").eq("page_key", pageKey);
  for (const row of (data ?? []) as SiteSection[]) map.set(row.section_key, row);
  return map;
}
