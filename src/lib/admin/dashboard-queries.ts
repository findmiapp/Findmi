import { getAdminSupabase } from "./supabase-admin";
import { getAdminUserCount } from "./user-queries";
import { getEventIdsWithOwners } from "./queries";

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
  /** Onboarding UX Polish pass — businesses.publication_status=
   * 'pending_review' AND is_demo=false — the same real, non-demo pending
   * count admin/businesses's own Pending Review filter already uses
   * (getAdminBusinesses's published='pending_review' branch). This is
   * new member-created/claimed businesses awaiting founder review, a
   * DIFFERENT queue from pendingOnboardingReview above (the legacy
   * memberships/Tally onboarding table). */
  pendingBusinessReviews: number;
  /** Product Moderation pass — products.moderation_status=
   * 'pending_review' OR an already-live product with a standing
   * pending_changes proposal. Same queue admin/products'
   * ?status=needs_review filter uses (getAdminProducts's
   * status="needs_review" branch). */
  pendingProductReviews: number;
  /** Product Marketplace Distribution pass — products.marketplace_status=
   * 'submitted'. A SEPARATE queue from pendingProductReviews above —
   * content approval and Marketplace approval are independent decisions.
   * Same queue admin/products' ?status=marketplace_review filter uses. */
  pendingMarketplaceReviews: number;
  /** Admin Needs Review pass — events with is_demo=true that also have a
   * real event_members row (i.e. created via native self-service, not
   * founder/admin/seed-created) — same needsReview=true filter
   * admin/events now offers (getAdminEvents). Events has no
   * publication_status column; this is the only existing-schema way to
   * separate a real organizer's just-submitted event from permanent
   * is_demo=true seed/demo content. */
  pendingEventReviews: number;
}

export interface DashboardGlance {
  proBusinesses: number;
  freeBusinesses: number;
  /** events with start_at in the future — same "upcoming" definition
   * admin/queries.ts's getAdminEvents({ when: "upcoming" }) already uses. */
  upcomingEvents: number;
  users: number;
}

async function countPendingEventReviews(supabase: NonNullable<ReturnType<typeof getAdminSupabase>>): Promise<number> {
  const ownedEventIds = await getEventIdsWithOwners(supabase);
  if (ownedEventIds.length === 0) return 0;
  const { count } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("is_demo", true)
    .in("id", ownedEventIds);
  return count ?? 0;
}

export async function getDashboardNeedsAttention(): Promise<DashboardNeedsAttention | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;

  const [
    pendingBusinessClaims,
    pendingEventClaims,
    pendingEventApplications,
    pendingOnboardingReview,
    pendingBusinessReviews,
    pendingProductReviews,
    pendingMarketplaceReviews,
    pendingEventReviews,
  ] = await Promise.all([
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
    supabase
      .from("businesses")
      .select("id", { count: "exact", head: true })
      .eq("is_demo", false)
      .eq("publication_status", "pending_review"),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .or("moderation_status.eq.pending_review,pending_changes.not.is.null"),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("marketplace_status", "submitted"),
    countPendingEventReviews(supabase),
  ]);

  return {
    pendingClaims: (pendingBusinessClaims.count ?? 0) + (pendingEventClaims.count ?? 0),
    pendingEventApplications: pendingEventApplications.count ?? 0,
    pendingOnboardingReview: pendingOnboardingReview.count ?? 0,
    pendingBusinessReviews: pendingBusinessReviews.count ?? 0,
    pendingProductReviews: pendingProductReviews.count ?? 0,
    pendingMarketplaceReviews: pendingMarketplaceReviews.count ?? 0,
    pendingEventReviews,
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
