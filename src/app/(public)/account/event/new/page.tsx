import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { canCurrentUserManageEvents } from "@/lib/entitlements";
import { getActiveMarkets } from "@/lib/data";
import EventGeographyFields from "@/components/EventGeographyFields";
import { requireBusinessMember } from "@/lib/permissions";
import { createMemberEvent } from "../actions";

/** Multi-Entity Self-Service V1, Stage 3 — Create Event From Venue. A
 * Location owner's "+ Add an Event Here" link (see the Location Manager's
 * Overview tab) lands here with ?location_id=<id>; that Location's own
 * name/address/city/state are copied onto the new event at creation
 * (see createMemberEvent's own comment) purely as a venue-fields autofill
 * convenience — it never grants the event's ownership to the Location
 * owner, and never grants the Location's ownership to the event creator.
 * The Location's ownership is looked up only to display its name here;
 * this deliberately does NOT require the current visitor to be a member
 * of that Location — anyone entitled to create an event may create one at
 * any existing FindMi venue, same as picking one from the existing
 * Location search on the Event Manager's own Location tab. */
interface LocationHint {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
}

async function getLocationHint(locationId: string | undefined): Promise<LocationHint | null> {
  if (!locationId) return null;
  const admin = getAdminSupabase();
  if (!admin) return null;
  const { data } = await admin
    .from("locations")
    .select("id, name, slug, city, state, address, postal_code, category:categories(name)")
    .eq("id", locationId)
    .maybeSingle();
  if (!data) return null;
  const category = Array.isArray(data.category) ? (data.category[0] ?? null) : data.category;
  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    category: category?.name ?? null,
    address: data.address,
    city: data.city,
    state: data.state,
    postal_code: data.postal_code,
  };
}

