import type { Metadata } from "next";
import Link from "next/link";
import { isPageManagerRole } from "@/lib/capabilities";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getHostEventEligibility } from "@/lib/entitlements";
import DateTimeRangeFields from "@/components/scheduling/DateTimeRangeFields";
import { getActiveMarkets } from "@/lib/data";
import EventGeographyFields from "@/components/EventGeographyFields";
import CategorySubcategoryField from "@/components/admin/CategorySubcategoryField";
import EventFormatField from "@/components/admin/EventFormatField";
import { getAllCategories } from "@/lib/admin/queries";
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

/** Native Event creation entry point. Identity capabilities (lib/
 * capabilities.ts): an Event is published THROUGH a Page — a Business the
 * caller hosts as (?business_id, Owner/Manager) or a Location they manage
 * (?location_id, Owner/Manager). Without one, this page lists the Pages
 * they can create from (or how to add one) instead of a Personal form.
 * createMemberEvent re-checks all of this server-side. No Pro required. */
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
    category_id?: string;
    format_ids?: string;
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
    category_id: submittedCategoryId,
    format_ids: submittedFormatIds,
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
  // A Location the caller manages (Owner/Manager) — the other eligible
  // publishing context.
  const managedLocation =
    !businessContext && locationHint
      ? await supabase
          .from("location_members")
          .select("role")
          .eq("user_id", user.id)
          .eq("location_id", locationHint.id)
          .maybeSingle()
          .then(({ data }) => (isPageManagerRole((data as { role: string } | null)?.role) ? locationHint : null))
      : null;
  if (!businessContext && !managedLocation) return <ChooseEventPage userId={user.id} />;
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
        <h1 className="mt-1 font-display text-page-title font-bold text-primary sm:text-display">Host an Event</h1>
        <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
          <p className="text-body font-semibold text-primary">Only an Owner or Manager of {businessContext.name} can host Events for it.</p>
          <Link href="/account/event/new" className={`mt-5 ${primaryButtonClass}`}>
            Choose Another Page
          </Link>
        </div>
      </div>
    );
  }

  const [markets, eventCategories, eventFormats] = await Promise.all([getActiveMarkets(), getAllCategories("event"), getAllCategories("event_format")]);

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-10">
      {backToBusiness ??
        (managedLocation ? (
          <Link href={`/account/location/${managedLocation.id}`} className="text-metadata font-semibold text-muted hover:text-primary">
            &larr; {managedLocation.name}
          </Link>
        ) : null)}
      <h1 className="mt-1 font-display text-page-title font-bold text-primary sm:text-display">
        {businessContext ? "Host an Event" : `Create An Event At ${managedLocation?.name ?? "Your Location"}`}
      </h1>
      <p className="mt-2 text-body text-muted">
        {businessContext
          ? "Create the activation, pop-up, tasting, class, launch or event you’re organizing. It’s public on Findmi right away — finish the details and dates in Event Manager."
          : "Create your event — it’s public on Findmi right away. Finish the details in Event Manager."}
      </p>

      {error && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-body text-red-700">{error}</p>}

      {/* Event Import V1 — import-first for a Business host (hosting
          context, same importer as Where I'll Be). Manual creation below is
          unchanged. */}
      {businessContext && (
        <div className="mt-6 rounded-3xl border border-findmi/20 bg-findmi-50/50 p-5 sm:p-6">
          <p className="text-card-title font-semibold text-primary">Already Have the Details?</p>
          <p className="mt-0.5 text-metadata text-muted">Use an event link, paste the details or upload a flyer, and Findmi fills them in. You review everything first.</p>
          <Link href={`/account/business/${businessContext.id}/import-event?intent=hosting`} className={`mt-3 ${primaryButtonClass}`}>
            Import Event
          </Link>
        </div>
      )}
      {businessContext && <p className="mt-6 text-label font-bold uppercase text-subtle">Or Create Manually</p>}

      <div className={`${businessContext ? "mt-2" : "mt-6"} rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6`}>
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
            <input autoCapitalize="words"
              type="text"
              name="name"
              required
              defaultValue={submittedName ?? ""}
              placeholder="Your event name"
              className={inputClass}
            />
          </label>

          <CategorySubcategoryField categories={eventCategories} defaultCategoryId={submittedCategoryId ?? null} emptyText="No Event categories yet." />
          <EventFormatField formats={eventFormats} defaultSelectedIds={(submittedFormatIds ?? "").split(",")} />

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

/** No eligible publishing context: the Pages this person can create an
 * Event from (Owner/Manager), or how to add one. Never a Personal form. */
async function ChooseEventPage({ userId }: { userId: string }) {
  const supabase = await getServerSupabase();
  const [{ data: biz }, { data: locs }] = await Promise.all([
    supabase.from("business_members").select("role, business:businesses(id, name)").eq("user_id", userId).in("role", ["owner", "manager"]),
    supabase.from("location_members").select("role, location:locations(id, name)").eq("user_id", userId).in("role", ["owner", "manager"]),
  ]);
  type Row<K extends string> = { role: string } & Record<K, { id: string; name: string } | { id: string; name: string }[] | null>;
  const pick = <K extends string>(rows: unknown, key: K) =>
    ((rows ?? []) as Row<K>[]).map((r) => (Array.isArray(r[key]) ? (r[key] as { id: string; name: string }[])[0] : r[key]) as { id: string; name: string } | null).filter((x): x is { id: string; name: string } => Boolean(x));
  const pages = [
    ...pick(biz, "business").map((b) => ({ key: `b:${b.id}`, name: b.name, kind: "Business", href: `/account/event/new?business_id=${b.id}` })),
    ...pick(locs, "location").map((l) => ({ key: `l:${l.id}`, name: l.name, kind: "Location", href: `/account/event/new?location_id=${l.id}` })),
  ];
  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="font-display text-page-title font-bold text-primary sm:text-display">Create An Event</h1>
      <p className="mt-2 text-body text-muted">Events are published by a Business or Location you manage. Choose where this Event comes from.</p>
      {pages.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-2">
          {pages.map((p) => (
            <li key={p.key}>
              <Link href={p.href} className="flex items-center justify-between gap-3 rounded-2xl border border-black/[0.08] bg-white px-4 py-3 transition hover:border-black/15">
                <span className="min-w-0">
                  <span className="block truncate text-body font-semibold text-primary">{p.name}</span>
                  <span className="block text-metadata text-subtle">{p.kind}</span>
                </span>
                <span className="shrink-0 text-metadata font-semibold text-accent">Create As {p.kind}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
          <p className="text-body font-semibold text-primary">You don&rsquo;t manage a Business or Location yet.</p>
          <p className="mt-1 text-body text-muted">Add or claim one first — then create Events as it.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Link href="/account/business/new" className={primaryButtonClass}>
              Add A Business
            </Link>
            <Link href="/account/location/new" className="flex h-12 w-full items-center justify-center rounded-2xl border border-black/10 text-button font-bold uppercase text-primary">
              Add A Location
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
