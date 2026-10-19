import type { Metadata } from "next";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import LocationGeographyFields from "@/components/LocationGeographyFields";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireBusinessMember, requireLocationMember } from "@/lib/permissions";
import { isPageManagerRole } from "@/lib/capabilities";
import { isManagingRole } from "@/lib/business-locations";
import NavIcon from "@/components/NavIcon";
import SupabaseImage from "@/components/SupabaseImage";
import { createMemberLocation } from "../actions";
import GuestCreateSubmit from "@/components/account/GuestCreateSubmit";

export const metadata: Metadata = {
  title: "Add A Location",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-button font-bold uppercase text-white transition hover:bg-findmi-600";

/** Add A Location — Location Creation + Icon Consistency pass. Context is
 * resolved FIRST, same interaction principle as Create Event
 * (lib/capabilities.ts's eventCreationContext / the Event Page chooser):
 *
 *   unknown context  → ChooseLocationContext (this page, below): "I'm
 *                       Just Adding It To Findmi" or a managed Business.
 *   known context    → straight to the factual form, never re-asked:
 *                       ?business_id=  (a Business workspace's own Add
 *                       Location button, or the chooser's own Business
 *                       row) or ?parent_location_id= (a managed
 *                       Location's own "+ Add A Location Inside").
 *
 * Selecting a Business means "this Business is adding this Location" —
 * the existing business_locations relationship (linkBusinessLocation,
 * below) — never Location management/ownership. The old "Your Connection
 * To This Location" (I Manage / I'm Just Adding) question is gone from
 * this form entirely: this flow never requests management, so every
 * submission here carries intent="adding" (createMemberLocation's own
 * server-side intent validation is unchanged — it just never receives
 * "manage" from this UI any more). A genuine request to MANAGE an
 * existing Location stays exactly where it already lives: ClaimButton
 * (type="location") on that Location's own public/account page, once it
 * exists — this form was never the right place to fold that into, and
 * nothing about that existing claim infrastructure is touched here.
 *
 * Child-Location creation (?parent_location_id=) is NOT offered from the
 * unknown-context chooser — investigated this pass: it has always been a
 * KNOWN-context-only action (reachable solely from a managed Location's
 * own page), never from the generic global Create entry point, and
 * adding it to the chooser "for symmetry" would invent a product surface
 * nobody asked for. */
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
    postal_code?: string;
    business_id?: string;
    parent_location_id?: string;
    context?: string;
    resume?: string;
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
    postal_code: submittedPostalCode,
    business_id: businessIdParam,
    parent_location_id: parentIdParam,
    context: contextParam,
    resume,
  } = await searchParams;

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // /account V2 Pass 2 — Business context (Presence -> Locations -> Add
  // location). Honored only for an owner/manager of that Business; anyone
  // else falls through to the context chooser below. createMemberLocation
  // re-checks this server-side regardless. Both resolvers are already a
  // safe no-op (caught, returns null) without a signed-in session, so a
  // guest with ?business_id=/?parent_location_id= simply sees none below.
  const [business, parent] = await Promise.all([resolveBusinessContext(businessIdParam), resolveParentContext(parentIdParam)]);
  // Guest-First Creation pass — a signed-out visitor can't be shown
  // ChooseLocationContext (it lists the Businesses THEY manage, which
  // requires a user id), so one always skips straight to the plain
  // generic form below instead — identity is only required at actual
  // submit (createMemberLocation handles that, preserving every typed
  // field through the login round-trip, same as Business creation).
  const hasKnownContext = Boolean(business) || Boolean(parent) || contextParam === "generic" || !user;
  if (!hasKnownContext) return <ChooseLocationContext userId={user!.id} />;

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
          <p className="mt-2 flex items-center gap-1.5 text-label font-bold uppercase text-accent">
            Adding As
            {business.logo_url ? (
              <SupabaseImage src={business.logo_url} alt="" width={18} height={18} className="h-[18px] w-[18px] rounded border border-black/[0.06] bg-white object-contain" />
            ) : null}
            {business.name}
          </p>
          <h1 className="mt-1 font-display text-page-title font-bold text-primary sm:text-display">Add A Location</h1>
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
          <p className="text-label font-bold uppercase text-accent">Adding To Findmi</p>
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
        <form id="create-location-form" action={createMemberLocation} className="flex flex-col gap-4">
          {business && <input type="hidden" name="business_id" value={business.id} />}
          {parent && <input type="hidden" name="parent_location_id" value={parent.id} />}
          {/* Context was already resolved in Step 1 (or arrived already
              known) — this form never asks it again. Selecting a
              Business/adding generically never requests management;
              intent is always "adding" from here (createMemberLocation's
              own server-side validation of this field is unchanged). */}
          <input type="hidden" name="intent" value="adding" />
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

          <LocationGeographyFields defaultCity={submittedCity ?? ""} defaultState={submittedState ?? ""} defaultPostalCode={submittedPostalCode ?? ""} />

          <GuestCreateSubmit
            formId="create-location-form"
            label="Add Location"
            title="Your Location Is Ready"
            body="Create your free Findmi account to publish it, manage it and keep everything you've created."
            authed={Boolean(user)}
            resume={resume === "1"}
            className={`mt-2 ${primaryButtonClass}`}
          />
          <p className="text-center text-metadata text-subtle">Free — always.</p>
        </form>
      </div>
    </div>
  );
}

