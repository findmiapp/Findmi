import Link from "next/link";
import ChevronIcon from "@/components/ChevronIcon";
import BusinessOpportunityCard from "@/components/opportunities/BusinessOpportunityCard";
import { GoalGlyph } from "@/components/opportunities/OpportunityGlyphs";
import type { BusinessOpportunityItem } from "@/lib/opportunity-listings";
import type { BusinessIdea } from "@/lib/brand-audit";
import { summarizeGrowth, eligibleGrowthIdeas, GROWTH_SETUP_COPY } from "@/lib/growth";
import type { AuditSummary } from "@/lib/brand-audit-domain";
import type { ActionResult } from "../brand-audit/actions";
import { Chip } from "../../../owner-ui";
import { SparkGlyph } from "./BusinessAppShell";
import GrowthPanel from "./GrowthPanel";
import IdeasForYourBrand from "./IdeasForYourBrand";

const RAIL_CLASS =
  "-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0 [&::-webkit-scrollbar]:hidden";

/** Derive the one Growth summary from the data the page already loads —
 * shared by Home (compact panel) and the Growth tab so the two can never
 * disagree. */
export function growthSummaryFor({
  audit,
  activeGoalCount,
  opportunityItems,
}: {
  audit: AuditSummary | null;
  activeGoalCount: number;
  opportunityItems: BusinessOpportunityItem[];
}) {
  return summarizeGrowth({
    audit,
    activeGoalCount,
    matchesAwaitingResponse: opportunityItems.filter((i) => i.view.group === "for_you").length,
    matchesInProgress: opportunityItems.filter((i) => i.view.group === "confirmed" || i.view.group === "interested").length,
  });
}

/** Growth — "How can Findmi help us grow": goals, preferences, matched
 * Opportunities and Ideas on ONE compact surface. Everything is reused:
 * Growth Setup (/brand-audit), Opportunity goals/Explore/Matches
 * (?tab=opportunities views) and the Ideas rail. Ideas are progressively
 * personalized (lib/growth.ts) — with no goal signal this is a setup state,
 * not a stock list of universal ideas. */
export default function GrowthView({
  basePath,
  audit,
  activeGoalCount,
  opportunityItems,
  ideas,
  canRespondToIdeas,
  respondToIdea,
}: {
  basePath: string;
  audit: AuditSummary | null;
  activeGoalCount: number;
  opportunityItems: BusinessOpportunityItem[];
  ideas: BusinessIdea[];
  canRespondToIdeas: boolean;
  respondToIdea: (ideaId: string, response: string, note?: string | null) => Promise<ActionResult>;
}) {
  const summary = growthSummaryFor({ audit, activeGoalCount, opportunityItems });
  const shownIdeas = eligibleGrowthIdeas(ideas, summary.hasSignal);
  const awaiting = opportunityItems.filter((i) => i.view.group === "for_you");
  const ranked = [
    ...awaiting,
    ...opportunityItems.filter((i) => i.view.group === "confirmed"),
    ...opportunityItems.filter((i) => i.view.group === "interested"),
  ].slice(0, 3);

  return (
    <div className="flex flex-col gap-7 lg:max-w-3xl">
      <header>
        <h1 className="font-display text-page-title sm:text-page-title-lg font-bold text-primary">Growth</h1>
        <p className="mt-1 text-body text-muted">Tell Findmi what you&rsquo;re looking for so we can surface more relevant opportunities.</p>
      </header>

      <GrowthPanel basePath={basePath} summary={summary} titleId="growth-overview" heading={false} />

      {/* Opportunity Matches — existing recommendations, else the two
          ways in (Explore / goals). */}
      <section aria-labelledby="growth-matches">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="growth-matches" className="flex items-center gap-2 font-display text-section-title font-bold text-primary">
            Opportunity Matches
            {awaiting.length > 0 && <Chip tone="aqua">{awaiting.length} Needs Response</Chip>}
          </h2>
          <Link href={`${basePath}?tab=opportunities`} className="flex shrink-0 items-center gap-1 text-metadata font-semibold text-accent hover:underline">
            View All
            <ChevronIcon direction="right" className="h-3 w-3" />
          </Link>
        </div>
        {ranked.length === 1 ? (
          <div className="mt-3 sm:max-w-md">
            <BusinessOpportunityCard item={ranked[0].view} place={ranked[0].place} href={`${basePath}/opportunities/${ranked[0].view.recipientId}`} compact commercialOptions={ranked[0].options} />
          </div>
        ) : ranked.length > 1 ? (
          <ul className={`mt-3 ${RAIL_CLASS}`}>
            {ranked.map((top) => (
              <li key={top.view.recipientId} className="w-[min(18rem,80vw)] shrink-0 snap-start">
                <BusinessOpportunityCard item={top.view} place={top.place} href={`${basePath}/opportunities/${top.view.recipientId}`} compact commercialOptions={top.options} />
              </li>
            ))}
          </ul>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-black/[0.06]">
            <li>
              <Link href={`${basePath}?tab=opportunities&view=explore`} className="flex items-center gap-3 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center text-findmi-700">
                  <SparkGlyph className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-card-title font-semibold text-primary">Explore Opportunities</span>
                  <span className="block text-metadata text-muted">Activations, pop-ups, sampling, vending and more.</span>
                </span>
                <ChevronIcon direction="right" className="h-4 w-4 shrink-0 text-ink/30" />
              </Link>
            </li>
            <li>
              <Link href={`${basePath}/opportunities/goals/new`} className="flex items-center gap-3 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center text-findmi-700">
                  <GoalGlyph className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-card-title font-semibold text-primary">Add A Goal</span>
                  <span className="block text-metadata text-muted">So our team can recommend the right Opportunities.</span>
                </span>
                <ChevronIcon direction="right" className="h-4 w-4 shrink-0 text-ink/30" />
              </Link>
            </li>
          </ul>
        )}
      </section>

      {/* Ideas — only once there is signal (or Findmi picked one for this
          Business). Without it, the setup state above is the whole story. */}
      {shownIdeas.length > 0 ? (
        <IdeasForYourBrand ideas={shownIdeas} canRespond={canRespondToIdeas} respond={respondToIdea} />
      ) : (
        !summary.hasSignal && (
          <section aria-labelledby="growth-ideas">
            <h2 id="growth-ideas" className="font-display text-section-title font-bold text-primary">
              Ideas For Your Brand
            </h2>
            <p className="mt-1 text-body text-muted">
              {GROWTH_SETUP_COPY.body}{" "}
              <Link href={`${basePath}/brand-audit`} className="font-semibold text-accent hover:underline">
                {GROWTH_SETUP_COPY.cta}
              </Link>
            </p>
          </section>
        )
      )}
    </div>
  );
}
