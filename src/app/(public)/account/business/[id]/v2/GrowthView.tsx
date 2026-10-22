import Link from "next/link";
import ChevronIcon from "@/components/ChevronIcon";
import type { BusinessOpportunityItem } from "@/lib/opportunity-listings";
import type { BusinessIdea } from "@/lib/brand-audit";
import type { BusinessGoal } from "@/lib/opportunity-goals";
import { auditActionLabel, type AuditSummary } from "@/lib/brand-audit-domain";
import { summarizeGrowth, eligibleGrowthIdeas, unansweredIdeaCount, GROWTH_PROFILE_SECTIONS, GROWTH_SETUP_COPY, growthProfileSummary, type GrowthDestination, type GrowthProfileAnswers } from "@/lib/growth";
import type { ActionResult } from "../brand-audit/actions";
import GrowthNav from "./GrowthNav";
import IdeasForYourBrand from "./IdeasForYourBrand";
import { GoalsSection } from "./OpportunitiesView";

/** Derive the one Growth summary from the data the page already loads —
 * shared by Home (mini-dashboard), the hub navigation badges and the Growth
 * views, so they can never disagree. */
export function growthSummaryFor({
  audit,
  activeGoalCount,
  opportunityItems,
  ideas = [],
  targets = { total: 0, pursuing: 0 },
}: {
  audit: AuditSummary | null;
  activeGoalCount: number;
  opportunityItems: BusinessOpportunityItem[];
  ideas?: BusinessIdea[];
  /** Placement Targets (lib/business-placements.ts getPlacementPursuit). */
  targets?: { total: number; pursuing: number };
}) {
  const hasSignal = (audit?.goalCount ?? 0) + activeGoalCount > 0;
  const shown = eligibleGrowthIdeas(ideas, hasSignal);
  return summarizeGrowth({
    audit,
    activeGoalCount,
    matchesAwaitingResponse: opportunityItems.filter((i) => i.view.group === "for_you").length,
    matchesInProgress: opportunityItems.filter((i) => i.view.group === "confirmed" || i.view.group === "interested").length,
    ideasForYou: shown.length,
    ideasNew: unansweredIdeaCount(shown),
    targetsTotal: targets.total,
    targetsPursuing: targets.pursuing,
  });
}

/** Badges for the hub navigation (real counts; zero is omitted). */
export function growthBadges(summary: ReturnType<typeof growthSummaryFor>): Partial<Record<GrowthDestination, number>> {
  return { opportunities: summary.matchesAwaitingResponse, ideas: summary.ideasNew };
}

function Header({ basePath, summary, active = "goals" }: { basePath: string; summary: ReturnType<typeof growthSummaryFor>; active?: GrowthDestination }) {
  return (
    <>
      <header>
        <h1 className="font-display text-page-title sm:text-page-title-lg font-bold text-primary">Growth</h1>
        <p className="mt-1 text-body text-muted">Tell Findmi what you&rsquo;re looking for so we can surface more relevant opportunities.</p>
      </header>
      <GrowthNav basePath={basePath} active={active} badges={growthBadges(summary)} summary={summary} />
    </>
  );
}

/** Growth → Targets — the same Growth header and navigation above the SAME
 * Targets experience Findmi Here → Find Us Here → Targets shows (the page
 * renders <TargetsView> under it): one set of Placement records, two doors. */
export function GrowthTargetsHeader({ basePath, summary }: { basePath: string; summary: ReturnType<typeof growthSummaryFor> }) {
  return <Header basePath={basePath} summary={summary} active="targets" />;
}

/** Goals — the Growth Profile (what Findmi knows about what you want) and
 * your Opportunity goals, on one page. The Profile is a compact checklist,
 * not a stack of empty report cards: each Setup section is one row that
 * either shows what's set or invites you to add it. Everything links into
 * the existing Growth Setup flow (/brand-audit) and goal wizard. */
