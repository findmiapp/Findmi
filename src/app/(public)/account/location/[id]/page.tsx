import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";
import { requireLocationMember } from "@/lib/permissions";
import { canCurrentUserManageEvents } from "@/lib/entitlements";
import { getAdminLocationById } from "@/lib/admin/queries";
import { getActiveMarketsWithAreaOptions } from "@/lib/admin/market-areas";
import { getPendingMarketRequestForLocation } from "@/lib/market-requests";
import { getLocationGalleryImages, getUpcomingAtLocation } from "@/lib/data";
import AccountNav from "../../AccountNav";
import TabNav, { type TabNavItem } from "@/components/TabNav";
import MarketAreaFields from "@/components/MarketAreaFields";
import MemberLocationImageField from "./MemberLocationImageField";
import MemberLocationGalleryField from "./MemberLocationGalleryField";
import {
  assignExistingEventOccurrencesToLocation,
  updateMemberLocationContact,
  updateMemberLocationDetails,
  updateMemberLocationHandle,
  updateMemberLocationMarket,
  updateMemberLocationPhotos,
} from "../actions";
import { getEntityHandle } from "@/lib/handles";
import FindmiUrlCard from "@/components/FindmiUrlCard";

export const metadata: Metadata = {
  title: "Manage Venue",
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
  { key: "details", label: "Venue Details" },
  { key: "photos", label: "Gallery" },
  { key: "contact", label: "Contact / Links" },
  { key: "market", label: "Findmi Area" },
  { key: "happening", label: "What's Happening Here" },
  { key: "status", label: "Status" },
];
const OWNER_TAB_KEYS = new Set(OWNER_TABS.map((t) => t.key));

/**
 * Multi-Entity Self-Service V1, Stage 3 — Location Manager. Reuses the
 * Business Manager / Event Manager's own tab-strip/card/save-per-tab
 * conventions (see account/business/[id]/page.tsx, account/event/[id]/
 * page.tsx) rather than inventing a new structural pattern. Location
 * ownership is entirely independent of Business ownership (location_members,
 * never business_members) — see this stage's Locked Product Model — and
 * has no plan tier or entitlement gate of its own: free for every real
 * location_members row (or an admin-elevated session), same as this
 * stage's own LOCATION ACCESS/ENTITLEMENT rule.
 */
