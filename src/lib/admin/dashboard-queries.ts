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
  /** events with start_at in the future — same "upcoming" definition
   * admin/queries.ts's getAdminEvents({ when: "upcoming" }) already uses. */
  upcomingEvents: number;
  users: number;
  /** Command Center V1 pass — a single cheap head-count on the existing
   * `inquiries` table (Native Inquiries V1), added because it's "similarly
   * cheap and already supported" per this pass's own At a Glance
   * guidance. Replaces the old proBusinesses/freeBusinesses split, which
   * this pass's At a Glance no longer displays (net: one fewer query than
   * before, not two more — see this pass's own query-cost report). */
  inquiries: number;
}

/** Admin Where You'll Be + Event Opportunity pass — a business's own
 * standalone ("Can't find it? Add where you'll be anyway") schedule
 * entry, upcoming and for a real (non-demo) business, is potential
 * intelligence about an Event Findmi doesn't have yet — but it is
 * DELIBERATELY NOT part of DashboardNeedsAttention above: it requires no
 * approval and isn't a moderation queue, just something worth a look.
 *
 * Provenance limitation (see this pass's own report): appearances.source
 * ('manual' | 'event_self_added' | 'official_participation') can't
 * reliably isolate "created through the Business self-service standalone
 * flow" on its own — neither admin's own single-create (saveAppearance)
 * nor its bulk AI importer (createAppearancesBulk) ever write `source`
 * explicitly, so an admin-created standalone entry for a real business
 * also lands as 'manual' via the column's own default, indistinguishable
 * from a genuine owner submission. event_id IS NULL is architecturally
 * exact (Standalone vs Linked Event, same source of truth the list
 * page's own linkage filter uses) — this count is honestly "current
 * standalone Where You'll Be entries for real businesses," not a
 * guaranteed-provenance "Business-submitted Event Opportunities" count.
 *
 * Scoped to upcoming only, and excludes demo/seed businesses — a
 * permanently growing historical count would stop meaning anything; this
 * answers "is there anything worth a look right now," not "how many
 * standalone entries have ever existed." */
export async function getEventOpportunityCount(): Promise<number | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const nowIso = new Date().toISOString();
  const { count } = await supabase
    .from("appearances")
    .select("id, businesses!inner(is_demo)", { count: "exact", head: true })
    .is("event_id", null)
    .eq("businesses.is_demo", false)
    .gte("start_at", nowIso);
  return count ?? 0;
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

  const [upcomingEvents, inquiries, users] = await Promise.all([
    supabase.from("events").select("id", { count: "exact", head: true }).gte("start_at", nowIso),
    supabase.from("inquiries").select("id", { count: "exact", head: true }),
    getAdminUserCount(),
  ]);

  return {
    upcomingEvents: upcomingEvents.count ?? 0,
    inquiries: inquiries.count ?? 0,
    users,
  };
}

export interface RecentActivityItem {
  id: string;
  label: string;
  title: string;
  createdAt: string;
  href: string;
}

/** Command Center V1 pass — Recent Activity, assembled cheaply from
 * EXISTING timestamped tables (no activity-log table/migration). Five
 * small, limit-5, parallel queries — the same tables/columns the rest of
 * this dashboard and admin/claims, admin/businesses, admin/events,
 * admin/market-requests already read — merged and re-sorted in JS, capped
 * to 8 items. Deliberately excludes location claims (this dashboard's
 * existing pendingClaims count above never counted them either — see
 * DashboardNeedsAttention.pendingClaims — so Recent Activity stays
 * consistent with what Needs Attention already tracks) and Marketplace
 * submissions (products has no distinct "submitted at" timestamp separate
 * from its own created_at, so a "recent submission" entry here would
 * really just be "recently created product," which the Marketplace
 * Reviews queue above already surfaces by count — not worth a
 * misleading extra timestamp). */
export async function getRecentActivity(): Promise<RecentActivityItem[] | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;

  type EntityRow = { id: string; name: string; created_at: string };
  type ClaimRow = { id: string; created_at: string; entity: { name: string } | { name: string }[] | null };
  type MarketRequestRow = { id: string; requested_text: string; canonical_text: string | null; created_at: string };

  const [businesses, events, businessClaims, eventClaims, marketRequests] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, created_at")
      .eq("is_demo", false)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("events")
      .select("id, name, created_at")
      .eq("is_demo", false)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("business_claim_requests")
      .select("id, created_at, entity:businesses(name)")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("event_claim_requests")
      .select("id, created_at, entity:events(name)")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("market_requests")
      .select("id, requested_text, canonical_text, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const entityName = (entity: ClaimRow["entity"]) => (Array.isArray(entity) ? entity[0]?.name : entity?.name) ?? "Unknown";

  const items: RecentActivityItem[] = [
    ...((businesses.data ?? []) as EntityRow[]).map((b) => ({
      id: `business-${b.id}`,
      label: "New Business",
      title: b.name,
      createdAt: b.created_at,
      href: `/admin/businesses/${b.id}`,
    })),
    ...((events.data ?? []) as EntityRow[]).map((e) => ({
      id: `event-${e.id}`,
      label: "New Event",
      title: e.name,
      createdAt: e.created_at,
      href: `/admin/events/${e.id}`,
    })),
    ...((businessClaims.data ?? []) as ClaimRow[]).map((c) => ({
      id: `bclaim-${c.id}`,
      label: "Business Claim",
      title: entityName(c.entity),
      createdAt: c.created_at,
      href: "/admin/claims",
    })),
    ...((eventClaims.data ?? []) as ClaimRow[]).map((c) => ({
      id: `eclaim-${c.id}`,
      label: "Event Claim",
      title: entityName(c.entity),
      createdAt: c.created_at,
      href: "/admin/claims",
    })),
    ...((marketRequests.data ?? []) as MarketRequestRow[]).map((r) => ({
      id: `mr-${r.id}`,
      label: "Area Request",
      title: r.canonical_text || r.requested_text,
      createdAt: r.created_at,
      href: "/admin/market-requests",
    })),
  ];

  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 8);
}
