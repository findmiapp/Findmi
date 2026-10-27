// Hosting an Event AS a Business — who may, and how the Event is created.
//
// One rule for every hosting entry point (Event Import → Hosting, Host An
// Event's manual form):
//
//   1. A real Owner or Manager of the Business (business_members) hosts
//      exactly as before: create_owned_event() re-checks that membership and
//      makes them the Event's owner (event_members).
//   2. Otherwise, a founder Admin session explicitly operating the Business
//      (Admin Manage-As — the same fallback requireBusinessMember() already
//      grants, checked AFTER the real membership, never instead of it) may
//      host for it. The Event is created with that Business as its canonical
//      host (events.host_business_id) and NO event_members row: no
//      ownership is fabricated for anyone. The Business's real Owners /
//      Managers manage it through the host grant (requireEventMember's
//      viaHost), and the Admin through Manage-As. The write is recorded in
//      admin_audit_events as an Admin action.
//   3. Anyone else — including staff of the Business — can't host for it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getHostEventEligibility, type HostEventEligibility } from "./entitlements";
import { isAdminSession } from "./admin/auth";
import { recordAdminAudit } from "./admin/audit";
import { NEW_EVENT_PUBLICATION } from "./event-publication";

export type HostAuthority =
  | { ok: true; business: { id: string; name: string }; viaAdmin: boolean }
  | { ok: false; reason: "not_member" | "role"; business: { id: string; name: string } | null };

export interface HostAuthorityDeps {
  eligibility: (admin: SupabaseClient, userId: string, businessId: string) => Promise<HostEventEligibility>;
  isAdminSession: () => Promise<boolean>;
}
const defaultDeps: HostAuthorityDeps = { eligibility: getHostEventEligibility, isAdminSession };

/** Real Owner/Manager first; the explicit Admin session only as the fallback. */
export async function getHostAuthority(admin: SupabaseClient, userId: string | null, businessId: string, deps: HostAuthorityDeps = defaultDeps): Promise<HostAuthority> {
  let eligibility: HostEventEligibility;
  if (userId) eligibility = await deps.eligibility(admin, userId, businessId);
  else {
    const { data } = await admin.from("businesses").select("id, name").eq("id", businessId).maybeSingle();
    eligibility = { ok: false, reason: "not_member", business: (data as { id: string; name: string } | null) ?? null };
  }
  if (eligibility.ok) return { ok: true, business: eligibility.business!, viaAdmin: false };
  if (eligibility.business && (await deps.isAdminSession())) return { ok: true, business: eligibility.business, viaAdmin: true };
  return eligibility;
}

export interface HostedEventInput {
  /** The signed-in person (required for the Owner/Manager path). */
  userId: string | null;
  viaAdmin: boolean;
  name: string;
  slug: string;
  startAt: string;
  endAt: string;
  marketId: string | null;
  hostBusinessId: string;
}

/** Error codes match create_owned_event()'s own exceptions, so every
 * caller's existing friendly-error mapping keeps working. */
export type HostedEventResult = { ok: true; id: string; viaAdmin: boolean } | { ok: false; code: string };

/** Creates the hosted Event through the path its authority allows (see the
 * module note). The Admin path validates exactly what the RPC validates and
 * inserts the Event already published (the RPC path is published by the
 * caller via publishCreatedEvent, as before). */
export async function createHostedEvent(admin: SupabaseClient, input: HostedEventInput): Promise<HostedEventResult> {
  if (!input.viaAdmin) {
    if (!input.userId) return { ok: false, code: "user_required" };
    const { data, error } = await admin.rpc("create_owned_event", {
      p_user_id: input.userId,
      p_name: input.name,
      p_slug: input.slug,
      p_start_at: input.startAt,
      p_end_at: input.endAt,
      p_market_id: input.marketId,
      p_requested_market_text: null,
      p_host_business_id: input.hostBusinessId,
    });
    if (error || !data) return { ok: false, code: error?.message ?? "create_failed" };
    return { ok: true, id: (data as { id: string }).id, viaAdmin: false };
  }

  const name = input.name?.trim();
  const slug = input.slug?.trim();
  if (!name) return { ok: false, code: "name_required" };
  if (!slug) return { ok: false, code: "slug_required" };
  if (!input.startAt) return { ok: false, code: "start_required" };
  if (!input.endAt || Date.parse(input.endAt) <= Date.parse(input.startAt)) return { ok: false, code: "invalid_end" };
  if (input.marketId) {
    const { data: market } = await admin.from("markets").select("id").eq("id", input.marketId).eq("active", true).maybeSingle();
    if (!market) return { ok: false, code: "invalid_market" };
  }
  const { data: business } = await admin.from("businesses").select("id").eq("id", input.hostBusinessId).maybeSingle();
  if (!business) return { ok: false, code: "host_not_authorized" };

  const { data, error } = await admin
    .from("events")
    .insert({ name, slug, start_at: input.startAt, end_at: input.endAt, market_id: input.marketId, host_business_id: input.hostBusinessId, ...NEW_EVENT_PUBLICATION })
    .select("id")
    .single();
  if (error || !data) return { ok: false, code: error?.message ?? "create_failed" };
  const id = (data as { id: string }).id;
  await recordAdminAudit(admin, {
    action: "manage_as_host_event_create",
    actor: { kind: "admin" },
    targetType: "business",
    targetId: input.hostBusinessId,
    detail: { event_id: id },
  });
  return { ok: true, id, viaAdmin: true };
}
