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
  type AttentionItem,
  type PersonalUpcomingItem,
} from "@/lib/dashboard";
import { getPersonalGraphSummary, type PersonalEntityRef } from "@/lib/personalGraph";
import { getJournalArchiveEntries } from "@/lib/journal";
import { getTemporalLabel, formatDateShort, formatTime } from "@/lib/format";
import type { EventPublicationStatus } from "@/lib/types";
import LiveDot from "@/components/LiveDot";
import SupabaseImage from "@/components/SupabaseImage";
import ChevronIcon from "@/components/ChevronIcon";
import JournalArchiveCard from "@/components/journal/JournalArchiveCard";
import { goToRedeemCode } from "@/app/(public)/redeem/actions";
import AccountSync from "./AccountSync";
import PersonalAppShell from "./PersonalAppShell";
import AccountErrorBanner from "./AccountErrorBanner";
import type { ManagedEntity } from "./ManageOnFindmiList";
import NavIcon from "@/components/NavIcon";
import type { NavIconKey } from "@/lib/navigation";
import Greeting from "./business/[id]/v2/Greeting";
import { Chip } from "./owner-ui";

export const metadata: Metadata = {
  title: "My Findmi",
  robots: { index: false },
};
// Authenticated, per-user content — must never be statically or
// ISR-cached; every response here is specific to whoever is signed in.
export const dynamic = "force-dynamic";

/** Personal Home V2 caps — Home summarizes; each See All destination
 * holds the depth. */
const COMING_UP_LIMIT = 6;
const UPCOMING_FETCH_LIMIT = 24;
const WORLD_LIMIT = 8;
const MANAGING_PREVIEW = 3;

/** Horizontal rail on phones (scrolling through to the screen edge,
 * snap-scrolling), a modest grid on desktop where the content column has
 * room. The scroll-padding matches the page gutter so the snap resting
 * position puts the first card on the same left line as the headings,
 * not flush against the viewport edge. */
const RAIL_CLASS =
  "-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:grid lg:scroll-px-0 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden";

type WorldTile = {
  key: string;
  kind: "business" | "product" | "event" | "location";
  name: string;
  imageUrl: string | null;
  href: string;
  relatedAt: string;
};

