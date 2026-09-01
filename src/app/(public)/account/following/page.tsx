import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import BusinessCard from "@/components/BusinessCard";
import { getServerSupabase } from "@/lib/supabase/server";
import { PUBLIC_BUSINESS_COLUMNS } from "@/lib/data";
import type { BusinessWithCategories } from "@/lib/types";
import AccountNav from "../AccountNav";

export const metadata: Metadata = {
  title: "Following",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/** Account-backed Following — reads account_followed_businesses (RLS-
 * scoped to auth.uid()), the same table the public FollowButton writes to
 * once a visitor is signed in (skipping its email-capture step, since an
 * authenticated account already carries an identity). Deliberately not
 * the existing marketing `followers` table (email-capture, no account) —
 * see that migration's notes for why the two stay separate. The
 * personalized feed/upcoming-appearances view is a later enhancement,
 * not part of this pass — this is the plain followed-businesses list. */
export default async function AccountFollowingPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/following");

  const { data } = await supabase
    .from("account_followed_businesses")
    .select(`business:businesses(${PUBLIC_BUSINESS_COLUMNS})`)
    .eq("user_id", user.id);

  const businesses = ((data ?? []) as unknown as { business: BusinessWithCategories | null }[])
    .map((row) => row.business)
    .filter((b): b is BusinessWithCategories => Boolean(b))
    .map((b) => ({ ...b, categories: [] }));

  const empty = businesses.length === 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Following</h1>
      <p className="mt-1.5 text-sm text-ink/50">Businesses you follow with your FindMi account.</p>

      {empty ? (
        <div className="mt-8 rounded-3xl border border-black/5 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-ink">Not following anyone yet</p>
          <p className="mt-1 text-sm text-ink/50">
            <Link href="/businesses" className="font-medium text-findmi-700 underline underline-offset-2">
              Browse businesses
            </Link>{" "}
            and follow the ones you want to hear from.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {businesses.map((b) => (
            <BusinessCard key={b.id} business={b} />
          ))}
        </div>
      )}
    </div>
  );
}
