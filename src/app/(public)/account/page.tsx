import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { canCurrentUserManageEvents } from "@/lib/entitlements";
import NavIcon from "@/components/NavIcon";
import { goToRedeemCode } from "@/app/(public)/redeem/actions";
import type { Profile } from "@/lib/types";
import AccountSync from "./AccountSync";

export const metadata: Metadata = {
  title: "My Findmi",
  robots: { index: false },
};
// Authenticated, per-user content — must never be statically or
// ISR-cached; every response here is specific to whoever is signed in.
export const dynamic = "force-dynamic";

/** Account Hub V2 Hierarchy pass — plan_tier isn't in the public anon/
 * authenticated column grant (see lib/entitlements.ts's own comment on
 * canCurrentUserManageEvents), so showing a "Pro" pill on a managed
 * business here needs the service-role client, same as that function.
 * Read-only, display-only — never a write. */
async function getProBusinessIdSet(
  admin: ReturnType<typeof getAdminSupabase>,
  businessIds: string[]
): Promise<Set<string>> {
  if (!admin || businessIds.length === 0) return new Set();
  const { data } = await admin.from("businesses").select("id, plan_tier").in("id", businessIds);
  return new Set((data ?? []).filter((r) => r.plan_tier === "pro" || r.plan_tier === "pro_seller").map((r) => r.id));
}