const WORLD_KIND_LABEL: Record<WorldTile["kind"], string> = {
  business: "Business",
  product: "Product",
  event: "Event",
  location: "Location",
};

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
 * Personal Home V2 — the living front door to this person's Findmi
 * world, not an operational dashboard. Identity lives once, in the
 * shell's Account Context trigger; Business context (public page, share,
 * workspace) lives behind that switcher. Content earns space: DOM order
 * is the priority order at every width — Coming Up -> Recent Moments ->
 * My World -> Needs Your Attention -> Inbox -> Managing -> Pending
 * Claims — and every section renders only when it has real content. A
 * person with nothing yet gets ONE "Start Your World" starter instead of
 * a stack of empty modules. */
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
    // see getPersonalUpcoming's own doc comment). Feeds both My World and
    // the Personal Upcoming (Coming Up) query below.
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

  // Personal Home V2 — every read below depends only on the first batch
  // above, never on each other, so they run together instead of one after
  // another. Same helpers, same arguments, same results; a rejection still
  // fails the page exactly as each sequential await did before.
  //
  // - Pro set: plan_tier isn't in the public column grant (see
  //   getProBusinessIdSet's own comment).
  // - Conversations: excludes 'opportunity'-subject_type Conversations
  //   (that interaction already has a structured representation under
  //   Needs Your Attention/Opportunities); passes the managed-entity ids
  //   this page already fetched so listConversationsForUser skips its own
  //   re-fetch of the membership tables.
  // - Command center: only `attention` is used on Home; the management
  //   schedule stays at /account/schedule.
  // - Personal Upcoming: sourced ONLY from real account-bound Saves/
  //   Follows (see getPersonalUpcoming's own doc comment). Fetched wider
  //   than the rail shows so the per-Event collapse below still fills it.
  // - Recent Moments: the owner's own 3 latest Journal entries (bounded —
  //   media/signing only for those 3).
  const [proBusinessIds, allConversations, commandCenter, upcomingRaw, recentMoments] = await Promise.all([
    getProBusinessIdSet(admin, businessIds),
    admin ? listConversationsForUser(admin, user.id, { businesses: myBusinesses, events: myEvents, locations: myLocations }) : Promise.resolve([]),
    admin
      ? getAccountCommandCenter(admin, {
          businesses: myBusinesses,
          events: myEvents,
          locations: myLocations,
          pendingClaimsCount: myPendingClaims.length,
        })
      : Promise.resolve({ attention: [] as AttentionItem[] }),
    getPersonalUpcoming(
      {
        savedEvents: personalGraph.savedEvents.map((e) => ({ id: e.id, slug: e.slug, name: e.name, startAt: e.startAt, endAt: e.endAt, imageUrl: e.imageUrl })),
        followedBusinesses: personalGraph.followedBusinesses.map((b) => ({ id: b.id, slug: b.slug, name: b.name, imageUrl: b.imageUrl })),
        followedEvents: personalGraph.followedEvents.map((e) => ({ id: e.id, slug: e.slug, name: e.name, startAt: e.startAt, endAt: e.endAt, imageUrl: e.imageUrl })),
        followedLocations: personalGraph.followedLocations.map((l) => ({ id: l.id, name: l.name })),
      },
      UPCOMING_FETCH_LIMIT
    ),
    getJournalArchiveEntries(user.id, { limit: 3 }),
  ]);

  const conversations = allConversations.filter((c) => c.subjectType !== "opportunity");
  const inboxPreview = conversations.slice(0, 3);

  const attentionItems = commandCenter.attention;
  // Split by the category getAccountCommandCenter already classified each
  // item into — Action Required always first; each subsection only when
  // it has items.
  const actionRequiredItems = attentionItems.filter((i) => i.category === "action_required");
  const awaitingApprovalItems = attentionItems.filter((i) => i.category === "awaiting_approval");
  const hasUpdates = actionRequiredItems.length > 0 || awaitingApprovalItems.length > 0;

  // Coming Up — page-level collapse so one multi-date Event (or a followed
  // Business's run of dates at one Event) can't monopolize the rail: one
  // card per destination+title, keeping its earliest (live-first, since
  // the helper already sorts by start) date and merging every
  // relationship label that reached it. The shared helper is untouched.
  const comingUp: PersonalUpcomingItem[] = [];
  const comingUpByGroup = new Map<string, PersonalUpcomingItem>();
  for (const item of upcomingRaw) {
    const group = `${item.href}|${item.title}`;
    const existing = comingUpByGroup.get(group);
    if (existing) {
      for (const label of item.relatedTo) if (!existing.relatedTo.includes(label)) existing.relatedTo.push(label);
      continue;
    }
    const copy = { ...item, relatedTo: [...item.relatedTo] };
    comingUpByGroup.set(group, copy);
    comingUp.push(copy);
  }
  const comingUpCards = comingUp.slice(0, COMING_UP_LIMIT);

  // My World — this person's real Saves/Follows across every supported
  // entity type, newest relationship first. An entity both Saved and
  // Followed appears once (keyed by entity type + id, keeping its most
  // recent relationship), each tile linking to its public page.
  const worldByEntity = new Map<string, WorldTile>();
  const addWorld = (refs: PersonalEntityRef[], kind: WorldTile["kind"], hrefFor: (r: PersonalEntityRef) => string) => {
    for (const r of refs) {
      const key = `${kind}:${r.id}`;
      const existing = worldByEntity.get(key);
      if (existing && existing.relatedAt >= r.relatedAt) continue;
      worldByEntity.set(key, { key, kind, name: r.name, imageUrl: r.imageUrl, href: hrefFor(r), relatedAt: r.relatedAt });
    }
  };
  addWorld(personalGraph.savedBusinesses, "business", (r) => `/business/${r.slug}`);
  addWorld(personalGraph.followedBusinesses, "business", (r) => `/business/${r.slug}`);
  addWorld(personalGraph.savedProducts, "product", (r) => `/product/${r.slug}`);
  addWorld(personalGraph.savedEvents, "event", (r) => `/event/${r.slug}`);
  addWorld(personalGraph.followedEvents, "event", (r) => `/event/${r.slug}`);
  addWorld(personalGraph.savedLocations, "location", (r) => `/location/${r.slug}`);
  addWorld(personalGraph.followedLocations, "location", (r) => `/location/${r.slug}`);
  const worldTiles = [...worldByEntity.values()]
    .sort((a, b) => (a.relatedAt < b.relatedAt ? 1 : a.relatedAt > b.relatedAt ? -1 : 0))
    .slice(0, WORLD_LIMIT);

  // Managing — secondary on Personal Home. The Account Context Switcher is
  // already the primary way into each Business, but it doesn't represent
  // standalone managed Events/Locations, so those lead the compact
  // preview here. imageUrl precedence unchanged: a small management row
  // reads a logo more clearly than a wide cover (Events have no logo).
  const managedEntities: ManagedEntity[] = [
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
        cta: b.pendingReview ? "Finish Your Business" : "Open Workspace",
        imageUrl: b.logoUrl ?? b.coverImageUrl,
      })
    ),
  ];
  const hasAnyManaged = managedEntities.length > 0;

  // New user: nothing personal, nothing to manage, nothing waiting — one
  // intentional starter instead of a page of empty modules.
  const isNewWorld =
    comingUpCards.length === 0 &&
    recentMoments.length === 0 &&
    worldTiles.length === 0 &&
    !hasUpdates &&
    inboxPreview.length === 0 &&
    !hasAnyManaged &&
    myPendingClaims.length === 0;

  return (
    <PersonalAppShell displayName={profile?.display_name ?? null}>
      <AccountSync />

      {/* Identity is the shell's Account Context trigger — the greeting
          doesn't repeat the name. */}
      {/* Warm, not a page title: the shared Business V2 Greeting is restyled
          here (smaller, calmer) without changing that component. */}
      <header className="[&>h1]:text-page-title [&>h1]:font-semibold [&>h1]:text-secondary">
        <Greeting />
      </header>

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

      <div className="mt-5 flex flex-col gap-7">
        {isNewWorld && (
          <section aria-labelledby="start-your-world" className="rounded-3xl bg-findmi-50 px-5 py-6 sm:px-7 sm:py-8">
            <h2 id="start-your-world" className="font-display text-section-title-lg font-bold text-primary">
              Start Your World
            </h2>
            <p className="mt-1.5 max-w-md text-body text-secondary">
              Save the Brands, Products, Places and Events you want to keep up with. They&rsquo;ll show up here.
            </p>
            <Link
              href="/find"
              className="mt-5 inline-flex h-11 items-center gap-1.5 rounded-xl bg-findmi px-5 text-button font-bold text-white transition hover:bg-findmi-600"
            >
              Explore Findmi
              <ChevronIcon direction="right" className="h-4 w-4" />
            </Link>
          </section>
        )}

        {comingUpCards.length > 0 && (
          <HomeSection id="coming-up" title="Coming Up" href="/my-world" linkLabel="See All">
            <div className={RAIL_CLASS + " lg:grid-cols-3"}>
              {comingUpCards.map((item) => (
                <ScheduleCard key={item.key} item={item} />
              ))}
            </div>
          </HomeSection>
        )}

        {recentMoments.length > 0 && (
          <HomeSection id="recent-moments" title="Recent Moments" href="/my-world/journal" linkLabel="See All">
            <div className="flex flex-col gap-2.5">
              {recentMoments.map((entry) => (
                <JournalArchiveCard key={entry.id} entry={entry} />
              ))}
            </div>
          </HomeSection>
        )}

        {worldTiles.length > 0 && (
          <HomeSection id="my-world" title="My World" href="/my-world" linkLabel="See All">
            <div className={RAIL_CLASS + " lg:grid-cols-4"}>
              {worldTiles.map((tile) => (
                <WorldTileCard key={tile.key} tile={tile} />
              ))}
            </div>
          </HomeSection>
        )}

        {/* Needs Your Attention — unchanged data/logic (getAccountCommandCenter)
            and urgency semantics; only when there's something genuinely
            requiring or awaiting action. Follows the personal content. */}
        {hasUpdates && (
          <HomeSection
            id="needs-attention"
            title="Needs Your Attention"
            trailing={<Chip tone="amber">{actionRequiredItems.length + awaitingApprovalItems.length}</Chip>}
          >
            <div className="flex flex-col gap-3 rounded-xl bg-black/[0.025] p-3.5">
              {actionRequiredItems.length > 0 && (
                <UpdateSubsection label="Action Required" items={actionRequiredItems} countClassName="bg-red-50 text-red-700" />
              )}
              {awaitingApprovalItems.length > 0 && (
                <UpdateSubsection label="Awaiting Approval" items={awaitingApprovalItems} countClassName="bg-findmi-50 text-findmi-700" />
              )}
            </div>
          </HomeSection>
        )}

        {/* Inbox — unchanged data (listConversationsForUser); only when there
            is at least one conversation. No unread state exists. */}
        {inboxPreview.length > 0 && (
          <HomeSection id="inbox" title="Inbox" href="/account/messages" linkLabel="See All">
            <div className="flex flex-col gap-1">
              {inboxPreview.map((c) => (
                <Link
                  key={c.id}
                  href={`/account/messages/${c.id}`}
                  className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-black/[0.03]"
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
          </HomeSection>
        )}

        {/* Managing — a secondary utility list (not cards): up to 3 rows,
            the rest behind a native View All disclosure. Only when this
            person manages something. */}
        {hasAnyManaged && (
          <HomeSection id="managing" title="Managing">
            <div className="divide-y divide-black/[0.06]">
              {managedEntities.slice(0, MANAGING_PREVIEW).map((entity) => (
                <ManagedRow key={`${entity.kind}-${entity.id}`} entity={entity} />
              ))}
            </div>
            {managedEntities.length > MANAGING_PREVIEW && (
              <details className="group">
                <summary className="flex w-fit cursor-pointer list-none items-center gap-1 py-2 text-metadata font-semibold text-accent hover:underline [&::-webkit-details-marker]:hidden">
                  <span className="group-open:hidden">View All ({managedEntities.length})</span>
                  <span className="hidden group-open:inline">Show Less</span>
                  <ChevronIcon direction="down" className="h-3 w-3 transition-transform group-open:rotate-180" />
                </summary>
                <div className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
                  {managedEntities.slice(MANAGING_PREVIEW).map((entity) => (
                    <ManagedRow key={`${entity.kind}-${entity.id}`} entity={entity} />
                  ))}
                </div>
              </details>
            )}
          </HomeSection>
        )}

        {myPendingClaims.length > 0 && (
          <HomeSection id="pending-claims" title="Pending Claims">
            <div className="flex flex-col gap-3 sm:grid sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
              {myPendingClaims.map((c) => (
                <div key={c.id} className="flex flex-col gap-3 rounded-2xl border border-findmi/20 bg-findmi-50/50 p-4">
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
          </HomeSection>
        )}
      </div>

      {/* Footer utilities — compact rows, unchanged destinations. The Explore
          row is omitted only while Start Your World already offers it. */}
      <div className="mt-8 divide-y divide-black/[0.06] border-t border-black/[0.06]">
        {!isNewWorld && (
          <Link href="/find" className="flex items-center justify-between gap-3 py-3 text-body font-semibold text-secondary transition hover:text-primary">
            Explore What&rsquo;s Happening On Findmi
            <ChevronIcon direction="right" className="h-4 w-4 shrink-0 text-ink/30" />
          </Link>
        )}
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 text-body font-semibold text-secondary transition hover:text-primary [&::-webkit-details-marker]:hidden">
            Redeem Invite Code
            <ChevronIcon direction="down" className="h-4 w-4 shrink-0 text-ink/30 transition-transform group-open:rotate-180" />
          </summary>
          <form action={goToRedeemCode} className="mb-3 flex max-w-sm flex-col gap-2 sm:flex-row">
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
    </PersonalAppShell>
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
 * concatenated into one truncating sentence). Both lines wrap rather than
 * truncate, so a real long name stays fully readable. Every current
 * source always carries a real, useful href (see dashboard.ts's own push
 * sites), so every row stays tappable with its chevron. */
function UpdateRow({ item }: { item: AttentionItem }) {
  return (
    <Link href={item.href} className="flex items-start gap-3 rounded-xl px-2 py-1.5 transition hover:bg-black/[0.03]">
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold text-primary">{item.title}</span>
        {item.subtitle && <span className="mt-0.5 block text-metadata text-muted">{item.subtitle}</span>}
      </span>
      <ChevronIcon direction="right" className="mt-0.5 h-4 w-4 shrink-0 text-ink/30" />
    </Link>
  );
}

/** Personal Home V2 — one section on the open page canvas: a display
 * title, an optional See All (shared chevron) or trailing element, then
 * its content. No bordered card around every section. */
function HomeSection({
  id,
  title,
  href,
  linkLabel,
  trailing,
  children,
}: {
  id: string;
  title: string;
  href?: string;
  linkLabel?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="min-w-0 truncate font-display text-section-title font-bold text-primary">
          {title}
        </h2>
        {href && linkLabel ? (
          <Link href={href} className="flex shrink-0 items-center gap-1 text-metadata font-semibold text-accent hover:underline">
            {linkLabel}
            <ChevronIcon direction="right" className="h-3 w-3" />
          </Link>
        ) : (
          trailing
        )}
      </div>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

/** Coming Up card — image-first, built local to this page rather than
 * importing AppearanceFeedCard/CompactCard (consumer-discovery components
 * that fire entity_impression/entity_click analytics, which Home must
 * never do). Live state reuses getTemporalLabel (the one source of truth
 * for HERE NOW) with the restrained glass + glowing-dot treatment. */
function ScheduleCard({ item }: { item: PersonalUpcomingItem }) {
  const { label, live } = getTemporalLabel(item.startAt, item.endAt);
  const when = live
    ? item.endAt
      ? `Until ${formatTime(item.endAt)}`
      : null
    : `${label} · ${formatTime(item.startAt)}`;
  const context = item.where ?? (item.relatedTo.length > 0 ? item.relatedTo.join(" · ") : null);
  return (
    <Link href={item.href} className="group flex w-[172px] shrink-0 snap-start flex-col gap-1.5 lg:w-auto">
      <div className="relative aspect-[3/2] w-full overflow-hidden rounded-2xl bg-black/[0.04]">
        {item.imageUrl ? (
          <SupabaseImage
            src={item.imageUrl}
            alt=""
            fill
            sizes="(min-width: 1024px) 240px, 172px"
            className="object-cover transition duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <PlaceFallbackGlyph className="h-7 w-7 text-black/15" />
          </div>
        )}
        {live && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/35 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-md">
            <LiveDot className="animate-happening-now-glow rounded-full text-red-500" />
            {label}
          </span>
        )}
      </div>
      <div className="min-w-0 px-0.5">
        {when && <p className="truncate text-label font-bold uppercase text-accent">{when}</p>}
        <p className="mt-0.5 line-clamp-2 text-body font-semibold leading-snug text-primary">{item.title}</p>
        {context && <p className="mt-0.5 truncate text-metadata text-muted">{context}</p>}
      </div>
    </Link>
  );
}

function PlaceFallbackGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
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

/** My World tile — a real image, the entity's real name and what kind of
 * thing it is, linking straight to its own public page. */
function WorldTileCard({ tile }: { tile: WorldTile }) {
  return (
    <Link href={tile.href} className="group flex w-[116px] shrink-0 snap-start flex-col gap-2 lg:w-auto">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-black/[0.05] bg-black/[0.04]">
        {tile.imageUrl ? (
          <SupabaseImage
            src={tile.imageUrl}
            alt=""
            fill
            sizes="(min-width: 1024px) 180px, 116px"
            className="object-cover transition duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <PlaceFallbackGlyph className="h-6 w-6 text-black/15" />
          </div>
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-metadata font-bold text-primary">{tile.name}</p>
        <p className="truncate text-microcopy text-subtle">{WORLD_KIND_LABEL[tile.kind]}</p>
      </div>
    </Link>
  );
}

const MANAGED_ICON: Record<ManagedEntity["kind"], NavIconKey> = { business: "storefront", event: "calendar", location: "pin" };
const MANAGED_TYPE_LABEL: Record<ManagedEntity["kind"], string> = { business: "Business", event: "Event", location: "Location" };

/** Managing row — a compact utility row: small image (or the entity
 * type's icon), name, restrained type/status metadata, chevron. The whole
 * row is the link; no per-row CTA label. */
function ManagedRow({ entity }: { entity: ManagedEntity }) {
  const pills = entity.pills.filter((p): p is { label: string; tone: "warning" | "pro" } => Boolean(p));
  return (
    <Link href={entity.href} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-black/[0.03]">
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-findmi-50 text-findmi-700">
        {entity.imageUrl ? (
          <SupabaseImage src={entity.imageUrl} alt="" fill sizes="36px" className="object-cover" />
        ) : (
          <NavIcon name={MANAGED_ICON[entity.kind]} className="h-4 w-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-primary">{entity.name}</p>
        <p className="truncate text-metadata text-subtle">
          {MANAGED_TYPE_LABEL[entity.kind]}
          {pills.map((p) => (
            <span key={p.label} className={p.tone === "warning" ? "text-amber-700" : "font-semibold text-accent"}>
              {" · "}
              {p.label}
            </span>
          ))}
        </p>
      </div>
      <ChevronIcon direction="right" className="h-4 w-4 shrink-0 text-ink/30" />
    </Link>
  );
}
