// Admin reads for the Trust & Privacy queues (Phase 2A): content reports,
// privacy requests and the privileged-action audit log. Service role;
// every caller is an /admin page behind the admin session.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isReportStatus, type ReportStatus } from "@/lib/reports-domain";

export interface AdminReportRow {
  id: string;
  entity_type: string;
  entity_id: string;
  report_kind: string;
  reason: string;
  details: string | null;
  evidence_url: string | null;
  reporter_relationship: string | null;
  reporter_user_id: string | null;
  reporter_email: string | null;
  status: string;
  resolution: string | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export async function getAdminReports(admin: SupabaseClient, opts: { status?: string; kind?: string } = {}): Promise<AdminReportRow[]> {
  let q = admin.from("content_reports").select("*").order("created_at", { ascending: false }).limit(100);
  if (opts.status && isReportStatus(opts.status)) q = q.eq("status", opts.status as ReportStatus);
  if (opts.kind) q = q.eq("report_kind", opts.kind);
  const { data } = await q;
  return (data ?? []) as AdminReportRow[];
}

export async function getAdminReport(admin: SupabaseClient, id: string): Promise<AdminReportRow | null> {
  const { data } = await admin.from("content_reports").select("*").eq("id", id).maybeSingle();
  return (data as AdminReportRow | null) ?? null;
}

const PUBLIC_PATH: Record<string, (row: Record<string, unknown>) => string | null> = {
  business: (r) => (r.slug ? `/business/${r.slug}` : null),
  event: (r) => (r.slug ? `/event/${r.slug}` : null),
  location: (r) => (r.slug ? `/location/${r.slug}` : null),
  product: (r) => (r.slug ? `/product/${r.slug}` : null),
  moment: (r) => (r.id ? `/journal/${r.id}` : null),
};
const ADMIN_PATH: Record<string, (id: string) => string> = {
  business: (id) => `/admin/businesses/${id}`,
  event: (id) => `/admin/events/${id}`,
  location: (id) => `/admin/locations/${id}`,
  product: (id) => `/admin/products/${id}`,
  moment: (id) => `/admin/journal/${id}`,
  appearance: (id) => `/admin/appearances/${id}`,
  profile: (id) => `/admin/users/${id}`,
  conversation: (id) => `/admin/conversations/${id}`,
};
const TABLE: Record<string, { table: string; cols: string }> = {
  business: { table: "businesses", cols: "id, name, slug" },
  event: { table: "events", cols: "id, name, slug" },
  location: { table: "locations", cols: "id, name, slug" },
  product: { table: "products", cols: "id, name, slug" },
  moment: { table: "journal_entries", cols: "id, title" },
  appearance: { table: "appearances", cols: "id, title" },
  profile: { table: "profiles", cols: "id, display_name" },
};

/** What a report is about, for the admin queue: a name and the admin /
 * public links. Message reports link to their conversation. */
export async function describeReportedEntity(
  admin: SupabaseClient,
  entityType: string,
  entityId: string
): Promise<{ name: string; adminHref: string | null; publicHref: string | null }> {
  if (entityType === "message") {
    const { data } = await admin.from("conversation_messages").select("conversation_id").eq("id", entityId).maybeSingle();
    const cid = (data as { conversation_id: string } | null)?.conversation_id;
    return { name: "Message", adminHref: cid ? `/admin/conversations/${cid}` : null, publicHref: null };
  }
  if (entityType === "conversation") return { name: "Conversation", adminHref: ADMIN_PATH.conversation(entityId), publicHref: null };
  const spec = TABLE[entityType];
  if (!spec) return { name: entityType, adminHref: null, publicHref: null };
  const { data } = await admin.from(spec.table).select(spec.cols).eq("id", entityId).maybeSingle();
  const row = (data ?? null) as Record<string, unknown> | null;
  const name = row ? String(row.name ?? row.title ?? row.display_name ?? entityType) : `${entityType} (no longer exists)`;
  return { name, adminHref: ADMIN_PATH[entityType]?.(entityId) ?? null, publicHref: row ? (PUBLIC_PATH[entityType]?.(row) ?? null) : null };
}

export interface AdminPrivacyRequestRow {
  id: string;
  user_id: string | null;
  contact_email: string | null;
  request_type: string;
  status: string;
  details: string | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export async function getAdminPrivacyRequests(admin: SupabaseClient, opts: { status?: string } = {}): Promise<AdminPrivacyRequestRow[]> {
  let q = admin.from("privacy_requests").select("*").order("created_at", { ascending: false }).limit(100);
  if (opts.status) q = q.eq("status", opts.status);
  const { data } = await q;
  return (data ?? []) as AdminPrivacyRequestRow[];
}

export interface AdminAuditRow {
  id: string;
  action: string;
  actor_kind: string;
  actor_user_id: string | null;
  target_type: string | null;
  target_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export async function getAdminAuditEvents(admin: SupabaseClient, opts: { action?: string } = {}): Promise<AdminAuditRow[]> {
  let q = admin.from("admin_audit_events").select("*").order("created_at", { ascending: false }).limit(200);
  if (opts.action) q = q.eq("action", opts.action);
  const { data } = await q;
  return (data ?? []) as AdminAuditRow[];
}
