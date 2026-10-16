import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getAdminEventById,
  getAdminLocations,
  getAdminOccurrenceVendorRosters,
  getAllCategories,
  getEventCategoryIds,
} from "@/lib/admin/queries";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getEventFormatIds } from "@/lib/event-formats-server";
import { getAllMarketsForAdmin } from "@/lib/admin/business-markets";
import { getActiveMarketsWithAreaOptions } from "@/lib/admin/market-areas";
import ViewPublicPageLink from "@/components/admin/ViewPublicPageLink";
import EventForm from "../EventForm";
import { hideEvent, publishEvent, restoreEvent, shutDownEvent } from "../lifecycle-actions";
import { EVENT_VISIBILITY_LABEL, eventVisibility } from "@/lib/event-publication";

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
  searchParams: Promise<{ error?: string; saved?: string; result?: string }>;
}) {
  const { id } = await params;
  const { error, saved, result: visibilityResult } = await searchParams;
  const marketsAdmin = getAdminSupabase();
  const [result, categories, selectedCategoryIds, locations, markets, marketsWithAreas, formats, selectedFormatIds] = await Promise.all([
    getAdminEventById(id),
    getAllCategories("event"),
    getEventCategoryIds(id),
    getAdminLocations(),
    marketsAdmin ? getAllMarketsForAdmin(marketsAdmin) : Promise.resolve([]),
    getActiveMarketsWithAreaOptions(),
    getAllCategories("event_format"),
    marketsAdmin ? getEventFormatIds(marketsAdmin, id) : Promise.resolve([] as string[]),
  ]);
  if (!result) notFound();
  const [vendorRostersByOccurrence, hostBusiness] = await Promise.all([
    getAdminOccurrenceVendorRosters(result.occurrences.map((o) => o.id)),
    // Business-Hosted Events V1 — the canonical host's display fields for
    // the Host Business picker's current value (null when no host).
    result.event.host_business_id && marketsAdmin
      ? marketsAdmin
          .from("businesses")
          .select("id, name, logo_url")
          .eq("id", result.event.host_business_id)
          .maybeSingle()
          .then(({ data }) => (data as { id: string; name: string; logo_url: string | null } | null) ?? null)
      : Promise.resolve(null),
  ]);
  // Event Publication — Events are live when created; Admin oversees with
  // Publish / Unpublish / Archive / Restore (events/lifecycle-actions.ts).
  const visibility = eventVisibility(result.event);
  const publicHref = visibility === "live" ? `/event/${result.event.slug}` : null;
  const followerCount = await getEventFollowerCount(id);
  const legacyReview = result.event.publication_status === "pending_review" || result.event.publication_status === "rejected";

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
      {/* Visibility — oversight, not approval: where this Event stands
          publicly and Admin's authority over it. Nothing is deleted. */}
      <div className="mt-3 flex flex-col gap-2 rounded-xl border border-black/10 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {visibility === "live"
              ? "Published on Findmi"
              : visibility === "hidden"
                ? legacyReview
                  ? "Not public — created before Events went live by default"
                  : "Draft — not public"
                : visibility === "archived"
                  ? "Archived — hidden everywhere, record kept"
                  : "Trashed"}
          </p>
          <p className="text-xs text-ink/50">
            Added {new Date(result.event.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })}
            {" · "}
            {EVENT_VISIBILITY_LABEL[visibility]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {visibility === "hidden" && (
            <form action={publishEvent.bind(null, id, null)}>
              <button type="submit" className="rounded-lg bg-findmi px-3 py-1.5 text-sm font-semibold text-white hover:bg-findmi-600">
                Publish
              </button>
            </form>
          )}
          {visibility === "live" && (
            <form action={hideEvent.bind(null, id, null)}>
              <button type="submit" className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-semibold text-ink hover:border-black/30">
                Unpublish
              </button>
            </form>
          )}
          {(visibility === "live" || visibility === "hidden") && (
            <form action={shutDownEvent.bind(null, id, null)}>
              <button type="submit" className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-700 hover:border-red-300">
                Archive
              </button>
            </form>
          )}
          {visibility === "archived" && (
            <form action={restoreEvent.bind(null, id, null)}>
              <button type="submit" className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-semibold text-ink hover:border-black/30">
                Restore
              </button>
            </form>
          )}
        </div>
      </div>
      {visibilityResult && (
        <p className="mt-3 rounded-xl border border-black/10 bg-black/[0.02] px-3.5 py-2.5 text-sm text-ink/80">{visibilityResult}</p>
      )}
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}
      <div className="mt-5">
        <EventForm
          event={result.event}
          hostBusiness={hostBusiness}
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
          formats={formats}
          selectedFormatIds={selectedFormatIds}
          error={error}
        />
      </div>
    </div>
  );
}
