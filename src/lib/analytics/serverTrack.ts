// Findmi Analytics — the one shared, server-only insert path onto
// analytics_events. Both public entry points that ever write a row
// (POST /api/analytics/track, and /q/[code]'s own direct qr_scan insert)
// call this — never a second, parallel insert implementation, and never
// a client-facing table write of any kind (see analytics_events' RLS:
// zero anon/authenticated policies).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalyticsEventName } from "./taxonomy";

export interface AnalyticsEventFields {
  event_name: AnalyticsEventName;
  subject_type?: string | null;
  subject_id?: string | null;
  business_id?: string | null;
  event_id?: string | null;
  event_occurrence_id?: string | null;
  appearance_id?: string | null;
  location_id?: string | null;
  product_id?: string | null;
  discovery_page_id?: string | null;
  discovery_section_id?: string | null;
  qr_campaign_id?: string | null;
  page_type?: string | null;
  page_path?: string | null;
  placement?: string | null;
  session_id: string;
  user_id?: string | null;
  referrer?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  acquisition_source?: string | null;
  acquisition_qr_campaign_id?: string | null;
  metadata?: Record<string, unknown>;
}

/** Inserts one row. Never throws — callers (both the API route and the
 * QR redirect) treat a write failure as best-effort: an analytics gap is
 * always preferable to blocking a real consumer action or navigation.
 * Returns whether the insert succeeded, for callers that want to log/
 * react to it without propagating an exception. */
export async function insertAnalyticsEvent(admin: SupabaseClient, fields: AnalyticsEventFields): Promise<boolean> {
  try {
    const { error } = await admin.from("analytics_events").insert({
      ...fields,
      metadata: fields.metadata ?? {},
    });
    return !error;
  } catch {
    return false;
  }
}