/** Account Hub V2 Hierarchy + Action UX pass — the same account model,
 * the same tables, the same routes as before. What changed is emphasis:
 * discovery first, then whatever the visitor actively manages (rendered
 * as compact action rows, not giant cards), then personal activity as
 * small utility tiles, then account-utility odds and ends (invite
 * redemption, pending claims) at the bottom. No new backend/queries
 * beyond a few cheap additive reads (head-counts for the utility tiles,
 * plan_tier + Event Management entitlement for display/action gating) —
 * every one of those already had an authoritative source elsewhere in
 * the app (business/[id], event/new); this page just also reads it now. */
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

  const [
    { data: profile },
    { data: businessMemberships },
    { data: pendingClaimRows },
    { data: eventMemberships },
    { data: locationMemberships },
    { count: savedBusinessesCount },
    { count: savedEventsCount },
    { count: savedProductsCount },
    { count: followingBusinessesCount },
    { count: followingEventsCount },
    { count: ordersCount },
  ] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle<Pick<Profile, "display_name">>(),
    supabase.from("business_members").select("business_id, businesses(name, slug, publication_status)").eq("user_id", user.id),
    supabase
      .from("business_claim_requests")
      .select("id, business_id, businesses(name, slug)")
      .eq("user_id", user.id)
      .eq("status", "pending"),
    supabase.from("event_members").select("event_id, events(name, is_demo)").eq("user_id", user.id),
    supabase.from("location_members").select("location_id, locations(name, is_demo)").eq("user_id", user.id),
    // Your Activity tile counts — same account-backed tables
    // /account/saved, /account/following, /account/orders already read
    // (account_saved_*/account_followed_*/orders, all RLS-scoped to
    // auth.uid()); head-only counts here, no row payloads.
    supabase.from("account_saved_businesses").select("business_id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("account_saved_events").select("event_id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("account_saved_products").select("product_id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("account_followed_businesses").select("business_id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("account_followed_events").select("event_id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("user_id", user.id),
  ]);

  type BusinessMembershipRow = {
    business_id: string;
    businesses:
      | { name: string; slug: string; publication_status: string }
      | { name: string; slug: string; publication_status: string }[]
      | null;
  };
  const myBusinesses = ((businessMemberships ?? []) as BusinessMembershipRow[])
    .map((m) => {
      const business = Array.isArray(m.businesses) ? m.businesses[0] : m.businesses;
      return business
        ? { id: m.business_id, name: business.name, slug: business.slug, pendingReview: business.publication_status === "pending_review" }
        : null;
    })
    .filter((b): b is { id: string; name: string; slug: string; pendingReview: boolean } => Boolean(b));

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

  // plan_tier and the Event Management entitlement both require the
  // service-role client (neither is in the public anon/authenticated
  // column grant/RLS — see lib/entitlements.ts's own comments); same
  // authorize-then-elevate shape every other admin-client read in this
  // codebase uses, with the caller's own already-verified user.id as the
  // only input. Read-only, display/gating only — never a write.
  const admin = getAdminSupabase();
  const businessIds = myBusinesses.map((b) => b.id);
  const [proBusinessIds, canManageEvents] = await Promise.all([
    getProBusinessIdSet(admin, businessIds),
    admin ? canCurrentUserManageEvents(admin, user.id) : Promise.resolve(false),
  ]);

  const hasAnyManaged = myBusinesses.length > 0 || myEvents.length > 0 || myLocations.length > 0;
  const savedCount = (savedBusinessesCount ?? 0) + (savedEventsCount ?? 0) + (savedProductsCount ?? 0);
  const followingCount = (followingBusinessesCount ?? 0) + (followingEventsCount ?? 0);
  // Business Quick Actions — a launchpad, not a second Business Manager:
  // scoped to the account's first/primary business only (matching every
  // owner's real-world case, since most manage exactly one) rather than
  // repeating the same three shortcuts once per business.
  const primaryBusiness = myBusinesses[0];

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountSync />

      <header>
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Your Findmi</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">
          Welcome back{profile?.display_name ? `, ${profile.display_name}` : ""}
        </h1>
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

      {/* Signup + Email Confirmation UX Correction pass, Section 6 —
          ACCOUNT CREATED vs. EMAIL VERIFIED, kept deliberately separate.
          Reads only the already-fetched session user (no extra query) —
          Supabase's own `email_confirmed_at` is the one source of truth
          for whether this specific address was actually confirmed, never
          re-derived from anything else. Under this project's current
          Supabase configuration, an unconfirmed user has no session at
          all yet (see this pass's report), so this can't render today —
          it's here so the moment that changes, a signed-in-but-unverified
          visitor gets this instead of nothing, with zero further code
          change. Deliberately non-blocking: no gate, no redirect, just a
          reminder — verification stays required for whatever
          security-sensitive actions already require it elsewhere. */}
      {!user.email_confirmed_at && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Verify your email to keep your account secure.
        </p>
      )}

      {/* 1. DISCOVERY — Account Hub V2 pass. The first thing any account
          holder sees, regardless of whether they manage anything: Findmi
          is for discovering what's around them. /find is the existing
          time+place discovery surface (now/today/weekend/anytime, city/
          category filters) — the closest existing route to "explore near
          you"; no geolocation added, no new route invented. */}
      <section className="mt-5 rounded-3xl border border-black/5 bg-white p-4 shadow-sm sm:p-5">
        <p className="text-sm font-bold text-ink">Discover what&rsquo;s happening around you.</p>
        <Link
          href="/find"
          className="mt-3 flex h-11 items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Explore near you
        </Link>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Link
            href="/events"
            className="rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:border-black/20 hover:text-ink"
          >
            Events
          </Link>
          <Link
            href="/businesses"
            className="rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:border-black/20 hover:text-ink"
          >
            Businesses
          </Link>
          <Link
            href="/locations"
            className="rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:border-black/20 hover:text-ink"
          >
            Venues
          </Link>
        </div>
      </section>

      {/* 2. MANAGE ON FINDMI — Account Hub V2 pass. Only renders (and only
          the sub-groups that apply) when the visitor actually manages
          something; otherwise the compact acquisition block below runs
          instead. Every row is action-oriented (name, status/plan using
          existing data only, ONE primary CTA) instead of a giant card. */}
      {hasAnyManaged ? (
        <section className="mt-6">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Manage on Findmi</h2>
          <div className="mt-2 flex flex-col gap-2">
            {myBusinesses.map((b) => (
              <EntityRow
                key={b.id}
                icon={<NavIcon name="storefront" className="h-4 w-4" />}
                name={b.name}
                pills={[
                  b.pendingReview ? { label: "Pending Review", tone: "warning" as const } : null,
                  proBusinessIds.has(b.id) ? { label: "Pro", tone: "pro" as const } : null,
                ]}
                href={`/account/business/${b.id}`}
                cta={b.pendingReview ? "Finish Your Business" : "Manage"}
              />
            ))}
            {myEvents.map((e) => (
              <EntityRow
                key={e.id}
                icon={<NavIcon name="calendar" className="h-4 w-4" />}
                name={e.name}
                pills={[e.isDemo ? { label: "In Review", tone: "warning" as const } : null]}
                href={`/account/event/${e.id}`}
                cta={e.isDemo ? "Finish Your Event" : "Manage"}
              />
            ))}
            {myLocations.map((l) => (
              <EntityRow
                key={l.id}
                icon={<NavIcon name="pin" className="h-4 w-4" />}
                name={l.name}
                pills={[l.isDemo ? { label: "Pending Review", tone: "warning" as const } : null]}
                href={`/account/location/${l.id}`}
                cta="Manage Venue"
              />
            ))}
          </div>

          {/* Quick Actions — Section 6/7's launchpad. Every link is a real
              existing route; Pro-only tabs are linked exactly the way
              Business Manager's own Quick Actions card already links them
              (the tab itself shows the existing upgrade lock for a Free
              business — never duplicated or re-decided here) — so gating
              stays authoritative in exactly one place. Add Event only
              appears when the visitor actually qualifies (owns a
              qualifying business already, or already manages an event) or
              already has the standalone Event Management entitlement —
              otherwise it's omitted rather than bouncing a non-qualifying
              visitor to an explainer from what reads as a sure thing. */}
          <div className="mt-3 flex flex-wrap gap-2">
            {primaryBusiness && (
              <>
                <QuickActionLink href={`/account/business/${primaryBusiness.id}?tab=findmi-here`}>
                  + Add Where You&rsquo;ll Be
                </QuickActionLink>
                <QuickActionLink href={`/account/business/${primaryBusiness.id}?tab=products`}>+ Add Product</QuickActionLink>
                {primaryBusiness.slug && (
                  <QuickActionLink href={`/business/${primaryBusiness.slug}`}>
                    {primaryBusiness.pendingReview ? "Preview Profile" : "View Profile"}
                  </QuickActionLink>
                )}
              </>
            )}
            {(myEvents.length > 0 || canManageEvents) && <QuickActionLink href="/account/event/new">+ Add Event</QuickActionLink>}
            <QuickActionLink href="/account/location/new">+ Add Venue</QuickActionLink>
            <QuickActionLink href="/account/business/new">+ Add Business</QuickActionLink>
          </div>
        </section>
      ) : (
        /* Zero-Managed-Entity acquisition block — Section 8. One compact
           block, never three empty management sections. Add Event only
           offered when the visitor already qualifies (Business Pro
           membership or a standalone Event Management grant) — Add
           Business and Add Venue are free for every signed-in account, so
           always offered. */
        <section className="mt-6 rounded-3xl border border-black/10 bg-mist/30 p-4 sm:p-5">
          <p className="text-sm font-bold text-ink">Have something people should discover?</p>
          <p className="mt-1 text-xs text-ink/60">List your business, event, or venue on Findmi.</p>
          <Link
            href="/join"
            className="mt-3 flex h-11 items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Get discovered
          </Link>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <QuickActionLink href="/account/business/new">Add Business</QuickActionLink>
            {canManageEvents && <QuickActionLink href="/account/event/new">Add Event</QuickActionLink>}
            <QuickActionLink href="/account/location/new">Add Venue</QuickActionLink>
          </div>
        </section>
      )}

      {/* Pending Claims — kept compact, own section, right after
          management/acquisition since a claim in progress is on its way
          to becoming a managed entity. Unchanged copy/behavior. */}
      {myPendingClaims.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Pending Claims</h2>
          <div className="mt-2 flex flex-col gap-3">
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

      {/* 3. YOUR ACTIVITY — Account Hub V2 pass. Saved/Following/Orders
          shrink to one compact grid row with real counts (already
          account-backed data, same tables /account/saved,following,orders
          themselves read); Profile joins them here as the 4th utility
          tile rather than a large standalone card, and remains the way
          into sign-out (via /account/profile, unchanged). */}
      <section className="mt-8">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Your Activity</h2>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <UtilityCard href="/account/saved" label="Saved" count={savedCount} icon={<NavIcon name="bookmark" className="h-4 w-4" />} />
          <UtilityCard href="/account/following" label="Following" count={followingCount} icon={<HeartGlyph />} />
          <UtilityCard href="/account/orders" label="Orders" count={ordersCount ?? 0} icon={<NavIcon name="cart" className="h-4 w-4" />} />
          <UtilityCard href="/account/profile" label="Profile" icon={<NavIcon name="person" className="h-4 w-4" />} />
        </div>
      </section>

      {/* 4. ACCOUNT UTILITIES — Redeem invite code. Account Hub Mobile
          Polish pass's small disclosure, unchanged: submits through the
          exact same goToRedeemCode action, no invite logic touched, just
          kept secondary/last on the page. */}
      <section className="mt-6">
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
    </div>
  );
}

