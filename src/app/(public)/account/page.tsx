import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { listConversationsForUser } from "@/lib/opportunities";
import { conversationContextLabel } from "@/lib/admin/conversations";
import { getAccountCommandCenter } from "@/lib/dashboard";
import { getTemporalLabel, formatDateShort } from "@/lib/format";
import { getPublicOrigin } from "@/lib/site-url";
import LiveDot from "@/components/LiveDot";
import ShareButton from "@/components/ShareButton";
import { goToRedeemCode } from "@/app/(public)/redeem/actions";
import AccountSync from "./AccountSync";
import AccountNav from "./AccountNav";
import BusinessScopedAction, { PlusGlyph } from "./BusinessScopedAction";
import ManageOnFindmiList, { type ManagedEntity } from "./ManageOnFindmiList";

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

/** Launch V2 Pass 1 — refocuses Home around the Launch UX audit's own
 * three questions (Where am I going? What needs me? What do customers
 * see?), in that order, ahead of anything else. Same account model, same
 * tables, same routes as before (nothing here is a new query beyond the
 * existing getAccountCommandCenter/listConversationsForUser calls this
 * page already made) — what changed is which of the OLD page's 13
 * sections survive, and in what order. Removed entirely: the standalone
 * Messages shortcut (superseded by the Inbox preview below), the full
 * Coming Up list (consolidated into one NEXT UP item — the complete
 * schedule now lives at /account/schedule), the duplicate large Findmi
 * Here CTA card, the "What's the difference?" explainer, and the Your
 * Activity utility-tile row (Saved/Following/Orders/Profile now live in
 * AccountNav's own "More" menu; Messages is now Inbox). Demoted (kept,
 * moved lower, made visually secondary): Manage on Findmi, Pending
 * Claims, Discover, Redeem invite code. See this pass's own report for
 * the full before/after list. */
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
    supabase.from("business_members").select("business_id, businesses(name, slug, publication_status)").eq("user_id", user.id),
    supabase
      .from("business_claim_requests")
      .select("id, business_id, businesses(name, slug)")
      .eq("user_id", user.id)
      .eq("status", "pending"),
    supabase.from("event_members").select("event_id, events(name, is_demo)").eq("user_id", user.id),
    supabase.from("location_members").select("location_id, locations(name, is_demo)").eq("user_id", user.id),
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
  const conversations = (admin ? await listConversationsForUser(admin, user.id) : []).filter((c) => c.subjectType !== "opportunity");
  const inboxPreview = conversations.slice(0, 3);

  const { attention: attentionItems, schedule: scheduleItems } = admin
    ? await getAccountCommandCenter(admin, {
        businesses: myBusinesses,
        events: myEvents,
        locations: myLocations,
        pendingClaimsCount: myPendingClaims.length,
      })
    : { attention: [], schedule: [] };
  const nextUp = scheduleItems[0] ?? null;

  const hasAnyManaged = myBusinesses.length > 0 || myEvents.length > 0 || myLocations.length > 0;

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
      <AccountNav />

      <header>
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Your Findmi</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">
          Welcome back{profile?.display_name ? `, ${profile.display_name}` : ""}
        </h1>
      </header>

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

      {/* A. BUSINESS CONTEXT — only rendered when there's an actual choice
          to orient the owner to (2+ managed businesses). One business
          doesn't need a card just to name itself. */}
      {myBusinesses.length > 1 && (
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {myBusinesses.map((b) => (
            <Link
              key={b.id}
              href={`/account/business/${b.id}`}
              className="shrink-0 rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-bold text-ink transition hover:border-findmi/40"
            >
              {b.name}
            </Link>
          ))}
        </div>
      )}

      {/* B. NEXT UP — the single most relevant upcoming happening, from
          the SAME deduplicated Command Center schedule data as before;
          the full chronological list now lives at /account/schedule. */}
      {nextUp ? (
        <section className="mt-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Next Up</h2>
          {(() => {
            const { label, live } = getTemporalLabel(nextUp.startAt, nextUp.endAt);
            return (
              <div className="mt-2 flex items-center gap-3 rounded-2xl border border-black/5 bg-white px-3.5 py-3 shadow-sm">
                <span
                  className={`flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl py-2 ${
                    live ? "animate-happening-now-glow bg-red-600 text-white" : "bg-black/[0.04] text-ink"
                  }`}
                >
                  {live ? (
                    <>
                      <LiveDot className="text-white" />
                      <span className="flex flex-col items-center leading-[1.15]">
                        <span className="text-[7px] font-bold uppercase tracking-normal">Happening</span>
                        <span className="text-xs font-extrabold uppercase tracking-wide">Now</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/50">
                        {new Date(nextUp.startAt).toLocaleDateString("en-US", { month: "short" })}
                      </span>
                      <span className="text-lg font-bold leading-none">{new Date(nextUp.startAt).getDate()}</span>
                    </>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{nextUp.title}</p>
                  {nextUp.where && <p className="truncate text-xs text-ink/50">{nextUp.where}</p>}
                  <p className="truncate text-[11px] text-ink/40">
                    {!live && `${label} · `}
                    {nextUp.relatedTo.join(" · ")}
                  </p>
                </div>
                <Link
                  href={nextUp.href}
                  className="shrink-0 rounded-full border border-black/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink transition hover:border-black/30"
                >
                  {/* Launch V2 Pass 1.1 — context-correct action label:
                      only a real owner Appearance is ever "edited" here;
                      an organized Event or a Location happening you don't
                      otherwise own gets its own real Manage/View
                      destination instead (same href precedence as
                      display fields — see ScheduleItem's own doc
                      comment). */}
                  {nextUp.actionKind === "business_appearance" ? "Edit" : nextUp.actionKind === "event" ? "Manage Event" : "View"}
                </Link>
              </div>
            );
          })()}
          <Link href="/account/schedule" className="mt-1.5 inline-block text-xs font-semibold text-findmi-700 underline underline-offset-2">
            View Schedule →
          </Link>
        </section>
      ) : (
        hasAnyManaged && (
          <section className="mt-4 rounded-2xl border border-black/10 bg-mist/30 p-4">
            <p className="text-sm font-bold text-ink">Nothing on your schedule yet.</p>
            <p className="mt-1 text-xs text-ink/60">Add where you&rsquo;ll be next so people can find you.</p>
          </section>
        )
      )}

      {/* C. PRIMARY CTA — the ONE dominant + Add Where I'll Be entry
          point on Home. Launch V2 Pass 1.1 — the small creation strip
          that used to sit directly beneath this (Business/Venue/Product/
          Event) is REMOVED per live QA: it competed with this action and
          added a second horizontal-scroll row. Those routes are still
          reachable, unchanged, from the site header's own global "+"
          (QuickCreateMenu) — nothing here deletes them, this just stops
          duplicating that entry point on Home. */}
      <div className="mt-3">
        <BusinessScopedAction
          variant="full"
          businesses={myBusinesses}
          tab="findmi-here"
          icon={<PlusGlyph className="h-4 w-4" />}
          label="+ Add Where I'll Be"
        />
      </div>

      {/* D. INBOX PREVIEW — Launch V2 Pass 1.1: moved ABOVE Needs Your
          Attention (live QA — "who contacted me" is more immediate than a
          generic count of the same conversations). 2–3 latest canonical
          Conversations, no full history load (listConversationsForUser
          already caps each conversation to its single latest message). */}
      <section className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Inbox</h2>
          <Link href="/account/messages" className="text-xs font-bold text-findmi-700 underline underline-offset-2">
            View Inbox →
          </Link>
        </div>
        {inboxPreview.length > 0 ? (
          <div className="mt-2 flex flex-col gap-1.5">
            {inboxPreview.map((c) => (
              <Link
                key={c.id}
                href={`/account/messages/${c.id}`}
                className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white px-3.5 py-3 shadow-sm transition hover:border-black/10"
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
          <p className="mt-2 rounded-2xl border border-black/5 bg-white p-4 text-sm text-ink/50">
            Your Findmi conversations will appear here.
          </p>
        )}
      </section>

      {/* E. NEEDS YOUR ATTENTION — Launch V2 Pass 1.1: the generic "N
          recent customer conversations" item is gone (see
          lib/dashboard.ts — getAccountCommandCenter no longer pushes it);
          the Inbox preview above already represents those conversations
          truthfully, without pretending a count implies "unread." Only
          genuinely operational/status items remain: pending invitations,
          pending Business/Event/Location review, pending claims, expired
          Pro. */}
      {attentionItems.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Needs Your Attention</h2>
          <div className="mt-2 flex flex-col gap-1.5">
            {attentionItems.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white px-3.5 py-3 shadow-sm transition hover:border-black/10"
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
        </section>
      )}

      {/* F. YOUR FINDMI — kept compact, only for the common single-
          business case (multi-business owners reach each business's own
          public page from that Business Manager instead — no new
          switcher invented for this). */}
      {myBusinesses.length === 1 && (
        <section className="mt-6 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Your Findmi</h2>
          <p className="mt-1 text-sm font-semibold text-ink">{myBusinesses[0].name}</p>
          <div className="mt-2.5 flex gap-2">
            <Link
              href={`/business/${myBusinesses[0].slug}`}
              className="flex h-9 flex-1 items-center justify-center rounded-full border border-black/10 text-xs font-bold text-ink transition hover:border-black/20"
            >
              View Public Page
            </Link>
            <ShareButton url={`${getPublicOrigin()}/business/${myBusinesses[0].slug}`} title={myBusinesses[0].name} />
          </div>
        </section>
      )}

      {/* Manage on Findmi — demoted: smaller heading, lower on the page,
          same list/component as before. */}
      {hasAnyManaged ? (
        <section className="mt-6">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Manage on Findmi</h2>
          <ManageOnFindmiList entities={managedEntities} />
        </section>
      ) : (
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

      {myPendingClaims.length > 0 && (
        <section id="pending-claims" className="mt-6">
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

      {/* Discover — demoted to one compact link (was a full white card +
          filled CTA + chip row). Still reaches the same /find surface. */}
      <div className="mt-6">
        <Link href="/find" className="text-xs font-semibold text-ink/50 underline underline-offset-2 hover:text-ink">
          Explore what&rsquo;s happening on Findmi →
        </Link>
      </div>

      {/* Redeem invite code — unchanged, kept last/secondary. */}
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

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
