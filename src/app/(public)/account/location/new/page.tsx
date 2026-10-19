import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getActiveMarketsWithAreaOptions } from "@/lib/admin/market-areas";
import LocationGeographyFields from "@/components/LocationGeographyFields";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireBusinessMember, requireLocationMember } from "@/lib/permissions";
import { isPageManagerRole } from "@/lib/capabilities";
import { isManagingRole } from "@/lib/business-locations";
import { createMemberLocation } from "../actions";

export const metadata: Metadata = {
  title: "Add A Location",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-button font-bold uppercase text-white transition hover:bg-findmi-600";

/** Add A Location — open to anyone signed in (Personal, a Business via
 * ?business_id, or a managed Location adding a child via
 * ?parent_location_id). Free. The submitter says whether they manage it;
 * either way submitting never grants management (createMemberLocation). */
export default async function AddLocationPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    duplicate_slug?: string;
    duplicate_name?: string;
    name?: string;
    address?: string;
    city?: string;
    state?: string;
    market_id?: string;
    market_area_id?: string;
    requested_market_text?: string;
    business_id?: string;
    parent_location_id?: string;
    intent?: string;
  }>;
}) {
  const {
    error,
    duplicate_slug: duplicateSlug,
    duplicate_name: duplicateName,
    name: submittedName,
    address: submittedAddress,
    city: submittedCity,
    state: submittedState,
    market_id: submittedMarketId,
    market_area_id: submittedAreaId,
    requested_market_text: submittedRequestedMarketText,
    business_id: businessIdParam,
    parent_location_id: parentIdParam,
    intent: submittedIntent,
  } = await searchParams;

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const selfPath = businessIdParam ? `/account/location/new?business_id=${encodeURIComponent(businessIdParam)}` : "/account/location/new";
  if (!user) redirect(`/login?next=${encodeURIComponent(selfPath)}`);

  // /account V2 Pass 2 — Business context (Presence -> Locations -> Add
  // location). Honored only for an owner/manager of that Business; anyone
  // else just gets the ordinary standalone form. createMemberLocation
  // re-checks this server-side regardless.
  const [marketsWithAreas, business, parent] = await Promise.all([
    getActiveMarketsWithAreaOptions(),
    resolveBusinessContext(businessIdParam),
    resolveParentContext(parentIdParam),
  ]);
  const we = Boolean(business || parent);

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-10">
      {business ? (
        <>
          <Link
            href={`/account/business/${business.id}?tab=findmi-here&view=locations`}
            className="text-metadata font-semibold text-muted hover:text-primary"
          >
            &larr; {business.name}
          </Link>
          <h1 className="mt-2 font-display text-page-title font-bold text-primary sm:text-display">Add A Location</h1>
          <p className="mt-2 text-body text-muted">
            Add a place connected to {business.name} — your storefront, a retailer, a venue or somewhere you&rsquo;ll appear. It appears
            publicly once Findmi reviews it.
          </p>
        </>
      ) : parent ? (
        <>
          <Link href={`/account/location/${parent.id}`} className="text-metadata font-semibold text-muted hover:text-primary">
            &larr; {parent.name}
          </Link>
          <h1 className="mt-2 font-display text-page-title font-bold text-primary sm:text-display">Add A Location Inside {parent.name}</h1>
          <p className="mt-2 text-body text-muted">A building, hall, space or venue within {parent.name}. It appears publicly once Findmi reviews it.</p>
        </>
      ) : (
        <>
          <p className="text-label font-bold uppercase text-accent">Your Findmi</p>
          <h1 className="mt-1 font-display text-page-title font-bold text-primary sm:text-display">Add A Location</h1>
          <p className="mt-2 text-body text-muted">Add a place people can find on Findmi. It appears publicly once Findmi reviews it. Free.</p>
        </>
      )}

      {error && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-body text-red-700">
          <p>{error}</p>
          {duplicateSlug && (
            <Link href={`/location/${duplicateSlug}`} className="mt-1.5 inline-block font-semibold underline underline-offset-2">
              View {duplicateName ?? "this venue"} &rarr;
            </Link>
          )}
        </div>
      )}

      <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
        <form action={createMemberLocation} className="flex flex-col gap-4">
          {business && <input type="hidden" name="business_id" value={business.id} />}
          {parent && <input type="hidden" name="parent_location_id" value={parent.id} />}
          <label className="block">
            <span className="mb-1.5 block text-body font-medium text-primary">Location name</span>
            <input autoCapitalize="words"
              type="text"
              name="name"
              required
              defaultValue={submittedName ?? ""}
              placeholder="Location name"
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-body font-medium text-primary">Address</span>
            <input autoCapitalize="words" type="text" name="address" defaultValue={submittedAddress ?? ""} className={inputClass} />
          </label>

          {/* Geography Foundation Pass 2 — city/state now drive a live
              Findmi Market/Area suggestion instead of leaving the owner
              to separately solve Findmi's own taxonomy. See
              LocationGeographyFields' own doc comment. */}
          <LocationGeographyFields
            markets={marketsWithAreas}
            defaultCity={submittedCity ?? ""}
            defaultState={submittedState ?? ""}
            defaultMarketId={submittedMarketId ?? ""}
            defaultAreaId={submittedAreaId ?? ""}
            defaultRequestedMarketText={submittedRequestedMarketText ?? ""}
          />

          {/* Submission intent — management is a request Findmi reviews,
              never granted by adding a Location. */}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 block text-body font-medium text-primary">Your Connection To This Location</legend>
            <label className="flex items-start gap-2.5 rounded-xl border border-black/10 px-3.5 py-3">
              <input type="radio" name="intent" value="manage" required defaultChecked={submittedIntent === "manage"} className="mt-1 accent-findmi" />
              <span>
                <span className="block text-body font-semibold text-primary">{we ? "We Manage This Location" : "I Manage This Location"}</span>
                <span className="block text-metadata text-muted">
                  {we ? "We own, operate or are authorized to represent it." : "I own, operate, work for or am authorized to represent it."} Findmi reviews the request
                  before you can manage it.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 rounded-xl border border-black/10 px-3.5 py-3">
              <input type="radio" name="intent" value="adding" required defaultChecked={submittedIntent === "adding"} className="mt-1 accent-findmi" />
              <span>
                <span className="block text-body font-semibold text-primary">{we ? "We're Just Adding It To Findmi" : "I'm Just Adding It To Findmi"}</span>
                <span className="block text-metadata text-muted">It&rsquo;s missing from Findmi. No management is requested.</span>
              </span>
            </label>
          </fieldset>

          <button type="submit" className={`mt-2 ${primaryButtonClass}`}>
            Add Location
          </button>
          <p className="text-center text-metadata text-subtle">Free — always.</p>
        </form>
      </div>
    </div>
  );
}

async function resolveBusinessContext(businessId: string | undefined): Promise<{ id: string; name: string } | null> {
  if (!businessId) return null;
  try {
    if (!isManagingRole((await requireBusinessMember(businessId)).role)) return null;
  } catch {
    return null;
  }
  const admin = getAdminSupabase();
  if (!admin) return null;
  const { data } = await admin.from("businesses").select("id, name").eq("id", businessId).maybeSingle();
  return (data as { id: string; name: string } | null) ?? null;
}

/** A Location the caller manages (Owner/Manager) — the parent of a child
 * Location. Hierarchy is containment only; it never shares management. */
async function resolveParentContext(locationId: string | undefined): Promise<{ id: string; name: string } | null> {
  if (!locationId) return null;
  try {
    if (!isPageManagerRole((await requireLocationMember(locationId)).role)) return null;
  } catch {
    return null;
  }
  const admin = getAdminSupabase();
  if (!admin) return null;
  const { data } = await admin.from("locations").select("id, name").eq("id", locationId).maybeSingle();
  return (data as { id: string; name: string } | null) ?? null;
}
