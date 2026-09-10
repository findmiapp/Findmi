import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { listConversationsForUser } from "@/lib/opportunities";
import NavIcon from "@/components/NavIcon";
import { goToRedeemCode } from "@/app/(public)/redeem/actions";
import AccountSync from "./AccountSync";
import BusinessScopedAction, { ActionStripLink, PlusGlyph } from "./BusinessScopedAction";
import ManageOnFindmiList, { type ManagedEntity } from "./ManageOnFindmiList";

export const metadata: Metadata = {
  title: "My Findmi",
  robots: { index: false },
};
// Authenticated, per-user content — must never be statically or
// ISR-cached; every response here is specific to whoever is signed in.
export const dynamic = "force-dynamic";

/** Account Hub V2 Hierarchy pass — plan_tier isn't in the public anon/
 * authenticated column grant (see lib/entitlements.ts's own comment),
 * so showing a "Pro" pill on a managed business here needs the
 * service-role client. Read-only, display-only — never a write. */
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
 * discovery first, then a fixed Create/Add strip (never routing a
 * Business-scoped action to whichever business happens to load first —
 * see BusinessScopedAction), then whatever the visitor actively manages
 * (one filterable list — see ManageOnFindmiList — not giant cards or
 * three separate dashboards), then personal activity as small utility
 * tiles, then account-utility odds and ends (invite redemption, pending
 * claims). No new backend/queries beyond a few cheap additive reads
 * (head-counts for the utility tiles, plan_tier for the Pro pill) —
 * every one of those already had an authoritative source elsewhere in
 * the app (business/[id]); this page just also reads it now. */
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
    { count: followingLocationsCount },
    { count: ordersCount },
  ] = await Promise.all([
    // Progressive Email Verification pass — email_verified_at read in the
    // same query as display_name (no extra round trip). Deliberately not
    // added to the shared Profile type (lib/types.ts) — that interface's
    // own comment says never add auth-adjacent metadata to it, since it
    // also backs the public profile view.
    supabase
      .from("profiles")
      .select("display_name, email_verified_at")
      .eq("id", user.id)
      .maybeSingle<{ display_name: string | null; email_verified_at: string | null }>(),
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
    // Surface Followed Locations pass — the "Following" tile below is an
    // all-entity aggregate by design (generic label, links to
    // /account/following, which now lists all three), so Locations join
    // the same sum Businesses/Events already contribute to.
    supabase.from("account_followed_locations").select("location_id", { count: "exact", head: true }).eq("user_id", user.id),
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

  // plan_tier isn't in the public anon/authenticated column grant/RLS
  // (see lib/entitlements.ts's own comment) — same authorize-then-elevate
  // shape every other admin-client read in this codebase uses, with the
  // caller's own already-verified user.id as the only input. Read-only,
  // display-only — never a write.
  //
  // Owner Action UX pass — the Create/Add strip's + Event button now
  // links unconditionally to /account/event/new, which already shows its
  // own graceful non-qualifying-visitor explainer (Multi-Entity
  // Self-Service V1) — so canCurrentUserManageEvents is no longer read
  // here; entitlement gating stays authoritative in that one existing
  // place instead of being re-decided/duplicated on this page too.
  const admin = getAdminSupabase();
  const businessIds = myBusinesses.map((b) => b.id);
  const proBusinessIds = await getProBusinessIdSet(admin, businessIds);

  // Public Messaging V1, Section 11 — Messages joins the Your Activity
  // tile row below, same "compact entry point, real count" treatment as
  // Saved/Following/Orders. No unread tracking (explicitly deferred this
  // pass) — just a total conversation count.
  const messagesCount = admin ? (await listConversationsForUser(admin, user.id)).length : 0;

  const hasAnyManaged = myBusinesses.length > 0 || myEvents.length > 0 || myLocations.length > 0;
  const savedCount = (savedBusinessesCount ?? 0) + (savedEventsCount ?? 0) + (savedProductsCount ?? 0);
  const followingCount = (followingBusinessesCount ?? 0) + (followingEventsCount ?? 0) + (followingLocationsCount ?? 0);

  // Owner Action UX pass — one flat, filterable list for ManageOnFindmiList
  // (client component — filtering needs interactivity /account's own
  // server-rendered sections can't provide). Same data/pills/CTA rules as
  // before, just reshaped with an explicit `kind` per row instead of three
  // separate .map() blocks.
  const managedEntities: ManagedEntity[] = [
    ...myBusinesses.map(
      (b): ManagedEntity => ({
        kind: "business",
        id: b.id,
        name: b.name,
        pills: [
          b.pendingReview ? { label: "Pending Review", tone: "warning" as const } : null,
          proBusinessIds.has(b.id) ? { label: "Pro", tone: "pro" as const } : null,
        ],
        href: `/account/business/${b.id}`,
        cta: b.pendingReview ? "Finish Your Business" : "Manage",
      })
    ),
    ...myEvents.map(
      (e): ManagedEntity => ({
        kind: "event",
        id: e.id,
        name: e.name,
        pills: [e.isDemo ? { label: "In Review", tone: "warning" as const } : null],
        href: `/account/event/${e.id}`,
        cta: e.isDemo ? "Finish Your Event" : "Manage",
      })
    ),
    ...myLocations.map(
      (l): ManagedEntity => ({
        kind: "location",
        id: l.id,
        name: l.name,
        pills: [l.isDemo ? { label: "Pending Review", tone: "warning" as const } : null],
        href: `/account/location/${l.id}`,
        cta: "Manage Venue",
      })
    ),
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountSync />

      <header>
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Your Findmi</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">
          Welcome back{profile?.display_name ? `, ${profile.display_name}` : ""}
        </h1>
      </header>

      {/* Messages Dashboard Shortcut pass — a compact, high-priority
          entry point to /account/messages, placed immediately below the
          welcome header and before Discover. Reuses the exact
          conversation count already computed above (messagesCount, via
          listConversationsForUser) — no new query, no unread-message
          architecture, no notification badge. This is an ADDITIONAL
          shortcut; the existing Messages tile inside Your Activity below
          is untouched. Entire strip is one tappable Link, ~60px tall,
          visually lighter than the Discover card below (white/bordered,
          not aqua-filled). */}
      <Link
        href="/account/messages"
        className="mt-4 flex items-center gap-3 rounded-2xl border border-black/5 bg-white px-4 py-3 shadow-sm transition hover:border-black/10"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">
          <MessageGlyph />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">Messages</p>
          <p className="truncate text-xs text-ink/50">
            {messagesCount === 0
              ? "Start a conversation"
              : `${messagesCount} conversation${messagesCount === 1 ? "" : "s"}`}
          </p>
        </div>
        <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-findmi-700">View →</span>
      </Link>

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

      {/* Progressive Email Verification pass — ACCOUNT CREATED vs. EMAIL
          VERIFIED, kept deliberately separate. profiles.email_verified_at
          (read above, same query as display_name) is now the authoritative
          FindMi-owned signal — NOT auth.users.email_confirmed_at, which
          becomes meaningless the moment Supabase's "Confirm email" setting
          is disabled (every new account gets auto-confirmed at signup; see
          this pass's own report). Deliberately non-blocking: no gate, no
          redirect, no implication the account or Pro is unusable — just a
          reminder plus a link to the dedicated verify-email flow.
          Verification is enforced only where it actually matters (claiming
          an existing Business/Event/Location — see /api/account/claim). */}
      {!profile?.email_verified_at && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p>
            <span className="font-semibold">Verify your email.</span> You can keep building your Findmi profile now —
            verification is required for certain ownership actions, like claiming a listing.
          </p>
          <Link
            href="/account/verify-email"
            className="shrink-0 rounded-full border border-amber-300 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-amber-800 transition hover:bg-amber-100"
          >
            Verify Email
          </Link>
        </div>
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
        <div className="mt-2.5 flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Link
            href="/events"
            className="shrink-0 rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:border-black/20 hover:text-ink"
          >
            Events
          </Link>
          <Link
            href="/businesses"
            className="shrink-0 rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:border-black/20 hover:text-ink"
          >
            Businesses
          </Link>
          {/* Account Hub Live QA pass — consumer discovery, not owner
              Product creation; routes to the existing public Marketplace
              destination (same route the main nav's "Marketplace" item
              already uses), never to the Business-scoped Product manager
              below. */}
          <Link
            href="/marketplace"
            className="shrink-0 rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:border-black/20 hover:text-ink"
          >
            Products
          </Link>
          <Link
            href="/locations"
            className="shrink-0 rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:border-black/20 hover:text-ink"
          >
            Venues
          </Link>
        </div>
      </section>

      {/* 2. CREATE ON FINDMI — Account Hub Final Micro-Polish pass. The
          full-width CTA renders via BusinessScopedAction's "full" variant
          OUTSIDE the horizontally-scrolling row below — see that
          component's own doc comment for why: a scrolling ancestor
          clips the absolutely-positioned "Which business?" chooser and
          makes a lead tile prone to swipe/tap ambiguity on mobile (its own
          many-Business chooser now escapes that clipping via a portal —
          see StripChooser in BusinessScopedAction.tsx — but the tile stays
          out of the scroll row's way regardless). The small "Where I'll
          Be" tile below is a second, intentionally repetitive entry point
          into the SAME BusinessScopedAction / Findmi Here flow
          (tab="findmi-here", same PlusGlyph — never the location-pin
          icon) — Account Create-Strip Correction pass: this compact tile
          reads as an action ("Where I'll Be"), not a repeated feature
          name; the CTA above and the "Findmi Here" card below still carry
          the feature name itself. Both share one routing decision, never
          duplicated. Business/Venue/Product (also business-scoped,
          never silently defaulting to the first managed business) keep
          their existing order in the scrolling row, Event last —
          creating/managing an Event is a distinct, less frequent action
          from scheduling an existing Business's appearances (see the
          "What's the difference?" note below) — and still links to the
          existing /account/event/new, which already shows its own
          graceful non-qualifying-visitor explainer (Multi-Entity
          Self-Service V1); entitlement gating stays authoritative there,
          never re-decided here. */}
      <section className="mt-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Create on Findmi</h2>
        <div className="mt-2">
          <BusinessScopedAction
            variant="full"
            businesses={myBusinesses}
            tab="findmi-here"
            icon={<PlusGlyph className="h-4 w-4" />}
            label="Add Where I'll Be (Findmi Here)"
          />
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <BusinessScopedAction businesses={myBusinesses} tab="findmi-here" icon={<PlusGlyph className="h-4 w-4" />} label="Where I'll Be" />
          <ActionStripLink href="/account/business/new" icon={<NavIcon name="storefront" className="h-4 w-4" />} label="Business" />
          <ActionStripLink href="/account/location/new" icon={<NavIcon name="pin" className="h-4 w-4" />} label="Venue" />
          <BusinessScopedAction businesses={myBusinesses} tab="products" icon={<NavIcon name="tag" className="h-4 w-4" />} label="Product" />
          <ActionStripLink href="/account/event/new" icon={<NavIcon name="calendar" className="h-4 w-4" />} label="Event" />
        </div>
      </section>

      {/* 2b. FINDMI HERE — deliberately its own card, not another strip
          pill: important, and reworked to clearly read and behave like a
          tappable action (filled-aqua icon badge instead of the earlier
          location-style pin/target look, bold "Add to your schedule →"
          line). Headline lightly aligned with "+ Where I'll Be" above so
          the two reinforce each other. Invokes the SAME BusinessScopedAction
          routing as + Where I'll Be above — one business routes straight
          there, several reveal a "Which business?" chooser, zero routes
          to Add Business — never a second, parallel authorization
          decision. Selecting an existing Event through this flow never
          grants Event ownership; it only adds a Findmi Here appearance
          for the Business. Product no longer lives in/under this card —
          it's back in the Create on Findmi row above. */}
      <section className="mt-3 rounded-2xl border border-findmi/30 bg-findmi-50 p-4">
        <BusinessScopedAction
          variant="card"
          businesses={myBusinesses}
          tab="findmi-here"
          icon={<PlusGlyph className="h-4 w-4" />}
          label="Findmi Here"
          eyebrow="Findmi Here"
          headline="Add where your business will be next."
          description="Markets, pop-ups, events, festivals, and other places you're appearing."
          cta="Add to your schedule →"
        />
      </section>

      {/* 2c. FINDMI HERE VS EVENT — one compact line, not a new help
          section: makes the distinction legible without requiring any
          Findmi data-model knowledge. Links to the existing
          /account/event/new destination, which already carries its own
          qualifying/non-qualifying explainer — no new educational
          route. */}
      <div className="mt-3 rounded-xl bg-black/[0.02] px-3.5 py-3">
        <p className="text-xs font-bold text-ink/70">What&rsquo;s the difference?</p>
        <p className="mt-1 text-xs leading-relaxed text-ink/50">
          Findmi Here is for places your business will be appearing. Events are for events you organize and manage.
        </p>
        <Link href="/account/event/new" className="mt-1.5 inline-block text-xs font-bold text-findmi-700 underline underline-offset-2">
          Learn about Events →
        </Link>
      </div>

      {/* 3. MANAGE ON FINDMI — Account Hub V2 pass, extended with
          All/Businesses/Events/Venues filtering (ManageOnFindmiList,
          client-side over the same entities already loaded above — no
          new query). Only renders when the visitor actually manages
          something; otherwise the compact acquisition block below runs
          instead. Still one unified list, never three separate stacked
          dashboards. */}
      {hasAnyManaged ? (
        <section className="mt-6">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Manage on Findmi</h2>
          <ManageOnFindmiList entities={managedEntities} />
        </section>
      ) : (
        /* Zero-Managed-Entity acquisition block — Section 8. Purely the
           motivational prompt now: Add Business/Event/Venue already live
           in the Create/Add strip above, so repeating them here would be
           a duplicate CTA. */
        <section className="mt-6 rounded-3xl border border-black/10 bg-mist/30 p-4 sm:p-5">
          <p className="text-sm font-bold text-ink">Have something people should discover?</p>
          <p className="mt-1 text-xs text-ink/60">List your business, event, or venue on Findmi.</p>
          <Link
            href="/join"
            className="mt-3 flex h-11 items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Get discovered
          </Link>
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

      {/* 4. YOUR ACTIVITY — Account Hub V2 pass. Saved/Following/Orders
          shrink to one compact grid row with real counts (already
          account-backed data, same tables /account/saved,following,orders
          themselves read); Profile joins them here as the 4th utility
          tile rather than a large standalone card, and remains the way
          into sign-out (via /account/profile, unchanged). */}
      <section className="mt-8">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Your Activity</h2>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:grid-cols-5 sm:overflow-visible">
          <UtilityCard href="/account/saved" label="Saved" count={savedCount} icon={<NavIcon name="bookmark" className="h-4 w-4" />} />
          <UtilityCard href="/account/following" label="Following" count={followingCount} icon={<HeartGlyph />} />
          <UtilityCard href="/account/messages" label="Messages" count={messagesCount} icon={<MessageGlyph />} />
          <UtilityCard href="/account/orders" label="Orders" count={ordersCount ?? 0} icon={<NavIcon name="cart" className="h-4 w-4" />} />
          <UtilityCard href="/account/profile" label="Profile" icon={<NavIcon name="person" className="h-4 w-4" />} />
        </div>
      </section>

      {/* 5. ACCOUNT UTILITIES — Redeem invite code. Account Hub Mobile
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
      className="flex w-20 shrink-0 flex-col items-center gap-1.5 rounded-2xl border border-black/5 bg-white px-2 py-3 text-center shadow-sm transition hover:border-black/10 sm:w-auto"
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
// Public Messaging V1 — a small speech-bubble glyph, same 24x24/
// stroke-1.8 style as HeartGlyph above, for the Messages utility tile.
function MessageGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M4 5.5h16a1 1 0 011 1V15a1 1 0 01-1 1H9l-4 3.5V16H4a1 1 0 01-1-1V6.5a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
