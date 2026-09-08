import { notFound } from "next/navigation";
import Link from "next/link";
import {
  eventHasOwner,
  getAdminEventById,
  getAdminLocations,
  getAdminOccurrenceVendorRosters,
  getAllCategories,
  getEventCategoryIds,
} from "@/lib/admin/queries";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getAllMarketsForAdmin } from "@/lib/admin/business-markets";
import { getActiveMarketsWithAreaOptions } from "@/lib/admin/market-areas";
import ViewPublicPageLink from "@/components/admin/ViewPublicPageLink";
import PendingReviewPanel from "@/components/admin/PendingReviewPanel";
import EventForm from "../EventForm";
import { approveEventListing } from "../actions";

// User Identity + Follow Foundation pass — no organizer/member management
// SURFACE exists for events yet (event_members is schema-only, populated
// only via founder-approved event claims — see lib/permissions.ts's own
// comment), so per this pass's explicit "do not invent one" instruction,
// this compact count is admin-only. Sums the legacy anonymous
// event_followers table and the newer authenticated account_followed_
// events table — same "can't safely dedupe two different identifiers"
// reasoning as the Business Manager's own Followers tab (see
// lib/business-followers.ts). Never exposes individual follower
// identity — a count only.
async function getEventFollowerCount(eventId: string): Promise<number> {
  const admin = getAdminSupabase();
  if (!admin) return 0;
  const [{ count: legacy }, { count: account }] = await Promise.all([
    admin.from("event_followers").select("id", { count: "exact", head: true }).eq("event_id", eventId),
    admin.from("account_followed_events").select("id", { count: "exact", head: true }).eq("event_id", eventId),
  ]);
  return (legacy ?? 0) + (account ?? 0);
}

export const dynamic = "force-dynamic";

export default async function EditEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const marketsAdmin = getAdminSupabase();
  const [result, categories, selectedCategoryIds, locations, markets, marketsWithAreas] = await Promise.all([
    getAdminEventById(id),
    getAllCategories("event"),
    getEventCategoryIds(id),
    getAdminLocations(),
    marketsAdmin ? getAllMarketsForAdmin(marketsAdmin) : Promise.resolve([]),
    getActiveMarketsWithAreaOptions(),
  ]);
  if (!result) notFound();
  const vendorRostersByOccurrence = await getAdminOccurrenceVendorRosters(result.occurrences.map((o) => o.id));
  const publicHref = !result.event.is_demo ? `/event/${result.event.slug}` : null;
  const followerCount = await getEventFollowerCount(id);
  // Admin Pending Review Decision UX pass — the EXACT SAME "needsReview"
  // definition getAdminEvents({needsReview}) and getDashboardNeedsAttention
  // already use (is_demo=true AND a real event_members owner exists), so
  // this page's decision panel can never disagree with the Command Center
  // count or the pending list about whether this event is actually pending.
  const needsReview = result.event.is_demo && (await eventHasOwner(id));
  const approveAction = approveEventListing.bind(null, id);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Edit Event</h1>
        <div className="flex items-center gap-3">
          <Link
            href={`/account/event/${id}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-findmi-700 hover:underline"
          >
            Open Event Manager <span aria-hidden="true">↗</span>
          </Link>
          <ViewPublicPageLink href={publicHref} />
        </div>
      </div>
      <p className="mt-1 text-xs text-ink/45">
        {followerCount} follower{followerCount === 1 ? "" : "s"} (email + Findmi accounts combined)
      </p>
      {/* Admin Pending Review Decision UX pass — compact status context for
          an already-decided event (task's own "do not clutter every normal
          Edit screen with a giant moderation panel"); the big decision
          panel below is reserved for a real pending review only. */}
      {!needsReview && (
        <span
          className={`mt-2 inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
            !result.event.is_demo ? "bg-findmi-50 text-findmi-700" : "bg-black/[0.06] text-ink/50"
          }`}
        >
          {!result.event.is_demo ? "Approved" : "Demo"}
        </span>
      )}
      {/* Prominent, unmissable decision panel, placed above EventForm's own
          long scrolling content so it's visible on first load — "near the
          top, before the long editing form" per the pass's own instruction.
          No rejectAction: see approveEventListing's own comment for why a
          real Reject can't be represented without a schema change. */}
      {needsReview && (
        <PendingReviewPanel
          entityLabel="Event"
          approveAction={approveAction}
          approveLabel="Approve Event"
          rejectNote="Reject isn't available yet — events have no distinct rejected state in the data model. Leave unpublished, or ask the founder to review a schema addition for this."
        />
      )}
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}
      <div className="mt-5">
        <EventForm
          event={result.event}
          participants={result.participants}
          featuredProducts={result.featuredProducts}
          galleryImages={result.galleryImages}
          venueImages={result.venueImages}
          occurrences={result.occurrences}
          vendorRostersByOccurrence={vendorRostersByOccurrence}
          locations={locations}
          markets={markets}
          marketsWithAreas={marketsWithAreas}
          categories={categories}
          selectedCategoryIds={selectedCategoryIds}
          error={error}
        />
      </div>
    </div>
  );
}
