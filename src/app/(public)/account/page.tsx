import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import NavIcon from "@/components/NavIcon";
import { goToRedeemCode } from "@/app/(public)/redeem/actions";
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
  searchParams: Promise<{ error?: string; event_management?: string }>;
}) {
  const { error, event_management: eventManagementGranted } = await searchParams;

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
    .select("business_id, businesses(name, slug, publication_status)")
    .eq("user_id", user.id);
  type BusinessMembershipRow = {
    business_id: string;
    businesses:
      | { name: string; slug: string; publication_status: string }
      | { name: string; slug: string; publication_status: string }[]
      | null;
  };
  // slug was already part of this same query above — just also carried
  // through the mapping now (previously dropped) so the redesigned card
  // below can link to the public profile; no new query, no new data.
  // publication_status added (Native Business Onboarding Pass 2) so a
  // newly created/claimed business still awaiting approval can show
  // "Pending Review" here instead of reading identically to a live one —
  // publication_status is on the same public column grant every other
  // anon/authenticated business read already uses (unlike plan_tier),
  // so this needs no service-role elevation.
  const myBusinesses = ((businessMemberships ?? []) as BusinessMembershipRow[])
    .map((m) => {
      const business = Array.isArray(m.businesses) ? m.businesses[0] : m.businesses;
      return business
        ? { id: m.business_id, name: business.name, slug: business.slug, pendingReview: business.publication_status === "pending_review" }
        : null;
    })
    .filter((b): b is { id: string; name: string; slug: string; pendingReview: boolean } => Boolean(b));

  // Pending BUSINESS claims this user submitted — same RLS-scoped
  // (auth.uid() = user_id) select_own policy business_members already
  // relies on above, just against business_claim_requests. Event claims
  // are intentionally not queried/shown here.
  const { data: pendingClaimRows } = await supabase
    .from("business_claim_requests")
    .select("id, business_id, businesses(name, slug)")
    .eq("user_id", user.id)
    .eq("status", "pending");
  type PendingClaimRow = {
    id: string;
    business_id: string;
    businesses: { name: string; slug: string } | { name: string; slug: string }[] | null;
  };
  const myPendingClaims = ((pendingClaimRows ?? []) as PendingClaimRow[])
    .map((c) => {
      const business = Array.isArray(c.businesses) ? c.businesses[0] : c.businesses;
      return business ? { id: c.id, name: business.name, slug: business.slug } : null;
    })
    .filter((c): c is { id: string; name: string; slug: string } => Boolean(c));

  // Multi-Entity Self-Service V1, Stage 2 — Account Hub: "Events You
  // Manage" reads real event_members rows (the same table a
  // founder-approved Event claim, or now native Event creation, already
  // populates — see lib/permissions.ts's requireEventMember). RLS already
  // scopes this table's SELECT to auth.uid() = user_id, same as
  // business_members above. Every event this user manages is shown
  // (including one still pending review — is_demo:true) since Event
  // Manager now exists to actually manage it; each row links there
  // (/account/event/[id]), never to the public page, which 404s for a
  // pending event anyway (getEventBySlug filters is_demo).
  const { data: eventMemberships } = await supabase
    .from("event_members")
    .select("event_id, events(name, is_demo)")
    .eq("user_id", user.id);
  type EventMembershipRow = {
    event_id: string;
    events: { name: string; is_demo: boolean } | { name: string; is_demo: boolean }[] | null;
  };
  const myEvents = ((eventMemberships ?? []) as EventMembershipRow[])
    .map((m) => {
      const event = Array.isArray(m.events) ? m.events[0] : m.events;
      return event ? { id: m.event_id, name: event.name, isDemo: event.is_demo } : null;
    })
    .filter((e): e is { id: string; name: string; isDemo: boolean } => Boolean(e));

  // Multi-Entity Self-Service V1, Stage 3 — Account Hub: "Places You
  // Manage" now reads real location_members rows, same shape as
  // "Events You Manage" above (event_members). RLS already scopes this
  // table's SELECT to auth.uid() = user_id. Every location this user
  // manages is shown (including one still pending review — is_demo:true)
  // since Location Manager now exists to actually manage it; each row
  // links there (/account/location/[id]).
  const { data: locationMemberships } = await supabase
    .from("location_members")
    .select("location_id, locations(name, is_demo)")
    .eq("user_id", user.id);
  type LocationMembershipRow = {
    location_id: string;
    locations: { name: string; is_demo: boolean } | { name: string; is_demo: boolean }[] | null;
  };
  const myLocations = ((locationMemberships ?? []) as LocationMembershipRow[])
    .map((m) => {
      const location = Array.isArray(m.locations) ? m.locations[0] : m.locations;
      return location ? { id: m.location_id, name: location.name, isDemo: location.is_demo } : null;
    })
    .filter((l): l is { id: string; name: string; isDemo: boolean } => Boolean(l));

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountSync />

      {/* 1. Header — Stage 4 mobile polish: the standalone hero Sign Out
          link was redundant with Quick Access's own Profile card ("Name,
          email & sign out" below, which links to a working Sign Out on
          /account/profile) and is removed here; sign-out access is
          preserved, just no longer duplicated in two places on this one
          page. */}
      <header>
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Your FindMi</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">
          Welcome back{profile?.display_name ? `, ${profile.display_name}` : ""}
        </h1>
        <p className="mt-2 text-sm text-ink/60">
          Manage the businesses, events, and places you run on FindMi — and keep track of what you discover — all
          from one account.
        </p>
      </header>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {/* Multi-Entity Self-Service V1, Stage 2B — redeemProInvite redirects
          straight here (no separate business-scoped success screen, since
          no Business was ever touched) after an Event Management invite
          redemption. */}
      {eventManagementGranted === "1" && !error && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Event Management access activated — you can now add an Event below.
        </p>
      )}

      {/* 2. Quick Access */}
      <section className="mt-8">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Quick Access</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
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
        </div>
      </section>

      {/* 3. My Businesses — separate section, own compact card shape (name
          + Manage Business + View Public Profile). Native Business
          Onboarding Pass 2: always renders now (not gated on having any
          businesses yet), so the "+ Add a Business" CTA stays available
          either way — an account can own/manage more than one business.
          Pending-review businesses show a small status line instead of a
          plan badge (still no plan_tier query here — out of scope, same
          as before). */}
      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Businesses &amp; Brands</h2>
          <Link
            href="/account/business/new"
            className="rounded-full bg-findmi px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            + Add Business
          </Link>
        </div>

        {myBusinesses.length === 0 ? (
          <p className="mt-3 text-sm text-ink/50">
            Can&rsquo;t find your business on FindMi?{" "}
            <Link href="/account/business/new" className="font-semibold text-ink underline underline-offset-2">
              Add it
            </Link>{" "}
            — it&rsquo;s free.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {myBusinesses.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white px-3.5 py-2.5 shadow-sm"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">
                  <NavIcon name="storefront" className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink">{b.name}</p>
                  {b.pendingReview && <PendingBadge />}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Link
                    href={`/account/business/${b.id}`}
                    className="rounded-full bg-findmi px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                  >
                    Manage
                  </Link>
                  {b.slug && (
                    <Link
                      href={`/business/${b.slug}`}
                      className="text-[10px] font-semibold text-ink/40 underline underline-offset-2 hover:text-ink/60"
                    >
                      {b.pendingReview ? "Preview" : "View Profile"}
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Multi-Entity Self-Service V1, Stage 2 — Events You Manage. Real
          data only (event_members), never fabricated placeholder rows.
          Event Manager now exists (/account/event/[id]), so each row
          links there directly rather than to the public page — and
          "+ Add an Event" is a real, live link to native Event creation
          (/account/event/new), which itself shows the membership-required
          explainer for a non-qualifying user rather than a broken page. */}
      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Events You Manage</h2>
          <Link
            href="/account/event/new"
            className="rounded-full bg-findmi px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            + Add Event
          </Link>
        </div>

        {myEvents.length === 0 ? (
          <p className="mt-3 text-sm text-ink/50">You don&rsquo;t manage any events yet.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {myEvents.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white px-3.5 py-2.5 shadow-sm"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">
                  <NavIcon name="calendar" className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink">{e.name}</p>
                  {e.isDemo && <PendingBadge />}
                </div>
                <Link
                  href={`/account/event/${e.id}`}
                  className="shrink-0 rounded-full bg-findmi px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                >
                  Manage
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Multi-Entity Self-Service V1, Stage 3, renamed in the Account Hub
          Mobile Polish pass ("Places" -> "Venues" — owner-facing only;
          internal Location terminology is unchanged). Real data only
          (location_members), never fabricated placeholder rows. Location
          Manager now exists (/account/location/[id]), so each row links
          there directly, and "+ Add Venue" is a real, live link to native
          Location creation (/account/location/new) — free for every
          signed-in user, no entitlement gate. */}
      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Venues You Manage</h2>
          <Link
            href="/account/location/new"
            className="rounded-full bg-findmi px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            + Add Venue
          </Link>
        </div>

        {myLocations.length === 0 ? (
          <p className="mt-3 text-sm text-ink/50">You don&rsquo;t manage any venues yet.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {myLocations.map((l) => (
              <div
                key={l.id}
                className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white px-3.5 py-2.5 shadow-sm"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">
                  <NavIcon name="pin" className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink">{l.name}</p>
                  {l.isDemo && <PendingBadge />}
                </div>
                <Link
                  href={`/account/location/${l.id}`}
                  className="shrink-0 rounded-full bg-findmi px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                >
                  Manage
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Account Hub Mobile Polish pass — replaces the previously
          permanent, dashboard-sized invite form (ProInviteCodeEntry,
          still used unchanged elsewhere — Business Manager's Plan tab,
          /join) with a small, subtle disclosure here. Renamed from
          "Pro Invite Code" because an invite can grant Business Pro OR
          Event Management access, not Pro specifically. Submits through
          the exact same goToRedeemCode action (normalizes the code and
          redirects to /redeem/[code], the only place any invite is ever
          looked up or redeemed) — no backend/grant/redemption behavior
          changed, only how prominently it's presented on this one page. */}
      <section className="mt-8">
        <details className="group">
          <summary className="w-fit cursor-pointer text-xs font-semibold text-ink/45 underline underline-offset-2 transition hover:text-ink/70 [&::-webkit-details-marker]:hidden">
            Redeem invite code
          </summary>
          <form action={goToRedeemCode} className="mt-2 flex max-w-sm flex-col gap-2 sm:flex-row">
            <input type="hidden" name="return_to" value="/account" />
            <input
              type="text"
              name="code"
              required
              placeholder="Enter code"
              className="w-full min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
            />
            <button
              type="submit"
              className="shrink-0 rounded-full border border-black/15 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-ink transition hover:border-black/30"
            >
              Apply
            </button>
          </form>
        </details>
      </section>

      {/* 4. Pending Claims — separate section, same status copy/actions as
          before, just moved out of the shared grid. A soft aqua tint
          (not red/yellow) distinguishes the pending state without
          reading as an alarm/error condition. */}
      {myPendingClaims.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Pending Claims</h2>
          <div className="mt-3 flex flex-col gap-3">
            {myPendingClaims.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-3 rounded-3xl border border-findmi/20 bg-findmi-50/50 p-4 shadow-sm sm:p-5"
              >
                <Link href={`/business/${c.slug}`} className="flex flex-col gap-1">
                  <p className="text-sm font-bold text-ink">{c.name}</p>
                  <p className="text-xs font-semibold text-findmi-700">Claim under review</p>
                  <p className="text-xs text-ink/50">Typically reviewed within 48–72 hours.</p>
                </Link>
                {/* Pro Upgrade — Internal Checkout Handoff Foundation pass:
                    this claimant doesn't own this business yet (the claim
                    is still pending founder approval), so this can never
                    route through the owner-only /upgrade/pro handoff —
                    that would let a payment imply/expedite ownership. /join
                    is the general acquisition entry point, not tied to any
                    specific business_members row. */}
                <Link
                  href="/join"
                  className="flex h-9 w-fit items-center justify-center rounded-full bg-findmi px-4 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                >
                  Upgrade to Pro
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Account Hub Mobile Polish pass — replaces the long "Pending Review —
 * visible only to you until FindMi approves it." sentence with a small
 * status pill (+ optional muted secondary copy) shared by Business/Event/
 * Location cards alike. Moderation logic itself is untouched — this only
 * changes how an already-known is_demo/publication_status="pending_review"
 * condition is rendered. */
function PendingBadge() {
  return (
    <div className="mt-0.5 flex items-center gap-1.5">
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800">
        Pending Review
      </span>
      <span className="text-[10px] text-ink/40">Not public yet.</span>
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
