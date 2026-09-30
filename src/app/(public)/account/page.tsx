import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { isBusinessPro } from "@/lib/entitlements";
import { listConversationsForUser } from "@/lib/opportunities";
import { conversationContextLabel } from "@/lib/admin/conversations";
import {
  getAccountCommandCenter,
  getPersonalUpcoming,
  type ScheduleItem,
  type AttentionItem,
  type PersonalUpcomingItem,
} from "@/lib/dashboard";
import { getPersonalGraphSummary, type PersonalEntityRef } from "@/lib/personalGraph";
import { getTemporalLabel, formatDateShort } from "@/lib/format";
import type { EventPublicationStatus } from "@/lib/types";
import { getPublicOrigin } from "@/lib/site-url";
import LiveDot from "@/components/LiveDot";
import ShareButton from "@/components/ShareButton";
import SupabaseImage from "@/components/SupabaseImage";
import { goToRedeemCode } from "@/app/(public)/redeem/actions";
import AccountSync from "./AccountSync";
import AccountNav from "./AccountNav";
import AccountErrorBanner from "./AccountErrorBanner";
import ManageOnFindmiList, { type ManagedEntity } from "./ManageOnFindmiList";
import { CompactStatus, OwnerModule, SoftZone } from "./dashboard-ui";
import { Chip } from "./owner-ui";

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
 * Read-only, display-only — never a write.
 *
 * Entitlement Consistency Cleanup — reuses the canonical isBusinessPro()
 * (rather than a raw plan_tier comparison) so an EXPIRED dated-Pro
 * business no longer shows a stale "Pro" pill here after its access has
 * actually lapsed elsewhere in the app. Fetches plan_expires_at alongside
 * plan_tier for exactly that reason — no new entitlement logic is
 * introduced, this just stops duplicating/diverging from the one that
 * already exists. */
async function getProBusinessIdSet(
  admin: ReturnType<typeof getAdminSupabase>,
  businessIds: string[]
): Promise<Set<string>> {
  if (!admin || businessIds.length === 0) return new Set();
  const { data } = await admin.from("businesses").select("id, plan_tier, plan_expires_at").in("id", businessIds);
  return new Set((data ?? []).filter((r) => isBusinessPro(r)).map((r) => r.id));
}

