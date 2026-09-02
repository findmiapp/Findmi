import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import NavIcon from "@/components/NavIcon";
import type { Profile } from "@/lib/types";
import AccountSync from "./AccountSync";

export const metadata: Metadata = {
  title: "My FindMi",
  robots: { index: false },
};
// Authenticated, per-user content — must never be statically or
// ISR-cached; every response here is specific to whoever is signed in.
export const dynamic = "force-dynamic";

/** My FindMi home — the account section's own entry point/hub, so it
 * carries the nav cards itself rather than the AccountNav tab strip
 * every other /account/* page uses. */
export default async function AccountHomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Middleware already gates this route; same defense-in-depth re-check
  // every other authenticated /account page does.
  if (!user) redirect("/login?next=/account");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle<Pick<Profile, "display_name">>();

  // My FindMi — Manage Business entry point: the businesses this user is
  // a business_members row for (any role). RLS already scopes this
  // table's SELECT to auth.uid() = user_id, so this can only ever see the
  // caller's own memberships — no service-role needed just to list them.
  // One card per business, same AccountCard pattern as every other
  // section below; omitted entirely for a visitor with none, never a
  // placeholder/empty card.
  const { data: businessMemberships } = await supabase
    .from("business_members")
    .select("business_id, businesses(name, slug)")
    .eq("user_id", user.id);
  type BusinessMembershipRow = {
    business_id: string;
    businesses: { name: string; slug: string } | { name: string; slug: string }[] | null;
  };
  const myBusinesses = ((businessMemberships ?? []) as BusinessMembershipRow[])
    .map((m) => {
      const business = Array.isArray(m.businesses) ? m.businesses[0] : m.businesses;
      return business ? { id: m.business_id, name: business.name } : null;
    })
    .filter((b): b is { id: string; name: string } => Boolean(b));

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountSync />
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">My FindMi</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">
        Welcome back{profile?.display_name ? `, ${profile.display_name}` : ""}
      </h1>
      <p className="mt-2 text-sm text-ink/60">
        Keep track of what you discover — the businesses, events, and products you save and follow.
      </p>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-7 grid grid-cols-2 gap-3">
        <AccountCard
          href="/account/saved"
          label="Saved"
          description="Businesses, events & products you've bookmarked"
          icon={<NavIcon name="bookmark" className="h-5 w-5" />}
        />
        <AccountCard
          href="/account/following"
          label="Following"
          description="Businesses you follow"
          icon={<HeartGlyph />}
        />
        <AccountCard
          href="/account/orders"
          label="Orders"
          description="Your FindMi purchases"
          icon={<NavIcon name="cart" className="h-5 w-5" />}
        />
        <AccountCard
          href="/account/profile"
          label="Profile"
          description="Name, email & sign out"
          icon={<NavIcon name="person" className="h-5 w-5" />}
        />
        {myBusinesses.map((b) => (
          <AccountCard
            key={b.id}
            href={`/account/business/${b.id}`}
            label={b.name}
            description="Manage this business"
            icon={<NavIcon name="storefront" className="h-5 w-5" />}
          />
        ))}
      </div>
    </div>
  );
}

function AccountCard({
  href,
  label,
  description,
  icon,
}: {
  href: string;
  label: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-3 rounded-3xl border border-black/5 bg-white p-4 shadow-sm transition hover:border-black/10 sm:p-5"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">
        {icon}
      </div>
      <div>
        <p className="text-sm font-bold text-ink">{label}</p>
        <p className="mt-0.5 text-xs leading-snug text-ink/50">{description}</p>
      </div>
    </Link>
  );
}

// NavIcon's curated set (bookmark/cart/person, reused above) doesn't
// include a heart — that set is tied to the founder's admin-configurable
// nav_items icon picker (lib/navigation.ts's NavIconKey), which "Following"
// isn't part of. Same 24x24/stroke-1.8 style as NavIcon rather than a new
// icon language.
function HeartGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path
        d="M12 20.5s-7.5-4.6-7.5-9.8A4.35 4.35 0 0112 7.5a4.35 4.35 0 017.5 3.2c0 5.2-7.5 9.8-7.5 9.8z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