export default async function ManageLocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; saved?: string; error?: string; created?: string; event_added?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam, saved, error, created, event_added: eventAdded } = await searchParams;
  const tab = tabParam && OWNER_TAB_KEYS.has(tabParam) ? tabParam : "overview";

  // Admin Manage-As — same shape as Business Manager/Event Manager:
  // requireLocationMember() is the complete authorization (real
  // location_members row OR an explicit founder admin session — see
  // lib/permissions.ts), never impersonation, never a fake membership row.
  let isAdminElevated = false;
  try {
    const membership = await requireLocationMember(id);
    isAdminElevated = Boolean(membership.viaAdmin);
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to that venue.";
    redirect(errorRedirectUrl("/account", message));
  }

  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl("/account", "Server isn't configured."));

  const location = await getAdminLocationById(id);
  if (!location) redirect(errorRedirectUrl("/account", "Venue not found."));

  const [marketsWithAreas, pendingMarketRequest, galleryImages, happenings, locationHandle] = await Promise.all([
    getActiveMarketsWithAreaOptions(),
    getPendingMarketRequestForLocation(admin, id),
    getLocationGalleryImages(id),
    getUpcomingAtLocation({ id, name: location.name }),
    getEntityHandle(admin, "location", id),
  ]);

  // Venue owner -> Add Event access UX (Stage 4) — Location ownership
  // does NOT grant Event Management (see this stage's Locked rule), so a
  // venue owner may legitimately lack Organizer Access. This is a
  // cosmetic, non-authorizing hint only — checked against the caller's
  // OWN real Supabase Auth session, never the Location membership itself
  // (an admin-elevated session with no real user has neither) — the real
  // gate stays entirely in /account/event/new, which re-derives this
  // independently and shows its own graceful explainer either way. This
  // just lets the Overview tab set expectations before the click instead
  // of after.
  const sessionSupabase = await getServerSupabase();
  const {
    data: { user: sessionUser },
  } = await sessionSupabase.auth.getUser();
  const eventEligible = sessionUser ? await canCurrentUserManageEvents(admin, sessionUser.id) : false;

  // Venue Command Center pass — "What's Happening Here" becomes a real
  // operational view: every upcoming Event occurrence AND standalone
  // Business appearance whose own event_occurrences.location_id /
  // appearances.location_id already points at this Location (the same
  // canonical FKs the public page reads via getUpcomingAtLocation — this
  // is a richer, manager-facing query, not a second relationship), plus
  // "canManage" so a View vs. Manage link is only ever offered for an
  // Event/Business the CURRENT session actually has real membership over.
  // Location ownership and Event/Business ownership stay fully separate —
  // this never grants management, only decides which link to show.
  type UpcomingHereItem = {
    kind: "occurrence" | "appearance";
    id: string;
    startAt: string;
    endAt: string | null;
    title: string;
    subtitle: string | null;
    publicHref: string;
    canManage: boolean;
    manageHref: string | null;
    confirmedCount: number | null;
  };
  let upcomingHere: UpcomingHereItem[] = [];
  type ManageableEvent = {
    id: string;
    name: string;
    occurrences: { id: string; start_at: string; end_at: string; assignedHere: boolean }[];
  };
  let manageableEvents: ManageableEvent[] = [];
  let manageableBusinesses: { id: string; name: string }[] = [];

  if (sessionUser) {
    const nowIso = new Date().toISOString();
    const [{ data: occRows }, { data: apRows }, { data: myEventLinks }, { data: myBusinessLinks }] = await Promise.all([
      admin
        .from("event_occurrences")
        .select("id, start_at, end_at, event:events(id, name, slug, organizer_name, publication_status, is_demo)")
        .eq("location_id", id)
        .eq("status", "scheduled")
        .gt("end_at", nowIso)
        .order("start_at", { ascending: true }),
      admin
        .from("appearances")
        .select("id, title, start_at, end_at, business:businesses(id, name, slug)")
        .eq("location_id", id)
        .is("event_id", null)
        .neq("status", "canceled")
        .gt("end_at", nowIso)
        .order("start_at", { ascending: true }),
      admin.from("event_members").select("event_id").eq("user_id", sessionUser.id),
      admin.from("business_members").select("business_id").eq("user_id", sessionUser.id),
    ]);

    const manageableEventIds = new Set((myEventLinks ?? []).map((r) => r.event_id));
    const manageableBusinessIds = new Set((myBusinessLinks ?? []).map((r) => r.business_id));

    const occurrenceIds = (occRows ?? []).map((r) => r.id);
    const { data: confirmedRows } =
      occurrenceIds.length > 0
        ? await admin
            .from("event_occurrence_businesses")
            .select("occurrence_id")
            .eq("status", "approved")
            .in("occurrence_id", occurrenceIds)
        : { data: [] as { occurrence_id: string }[] };
    const confirmedCountByOccurrence = new Map<string, number>();
    for (const row of confirmedRows ?? []) {
      confirmedCountByOccurrence.set(row.occurrence_id, (confirmedCountByOccurrence.get(row.occurrence_id) ?? 0) + 1);
    }

    const fromOccurrences: UpcomingHereItem[] = (occRows ?? []).flatMap((r) => {
      const e = Array.isArray(r.event) ? r.event[0] : r.event;
      if (!e || e.is_demo) return [];
      return [
        {
          kind: "occurrence" as const,
          id: r.id,
          startAt: r.start_at,
          endAt: r.end_at,
          title: e.name,
          subtitle: e.organizer_name,
          publicHref: `/event/${e.slug}`,
          canManage: manageableEventIds.has(e.id),
          manageHref: manageableEventIds.has(e.id) ? `/account/event/${e.id}?tab=dates` : null,
          confirmedCount: confirmedCountByOccurrence.get(r.id) ?? 0,
        },
      ];
    });

    const fromAppearances: UpcomingHereItem[] = (apRows ?? []).flatMap((r) => {
      const b = Array.isArray(r.business) ? r.business[0] : r.business;
      if (!b) return [];
      return [
        {
          kind: "appearance" as const,
          id: r.id,
          startAt: r.start_at,
          endAt: r.end_at,
          title: r.title,
          subtitle: b.name,
          publicHref: `/business/${b.slug}`,
          canManage: manageableBusinessIds.has(b.id),
          manageHref: manageableBusinessIds.has(b.id) ? `/account/business/${b.id}?tab=findmi-here` : null,
          confirmedCount: null,
        },
      ];
    });

    upcomingHere = [...fromOccurrences, ...fromAppearances].sort((a, b) => a.startAt.localeCompare(b.startAt));

    // "Add Existing Event Here" — every Event the current session
    // manages, with ITS OWN existing occurrences only (never a new one
    // fabricated here — a legacy single-date Event with no Additional
    // Dates has nothing to pick until one is added from that Event's own
    // Dates tab). assignedHere just preselects the checkbox for a date
    // already pointed at this Location, so re-visiting reflects reality.
    if (manageableEventIds.size > 0) {
      const [{ data: myEvents }, { data: myOccRows }] = await Promise.all([
        admin.from("events").select("id, name").in("id", Array.from(manageableEventIds)).eq("is_demo", false),
        admin
          .from("event_occurrences")
          .select("id, event_id, start_at, end_at, location_id")
          .in("event_id", Array.from(manageableEventIds))
          .eq("status", "scheduled")
          .gt("end_at", nowIso)
          .order("start_at", { ascending: true }),
      ]);
      manageableEvents = (myEvents ?? []).map((e) => ({
        id: e.id,
        name: e.name,
        occurrences: (myOccRows ?? [])
          .filter((o) => o.event_id === e.id)
          .map((o) => ({ id: o.id, start_at: o.start_at, end_at: o.end_at, assignedHere: o.location_id === id })),
      }));
    }

    // "Add Appearance Here" — only offered for a Business the acting
    // session actually manages (never lets a Location manager create an
    // appearance for someone else's Business). Links into that Business's
    // own existing Findmi Here tab (Option 2 form now supports picking
    // this Location) rather than a second creation form.
    if (manageableBusinessIds.size > 0) {
      const { data: myBusinesses } = await admin
        .from("businesses")
        .select("id, name")
        .in("id", Array.from(manageableBusinessIds))
        .eq("is_demo", false);
      manageableBusinesses = myBusinesses ?? [];
    }
  }

  const publicHref = !location.is_demo ? `/location/${location.slug}` : null;
  const selectedMarket = marketsWithAreas.find((m) => m.id === location.market_id) ?? null;
  const selectedArea = selectedMarket?.areas.find((a) => a.id === location.market_area_id) ?? null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <AccountNav />

      {isAdminElevated && (
        <div className="mx-auto mb-4 max-w-md rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-bold text-amber-800">Admin mode — you are managing {location.name} with elevated access.</p>
          <Link
            href={`/admin/locations/${id}`}
            className="mt-1.5 inline-block text-xs font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900"
          >
            Exit Admin Mode
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Location Manager</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{location.name}</h1>
        </div>
        {publicHref ? (
          <Link
            href={publicHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-black/10 px-3.5 py-2 text-xs font-semibold text-ink/60 transition hover:border-black/20 hover:text-ink"
          >
            View Public Venue ↗
          </Link>
        ) : (
          <span className="rounded-full bg-black/[0.06] px-3.5 py-2 text-xs font-semibold text-ink/40" title="Pending Findmi review">
            Pending Review
          </span>
        )}
      </div>

      {created === "1" && !error && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Venue created — Findmi will review it before it appears in discovery.
        </p>
      )}
      {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {saved && !error && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">Saved.</p>
      )}

      <div className="mt-5">
        <TabNav items={OWNER_TABS} activeKey={tab} basePath={`/account/location/${id}`} />
      </div>

      <div className="mt-5 flex flex-col gap-5">
        {tab === "overview" && (
          <div className={cardClass}>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Overview</p>
            <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Status</dt>
                <dd className="mt-1 text-ink">{location.is_demo ? "Pending Review" : "Live"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Address</dt>
                <dd className="mt-1 text-ink">{location.address || "Not set"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Happening Here</dt>
                <dd className="mt-1 text-ink">{happenings.length} upcoming</dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-ink/60">
              Use the tabs above to edit your venue details, add gallery photos, set contact info, choose your Findmi
              area, add an event here, and see what&rsquo;s coming up.
            </p>
            <Link href={`/account/event/new?location_id=${id}`} className={`mt-4 inline-flex w-fit ${primaryButtonClass}`}>
              + Add an Event Here
            </Link>
            {!eventEligible && (
              <p className="mt-2 text-xs text-ink/45">
                Requires Organizer Access / qualifying Findmi membership — the next screen explains how to get it.
              </p>
            )}
          </div>
        )}

        {tab === "overview" && (
          <div className={cardClass}>
            <FindmiUrlCard
              entityType="location"
              entityId={id}
              entityLabel={location.name}
              currentHandle={locationHandle}
              action={updateMemberLocationHandle.bind(null, id)}
            />
          </div>
        )}

        {tab === "details" && (
          <div className={cardClass}>
            <form action={updateMemberLocationDetails.bind(null, id)} className="flex flex-col gap-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink">Description</span>
                <textarea name="description" rows={4} defaultValue={location.description ?? ""} className={inputClass} />
              </label>
              <MemberLocationImageField
                locationId={id}
                label="Cover / Hero Image"
                name="cover_image_url"
                defaultValue={location.cover_image_url}
              />
              <MemberLocationImageField
                locationId={id}
                label="Logo / Profile Image (square works best)"
                name="logo_url"
                defaultValue={location.logo_url}
              />
              <p className="text-xs text-ink/40">
                Venue name and address are managed by Findmi. Need a correction? Contact Findmi support.
              </p>
              <button type="submit" className={`mt-1 w-fit ${primaryButtonClass}`}>
                Save Venue Details
              </button>
            </form>
          </div>
        )}

        {tab === "photos" && (
          <form action={updateMemberLocationPhotos.bind(null, id)} className="flex flex-col gap-5">
            <div className={cardClass}>
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Venue Gallery</p>
              <div className="mt-3">
                <MemberLocationGalleryField locationId={id} name="gallery_image_url" initialUrls={galleryImages} />
              </div>
            </div>
            <button type="submit" className={`w-fit ${primaryButtonClass}`}>
              Save Gallery
            </button>
          </form>
        )}

        {tab === "contact" && (
          <div className={cardClass}>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Contact / Links</p>
            <form action={updateMemberLocationContact.bind(null, id)} className="mt-3 flex flex-col gap-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink">
                  Website <span className="font-normal text-ink/40">(optional)</span>
                </span>
                <input type="url" name="website_url" defaultValue={location.website_url ?? ""} placeholder="https://" className={inputClass} />
              </label>
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-ink">Email</span>
                  <input type="email" name="email" defaultValue={location.email ?? ""} className={inputClass} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-ink">Phone</span>
                  <input type="tel" name="phone" defaultValue={location.phone ?? ""} className={inputClass} />
                </label>
              </div>
              <button type="submit" className={`mt-1 w-fit ${primaryButtonClass}`}>
                Save Contact / Links
              </button>
            </form>
          </div>
        )}

        {tab === "market" && (
          <div className={cardClass}>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Findmi Area</p>
            <p className="mt-1 text-sm text-ink/60">
              {selectedMarket
                ? `Findmi area: ${selectedMarket.name}${selectedArea ? ` — ${selectedArea.name}` : ""}`
                : pendingMarketRequest
                  ? `Findmi area pending review — ${pendingMarketRequest.requestedText}`
                  : "No Findmi area selected yet."}
            </p>
            <form action={updateMemberLocationMarket.bind(null, id)} className="mt-3 flex flex-col gap-3">
              <MarketAreaFields
                markets={marketsWithAreas}
                defaultMarketId={location.market_id}
                defaultAreaId={location.market_area_id}
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
        )}

        {tab === "happening" && (
          <div className="flex flex-col gap-5">
            <div className={cardClass}>
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">What&rsquo;s Happening Here</p>
              <p className="mt-1 text-sm text-ink/60">
                Every Event date and Business appearance already connected to this venue, plus the tools to connect
                more.
              </p>

              {eventAdded === "1" && !error && (
                <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
                  Connected to this venue.
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/account/event/new?location_id=${id}`} className={primaryButtonClass}>
                  + Create Event Here
                </Link>
                {!eventEligible && (
                  <p className="basis-full text-xs text-ink/45">
                    Requires Organizer Access / qualifying Findmi membership — the next screen explains how to get it.
                  </p>
                )}
              </div>
            </div>

            {sessionUser && manageableEvents.length > 0 && (
              <div className={cardClass}>
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Add an Existing Event Here</p>
                <p className="mt-1 text-sm text-ink/60">
                  Connect a date from an Event you already manage. Only Events you manage appear here — Findmi never
                  lets a venue reassign someone else&rsquo;s Event.
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {manageableEvents.map((e) => (
                    <details key={e.id} className="group rounded-2xl border border-black/10 p-3.5">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                        <span className="text-sm font-semibold text-ink">{e.name}</span>
                        <span className="text-xs text-ink/40">
                          {e.occurrences.length === 0 ? "No dates yet" : `${e.occurrences.length} date${e.occurrences.length === 1 ? "" : "s"}`}
                        </span>
                      </summary>
                      <div className="mt-3 border-t border-black/10 pt-3">
                        {e.occurrences.length === 0 ? (
                          <p className="text-xs text-ink/50">
                            This Event has no additional dates yet.{" "}
                            <Link href={`/account/event/${e.id}?tab=dates`} className="font-semibold text-findmi-700 hover:underline">
                              Add one from its Dates tab
                            </Link>{" "}
                            first.
                          </p>
                        ) : (
                          <form action={assignExistingEventOccurrencesToLocation.bind(null, id, e.id)} className="flex flex-col gap-2">
                            {e.occurrences.map((o) => (
                              <label key={o.id} className="flex items-center gap-2.5 text-sm text-ink">
                                <input
                                  type="checkbox"
                                  name="occurrence_ids"
                                  value={o.id}
                                  defaultChecked={o.assignedHere}
                                  className="h-4 w-4 shrink-0 accent-findmi"
                                />
                                {new Date(o.start_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                                {o.assignedHere && <span className="text-xs font-semibold text-findmi-700">Already here</span>}
                              </label>
                            ))}
                            <button type="submit" className="mt-1 w-fit rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600">
                              Save
                            </button>
                          </form>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            )}

            {sessionUser && manageableBusinesses.length > 0 && (
              <div className={cardClass}>
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Add an Appearance Here</p>
                <p className="mt-1 text-sm text-ink/60">
                  Adds a standalone Findmi Here entry (no Event required) for a Business you manage, with{" "}
                  {location.name} already selected as the Location.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {manageableBusinesses.map((b) => (
                    <Link
                      key={b.id}
                      href={`/account/business/${b.id}?tab=findmi-here&location_id=${id}`}
                      className="rounded-full border border-black/10 px-3.5 py-2 text-xs font-semibold text-ink/70 transition hover:border-black/20"
                    >
                      + Add for {b.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className={cardClass}>
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Upcoming Here</p>
              {upcomingHere.length === 0 ? (
                <p className="mt-3 text-sm text-ink/50">Nothing scheduled here yet.</p>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  {upcomingHere.map((item) => (
                    <div key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-black/10 p-3.5">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate text-sm font-semibold text-ink">{item.title}</p>
                          <span className="shrink-0 rounded-full bg-black/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/50">
                            {item.kind === "occurrence" ? "Event" : "Appearance"}
                          </span>
                        </div>
                        <p className="truncate text-xs text-ink/50">
                          {new Date(item.startAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                          {item.subtitle ? ` · ${item.subtitle}` : ""}
                        </p>
                        {item.confirmedCount !== null && (
                          <p className="mt-0.5 text-xs font-semibold text-findmi-700">
                            {item.confirmedCount} business{item.confirmedCount === 1 ? "" : "es"} confirmed
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <Link href={item.publicHref} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-ink/50 hover:text-ink">
                          View ↗
                        </Link>
                        {item.manageHref && (
                          <Link href={item.manageHref} className="text-xs font-semibold text-findmi-700 hover:underline">
                            Manage
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "status" && (
          <div className={cardClass}>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Status</p>
            <span
              className={`mt-2 inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                location.is_demo ? "bg-black/[0.06] text-ink/60" : "bg-findmi text-white"
              }`}
            >
              {location.is_demo ? "Pending Review" : "Live"}
            </span>
            <p className="mt-3 text-sm text-ink/60">
              {location.is_demo
                ? "Findmi reviews every new venue before it appears in public discovery. You can keep editing details, your gallery, and contact info in the meantime."
                : "This venue is live and visible in Findmi discovery."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
