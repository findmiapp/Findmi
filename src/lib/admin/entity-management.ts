// Admin Ownership & Management — one consistent read model for the Admin
// panel across entity types, over each entity's OWN existing tables (never
// a universal owner_id):
//   - Event: managing Page = events.host_business_id (its owner/manager
//     members can edit — lib/permissions.ts "viaHost"); direct managers =
//     event_members; participants (event_businesses) are a separate
//     relationship, shown read-only and never changed from here.
//   - Location: managers = location_members; management requests =
//     location_claim_requests; listing approval = is_demo; hierarchy
//     (parent_location_id) is containment only, never management.
// Server-only (service role); read-only.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ManagerRow {
  memberId: string;
  userId: string;
  role: "owner" | "manager" | "staff";
  email: string | null;
  displayName: string | null;
  since: string;
}

export interface PendingRequestRow {
  claimId: string;
  userId: string;
  email: string | null;
  fullName: string | null;
  message: string | null;
  createdAt: string;
}

async function describeUsers(admin: SupabaseClient, userIds: string[]): Promise<Map<string, { email: string | null; displayName: string | null }>> {
  const ids = [...new Set(userIds)];
  const out = new Map<string, { email: string | null; displayName: string | null }>();
  if (ids.length === 0) return out;
  const [{ data: profiles }, users] = await Promise.all([
    admin.from("profiles").select("id, display_name").in("id", ids),
    Promise.all(ids.map((id) => admin.auth.admin.getUserById(id).then((r) => r.data.user ?? null).catch(() => null))),
  ]);
  const names = new Map(((profiles ?? []) as { id: string; display_name: string | null }[]).map((p) => [p.id, p.display_name]));
  ids.forEach((id, i) => out.set(id, { email: users[i]?.email ?? null, displayName: names.get(id) ?? null }));
  return out;
}

const ROLE_ORDER = { owner: 0, manager: 1, staff: 2 } as const;
function toManagers(rows: { id: string; user_id: string; role: ManagerRow["role"]; created_at: string }[], users: Map<string, { email: string | null; displayName: string | null }>): ManagerRow[] {
  return rows
    .map((r) => ({ memberId: r.id, userId: r.user_id, role: r.role, since: r.created_at, ...(users.get(r.user_id) ?? { email: null, displayName: null }) }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
}

export interface EventManagement {
  managingPage: { id: string; name: string; slug: string; managerCount: number } | null;
  directManagers: ManagerRow[];
  participants: { businessId: string; name: string; status: string | null }[];
  pendingRequests: PendingRequestRow[];
}

export async function getEventManagement(admin: SupabaseClient, eventId: string, hostBusinessId: string | null): Promise<EventManagement> {
  const [{ data: members }, { data: participants }, { data: claims }, host, { count: hostManagers }] = await Promise.all([
    admin.from("event_members").select("id, user_id, role, created_at").eq("event_id", eventId),
    admin.from("event_businesses").select("business_id, status, business:businesses(name)").eq("event_id", eventId),
    admin.from("event_claim_requests").select("id, user_id, full_name, email, message, created_at").eq("event_id", eventId).eq("status", "pending"),
    hostBusinessId ? admin.from("businesses").select("id, name, slug").eq("id", hostBusinessId).maybeSingle() : Promise.resolve({ data: null }),
    hostBusinessId
      ? admin.from("business_members").select("id", { count: "exact", head: true }).eq("business_id", hostBusinessId).in("role", ["owner", "manager"])
      : Promise.resolve({ count: 0 }),
  ]);
  const memberRows = (members ?? []) as { id: string; user_id: string; role: ManagerRow["role"]; created_at: string }[];
  const claimRows = (claims ?? []) as { id: string; user_id: string; full_name: string | null; email: string | null; message: string | null; created_at: string }[];
  const users = await describeUsers(admin, [...memberRows.map((m) => m.user_id), ...claimRows.map((c) => c.user_id)]);
  const hostRow = host.data as { id: string; name: string; slug: string } | null;
  return {
    managingPage: hostRow ? { ...hostRow, managerCount: hostManagers ?? 0 } : null,
    directManagers: toManagers(memberRows, users),
    participants: ((participants ?? []) as { business_id: string; status: string | null; business: { name: string } | { name: string }[] | null }[]).map((p) => ({
      businessId: p.business_id,
      status: p.status,
      name: (Array.isArray(p.business) ? p.business[0] : p.business)?.name ?? "Business",
    })),
    pendingRequests: claimRows.map((c) => ({ claimId: c.id, userId: c.user_id, email: c.email ?? users.get(c.user_id)?.email ?? null, fullName: c.full_name, message: c.message, createdAt: c.created_at })),
  };
}

export interface LocationManagement {
  managers: ManagerRow[];
  pendingRequests: PendingRequestRow[];
  parent: { id: string; name: string } | null;
  businesses: { id: string; name: string }[];
}

export async function getLocationManagement(admin: SupabaseClient, locationId: string, parentLocationId: string | null): Promise<LocationManagement> {
  const [{ data: members }, { data: claims }, parent, { data: links }] = await Promise.all([
    admin.from("location_members").select("id, user_id, role, created_at").eq("location_id", locationId),
    admin.from("location_claim_requests").select("id, user_id, full_name, email, message, created_at").eq("location_id", locationId).eq("status", "pending"),
    parentLocationId ? admin.from("locations").select("id, name").eq("id", parentLocationId).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("business_locations").select("business_id, business:businesses(name)").eq("location_id", locationId),
  ]);
  const memberRows = (members ?? []) as { id: string; user_id: string; role: ManagerRow["role"]; created_at: string }[];
  const claimRows = (claims ?? []) as { id: string; user_id: string; full_name: string | null; email: string | null; message: string | null; created_at: string }[];
  const users = await describeUsers(admin, [...memberRows.map((m) => m.user_id), ...claimRows.map((c) => c.user_id)]);
  return {
    managers: toManagers(memberRows, users),
    pendingRequests: claimRows.map((c) => ({ claimId: c.id, userId: c.user_id, email: c.email ?? users.get(c.user_id)?.email ?? null, fullName: c.full_name, message: c.message, createdAt: c.created_at })),
    parent: (parent.data as { id: string; name: string } | null) ?? null,
    businesses: ((links ?? []) as { business_id: string; business: { name: string } | { name: string }[] | null }[]).map((l) => ({
      id: l.business_id,
      name: (Array.isArray(l.business) ? l.business[0] : l.business)?.name ?? "Business",
    })),
  };
}
