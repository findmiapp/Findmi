import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";
import { requireLocationMember } from "@/lib/permissions";
import { canCurrentUserManageEvents } from "@/lib/entitlements";
import { getAdminLocationById } from "@/lib/admin/queries";
import { getAllMarketsForAdmin } from "@/lib/admin/business-markets";
import { getPendingMarketRequestForLocation } from "@/lib/market-requests";
import { getLocationGalleryImages, getUpcomingAtLocation } from "@/lib/data";
import AccountNav from "../../AccountNav";
import TabNav, { type TabNavItem } from "@/components/TabNav";
import MemberLocationImageField from "./MemberLocationImageField";
import MemberLocationGalleryField from "./MemberLocationGalleryField";
import {
  updateMemberLocationContact,
  updateMemberLocationDetails,
  updateMemberLocationMarket,
  updateMemberLocationPhotos,
} from "../actions";

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
  { key: "photos", label: "Photos" },
  { key: "contact", label: "Contact / Links" },
  { key: "market", label: "Market / Area" },
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
  searchParams: Promise<{ tab?: string; saved?: string; error?: string; created?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam, saved, error, created } = await searchParams;
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

  const [markets, pendingMarketRequest, galleryImages, happenings] = await Promise.all([
    getAllMarketsForAdmin(admin),
    getPendingMarketRequestForLocation(admin, id),
    getLocationGalleryImages(id),
    getUpcomingAtLocation({ id, name: location.name }),
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

  const publicHref = !location.is_demo ? `/location/${location.slug}` : null;
  const selectedMarket = markets.find((m) => m.id === location.market_id) ?? null;

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
          <span className="rounded-full bg-black/[0.06] px-3.5 py-2 text-xs font-semibold text-ink/40" title="Pending FindMi review">
            Pending Review
          </span>
        )}
      </div>

      {created === "1" && !error && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Venue created — FindMi will review it before it appears in discovery.
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
              Use the tabs above to edit your venue details, add photos, set contact info, choose your Market, add an
              event here, and see what&rsquo;s coming up.
            </p>
            <Link href={`/account/event/new?location_id=${id}`} className={`mt-4 inline-flex w-fit ${primaryButtonClass}`}>
              + Add an Event Here
            </Link>
            {!eventEligible && (
              <p className="mt-2 text-xs text-ink/45">
                Requires Organizer Access / qualifying FindMi membership — the next screen explains how to get it.
              </p>
            )}
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
              <p className="text-xs text-ink/40">
                Venue name and address are managed by FindMi. Need a correction? Contact FindMi support.
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
              Save Photos
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
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Market / Area</p>
            <p className="mt-1 text-sm text-ink/60">
              {selectedMarket
                ? `Current Market: ${selectedMarket.name}`
                : pendingMarketRequest
                  ? `Pending review — ${pendingMarketRequest.requestedText}`
                  : "Not assigned yet."}
            </p>
            <form action={updateMemberLocationMarket.bind(null, id)} className="mt-3 flex flex-col gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">Market</span>
                <select name="market_id" defaultValue={location.market_id ?? ""} className={inputClass}>
                  <option value="">Unassigned</option>
                  {markets
                    .filter((m) => m.active || m.id === location.market_id)
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

        {tab === "happening" && (
          <div className={cardClass}>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">What&rsquo;s Happening Here</p>
            <p className="mt-1 text-sm text-ink/60">
              Events and businesses scheduled to be at this venue. To add one, use &ldquo;+ Add an Event
              Here&rdquo; from the Overview tab.
            </p>
            {happenings.length === 0 ? (
              <p className="mt-4 text-sm text-ink/50">Nothing scheduled here yet.</p>
            ) : (
              <div className="mt-4 flex flex-col gap-2">
                {happenings.map((h) => (
                  <div key={h.id} className="flex items-center justify-between gap-3 rounded-2xl border border-black/10 p-3.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{h.title}</p>
                      <p className="truncate text-xs text-ink/50">
                        {new Date(h.start_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                      </p>
                    </div>
                    <Link href={h.href} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs font-semibold text-ink/50 hover:text-ink">
                      View ↗
                    </Link>
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
                location.is_demo ? "bg-black/[0.06] text-ink/60" : "bg-findmi text-white"
              }`}
            >
              {location.is_demo ? "Pending Review" : "Live"}
            </span>
            <p className="mt-3 text-sm text-ink/60">
              {location.is_demo
                ? "FindMi reviews every new venue before it appears in public discovery. You can keep editing details, photos, and contact info in the meantime."
                : "This venue is live and visible in FindMi discovery."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