export const metadata: Metadata = {
  title: "Add an Event",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-button font-bold uppercase text-white transition hover:bg-findmi-600";

/** Multi-Entity Self-Service V1, Stage 2 — native Event creation entry
 * point. Only qualifying signed-in users may create an Event (see
 * canCurrentUserManageEvents — active Pro or a redeemed Pro Invite on
 * some business they belong to; no separate Event fee, ever). A
 * non-qualifying user sees the membership-required explainer directly on
 * this page instead of a broken/dead-end form — createMemberEvent itself
 * independently re-checks entitlement too, so this page's own gate is a
 * UX convenience, never the real authorization. */
export default async function AddEventPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    location_id?: string;
    name?: string;
    start_at?: string;
    end_at?: string;
    market_id?: string;
    requested_market_text?: string;
    business_id?: string;
  }>;
}) {
  const {
    error,
    location_id: locationIdHint,
    name: submittedName,
    start_at: submittedStartAt,
    end_at: submittedEndAt,
    market_id: submittedMarketId,
    requested_market_text: submittedRequestedMarketText,
    business_id: businessIdParam,
  } = await searchParams;
  const locationHint = await getLocationHint(locationIdHint);

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const next = businessIdParam ? `/account/event/new?business_id=${encodeURIComponent(businessIdParam)}` : "/account/event/new";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const admin = getAdminSupabase();
  const entitled = admin ? await canCurrentUserManageEvents(admin, user.id) : false;
  // Business Manager V2 Pass A — "Add to Presence → Hosting something"
  // opens this same flow with the originating business as CONTEXT only
  // (back link + wording). It does not make that business the Event's
  // host — no host relationship exists until Pass C.
  const businessContext = await resolveBusinessContext(businessIdParam);
  const backToBusiness = businessContext ? (
    <Link
      href={`/account/business/${businessContext.id}?tab=findmi-here`}
      className="text-metadata font-semibold text-muted hover:text-primary"
    >
      &larr; {businessContext.name}
    </Link>
  ) : null;

  if (!entitled) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-10">
        {backToBusiness ?? <p className="text-label font-bold uppercase text-accent">Your Findmi</p>}
        <h1 className="mt-1 font-display text-page-title font-bold text-primary sm:text-display">
          {businessContext ? "Hosting something" : "Add an Event"}
        </h1>
        <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
          <p className="text-body font-semibold text-primary">Event management is included with qualifying Findmi membership.</p>
          <p className="mt-2 text-body text-muted">
            Get Findmi Pro (or redeem a Pro Invite) on a business you manage to create and manage Events, with no
            separate Event fee.
          </p>
          {locationHint && (
            <p className="mt-2 text-body text-muted">
              Once you have Organizer Access, come back here to add your event at {locationHint.name} directly.
            </p>
          )}
          <Link href="/account/business/new" className={`mt-5 ${primaryButtonClass}`}>
            Add a Business
          </Link>
          <Link href="/join/business" className="mt-3 flex h-11 w-full items-center justify-center text-metadata font-semibold text-muted transition hover:text-primary">
            Learn about Findmi Pro
          </Link>
        </div>
      </div>
    );
  }

  const markets = await getActiveMarkets();

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-10">
      {backToBusiness ?? <p className="text-label font-bold uppercase text-accent">Your Findmi</p>}
      <h1 className="mt-1 font-display text-page-title font-bold text-primary sm:text-display">
        {businessContext ? "Hosting something" : "Add an Event"}
      </h1>
      <p className="mt-2 text-body text-muted">
        {businessContext
          ? "Create the activation, pop-up, tasting, class, launch or event you’re organizing. You’ll finish the details and dates in Event Manager; Findmi reviews it before it appears publicly."
          : "Create your event, then finish the details in Event Manager. Findmi will review it before it appears publicly."}
      </p>

      {error && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-body text-red-700">{error}</p>}

      <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
        <form action={createMemberEvent} className="flex flex-col gap-4">
          {businessContext && <input type="hidden" name="business_id" value={businessContext.id} />}
          {/* Geography Foundation Pass 2 — Location selection/manual venue
              entry (EventLocationField, unchanged) plus a live Findmi
              Market suggestion derived from whichever one is effective.
              See EventGeographyFields' own doc comment. */}
          <EventGeographyFields
            markets={markets}
            initialLocation={locationHint}
            initialManual={null}
            defaultMarketId={submittedMarketId ?? ""}
            defaultRequestedMarketText={submittedRequestedMarketText ?? ""}
          />

          <label className="block">
            <span className="mb-1.5 block text-body font-medium text-primary">Event name</span>
            <input
              type="text"
              name="name"
              required
              defaultValue={submittedName ?? ""}
              placeholder="Your event name"
              className={inputClass}
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1.5 block text-body font-medium text-primary">Start date &amp; time</span>
              <input
                type="datetime-local"
                name="start_at"
                required
                defaultValue={submittedStartAt ?? ""}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-body font-medium text-primary">End date &amp; time</span>
              <input
                type="datetime-local"
                name="end_at"
                required
                defaultValue={submittedEndAt ?? ""}
                className={inputClass}
              />
            </label>
          </div>

          <button type="submit" className={`mt-2 ${primaryButtonClass}`}>
            Create My Event
          </button>
          <p className="text-center text-metadata text-subtle">
            No separate Event fee. Included with your qualifying Findmi membership.
          </p>
        </form>
      </div>
    </div>
  );
}

/** Pass A — the originating business, honored only for one of its own
 * members (or an admin session); anyone else just sees the plain form. */
async function resolveBusinessContext(businessId: string | undefined): Promise<{ id: string; name: string } | null> {
  if (!businessId) return null;
  try {
    await requireBusinessMember(businessId);
  } catch {
    return null;
  }
  const admin = getAdminSupabase();
  if (!admin) return null;
  const { data } = await admin.from("businesses").select("id, name").eq("id", businessId).maybeSingle();
  return (data as { id: string; name: string } | null) ?? null;
}
