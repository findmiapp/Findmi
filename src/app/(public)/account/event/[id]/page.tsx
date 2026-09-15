import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl, isoToLocalDateTime } from "@/lib/admin/form-helpers";
import { requireEventMember } from "@/lib/permissions";
import { getAdminEventById, getAllCategories, getEventCategoryIds } from "@/lib/admin/queries";
import { getAllMarketsForAdmin } from "@/lib/admin/business-markets";
import { getActiveMarketsWithAreaOptions } from "@/lib/admin/market-areas";
import { getPendingMarketRequestForEvent } from "@/lib/market-requests";
import { getPendingApplicationNotesForEvent } from "@/lib/opportunities";
import MarketAreaFields from "@/components/MarketAreaFields";
import { getEntityHandle } from "@/lib/handles";
import FindmiUrlCard from "@/components/FindmiUrlCard";
import AccountNav from "../../AccountNav";
import TabNav, { type TabNavItem } from "@/components/TabNav";
import EventLocationField from "@/components/account/EventLocationField";
import MemberEventImageField from "./MemberEventImageField";
import MemberEventGalleryField from "./MemberEventGalleryField";
import EventDateFieldsForm from "./EventDateFieldsForm";
import AddParticipantSearch from "./AddParticipantSearch";
import {
  addMemberEventDate,
  removeMemberEventDate,
  removeParticipatingBusiness,
  submitEventForReview,
  updateMemberEventDate,
  updateMemberEventDetails,
  updateMemberEventHandle,
  updateMemberEventImages,
  updateMemberEventLocation,
  updateMemberEventMarket,
  updateMemberEventPrimaryDate,
  updateParticipatingBusinessStatus,
} from "../actions";
import type { EventParticipationStatus } from "@/lib/types";

