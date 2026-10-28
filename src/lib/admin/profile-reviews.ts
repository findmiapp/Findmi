import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_FIELD_KEYS, isMissingColumnError, isPublicVisibility, readFieldStatusMap, type PublicFieldKey, type PublicFieldStatusMap, type PublicVisibility } from "@/lib/profile-visibility";
import { PUBLIC_ACTION_DEFAULT_LABELS, isPublicActionType } from "@/lib/public-actions-domain";

/** Admin Profile Approvals — the queue of outbound profile elements Findmi
 * reviews before they show (lib/profile-visibility.ts): a Business's links,
 * contact details and announcement, and every page's Profile Buttons.
 * Bounded reads (≤ 50 Businesses, ≤ 100 buttons); service-role only. */

export interface ProfileFieldItem {
  key: PublicFieldKey;
  value: string;
  status: PublicVisibility;
}

export interface ProfileReviewBusiness {
  id: string;
  name: string;
  slug: string | null;
  fields: ProfileFieldItem[];
}

export interface ProfileReviewButton {
  id: string;
  label: string;
  type: string;
  status: PublicVisibility;
  entity: { kind: "business" | "location" | "event"; id: string; name: string; adminHref: string };
}

export interface ProfileReviewQueue {
  /** False until 20261122000000_profile_public_visibility.sql is applied. */
  ready: boolean;
  businesses: ProfileReviewBusiness[];
  buttons: ProfileReviewButton[];
}

const FIELD_COLUMNS = "id, name, slug, website_url, instagram_url, facebook_url, tiktok_url, email, phone, bulletin_enabled, bulletin_heading, bulletin_body, public_field_status";

function fieldValue(row: Record<string, unknown>, key: PublicFieldKey): string | null {
  if (key === "bulletin") return row.bulletin_body ? [row.bulletin_heading, row.bulletin_body].filter(Boolean).join(" — ") : null;
  const v = row[key];
  return typeof v === "string" && v.trim() ? v : null;
}

export function reviewFields(row: Record<string, unknown>, map: PublicFieldStatusMap): ProfileFieldItem[] {
  const out: ProfileFieldItem[] = [];
  for (const key of PUBLIC_FIELD_KEYS) {
    const status = map[key];
    const value = fieldValue(row, key);
    if (status && value) out.push({ key, value, status });
  }
  return out;
}

export async function getProfileReviewQueue(admin: SupabaseClient, opts: { includeHidden?: boolean } = {}): Promise<ProfileReviewQueue> {
  const [biz, acts] = await Promise.all([
    admin.from("businesses").select(FIELD_COLUMNS).neq("public_field_status", "{}").order("updated_at", { ascending: false }).limit(50),
    admin
      .from("entity_public_actions")
      .select("id, business_id, location_id, event_id, action_type, custom_label, admin_status")
      .in("admin_status", opts.includeHidden ? ["pending_review", "hidden"] : ["pending_review"])
      .order("created_at", { ascending: true })
      .limit(100),
  ]);
  if (isMissingColumnError(biz.error, "public_field_status") || isMissingColumnError(acts.error, "admin_status")) return { ready: false, businesses: [], buttons: [] };

  const businesses: ProfileReviewBusiness[] = [];
  for (const row of (biz.data ?? []) as Record<string, unknown>[]) {
    const map = readFieldStatusMap(row.public_field_status);
    const fields = reviewFields(row, map).filter((f) => opts.includeHidden || f.status === "pending_review");
    if (fields.length) businesses.push({ id: row.id as string, name: row.name as string, slug: (row.slug as string | null) ?? null, fields });
  }

  const rows = (acts.data ?? []) as Record<string, unknown>[];
  const ids = (col: string) => [...new Set(rows.map((r) => r[col]).filter((v): v is string => typeof v === "string"))];
  const names = async (table: string, list: string[]) => {
    if (!list.length) return new Map<string, string>();
    const { data } = await admin.from(table).select("id, name").in("id", list);
    return new Map(((data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
  };
  const [bn, ln, en] = await Promise.all([names("businesses", ids("business_id")), names("locations", ids("location_id")), names("events", ids("event_id"))]);
  const buttons: ProfileReviewButton[] = rows.flatMap((r) => {
    const kind = r.business_id ? "business" : r.location_id ? "location" : r.event_id ? "event" : null;
    if (!kind || !isPublicActionType(r.action_type)) return [];
    const entityId = (r.business_id ?? r.location_id ?? r.event_id) as string;
    const name = (kind === "business" ? bn : kind === "location" ? ln : en).get(entityId) ?? "Untitled";
    return [
      {
        id: r.id as string,
        type: r.action_type,
        label: (r.custom_label as string | null)?.trim() || PUBLIC_ACTION_DEFAULT_LABELS[r.action_type],
        status: isPublicVisibility(r.admin_status) ? r.admin_status : "pending_review",
        entity: { kind, id: entityId, name, adminHref: `/admin/${kind === "business" ? "businesses" : kind === "location" ? "locations" : "events"}/${entityId}` },
      },
    ];
  });
  return { ready: true, businesses, buttons };
}

/** Dashboard count: Businesses with a pending field + pending buttons. */
export async function countProfileReviews(admin: SupabaseClient | null): Promise<number> {
  if (!admin) return 0;
  const q = await getProfileReviewQueue(admin).catch(() => null);
  return q ? q.businesses.length + q.buttons.length : 0;
}
