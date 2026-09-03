import { getSupabase } from "./supabase";

export interface SiteContactInfo {
  email: string | null;
  phone: string | null;
}

const PAGE_KEY = "global";
const SECTION_KEY = "contact";

/** Founder-editable site-wide contact info (Admin → Site → Contact Info) —
 * stored as one more site_sections row (page_key "global", section_key
 * "contact"), config_json {email, phone}. Same generic mechanism weather/
 * discovery-topics/join-page copy already use (see lib/site-sections.ts) —
 * no schema change; this table already stores arbitrary per-section JSON,
 * and (page_key, section_key) is uniquely constrained but not restricted
 * to any fixed set of values. Neither field is fabricated: unconfigured
 * or blank resolves to null, and callers (the mobile drawer's utility
 * strip) hide that action entirely rather than showing a dead mailto:/
 * tel: link. */
export async function getSiteContactInfo(): Promise<SiteContactInfo> {
  const supabase = getSupabase();
  if (!supabase) return { email: null, phone: null };

  const { data } = await supabase
    .from("site_sections")
    .select("config_json")
    .eq("page_key", PAGE_KEY)
    .eq("section_key", SECTION_KEY)
    .maybeSingle();

  const config = (data?.config_json ?? {}) as { email?: unknown; phone?: unknown };
  const email = typeof config.email === "string" && config.email.trim() ? config.email.trim() : null;
  const phone = typeof config.phone === "string" && config.phone.trim() ? config.phone.trim() : null;
  return { email, phone };
}