export const metadata: Metadata = {
  title: "Manage Event",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-11 items-center justify-center rounded-full bg-findmi px-4 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";

// Event Manager V3 — replaces the old eight-tab inventory (Overview /
// Event Details / Dates / Location / Findmi Area / Gallery / Businesses /
// Status) with four destinations matching the organizer's actual jobs: is
// this Event live and what's next (Overview), what customers see (Event
// Details — identity, about, photos, organizer, discovery settings), when
// and where it happens (Dates & Locations — Primary Date + its Location
// integrated as one row, plus Additional Dates), and who's participating
// (Businesses). Every legacy tab key still resolves (see
// LEGACY_TAB_REDIRECTS below) rather than silently stranding an old link.
const OWNER_TABS: TabNavItem[] = [
  { key: "overview", label: "Overview" },
  { key: "details", label: "Event Details" },
  { key: "dates", label: "Dates & Locations" },
  { key: "participants", label: "Businesses" },
];
const LEGACY_TAB_REDIRECTS: Record<string, string> = {
  location: "dates",
  market: "details",
  images: "details",
  status: "overview",
};
const VALID_TAB_KEYS = new Set<string>([...OWNER_TABS.map((t) => t.key), ...Object.keys(LEGACY_TAB_REDIRECTS)]);

const PARTICIPATION_LABEL: Record<EventParticipationStatus, string> = {
  invited: "Invited",
  applied: "Pending (Applied)",
  pending: "Pending",
  approved: "Approved — Confirmed",
  declined: "Declined",
};

/**
 * Multi-Entity Self-Service V1, Stage 2 — Event Manager. Reuses the
 * Business Manager / Location Manager's own tab-strip/flat-section/save-
 * per-section conventions rather than inventing a new structural pattern.
 * Owner-facing terminology throughout: "Dates", never "occurrences";
 * "Businesses", never "event_businesses" or raw EventParticipationStatus
 * enum values.
 */
export default async function ManageEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tab?: string;
    saved?: string;
    error?: string;
    date_added?: string;
    date_updated?: string;
    date_removed?: string;
    participant_added?: string;
    participant_updated?: string;
    participant_removed?: string;
    editing_date?: string;
    add_date?: string;
    add_start_time?: string;
    add_end_time?: string;
    add_location_id?: string;
  }>;
}) {
  const { id } = await params;
  const {
    tab: tabParam,
    saved,
    error,
    editing_date: editingDateId,
    add_date: addDate,
    add_start_time: addStartTime,
    add_end_time: addEndTime,
    add_location_id: addLocationId,
  } = await searchParams;
  const tab = tabParam && VALID_TAB_KEYS.has(tabParam) ? tabParam : "overview";

  // Event Manager V3 — a bookmarked/typed legacy tab key (location/market/
  // images/status) redirects straight to its new canonical destination,
  // before any of the heavier data fetching below, rather than rendering a
  // second, now-dead copy of content that's moved. Mirrors Location
  // Manager V3's exact pattern.
  if (LEGACY_TAB_REDIRECTS[tab]) {
    redirect(`/account/event/${id}?tab=${LEGACY_TAB_REDIRECTS[tab]}`);
  }

  // Admin Manage-As — same shape as Business Manager: requireEventMember()
  // is the complete authorization (real event_members row OR an explicit
  // founder admin session — see lib/permissions.ts), never impersonation,
  // never a fake membership row.
  let isAdminElevated = false;
  try {
    const membership = await requireEventMember(id);
    isAdminElevated = Boolean(membership.viaAdmin);
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to that event.";
    redirect(errorRedirectUrl("/account", message));
  }

  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl("/account", "Server isn't configured."));

  const [result, categories, selectedCategoryIds, markets, marketsWithAreas, pendingMarketRequest, eventHandle, addLocationHint, pendingApplicationNotes] = await Promise.all([
    getAdminEventById(id),
    getAllCategories("event"),
    getEventCategoryIds(id),
    getAllMarketsForAdmin(admin),
    getActiveMarketsWithAreaOptions(),
    getPendingMarketRequestForEvent(admin, id),
    getEntityHandle(admin, "event", id),
    // Event Creation + Pending Review UX pass — "Add a Date" preserves its
    // own submitted location_id on a validation error (see
    // addMemberEventDate); this looks its name back up so the picker can
    // show the same selection again instead of resetting to blank.
    addLocationId
      ? admin
          .from("locations")
          .select("id, name, slug, city, state, address, postal_code, category:categories(name)")
          .eq("id", addLocationId)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
    getPendingApplicationNotesForEvent(admin, id),
  ]);
  if (!result) redirect(errorRedirectUrl("/account", "Event not found."));
  const { event, participants, occurrences } = result;

  // Event <-> Venue/Location Relational Workflow pass — events has no
  // location_id column of its own (only event_occurrences does), so the
  // whole-event Location prefers the REAL relationship from this event's
  // own occurrences (created by createMemberEvent/updateMemberEventLocation
  // whenever a real Location was actually selected — see those actions'
  // own notes) over the best-effort exact-text-match reconstruction below.
  // `occurrences` is already fetched above for Dates & Locations, so this
  // is one extra lookup only when an occurrence actually has a
  // location_id.
  const occurrenceLocationId = occurrences.find((o) => o.location_id)?.location_id ?? null;
  const occurrenceLocationRow = occurrenceLocationId
    ? await admin
        .from("locations")
        .select("id, name, slug, city, state, address, postal_code, category:categories(name)")
        .eq("id", occurrenceLocationId)
        .maybeSingle()
        .then((r) => r.data)
    : null;
  // Event Manager Location UX pass — fallback only: if the event's
  // current venue fields exactly match a real, public Location, show it
  // as "selected" (with its View Location link) instead of raw manual
  // text. Any mismatch — a manually-typed venue, or one that doesn't
  // match a live Location — just falls through to the manual fields,
  // exactly as before. Only consulted when there's no real occurrence
  // relationship above.
  const matchedLocationRow =
    occurrenceLocationRow ??
    (event.venue_name
      ? await admin
          .from("locations")
          .select("id, name, slug, city, state, address, postal_code, category:categories(name)")
          .eq("is_demo", false)
          .eq("name", event.venue_name)
          .eq("address", event.address ?? "")
          .maybeSingle()
          .then((r) => r.data)
      : null);
  const matchedEventLocation = matchedLocationRow
    ? {
        id: matchedLocationRow.id,
        name: matchedLocationRow.name,
        slug: matchedLocationRow.slug,
        category: (Array.isArray(matchedLocationRow.category) ? matchedLocationRow.category[0] : matchedLocationRow.category)?.name ?? null,
        address: matchedLocationRow.address,
        city: matchedLocationRow.city,
        state: matchedLocationRow.state,
        postal_code: matchedLocationRow.postal_code,
      }
    : null;

  const publicHref = !event.is_demo ? `/event/${event.slug}` : null;
  const selectedMarket = markets.find((m) => m.id === event.market_id) ?? null;
  // Event Rejection State pass — a rejected event must never keep showing
  // "In Review"/"waiting for review" copy; publication_status is the
  // authoritative source for this distinction (is_demo alone can't tell
  // pending_review apart from rejected — both keep is_demo=true).
  const isRejected = event.publication_status === "rejected";
  const submitForReviewAction = submitEventForReview.bind(null, id);

  // Event Creation + Pending Review UX pass — Finish Your Event checklist
  // (Overview tab). Derived entirely from real, already-fetched Event
  // data — never a new mandatory field, never a moderation gate. "Dates"
  // is always complete because a primary start/end is required at
  // creation; it's still listed (per this pass's own spec) as an honest
  // reflection of that, not a fake requirement.
  const essentialItems = [
    { key: "details", label: "Event details", complete: Boolean(event.description), tab: "details" },
    { key: "dates", label: "Dates", complete: true, tab: "dates" },
    { key: "location", label: "Location", complete: Boolean(event.venue_name), tab: "dates" },
    {
      key: "photos",
      label: "Gallery",
      complete: Boolean(event.cover_image_url) || result.galleryImages.length > 0,
      tab: "details",
    },
  ];
  const essentialsComplete = essentialItems.every((i) => i.complete);

  // Event Manager V3, Overview — "Next up" reads the same Primary Date +
  // Additional Dates already fetched for Dates & Locations (no new
  // query), so Overview never needs its own schedule lookup.
  const nowIso = new Date().toISOString();
  const allDates = [
    { id: "primary", startAt: event.start_at, endAt: event.end_at, locationName: event.venue_name ?? null },
    ...occurrences.map((o) => ({ id: o.id, startAt: o.start_at, endAt: o.end_at, locationName: o.location_name ?? o.venue_name ?? null })),
  ];
  const nextUp =
    allDates
      .filter((d) => d.endAt && d.endAt > nowIso)
      .sort((a, b) => a.startAt.localeCompare(b.startAt))[0] ?? null;

  // Event Manager V3, Overview — "pending attention" reads the already-
  // fetched participants list (no new query) for a compact nudge instead
  // of a raw participant count.
  const pendingParticipants = participants.filter(
    (p) => p.status === "invited" || p.status === "applied" || p.status === "pending",
  );

  // Event Manager V3, Dates & Locations — "Add a Date" reopens with its
  // previously-submitted draft still visible whenever a validation error
  // sent the owner back here with preserved fields (see
  // addMemberEventDate's own errorRedirectUrlWithFields call).
  const addDateHasDraft = Boolean(addDate || addStartTime || addEndTime || addLocationHint);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <AccountNav />

      {isAdminElevated && (
        <div className="mx-auto mb-4 max-w-md rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-bold text-amber-800">Admin mode — you are managing {event.name} with elevated access.</p>
          <Link
            href={`/admin/events/${id}`}
            className="mt-1.5 inline-block text-xs font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900"
          >
            Exit Admin Mode
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Event Manager</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{event.name}</h1>
        </div>
        {publicHref ? (
          <Link
            href={publicHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-black/10 px-3.5 py-2 text-xs font-semibold text-ink/60 transition hover:border-black/20 hover:text-ink"
          >
            View Public Event ↗
          </Link>
        ) : isRejected ? (
          <span className="rounded-full bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700" title="Needs changes before it can be resubmitted">
            Needs Changes
          </span>
        ) : (
          <span className="rounded-full bg-black/[0.06] px-3.5 py-2 text-xs font-semibold text-ink/40" title="Pending Findmi review">
            In Review
          </span>
        )}
      </div>

      {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {saved && !error && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">Saved.</p>
      )}

      <div className="mt-5">
        <TabNav items={OWNER_TABS} activeKey={tab} basePath={`/account/event/${id}`} />
      </div>

      <div className="mt-5 flex flex-col gap-5">
        {/* ── Overview — command center, not an edit form. Status lives
            ONLY in the header pill above (never repeated here); this is
            "what's next" + what needs a response + the Finish Your Event
            checklist + quiet Findmi URL access. ── */}
        {tab === "overview" && (
          <div className="flex flex-col gap-5">
            {isRejected && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                <span className="rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-red-700">
                  Needs Changes
                </span>
                <p className="mt-2 text-sm text-ink/70">
                  This event wasn&rsquo;t approved yet. You can update it and submit it for review again.
                </p>
                <form action={submitForReviewAction} className="mt-3">
                  <button type="submit" className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600">
                    Submit for Review
                  </button>
                </form>
              </div>
            )}

            {event.is_demo && !isRejected && (
              <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
                <span className="rounded-full bg-black/[0.06] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-ink/60">
                  In Review
                </span>
                <p className="mt-2 text-sm text-ink/70">Keep building your listing while Findmi reviews it.</p>
              </div>
            )}

            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Next up</p>
              {nextUp ? (
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">
                      {new Date(nextUp.startAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                    {nextUp.locationName && <p className="truncate text-xs text-ink/50">{nextUp.locationName}</p>}
                  </div>
                  <Link href={appendQuery(`/account/event/${id}`, { tab: "dates" })} className="shrink-0 text-xs font-semibold text-findmi-700 hover:underline">
                    See all
                  </Link>
                </div>
              ) : (
                <p className="mt-2 text-sm text-ink/50">
                  No upcoming dates.{" "}
                  <Link href={appendQuery(`/account/event/${id}`, { tab: "dates" })} className="font-semibold text-findmi-700 hover:underline">
                    Add a date
                  </Link>
                </p>
              )}
            </div>

            {pendingParticipants.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Needs your attention</p>
                <Link
                  href={appendQuery(`/account/event/${id}`, { tab: "participants" })}
                  className="mt-2 flex items-center justify-between gap-3 rounded-2xl border border-black/10 px-3.5 py-2.5 text-sm text-ink/70 transition hover:border-black/20"
                >
                  {pendingParticipants.length} pending business{pendingParticipants.length === 1 ? "" : "es"}
                  <span className="shrink-0 text-xs font-semibold text-findmi-700">Review →</span>
                </Link>
              </div>
            )}

            {/* Finish Your Event — Event Creation + Pending Review UX pass.
                Guidance only, never a new validation/moderation gate:
                every item reflects real, already-editable Event data (see
                essentialItems above), and Businesses is deliberately
                never part of the "essentials" set — zero participants is
                a legitimate, publishable event. Once every essential is
                done, this collapses to a single compact positive line. */}
            <div className="border-t border-black/5 pt-5">
              {essentialsComplete ? (
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-findmi text-white">
                    <CheckGlyph className="h-3 w-3" />
                  </span>
                  <p className="text-sm font-semibold text-ink">Listing essentials complete</p>
                </div>
              ) : (
                <>
                  <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Finish Your Event</p>
                  <div className="mt-3 flex flex-col gap-2">
                    {essentialItems.map((item) => (
                      <Link
                        key={item.key}
                        href={appendQuery(`/account/event/${id}`, { tab: item.tab })}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-black/10 px-3.5 py-2.5 transition hover:border-black/20"
                      >
                        <span className="text-sm font-medium text-ink">{item.label}</span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            item.complete ? "bg-findmi-50 text-findmi-700" : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {item.complete ? "Complete" : "Needs attention"}
                        </span>
                      </Link>
                    ))}
                  </div>
                </>
              )}

              {/* Grow your listing — a suggestion, never a requirement:
                  zero Businesses is legitimate and never blocks
                  essentials-complete above. */}
              {participants.length === 0 && (
                <div className="mt-3 border-t border-black/10 pt-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-ink/40">Grow Your Listing</p>
                  <Link
                    href={appendQuery(`/account/event/${id}`, { tab: "participants" })}
                    className="mt-1.5 flex items-center justify-between gap-3 rounded-2xl border border-dashed border-black/15 px-3.5 py-2.5 text-sm text-ink/70 transition hover:border-black/25"
                  >
                    Add participating businesses
                    <span className="shrink-0 text-xs font-semibold text-findmi-700">Optional →</span>
                  </Link>
                </div>
              )}
            </div>

            {/* FindMi Global Handle Registry — same "not buried, never
                mandatory, never auto-assigned from the title" posture as
                Business/Location. An Event keeps working at its existing
                /event/[slug] route regardless of whether one is set. */}
            <div className="border-t border-black/5 pt-5">
              <FindmiUrlCard
                entityType="event"
                entityId={id}
                entityLabel={event.name}
                currentHandle={eventHandle}
                action={updateMemberEventHandle.bind(null, id)}
                quiet
              />
            </div>
          </div>
        )}

        {/* ── Event Details — "Control what customers see about this
            Event." Consolidates the old Event Details / Findmi Area /
            Gallery tabs: Identity -> About -> Photos -> Organizer ->
            External link, with Discovery settings (Findmi Area) tucked
            into a closed-by-default disclosure at the bottom. ── */}
        {tab === "details" && (
          <div className="flex flex-col gap-6">
            <form action={updateMemberEventDetails.bind(null, id)} className="flex flex-col gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Identity</p>
                <label className="mt-2 block">
                  <span className="mb-1.5 block text-sm font-medium text-ink">Event name</span>
                  <input type="text" name="name" required defaultValue={event.name} className={inputClass} />
                </label>
                <div className="mt-3">
                  <span className="mb-1.5 block text-sm font-medium text-ink">Categories</span>
                  <div className="flex flex-col gap-1.5">
                    {categories.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm text-ink/70">
                        <input
                          type="checkbox"
                          name="category_ids"
                          value={c.id}
                          defaultChecked={selectedCategoryIds.includes(c.id)}
                          className="h-4 w-4 accent-findmi"
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="border-t border-black/5 pt-4">
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40">About</p>
                <label className="mt-2 block">
                  <span className="mb-1.5 block text-sm font-medium text-ink">Description</span>
                  <textarea name="description" rows={4} defaultValue={event.description ?? ""} className={inputClass} />
                </label>
              </div>

              <div className="border-t border-black/5 pt-4">
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Photos</p>
                <div className="mt-2">
                  <MemberEventImageField eventId={id} label="Cover Image" name="cover_image_url" defaultValue={event.cover_image_url} />
                </div>
              </div>

              <div className="border-t border-black/5 pt-4">
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Organizer</p>
                <div className="mt-2 grid grid-cols-2 gap-4">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-ink">Organizer name</span>
                    <input type="text" name="organizer_name" defaultValue={event.organizer_name ?? ""} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-ink">Organizer email</span>
                    <input type="email" name="organizer_email" defaultValue={event.organizer_email ?? ""} className={inputClass} />
                  </label>
                </div>
              </div>

              <div className="border-t border-black/5 pt-4">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-ink">
                    Website / Link <span className="font-normal text-ink/40">(optional)</span>
                  </span>
                  <input type="url" name="external_url" defaultValue={event.external_url ?? ""} placeholder="https://" className={inputClass} />
                </label>
              </div>

              <button type="submit" className={`mt-1 w-fit ${primaryButtonClass}`}>
                Save Event Details
              </button>
            </form>

            {/* Event Gallery + Venue Gallery — same conceptual Photos
                section as above, kept as their own existing form/action
                (event_images table, wholesale-replace-on-save), same
                "two forms one heading area" pattern as Location Manager
                V3's About+Photos / Gallery split. */}
            <form action={updateMemberEventImages.bind(null, id)} className="flex flex-col gap-5 border-t border-black/5 pt-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Event Gallery</p>
                <div className="mt-2">
                  <MemberEventGalleryField eventId={id} name="gallery_image_url" initialUrls={result.galleryImages} />
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40">About the Venue — Gallery</p>
                <div className="mt-2">
                  <MemberEventGalleryField eventId={id} name="venue_image_url" initialUrls={result.venueImages} />
                </div>
              </div>
              <button type="submit" className={`w-fit ${primaryButtonClass}`}>
                Save Gallery
              </button>
            </form>

            {/* Discovery settings (Findmi Area) — visually secondary,
                closed by default. Unchanged geography architecture. */}
            <details className="border-t border-black/5 pt-6">
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-ink/40 [&::-webkit-details-marker]:hidden">
                Discovery settings
              </summary>
              <div className="mt-3">
                <p className="text-sm text-ink/60">
                  {selectedMarket
                    ? `Findmi area: ${selectedMarket.name}${
                        event.market_area_id
                          ? ` — ${
                              marketsWithAreas.find((m) => m.id === event.market_id)?.areas.find((a) => a.id === event.market_area_id)
                                ?.name ?? "specific area assigned"
                            }`
                          : ""
                      }`
                    : pendingMarketRequest
                      ? `Findmi area pending review — ${pendingMarketRequest.requestedText}`
                      : "No Findmi area selected yet."}
                </p>
                <form action={updateMemberEventMarket.bind(null, id)} className="mt-3 flex flex-col gap-3">
                  <MarketAreaFields
                    markets={marketsWithAreas}
                    defaultMarketId={event.market_id}
                    defaultAreaId={event.market_area_id}
                    marketLabel="Findmi area"
                    areaLabel="Specific area"
                    blankMarketOptionLabel="No Findmi area selected"
                    noAreasAvailableLabel="No specific area available here"
                    noSpecificAreaLabel="No specific area"
                  />
                  <details className="group -mt-1">
                    <summary className="cursor-pointer text-xs font-semibold text-ink/50 underline underline-offset-2 [&::-webkit-details-marker]:hidden">
                      Don&rsquo;t see your Findmi area?
                    </summary>
                    <div className="mt-2 rounded-xl border border-black/10 bg-mist/30 p-3.5">
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-medium text-ink/70">Tell us where</span>
                        <input type="text" name="requested_market_text" placeholder="e.g. Austin, TX" className={inputClass} />
                      </label>
                      <p className="mt-1.5 text-xs text-ink/45">
                        Findmi will review it. Leave the Findmi area above set to &ldquo;No Findmi area selected&rdquo; when
                        using this.
                      </p>
                    </div>
                  </details>
                  <button type="submit" className={`w-fit ${primaryButtonClass}`}>
                    Save
                  </button>
                </form>
              </div>
            </details>
          </div>
        )}

        {/* ── Dates & Locations — Primary Date and its Location integrated
            as one row (two separate existing actions, presented as one
            section — events has no location_id column of its own; see the
            Location Relational Workflow note above), Additional Dates as
            flat rows with existing Edit-in-place/Remove, plus a compact
            "+ Add a Date" composer. ── */}
        {tab === "dates" && (
          <div className="flex flex-col gap-6">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Primary Date</p>
                <span className="text-[10px] font-bold uppercase tracking-wide text-ink/30">Required</span>
              </div>
              <form action={updateMemberEventPrimaryDate.bind(null, id)} className="mt-3 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-ink/70">Starts</span>
                    <input
                      type="datetime-local"
                      name="start_at"
                      required
                      defaultValue={isoToLocalDateTime(event.start_at)}
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-ink/70">Ends</span>
                    <input
                      type="datetime-local"
                      name="end_at"
                      required
                      defaultValue={isoToLocalDateTime(event.end_at)}
                      className={inputClass}
                    />
                  </label>
                </div>
                <button type="submit" className={`w-fit ${primaryButtonClass}`}>
                  Save Date
                </button>
              </form>

              <form action={updateMemberEventLocation.bind(null, id)} className="mt-4 flex flex-col gap-3 border-t border-black/5 pt-4">
                <p className="text-xs font-medium text-ink/60">
                  Location — search for an existing Findmi Location, or enter your venue manually if it isn&rsquo;t on Findmi yet.
                </p>
                <EventLocationField
                  initialLocation={matchedEventLocation}
                  initialManual={
                    matchedEventLocation
                      ? null
                      : {
                          venue_name: event.venue_name ?? "",
                          address: event.address ?? "",
                          city: event.city ?? "",
                          state: event.state ?? "",
                          postal_code: event.postal_code ?? "",
                        }
                  }
                />
                <button type="submit" className={`w-fit ${primaryButtonClass}`}>
                  Save Location
                </button>
              </form>
            </div>

            <div className="border-t border-black/5 pt-6">
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Additional Dates</p>
              {occurrences.length === 0 ? (
                <p className="mt-2 text-sm text-ink/50">No additional dates yet.</p>
              ) : (
                <ul className="mt-3 flex flex-col divide-y divide-black/[0.06]">
                  {occurrences.map((occ) => {
                    const isEditing = editingDateId === occ.id;
                    if (isEditing) {
                      return (
                        <li key={occ.id} className="py-3 first:pt-0 last:pb-0">
                          <EventDateFieldsForm
                            action={updateMemberEventDate.bind(null, id, occ.id)}
                            defaultValues={{
                              date: isoToLocalDateTime(occ.start_at).slice(0, 10),
                              start_time: isoToLocalDateTime(occ.start_at).slice(11),
                              end_time: isoToLocalDateTime(occ.end_at).slice(11),
                              location:
                                occ.location_id && occ.location_name
                                  ? {
                                      id: occ.location_id,
                                      name: occ.location_name,
                                      slug: occ.location_slug ?? "",
                                      category: occ.location_category,
                                      address: occ.location_address,
                                      city: occ.location_city,
                                      state: occ.location_state,
                                      postal_code: occ.location_postal_code,
                                    }
                                  : null,
                              manualVenue: occ.location_id
                                ? null
                                : {
                                    venue_name: occ.venue_name ?? "",
                                    address: occ.address ?? "",
                                    city: occ.city ?? "",
                                    state: occ.state ?? "",
                                    postal_code: occ.postal_code ?? "",
                                  },
                            }}
                            submitLabel="Save Date"
                          />
                        </li>
                      );
                    }
                    return (
                      <li key={occ.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">
                            {new Date(occ.start_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                          </p>
                          {occ.location_name && <p className="truncate text-xs text-ink/50">{occ.location_name}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <Link
                            href={appendQuery(`/account/event/${id}`, { tab: "dates", editing_date: occ.id })}
                            className="text-xs font-semibold text-ink/50 hover:text-ink"
                          >
                            Edit
                          </Link>
                          <form action={removeMemberEventDate.bind(null, id, occ.id)}>
                            <button type="submit" className="text-xs font-semibold text-red-600 hover:text-red-700">
                              Remove
                            </button>
                          </form>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <details className="group border-t border-black/5 pt-6" open={addDateHasDraft}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Add a Date</p>
                <span className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-findmi px-3.5 text-xs font-bold uppercase tracking-wide text-white transition group-hover:bg-findmi-600">
                  <span className="group-open:hidden">+ Add</span>
                  <span className="hidden group-open:inline">Close</span>
                </span>
              </summary>
              <div className="mt-4 rounded-2xl border border-black/10 p-4">
                <EventDateFieldsForm
                  action={addMemberEventDate.bind(null, id)}
                  defaultValues={{
                    date: addDate ?? "",
                    start_time: addStartTime ?? "",
                    end_time: addEndTime ?? "",
                    location: addLocationHint
                      ? {
                          id: addLocationHint.id,
                          name: addLocationHint.name,
                          slug: addLocationHint.slug ?? "",
                          category:
                            (Array.isArray(addLocationHint.category) ? addLocationHint.category[0] : addLocationHint.category)?.name ?? null,
                          address: addLocationHint.address ?? null,
                          city: addLocationHint.city ?? null,
                          state: addLocationHint.state ?? null,
                          postal_code: addLocationHint.postal_code ?? null,
                        }
                      : null,
                    manualVenue: null,
                  }}
                  submitLabel="Add Date"
                />
              </div>
            </details>
          </div>
        )}

        {/* ── Businesses — a compact "+ Invite Business" composer, a quiet
            nudge toward the canonical Inbox for anything still awaiting a
            response, and the full roster as a flat divided list with the
            existing Approve/Decline/Remove actions and pending-note
            display. ── */}
        {tab === "participants" && (
          <div className="flex flex-col gap-6">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0">
                  <p className="font-display text-base font-bold tracking-tight text-ink">Businesses</p>
                  <p className="mt-1 text-sm text-ink/60">Invite an existing Findmi business to participate.</p>
                </div>
                <span className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-findmi px-4 text-xs font-bold uppercase tracking-wide text-white transition group-hover:bg-findmi-600">
                  <span className="group-open:hidden">+ Invite</span>
                  <span className="hidden group-open:inline">Close</span>
                </span>
              </summary>
              <div className="mt-4 rounded-2xl border border-black/10 p-4">
                <AddParticipantSearch eventId={id} excludeIds={participants.map((p) => p.business_id)} />
              </div>
            </details>

            {pendingParticipants.length > 0 && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-sm text-amber-800">
                  {pendingParticipants.length} pending application{pendingParticipants.length === 1 ? "" : "s"}/invitation
                  {pendingParticipants.length === 1 ? "" : "s"} awaiting a response.
                </p>
                <Link
                  href="/account/messages?filter=opportunities"
                  className="shrink-0 text-xs font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900"
                >
                  View in Inbox
                </Link>
              </div>
            )}

            <div className="border-t border-black/5 pt-6">
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Roster</p>
              {participants.length === 0 ? (
                <p className="mt-2 text-sm text-ink/50">No participating businesses yet.</p>
              ) : (
                <ul className="mt-3 flex flex-col divide-y divide-black/[0.06]">
                  {participants.map((p) => (
                    <li key={p.business_id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">{p.business_name}</p>
                          <p className="text-xs text-ink/50">{PARTICIPATION_LABEL[p.status]}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          {(p.status === "applied" || p.status === "pending" || p.status === "invited") && (
                            <form action={updateParticipatingBusinessStatus.bind(null, id, p.business_id, "approved")}>
                              <button type="submit" className="text-xs font-semibold text-findmi-700 hover:underline">
                                Approve
                              </button>
                            </form>
                          )}
                          {p.status !== "declined" && (
                            <form action={updateParticipatingBusinessStatus.bind(null, id, p.business_id, "declined")}>
                              <button type="submit" className="text-xs font-semibold text-ink/50 hover:text-ink">
                                Decline
                              </button>
                            </form>
                          )}
                          <form action={removeParticipatingBusiness.bind(null, id, p.business_id)}>
                            <button type="submit" className="text-xs font-semibold text-red-600 hover:text-red-700">
                              Remove
                            </button>
                          </form>
                        </div>
                      </div>
                      {/* Opportunities + Conversation Foundation V1 — the
                          applicant's own optional initial note, read from
                          its Conversation via
                          getPendingApplicationNotesForEvent. Only ever
                          present while the application is still pending
                          (that lookup is scoped to status='pending'). */}
                      {pendingApplicationNotes.get(p.business_id) && (
                        <p className="mt-2 rounded-xl bg-mist/40 px-3 py-2 text-xs text-ink/70">
                          &ldquo;{pendingApplicationNotes.get(p.business_id)}&rdquo;
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function appendQuery(base: string, params: Record<string, string>): string {
  return `${base}?${new URLSearchParams(params).toString()}`;
}

function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <path
        d="M4 10.5l3.5 3.5L16 6"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