/** Unknown context — "How are you adding this Location?" The default,
 * always-available choice is generic (no Business relationship asserted
 * at all); then any Business the signed-in person actually manages
 * (Owner/Manager), each with its real logo and the same rounded-square +
 * initial-letter fallback identity treatment as the Event Page chooser —
 * never lifeless text-only rows. Neither choice grants Location
 * management; selecting a Business only establishes the Business ↔
 * Location relationship once the Location is created (see
 * linkBusinessLocation in ../actions.ts). */
async function ChooseLocationContext({ userId }: { userId: string }) {
  const supabase = await getServerSupabase();
  const { data: biz } = await supabase
    .from("business_members")
    .select("role, business:businesses(id, name, logo_url)")
    .eq("user_id", userId)
    .in("role", ["owner", "manager"]);
  type BizRow = { role: string; business: { id: string; name: string; logo_url: string | null } | { id: string; name: string; logo_url: string | null }[] | null };
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
  const businesses = ((biz ?? []) as BizRow[])
    .map((r) => one(r.business))
    .filter((b): b is { id: string; name: string; logo_url: string | null } => Boolean(b));

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="font-display text-page-title font-bold text-primary sm:text-display">Add A Location</h1>
      <p className="mt-2 text-body text-muted">How are you adding this Location?</p>

      <ul className="mt-6 flex flex-col gap-2">
        <li>
          <Link
            href="/account/location/new?context=generic"
            className="flex items-center gap-3 rounded-2xl border border-black/[0.08] bg-white px-4 py-3 transition hover:border-black/15"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-findmi-50 text-findmi-700">
              <NavIcon name="pin" className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold text-primary">I&rsquo;m Just Adding It To Findmi</span>
              <span className="block text-metadata text-muted">This place is missing from Findmi.</span>
            </span>
          </Link>
        </li>
      </ul>

      {businesses.length > 0 && (
        <>
          <p className="mt-6 text-label font-bold uppercase text-subtle">Add As A Business</p>
          <ul className="mt-2 flex flex-col gap-2">
            {businesses.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/account/location/new?business_id=${b.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-black/[0.08] bg-white px-4 py-3 transition hover:border-black/15"
                >
                  {b.logo_url ? (
                    <SupabaseImage
                      src={b.logo_url}
                      alt=""
                      width={44}
                      height={44}
                      className="h-11 w-11 shrink-0 rounded-xl border border-black/[0.06] bg-white object-contain p-1"
                    />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-findmi-50 font-display text-card-title font-bold text-findmi-700">
                      {b.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold text-primary">{b.name}</span>
                    <span className="block text-metadata text-subtle">Business</span>
                  </span>
                  <span className="shrink-0 text-metadata font-semibold text-accent">Add As Business</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

async function resolveBusinessContext(businessId: string | undefined): Promise<{ id: string; name: string; logo_url: string | null } | null> {
  if (!businessId) return null;
  try {
    if (!isManagingRole((await requireBusinessMember(businessId)).role)) return null;
  } catch {
    return null;
  }
  const admin = getAdminSupabase();
  if (!admin) return null;
  const { data } = await admin.from("businesses").select("id, name, logo_url").eq("id", businessId).maybeSingle();
  return (data as { id: string; name: string; logo_url: string | null } | null) ?? null;
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
