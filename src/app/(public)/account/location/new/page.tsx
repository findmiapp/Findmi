import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getActiveMarketsWithAreaOptions } from "@/lib/admin/market-areas";
import LocationGeographyFields from "@/components/LocationGeographyFields";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireBusinessMember } from "@/lib/permissions";
import { isManagingRole } from "@/lib/business-locations";
import { createMemberLocation } from "../actions";

export const metadata: Metadata = {
  title: "Add a Venue",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-button font-bold uppercase text-white transition hover:bg-findmi-600";

/** Multi-Entity Self-Service V1, Stage 3 — native Location (venue) creation
 * entry point. FREE for every signed-in user — no Business Pro, no Event
 * Management entitlement, no Location subscription (see this stage's
 * Locked LOCATION ACCESS/ENTITLEMENT rule) — so unlike /account/event/new
 * this page has no membership-required explainer branch, only the plain
 * sign-in gate every native creation flow needs. */
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
  const [marketsWithAreas, business] = await Promise.all([
    getActiveMarketsWithAreaOptions(),
    resolveBusinessContext(businessIdParam),
  ]);

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
          <h1 className="mt-2 font-display text-page-title font-bold text-primary sm:text-display">Add a location</h1>
          <p className="mt-2 text-body text-muted">
            Create a location for {business.name}. You&rsquo;ll manage it right away, and it will appear publicly once
            Findmi reviews it.
          </p>
        </>
      ) : (
        <>
          <p className="text-label font-bold uppercase text-accent">Your Findmi</p>
          <h1 className="mt-1 font-display text-page-title font-bold text-primary sm:text-display">Add a Venue</h1>
          <p className="mt-2 text-body text-muted">
            You&rsquo;ll own and manage it right away in your Location Manager, free, with no separate Venue fee, ever.
          </p>
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
          <label className="block">
            <span className="mb-1.5 block text-body font-medium text-primary">Venue name</span>
            <input
              type="text"
              name="name"
              required
              defaultValue={submittedName ?? ""}
              placeholder="Your venue name"
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-body font-medium text-primary">Address</span>
            <input type="text" name="address" defaultValue={submittedAddress ?? ""} className={inputClass} />
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

          <button type="submit" className={`mt-2 ${primaryButtonClass}`}>
            {business ? "Create location" : "Create My Venue"}
          </button>
          <p className="text-center text-metadata text-subtle">Free, no separate Venue fee, ever.</p>
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