/** Universal Account V1 foundation — Account Home recomposed around the
 * product principle every FindMi identity is a PERSON first (see the
 * Phase 0 audit + architecture pass this implements): personal content
 * leads, management is present but subordinate, and disappears entirely
 * for someone who manages nothing. Same account model, same tables, same
 * routes/actions as before for every existing module (nothing here
 * changes getAccountCommandCenter/listConversationsForUser's own data) —
 * what changed is the INFORMATION ARCHITECTURE and, new this pass, two
 * genuinely personal (not management) modules sourced from this user's
 * own account_saved_* / account_followed_* relationships (lib/
 * personalGraph.ts, lib/dashboard.ts's getPersonalUpcoming).
 *
 * DOM order is now simply the priority order at every width (single
 * column, no explicit CSS grid placement) — identity -> Coming Up For
 * You (personal) -> Needs Attention (operational, only when non-empty)
 * -> Your Collections (personal) -> quick actions -> What You're
 * Managing + its own Schedule (management, only when hasAnyManaged) ->
 * Inbox. "Your Findmi" (View Public Page/Share) stays folded into the
 * compacted identity header for the common single-business case. */
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
    personalGraph,
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
    // Updates Information Architecture pass — publication_status added
    // (one more optional column, not a new query) so getAccountCommandCenter
    // can tell a genuinely pending_review Event apart from a rejected one;
    // is_demo alone can't (see dashboard.ts's own DashboardEvent doc
    // comment).
    supabase.from("event_members").select("event_id, events(name, is_demo, cover_image_url, publication_status)").eq("user_id", user.id),
    supabase
      .from("location_members")
      .select("location_id, locations(name, is_demo, logo_url, cover_image_url)")
      .eq("user_id", user.id),
    // Universal Account V1 foundation — this person's real, durable
    // account-bound Saves/Follows (never business_members/event_members/
    // location_members — those are management, not personal interest;
    // see getPersonalUpcoming's own doc comment). Feeds both the Personal
    // Collections teaser and the Personal Upcoming query below.
    getPersonalGraphSummary(supabase, user.id),
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
    events:
      | { name: string; is_demo: boolean; cover_image_url: string | null; publication_status: EventPublicationStatus }
      | { name: string; is_demo: boolean; cover_image_url: string | null; publication_status: EventPublicationStatus }[]
      | null;
  };
  const myEvents = ((eventMemberships ?? []) as EventMembershipRow[])
    .map((m) => {
      const event = Array.isArray(m.events) ? m.events[0] : m.events;
      return event
        ? {
            id: m.event_id,
            name: event.name,
            isDemo: event.is_demo,
            coverImageUrl: event.cover_image_url,
            publicationStatus: event.publication_status,
          }
        : null;
    })
    .filter(
      (
        e
      ): e is {
        id: string;
        name: string;
        isDemo: boolean;
        coverImageUrl: string | null;
        publicationStatus: EventPublicationStatus;
      } => Boolean(e)
    );

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

  // Mobile Home Composition Correction pass — getAccountCommandCenter
  // itself is untouched (still computes both attention and the
  // management-side schedule internally, unchanged), but Home no longer
  // renders a "Your Schedule" module, so only `attention` is used here
  // now. The management schedule remains fully available at its own
  // existing destination, /account/schedule (untouched).
  const { attention: attentionItems } = admin
    ? await getAccountCommandCenter(admin, {
        businesses: myBusinesses,
        events: myEvents,
        locations: myLocations,
        pendingClaimsCount: myPendingClaims.length,
      })
    : { attention: [] };

  const hasAnyManaged = myBusinesses.length > 0 || myEvents.length > 0 || myLocations.length > 0;
  // Updates Information Architecture pass — split by the category
  // getAccountCommandCenter already classified each item's real
  // underlying status into (see dashboard.ts). Rendering order below
  // always puts Action Required first within the module; each
  // subsection is only rendered when it actually has items.
  const actionRequiredItems = attentionItems.filter((i) => i.category === "action_required");
  const awaitingApprovalItems = attentionItems.filter((i) => i.category === "awaiting_approval");
  const hasUpdates = actionRequiredItems.length > 0 || awaitingApprovalItems.length > 0;

  // Universal Account V1 foundation — Personal Upcoming (Goal 3). Sourced
  // ONLY from this person's real account-bound Saves/Follows (never
  // business_members/event_members/location_members — see
  // getPersonalUpcoming's own doc comment for why that would be a
  // personal-interest fabrication). A genuinely different question from
  // the management-side "Your Schedule" below.
  const personalUpcoming = await getPersonalUpcoming(
    {
      savedEvents: personalGraph.savedEvents.map((e) => ({ id: e.id, slug: e.slug, name: e.name, startAt: e.startAt, endAt: e.endAt, imageUrl: e.imageUrl })),
      followedBusinesses: personalGraph.followedBusinesses.map((b) => ({ id: b.id, slug: b.slug, name: b.name, imageUrl: b.imageUrl })),
      followedEvents: personalGraph.followedEvents.map((e) => ({ id: e.id, slug: e.slug, name: e.name, startAt: e.startAt, endAt: e.endAt, imageUrl: e.imageUrl })),
      followedLocations: personalGraph.followedLocations.map((l) => ({ id: l.id, name: l.name })),
    },
    6
  );

  // Personal Collections teaser (Goal 4) — a small, truthful mix across
  // every category this person actually has something in, each tile
  // linking straight to the real public page (never a fabricated status
  // or count). Capped well below what /my-world itself shows — this is a
  // teaser, not a second copy of that page.
  type CollectionTile = { key: string; name: string; imageUrl: string | null; href: string };
  const toTiles = (refs: PersonalEntityRef[], hrefFor: (r: PersonalEntityRef) => string, prefix: string): CollectionTile[] =>
    refs.map((r) => ({ key: `${prefix}:${r.id}`, name: r.name, imageUrl: r.imageUrl, href: hrefFor(r) }));
  const collectionTiles: CollectionTile[] = [
    ...toTiles(personalGraph.savedProducts, (r) => `/product/${r.slug}`, "product"),
    ...toTiles(personalGraph.savedEvents, (r) => `/event/${r.slug}`, "saved-event"),
    ...toTiles(personalGraph.followedBusinesses, (r) => `/business/${r.slug}`, "followed-business"),
    ...toTiles(personalGraph.savedBusinesses, (r) => `/business/${r.slug}`, "saved-business"),
    ...toTiles(personalGraph.savedLocations, (r) => `/location/${r.slug}`, "saved-location"),
    ...toTiles(personalGraph.followedEvents, (r) => `/event/${r.slug}`, "followed-event"),
    ...toTiles(personalGraph.followedLocations, (r) => `/location/${r.slug}`, "followed-location"),
  ].slice(0, 8);
  const hasAnyCollection = collectionTiles.length > 0;

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
        // Account Command Center V2 — "Open Workspace" for the normal
        // case, matching this pass's own /account/business/[id] = THIS
        // BUSINESS = individual business operating workspace language.
        // "Finish Your Business" is a distinct real state (onboarding
        // incomplete), left unchanged — a label/copy change only, same
        // destination either way.
        cta: b.pendingReview ? "Finish Your Business" : "Open Workspace",
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
          {/* Mobile Home Composition Correction pass — lightened further:
              the previous compact contextual line ("Here's what's
              happening across Findmi") is removed outright, same reasoning
              this header's own earlier pass already applied to the old
              "Your Findmi" eyebrow — real estate that named the page
              without contributing information. A plain, light greeting is
              enough; Sign Out and other account controls live in
              AccountNav (unchanged, still rendered below), never on this
              line. */}
          <h1 className="text-body font-semibold text-secondary">
            Welcome Back{profile?.display_name ? `, ${profile.display_name}` : ""}
          </h1>
          {singleBusiness && (
            <p className="mt-1 flex items-center gap-2 text-body text-muted">
              <span className="truncate font-semibold text-primary">{singleBusiness.name}</span>
              {singleBusiness.pendingReview && (
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-label font-bold uppercase text-amber-800">
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
              className="flex h-9 items-center justify-center rounded-xl border border-black/10 px-3.5 text-button font-bold text-primary transition hover:border-black/20"
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

      {error && <AccountErrorBanner error={error} />}
      {eventManagementGranted === "1" && !error && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-findmi-700">
          Event Management access activated. You can now add an Event below.
        </p>
      )}

      {!profile?.email_verified_at && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-body text-amber-800">
          <p>
            <span className="font-semibold">Verify your email.</span> You can keep building your Findmi profile now.
            Verification is required for certain ownership actions, like claiming a listing.
          </p>
          <Link
            href="/account/verify-email"
            className="shrink-0 rounded-xl border border-amber-300 px-3.5 py-1.5 text-label font-bold uppercase text-amber-800 transition hover:bg-amber-100"
          >
            Verify Email
          </Link>
        </div>
      )}

      {/* Universal Account V1 — recomposed information hierarchy, tightened
          by the Mobile Home Composition Correction pass. DOM order IS the
          priority order at every width (single column, no explicit CSS
          grid placement): COMING UP FOR YOU (personal) -> NEEDS ATTENTION
          (operational, only when non-empty) -> YOUR COLLECTIONS (personal)
          -> WHAT YOU'RE MANAGING (management, compact 3-entity preview,
          only when hasAnyManaged) -> INBOX. The former large quick-action
          row (Where I'll Be/Analytics) and the "Your Schedule" module are
          both removed from Home per this pass — Home summarizes, dedicated
          destinations (each entity's own workspace, /account/schedule)
          hold the depth. Nothing below is a new query — every module here
          reads data this page (or lib/dashboard.ts/lib/personalGraph.ts)
          already fetched above. */}
      <div className="mt-6 flex flex-col gap-5">
        {/* PERSONAL UPCOMING — Goal 3. Deliberately NOT the management
            Schedule (see getPersonalUpcoming's own doc comment): sourced
            only from this person's real Saves/Follows, never from
            business_members/event_members/location_members. Compact,
            discovery-oriented empty state — never a giant empty card —
            when there's genuinely nothing coming up yet. */}
        <OwnerModule
          title="Coming Up For You"
          meta={
            <Link href="/my-world" className="text-metadata font-bold text-accent underline underline-offset-2">
              Your World →
            </Link>
          }
        >
          {personalUpcoming.length === 0 ? (
            <CompactStatus label="Save or follow something to see what's coming up for you here." />
          ) : (
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {personalUpcoming.map((item) => (
                <ScheduleCard key={item.key} item={item} />
              ))}
            </div>
          )}
        </OwnerModule>

        {/* NEEDS YOUR ATTENTION — unchanged data/logic (getAccountCommandCenter),
            only its position in the page changed. Operational only —
            omitted entirely when there's nothing genuinely requiring or
            awaiting action, never a reserved empty card. */}
        {hasUpdates && (
          <SoftZone
            title="Needs Your Attention"
            meta={<Chip tone="amber">{actionRequiredItems.length + awaitingApprovalItems.length}</Chip>}
          >
            <div className="flex flex-col gap-3">
              {actionRequiredItems.length > 0 && (
                <UpdateSubsection
                  label="Action Required"
                  items={actionRequiredItems}
                  countClassName="bg-red-50 text-red-700"
                />
              )}
              {awaitingApprovalItems.length > 0 && (
                <UpdateSubsection
                  label="Awaiting Approval"
                  items={awaitingApprovalItems}
                  countClassName="bg-findmi-50 text-findmi-700"
                />
              )}
            </div>
          </SoftZone>
        )}

        {/* PERSONAL COLLECTIONS — Goal 4. A compact, truthful mix across
            whatever this person has actually saved/followed (real
            entities, real images, never a fabricated count/status),
            leading to the full /my-world surface rather than reproducing
            it here. Same compact-rail visual language as Coming Up For
            You above, not a new pattern. */}
        <OwnerModule
          title="Your Collections"
          meta={
            <Link href="/my-world" className="text-metadata font-bold text-accent underline underline-offset-2">
              Your World →
            </Link>
          }
        >
          {hasAnyCollection ? (
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {collectionTiles.map((tile) => (
                <CollectionTileCard key={tile.key} tile={tile} />
              ))}
            </div>
          ) : (
            <CompactStatus label="Save a business, product, event, or location to build your world." />
          )}
        </OwnerModule>

        {/* WHAT YOU MANAGE — Mobile Home Composition Correction pass. Zero
            managed entities -> this section simply doesn't render: no
            empty "Get Started" card, no reserved management module for
            someone who manages nothing. Universal creation lives globally
            in QuickCreateMenu (untouched) either way.
            The former large "Where I'll Be"/"Analytics" quick-action row
            and the "Your Schedule" module are both REMOVED from Home per
            this pass — same underlying capabilities, still fully reachable
            from each entity's own specialized workspace and from
            /account/schedule (both untouched), just no longer occupying
            major Home real estate. previewLimit={3} caps the default
            teaser to at most 3 entities regardless of portfolio size (a
            person managing 1 vs. 15 entities gets the same Home height) —
            see ManageOnFindmiList's own doc comment for the reveal
            behavior; the filter tabs only appear once expanded. */}
        {hasAnyManaged && (
          <OwnerModule title="What You're Managing">
            <ManageOnFindmiList entities={managedEntities} previewLimit={3} />
          </OwnerModule>
        )}

        {/* INBOX — preserved access, unchanged data (listConversationsForUser),
            repositioned to the low-visual-weight operational tail of the
            page rather than competing with the personal content above. */}
        <OwnerModule
          title="Inbox"
          meta={
            <Link href="/account/messages" className="text-metadata font-bold text-accent underline underline-offset-2">
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
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-findmi-50 text-metadata font-bold uppercase text-accent">
                    {c.otherPartyLabel.slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-semibold text-primary">{c.otherPartyLabel}</p>
                    <p className="truncate text-metadata text-muted">
                      {conversationContextLabel(c.subjectType)}
                      {c.lastMessageBody ? ` · ${c.lastMessageBody}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-microcopy text-subtle">{formatDateShort(c.lastActivityAt)}</p>
                </Link>
              ))}
            </div>
          ) : (
            <CompactStatus label="Your Findmi conversations will appear here." />
          )}
        </OwnerModule>
      </div>

      {myPendingClaims.length > 0 && (
        <section id="pending-claims" className="mt-6">
          <h2 className="text-label font-bold uppercase text-subtle">Pending Claims</h2>
          <div className="mt-2 flex flex-col gap-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0 lg:grid-cols-3">
            {myPendingClaims.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-3 rounded-2xl border border-findmi/20 bg-findmi-50/50 p-4 shadow-sm"
              >
                <Link href={`/business/${c.slug}`} className="flex flex-col gap-1">
                  <p className="text-card-title font-bold text-primary">{c.name}</p>
                  <p className="text-metadata font-semibold text-accent">Claim under review</p>
                  <p className="text-metadata text-muted">Typically reviewed within 48–72 hours.</p>
                </Link>
                <Link
                  href="/join/business"
                  className="flex h-9 w-fit items-center justify-center rounded-xl bg-findmi px-4 text-label font-bold uppercase text-white transition hover:bg-findmi-600"
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
        <Link href="/find" className="text-metadata font-semibold text-muted underline underline-offset-2 hover:text-primary">
          Explore what&rsquo;s happening on Findmi →
        </Link>
        <details className="group">
          <summary className="w-fit cursor-pointer text-metadata font-semibold text-muted underline underline-offset-2 transition hover:text-secondary [&::-webkit-details-marker]:hidden">
            Redeem invite code
          </summary>
          <form action={goToRedeemCode} className="mt-2 flex max-w-sm flex-col gap-2 sm:flex-row">
            <input type="hidden" name="return_to" value="/account" />
            <input
              type="text"
              name="code"
              required
              placeholder="Enter code"
              className="w-full min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none"
            />
            <button
              type="submit"
              className="shrink-0 rounded-xl border border-black/15 px-4 py-2.5 text-button font-bold uppercase text-primary transition hover:border-black/30"
            >
              Apply
            </button>
          </form>
        </details>
      </div>
    </div>
  );
}

/** Updates Information Architecture pass — one labeled group inside the
 * Updates module (Action Required or Awaiting Approval), each with its
 * own count badge whose color is the ONLY urgency signal: a restrained
 * light-red/dark-red badge (countClassName, passed by the caller) for
 * Action Required, the existing neutral Aqua treatment for Awaiting
 * Approval — never a solid/screaming red, never the reverse. */
function UpdateSubsection({
  label,
  items,
  countClassName,
}: {
  label: string;
  items: AttentionItem[];
  countClassName: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-label font-bold uppercase text-subtle">{label}</p>
        <span className={`rounded-full px-2 py-0.5 text-metadata font-bold ${countClassName}`}>{items.length}</span>
      </div>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {items.map((item) => (
          <UpdateRow key={item.key} item={item} />
        ))}
      </div>
    </div>
  );
}

/** One Updates row — the entity/thing's own name gets its own primary
 * line, the status/explanation its own secondary line (never
 * concatenated into one truncating sentence — the real-device QA
 * problem this pass fixes). Both lines wrap rather than truncate, so a
 * real long name ("San Gennaro 100th Anniversary") stays fully
 * readable. Every current source always carries a real, useful href
 * (see dashboard.ts's own push sites), so every row stays tappable with
 * its chevron — never a fake destination invented here. */
function UpdateRow({ item }: { item: AttentionItem }) {
  return (
    <Link href={item.href} className="flex items-start gap-3 rounded-xl px-2 py-1.5 transition hover:bg-black/[0.03]">
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold text-primary">{item.title}</span>
        {item.subtitle && <span className="mt-0.5 block text-metadata text-muted">{item.subtitle}</span>}
      </span>
      <ChevronGlyph className="mt-0.5 h-4 w-4 shrink-0 text-ink/30" />
    </Link>
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
/** Shared by both the management-side Schedule rail and the Personal
 * Upcoming rail above — both item shapes carry exactly these fields, and
 * both are read-only "here's what's coming up" cards with no owner
 * mutation affordance, so one structural type covers either caller
 * without a duplicated component. */
type ScheduleCardItem = Pick<ScheduleItem, "key" | "startAt" | "endAt" | "title" | "relatedTo" | "href" | "imageUrl">;
function ScheduleCard({ item }: { item: ScheduleCardItem | PersonalUpcomingItem }) {
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
          className={`absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-label font-bold uppercase ${
            live ? "bg-red-600 text-white" : "bg-white/90 text-secondary"
          }`}
        >
          {live && <LiveDot className="text-white" />}
          {live ? "Now" : label}
        </span>
      </div>
      <div className="min-w-0 px-0.5 pb-0.5">
        <p className="truncate text-metadata font-bold text-primary">{item.title}</p>
        <p className="truncate text-microcopy text-subtle">{item.relatedTo.join(" · ")}</p>
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

/** Universal Account V1 foundation — one small tile in the Your
 * Collections rail (Goal 4). Deliberately simpler than ScheduleCard
 * (no live/temporal badge — a saved/followed thing has no start/end
 * time of its own) — just a real image and a real name, linking straight
 * to that entity's own public page. */
function CollectionTileCard({ tile }: { tile: { name: string; imageUrl: string | null; href: string } }) {
  return (
    <Link
      href={tile.href}
      className="flex w-[104px] shrink-0 flex-col gap-2 rounded-2xl border border-black/5 bg-white p-2 transition active:scale-[0.98] hover:shadow-md hover:shadow-black/5"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-black/[0.04]">
        {tile.imageUrl ? (
          <SupabaseImage src={tile.imageUrl} alt={tile.name} fill sizes="104px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ScheduleFallbackGlyph className="h-6 w-6 text-black/15" />
          </div>
        )}
      </div>
      <p className="truncate px-0.5 pb-0.5 text-metadata font-bold text-primary">{tile.name}</p>
    </Link>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

