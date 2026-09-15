// Founder QR campaign management — data layer. Phase 2B is data/action
// foundation only (no polished dashboard, no QR image/download UI — see
// the pass's own scope lock); this file owns the admin list read. Writes
// live in the sibling Server Actions file (requireAdminSupabase()), same
// split every other admin entity in this codebase already uses.
import { getAdminSupabase } from "./supabase-admin";

export interface QrCampaign {
  id: string;
  name: string;
  code: string;
  business_id: string | null;
  event_id: string | null;
  event_occurrence_id: string | null;
  appearance_id: string | null;
  location_id: string | null;
  product_id: string | null;
  destination_path: string;
  placement: string | null;
  campaign_label: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** All campaigns, newest first — service role, bypasses RLS (qr_campaigns
 * has zero anon/authenticated policies; only the middleware-gated
 * /admin/(protected) route tree reads this). */
export async function getAdminQrCampaigns(): Promise<QrCampaign[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase.from("qr_campaigns").select("*").order("created_at", { ascending: false });
  return (data as QrCampaign[]) ?? [];
}
