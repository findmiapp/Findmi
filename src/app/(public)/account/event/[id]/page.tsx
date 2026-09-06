import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl, isoToLocalDateTime } from "@/lib/admin/form-helpers";
import { requireEventMember } from "@/lib/permissions";
import { getAdminEventById, getAllCategories, getEventCategoryIds } from "@/lib/admin/queries";
import { getAllMarketsForAdmin } from "@/lib/admin/business-markets";
import { getPendingMarketRequestForEvent } from "@/lib/market-requests";
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
  updateMemberEventDate,
  updateMemberEventDetails,
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

const OWNER_TABS: TabNavItem[] = [
  { key: "overview", label: "Overview" },
  { key: "details", label: "Event Details" },
  { key: "dates", label: "Dates" },
  { key: "location", label: "Location" },
  { key: "market", label: "Market / Area" },
  { key: "images", label: "Images" },
  { key: "participants", label: "Participating Businesses" },
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
  }>;
}) {
  const { id } = await params;
  const { tab: tabParam, saved, error, editing_date: editingDateId } = await searchParams;
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

  const [result, categories, selectedCategoryIds, markets, pendingMarketRequest] = await Promise.all([
    getAdminEventById(id),
    getAllCategories("event"),
    getEventCategoryIds(id),
    getAllMarketsForAdmin(admin),
    getPendingMarketRequestForEvent(admin, id),
  ]);
  if (!result) redirect(errorRedirectUrl("/account", "Event not found."));
  const { event, participants, occurrences } = result;

  const publicHref = !event.is_demo ? `/event/${event.slug}` : null;
  const selectedMarket = markets.find((m) => m.id === event.market_id) ?? null;

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
        ) : (
          <span className="rounded-full bg-black/[0.06] px-3.5 py-2 text-xs font-semibold text-ink/40" title="Pending FindMi review">
            Pending Review
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
          <div className={cardClass}>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Overview</p>
            <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Status</dt>
                <dd className="mt-1 text-ink">{event.is_demo ? "Pending Review" : "Live"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Dates</dt>
                <dd className="mt-1 text-ink">{1 + occurrences.length}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Participating Businesses</dt>
                <dd className="mt-1 text-ink">{participants.length}</dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-ink/60">
              Use the tabs above to edit details, manage dates, choose a location, set your Market, add photos, and
              manage participating businesses.
            </p>
          </div>
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
                  defaultValues={{ date: "", start_time: "", end_time: "", location: null }}
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
              Search for an existing FindMi Location to autofill the fields below, or enter your venue manually.
            </p>
            <form action={updateMemberEventLocation.bind(null, id)} className="mt-3 flex flex-col gap-3">
              <AccountRelationField
                label="Search FindMi Locations"
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
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink/70">City</span>
                  <input type="text" name="city" defaultValue={event.city ?? ""} className={inputClass} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink/70">State</span>
                  <input type="text" name="state" defaultValue={event.state ?? ""} className={inputClass} />
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
              {selectedMarket
                ? `Current Market: ${selectedMarket.name}`
                : pendingMarketRequest
                  ? `Pending review — ${pendingMarketRequest.requestedText}`
                  : "Not assigned yet."}
              {event.market_area_id ? " (Area assigned)" : ""}
            </p>
            <form action={updateMemberEventMarket.bind(null, id)} className="mt-3 flex flex-col gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">Market</span>
                <select name="market_id" defaultValue={event.market_id ?? ""} className={inputClass}>
                  <option value="">Unassigned</option>
                  {markets
                    .filter((m) => m.active || m.id === event.market_id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
              <details className="group -mt-1">
                <summary className="cursor-pointer text-xs font-semibold text-ink/50 underline underline-offset-2 [&::-webkit-details-marker]:hidden">
                  Don&rsquo;t see your Market?
                </summary>
                <div className="mt-2 rounded-xl border border-black/10 bg-mist/30 p-3.5">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-ink/70">Request a Market</span>
                    <input type="text" name="requested_market_text" placeholder="e.g. Austin, TX" className={inputClass} />
                  </label>
                  <p className="mt-1.5 text-xs text-ink/45">
                    FindMi will review your request. Leave Market above set to &ldquo;Unassigned&rdquo; when using this.
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
              Invite an existing FindMi business, or approve/decline a business that applied to participate.
            </p>

            <div className="mt-3">
              <AddParticipantSearch eventId={id} excludeIds={participants.map((p) => p.business_id)} />
            </div>

            {participants.length === 0 ? (
              <p className="mt-4 text-sm text-ink/50">No participating businesses yet.</p>
            ) : (
              <div className="mt-4 flex flex-col gap-2">
                {participants.map((p) => (
                  <div key={p.business_id} className="flex items-center justify-between gap-3 rounded-2xl border border-black/10 p-3.5">
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
                event.is_demo ? "bg-black/[0.06] text-ink/60" : "bg-findmi text-white"
              }`}
            >
              {event.is_demo ? "Pending Review" : "Live"}
            </span>
            <p className="mt-3 text-sm text-ink/60">
              {event.is_demo
                ? "FindMi reviews every new event before it appears in public discovery. You can keep editing details, dates, and participants in the meantime."
                : "This event is live and visible in FindMi discovery."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function appendQuery(base: string, params: Record<string, string>): string {
  return `${base}?${new URLSearchParams(params).toString()}`;
}
