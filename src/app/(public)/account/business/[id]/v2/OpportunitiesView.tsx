import Link from "next/link";
import type { ReactNode } from "react";
import type { BusinessOpportunityItem, ExploreItem } from "@/lib/opportunity-listings";
import type { BusinessGoal } from "@/lib/opportunity-goals";
import {
  EXPLORE_TIMINGS,
  EXPLORE_TIMING_LABELS,
  OPPORTUNITY_TYPES,
  OPPORTUNITY_TYPE_LABELS,
  type ExploreFilters,
} from "@/lib/opportunity-listings-domain";
import { PARTICIPATION_COST_FILTERS, PARTICIPATION_COST_FILTER_LABELS } from "@/lib/opportunity-participation-cost";
import {
  GOAL_BUDGET,
  GOAL_INTEREST_LABELS,
  GOAL_OBJECTIVE_LABELS,
  GOAL_STATUS_LABELS,
  GOAL_STATUS_TRANSITIONS,
  formatGoalTiming,
  goalTransitionLabel,
} from "@/lib/opportunity-goals-domain";
import BusinessOpportunityCard, { OpportunityCard } from "@/components/opportunities/BusinessOpportunityCard";
import { changeGoalStatus } from "../opportunities/actions";
import { GoalGlyph } from "@/components/opportunities/OpportunityGlyphs";

export const OPPORTUNITY_VIEWS = ["for-you", "explore", "yours", "goals"] as const;
export type OpportunityView = (typeof OPPORTUNITY_VIEWS)[number];

const VIEW_LABELS: Record<OpportunityView, string> = {
  "for-you": "For You",
  explore: "Explore",
  yours: "Your Opportunities",
  goals: "Your Goals",
};

const inputClass =
  "h-10 w-full min-w-0 rounded-xl border border-black/10 bg-white px-3 text-[15px] text-primary placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

/** Opportunities Cleanup Pass A — commercial Opportunities ONLY, in four
 * views (For You · Explore · Your Opportunities · Your Goals). The separate
 * Event-participation workflow (Event Invitations & Applications) used to
 * be embedded below these, but commercial Opportunities and Event
 * participation are now intentionally kept apart at the terminology and
 * navigation layer: Event invitations/applications are managed from the
 * Inbox (/account/messages?filter=opportunities — route/query value
 * unchanged, only its label is no longer "Opportunities") and from the
 * Event's own participants screen. Nothing about the Event-participation
 * data model changed; this view simply no longer renders it. */
