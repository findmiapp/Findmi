import { getAdminSupabase } from "./supabase-admin";
import { getAdminUserCount } from "./user-queries";

// Admin Dashboard Redesign — the /admin homepage's own data, kept
// separate from lib/admin/queries.ts's getDashboardCounts() (still used
// as-is for the counts it already covers) rather than folding more into
// an already-large file. Every count here is a head-only query
// (`{ count: "exact", head: true }`) — no row payloads fetched just to
// count them — mirroring the same tables/columns/status values the
// existing list pages (admin/claims, admin/events, admin/onboarding)
// already filter by, so a query here and a queue page's own filter never
// drift out of sync.

export interface DashboardNeedsAttention {
  /** business_claim_requests + event_claim_requests, status='pending'. */
  pendingClaims: number;
  /** event_businesses.status in ('applied','pending') — the same
   * pendingApplications filter admin/events already offers. */
  pendingEventApplications: number;
  /** memberships.publication_status='pending_review' — the same
   * pending_review view admin/onboarding already offers. */
  pendingOnboardingReview: number;
}

export interface DashboardGlance {
  proBusinesses: number;
  freeBusinesses: number;
  /** events with start_at in the future — same "upcoming" definition
   * admin/queries.ts's getAdminEvents({ when: "upcoming" }) already uses. */
  upcomingEvents: number;
  users: number;
}

export async function getDashboardNeedsAttention(): Promise<DashboardNeedsAttention | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;

  const [pendingBusinessClaims, pendingEventClaims, pendingEventApplications, pendingOnboardingReview] =
    await Promise.all([
      supabase.from("business_claim_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("event_claim_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase
        .from("event_businesses")
        .select("id", { count: "exact", head: true })
        .in("status", ["applied", "pending"]),
      supabase
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("publication_status", "pending_review"),
    ]);

  return {
    pendingClaims: (pendingBusinessClaims.count ?? 0) + (pendingEventClaims.count ?? 0),
    pendingEventApplications: pendingEventApplications.count ?? 0,
    pendingOnboardingReview: pendingOnboardingReview.count ?? 0,
  };
}

export async function getDashboardGlance(): Promise<DashboardGlance | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const nowIso = new Date().toISOString();

  const [proBusinesses, freeBusinesses, upcomingEvents, users] = await Promise.all([
    supabase.from("businesses").select("id", { count: "exact", head: true }).eq("plan_tier", "pro"),
    supabase.from("businesses").select("id", { count: "exact", head: true }).eq("plan_tier", "free"),
    supabase.from("events").select("id", { count: "exact", head: true }).gte("start_at", nowIso),
    getAdminUserCount(),
  ]);

  return {
    proBusinesses: proBusinesses.count ?? 0,
    freeBusinesses: freeBusinesses.count ?? 0,
    upcomingEvents: upcomingEvents.count ?? 0,
    users,
  };
}
