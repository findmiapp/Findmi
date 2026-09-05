import { notFound } from "next/navigation";
import {
  getAdminEventById,
  getAdminLocations,
  getAdminOccurrenceVendorRosters,
  getAllCategories,
  getEventCategoryIds,
} from "@/lib/admin/queries";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getAllMarketsForAdmin } from "@/lib/admin/business-markets";
import ViewPublicPageLink from "@/components/admin/ViewPublicPageLink";
import EventForm from "../EventForm";

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
  const [result, categories, selectedCategoryIds, locations, markets] = await Promise.all([
    getAdminEventById(id),
    getAllCategories("event"),
    getEventCategoryIds(id),
    getAdminLocations(),
    marketsAdmin ? getAllMarketsForAdmin(marketsAdmin) : Promise.resolve([]),
  ]);
  if (!result) notFound();
  const vendorRostersByOccurrence = await getAdminOccurrenceVendorRosters(result.occurrences.map((o) => o.id));
  const publicHref = !result.event.is_demo ? `/event/${result.event.slug}` : null;
  const followerCount = await getEventFollowerCount(id);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Edit Event</h1>
        <ViewPublicPageLink href={publicHref} />
      </div>
      <p className="mt-1 text-xs text-ink/45">
        {followerCount} follower{followerCount === 1 ? "" : "s"} (email + FindMi accounts combined)
      </p>
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
          categories={categories}
          selectedCategoryIds={selectedCategoryIds}
          error={error}
        />
      </div>
    </div>
  );
}
