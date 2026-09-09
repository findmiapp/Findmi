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
import { AccountRelationField } from "@/components/account/AccountRelationPicker";
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
const cardClass = "rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6";

// Event Creation + Pending Review UX pass — mobile tab labels shortened
// (horizontally-scrolling strip was fine, the labels were just wider than
// they needed to be). Full descriptive headings ("Participating
// Businesses", "Market / Area") are unchanged inside each tab's own
// content — only this nav strip's labels are shortened.
const OWNER_TABS: TabNavItem[] = [
  { key: "overview", label: "Overview" },
  { key: "details", label: "Event Details" },
  { key: "dates", label: "Dates" },
  { key: "location", label: "Location" },
  { key: "market", label: "Area" },
  { key: "images", label: "Images" },
  { key: "participants", label: "Businesses" },
  { key: "status", label: "Status" },
];
const OWNER_TAB_KEYS = new Set(OWNER_TABS.map((t) => t.key));

const PARTICIPATION_LABEL: Record<EventParticipationStatus, string> = {
  invited: "Invited",
  applied: "Pending (Applied)",
  pending: "Pending",
  approved: "Approved — Confirmed",
  declined: "Declined",
};

/**
 * Multi-Entity Self-Service V1, Stage 2 — Event Manager. Reuses the
 * Business Manager's own tab-strip/card/save-per-tab conventions (see
 * account/business/[id]/page.tsx) rather than inventing a new structural
 * pattern. Owner-facing terminology throughout: "Dates", never
 * "occurrences"; "Participating Businesses", never "event_businesses" or
 * raw EventParticipationStatus enum values.
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
  const tab = tabParam && OWNER_TAB_KEYS.has(tabParam) ? tabParam : "overview";

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
      ? admin.from("locations").select("id, name, city").eq("id", addLocationId).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
    getPendingApplicationNotesForEvent(admin, id),
  ]);
  if (!result) redirect(errorRedirectUrl("/account", "Event not found."));
  const { event, participants, occurrences } = result;

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
    { key: "location", label: "Location", complete: Boolean(event.venue_name), tab: "location" },
    {
      key: "photos",
      label: "Photos",
      complete: Boolean(event.cover_image_url) || result.galleryImages.length > 0,
      tab: "images",
    },
  ];
  const essentialsComplete = essentialItems.every((i) => i.complete);

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
        {tab === "overview" && (
          <>
            {/* FindMi Global Handle Registry — same "not buried, never
                mandatory, never auto-assigned from the title" posture as
                Business/Location. An Event keeps working at its existing
                /event/[slug] route regardless of whether one is set. */}
            <div className={cardClass}>
              <FindmiUrlCard
                entityType="event"
                entityId={id}
                entityLabel={event.name}
                currentHandle={eventHandle}
                action={updateMemberEventHandle.bind(null, id)}
              />
            </div>

            {event.is_demo && isRejected && (
              <div className={cardClass}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-red-700">
                    Needs Changes
                  </span>
                  <p className="text-xs text-ink/40">Not public yet</p>
                </div>
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
              <div className={cardClass}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-black/[0.06] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-ink/60">
                    In Review
                  </span>
                  <p className="text-xs text-ink/40">Not public yet</p>
                </div>
                <p className="mt-2 text-sm text-ink/70">
                  Keep building your listing while Findmi reviews it.
                </p>
              </div>
            )}

            {/* Finish Your Event — Event Creation + Pending Review UX pass.
                Guidance only, never a new validation/moderation gate:
                every item reflects real, already-editable Event data (see
                essentialItems above), and Participating Businesses is
                deliberately never part of the "essentials" set — zero
                participants is a legitimate, publishable event. Once
                every essential is done, this collapses to a single
                compact positive line instead of permanently dominating
                the tab. */}
            <div className={cardClass}>
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
                  zero Participating Businesses is legitimate and never
                  blocks essentials-complete above. */}
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

            <div className={cardClass}>
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Snapshot</p>
              <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Status</dt>
                  <dd className="mt-1 text-ink">{!event.is_demo ? "Live" : isRejected ? "Needs Changes" : "In Review"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Dates</dt>
                  <dd className="mt-1 text-ink">{1 + occurrences.length}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Businesses</dt>
                  <dd className="mt-1 text-ink">{participants.length}</dd>
                </div>
              </dl>
            </div>
          </>
        )}

        {tab === "details" && (
          <div className={cardClass}>
            <form action={updateMemberEventDetails.bind(null, id)} className="flex flex-col gap-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink">Event name</span>
                <input type="text" name="name" required defaultValue={event.name} className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink">Description</span>
                <textarea name="description" rows={4} defaultValue={event.description ?? ""} className={inputClass} />
              </label>
              <MemberEventImageField eventId={id} label="Cover Image" name="cover_image_url" defaultValue={event.cover_image_url} />
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-ink">Organizer name</span>
                  <input type="text" name="organizer_name" defaultValue={event.organizer_name ?? ""} className={inputClass} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-ink">Organizer email</span>
                  <input type="email" name="organizer_email" defaultValue={event.organizer_email ?? ""} className={inputClass} />
                </label>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink">
                  Website / Link <span className="font-normal text-ink/40">(optional)</span>
                </span>
                <input type="url" name="external_url" defaultValue={event.external_url ?? ""} placeholder="https://" className={inputClass} />
              </label>
              <div>
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
              <button type="submit" className={`mt-1 w-fit ${primaryButtonClass}`}>
                Save Event Details
              </button>
            </form>
          </div>
        )}

        {tab === "dates" && (
          <>
            <div className={cardClass}>
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Primary Date</p>
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
                  Save Primary Date
                </button>
              </form>
            </div>

            <div className={cardClass}>
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Additional Dates</p>
              {occurrences.length === 0 ? (
                <p className="mt-2 text-sm text-ink/50">No additional dates yet.</p>
              ) : (
                <div className="mt-3 flex flex-col gap-3">
                  {occurrences.map((occ) => {
                    const isEditing = editingDateId === occ.id;
                    if (isEditing) {
                      return (
                        <div key={occ.id} className="rounded-2xl border border-black/10 p-3.5">
                          <EventDateFieldsForm
                            action={updateMemberEventDate.bind(null, id, occ.id)}
                            defaultValues={{
                              date: isoToLocalDateTime(occ.start_at).slice(0, 10),
                              start_time: isoToLocalDateTime(occ.start_at).slice(11),
                              end_time: isoToLocalDateTime(occ.end_at).slice(11),
                              location: occ.location_name ? { value: occ.location_id ?? "", label: occ.location_name, sublabel: occ.location_city ?? undefined } : null,
                            }}
                            submitLabel="Save Date"
                          />
                        </div>
                      );
                    }
                    return (
                      <div key={occ.id} className="flex items-center justify-between gap-3 rounded-2xl border border-black/10 p-3.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">
                            {new Date(occ.start_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                          </p>
                          {occ.location_name && <p className="truncate text-xs text-ink/50">{occ.location_name}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
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
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-4 rounded-2xl border border-dashed border-black/15 p-3.5">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink/40">Add a Date</p>
                <EventDateFieldsForm
                  action={addMemberEventDate.bind(null, id)}
                  defaultValues={{
                    date: addDate ?? "",
                    start_time: addStartTime ?? "",
                    end_time: addEndTime ?? "",
                    location: addLocationHint
                      ? { value: addLocationHint.id, label: addLocationHint.name, sublabel: addLocationHint.city ?? undefined }
                      : null,
                  }}
                  submitLabel="Add Date"
                />
              </div>
            </div>
          </>
        )}

        {tab === "location" && (
          <div className={cardClass}>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Location</p>
            <p className="mt-1 text-sm text-ink/60">
              Search for an existing Findmi Location to autofill the fields below, or enter your venue manually.
            </p>
            <form action={updateMemberEventLocation.bind(null, id)} className="mt-3 flex flex-col gap-3">
              <AccountRelationField
                label="Search Findmi Locations"
                name="location_id"
                entity="locations"
                initial={null}
                clearLabel="Enter manually below"
              />
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">Venue name</span>
                <input type="text" name="venue_name" defaultValue={event.venue_name ?? ""} className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">Address</span>
                <input type="text" name="address" defaultValue={event.address ?? ""} className={inputClass} />
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink/70">City</span>
                  <input type="text" name="city" defaultValue={event.city ?? ""} className={inputClass} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink/70">State</span>
                  <input type="text" name="state" defaultValue={event.state ?? ""} className={inputClass} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink/70">ZIP Code</span>
                  <input type="text" name="postal_code" defaultValue={event.postal_code ?? ""} className={inputClass} />
                </label>
              </div>
              <p className="text-xs text-ink/40">
                Selecting a Location above overwrites the fields below with that Location&rsquo;s own address — save
                after picking one, or edit the fields manually and leave the search blank.
              </p>
              <button type="submit" className={`w-fit ${primaryButtonClass}`}>
                Save Location
              </button>
            </form>
          </div>
        )}

        {tab === "market" && (
          <div className={cardClass}>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Market / Area</p>
            <p className="mt-1 text-sm text-ink/60">
              Findmi discovery geography — where this Event appears in Findmi search/browse. Separate from the
              physical Venue/Address set on the Location tab.
            </p>
            <p className="mt-2 text-sm text-ink/60">
              {selectedMarket
                ? `Current Market: ${selectedMarket.name}${
                    event.market_area_id
                      ? ` — ${
                          marketsWithAreas.find((m) => m.id === event.market_id)?.areas.find((a) => a.id === event.market_area_id)
                            ?.name ?? "Area assigned"
                        }`
                      : ""
                  }`
                : pendingMarketRequest
                  ? `Pending review — ${pendingMarketRequest.requestedText}`
                  : "Not assigned yet."}
            </p>
            <form action={updateMemberEventMarket.bind(null, id)} className="mt-3 flex flex-col gap-3">
              <MarketAreaFields
                markets={marketsWithAreas}
                defaultMarketId={event.market_id}
                defaultAreaId={event.market_area_id}
              />
              <details className="group -mt-1">
                <summary className="cursor-pointer text-xs font-semibold text-ink/50 underline underline-offset-2 [&::-webkit-details-marker]:hidden">
                  Don&rsquo;t see your Market or Area?
                </summary>
                <div className="mt-2 rounded-xl border border-black/10 bg-mist/30 p-3.5">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-ink/70">Request a Market</span>
                    <input type="text" name="requested_market_text" placeholder="e.g. Austin, TX" className={inputClass} />
                  </label>
                  <p className="mt-1.5 text-xs text-ink/45">
                    Findmi will review your request. Leave Market above set to &ldquo;Unassigned&rdquo; when using this.
                  </p>
                </div>
              </details>
              <button type="submit" className={`w-fit ${primaryButtonClass}`}>
                Save Market
              </button>
            </form>
          </div>
        )}

        {tab === "images" && (
          <form action={updateMemberEventImages.bind(null, id)} className="flex flex-col gap-5">
            <div className={cardClass}>
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Event Gallery</p>
              <div className="mt-3">
                <MemberEventGalleryField eventId={id} name="gallery_image_url" initialUrls={result.galleryImages} />
              </div>
            </div>
            <div className={cardClass}>
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">About the Venue — Gallery</p>
              <div className="mt-3">
                <MemberEventGalleryField eventId={id} name="venue_image_url" initialUrls={result.venueImages} />
              </div>
            </div>
            <button type="submit" className={`w-fit ${primaryButtonClass}`}>
              Save Images
            </button>
          </form>
        )}

        {tab === "participants" && (
          <div className={cardClass}>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Participating Businesses</p>
            <p className="mt-1 text-sm text-ink/60">
              Invite an existing Findmi business, or approve/decline a business that applied to participate.
            </p>

            <div className="mt-3">
              <AddParticipantSearch eventId={id} excludeIds={participants.map((p) => p.business_id)} />
            </div>

            {participants.length === 0 ? (
              <p className="mt-4 text-sm text-ink/50">No participating businesses yet.</p>
            ) : (
              <div className="mt-4 flex flex-col gap-2">
                {participants.map((p) => (
                  <div key={p.business_id} className="rounded-2xl border border-black/10 p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{p.business_name}</p>
                      <p className="text-xs text-ink/50">{PARTICIPATION_LABEL[p.status]}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {(p.status === "applied" || p.status === "pending" || p.status === "invited") && (
                        <form action={updateParticipatingBusinessStatus.bind(null, id, p.business_id, "approved")}>
                          <button type="submit" className="rounded-full bg-findmi px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white">
                            Approve
                          </button>
                        </form>
                      )}
                      {p.status !== "declined" && (
                        <form action={updateParticipatingBusinessStatus.bind(null, id, p.business_id, "declined")}>
                          <button type="submit" className="rounded-full border border-black/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink/60">
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
                      applicant's own optional initial note, read from its
                      Conversation via getPendingApplicationNotesForEvent.
                      Only ever present while the application is still
                      pending (that lookup is scoped to status='pending'). */}
                  {pendingApplicationNotes.get(p.business_id) && (
                    <p className="mt-2 rounded-xl bg-mist/40 px-3 py-2 text-xs text-ink/70">
                      &ldquo;{pendingApplicationNotes.get(p.business_id)}&rdquo;
                    </p>
                  )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "status" && (
          <div className={cardClass}>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Status</p>
            <span
              className={`mt-2 inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                !event.is_demo
                  ? "bg-findmi text-white"
                  : isRejected
                    ? "bg-red-50 text-red-700"
                    : "bg-black/[0.06] text-ink/60"
              }`}
            >
              {!event.is_demo ? "Live" : isRejected ? "Needs Changes" : "In Review"}
            </span>
            <p className="mt-3 text-sm text-ink/60">
              {!event.is_demo
                ? "This event is live and visible in Findmi discovery."
                : isRejected
                  ? "This event wasn't approved yet. You can update it and submit it for review again."
                  : "Not public yet. Keep building your listing while Findmi reviews it — you can keep editing details, dates, photos, and participants in the meantime."}
            </p>
            {isRejected && (
              <form action={submitForReviewAction} className="mt-3">
                <button type="submit" className={`w-fit ${primaryButtonClass}`}>
                  Submit for Review
                </button>
              </form>
            )}
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
