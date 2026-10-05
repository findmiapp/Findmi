import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getHostEventEligibility } from "@/lib/entitlements";
import DateTimeRangeFields from "@/components/scheduling/DateTimeRangeFields";
import { getActiveMarkets } from "@/lib/data";
import EventGeographyFields from "@/components/EventGeographyFields";
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

/** Native Event creation entry point (Global + → Add An Event). Free
 * Event Creation: ANY signed-in Findmi member may create/submit an Event —
 * no Pro, Pro Invite, event_management entitlement or Business required.
 * New Events still start pending review (create_owned_event) and the
 * creator becomes their owner; management stays scoped per Event.
 * The only remaining gate here is HOSTING: with ?business_id (Business →
 * Findmi Here → Host Something) the caller must be an Owner/Manager of
 * that Business. createMemberEvent re-checks that server-side. */
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
  // Business-Hosted Events V1 — "+ Add → Host Something" opens this flow
  // with the originating Business as the Event's HOST. Hosting is scoped
  // to that Business alone — an owner/manager of it — and is not a Pro
  // feature. A staff member still sees the Business context (back link +
  // wording) with the reason they can't host; anyone who isn't a member at
  // all just sees the plain form, as before.
  const hostEligibility = businessIdParam && admin ? await getHostEventEligibility(admin, user.id, businessIdParam) : null;
  const businessContext =
    hostEligibility && (hostEligibility.ok || hostEligibility.reason !== "not_member") ? hostEligibility.business : null;
  // Free Event Creation — only hosting AS a Business is gated (Owner/
  // Manager of that Business); creating an Event as a member never is.
  const canHost = businessContext ? Boolean(hostEligibility?.ok) : true;
  const backToBusiness = businessContext ? (
    <Link
      href={`/account/business/${businessContext.id}?tab=findmi-here`}
      className="text-metadata font-semibold text-muted hover:text-primary"
    >
      &larr; {businessContext.name}
    </Link>
  ) : null;

  if (businessContext && !canHost) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-10">
        {backToBusiness}
        <h1 className="mt-1 font-display text-page-title font-bold text-primary sm:text-display">Host Something</h1>
        <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
          <p className="text-body font-semibold text-primary">Only an Owner or Manager of {businessContext.name} can host Events for it.</p>
          <Link href="/account/event/new" className={`mt-5 ${primaryButtonClass}`}>
            Add An Event Instead
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
        {businessContext ? "Host Something" : "Add An Event"}
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

          <DateTimeRangeFields
            startName="start_at"
            endName="end_at"
            defaultStart={submittedStartAt}
            defaultEnd={submittedEndAt}
            startLabel="Starts"
            endLabel="Ends"
            required
            inputClassName={inputClass}
            labelClassName="mb-1.5 block text-body font-medium text-primary"
          />

          <button type="submit" className={`mt-2 ${primaryButtonClass}`}>
            Create My Event
          </button>
          {!businessContext && <p className="text-center text-metadata text-subtle">Free for every Findmi member.</p>}
        </form>
      </div>
    </div>
  );
}
