import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { listConversationsForUser } from "@/lib/opportunities";
import { conversationContextLabel } from "@/lib/admin/conversations";
import { getAccountCommandCenter, type ScheduleItem } from "@/lib/dashboard";
import { getTemporalLabel, formatDateShort } from "@/lib/format";
import { getPublicOrigin } from "@/lib/site-url";
import LiveDot from "@/components/LiveDot";
import ShareButton from "@/components/ShareButton";
import SupabaseImage from "@/components/SupabaseImage";
import NavIcon from "@/components/NavIcon";
import { goToRedeemCode } from "@/app/(public)/redeem/actions";
import AccountSync from "./AccountSync";
import AccountNav from "./AccountNav";
import BusinessScopedAction, { PlusGlyph } from "./BusinessScopedAction";
import AnalyticsAction from "./AnalyticsAction";
import ManageOnFindmiList, { type ManagedEntity } from "./ManageOnFindmiList";
import { CompactStatus, OwnerModule } from "./dashboard-ui";

export const metadata: Metadata = {
  title: "My Findmi",
  robots: { index: false },
};
// Authenticated, per-user content — must never be statically or
// ISR-cached; every response here is specific to whoever is signed in.
export const dynamic = "force-dynamic";

/** Launch V2 Pass 1 — plan_tier isn't in the public anon/authenticated
 * column grant (see lib/entitlements.ts's own comment), so showing a
 * "Pro" pill on a managed business here needs the service-role client.
 * Read-only, display-only — never a write. */
async function getProBusinessIdSet(
  admin: ReturnType<typeof getAdminSupabase>,
  businessIds: string[]
): Promise<Set<string>> {
  if (!admin || businessIds.length === 0) return new Set();
  const { data } = await admin.from("businesses").select("id, plan_tier").in("id", businessIds);
  return new Set((data ?? []).filter((r) => r.plan_tier === "pro" || r.plan_tier === "pro_seller").map((r) => r.id));
}

