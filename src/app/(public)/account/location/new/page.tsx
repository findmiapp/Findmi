import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getActiveMarketsWithAreaOptions } from "@/lib/admin/market-areas";
import LocationGeographyFields from "@/components/LocationGeographyFields";
import { createMemberLocation } from "../actions";

export const metadata: Metadata = {
  title: "Add a Venue",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";

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
  } = await searchParams;

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/account/location/new")}`);

  const marketsWithAreas = await getActiveMarketsWithAreaOptions();

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-10">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Your Findmi</p>
      <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Add a Venue</h1>
      <p className="mt-2 text-sm text-ink/60">
        You&rsquo;ll own and manage it right away in your Location Manager, free — no separate Venue fee, ever.
      </p>

      {error && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Venue name</span>
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
            <span className="mb-1.5 block text-sm font-medium text-ink">Address</span>
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
            Create My Venue
          </button>
          <p className="text-center text-xs text-ink/40">Free — no separate Venue fee, ever.</p>
        </form>
      </div>
    </div>
  );
}