export function GrowthGoalsView({
  basePath,
  businessId,
  audit,
  profile,
  summary,
  goals,
  canManage,
  manageNote,
  notice,
}: {
  basePath: string;
  businessId: string;
  audit: AuditSummary | null;
  /** What the Business actually answered (compact line per section). */
  profile: GrowthProfileAnswers | null;
  summary: ReturnType<typeof growthSummaryFor>;
  goals: { available: boolean; goals: BusinessGoal[] } | null;
  canManage: boolean;
  manageNote: string | null;
  notice: string | null;
}) {
  const setupHref = `${basePath}/brand-audit`;
  const answered = GROWTH_PROFILE_SECTIONS.filter((s) => summary.sections[s.key]).length;
  const cta = !canManage ? "Review Growth Setup" : audit ? auditActionLabel(audit) : GROWTH_SETUP_COPY.cta;
  return (
    <div className="flex flex-col gap-6 lg:max-w-3xl">
      <Header basePath={basePath} summary={summary} />
      {notice && <p className="rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-findmi-700">{notice}</p>}

      <section aria-labelledby="growth-profile">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="growth-profile" className="font-display text-section-title font-bold text-primary">
            Growth Profile
          </h2>
          <span className="text-metadata font-semibold text-muted">
            {answered}/{GROWTH_PROFILE_SECTIONS.length} Complete
          </span>
        </div>
        <p className="mt-0.5 text-metadata text-muted">The more Findmi knows, the better your Opportunity matches and Ideas get.</p>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-black/[0.06]" aria-hidden="true">
          <span className="block h-full rounded-full bg-findmi" style={{ width: `${(answered / GROWTH_PROFILE_SECTIONS.length) * 100}%` }} />
        </div>
        <ul className="mt-1 divide-y divide-black/[0.06]">
          {GROWTH_PROFILE_SECTIONS.map((s) => {
            const done = summary.sections[s.key];
            const answers = growthProfileSummary(profile, s.key);
            return (
              <li key={s.key}>
                <Link href={`${setupHref}?step=${s.step}`} className="flex min-h-[48px] items-center gap-3 py-2.5">
                  <span
                    aria-hidden="true"
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${done ? "bg-findmi text-white" : "border border-black/20 text-transparent"}`}
                  >
                    ✓
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-card-title font-semibold text-primary">{s.label}</span>
                    {answers ? (
                      <span className="mt-0.5 block truncate text-metadata text-muted">{answers}</span>
                    ) : (
                      !canManage && <span className="mt-0.5 block text-metadata text-subtle">Not Added Yet</span>
                    )}
                  </span>
                  <span className={`shrink-0 text-metadata font-semibold ${done ? "text-muted" : "text-accent"}`}>{!canManage ? "Review" : done ? "Edit" : "Add"}</span>
                  <ChevronIcon direction="right" className="h-3.5 w-3.5 shrink-0 text-ink/25" />
                </Link>
              </li>
            );
          })}
        </ul>
        <Link href={setupHref} className="mt-3 inline-flex h-10 items-center rounded-full bg-findmi px-5 text-button font-bold text-white transition hover:bg-findmi-600">
          {cta}
        </Link>
      </section>

      <GoalsSection basePath={basePath} businessId={businessId} goals={goals} canManage={canManage} manageNote={manageNote} />
    </div>
  );
}

/** Ideas — Findmi's Opportunity Ideas for this Business (the existing ideas
 * infrastructure). Generic "All Brands" ideas only appear once the Business
 * has told Findmi what it wants; ideas Findmi chose for this Business always
 * appear. */
export function GrowthIdeasView({
  basePath,
  summary,
  ideas,
  canRespondToIdeas,
  respondToIdea,
}: {
  basePath: string;
  summary: ReturnType<typeof growthSummaryFor>;
  ideas: BusinessIdea[];
  canRespondToIdeas: boolean;
  respondToIdea: (ideaId: string, response: string, note?: string | null) => Promise<ActionResult>;
}) {
  const shown = eligibleGrowthIdeas(ideas, summary.hasSignal);
  return (
    <div className="flex flex-col gap-6 lg:max-w-3xl">
      <header>
        <h1 className="font-display text-page-title sm:text-page-title-lg font-bold text-primary">Growth</h1>
        <p className="mt-1 text-body text-muted">Ideas for reaching your goals, from Findmi.</p>
      </header>
      <GrowthNav basePath={basePath} active="ideas" badges={growthBadges(summary)} summary={summary} />
      {shown.length > 0 ? (
        <>
          <IdeasForYourBrand ideas={shown} layout="grid" canRespond={canRespondToIdeas} respond={respondToIdea} />
          {summary.progress < 100 && (
            <p className="text-metadata text-muted">
              Completing your Growth Profile helps Findmi suggest Ideas that fit your Business.{" "}
              <Link href={`${basePath}?tab=growth`} className="font-semibold text-accent hover:underline">
                {GROWTH_SETUP_COPY.improve}
              </Link>
            </p>
          )}
        </>
      ) : (
        <section aria-labelledby="growth-ideas-empty" className="rounded-2xl bg-black/[0.03] px-4 py-4">
          <h2 id="growth-ideas-empty" className="text-card-title font-bold text-primary">
            {summary.hasSignal ? "No Ideas Right Now" : "Ideas Get Better With Your Goals"}
          </h2>
          <p className="mt-1 text-body text-muted">
            {summary.hasSignal
              ? "Findmi adds Ideas as your Growth Profile and activity grow. Check back soon."
              : "Completing your Growth Profile helps Findmi suggest Ideas that fit your Business. Ideas Findmi picks just for you show up here as soon as they exist."}
          </p>
          {!summary.hasSignal && (
            <Link href={`${basePath}?tab=growth`} className="mt-3 inline-flex h-10 items-center rounded-full bg-findmi px-5 text-button font-bold text-white transition hover:bg-findmi-600">
              {GROWTH_SETUP_COPY.cta}
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
