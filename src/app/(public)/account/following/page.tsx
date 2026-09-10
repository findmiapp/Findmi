import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import BusinessCard from "@/components/BusinessCard";
import CompactCard from "@/components/CompactCard";
import LocationCard from "@/components/LocationCard";
import { getServerSupabase } from "@/lib/supabase/server";
import { cityState, formatDateRange } from "@/lib/format";
import { PUBLIC_BUSINESS_COLUMNS, type LocationWithCategory } from "@/lib/data";
import type { BusinessWithCategories, FindmiEvent } from "@/lib/types";
import AccountNav from "../AccountNav";
import FollowingUnfollowButton from "./FollowingUnfollowButton";

export const metadata: Metadata = {
  title: "Following",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/** Account-backed Following — reads account_followed_businesses,
 * account_followed_events AND account_followed_locations (all RLS-scoped
 * to auth.uid()), the same tables the public Follow controls write to
 * once a visitor is signed in. Deliberately not the existing marketing
 * `followers`/`event_followers`/`location_followers` tables (email-
 * capture, no account) — those stay completely separate, per this pass's
 * own legacy-follow handling (see the migration/report). Only the
 * CURRENT user's own follows are ever read here — no other user's list
 * is reachable from this page or its queries. */
export default async function AccountFollowingPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/following");

  const [{ data: followedBusinesses }, { data: followedEvents }, { data: followedLocations }] = await Promise.all([
    supabase
      .from("account_followed_businesses")
      .select(`business:businesses(${PUBLIC_BUSINESS_COLUMNS})`)
      .eq("user_id", user.id),
    supabase.from("account_followed_events").select("event:events(*)").eq("user_id", user.id),
    // Surface Followed Locations pass — same shape as the two follows
    // above; LocationCard (reused as-is from /locations, no second
    // Location-card design) additionally wants each location's own
    // category embed.
    supabase
      .from("account_followed_locations")
      .select("location:locations(*, category:categories(id, name, slug))")
      .eq("user_id", user.id),
  ]);

  const businesses = ((followedBusinesses ?? []) as unknown as { business: BusinessWithCategories | null }[])
    .map((row) => row.business)
    .filter((b): b is BusinessWithCategories => Boolean(b))
    .map((b) => ({ ...b, categories: [] }));

  const events = ((followedEvents ?? []) as unknown as { event: FindmiEvent | null }[])
    .map((row) => row.event)
    .filter((e): e is FindmiEvent => Boolean(e));

  const locations = ((followedLocations ?? []) as unknown as { location: LocationWithCategory | null }[])
    .map((row) => row.location)
    .filter((l): l is LocationWithCategory => Boolean(l));

  // Upcoming-activity count on each card — same single batched query
  // getLocations() already uses for the /locations directory (never one
  // query per card), scoped down to just this account's followed
  // Locations. Cheap and optional per the card's own design (only shown
  // when > 0 — see LocationCard).
  if (locations.length > 0) {
    const { data: occurrenceRows } = await supabase
      .from("event_occurrences")
      .select("location_id")
      .in(
        "location_id",
        locations.map((l) => l.id)
      )
      .eq("status", "scheduled")
      .gt("end_at", new Date().toISOString());
    const countByLocation = new Map<string, number>();
    for (const row of occurrenceRows ?? []) {
      if (!row.location_id) continue;
      countByLocation.set(row.location_id, (countByLocation.get(row.location_id) ?? 0) + 1);
    }
    for (const l of locations) l.upcomingCount = countByLocation.get(l.id) ?? 0;
  }

  const empty = businesses.length === 0 && events.length === 0 && locations.length === 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Following</h1>
      <p className="mt-1.5 text-sm text-ink/50">Businesses, events, and Locations you follow with your Findmi account.</p>

      {empty ? (
        <div className="mt-8 rounded-3xl border border-black/5 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-ink">Not following anyone yet</p>
          <p className="mt-1 text-sm text-ink/50">
            <Link href="/businesses" className="font-medium text-findmi-700 underline underline-offset-2">
              Browse businesses
            </Link>
            ,{" "}
            <Link href="/events" className="font-medium text-findmi-700 underline underline-offset-2">
              events
            </Link>
            , or{" "}
            <Link href="/locations" className="font-medium text-findmi-700 underline underline-offset-2">
              locations
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

          {locations.length > 0 && (
            <div className="mt-10">
              <h2 className="text-base font-semibold tracking-tight text-ink">Locations</h2>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {locations.map((l) => (
                  <div key={l.id} className="relative">
                    <FollowingUnfollowButton kind="location" slug={l.slug} />
                    <LocationCard location={l} />
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