/** Owner Command Center V4 / Mobile Command Center V2 — a genuine
 * recomposition, not a restyle. Same account model, same tables, same
 * routes/actions as before (nothing here is a new query beyond the
 * existing getAccountCommandCenter/listConversationsForUser calls this
 * page already made, and V2 actively removes a confirmed duplicate one
 * — see the listConversationsForUser call site below) — what changed is
 * the INFORMATION ARCHITECTURE. "Your Findmi" (View Public Page/Share)
 * is folded directly into a compacted identity header for the common
 * single-business case. Mobile DOM order is the mobile priority order:
 * identity -> primary action -> Needs Attention (only when non-empty)
 * -> Today/Coming Up visual rail -> Inbox -> What You're Managing.
 * Desktop places Today/Coming Up + Inbox as the wider main column and
 * Needs Attention + Managing as a self-sized rail, via explicit CSS
 * grid line placement (lg:col-start/lg:row-start) rather than DOM
 * reordering — the same "DOM order = mobile priority, explicit grid
 * placement repositions for desktop" technique Admin's own Command
 * Center proved, reused here as an engineering pattern, not a visual
 * copy: Owner keeps its own warmer rounded-2xl/shadow-sm module
 * language (see dashboard-ui.tsx) rather than Admin's flatter surfaces. */
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
  ] = await Promise.all([
    // Progressive Email Verification pass — email_verified_at read in the
    // same query as display_name (no extra round trip).
    supabase
      .from("profiles")
      .select("display_name, email_verified_at")
      .eq("id", user.id)
      .maybeSingle<{ display_name: string | null; email_verified_at: string | null }>(),
    // Mobile Command Center V2 — logo_url/cover_image_url added to each
    // of these three existing selects (one extra column apiece, not a
    // new query) so Where I'll Be / What You're Managing can resolve
    // real imagery without a per-row fetch. See lib/dashboard.ts's own
    // DashboardBusiness/DashboardEvent/DashboardLocation doc comments.
    supabase
      .from("business_members")
      .select("business_id, businesses(name, slug, publication_status, logo_url, cover_image_url)")
      .eq("user_id", user.id),
    supabase
      .from("business_claim_requests")
      .select("id, business_id, businesses(name, slug)")
      .eq("user_id", user.id)
      .eq("status", "pending"),
    supabase.from("event_members").select("event_id, events(name, is_demo, cover_image_url)").eq("user_id", user.id),
    supabase
      .from("location_members")
      .select("location_id, locations(name, is_demo, logo_url, cover_image_url)")
      .eq("user_id", user.id),
  ]);

  type BusinessMembershipRow = {
    business_id: string;
    businesses:
      | { name: string; slug: string; publication_status: string; logo_url: string | null; cover_image_url: string | null }
      | { name: string; slug: string; publication_status: string; logo_url: string | null; cover_image_url: string | null }[]
      | null;
  };
  const myBusinesses = ((businessMemberships ?? []) as BusinessMembershipRow[])
    .map((m) => {
      const business = Array.isArray(m.businesses) ? m.businesses[0] : m.businesses;
      return business
        ? {
            id: m.business_id,
            name: business.name,
            slug: business.slug,
            pendingReview: business.publication_status === "pending_review",
            logoUrl: business.logo_url,
            coverImageUrl: business.cover_image_url,
          }
        : null;
    })
    .filter(
      (b): b is { id: string; name: string; slug: string; pendingReview: boolean; logoUrl: string | null; coverImageUrl: string | null } =>
        Boolean(b)
    );

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
    events: { name: string; is_demo: boolean; cover_image_url: string | null } | { name: string; is_demo: boolean; cover_image_url: string | null }[] | null;
  };
  const myEvents = ((eventMemberships ?? []) as EventMembershipRow[])
    .map((m) => {
      const event = Array.isArray(m.events) ? m.events[0] : m.events;
      return event ? { id: m.event_id, name: event.name, isDemo: event.is_demo, coverImageUrl: event.cover_image_url } : null;
    })
    .filter((e): e is { id: string; name: string; isDemo: boolean; coverImageUrl: string | null } => Boolean(e));

  type LocationMembershipRow = {
    location_id: string;
    locations:
      | { name: string; is_demo: boolean; logo_url: string | null; cover_image_url: string | null }
      | { name: string; is_demo: boolean; logo_url: string | null; cover_image_url: string | null }[]
      | null;
  };
  const myLocations = ((locationMemberships ?? []) as LocationMembershipRow[])
    .map((m) => {
      const location = Array.isArray(m.locations) ? m.locations[0] : m.locations;
      return location
        ? { id: m.location_id, name: location.name, isDemo: location.is_demo, logoUrl: location.logo_url, coverImageUrl: location.cover_image_url }
        : null;
    })
    .filter(
      (l): l is { id: string; name: string; isDemo: boolean; logoUrl: string | null; coverImageUrl: string | null } => Boolean(l)
    );

  const admin = getAdminSupabase();
  const businessIds = myBusinesses.map((b) => b.id);
  const proBusinessIds = await getProBusinessIdSet(admin, businessIds);

  // Launch V2 Pass 1.1 — the Inbox preview is now the ONLY customer-
  // conversation signal on Home (see Needs Your Attention below); no
  // separate recency-windowed count is computed anymore. Excludes
  // 'opportunity'-subject_type Conversations (created only when a note is
  // attached to an invitation/application) — that interaction already
  // has a structured representation under Needs Your Attention/
  // Opportunities, so it never doubles up here.
  // Mobile Command Center V2 — passes the managed-entity ids this page
  // already fetched above (myBusinesses/myEvents/myLocations), so
  // listConversationsForUser skips its own internal re-fetch of
  // business_members/event_members/location_members (the confirmed
  // duplicate query from the read-only audit). See that function's own
  // doc comment in lib/opportunities.ts.
  const conversations = (
    admin ? await listConversationsForUser(admin, user.id, { businesses: myBusinesses, events: myEvents, locations: myLocations }) : []
  ).filter((c) => c.subjectType !== "opportunity");
  const inboxPreview = conversations.slice(0, 3);

  const { attention: attentionItems, schedule: scheduleItems } = admin
    ? await getAccountCommandCenter(admin, {
        businesses: myBusinesses,
        events: myEvents,
        locations: myLocations,
        pendingClaimsCount: myPendingClaims.length,
      })
    : { attention: [], schedule: [] };
  // Owner Command Center V4 — the existing getAccountCommandCenter/
  // getUnifiedSchedule call already returns up to SCHEDULE_DISPLAY_LIMIT
  // (8) deduplicated upcoming items; V1-V3 only ever showed
  // scheduleItems[0] as "Next Up," discarding the rest even though the
  // data was already in hand. "Where I'll Be" is Findmi's strongest
  // product concept, so it now shows the next few (not just one), same
  // zero-new-query data, with the full list still one tap away.
  const upcomingSchedule = scheduleItems.slice(0, 3);

  const hasAnyManaged = myBusinesses.length > 0 || myEvents.length > 0 || myLocations.length > 0;
  const attentionCount = attentionItems.length;

  // Mobile Command Center V2 — imageUrl precedence per the read-only
  // audit's documented recommendation, deliberately DIFFERENT from the
  // schedule rail's own precedence below: a compact management-list row
  // is a small square-ish thumbnail, where a brand logo (designed for
  // recognition at small sizes) reads more clearly than a wide cover
  // photo — Business and Location both use logo_url first, for visual
  // consistency within this one unified list. Events have no logo_url
  // column at all, so cover_image_url is their only option.
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
        imageUrl: b.logoUrl ?? b.coverImageUrl,
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
        imageUrl: e.coverImageUrl,
      })
    ),
    ...myLocations.map(
      (l): ManagedEntity => ({
        kind: "location",
        id: l.id,
        name: l.name,
        pills: [l.isDemo ? { label: "Pending Review", tone: "warning" as const } : null],
        href: `/account/location/${l.id}`,
        cta: "Manage",
        imageUrl: l.logoUrl ?? l.coverImageUrl,
      })
    ),
  ];

  const singleBusiness = myBusinesses.length === 1 ? myBusinesses[0] : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:py-10">
      <AccountSync />
      <AccountNav />

      {/* IDENTITY — Mobile Command Center V2 pass: the read-only audit
          found this compact header still accounted for roughly the top
          half of the first mobile viewport before any real operational
          content appeared. The "Your Findmi" eyebrow is removed outright
          (pure decoration, zero information) and the greeting drops from
          a bold h1 heading to a single quiet line — still a real h1 for
          document structure/accessibility, just no longer visually
          competing with Needs Attention / Today's schedule below it.
          The multi-business pill strip is REMOVED per this pass's own
          explicit product decision: it carried strictly less information
          than What You're Managing further down (same businesses, no
          status/Pro pills, no distinguishing behavior — just a second,
          redundant way to reach the same destinations) and created an
          unbounded, affordance-less horizontal strip for accounts with
          several businesses. No active-business selection/state replaces
          it in this pass. Single-business View Public Page/Share is
          unchanged. */}
      <div className="lg:flex lg:items-start lg:justify-between lg:gap-6">
        <header className="min-w-0">
          <h1 className="text-sm font-semibold text-ink/70">
            Welcome back{profile?.display_name ? `, ${profile.display_name}` : ""}
          </h1>
          {singleBusiness && (
            <p className="mt-1 flex items-center gap-2 text-sm text-ink/60">
              <span className="truncate font-semibold text-ink/80">{singleBusiness.name}</span>
              {singleBusiness.pendingReview && (
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                  Pending Review
                </span>
              )}
            </p>
          )}
        </header>

        {singleBusiness && !singleBusiness.pendingReview && (
          <div className="mt-3 flex shrink-0 gap-2 lg:mt-0">
            <Link
              href={`/business/${singleBusiness.slug}`}
              className="flex h-9 items-center justify-center rounded-full border border-black/10 px-3.5 text-xs font-bold text-ink transition hover:border-black/20"
            >
              View Public Page
            </Link>
            <ShareButton
              url={`${getPublicOrigin()}/business/${singleBusiness.slug}`}
              title={singleBusiness.name}
              track={{ subject_type: "business", subject_id: singleBusiness.id, business_id: singleBusiness.id }}
            />
          </div>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {eventManagementGranted === "1" && !error && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Event Management access activated — you can now add an Event below.
        </p>
      )}

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

      {/* ACTION ROW — Final Action-Bar Polish pass: the old single
          full-width CTA consumed too much prime mobile space (real-
          device QA). Now a compact two-action row: Where I'll Be
          (primary, Aqua — BusinessScopedAction's own zero/one/many
          routing, completely untouched) + Analytics (secondary,
          outlined — AnalyticsAction's own zero/one/many resolver, see
          that file and businessScope.ts's resolveAnalyticsHref). Zero
          businesses omits Analytics entirely rather than rendering a
          disabled control or inventing a fake destination — Where I'll
          Be alone then takes the full row, same as its own existing
          zero-business behavior. */}
      <div className="mt-4 flex gap-2">
        <div className={myBusinesses.length > 0 ? "flex-1" : "w-full"}>
          <BusinessScopedAction
            variant="full"
            size="row"
            businesses={myBusinesses}
            tab="findmi-here"
            icon={<PlusGlyph className="h-4 w-4" />}
            label="Where I'll Be"
          />
        </div>
        {myBusinesses.length > 0 && (
          <div className="flex-1">
            <AnalyticsAction businesses={myBusinesses} icon={<NavIcon name="target" className="h-4 w-4" />} />
          </div>
        )}
      </div>

      {/* OPERATIONAL GRID — Mobile Command Center V2: mobile DOM order is
          the mobile priority order (does anything need me -> what's
          happening now/coming up -> inbox -> what am I managing); desktop
          places Today/Coming Up + Inbox as the wider main column and
          Needs Attention + What You're Managing as a self-sized rail via
          explicit CSS grid line placement, so all four are visible
          together instead of one long scroll. Needs Attention and What
          You're Managing are now independent grid children (previously a
          single shared wrapper) so Needs Attention can move earlier in
          DOM order without dragging Managing along with it — same
          col-start-3/row-start technique the Inbox div already used for
          its own hasAnyManaged-conditional placement. */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3 lg:items-start">
        {/* NEEDS ATTENTION — genuinely operational/status items only
            (pending invitations, pending review, pending claims, expired
            Pro) — same getAccountCommandCenter data as before. Rendered
            only when there's something active: an empty "All caught up"
            line was removed rather than placed ahead of useful schedule
            content, per this pass's own scope. On mobile this is now the
            very first operational content (before Today/Coming Up)
            whenever it's non-empty; desktop keeps it pinned to the top of
            the right-hand rail regardless of DOM order. */}
        {attentionCount > 0 && (
          <div className="lg:col-start-3 lg:row-start-1">
            <OwnerModule
              title="Needs Attention"
              meta={<span className="rounded-full bg-findmi-50 px-2 py-0.5 text-xs font-bold text-findmi-700">{attentionCount}</span>}
            >
              <div className="flex flex-col gap-1.5">
                {attentionItems.map((item) => (
                  <Link
                    key={item.key}
                    href={item.href}
                    className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition hover:bg-black/[0.03]"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-findmi-50">
                      <span className="h-2 w-2 rounded-full bg-findmi" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{item.title}</span>
                      {item.subtitle && <span className="block truncate text-xs text-ink/50">{item.subtitle}</span>}
                    </span>
                    <ChevronGlyph className="h-4 w-4 shrink-0 text-ink/30" />
                  </Link>
                ))}
              </div>
            </OwnerModule>
          </div>
        )}

        {/* TODAY / COMING UP — a compact visual rail, replacing the old
            text-only "Where I'll Be" rows. Same upcomingSchedule data
            (already deduplicated, sorted, and capped by
            getUnifiedSchedule — no scheduling logic touched here), same
            per-item href/actionKind/relatedTo semantics — only the
            presentation changed, to real imagery (item.imageUrl, threaded
            from existing selects — zero per-card queries) plus the
            existing getTemporalLabel live/upcoming label. Only rendered
            once there's SOMETHING managed, same as before. */}
        {hasAnyManaged && (
          <div className="lg:col-start-1 lg:col-span-2 lg:row-start-1">
            <OwnerModule
              title="Today / Coming Up"
              meta={
                <Link href="/account/schedule" className="text-xs font-bold text-findmi-700 underline underline-offset-2">
                  Full Schedule →
                </Link>
              }
            >
              {upcomingSchedule.length === 0 ? (
                <CompactStatus label="No upcoming schedule — add where you'll be next so people can find you." />
              ) : (
                <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {upcomingSchedule.map((item) => (
                    <ScheduleCard key={item.key} item={item} />
                  ))}
                </div>
              )}
            </OwnerModule>
          </div>
        )}

        {/* INBOX — enough context to answer "is there something I need to
            respond to," never messaging itself. Same canonical
            listConversationsForUser this page already called. */}
        <div className={`lg:col-start-1 lg:col-span-2 ${hasAnyManaged ? "lg:row-start-2" : "lg:row-start-1"}`}>
          <OwnerModule
            title="Inbox"
            meta={
              <Link href="/account/messages" className="text-xs font-bold text-findmi-700 underline underline-offset-2">
                View Inbox →
              </Link>
            }
          >
            {inboxPreview.length > 0 ? (
              <div className="flex flex-col gap-2">
                {inboxPreview.map((c) => (
                  <Link
                    key={c.id}
                    href={`/account/messages/${c.id}`}
                    className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition hover:bg-black/[0.03]"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-findmi-50 text-xs font-bold uppercase text-findmi-700">
                      {c.otherPartyLabel.slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{c.otherPartyLabel}</p>
                      <p className="truncate text-xs text-ink/50">
                        {conversationContextLabel(c.subjectType)}
                        {c.lastMessageBody ? ` · ${c.lastMessageBody}` : ""}
                      </p>
                    </div>
                    <p className="shrink-0 text-[11px] text-ink/40">{formatDateShort(c.lastActivityAt)}</p>
                  </Link>
                ))}
              </div>
            ) : (
              <CompactStatus label="Your Findmi conversations will appear here." />
            )}
          </OwnerModule>
        </div>

        {/* WHAT YOU'RE MANAGING — one unified, filterable list
            (ManageOnFindmiList, now with real entity imagery + a
            full-row tap target — see that component's own comments)
            rather than separate Business/Event/Location cards. Zero
            managed -> the real prerequisite (Create your Business),
            never a faked destination. Independent grid child from Needs
            Attention now, so it stays anchored under wherever Needs
            Attention landed (or the top of the rail, when there's
            nothing needing attention). */}
        <div className={`lg:col-start-3 ${attentionCount > 0 ? "lg:row-start-2" : "lg:row-start-1"}`}>
          {hasAnyManaged ? (
            <OwnerModule title="What You're Managing">
              <ManageOnFindmiList entities={managedEntities} />
            </OwnerModule>
          ) : (
            <OwnerModule title="Get Started">
              <p className="text-sm font-bold text-ink">Have something people should discover?</p>
              <p className="mt-1 text-xs text-ink/60">List your business, event, or location on Findmi.</p>
              <Link
                href="/join"
                className="mt-3 flex h-11 items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
              >
                Get discovered
              </Link>
            </OwnerModule>
          )}
        </div>
      </div>

      {myPendingClaims.length > 0 && (
        <section id="pending-claims" className="mt-6">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Pending Claims</h2>
          <div className="mt-2 flex flex-col gap-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0 lg:grid-cols-3">
            {myPendingClaims.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-3 rounded-2xl border border-findmi/20 bg-findmi-50/50 p-4 shadow-sm"
              >
                <Link href={`/business/${c.slug}`} className="flex flex-col gap-1">
                  <p className="text-sm font-bold text-ink">{c.name}</p>
                  <p className="text-xs font-semibold text-findmi-700">Claim under review</p>
                  <p className="text-xs text-ink/50">Typically reviewed within 48–72 hours.</p>
                </Link>
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

      {/* Footer utility links — demoted, unchanged destinations. */}
      <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-black/5 pt-4">
        <Link href="/find" className="text-xs font-semibold text-ink/50 underline underline-offset-2 hover:text-ink">
          Explore what&rsquo;s happening on Findmi →
        </Link>
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
      </div>
    </div>
  );
}

/** Mobile Command Center V2 — the Today/Coming Up rail's own card,
 * built local to this page rather than importing AppearanceFeedCard/
 * CompactCard: those are consumer-discovery components that fire
 * entity_impression/entity_click analytics via buildEntityEventFields,
 * which owner-dashboard cards must never do (this pass's own hard
 * scope boundary). This mirrors their visual grammar instead — a
 * shrink-0 image-first card in a horizontal rail, a live badge reusing
 * the exact same getTemporalLabel this app already treats as the one
 * source of truth for "happening now" — without importing either
 * component or any analytics call. Routes to the exact same item.href
 * every prior text row used; only the presentation changed. */
function ScheduleCard({ item }: { item: ScheduleItem }) {
  const { label, live } = getTemporalLabel(item.startAt, item.endAt);
  return (
    <Link
      href={item.href}
      className={`flex w-[128px] shrink-0 flex-col gap-2 rounded-2xl border p-2 transition active:scale-[0.98] ${
        live ? "border-findmi/50 bg-findmi-50" : "border-black/5 bg-white hover:shadow-md hover:shadow-black/5"
      }`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black/[0.04]">
        {item.imageUrl ? (
          <SupabaseImage src={item.imageUrl} alt={item.title} fill sizes="128px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ScheduleFallbackGlyph className="h-7 w-7 text-black/15" />
          </div>
        )}
        <span
          className={`absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide ${
            live ? "bg-red-600 text-white" : "bg-white/90 text-ink/70"
          }`}
        >
          {live && <LiveDot className="text-white" />}
          {live ? "Now" : label}
        </span>
      </div>
      <div className="min-w-0 px-0.5 pb-0.5">
        <p className="truncate text-xs font-bold text-ink">{item.title}</p>
        <p className="truncate text-[11px] text-ink/45">{item.relatedTo.join(" · ")}</p>
      </div>
    </Link>
  );
}

function ScheduleFallbackGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 21s-7-5.686-7-11a7 7 0 1 1 14 0c0 5.314-7 11-7 11Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
