import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import BusinessCard from "@/components/BusinessCard";
import CompactCard from "@/components/CompactCard";
import { getServerSupabase } from "@/lib/supabase/server";
import { cityState, formatDateRange } from "@/lib/format";
import { PUBLIC_BUSINESS_COLUMNS } from "@/lib/data";
import type { BusinessWithCategories, FindmiEvent } from "@/lib/types";
import AccountNav from "../AccountNav";
import FollowingUnfollowButton from "./FollowingUnfollowButton";

export const metadata: Metadata = {
  title: "Following",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/** Account-backed Following — reads account_followed_businesses AND
 * account_followed_events (both RLS-scoped to auth.uid()), the same
 * tables the public Follow controls write to once a visitor is signed
 * in. Deliberately not the existing marketing `followers`/
 * `event_followers` tables (email-capture, no account) — those stay
 * completely separate, per this pass's own legacy-follow handling (see
 * the migration/report). Only the CURRENT user's own follows are ever
 * read here — no other user's list is reachable from this page or its
 * queries. */
export default async function AccountFollowingPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/following");

  const [{ data: followedBusinesses }, { data: followedEvents }] = await Promise.all([
    supabase
      .from("account_followed_businesses")
      .select(`business:businesses(${PUBLIC_BUSINESS_COLUMNS})`)
      .eq("user_id", user.id),
    supabase.from("account_followed_events").select("event:events(*)").eq("user_id", user.id),
  ]);

  const businesses = ((followedBusinesses ?? []) as unknown as { business: BusinessWithCategories | null }[])
    .map((row) => row.business)
    .filter((b): b is BusinessWithCategories => Boolean(b))
    .map((b) => ({ ...b, categories: [] }));

  const events = ((followedEvents ?? []) as unknown as { event: FindmiEvent | null }[])
    .map((row) => row.event)
    .filter((e): e is FindmiEvent => Boolean(e));

  const empty = businesses.length === 0 && events.length === 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Following</h1>
      <p className="mt-1.5 text-sm text-ink/50">Businesses and events you follow with your FindMi account.</p>

      {empty ? (
        <div className="mt-8 rounded-3xl border border-black/5 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-ink">Not following anyone yet</p>
          <p className="mt-1 text-sm text-ink/50">
            <Link href="/businesses" className="font-medium text-findmi-700 underline underline-offset-2">
              Browse businesses
            </Link>{" "}
            or{" "}
            <Link href="/events" className="font-medium text-findmi-700 underline underline-offset-2">
              events
            </Link>{" "}
            and follow the ones you want to hear from.
          </p>
        </div>
      ) : (
        <>
          {businesses.length > 0 && (
            <div className="mt-8">
              <h2 className="text-base font-semibold tracking-tight text-ink">Businesses</h2>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {businesses.map((b) => (
                  <div key={b.id} className="relative">
                    <FollowingUnfollowButton kind="business" slug={b.slug} />
                    <BusinessCard business={b} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {events.length > 0 && (
            <div className="mt-10">
              <h2 className="text-base font-semibold tracking-tight text-ink">Events</h2>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {events.map((e) => (
                  <div key={e.id} className="relative">
                    <FollowingUnfollowButton kind="event" slug={e.slug} />
                    <CompactCard
                      href={`/event/${e.slug}`}
                      image={e.cover_image_url}
                      title={e.name}
                      meta={[formatDateRange(e.start_at, e.end_at), cityState(e.city, e.state)]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