/** Account Hub V2 Hierarchy pass — the unified action row for a managed
 * Business/Event/Venue: name, up to two small status/plan pills using
 * existing data only, ONE primary CTA. Replaces the three near-identical
 * per-entity-type row blocks the previous version repeated. */
function EntityRow({
  icon,
  name,
  pills,
  href,
  cta,
}: {
  icon: ReactNode;
  name: string;
  pills: ({ label: string; tone: "warning" | "pro" } | null)[];
  href: string;
  cta: string;
}) {
  const activePills = pills.filter((p): p is { label: string; tone: "warning" | "pro" } => Boolean(p));
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white px-3.5 py-2.5 shadow-sm">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-ink">{name}</p>
        {activePills.length > 0 && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {activePills.map((p) => (
              <StatusPill key={p.label} tone={p.tone}>
                {p.label}
              </StatusPill>
            ))}
          </div>
        )}
      </div>
      <Link
        href={href}
        className="shrink-0 rounded-full bg-findmi px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      >
        {cta} →
      </Link>
    </div>
  );
}

function StatusPill({ tone, children }: { tone: "warning" | "pro"; children: ReactNode }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
        tone === "pro" ? "bg-findmi-50 text-findmi-700" : "bg-amber-100 text-amber-800"
      }`}
    >
      {children}
    </span>
  );
}

/** Account Hub V2 Hierarchy pass — a compact secondary shortcut pill
 * (border-only, never filled) so the launchpad row never visually
 * competes with each entity row's own primary CTA above it. */
function QuickActionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-full border border-black/10 bg-white px-3.5 py-2 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-findmi/40 hover:bg-findmi-50 hover:text-findmi-700"
    >
      {children}
    </Link>
  );
}

/** Account Hub V2 Hierarchy pass — replaces the old large AccountCard
 * (icon + label + description) with a compact utility tile (icon, label,
 * optional count) so Saved/Following/Orders/Profile read as clearly
 * secondary to Discover/Manage on Findmi above, without losing access. */
function UtilityCard({
  href,
  label,
  count,
  icon,
}: {
  href: string;
  label: string;
  count?: number;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-1.5 rounded-2xl border border-black/5 bg-white px-2 py-3 text-center shadow-sm transition hover:border-black/10"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">{icon}</div>
      <p className="text-xs font-bold text-ink">{label}</p>
      {typeof count === "number" && <p className="text-[10px] text-ink/40">{count}</p>}
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
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M12 20.5s-7.5-4.6-7.5-9.8A4.35 4.35 0 0112 7.5a4.35 4.35 0 017.5 3.2c0 5.2-7.5 9.8-7.5 9.8z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