export default function OpportunitiesView({
  basePath,
  businessId,
  view,
  recommended,
  explore,
  filters,
  goals,
  canManage,
  manageNote,
  notice,
}: {
  basePath: string;
  businessId: string;
  view: OpportunityView;
  recommended: { active: BusinessOpportunityItem[]; past: BusinessOpportunityItem[] };
  explore: { available: boolean; items: ExploreItem[] } | null;
  filters: ExploreFilters;
  goals: { available: boolean; goals: BusinessGoal[] } | null;
  canManage: boolean;
  manageNote: string | null;
  notice: string | null;
}) {
  const all = [...recommended.active, ...recommended.past];
  const forYou = all.filter((i) => i.view.group === "for_you");
  const interested = all.filter((i) => i.view.group === "interested");
  const confirmed = all.filter((i) => i.view.group === "confirmed");
  const past = all.filter((i) => i.view.group === "past");
  const hrefFor = (item: BusinessOpportunityItem) => `${basePath}/opportunities/${item.view.recipientId}`;
  const viewHref = (v: OpportunityView) => `${basePath}?tab=opportunities&view=${v}`;
  const tabBadges: Partial<Record<OpportunityView, number>> = { "for-you": forYou.length, yours: interested.length + confirmed.length };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-display text-page-title-lg font-bold text-primary">Opportunities</h1>
        <p className="mt-1 text-body text-muted">Opportunities Findmi recommends for your Business, and ways to find more.</p>
      </div>

      <nav aria-label="Opportunities" className="flex flex-wrap gap-1.5">
        {OPPORTUNITY_VIEWS.map((v) => {
          const active = v === view;
          return (
            <Link
              key={v}
              href={viewHref(v)}
              aria-current={active ? "page" : undefined}
              className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-metadata font-semibold transition ${
                active ? "border-ink bg-ink text-white" : "border-black/10 bg-white text-secondary hover:border-black/20"
              }`}
            >
              {VIEW_LABELS[v]}
              {(tabBadges[v] ?? 0) > 0 && (
                <span className={`rounded-full px-1.5 text-[11px] font-bold ${active ? "bg-white/20 text-white" : "bg-findmi-50 text-findmi-700"}`}>{tabBadges[v]}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {notice && <p className="rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-findmi-700">{notice}</p>}

      {view === "for-you" && (
        <section aria-labelledby="for-you-heading" className="flex flex-col gap-3">
          <SectionHeading id="for-you-heading" title="Recommended For You" copy="Opportunities Findmi selected for your Business." />
          {forYou.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {forYou.map((item) => (
                <BusinessOpportunityCard key={item.view.recipientId} item={item.view} place={item.place} href={hrefFor(item)} commercialOptions={item.options} />
              ))}
            </div>
          ) : (
            <GrowPanel
              basePath={basePath}
              title="No new recommendations right now"
              copy="Explore what's available, or tell Findmi what your Business is looking for — our team can match you with the right Opportunities."
            />
          )}
        </section>
      )}

      {view === "explore" && (
        <section aria-labelledby="explore-heading" className="flex flex-col gap-3">
          <SectionHeading id="explore-heading" title="Explore" copy="Open Opportunities any Business can discover." />
          <form method="get" action={basePath} className="flex flex-col gap-2 rounded-2xl border border-black/[0.07] bg-white p-3">
            <input type="hidden" name="tab" value="opportunities" />
            <input type="hidden" name="view" value="explore" />
            <input type="search" name="q" defaultValue={filters.q ?? ""} placeholder="Search Opportunities" aria-label="Search Opportunities" className={inputClass} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <select name="type" defaultValue={filters.type ?? ""} aria-label="Type" className={inputClass}>
                <option value="">All Types</option>
                {OPPORTUNITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {OPPORTUNITY_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <input type="text" name="where" defaultValue={filters.where ?? ""} placeholder="Market or Location" aria-label="Market or Location" className={inputClass} />
              <select name="timing" defaultValue={filters.timing ?? ""} aria-label="Timing" className={inputClass}>
                <option value="">Any Timing</option>
                {EXPLORE_TIMINGS.map((t) => (
                  <option key={t} value={t}>
                    {EXPLORE_TIMING_LABELS[t]}
                  </option>
                ))}
              </select>
              <select name="participationCost" defaultValue={filters.participationCost ?? ""} aria-label="Participation Cost" className={inputClass}>
                <option value="">Any Participation Cost</option>
                {PARTICIPATION_COST_FILTERS.map((p) => (
                  <option key={p} value={p}>
                    {PARTICIPATION_COST_FILTER_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <button type="submit" className="flex h-10 items-center rounded-xl bg-ink px-4 text-button font-bold text-white transition hover:bg-ink/85">
                Search
              </button>
              {(filters.q || filters.type || filters.where || filters.timing || filters.participationCost) && (
                <Link href={viewHref("explore")} className="text-metadata font-semibold text-accent hover:underline">
                  Clear Filters
                </Link>
              )}
            </div>
          </form>
          {explore && explore.items.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {explore.items.map((item) => (
                <OpportunityCard
                  key={item.listingId}
                  o={item.opportunity}
                  place={item.place}
                  href={item.linkedRecipientId ? `${basePath}/opportunities/${item.linkedRecipientId}` : `${basePath}/opportunities/explore/${item.listingId}`}
                  prominent={!item.linkedRecipientId}
                  commercialOptions={item.options}
                  badge={
                    item.linkedRecipientId ? (
                      <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/55">In Your Opportunities</span>
                    ) : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <GrowPanel
              basePath={basePath}
              hideExplore
              title={filters.q || filters.type || filters.where || filters.timing || filters.participationCost ? "No Opportunities match those filters" : "No Opportunities to explore right now"}
              copy="Tell Findmi what your Business is looking for, and our team can help match you with the right Opportunities."
            />
          )}
        </section>
      )}

      {view === "yours" && (
        <section aria-labelledby="yours-heading" className="flex flex-col gap-5">
          <SectionHeading id="yours-heading" title="Your Opportunities" copy="Opportunities you're pursuing with Findmi." />
          {interested.length + confirmed.length + past.length === 0 && (
            <p className="rounded-2xl border border-dashed border-black/12 bg-white px-4 py-5 text-center text-metadata text-muted">
              When you&rsquo;re interested in an Opportunity, it shows up here.
            </p>
          )}
          <CardGroup title="Confirmed" items={confirmed} hrefFor={hrefFor} />
          <CardGroup title="Interested" items={interested} hrefFor={hrefFor} />
          <CardGroup title="Completed & Past" items={past} hrefFor={hrefFor} />
        </section>
      )}

      {view === "goals" && (
        <section aria-labelledby="goals-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionHeading
              id="goals-heading"
              title="Your Goals"
              copy="Your Goals help the Findmi team understand the opportunities, places, partnerships, and experiences you're looking for."
            />
            {canManage && goals?.available && (
              <Link href={`${basePath}/opportunities/goals/new`} className="flex h-10 shrink-0 items-center rounded-xl bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600">
                + Add Goal
              </Link>
            )}
          </div>
          {manageNote && <p className="text-metadata text-muted">{manageNote}</p>}
          {!goals?.available ? (
            <p className="rounded-2xl border border-dashed border-black/12 bg-white px-4 py-5 text-center text-metadata text-muted">Goals aren&rsquo;t available yet. Check back soon.</p>
          ) : goals.goals.length === 0 ? (
            <div className="rounded-2xl border border-black/[0.07] bg-white p-5 text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">
                <GoalGlyph className="h-5 w-5" />
              </span>
              <p className="mt-2 text-card-title font-semibold text-primary">Tell Findmi what you need</p>
              <p className="mx-auto mt-1 max-w-sm text-metadata text-muted">Your Goals help the Findmi team understand what you&rsquo;re looking for, so we can recommend the right Opportunities.</p>
              {canManage && (
                <Link href={`${basePath}/opportunities/goals/new`} className="mx-auto mt-3 flex h-10 w-fit items-center rounded-xl bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600">
                  Share Your Goals
                </Link>
              )}
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {goals.goals.map((g) => (
                <GoalCard key={g.id} goal={g} businessId={businessId} basePath={basePath} canManage={canManage} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function SectionHeading({ id, title, copy }: { id: string; title: string; copy: string }) {
  return (
    <div className="min-w-0">
      <h2 id={id} className="text-section-title font-bold text-primary">
        {title}
      </h2>
      <p className="mt-0.5 text-metadata text-muted">{copy}</p>
    </div>
  );
}

function CardGroup({ title, items, hrefFor }: { title: string; items: BusinessOpportunityItem[]; hrefFor: (i: BusinessOpportunityItem) => string }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-label font-bold uppercase text-subtle">
        {title} ({items.length})
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <BusinessOpportunityCard key={item.view.recipientId} item={item.view} place={item.place} href={hrefFor(item)} commercialOptions={item.options} />
        ))}
      </div>
    </div>
  );
}

/** Productive empty state: Explore + Tell Findmi Your Goals. */
export function GrowPanel({ basePath, title, copy, hideExplore }: { basePath: string; title: string; copy: string; hideExplore?: boolean }) {
  return (
    <div className="rounded-2xl border border-black/[0.07] bg-white p-4">
      <p className="text-card-title font-semibold text-primary">{title}</p>
      <p className="mt-1 text-metadata text-muted">{copy}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {!hideExplore && (
          <Link href={`${basePath}?tab=opportunities&view=explore`} className="flex h-10 items-center rounded-xl bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600">
            Browse Opportunities
          </Link>
        )}
        <Link
          href={`${basePath}/opportunities/goals/new`}
          className="flex h-10 items-center rounded-xl border border-black/10 bg-white px-4 text-button font-semibold text-primary transition hover:border-black/20"
        >
          Tell Findmi Your Goals
        </Link>
      </div>
    </div>
  );
}

function Facet({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="mt-0.5 break-words text-metadata text-secondary">{children}</dd>
    </div>
  );
}

function GoalCard({ goal: g, businessId, basePath, canManage }: { goal: BusinessGoal; businessId: string; basePath: string; canManage: boolean }) {
  const where = [...g.markets, g.markets_text].filter(Boolean).join(" · ");
  return (
    <li className={`rounded-2xl border border-black/[0.08] bg-white p-4 ${g.status === "active" ? "" : "opacity-80"}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words text-card-title font-semibold text-primary">{g.title}</h3>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            g.status === "active" ? "bg-findmi-50 text-findmi-700" : "bg-black/[0.05] text-ink/50"
          }`}
        >
          {GOAL_STATUS_LABELS[g.status]}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {g.objectives.map((o) => (
          <span key={o} className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[11px] font-semibold text-secondary">
            {GOAL_OBJECTIVE_LABELS[o]}
          </span>
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        <Facet label="Interested In">{g.opportunity_interests.map((i) => GOAL_INTEREST_LABELS[i]).join(", ")}</Facet>
        <Facet label="Where">{where || "Anywhere"}</Facet>
        <Facet label="Budget">{GOAL_BUDGET[g.budget_band].label}</Facet>
        <Facet label="When">{formatGoalTiming(g)}</Facet>
        {g.audience_text && (
          <div className="col-span-2">
            <Facet label="Audience">{g.audience_text}</Facet>
          </div>
        )}
      </dl>
      {canManage && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/5 pt-3">
          <Link href={`${basePath}/opportunities/goals/${g.id}/edit`} className="flex h-9 items-center rounded-lg border border-black/10 px-3 text-metadata font-semibold text-primary transition hover:border-black/20">
            Edit Goal
          </Link>
          {GOAL_STATUS_TRANSITIONS[g.status].map((to) => (
            <form key={to} action={changeGoalStatus.bind(null, businessId, g.id, to)}>
              <button type="submit" className="flex h-9 items-center rounded-lg px-2.5 text-metadata font-semibold text-muted transition hover:text-primary">
                {goalTransitionLabel(g.status, to)}
              </button>
            </form>
          ))}
        </div>
      )}
    </li>
  );
}
